"""The HTTP surface the phone speaks.

One contract, shaped like the screens: the bots, their conversations, one turn
at a time, and the two things that are bytes rather than words — a file and a
recording. Everything it needs from Hermes, it asks Hermes.
"""

from __future__ import annotations

import json
import logging
import re
import secrets
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from . import __version__, media, prefs, profiles, sections, todos
from .config import Config
from .devices import Devices, Pairing
from .hermes import Hermes, HermesError
from .profiles import BotError
from .monitor import Monitor, gateway_stats
from .turns import Turns
from .codex import CodexCompanion, parse_review, review_prompt, require_analysis_profile
from .codex_agent import CodexAgent
from .agent_permissions import AgentPermissions
from .labeler import Labeler

log = logging.getLogger("hermes_bridge")

MAX_JSON = 2 * 1024 * 1024
PAIR_WINDOW = 300.0
PAIR_ATTEMPTS = 10


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class ClientGone(Exception):
    """The phone hung up mid-answer; stop the upstream and say nothing."""


def param(match: re.Match[str], name: str) -> str:
    return unquote(match.group(name) or "")


class Bridge:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.devices = Devices(config)
        self.pairing = Pairing(config)
        self.hermes = Hermes(config)
        self.turns = Turns(config, self.hermes)
        self.monitor = Monitor(config.hermes_home)
        self.codex = CodexCompanion(config)
        self.codex_agent = CodexAgent(config, self.hermes, self.codex)
        self.codex_review_lock = threading.Lock()
        self.permissions = AgentPermissions(config, self.hermes)
        self.labeler = Labeler(config, self.hermes)
        self.permissions.on_created = lambda profile: self.label_later(profile)

    def label_later(self, profile: str, only_if_auto: bool = True) -> None:
        def work():
            try:
                self.labeler.auto(profile, only_if_auto)
            except Exception:  # noqa: BLE001 - a tag is a nicety
                log.info("tag generation skipped for %s", profile)
        threading.Thread(target=work, daemon=True).start()


