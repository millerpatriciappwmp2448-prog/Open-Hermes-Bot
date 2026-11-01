"""A Hermes API server small enough to run in a test.

It answers the calls the bridge makes, checks each profile's own key, and
remembers what it was asked so a test can look.
"""

from __future__ import annotations

import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit


class FakeHermes:
    def __init__(self) -> None:
        self.keys = {"default": "key-primary", "nova": "key-nova"}
        self.sessions: dict[str, list[dict]] = {
            "default": [
                {
                    "id": "s-primary-1",
                    "title": "Chief",
                    "message_count": 2,
                    "last_active": 2000,
                    "archived": False,
                }
            ],
            "nova": [
                {
                    "id": "s-nova-1",
                    "title": "Notes",
                    "message_count": 1,
                    "last_active": 1000,
                    "archived": False,
                },
                {
                    # A run of the scheduler: its own source, and the id Hermes gives it.
                    "id": "cron_news01_20261030_090000",
                    "title": "Morning news · 09:00",
                    "message_count": 2,
                    "last_active": 1500,
                    "archived": False,
                    "source": "cron",
                },
                {
                    "id": "s-nova-telegram",
                    "title": "From Telegram",
                    "message_count": 4,
                    "last_active": 900,
                    "archived": False,
                    "source": "telegram",
                },
            ],
        }
        self.cron = True
        self.jobs: dict[str, list[dict]] = {
            "nova": [
                {
                    "id": "news01",
                    "name": "Morning news",
                    "prompt": "Summarise the news",
                    "schedule": {"kind": "cron", "expr": "0 9 * * *", "display": "0 9 * * *"},
                    "schedule_display": "0 9 * * *",
                    "enabled": True,
                    "state": "scheduled",
                    "next_run_at": "2026-10-31T09:00:00+08:00",
                    "last_run_at": "2026-10-30T09:00:00+08:00",
                    "last_status": "ok",
                    "deliver": "local",
                }
            ]
        }
        self.messages = {
            "s-primary-1": [
                {"role": "user", "content": "hello", "timestamp": 1},
                {"role": "assistant", "content": "hi there", "timestamp": 2},
            ],
            # A session whose agent kept a task list: the newest valid
            # todo result counts, the tool error after it does not.
            "s-todo-1": [
                {"role": "user", "content": "ship it", "timestamp": 1},
                {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "c1",
                            "function": {
                                "name": "todo_list",
                                "arguments": json.dumps(
                                    {"todos": [{"id": "1", "content": "Build", "status": "in_progress"}]}
                                ),
                            },
                        }
                    ],
                    "timestamp": 2,
                },
                {
                    "role": "tool",
                    "tool_call_id": "c1",
                    "tool_name": "todo_list",
                    "content": json.dumps(
                        {
                            "todos": [
                                {"id": "1", "content": "Build", "status": "completed"},
                                {"id": "2", "content": "Test", "status": "in_progress"},
                                {"id": "3", "content": "Release", "status": "pending"},
                            ],
                            "revision": 2,
                        }
                    ),
                    "timestamp": 3,
                },
                {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {"id": "c2", "function": {"name": "todo_list", "arguments": "{}"}}
                    ],
                    "timestamp": 4,
                },
                {
                    "role": "tool",
                    "tool_call_id": "c2",
                    "tool_name": "todo_list",
                    "content": json.dumps({"error": "todo store unavailable"}),
                    "timestamp": 5,
                },
            ],
        }
        self.last_turn: dict = {}
        self.calls: list[tuple[str, str, str]] = []
        self._lock = threading.Lock()


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    @property
    def fake(self) -> FakeHermes:
        return self.server.fake  # type: ignore[attr-defined]

    def log_message(self, fmt, *args) -> None:  # noqa: A003
        pass

    # ------------------------------------------------------------ helpers

    def _split(self) -> tuple[str, str]:
        parsed = urlsplit(self.path)
        match = re.match(r"^/p/([^/]+)(/.*)$", parsed.path)
        if match:
            return match.group(1), match.group(2)
        return "default", parsed.path

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            return {}
        return data if isinstance(data, dict) else {}

    def _json(self, status: int, payload: dict) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(raw)
        self.close_connection = True

    def _authorised(self, profile: str) -> bool:
        header = self.headers.get("Authorization") or ""
        expected = self.fake.keys.get(profile)
        return bool(expected) and header == f"Bearer {expected}"

    # ------------------------------------------------------------- routes

    def do_GET(self) -> None:  # noqa: N802
        profile, rest = self._split()
        parsed = urlsplit(self.path)
        self.fake.calls.append(("GET", profile, rest))
        if not self._authorised(profile):
            return self._json(401, {"error": {"message": "Invalid gateway API key"}})

        if rest == "/health/detailed":
            return self._json(200, {"ok": True})

        if rest == "/api/sessions":
            query = parse_qs(parsed.query)
            limit = int((query.get("limit") or ["100"])[0])
            offset = int((query.get("offset") or ["0"])[0])
            source = (query.get("source") or [""])[0]
            rows = [
                row
                for row in self.fake.sessions.get(profile, [])
                if not source or row.get("source", "api_server") == source
            ]
            page = rows[offset : offset + limit]
            return self._json(
                200, {"data": page, "has_more": offset + len(page) < len(rows)}
            )

        if rest == "/api/jobs":
            if not self.fake.cron:
                return self._json(404, {"error": {"message": "no route"}})
            return self._json(200, {"jobs": self.fake.jobs.get(profile, [])})

        match = re.match(r"^/api/sessions/([^/]+)/messages$", rest)
        if match:
            query = parse_qs(parsed.query)
            limit = int((query.get("limit") or ["200"])[0])
            offset = int((query.get("offset") or ["0"])[0])
            rows = self.fake.messages.get(match.group(1), [])
            if (query.get("order") or [""])[0] == "latest":
                # The newest `limit` rows, still oldest first, as Hermes does.
                rows = rows[-limit:] if limit > 0 else []
            else:
                rows = rows[offset:offset + limit]
            return self._json(200, {"data": rows, "pagination": {"returned": len(rows)}})

        if rest == "/api/model/options":
            return self._json(
                200,
                {
                    # The host names its current model with the provider in
                    # front, and calls the provider "auto".
                    "model": "anthropic/sonnet-4.5",
                    "provider": "auto",
                    "providers": [
                        {
                            "slug": "anthropic",
                            "name": "Anthropic",
                            "authenticated": True,
                            "models": [{"id": "sonnet-4.5", "name": "Sonnet 4.5"}],
                        },
                        {
                            "slug": "openai",
                            "name": "OpenAI",
                            "authenticated": False,
                            "models": [{"id": "gpt-x", "name": "GPT X"}],
                        },
                    ],
                },
            )
        return self._json(404, {"error": {"message": "no route"}})

    def do_POST(self) -> None:  # noqa: N802
        profile, rest = self._split()
        self.fake.calls.append(("POST", profile, rest))
        if not self._authorised(profile):
            return self._json(401, {"error": {"message": "Invalid gateway API key"}})

        if rest == "/api/sessions":
            body = self._body()
            title = str(body.get("title") or "")
            with self.fake._lock:
                taken = {row["title"] for row in self.fake.sessions.get(profile, [])}
                if title in taken:
                    return self._json(409, {"detail": "title already in use"})
                session_id = f"s-{profile}-{len(self.fake.sessions.get(profile, [])) + 1}"
                self.fake.sessions.setdefault(profile, []).append(
                    {
                        "id": session_id,
                        "title": title,
                        "message_count": 0,
                        "last_active": int(time.time()),
                        "archived": False,
                    }
                )
            return self._json(201, {"session": {"id": session_id}})

        if rest == "/api/jobs":
            if not self.fake.cron:
                return self._json(404, {"error": {"message": "no route"}})
            body = self._body()
            schedule = str(body.get("schedule") or "")
            if schedule == "whenever":
                return self._json(400, {"error": "Invalid schedule 'whenever'"})
            with self.fake._lock:
                rows = self.fake.jobs.setdefault(profile, [])
                job = {
                    "id": f"job{len(rows) + 1}",
                    "name": body.get("name"),
                    "prompt": body.get("prompt"),
                    "schedule": {"kind": "cron", "expr": schedule, "display": schedule},
                    "schedule_display": schedule,
                    "enabled": True,
                    "state": "scheduled",
                    "deliver": body.get("deliver"),
                    "repeat": {"times": body.get("repeat"), "completed": 0},
                }
                rows.append(job)
            return self._json(200, {"job": job})

        match = re.match(r"^/api/jobs/([^/]+)/(pause|resume|run)$", rest)
        if match:
            if not self.fake.cron:
                return self._json(404, {"error": {"message": "no route"}})
            for job in self.fake.jobs.get(profile, []):
                if job["id"] != match.group(1):
                    continue
                action = match.group(2)
                if action == "pause":
                    job.update(enabled=False, state="paused")
                else:
                    job.update(enabled=True, state="scheduled")
                if action == "run":
                    job["next_run_at"] = "2026-10-31T08:00:00+08:00"
                return self._json(200, {"job": job})
            return self._json(404, {"error": "Job not found"})

        match = re.match(r"^/api/sessions/([^/]+)/chat/stream$", rest)
        if match:
            self.fake.last_turn = {
                "profile": profile,
                "authorization": self.headers.get("Authorization"),
                "body": self._body(),
                "session": match.group(1),
            }
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "close")
            self.end_headers()
            frames = (
                "event: assistant.delta\ndata: {\"delta\": \"Deploy \"}\n\n",
                ": keepalive\n\n",
                "event: tool.started\ndata: {\"tool_name\": \"shell\"}\n\n",
                "event: assistant.delta\ndata: {\"delta\": \"412 is green.\"}\n\n",
                "event: done\ndata: {\"ok\": true}\n\n",
            )
            if match.group(1) == "s-todo-1":
                frames = self._todo_frames()
            for frame in frames:
                self.wfile.write(frame.encode("utf-8"))
                self.wfile.flush()
            self.close_connection = True
            return
        return self._json(404, {"error": {"message": "no route"}})

    @staticmethod
    def _todo_frames() -> tuple[str, ...]:
        """A turn that rewrites the task list, merges into it, then ends."""

        def frame(event: str, data: dict) -> str:
            return f"event: {event}\ndata: {json.dumps(data)}\n\n"

        kept = [
            {"id": "1", "content": "Build", "status": "completed"},
            {"id": "2", "content": "Test", "status": "completed"},
            {"id": "3", "content": "Release", "status": "in_progress"},
        ]
        return (
            frame("run.started", {"run_id": "r1"}),
            frame(
                "tool.started",
                {
                    "tool_name": "todo_list",
                    "args": {
                        "todos": [
                            {"id": "1", "content": "Build", "status": "completed"},
                            {"id": "2", "content": "Test", "status": "pending"},
                            {"id": "3", "content": "Release", "status": "pending"},
                        ]
                    },
                },
            ),
            frame(
                "tool.started",
                {
                    "tool_name": "todo_list",
                    "args": {"todos": [{"id": "2", "status": "in_progress"}], "merge": True},
                },
            ),
            frame("assistant.delta", {"delta": "Releasing."}),
            frame(
                "run.completed",
                {
                    "messages": [
                        {
                            "role": "assistant",
                            "content": "",
                            "tool_calls": [{"id": "c9", "function": {"name": "todo_list", "arguments": "{}"}}],
                        },
                        {
                            "role": "tool",
                            "tool_call_id": "c9",
                            "tool_name": "todo_list",
                            "content": json.dumps({"todos": kept, "revision": 5}),
                        },
                    ]
                },
            ),
            frame("done", {"ok": True}),
        )

    def do_PATCH(self) -> None:  # noqa: N802
        profile, rest = self._split()
        self.fake.calls.append(("PATCH", profile, rest))
        if not self._authorised(profile):
            return self._json(401, {"error": {"message": "Invalid gateway API key"}})
        match = re.match(r"^/api/sessions/([^/]+)$", rest)
        if not match:
            return self._json(404, {"error": {"message": "no route"}})
        body = self._body()
        for row in self.fake.sessions.get(profile, []):
            if row["id"] == match.group(1):
                row["title"] = str(body.get("title") or row["title"])
        return self._json(200, {"ok": True})

    def do_DELETE(self) -> None:  # noqa: N802
        profile, rest = self._split()
        self.fake.calls.append(("DELETE", profile, rest))
        if not self._authorised(profile):
            return self._json(401, {"error": {"message": "Invalid gateway API key"}})
        match = re.match(r"^/api/sessions/([^/]+)$", rest)
        if not match:
            return self._json(404, {"error": {"message": "no route"}})
        self.fake.sessions[profile] = [
            row for row in self.fake.sessions.get(profile, []) if row["id"] != match.group(1)
        ]
        return self._json(200, {"ok": True})


class FakeServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def start() -> tuple[FakeServer, FakeHermes]:
    fake = FakeHermes()
    server = FakeServer(("127.0.0.1", 0), _Handler)
    server.fake = fake  # type: ignore[attr-defined]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, fake
