"""Groups the agents ask for, read from the file they write.

People rarely sort their agents by hand. They tell one of them "put the news
bots under Work", and the agent writes `~/.hermes/bot-sections.json`, the same
file the desktop Bot Sections plugin reads:

    {"sections": ["Work", "Home"], "assign": {"news": "Work", "@june": "Home"}}

The bridge only reads it. The phone keeps its own layout in the shared prefs
and applies this file when its contents change, so a later manual move wins
until the agent writes the file again.
"""

from __future__ import annotations

import hashlib
import json

from .config import Config

FILE = "bot-sections.json"
UNASSIGNED = "unassigned"
MAX_BYTES = 256 * 1024
MAX_NAME = 40


def _empty() -> dict:
    return {"sections": [], "assign": {}, "digest": ""}


def _name(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:MAX_NAME]


def normalize(raw: object) -> dict:
    """Keep only well-formed names and assignments, in the order written."""
    if not isinstance(raw, dict):
        return {"sections": [], "assign": {}}
    sections: list[str] = []
    seen: set[str] = set()

    def add(name: str) -> None:
        if name and name.lower() != UNASSIGNED and name.lower() not in seen:
            seen.add(name.lower())
            sections.append(name)

    listed = raw.get("sections")
    for item in listed if isinstance(listed, list) else []:
        add(_name(item))

    assign: dict[str, str] = {}
    given = raw.get("assign")
    for key, value in (given.items() if isinstance(given, dict) else []):
        if not isinstance(key, str):
            continue
        bot = key.strip().lstrip("@").strip().lower()
        section = _name(value)
        if not bot or not section:
            continue
        if section.lower() == UNASSIGNED:
            assign[bot] = ""
            continue
        add(section)
        # Use the spelling from the section list when only the case differs.
        assign[bot] = next(name for name in sections if name.lower() == section.lower())
    return {"sections": sections, "assign": assign}


def read_inbox(config: Config) -> dict:
    path = config.hermes_home / FILE
    try:
        if path.stat().st_size > MAX_BYTES:
            return _empty()
        text = path.read_bytes()
    except OSError:
        return _empty()
    try:
        raw = json.loads(text.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return _empty()
    if not isinstance(raw, dict):
        return _empty()
    result = normalize(raw)
    result["digest"] = hashlib.sha256(text).hexdigest()
    return result
