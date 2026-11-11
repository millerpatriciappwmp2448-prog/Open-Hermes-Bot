"""Groups are a view of Hermes member sessions, shared with the desktop app.

Only the titles join a group: ``Group · <group> · <member>``. There is no
transcript cache or parallel group database on the bridge.
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
from concurrent.futures import ThreadPoolExecutor

from . import profiles
from .hermes import HermesError

PREFIX = "Group · "
SEPARATOR = " · "
SILENT = re.compile(r"\[\[\s*silent\s*\]\]", re.I)
REACTION = re.compile(r"\[\[react:\s*([^\]]{1,24}?)\s*\]\]", re.I)
PARTIAL = re.compile(r"\[\[\s*(?:s(?:i(?:l(?:e(?:n(?:t)?)?)?)?)?|react:[^\]]*)?$", re.I)
RECORD = "@@hermes-message-v1 "


def parse_title(title: str) -> tuple[str, str] | None:
    title = title.strip()
    if not title.startswith(PREFIX):
        return None
    name, separator, member = title[len(PREFIX):].rpartition(SEPARATOR)
    return (name.strip(), member.strip()) if separator and name.strip() and member.strip() else None


def group_id(name: str) -> str:
    return "g-" + hashlib.sha256(name.encode("utf-8")).hexdigest()[:32]


def _name(value) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 80 or any(ord(c) < 32 for c in value):
        raise HermesError(400, "bad_group", "A group needs a name of up to 80 characters without control characters.")
    return value.strip()


def _title(name: str, member: str) -> str:
    # A member name containing the separator cannot be recovered by the
    # desktop's last-separator parser. Refuse it rather than silently lose it.
    if SEPARATOR in member or any(ord(c) < 32 for c in member):
        raise HermesError(400, "bad_group", "Rename this member without line breaks or ' · ' before adding it to a group.")
    return f"{PREFIX}{name}{SEPARATOR}{member}"


def _wire(content: str) -> tuple[list[tuple[str, str, str, str]], str] | None:
    if not content.startswith("[Group chat "):
        return None
    start = content.find("Conversation so far:\n")
    if start < 0:
        return None
    start += len("Conversation so far:\n")
    end = content.rfind("\n\nYou are @", start)
    if end < 0:
        return None
    lines: list[tuple[str, str, str, str]] = []
    raw_lines = content[start:end].split("\n")
    index = 0
    while index < len(raw_lines):
        raw = raw_lines[index]
        index += 1
        if raw.startswith(RECORD):
            try:
                meta = json.loads(raw[len(RECORD):])
                kind, name, identity, count = meta["kind"], meta["name"], meta["id"], meta["lines"]
                if (kind not in ("user", "member", "note") or not isinstance(name, str)
                        or not isinstance(identity, str) or not identity or type(count) is not int
                        or count < 1 or count > len(raw_lines) - index):
                    continue
                prefix = "@You: " if kind == "user" else "(note) " if kind == "note" else f"@{name}: "
                body = "\n".join(raw_lines[index:index + count])
                if not body.startswith(prefix):
                    continue
                lines.append((kind, name, body[len(prefix):], identity))
                index += count
                continue
            except (ValueError, KeyError, TypeError):
                continue
        person = re.match(r"^@You:\s?(.*)$", raw)
        note = re.match(r"^\(note\)\s?(.*)$", raw)
        member = re.match(r"^@([^:]+):\s?(.*)$", raw)
        if person:
            lines.append(("user", "", person[1], ""))
        elif note:
            lines.append(("note", "", note[1], ""))
        elif member:
            lines.append(("member", member[1].strip(), member[2], ""))
        elif lines:
            kind, name, text, identity = lines[-1]
            lines[-1] = (kind, name, text + "\n" + raw, identity)
    return lines, content[end + 2:]


def _line_key(kind: str, name: str, text: str, identity: str = "") -> tuple:
    return ("id", identity) if identity else (kind, name, text)


def _silent_reaction(bot: str, message: str) -> str:
    # Match JS charCodeAt, including surrogate pairs, so desktop and phone agree.
    seed = (bot + ":" + message).encode("utf-16-le", errors="surrogatepass")
    hashed = 0
    for index in range(0, len(seed), 2):
        hashed = (hashed * 31 + int.from_bytes(seed[index:index + 2], "little")) & 0xFFFFFFFF
    return ["👍", "👀", "✅", "🙌"][hashed % 4]


def read_turn(raw: str, members: list[dict]) -> dict:
    if SILENT.search(raw):
        return {"silent": True, "text": "", "mentions": []}
    text = PARTIAL.sub("", REACTION.sub("", raw)).strip()
    names = sorted({member["name"] for member in members}, key=len, reverse=True)
    pattern = re.compile(r"@(" + "|".join(re.escape(name) for name in names) + r")(?![^\W_]|[_-])", re.I)
    wanted = {match[1].casefold() for match in pattern.finditer(text)} if names else set()
    return {"silent": not text and not REACTION.search(raw), "text": text,
            "mentions": [member["bot"] for member in members if member["name"].casefold() in wanted]}


def wire_context(content: str) -> str | None:
    """Recover a frozen wave verbatim, without parsing user-authored @ lines."""
    if not content.startswith("[Group chat "):
        return None
    start = content.find("Conversation so far:\n")
    end = content.rfind("\n\nYou are @")
    if start < 0 or end < start:
        return None
    return content[start + len("Conversation so far:\n"):end]


def turn_message(group: dict, speaker: dict, history: list[dict], floor: dict, context: str | None = None) -> str:
    names = {member["bot"]: member["name"] for member in group["members"]}
    lines = []
    for message in history[-16:]:
        if message.get("notice"):
            kind, name, text = "note", "", message["text"]
        elif message["from"] == "user":
            kind, name, text = "user", "", message["text"]
        else:
            taps = ", ".join(f'{reaction["name"]} reacted {reaction["emoji"]}' for reaction in message.get("reactions", []))
            kind, name = "member", names.get(message["from"], "Bot")
            text = message["text"] + (f" ({taps})" if taps else "")
        prefix = "@You: " if kind == "user" else "(note) " if kind == "note" else f"@{name}: "
        meta = {"id": message["id"], "kind": kind, "name": name, "lines": text.count("\n") + 1}
        # Length-delimited records keep quoted @ lines inside their message.
        # Both metadata and body live only in the existing Hermes session.
        lines.append(RECORD + json.dumps(meta, ensure_ascii=False, separators=(",", ":")) + "\n" + prefix + text)
    # Keep the newest message whole. Cutting through it loses the @You marker
    # and makes the accepted wave impossible to recover after a bridge restart.
    kept = []
    for line in reversed(lines):
        if kept and len(line) + sum(map(len, kept)) + len(kept) > 6000:
            break
        kept.append(line)
    text = context if context is not None else "\n".join(reversed(kept))
    cue = f'@{floor["mentionedBy"]} mentioned you by name. You have the floor now.' if floor.get("mentionedBy") else (
        "The person addressed you directly." if floor.get("addressed") else "The last line is new in the group.")
    roster = ", ".join("@" + member["name"] for member in group["members"])
    return f'[Group chat “{group["name"]}” — members: {roster}, and the person (shown as @You).]\n\nConversation so far:\n{text}\n\nYou are @{speaker["name"]}. {cue}\nIt is your turn. Decide: [[silent]] to stay out, a reaction to acknowledge, or a message to the group. If you speak, keep it to what only you would add.'


def instructions(group: dict) -> str:
    roster = ", ".join("@" + member["name"] for member in group["members"])
    return (f'Hermes Bot group chat: you are one member of “{group["name"]}”, talking with {roster} and the person. '
            "Each member answers on their own. You never write another member's words, and you never invent a line from the person. "
            "Choose one move: reply exactly [[silent]] when you have nothing to add; start with [[react:👍]] for an emoji reaction; "
            "or write a short message in your own voice without restating others. Silence leaves a tapback automatically. "
            "Use @TheirName only when you want that member to answer next, never as decoration. "
            "Do not combine silence and a reaction. Write in the person's language, without preamble or speaking for others.")


def transcript(members: list[dict], histories: dict[str, list[dict]]) -> list[dict]:
    """Rebuild the same person/reply/tapback events as desktop groupTranscript."""
    events = []
    people = {}
    for member in members:
        target = None
        cue = ""
        for row in histories[member["bot"]]:
            text = row["content"]
            if row["role"] == "user":
                wire = _wire(text)
                if not wire:
                    continue
                lines, cue = wire
                for kind, name, body, identity in lines:
                    if kind == "user":
                        key = _line_key(kind, name, body, identity)
                        previous = people.get(key)
                        if previous is None or row["timestamp"] < previous[1]:
                            people[key] = (body, row["timestamp"], identity)
                target = next((_line_key(*line) for line in reversed(lines) if line[0] != "note"), None)
            elif row["role"] == "assistant":
                events.append((row["timestamp"], "member", member, text, target,
                               bool(re.search(r"mentioned you by name|addressed you directly", cue))))
    # A new-format context may carry an old hp-* message ID. Reuse that
    # legacy event rather than displaying it a second time after an upgrade.
    for key, (body, timestamp, identity) in list(people.items()):
        legacy = people.get(("user", "", body))
        if identity and legacy and identity.startswith(f"hp-{legacy[1]}-"):
            people[key] = (body, min(timestamp, legacy[1]), identity)
            del people[("user", "", body)]
    events.extend((timestamp, "user", None, text, identity, False) for text, timestamp, identity in people.values())
    events.sort(key=lambda event: event[0])
    messages = []
    keys = {}
    for timestamp, kind, member, raw, key, addressed in events:
        if kind == "user":
            identity = key or f"hp-{timestamp}-{len(messages)}"
            keys[("id", identity)] = len(messages)
            keys[_line_key("user", "", raw)] = len(messages)
            messages.append({"id": identity, "from": "user", "text": raw})
            continue
        target_index = keys.get(key)
        target = messages[target_index] if target_index is not None else next(
            (row for row in reversed(messages) if not row.get("notice")), None)
        silent = bool(SILENT.search(raw))
        emoji = next((match[1].strip() for match in REACTION.finditer(raw)
                      if any(ord(char) >= 0x203C for char in match[1])
                      and not any(char.isalnum() for char in match[1])), None)
        text = PARTIAL.sub("", REACTION.sub("", SILENT.sub("", raw))).strip()
        silent = silent or (not text and not emoji)
        if target and (silent or emoji):
            reactions = [reaction for reaction in target.get("reactions", []) if reaction["by"] != member["bot"]]
            reactions.append({"by": member["bot"], "name": member["name"],
                              "emoji": _silent_reaction(member["bot"], target["id"]) if silent else emoji})
            target["reactions"] = reactions
            target["reaction"] = {"emoji": reactions[0]["emoji"], "count": len(reactions)}
        if silent:
            if addressed:
                messages.append({"id": f"he-{timestamp}-{len(messages)}", "from": member["bot"],
                                 "text": f'{member["name"]} stayed silent.', "notice": True, "noticeKind": "silent"})
            continue
        if text:
            identity = f"hm-{timestamp}-{len(messages)}"
            keys[("id", identity)] = len(messages)
            keys[_line_key("member", member["name"], text)] = len(messages)
            messages.append({"id": identity, "from": member["bot"], "text": text})
    return messages


class Groups:
    def __init__(self, config, hermes):
        self.config = config
        self.hermes = hermes
        self.lock = threading.RLock()
        self.busy = lambda identity: False

    def get(self, identity: str) -> dict:
        with self.lock:
            return self._find(identity, self._catalog())

    def _catalog(self) -> list[dict]:
        bots = profiles.list_bots(self.config)
        with ThreadPoolExecutor(max_workers=max(1, min(4, len(bots)))) as pool:
            # Discovery must not silently omit an offline member: a partial
            # roster is unsafe for create/rename/remove. Surface that error.
            batches = pool.map(lambda bot: self.hermes.sessions(bot["id"], pages=None), bots)
            return [row for batch in batches for row in batch]

    @staticmethod
    def _groups(rows: list[dict]) -> list[dict]:
        found = {}
        for row in rows:
            parsed = parse_title(row["title"])
            if not parsed:
                continue
            name, member = parsed
            group = found.setdefault(name, {})
            previous = group.get(member)
            if not previous or row["lastActive"] > previous["lastActive"]:
                group[member] = {"bot": row["bot"], "name": member, "sessionId": row["id"], "lastActive": row["lastActive"]}
        return [{"id": group_id(name), "name": name, "members": list(members.values()),
                 "lastActive": max(member["lastActive"] for member in members.values())}
                for name, members in found.items()]

    def list(self) -> list[dict]:
        with self.lock:
            return sorted(self._groups(self._catalog()), key=lambda group: (-group["lastActive"], group["name"]))

    def _find(self, identity: str, rows: list[dict]) -> dict:
        group = next((group for group in self._groups(rows) if group["id"] == identity), None)
        if not group:
            raise HermesError(404, "no_group", "That group is no longer on the host. Refresh the conversation list.")
        return group

    def _members(self, members, minimum: int) -> list[dict]:
        if not isinstance(members, list) or not minimum <= len(members) <= 20 or any(not isinstance(bot, str) for bot in members) or len(set(members)) != len(members):
            raise HermesError(400, "bad_group", f"Choose {minimum} to 20 different group members.")
        bots = [profiles.get_bot(self.config, bot) for bot in members]
        names = [bot["name"] for bot in bots]
        if len(set(names)) != len(names):
            raise HermesError(400, "bad_group", "Group members need different names so mentions identify one agent.")
        for name in names:
            _title("", name)
        return bots

    def _create_member(self, name: str, bot: dict, rows: list[dict], created: list[dict]) -> dict:
        title = _title(name, bot["name"])
        match = next((row for row in rows if row["bot"] == bot["id"] and row["title"] == title), None)
        if match:
            return match
        try:
            session = self.hermes.create_session(bot["id"], title, exact=True)
        except HermesError as error:
            if error.status != 409:
                raise
            # Another client may have accepted this exact title after discovery.
            session = next((row for row in self.hermes.sessions(bot["id"], pages=None) if row["title"] == title), None)
            if not session:
                raise
            return session
        row = {"bot": bot["id"], "id": session["id"], "title": title, "lastActive": 0}
        created.append(row)
        return row

    def _rollback(self, created: list[dict], renamed: list[dict] | None = None) -> None:
        failed = False
        for row in reversed(renamed or []):
            try:
                self.hermes.rename_session(row["bot"], row["id"], row["title"])
            except HermesError:
                failed = True
        for row in created:
            try:
                self.hermes.delete_session(row["bot"], row["id"])
            except HermesError:
                failed = True
        if failed:
            raise HermesError(502, "group_partial", "A group change only partly completed. Refresh its server sessions before retrying.")

    def create(self, name, members) -> dict:
        name = _name(name)
        bots = self._members(members, 2)
        with self.lock:
            rows = self._catalog()
            existing = next((group for group in self._groups(rows) if group["name"] == name), None)
            if existing:
                known = {member["bot"] for member in existing["members"]}
                if not known <= set(members):
                    raise HermesError(409, "group_exists", "A group with that name already has different members.")
                if known == set(members):
                    return existing
                if self.busy(existing["id"]):
                    raise HermesError(409, "group_busy", "Stop the group's current round before changing its members.")
            created = []
            try:
                for bot in bots:
                    self._create_member(name, bot, rows, created)
                return self._find(group_id(name), self._catalog())
            except Exception:
                self._rollback(created)
                raise

    def update(self, identity: str, body: dict) -> dict:
        with self.lock:
            if self.busy(identity):
                raise HermesError(409, "group_busy", "Stop the group's current round before changing its members or name.")
            rows = self._catalog()
            group = self._find(identity, rows)
            name = _name(body.get("name", group["name"]))
            members = body.get("members", [member["bot"] for member in group["members"]])
            bots = self._members(members, 1)
            if name != group["name"] and any(found["name"] == name for found in self._groups(rows)):
                raise HermesError(409, "group_exists", "A group with that name already exists.")
            originals = [row for row in rows if (parse_title(row["title"]) or (None,))[0] == group["name"]]
            created, renamed = [], []
            try:
                for bot in bots:
                    old = [row for row in originals if row["bot"] == bot["id"]]
                    if not old:
                        self._create_member(name, bot, rows, created)
                    else:
                        for row in old:
                            title = _title(name, bot["name"])
                            if row["title"] != title:
                                self.hermes.rename_session(row["bot"], row["id"], title)
                                renamed.append(row)
            except Exception:
                self._rollback(created, renamed)
                raise
            # Deletion happens last: reversible changes cannot destroy a removed
            # member's history if another profile refuses its rename.
            for row in originals:
                if row["bot"] not in members:
                    self.hermes.delete_session(row["bot"], row["id"])
            return self._find(group_id(name), self._catalog())

    def delete(self, identity: str) -> None:
        with self.lock:
            if self.busy(identity):
                raise HermesError(409, "group_busy", "Stop the group's current round before deleting it.")
            rows = self._catalog()
            group = self._find(identity, rows)
            # Include superseded sessions too, or a deleted group reappears on
            # the next discovery. Private and other groups' sessions are intact.
            for row in rows:
                if (parse_title(row["title"]) or (None,))[0] == group["name"]:
                    self.hermes.delete_session(row["bot"], row["id"])

    def messages(self, identity: str) -> list[dict]:
        group = self.get(identity)
        return transcript(group["members"], self.histories(group))

    def histories(self, group: dict) -> dict[str, list[dict]]:
        def read(member):
            rows, offset = [], 0
            while True:
                page = self.hermes.message_page(member["bot"], member["sessionId"], 200, offset)
                rows.extend(page["messages"])
                if page["nextOffset"] is None:
                    return member["bot"], rows
                if page["nextOffset"] <= offset:
                    raise HermesError(502, "group_history", "The host returned an invalid history cursor.")
                offset = page["nextOffset"]
        with ThreadPoolExecutor(max_workers=min(4, len(group["members"]))) as pool:
            return dict(pool.map(read, group["members"]))
