"""Recoverable references to Hermes-owned, detached runs (never replay a turn)."""
from __future__ import annotations

import hashlib
import json
import threading
import time

from .devices import _write_private
from .hermes import HermesError

TERMINAL = {"completed", "failed", "cancelled", "interrupted", "unknown"}


class Turns:
    def __init__(self, config, hermes):
        self.path = config.state_dir / "mobile-turns.json"
        self.hermes = hermes
        self.lock = threading.RLock()
        self.readers = set()
        self.live = {}
        try:
            self.rows = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(self.rows, dict):
                self.rows = {}
        except (OSError, ValueError):
            self.rows = {}

    @staticmethod
    def key(bot, session, request):
        return hashlib.sha256(json.dumps([bot, session, request]).encode()).hexdigest()

    def _save(self):
        _write_private(self.path, json.dumps(self.rows))

    def start(self, bot, session, request, message, model="", provider="", instructions=""):
        key = self.key(bot, session, request)
        fingerprint = hashlib.sha256(json.dumps([message, model, provider]).encode()).hexdigest()
        with self.lock:
            row = self.rows.get(key)
            if row and row["fingerprint"] != fingerprint:
                raise HermesError(409, "turn_conflict", "This request already belongs to another message.")
            if not row:
                # Persist the identity before submission. A lost acceptance is retried
                # with the SAME Hermes idempotency key, even across bridge restarts.
                row = dict(bot=bot, sessionId=session, requestId=request,
                           fingerprint=fingerprint, createdAt=time.time(), id="")
                self.rows[key] = row
                self._save()
            if not row["id"]:
                options = {"instructions": instructions} if instructions else {}
                accepted = self.hermes.start_run(bot, session, message, model, provider, "mobile-" + key, **options)
                rid = accepted.get("run_id") or accepted.get("id")
                if not isinstance(rid, str) or not rid:
                    raise HermesError(502, "no_run", "Hermes did not return a run ID.")
                row.update(id=rid, status=accepted.get("status") or "queued")
                self._save()
            self._subscribe(key)
            return self._public(row, self.live.get(key, {}))

    def _subscribe(self, key):
        row = self.rows[key]
        if key in self.readers or row.get("status") in TERMINAL or not row.get("id"):
            return
        self.readers.add(key)
        threading.Thread(target=self._read, args=(key,), daemon=True).start()

    def _read(self, key):
        try:
            row = self.rows[key]
            for event in self.hermes.run_events(row["bot"], row["id"]):
                with self.lock:
                    live = self.live.setdefault(key, {"text": ""})
                    # Replay is possible after a reader reconnect. Only consume
                    # unseen sequence numbers, never append the same delta twice.
                    seq = event.get("seq")
                    if isinstance(seq, int):
                        if seq <= live.get("seq", -1):
                            continue
                        live["seq"] = seq
                    name = event.get("event")
                    if name == "message.delta":
                        live["text"] = (live.get("text", "") + str(event.get("delta") or ""))[-2_000_000:]
                    elif name == "tool.started":
                        live["tool"] = str(event.get("tool") or "")
                    elif name == "tool.completed":
                        live["tool"] = ""
        except Exception:
            # Transport failure is not a run failure. GET status remains authoritative.
            pass
        finally:
            with self.lock:
                self.readers.discard(key)

    def get(self, bot, session, request):
        key = self.key(bot, session, request)
        with self.lock:
            row = self.rows.get(key)
            if not row or not row.get("id"):
                raise HermesError(404, "no_run", "No accepted run with this request ID.")
            rid = row["id"]
        status = self.hermes.run_status(bot, rid)
        with self.lock:
            row["status"] = str(status.get("status") or "running")
            # Only references/status go on disk; the transcript stays in Hermes.
            self._save()
            live = self.live.setdefault(key, {})
            if isinstance(status.get("output"), str) and row["status"] in TERMINAL:
                live["text"] = status["output"]
            if status.get("error"):
                live["error"] = str(status["error"])
            if row["status"] not in TERMINAL:
                self._subscribe(key)
            result = self._public(row, live)
            result["sessionId"] = str(status.get("session_id") or session)
            return result

    @staticmethod
    def _public(row, live):
        return {key: row.get(key) for key in ("bot", "sessionId", "requestId", "id", "status")} | {
            "text": live.get("text", ""), "tool": live.get("tool", ""), "error": live.get("error", ""),
        }

    def active(self):
        with self.lock:
            rows = [dict(row) for row in self.rows.values()
                    if row.get("id") and row.get("status") not in TERMINAL]
        results = []
        for row in rows:
            found = self.get(row["bot"], row["sessionId"], row["requestId"])
            # Include runs that completed while the phone was away; the caller
            # reads the transcript in the same refresh, so only live ones resume.
            if found["status"] not in TERMINAL:
                results.append(found)
        return results

    def stop(self, bot, session, request):
        row = self.get(bot, session, request)
        self.hermes.stop_run(bot, row["id"])
        return self.get(bot, session, request)
