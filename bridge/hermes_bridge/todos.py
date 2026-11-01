"""The agent's task list, read back the way Hermes reads it.

Hermes keeps one task list per session, written by its `todo_list` tool
(older builds call it `todo`). The API server has no endpoint for it: the list
lives in the transcript as the newest valid result of that tool, which is also
what Hermes restores when a session resumes. The phone shows that list above
the composer, so these rules follow `tools/todo_tool.py` and
`hermes_state_todo.py` rather than inventing their own.
"""

from __future__ import annotations

import json

TODO_TOOLS = ("todo_list", "todo")
STATUSES = ("pending", "in_progress", "completed", "cancelled")
MAX_ITEMS = 256
MAX_CONTENT = 4000
TRUNCATION = "… [truncated]"
# Hermes refuses to hydrate a todo result larger than this; so does the bridge.
MAX_RESULT_CHARS = 512_000


def _cap(content: str) -> str:
    if len(content) > MAX_CONTENT:
        return content[: MAX_CONTENT - len(TRUNCATION)] + TRUNCATION
    return content


def _status(value: object) -> str:
    status = str(value or "").strip().lower()
    return status if status in STATUSES else "pending"


def _validate(item: object) -> dict:
    """One item as Hermes stores it; an empty description refuses the write."""

    if not isinstance(item, dict):
        return {"id": "?", "content": "(invalid item)", "status": "pending"}
    item_id = str(item.get("id", "")).strip() or "?"
    content = str(item.get("content", "")).strip()
    if not content:
        raise ValueError("empty content")
    out = {"id": item_id, "content": _cap(content), "status": _status(item.get("status", "pending"))}
    parent = str(item.get("parent") or "").strip()
    if parent and parent != item_id:
        out["parent"] = parent
    return out


def _dedupe(items: list) -> list:
    """Duplicate ids collapse to the last one, kept where it last appeared."""

    last: dict[str, int] = {}
    for index, item in enumerate(items):
        key = str(item.get("id", "")).strip() if isinstance(item, dict) else f"__invalid_{index}"
        last[key or "?"] = index
    return [items[index] for index in sorted(last.values())]


def _order(items: list[dict]) -> list[dict]:
    """The step in progress moves ahead of an earlier pending one (flat lists only)."""

    statuses = [item["status"] for item in items]
    if any(item.get("parent") for item in items) or "in_progress" not in statuses:
        return items
    active = statuses.index("in_progress")
    if "pending" not in statuses[:active]:
        return items
    ordered = items.copy()
    ordered.insert(statuses.index("pending"), ordered.pop(active))
    return ordered


def _parents(items: list[dict]) -> list[dict]:
    """Dangling parents are dropped and cycles broken, as Hermes does."""

    by_id = {item["id"]: item for item in items}
    for item in items:
        if item.get("parent") and item["parent"] not in by_id:
            item.pop("parent", None)
    for item in items:
        seen, node = {item["id"]}, item
        while node.get("parent"):
            if node["parent"] in seen:
                item.pop("parent", None)
                break
            seen.add(node["parent"])
            node = by_id[node["parent"]]
    return items


def replace(todos: list) -> list[dict] | None:
    """The list a replacing write leaves behind, or None when Hermes refuses it."""

    try:
        items = _order([_validate(item) for item in _dedupe(todos)])
    except ValueError:
        return None
    return _parents(items[:MAX_ITEMS])


def merge(known: list[dict], todos: list) -> list[dict] | None:
    """The list a merging write leaves behind, or None when Hermes refuses it."""

    items = [dict(item) for item in known]
    existing = {item["id"]: item for item in items}
    for change in _dedupe(todos):
        if not isinstance(change, dict):
            continue
        item_id = str(change.get("id", "")).strip()
        if not item_id:
            continue
        current = existing.get(item_id)
        if current is None:
            try:
                added = _validate(change)
            except ValueError:
                return None
            existing[added["id"]] = added
            items.append(added)
            continue
        if change.get("content"):
            current["content"] = _cap(str(change["content"]).strip())
        if change.get("status") and str(change["status"]).strip().lower() in STATUSES:
            current["status"] = str(change["status"]).strip().lower()
        if "parent" in change:
            parent = str(change["parent"] or "").strip()
            if parent:
                current["parent"] = parent
            else:
                current.pop("parent", None)
    rebuilt = {item["id"]: existing.get(item["id"], item) for item in items}
    return _parents(_order(list(rebuilt.values()))[:MAX_ITEMS])