ROUTES: list[tuple[str, re.Pattern[str], str, bool]] = [
    # The root is what a person opens in a browser to check the door: a page,
    # not an API answer no one can read.
    ("GET", re.compile(r"^/$"), "_root", True),
    ("GET", re.compile(r"^/v1/health$"), "_health", True),
    ("POST", re.compile(r"^/v1/pair$"), "_pair", True),
    ("GET", re.compile(r"^/v1/bots$"), "_bots", False),
    ("POST", re.compile(r"^/v1/bots$"), "_bot_create", False),
    ("PATCH", re.compile(r"^/v1/bots/(?P<bot>[^/]+)$"), "_bot_update", False),
    ("DELETE", re.compile(r"^/v1/bots/(?P<bot>[^/]+)$"), "_bot_delete", False),
    ("PUT", re.compile(r"^/v1/bots/(?P<bot>[^/]+)/permissions$"), "_bot_permissions", False),
    ("POST", re.compile(r"^/v1/bots/(?P<bot>[^/]+)/tag$"), "_bot_tag", False),
    ("POST", re.compile(r"^/v1/agents/tool$"), "_agent_tool", False),
    ("GET", re.compile(r"^/v1/models$"), "_models", False),
    ("PUT", re.compile(r"^/v1/bots/(?P<bot>[^/]+)/pin$"), "_pin", False),
    ("GET", re.compile(r"^/v1/active-turns$"), "_active_turns", False),
    ("PUT", re.compile(r"^/v1/sessions/(?P<bot>[^/]+)/(?P<session>[^/]+)/turns/(?P<request>[A-Za-z0-9_-]{1,100})$"), "_start_turn", False),
    ("GET", re.compile(r"^/v1/sessions/(?P<bot>[^/]+)/(?P<session>[^/]+)/turns/(?P<request>[A-Za-z0-9_-]{1,100})$"), "_get_turn", False),
    ("POST", re.compile(r"^/v1/sessions/(?P<bot>[^/]+)/(?P<session>[^/]+)/turns/(?P<request>[A-Za-z0-9_-]{1,100})/stop$"), "_stop_turn", False),
    ("GET", re.compile(r"^/v1/monitor$"), "_monitor", False),
    ("GET", re.compile(r"^/v1/codex/(?P<operation>status|threads)$"), "_codex_read", False),
    ("POST", re.compile(r"^/v1/codex/agent$"), "_codex_agent", False),
    ("POST", re.compile(r"^/v1/codex/agent/tool$"), "_codex_agent_tool", False),
    ("POST", re.compile(r"^/v1/codex/(?P<operation>watch|pause)$"), "_codex_write", False),
    ("POST", re.compile(r"^/v1/codex/review$"), "_codex_review", False),
    ("GET", re.compile(r"^/v1/jobs$"), "_jobs", False),
    ("POST", re.compile(r"^/v1/jobs$"), "_job_create", False),
    (
        "POST",
        re.compile(r"^/v1/jobs/(?P<bot>[^/]+)/(?P<job>[^/]+)/(?P<action>pause|resume|run)$"),
        "_job_action",
        False,
    ),
    ("GET", re.compile(r"^/v1/runs$"), "_runs", False),
    ("GET", re.compile(r"^/v1/sessions$"), "_sessions", False),
    ("GET", re.compile(r"^/v1/history$"), "_history", False),
    ("POST", re.compile(r"^/v1/sessions$"), "_session_create", False),
    (
        "GET",
        re.compile(r"^/v1/sessions/(?P<bot>[^/]+)/(?P<session>[^/]+)/messages$"),
        "_messages",
        False,
    ),
    (
        "GET",
        re.compile(r"^/v1/sessions/(?P<bot>[^/]+)/(?P<session>[^/]+)/todos$"),
        "_todos",
        False,
    ),
    (
        "PATCH",
        re.compile(r"^/v1/sessions/(?P<bot>[^/]+)/(?P<session>[^/]+)$"),
        "_session_rename",
        False,
    ),
    (
        "DELETE",
        re.compile(r"^/v1/sessions/(?P<bot>[^/]+)/(?P<session>[^/]+)$"),
        "_session_delete",
        False,
    ),
    (
        "POST",
        re.compile(r"^/v1/sessions/(?P<bot>[^/]+)/(?P<session>[^/]+)/turns$"),
        "_turn",
        False,
    ),
    ("POST", re.compile(r"^/v1/attachments$"), "_attachment", False),
    ("POST", re.compile(r"^/v1/voice$"), "_voice", False),
    ("GET", re.compile(r"^/v1/voice$"), "_voice_status", False),
    ("GET", re.compile(r"^/v1/prefs$"), "_prefs_read", False),
    ("PUT", re.compile(r"^/v1/prefs$"), "_prefs_write", False),
    ("GET", re.compile(r"^/v1/sections$"), "_sections_read", False),
    ("GET", re.compile(r"^/v1/devices$"), "_devices", False),
    ("DELETE", re.compile(r"^/v1/devices/(?P<device>[^/]+)$"), "_device_delete", False),
]


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, config: Config) -> None:
        self.bridge = Bridge(config)
        self._pair_lock = threading.Lock()
        self._pair_tries: dict[str, list[float]] = {}
        super().__init__((config.host, config.port), Handler)

    def start_background(self) -> None:
        def work():
            try:
                self.bridge.permissions.refresh(self.server_address[1])
            except Exception:  # noqa: BLE001 - startup chores never stop serving
                log.info("agent permission refresh skipped\n%s", traceback.format_exc())
            try:
                self.bridge.labeler.backfill()
            except Exception:  # noqa: BLE001
                log.info("tag backfill skipped\n%s", traceback.format_exc())
        threading.Thread(target=work, daemon=True).start()

    def allowed_to_pair(self, address: str) -> bool:
        now = time.monotonic()
        with self._pair_lock:
            tries = [stamp for stamp in self._pair_tries.get(address, []) if now - stamp < PAIR_WINDOW]
            if len(tries) >= PAIR_ATTEMPTS:
                self._pair_tries[address] = tries
                return False
            tries.append(now)
            self._pair_tries[address] = tries
            return True


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = f"hermes-bridge/{__version__}"
    sys_version = ""

    # ----------------------------------------------------------- plumbing

    @property
    def bridge(self) -> Bridge:
        return self.server.bridge  # type: ignore[attr-defined]

    @property
    def config(self) -> Config:
        return self.bridge.config

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003 - stdlib name
        log.debug("%s %s", self.address_string(), fmt % args)

    def do_GET(self) -> None:  # noqa: N802 - stdlib name
        self._dispatch("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._dispatch("POST")

    def do_PUT(self) -> None:  # noqa: N802
        self._dispatch("PUT")

    def do_PATCH(self) -> None:  # noqa: N802
        self._dispatch("PATCH")

    def do_DELETE(self) -> None:  # noqa: N802
        self._dispatch("DELETE")

    def do_OPTIONS(self) -> None:  # noqa: N802
        # The same app also runs in a browser (Expo web). The preflight is the
        # browser's question; the token is still what opens anything.
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header(
            "Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, X-Filename"
        )
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Max-Age", "600")

    def _dispatch(self, method: str) -> None:
        started = time.monotonic()
        parsed = urlsplit(self.path)
        path = parsed.path
        if len(path) > 1:
            path = path.rstrip("/")
        query = parse_qs(parsed.query)
        self.streaming = False
        status = 500
        try:
            for route_method, pattern, name, public in ROUTES:
                if route_method != method:
                    continue
                match = pattern.match(path)
                if not match:
                    continue
                if not public:
                    token = self._bearer()
                    self.agent_caller = ""
                    if name == "_codex_agent_tool":
                        authorized = self.bridge.codex_agent.authorized(token)
                    elif name == "_agent_tool":
                        self.agent_caller = self.bridge.permissions.caller(token) if token else ""
                        authorized = bool(self.agent_caller)
                    else:
                        authorized = self.bridge.devices.verify(token)
                    if not token or not authorized:
                        raise ApiError(
                            401,
                            "unauthorized",
                            "This device is not paired with the bridge. Pair it in Setup.",
                        )
                handler = getattr(self, name)
                status = handler(match, query) or 200
                return
            raise ApiError(404, "not_found", f"No route for {method} {path}")
        except ApiError as exc:
            status = self._error(exc.status, exc.code, exc.message)
        except HermesError as exc:
            status = self._error(exc.status, exc.code, exc.message)
        except BotError as exc:
            status = self._error(exc.status, exc.code, exc.message)
        except media.MediaError as exc:
            status = self._error(exc.status, exc.code, exc.message)
        except ClientGone:
            status = 499
        except (BrokenPipeError, ConnectionResetError):
            status = 499
        except Exception:  # noqa: BLE001 - a last resort, never a leak
            log.error("unhandled on %s %s\n%s", method, path, traceback.format_exc())
            try:
                status = self._error(500, "internal", "The bridge failed to answer.")
            except OSError:
                status = 500
        finally:
            log.info(
                "%s %s %s %dms",
                method,
                path,
                getattr(self, "_status", status),
                int((time.monotonic() - started) * 1000),
            )

    def _bearer(self) -> str:
        header = self.headers.get("Authorization") or ""
        if header.lower().startswith("bearer "):
            return header[7:].strip()
        return ""

    def _json(self, status: int, payload: dict) -> int:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(raw)
        self.wfile.flush()
        self.close_connection = True
        self._status = status
        return status

    def _error(self, status: int, code: str, message: str) -> int:
        if self.streaming:
            # The headers are gone; the only honest thing left is an event.
            try:
                self._sse("error", {"code": code, "message": message})
            except ClientGone:
                pass
            return status
        return self._json(status, {"error": {"code": code, "message": message}})

    # ------------------------------------------------------------- bodies

    def _length(self) -> int:
        raw = self.headers.get("Content-Length")
        try:
            return max(0, int(raw or 0))
        except ValueError:
            raise ApiError(400, "bad_length", "The request has no usable length.")

    def _json_body(self) -> dict:
        length = self._length()
        if length == 0:
            return {}
        if length > MAX_JSON:
            raise ApiError(413, "too_large", "That request is too large.")
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise ApiError(400, "bad_json", "That request was not JSON.")
        if not isinstance(payload, dict):
            raise ApiError(400, "bad_json", "That request was not a JSON object.")
        return payload

    def _raw_body(self) -> bytes:
        length = self._length()
        if length <= 0:
            raise ApiError(400, "empty", "Nothing was sent.")
        if length > self.config.max_upload_bytes:
            raise ApiError(
                413,
                "too_large",
                f"The file is larger than {self.config.max_upload_bytes // (1024 * 1024)} MB.",
            )
        return self.rfile.read(length)

    # --------------------------------------------------------------- sse

    def _sse_start(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("X-Accel-Buffering", "no")
        self._cors()
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        self.streaming = True
        self._status = 200
        self._write_sse(": connected\n\n")

    def _write_sse(self, text: str) -> None:
        try:
            self.wfile.write(text.encode("utf-8"))
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError) as exc:
            raise ClientGone() from exc

    def _sse(self, event: str, data: dict) -> None:
        self._write_sse(f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n")

    # ------------------------------------------------------------- health

    def _root(self, match, query) -> int:
        health = self.bridge.hermes.health()
        pairing = self.bridge.pairing.status()
        state = "Hermes is answering." if health["ok"] else "Hermes is not answering."
        tone = "#4f9d8f" if health["ok"] else "#e09248"
        hint = (
            "A pairing code is waiting for a phone."
            if pairing["pending"]
            else "No pairing code is waiting: mint one on the host with "
            "<code>python3 -m hermes_bridge pair</code>."
        )
        body = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hermes Bridge</title>
<style>
  :root {{ color-scheme: dark }}
  body {{ margin: 0; min-height: 100vh; display: grid; place-items: center;
          background: #0f0f11; color: #e8e8ec;
          font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif }}
  main {{ padding: 32px 24px; max-width: 30rem }}
  h1 {{ margin: 0 0 6px; font-size: 1.35rem; letter-spacing: -0.02em }}
  .state {{ margin: 18px 0 6px; font-weight: 600; color: {tone} }}
  p {{ margin: 6px 0; color: #9d9da4 }}
  code {{ background: #1b1b1d; padding: 1px 5px; border-radius: 4px; color: #e8e8ec }}
  a {{ color: #8fb8ff }}
</style>
</head>
<body>
<main>
  <h1>Hermes Bridge</h1>
  <p>Version {__version__} — the door between a phone and Hermes.</p>
  <p class="state">{state}</p>
  <p>{hint}</p>
  <p>Machine-readable: <a href="/v1/health">/v1/health</a>.</p>
</main>
</body>
</html>
"""
        raw = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(raw)
        self.wfile.flush()
        self.close_connection = True
        self._status = 200
        return 200

    def _health(self, match, query) -> int:
        hermes = self.bridge.hermes.health()
        return self._json(
            200,
            {
                "ok": True,
                "service": "hermes-bridge",
                "version": __version__,
                "hermes": hermes,
                "pairing": {
                    "required": self.bridge.devices.count() == 0,
                    **self.bridge.pairing.status(),
                },
                "time": int(time.time()),
            },
        )

    def _pair(self, match, query) -> int:
        if not self.server.allowed_to_pair(self.client_address[0]):  # type: ignore[attr-defined]
            raise ApiError(429, "too_many", "Too many attempts. Wait a few minutes, then try again.")
        body = self._json_body()
        code = str(body.get("code") or "")
        name = str(body.get("name") or "iPhone")
        if not self.bridge.pairing.redeem(code):
            raise ApiError(401, "bad_code", "That code is wrong or has expired.")
        minted = self.bridge.devices.add(name)
        log.info("paired a new device: %s", minted["device"]["name"])
        return self._json(201, minted)

    # --------------------------------------------------------------- bots

    def _bots(self, match, query) -> int:
        return self._json(200, {"bots": profiles.list_bots(self.config)})

    def _bot_create(self, match, query) -> int:
        body = self._json_body()
        chosen_model = body.get("model")
        if chosen_model is not None:
            if not isinstance(chosen_model, dict):
                raise BotError(400, "bad_model", "A model choice must include a model and provider.")
            model_name = str(chosen_model.get("model") or "").strip()[:240]
            provider = str(chosen_model.get("provider") or "").strip()[:120]
            if not model_name:
                raise BotError(400, "bad_model", "A model choice must include a model and provider.")
        else:
            model_name = ""
            provider = ""
        bot = profiles.create_bot(
            self.config,
            name=str(body.get("name") or ""),
            title=str(body.get("title") or ""),
            color=str(body.get("color") or ""),
            shape=str(body.get("shape") or ""),
            description=str(body.get("description") or ""),
            soul_role=body.get("soul") is True,
            tag=str(body.get("tag") or ""),
        )
        if model_name:
            current_prefs = prefs.read(self.config)
            picks = current_prefs.get("picks") if isinstance(current_prefs.get("picks"), dict) else {}
            picks[bot["profile"]] = {"model": model_name, "provider": provider}
            current_prefs["picks"] = picks
            prefs.write(self.config, current_prefs)
        if not bot.get("tag") and (str(body.get("description") or "").strip()):
            self.bridge.label_later(profiles.profile_of(bot["id"]))
        return self._json(201, {"bot": bot})

    def _bot_update(self, match, query) -> int:
        body = self._json_body()
        bot = profiles.update_bot(self.config, param(match, "bot"), body)
        if "description" in body and "tag" not in body:
            profile = profiles.profile_of(bot["id"])
            meta = profiles.read_meta(self.config, profile)
            if not meta["tag"] or meta["tag_auto"]:
                if str(body.get("description") or "").strip():
                    self.bridge.label_later(profile)
                elif meta["tag"]:
                    profiles.write_meta(self.config, profile, {"tag": ""})
                    bot = profiles.get_bot(self.config, bot["id"])
        return self._json(200, {"bot": bot})

    def _bot_delete(self, match, query) -> int:
        bot_id = param(match, "bot")
        gone = profiles.delete_bot(self.config, bot_id)
        self.bridge.permissions.forget(profiles.profile_of(bot_id))
        return self._json(200, gone)

    def _bot_permissions(self, match, query) -> int:
        bot = profiles.get_bot(self.config, param(match, "bot"))
        body = self._json_body()
        values = {key: body[key] for key in ("crossSpace", "manageCreated") if key in body}
        if not values or any(not isinstance(value, bool) for value in values.values()):
            raise ApiError(400, "bad_permissions", "Send crossSpace or manageCreated as true or false.")
        granted = self.bridge.permissions.set(profiles.profile_of(bot["id"]), values, self.server.server_address[1])
        return self._json(200, {"permissions": granted, "bot": profiles.get_bot(self.config, bot["id"])})

    def _bot_tag(self, match, query) -> int:
        bot = profiles.get_bot(self.config, param(match, "bot"))
        profile = profiles.profile_of(bot["id"])
        body = self._json_body()
        if body.get("auto") is True:
            self.bridge.labeler.auto(profile, body.get("onlyIfAuto") is True)
        elif "tag" in body:
            profiles.update_bot(self.config, bot["id"], {"tag": str(body.get("tag") or "")})
        else:
            raise ApiError(400, "bad_tag", "Send a tag, or auto: true.")
        return self._json(200, {"bot": profiles.get_bot(self.config, bot["id"])})

    def _agent_tool(self, match, query) -> int:
        body = self._json_body()
        name, args = body.get("name"), body.get("arguments")
        if not isinstance(name, str):
            raise ApiError(400, "bad_tool", "A tool call needs a name.")
        return self._json(200, {"result": self.bridge.permissions.tool(self.agent_caller, name, args or {})})

    # ------------------------------------------------------------- models

    def _models(self, match, query) -> int:
        bot_id = (query.get("bot") or [profiles.PRIMARY])[0]
        profiles.get_bot(self.config, bot_id)
        return self._json(
            200, {"bot": bot_id, "models": self.bridge.hermes.models(profiles.profile_of(bot_id))}
        )

    def _monitor(self, match, query) -> int:
        resources = self.bridge.monitor.snapshot()
        try:
            gateway = gateway_stats(self.bridge.hermes.detailed_health())
        except HermesError as exc:
            # Keep usable host measurements if an older gateway lacks this endpoint.
            code = "unsupported" if exc.status in (404, 405, 501) else "unavailable"
            gateway = {"available": False, "error": code}
        return self._json(200, {"resources": resources, "gateway": gateway})

    def _codex_read(self, match, query) -> int:
        return self._json(200, self.bridge.codex.call('GET', '/' + param(match, 'operation')))

    def _codex_agent(self, match, query) -> int:
        port = self.server.server_address[1]
        bot = self.bridge.codex_agent.ensure(f"http://127.0.0.1:{port}")
        return self._json(200, {"bot": bot})

    def _codex_agent_tool(self, match, query) -> int:
        body = self._json_body()
        name, args = body.get("name"), body.get("arguments")
        conversation = []
        if isinstance(args, dict) and "directiveId" in args:
            try:
                directive = self.bridge.codex_agent._current(args["directiveId"])
                if directive.get("session"):
                    page = self.bridge.hermes.message_page(directive["bot"], directive["session"], limit=8, offset=0)
                    messages = page.get("messages", [])
                    # Keep only user and assistant messages for context
                    conversation = [{"role": msg["role"], "content": msg["content"]}
                                    for msg in messages if msg["role"] in ("user", "assistant")]
            except Exception:
                # Conversation loading is advisory; do not fail the tool call.
                pass
        return self._json(200, self.bridge.codex_agent.tool(name, args, conversation))

    def _codex_write(self, match, query) -> int:
        body = self._json_body()
        operation = param(match, 'operation')
        if operation == 'watch':
            profile = body.get('profile')
            if not isinstance(profile, str):
                raise ApiError(400, 'bad_watch', 'Choose a Hermes review agent.')
            profiles.get_bot(self.config, profile)
        return self._json(200, self.bridge.codex.call('POST', '/' + operation, body))

    def _codex_review(self, match, query) -> int:
        body = self._json_body()
        spec, evidence = body.get('spec'), body.get('evidence')
        if not isinstance(spec, dict) or not isinstance(evidence, dict) or len(json.dumps(body)) > 64000:
            raise ApiError(400, 'bad_watch', 'Send a bounded goal and recent evidence.')
        profile = spec.get('profile')
        if not isinstance(profile, str) or not isinstance(spec.get('goal'), str) or not 1 <= len(spec['goal']) <= 8000:
            raise ApiError(400, 'bad_watch', 'Choose a Hermes review agent and a goal.')
        profiles.get_bot(self.config, profile)
        profile = self.bridge.codex_agent.review_profile(profile)
        model, provider = spec.get('model') or '', spec.get('provider') or ''
        if not isinstance(model, str) or len(model) > 240 or not isinstance(provider, str) or len(provider) > 120:
            raise ApiError(400, 'bad_watch', 'Choose a valid model and provider.')
        if not self.bridge.codex_review_lock.acquire(blocking=False):
            raise ApiError(409, 'codex_review_busy', 'Another supervision review is running.')
        try:
            require_analysis_profile(self.config, profile)
            self.bridge.hermes.require_analysis_tools(profile)
            # Each assessment has a fresh session so previous evidence cannot
            # masquerade as the currently observed turn.
            session = self.bridge.hermes.create_session(profile, 'Codex supervision review')
            stream = self.bridge.hermes.stream_turn(profile, session['id'], review_prompt(spec, evidence), model, provider)
            text = ''
            try:
                for event, data in stream:
                    if event == 'assistant.delta' and isinstance(data.get('delta'), str):
                        text += data['delta']
                    elif event == 'assistant.completed' and not text:
                        final = data.get('text') or data.get('content')
                        if not isinstance(final, str) and isinstance(data.get('message'), dict):
                            final = data['message'].get('content')
                        if isinstance(final, str):
                            text = final
                    elif event in ('error', 'run.failed', 'run.cancelled'):
                        raise HermesError(502, 'codex_review_failed', 'The supervision model could not complete its review.')
                    elif event == 'tool.started':
                        raise HermesError(502, 'codex_review_failed', 'The review agent attempted a tool action; use an agent configured for analysis only.')
                    if len(text) > 16000:
                        raise HermesError(502, 'codex_review_failed', 'The supervision review was too large.')
                    if event == 'done':
                        break
            finally:
                stream.close()
            return self._json(200, parse_review(text))
        finally:
            self.bridge.codex_review_lock.release()

    # ------------------------------------------------------------- schedules

    @staticmethod
    def _cron_missing(exc: HermesError) -> ApiError | None:
        if exc.status in (404, 405, 501):
            return ApiError(
                501,
                "no_cron",
                "This Hermes gateway does not serve scheduled jobs. Update Hermes and "
                "keep the gateway running with cron enabled.",
            )
        return None

    def _jobs(self, match, query) -> int:
        bot_id = (query.get("bot") or [profiles.PRIMARY])[0]
        profiles.get_bot(self.config, bot_id)
        try:
            jobs = self.bridge.hermes.jobs(profiles.profile_of(bot_id))
        except HermesError as exc:
            raise self._cron_missing(exc) or exc
        return self._json(200, {"bot": bot_id, "jobs": jobs})

    def _job_create(self, match, query) -> int:
        body = self._json_body()
        bot_id = str(body.get("bot") or profiles.PRIMARY)
        profiles.get_bot(self.config, bot_id)
        name = str(body.get("name") or "").strip()
        schedule = str(body.get("schedule") or "").strip()
        prompt = str(body.get("prompt") or "").strip()
        deliver = str(body.get("deliver") or "local").strip() or "local"
        if not name or len(name) > 200:
            raise ApiError(400, "bad_schedule", "A schedule needs a name of up to 200 characters.")
        if not schedule or len(schedule) > 200:
            raise ApiError(400, "bad_schedule", "A schedule needs a time: a cron expression, an interval or a date.")
        if not prompt or len(prompt) > 5000:
            raise ApiError(400, "bad_schedule", "Say what the bot should do, in up to 5000 characters.")
        if len(deliver) > 200 or any(ch in deliver for ch in "\r\n"):
            raise ApiError(400, "bad_schedule", "That delivery target is not valid.")
        job = {"name": name, "schedule": schedule, "prompt": prompt, "deliver": deliver}
        repeat = body.get("repeat")
        if repeat is not None:
            if isinstance(repeat, bool) or not isinstance(repeat, int) or not 1 <= repeat <= 10000:
                raise ApiError(400, "bad_schedule", "Repeat is a whole number of runs, 1 or more.")
            job["repeat"] = repeat
        try:
            created = self.bridge.hermes.create_job(profiles.profile_of(bot_id), job)
        except HermesError as exc:
            if exc.status == 400:
                raise ApiError(400, "bad_schedule", exc.message) from exc
            raise self._cron_missing(exc) or exc
        return self._json(201, {"bot": bot_id, "job": created})

    def _job_action(self, match, query) -> int:
        bot_id = param(match, "bot")
        profiles.get_bot(self.config, bot_id)
        job_id = param(match, "job").strip()
        if not job_id or len(job_id) > 200:
            raise ApiError(400, "no_job", "A schedule needs an id.")
        try:
            job = self.bridge.hermes.job_action(
                profiles.profile_of(bot_id), job_id, match.group("action")
            )
        except HermesError as exc:
            if exc.status == 404:
                raise ApiError(404, "no_job", "That schedule is gone from the host.") from exc
            raise self._cron_missing(exc) or exc
        return self._json(200, {"bot": bot_id, "job": job})

    def _runs(self, match, query) -> int:
        bot_id = (query.get("bot") or [profiles.PRIMARY])[0]
        profiles.get_bot(self.config, bot_id)
        rows = self.bridge.hermes.runs(profiles.profile_of(bot_id))
        rows.sort(key=lambda row: row["lastActive"], reverse=True)
        return self._json(200, {"bot": bot_id, "runs": rows[:100]})

    # ----------------------------------------------------------- sessions

    @staticmethod
    def _page_number(query, key: str, default: int, minimum: int, maximum: int) -> int:
        try:
            value = int((query.get(key) or [str(default)])[0])
        except ValueError:
            raise ApiError(400, "bad_pagination", "Invalid pagination.")
        if not minimum <= value <= maximum:
            raise ApiError(400, "bad_pagination", "Pagination is out of range.")
        return value

    def _history(self, match, query) -> int:
        bot_id = (query.get("bot") or [profiles.PRIMARY])[0]
        profiles.get_bot(self.config, bot_id)
        limit = self._page_number(query, "limit", 50, 1, 100)
        offset = self._page_number(query, "offset", 0, 0, 1000000)
        page = self.bridge.hermes.history(profiles.profile_of(bot_id), limit, offset)
        self.bridge.permissions.mark(page["sessions"])
        return self._json(200, page)

    def _sessions(self, match, query) -> int:
        wanted = (query.get("bot") or [""])[0]
        bots = [profiles.get_bot(self.config, wanted)] if wanted else profiles.list_bots(self.config)
        errors = []

        def fetch(bot: dict) -> list[dict]:
            try:
                return self.bridge.hermes.sessions(bot["id"])
            except HermesError as exc:
                errors.append({"bot": bot["id"], "code": exc.code, "message": exc.message})
                return []

        with ThreadPoolExecutor(max_workers=max(1, min(4, len(bots)))) as pool:
            rows = [row for batch in pool.map(fetch, bots) for row in batch]
        rows.sort(key=lambda row: row["lastActive"], reverse=True)
        # Conversations another agent opened stay listed but are labelled, so
        # the phone never takes one for the bot's own chat.
        self.bridge.permissions.mark(rows)
        return self._json(200, {"sessions": rows, "errors": errors})

    def _session_create(self, match, query) -> int:
        body = self._json_body()
        bot_id = str(body.get("bot") or profiles.PRIMARY)
        bot = profiles.get_bot(self.config, bot_id)
        title = str(body.get("title") or "New conversation").strip()[:120] or "New conversation"
        created = self.bridge.hermes.create_session(profiles.profile_of(bot["id"]), title)
        return self._json(
            201,
            {
                "session": {
                    "bot": bot["id"],
                    "id": created["id"],
                    "title": created["title"],
                    "messageCount": 0,
                    "lastActive": int(time.time()),
                    "archived": False,
                }
            },
        )

    def _session_rename(self, match, query) -> int:
        bot_id = param(match, "bot")
        profiles.get_bot(self.config, bot_id)
        body = self._json_body()
        title = str(body.get("title") or "").strip()[:120]
        if not title:
            raise ApiError(400, "no_title", "A conversation needs a name.")
        self.bridge.hermes.rename_session(
            profiles.profile_of(bot_id), param(match, "session"), title
        )
        return self._json(200, {"ok": True, "title": title})

    def _session_delete(self, match, query) -> int:
        bot_id = param(match, "bot")
        profiles.get_bot(self.config, bot_id)
        self.bridge.hermes.delete_session(
            profiles.profile_of(bot_id), param(match, "session")
        )
        return self._json(200, {"ok": True})

    def _messages(self, match, query) -> int:
        bot_id = param(match, "bot")
        profiles.get_bot(self.config, bot_id)
        try:
            limit = int((query.get("limit") or ["200"])[0])
        except ValueError:
            limit = 200
        limit = min(max(limit, 1), 500)
        offset = self._page_number(query, "offset", 0, 0, 1000000)
        page = self.bridge.hermes.message_page(
            profiles.profile_of(bot_id), param(match, "session"), limit, offset
        )
        return self._json(200, page)

    def _todos(self, match, query) -> int:
        bot_id = param(match, "bot")
        profiles.get_bot(self.config, bot_id)
        found = self.bridge.hermes.latest_todos(
            profiles.profile_of(bot_id), param(match, "session")
        )
        return self._json(200, found or {"todos": [], "revision": 0})

    # -------------------------------------------------------------- turns

    def _start_turn(self, match, query):
        bot = param(match, "bot")
        profiles.get_bot(self.config, bot)
        body = self._json_body()
        message = str(body.get("message") or "")
        if not message.strip():
            raise ApiError(400, "empty_message", "An empty message is not a turn.")
        session, request = param(match, "session"), param(match, "request")
        model, provider = str(body.get("model") or "")[:200], str(body.get("provider") or "")[:80]
        directive = self.bridge.codex_agent.accept(bot, session, request, message, model, provider)
        instructions = self.bridge.codex_agent.instructions(directive) if directive else ""
        instructions = "\n\n".join(part for part in (instructions, self.bridge.permissions.instructions(profiles.profile_of(bot))) if part)
        run = self.bridge.turns.start(bot, session, request, message, model, provider, instructions=instructions)
        return self._json(202, {"run": run})

    def _get_turn(self, match, query):
        bot = param(match, "bot")
        profiles.get_bot(self.config, bot)
        return self._json(200, {"run": self.bridge.turns.get(bot, param(match, "session"), param(match, "request"))})

    def _active_turns(self, match, query):
        return self._json(200, {"runs": self.bridge.turns.active()})

    def _stop_turn(self, match, query):
        bot = param(match, "bot")
        profiles.get_bot(self.config, bot)
        return self._json(200, {"run": self.bridge.turns.stop(bot, param(match, "session"), param(match, "request"))})

    def _pin(self, match, query):
        bot = param(match, "bot")
        profiles.get_bot(self.config, bot)
        body = self._json_body()
        if not isinstance(body.get("pinned"), bool):
            raise ApiError(400, "bad_prefs", "Pinned must be a boolean.")
        return self._json(200, {"prefs": prefs.pin(self.config, bot, body["pinned"])})

    def _turn(self, match, query) -> int:
        bot_id = param(match, "bot")
        session_id = param(match, "session")
        bot = profiles.get_bot(self.config, bot_id)
        profile = profiles.profile_of(bot["id"])
        body = self._json_body()
        message = str(body.get("message") or "")
        if not message.strip():
            raise ApiError(400, "empty_message", "An empty message is not a turn.")
        model = str(body.get("model") or "").strip()[:200]
        provider = str(body.get("provider") or "").strip()[:80]
        directive = self.bridge.codex_agent.accept(bot_id, session_id, "legacy-" + secrets.token_hex(16), message, model, provider)
        instructions = self.bridge.codex_agent.instructions(directive) if directive else ""
        instructions = "\n\n".join(part for part in (instructions, self.bridge.permissions.instructions(profile)) if part)
        if not self.bridge.hermes.key_for(profile):
            raise ApiError(
                409,
                "no_key",
                f"{bot['name']} has no API key yet — set API_SERVER_KEY in "
                f"{self.config.profile_env(profile)} and restart the Hermes gateway.",
            )

        self._sse_start()
        text = ""
        failure = ""
        # The task list the phone shows above the composer. A todo call's
        # arguments say what it is about to write; the result at the end of
        # the run is what Hermes kept, and wins.
        todos_known: list | None = None
        todos_sent: list | None = None

        def send_todos(items: list | None, revision: int | None = None) -> None:
            nonlocal todos_sent
            if items is None or items == todos_sent:
                return
            todos_sent = items
            payload: dict = {"todos": items}
            if revision is not None:
                payload["revision"] = revision
            self._sse("todos", payload)

        options = {"instructions": instructions} if instructions else {}
        stream = self.bridge.hermes.stream_turn(profile, session_id, message, model, provider, **options)
        try:
            for event, data in stream:
                if event == "assistant.delta" and data.get("delta"):
                    text += str(data["delta"])
                    self._sse("delta", {"text": str(data["delta"])})
                elif event == "tool.started" and data.get("tool_name"):
                    self._sse("tool", {"tool": str(data["tool_name"])})
                    args = todos.call_arguments(data.get("tool_name"), data.get("args"))
                    if args is not None and isinstance(args.get("todos"), list):
                        if args.get("merge") and todos_known is None:
                            try:
                                found = self.bridge.hermes.latest_todos(profile, session_id)
                            except HermesError:
                                found = None
                            todos_known = found["todos"] if found else []
                        predicted = todos.expected(todos_known, args)
                        if predicted is not None:
                            todos_known = predicted
                            send_todos(predicted)
                elif event == "keepalive":
                    self._write_sse(": keepalive\n\n")
                elif event == "assistant.completed":
                    final = data.get("text")
                    if not isinstance(final, str):
                        final = data.get("content")
                    content = data.get("message")
                    if not isinstance(final, str) and isinstance(content, dict):
                        final = content.get("content")
                    if isinstance(final, str) and final and not text:
                        text = final
                elif event in ("run.completed", "run.failed", "run.cancelled"):
                    rows = data.get("messages")
                    found = todos.latest(rows) if isinstance(rows, list) else None
                    if found is not None:
                        todos_known = found["todos"]
                        send_todos(found["todos"], found["revision"])
                    if event == "run.failed":
                        failure = failure or "The bot could not finish this turn."
                elif event == "error":
                    failure = str(data.get("message") or "The bot stopped before answering.")
                elif event == "done":
                    break
        except HermesError as exc:
            self._sse("error", {"code": exc.code, "message": exc.message})
            return 200
        finally:
            # Closing the upstream is how Hermes is told to stop the run when
            # the phone has already gone.
            stream.close()
        if failure:
            self._sse("error", {"code": "turn_failed", "message": failure})
            return 200
        self._sse("done", {"text": text, "sessionId": session_id})
        return 200

    # -------------------------------------------------------- bytes, both

    def _attachment(self, match, query) -> int:
        data = self._raw_body()
        filename = (query.get("filename") or [""])[0] or self.headers.get("X-Filename") or "file"
        mime = (self.headers.get("Content-Type") or "application/octet-stream").split(";")[0]
        saved = media.save_upload(self.config, filename, mime, data)
        return self._json(201, saved)

    def _voice(self, match, query) -> int:
        mime = (self.headers.get("Content-Type") or "audio/mp4").split(";")[0].strip().lower()
        if mime not in media.AUDIO_TYPES:
            raise ApiError(415, "bad_audio", "Select a supported audio recording.")
        data = self._raw_body()
        saved = media.save_upload(self.config, f"voice.{media.audio_extension(mime)}", mime, data)
        path = Path(saved["path"])
        try:
            transcript = media.transcribe(self.config, path)
        finally:
            path.unlink(missing_ok=True)
        return self._json(200, {"transcript": transcript})

    def _voice_status(self, match, query) -> int:
        return self._json(200, media.voice_status(self.config))

    # ------------------------------------------------------------- prefs

    def _prefs_read(self, match, query) -> int:
        return self._json(200, {"prefs": prefs.read(self.config)})

    def _prefs_write(self, match, query) -> int:
        body = self._json_body()
        value = body.get("prefs")
        if not isinstance(value, dict):
            raise ApiError(400, "bad_prefs", "Preferences are a JSON object.")
        prefs.write(self.config, value)
        return self._json(200, {"prefs": prefs.read(self.config)})

    def _sections_read(self, match, query) -> int:
        return self._json(200, sections.read_inbox(self.config))

    # ----------------------------------------------------------- devices

    def _devices(self, match, query) -> int:
        return self._json(200, {"devices": self.bridge.devices.list()})

    def _device_delete(self, match, query) -> int:
        if not self.bridge.devices.remove(param(match, "device")):
            raise ApiError(404, "no_device", "No device with that id.")
        return self._json(200, {"ok": True})
