"""Durable orchestration references for Hermes-owned group conversations.

The journal contains member/session/run references, cursors and model settings,
never user messages or replies. A submitted wave's input is recovered from
the same Hermes histories that the desktop uses to rebuild the conversation.
"""
from __future__ import annotations

import copy
import hashlib
import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from . import prefs
from .devices import _write_private
from .groups import instructions as group_instructions, read_turn, transcript, turn_message, wire_context
from .hermes import HermesError
from .turns import TERMINAL

logger = logging.getLogger(__name__)


class GroupRounds:
    def __init__(self, config, groups, turns, instructions=lambda bot: "", automatic=True):
        self.path = config.state_dir / "group-rounds.json"
        self.groups, self.turns = groups, turns
        self.instructions, self.automatic = instructions, automatic
        self.lock = threading.RLock()
        self.workers, self.locks, self.pending = {}, {}, {}
        self.closing = threading.Event()
        self.shutdown_timeout = max(1, getattr(config, "request_timeout", 30) + 1)
        try:
            self.rows = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(self.rows, dict):
                self.rows = {}
        except (OSError, ValueError):
            self.rows = {}
        groups.busy = self.busy

    @staticmethod
    def key(group, request):
        return hashlib.sha256(json.dumps([group, request]).encode()).hexdigest()

    def _save(self):
        with self.lock:
            if not self.closing.is_set():
                _write_private(self.path, json.dumps(self.rows))

    def _fail(self, key, message):
        with self.lock:
            row = self.rows[key]
            row["status"], row["error"] = "failed", message
            self.pending.pop(key, None)
            self._save()

    def busy(self, group):
        # No groups lock is acquired here: mutations already hold that lock.
        with self.lock:
            return any(row["group"]["id"] == group and row["status"] not in TERMINAL for row in self.rows.values())

    def start(self, group, request, message):
        if not isinstance(message, str) or not message.strip() or len(message) > 32000:
            raise HermesError(400, "bad_group_turn", "Send a nonempty group message of up to 32000 characters.")
        if not isinstance(request, str) or not 1 <= len(request) <= 160 or any(ord(c) < 33 for c in request):
            raise HermesError(400, "bad_group_turn", "A group turn needs a stable request ID.")
        key = self.key(group, request)
        fingerprint = hashlib.sha256(message.encode()).hexdigest()
        # Serialize with group rename/delete to capture one complete roster.
        with self.groups.lock:
            with self.lock:
                row = self.rows.get(key)
                if row:
                    if row["fingerprint"] != fingerprint:
                        raise HermesError(409, "turn_conflict", "This request already belongs to another group message.")
                    # A response may be lost before the first member accepted it.
                    self.pending.setdefault(key, message)
                else:
                    if self.busy(group):
                        raise HermesError(409, "group_busy", "Wait for or stop the current group round before sending another message.")
                    snapshot = next((g for g in self.groups.list() if g["id"] == group), None)
                    if not snapshot:
                        raise HermesError(404, "no_group", "That group is no longer on the host.")
                    saved = prefs.read(self.groups.config)
                    models = {}
                    for member in snapshot["members"]:
                        bot = member["bot"]
                        pick = next((value for value in (saved.get("picks", {}).get(bot), saved.get("defaults", {}).get(bot))
                                     if isinstance(value, dict) and value.get("model")), {})
                        models[bot] = {"model": str(pick.get("model") or ""), "provider": str(pick.get("provider") or ""),
                                       "instructions": group_instructions(snapshot) + "\n\n" + self.instructions(bot)}
                    row = {"group": snapshot, "requestId": request, "fingerprint": fingerprint,
                           "status": "queued", "createdAt": time.time(), "wave": 0, "models": models,
                           "counts": {}, "spoken": 0, "plan": None, "cancel": False, "failures": []}
                    self.rows[key] = row
                    self.pending[key] = message
                    self._save()
        self._wake(key)
        return self.get(group, request)

    def _wake(self, key):
        if not self.automatic or self.closing.is_set():
            return
        with self.lock:
            if key in self.workers or self.rows[key]["status"] in TERMINAL:
                return
            def work():
                try:
                    while not self.closing.is_set():
                        try:
                            self.advance(self.rows[key]["group"]["id"], self.rows[key]["requestId"])
                        except HermesError as error:
                            if error.status < 500 and error.status not in (408, 429):
                                self._fail(key, error.message)
                        except Exception:
                            logger.exception("Group round coordinator failed")
                            self._fail(key, "The group coordinator could not continue. Refresh the group before retrying.")
                        with self.lock:
                            if self.rows[key]["status"] in TERMINAL:
                                return
                        self.closing.wait(1.2)
                finally:
                    with self.lock:
                        self.workers.pop(key, None)
            worker = threading.Thread(target=work, daemon=True)
            self.workers[key] = worker
            worker.start()

    def resume(self):
        for key in list(self.rows):
            self._wake(key)

    def close(self):
        with self.lock:
            self.closing.set()
            workers = list(self.workers.values())
        deadline = time.monotonic() + self.shutdown_timeout
        for worker in workers:
            if worker is not threading.current_thread():
                worker.join(max(0, deadline - time.monotonic()))

    def _row(self, group, request):
        row = self.rows.get(self.key(group, request))
        if not row:
            raise HermesError(404, "no_run", "No group round with this request ID.")
        return row

    def get(self, group, request, include_messages=True):
        with self.lock:
            row = copy.deepcopy(self._row(group, request))
        histories = self.groups.histories(row["group"]) if include_messages else {}
        messages = transcript(row["group"]["members"], histories) if include_messages else []
        # Until Hermes accepts the first member, show the local input in this
        # response only. It is never a second persisted conversation.
        if include_messages and row["wave"] == 0 and row["status"] not in TERMINAL:
            message = self.pending.get(self.key(group, request))
            if message and not any(item["from"] == "user" and item["text"] == message for item in messages):
                messages.append({"id": "pending:" + request, "from": "user", "text": message})
        return {"id": request, "requestId": request, "groupId": group, "status": row["status"],
                "messages": messages, "failures": row["failures"], "wave": row["wave"],
                "responded": row.get("responded", []),
                "error": row.get("error") or ("Some group members could not answer." if row["failures"] else "")}

    def active(self):
        with self.lock:
            rows = [copy.deepcopy(row) for row in self.rows.values() if row["status"] not in TERMINAL]
        return [{"groupId": row["group"]["id"], "requestId": row["requestId"], "status": row["status"]} for row in rows]

    def stop(self, group, request):
        with self.lock:
            row = self._row(group, request)
            if row["status"] in TERMINAL:
                return self.get(group, request, include_messages=False)
            row["cancel"] = True
            self._save()
        # advance serializes with a pending acceptance, then stops even the
        # run whose acceptance reply was lost before the user pressed stop.
        self.advance(group, request)
        # Cancellation must succeed even if Hermes history is temporarily down.
        # The phone keeps its transcript and reads it separately on reconnect.
        return self.get(group, request, include_messages=False)

    def advance(self, group, request):
        key = self.key(group, request)
        with self.lock:
            serial = self.locks.setdefault(key, threading.Lock())
        with serial:
            if self.closing.is_set():
                return
            with self.lock:
                row = self._row(group, request)
                if row["status"] in TERMINAL:
                    return
                if row["cancel"] and row["plan"] is None:
                    row["status"] = "cancelled"; self.pending.pop(key, None); self._save()
                    return
            snapshot = row["group"]
            identity = "group-" + key + "-" + str(row["wave"])
            if row["cancel"]:
                unresolved, stopping = False, False
                for member in snapshot["members"]:
                    args = (member["bot"], member["sessionId"], identity)
                    if self.turns.has_accepted(*args):
                        stopping = self.turns.stop(*args)["status"] not in TERMINAL or stopping
                    elif self.turns.has_attempt(*args):
                        unresolved = True
                # Known runs can be stopped without reading conversation history.
                # Only a lost acceptance needs the frozen wire to recover its ID.
                if not unresolved:
                    if stopping:
                        return
                    with self.lock:
                        row["status"] = "cancelled"; self.pending.pop(key, None); self._save()
                    return
            histories = self.groups.histories(snapshot)
            if self.closing.is_set():
                return
            if row["plan"] is None:
                if row["cancel"]:
                    with self.lock:
                        row["status"] = "cancelled"; self._save()
                    return
                with self.lock:
                    row["plan"] = {"cuts": {bot: len(rows) for bot, rows in histories.items()},
                                   "floors": [{"bot": member["bot"]} for member in snapshot["members"]]}
                    row["status"] = "running"
                    self._save()
            plan = row["plan"]
            # Frozen cursors keep a retry byte-for-byte identical even if some
            # members have already accepted/completed the parallel wave.
            before = {bot: rows[:plan["cuts"][bot]] for bot, rows in histories.items()}
            history = transcript(snapshot["members"], before)
            context = None
            if row["wave"] == 0:
                message = self.pending.get(key)
                if message is None:
                    # An accepted member's exact wire is authoritative after a
                    # process restart. It includes the person line already.
                    for bot, rows in histories.items():
                        anchor = next((item for item in rows[plan["cuts"][bot]:] if item["role"] == "user" and item["content"].startswith("[Group chat ")), None)
                        if anchor:
                            context = wire_context(anchor["content"])
                            if context is not None:
                                break
                if message is None and context is None:
                    # No Hermes submission ever survived: do not invent input
                    # or silently send a different request after a restart.
                    with self.lock:
                        row["status"] = "interrupted"; self._save()
                    return
                if message is not None:
                    history.append({"id": "input:" + request, "from": "user", "text": message})
            def run(floor):
                member = next(member for member in snapshot["members"] if member["bot"] == floor["bot"])
                bot, session = member["bot"], member["sessionId"]
                options = row["models"][bot]
                try:
                    if self.closing.is_set():
                        return floor, {"status": "retry"}
                    if row["cancel"] and not self.turns.has_attempt(bot, session, identity):
                        return floor, {"status": "cancelled"}
                    if row["cancel"] and self.turns.has_accepted(bot, session, identity):
                        return floor, self.turns.stop(bot, session, identity)
                    self.turns.start(bot, session, identity, turn_message(snapshot, member, history, floor, context),
                                     options["model"], options["provider"], instructions=options["instructions"])
                    if row["cancel"]:
                        return floor, self.turns.stop(bot, session, identity)
                    return floor, self.turns.get(bot, session, identity)
                except HermesError as error:
                    if error.status >= 500 or error.status in (408, 429):
                        return floor, {"status": "retry"}
                    return floor, {"status": "failed", "error": error.code}
            with ThreadPoolExecutor(max_workers=min(20, len(plan["floors"]))) as pool:
                outcomes = list(pool.map(run, plan["floors"]))
            if self.closing.is_set():
                return
            if any(run["status"] not in TERMINAL for _, run in outcomes):
                return
            # Read before mutating the round. A transient history error must
            # leave the frozen plan and wave counters exactly as they were.
            latest = self.groups.histories(snapshot) if not row["cancel"] else None
            with self.lock:
                if row["cancel"]:
                    row["status"] = "cancelled"; self.pending.pop(key, None); self._save()
                    return
                next_floors = {}
                for floor, result in outcomes:
                    bot = floor["bot"]
                    row["counts"][bot] = row["counts"].get(bot, 0) + 1
                    if result["status"] != "completed":
                        row["failures"].append({"bot": bot, "wave": row["wave"], "status": result["status"]})
                        continue
                    parsed = read_turn(result.get("text", ""), snapshot["members"])
                    if parsed["text"] and not parsed["silent"]:
                        row["spoken"] += 1
                        if bot not in row.setdefault("responded", []):
                            row["responded"].append(bot)
                        for target in parsed["mentions"]:
                            if target != bot:
                                speaker = next(member["name"] for member in snapshot["members"] if member["bot"] == bot)
                                next_floors.setdefault(target, {"bot": target, "mentionedBy": speaker})
                row["wave"] += 1
                self.pending.pop(key, None)
                floors = [next_floors[member["bot"]] for member in snapshot["members"]
                          if member["bot"] in next_floors and row["counts"].get(member["bot"], 0) < 2]
                if not floors or row["wave"] >= 4 or row["spoken"] >= 8:
                    row["status"] = "failed" if len(row["failures"]) == len(snapshot["members"]) and row["wave"] == 1 else "completed"
                    row["plan"] = None
                else:
                    # Only offsets and scheduling information survive; read all
                    # spoken content back from Hermes on the next advance.
                    row["plan"] = {"cuts": {bot: len(rows) for bot, rows in latest.items()}, "floors": floors}
                self._save()
