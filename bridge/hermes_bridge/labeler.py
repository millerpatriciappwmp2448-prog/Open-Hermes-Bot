"""Short role tags summarised from an agent's description by a tool-free profile."""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time

import yaml

from . import profiles
from .agent_permissions import collect_reply
from .devices import _write_private
from .hermes import HermesError
from .profiles import BotError

MANAGED = "hermes-bot-labeler-v1"
NAME = "agent-labeler"
SOUL = "You write one short role label. Output only the label, nothing else.\n"
CJK = re.compile(r"[\u3400-\u9fff]")
PREFIX = re.compile(r"^(标签|角色|定位|label|tag|role)\s*[:：]\s*", re.I)


def digest(text: str) -> str:
    return hashlib.sha256(text.strip().encode("utf-8")).hexdigest()


def clean(raw: str, chinese: bool) -> str:
    text = re.sub(r"<think>.*?</think>", "", raw or "", flags=re.S | re.I)
    line = next((item.strip() for item in text.splitlines() if item.strip()), "")
    line = PREFIX.sub("", line.lstrip("-*#• ").strip())
    junk = " \"'`“”‘’「」『』《》()（）[]【】。．.，,；;：:！!？?"
    previous = None
    while previous != line:
        previous = line
        line = PREFIX.sub("", line.strip(junk))
    line = re.sub(r"\s+", " ", line).strip()
    limit = 12 if chinese or CJK.search(line) else 32
    line = line[: min(limit, 40)].strip()
    if not line:
        raise HermesError(502, "label_empty", "The model returned no usable tag.")
    return line


class Labeler:
    def __init__(self, config, hermes):
        self.config, self.hermes = config, hermes
        self.lock = threading.Lock()
        self.slots = threading.Semaphore(2)
        self.tried_path = config.state_dir / "labels.json"

    def _find(self) -> str:
        root = self.config.profiles_dir
        for child in sorted(root.iterdir()) if root.is_dir() else []:
            meta = profiles.read_meta(self.config, child.name)
            if child.is_dir() and meta["managed"] == MANAGED and meta["internal"]:
                if not (root / ".deleted" / child.name).exists():
                    return child.name
        return ""

    def _prepare(self, path):
        settings_path = path / "config.yaml"
        try:
            settings = yaml.safe_load(settings_path.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError):
            settings = {}
        settings["mcp_servers"] = {}
        settings["platform_toolsets"] = {"api_server": ["no_mcp"]}
        settings["plugins"] = {"enabled": False}
        settings["skills"] = {"creation_nudge": False}
        settings_path.write_text(yaml.safe_dump(settings, allow_unicode=True, sort_keys=False), encoding="utf-8")
        (path / "SOUL.md").write_text(SOUL, encoding="utf-8")
        meta_path = path / "profile.yaml"
        meta = yaml.safe_load(meta_path.read_text(encoding="utf-8"))
        meta["ui_meta"]["hermes-bots"].update(managed=MANAGED, internal=True, capabilities=[])
        meta_path.write_text(yaml.safe_dump(meta, allow_unicode=True, sort_keys=False), encoding="utf-8")

    def ensure(self) -> tuple[str, bool]:
        with self.lock:
            name = self._find()
            if name:
                return name, False
            name = NAME
            for index in range(1, 100):
                if not self.config.profile_dir(name).exists():
                    break
                name = f"{NAME}-{index}"
            profiles.create_bot(self.config, name, title="Tag writer", prepare=self._prepare)
            return name, True

    def describe(self, profile: str) -> str:
        meta = profiles.read_meta(self.config, profile)
        return (meta["description"] or profiles.read_role(self.config, profile)).strip()

    def generate(self, profile: str) -> str:
        description = self.describe(profile)
        if not description:
            raise BotError(400, "no_description", "Add a description first.")
        chinese = bool(CJK.search(description))
        if chinese:
            prompt = ("把下面的智能体描述概括成一个角色标签。要求：2 到 8 个汉字的名词短语，"
                      "是对职责的概括，不要照抄描述开头，不要标点和解释，只输出标签。\n\n描述：\n" + description)
        else:
            prompt = ("Summarise this agent description as one role label: a 1 to 4 word noun "
                      "phrase that captures its job. Do not copy the opening words. Output only "
                      "the label, no punctuation.\n\nDescription:\n" + description)
        with self.slots:
            labeler, fresh = self.ensure()
            deadline = time.monotonic() + (20 if fresh else 0)
            while True:
                session = None
                try:
                    session = self.hermes.create_session(labeler, "tag")
                    reply = collect_reply(self.hermes.stream_turn(labeler, session["id"], prompt))
                    return clean(reply, chinese)
                except HermesError:
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(2)
                finally:
                    if session:
                        try:
                            self.hermes.delete_session(labeler, session["id"])
                        except Exception:  # noqa: BLE001 - cleanup only
                            pass

    def auto(self, profile: str, only_if_auto: bool = True) -> dict:
        meta = profiles.read_meta(self.config, profile)
        description = self.describe(profile)
        if only_if_auto and meta["tag"] and not meta["tag_auto"]:
            return meta
        if not description:
            if meta["tag"] and meta["tag_auto"]:
                return profiles.write_meta(self.config, profile, {"tag": ""})
            return meta
        source = digest(description)
        if only_if_auto and meta["tag"] and meta["tag_auto"] and meta["tag_source"] == source:
            return meta
        tag = self.generate(profile)
        latest = profiles.read_meta(self.config, profile)
        if only_if_auto and latest["tag"] and not latest["tag_auto"]:
            return latest
        return profiles.write_meta(self.config, profile, {"tag": tag, "tag_auto": True, "tag_source": source})

    def _tried(self) -> dict:
        try:
            data = json.loads(self.tried_path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def backfill(self) -> None:
        tried = self._tried()
        for bot in profiles.list_bots(self.config):
            profile = profiles.profile_of(bot["id"])
            meta = profiles.read_meta(self.config, profile)
            if meta["internal"] or meta["managed"] or (meta["tag"] and not meta["tag_auto"]):
                continue
            description = self.describe(profile)
            if not description or tried.get(profile) == digest(description):
                continue
            try:
                self.auto(profile, True)
            except Exception:  # noqa: BLE001 - one bad profile must not stop others
                continue
            # Only remember a description once it has a tag, so a slow or
            # failed first attempt is retried on the next start.
            tried[profile] = digest(description)
            self.config.state_dir.mkdir(parents=True, exist_ok=True)
            _write_private(self.tried_path, json.dumps(tried))