def _arguments(value: object) -> dict | None:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return None
    return value if isinstance(value, dict) else None


def call_arguments(tool_name: object, args: object) -> dict | None:
    """The arguments of a todo call, also when it rides inside `tool_call`.

    A batch that writes the list more than once is left to the result: the
    order Hermes applied it in is not visible from the call.
    """

    name = str(tool_name or "")
    if name in TODO_TOOLS:
        return _arguments(args)
    if name != "tool_call":
        return None
    wrapper = _arguments(args)
    if wrapper is None:
        return None
    calls = wrapper.get("calls")
    if not isinstance(calls, list):
        calls = [wrapper] if wrapper.get("name") else []
    inner = [call for call in calls if isinstance(call, dict) and call.get("name") in TODO_TOOLS]
    if len(inner) != 1:
        return None
    return _arguments(inner[0].get("arguments") or {})


def expected(known: list[dict] | None, args: dict | None) -> list[dict] | None:
    """What a todo call is about to leave behind; None for a read or a refusal."""

    if not isinstance(args, dict):
        return None
    todos = args.get("todos")
    if not isinstance(todos, list):
        return None
    if args.get("merge"):
        return merge(known or [], todos)
    return replace(todos)


def _shown(todos: list) -> list[dict]:
    """A stored list, trimmed to what the phone draws."""

    out = []
    for item in todos[:MAX_ITEMS]:
        if not isinstance(item, dict):
            continue
        content = str(item.get("content") or "").strip()
        if not content:
            continue
        row = {
            "id": str(item.get("id") or "").strip() or "?",
            "content": _cap(content),
            "status": _status(item.get("status")),
        }
        parent = str(item.get("parent") or "").strip()
        if parent and parent != row["id"]:
            row["parent"] = parent
        out.append(row)
    return _parents(out)


def parse_result(content: object) -> dict | None:
    """A todo tool result as `{todos, revision}`; a tool error is no list."""

    if isinstance(content, list):
        content = "".join(
            str(part.get("text") or "") for part in content if isinstance(part, dict)
        )
    if not isinstance(content, str) or len(content) > MAX_RESULT_CHARS:
        return None
    try:
        data = json.loads(content)
    except ValueError:
        return None
    if not isinstance(data, dict) or not isinstance(data.get("todos"), list):
        return None
    try:
        revision = int(data.get("revision") or 0)
    except (TypeError, ValueError):
        return None
    return {"todos": _shown(data["todos"]), "revision": revision}


def _todo_call_ids(row: dict) -> set[str]:
    """The ids of the todo calls an assistant row asked for."""

    calls = row.get("tool_calls")
    if isinstance(calls, str):
        try:
            calls = json.loads(calls)
        except ValueError:
            return set()
    if not isinstance(calls, list):
        return set()
    ids = set()
    for call in calls:
        if not isinstance(call, dict) or not call.get("id"):
            continue
        function = call.get("function")
        if not isinstance(function, dict):
            continue
        name = function.get("name")
        if name in TODO_TOOLS:
            ids.add(str(call["id"]))
        elif name == "tool_call":
            wrapper = _arguments(function.get("arguments"))
            inner = wrapper.get("calls") if wrapper else None
            if isinstance(inner, list) and any(
                isinstance(each, dict) and each.get("name") in TODO_TOOLS for each in inner
            ):
                ids.add(str(call["id"]))
    return ids


def latest(rows: list) -> dict | None:
    """The newest valid todo result in chronological `rows`, or None.

    As in Hermes, a result counts only when the assistant turn just before it
    asked for that todo call; an empty list is a real answer, a tool error is
    not. A result at the very top of the rows, whose call fell outside them, is
    taken on its tool name.
    """

    rows = [row for row in rows if isinstance(row, dict)]
    for index in range(len(rows) - 1, -1, -1):
        row = rows[index]
        if row.get("role") != "tool" or not row.get("tool_call_id"):
            continue
        prior = next(
            (rows[back] for back in range(index - 1, -1, -1) if rows[back].get("role") != "tool"),
            None,
        )
        if prior is None:
            if row.get("tool_name") not in TODO_TOOLS:
                continue
        elif prior.get("role") != "assistant" or str(row["tool_call_id"]) not in _todo_call_ids(prior):
            continue
        found = parse_result(row.get("content"))
        if found is not None:
            return found
    return None
