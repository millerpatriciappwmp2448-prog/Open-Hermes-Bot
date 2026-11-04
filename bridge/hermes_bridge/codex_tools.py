"""Stdio MCP adapter for the dedicated Hermes supervisor (stdlib only)."""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DESCRIPTIONS = {
    "context": "Read the latest actual user directive, desktop chats and current watch/review status. Call first.",
    "read_chat": "Read recent bounded evidence from one existing Codex chat, including active work. No changes.",
    "watch": "Start/update ongoing supervision of the selected existing Codex chat with the user's goal. Includes automatic recovery and model review. Clear requests act immediately.",
    "pause": "Pause supervision only. Does not stop Codex or the currently running work.",
    "resume": "Resume the saved supervision target and goal using this agent's selected model.",
}


def catalog():
    tools = []
    for name, description in DESCRIPTIONS.items():
        properties = {"directiveId": {"type": "string", "description": "Exact directiveId from the current trusted run instructions."}}
        if name in ("read_chat", "watch"):
            properties["threadId"] = {"type": "string", "description": "Exact chat ID from context; never guess an ambiguous target."}
        if name == "watch":
            properties["goal"] = {"type": "string", "minLength": 1, "maxLength": 8000, "description": "The actual user's supervision goal and completion checks."}
        tools.append({"name": name, "description": description,
            "inputSchema": {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False},
            "annotations": {"readOnlyHint": name in ("context", "read_chat"), "destructiveHint": False, "openWorldHint": False}})
    return tools


def call(url, token, params):
    if not isinstance(params, dict) or params.get("name") not in DESCRIPTIONS:
        raise ValueError("Unknown supervision tool.")
    request = urllib.request.Request(url + "/v1/codex/agent/tool", method="POST",
        data=json.dumps(params).encode("utf-8"), headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=75) as response:
            raw = response.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError("Supervision response was too large.")
        return json.loads(raw)
    except urllib.error.HTTPError as exc:
        try:
            error = json.loads(exc.read(64000)).get("error", {})
            message = error.get("message") or "The supervision operation failed."
        except (ValueError, AttributeError):
            message = "The supervision operation failed."
        raise ValueError(message) from exc
    except (OSError, urllib.error.URLError) as exc:
        raise ValueError("The Hermes supervisor bridge is unavailable; no success is confirmed.") from exc


def serve(url, token, source, sink):
    for line in source:
        request_id = None
        try:
            if len(line) > 64000:
                raise ValueError("MCP request is too large.")
            message = json.loads(line)
            request_id = message.get("id")
            method = message.get("method")
            if request_id is None:
                continue
            params = message.get("params") or {}
            if method == "initialize":
                version = params.get("protocolVersion")
                result = {"protocolVersion": version if version in ("2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25") else "2024-11-05",
                          "capabilities": {"tools": {}}, "serverInfo": {"name": "hermes-codex-supervisor", "version": "1.0.0"}}
            elif method == "ping":
                result = {}
            elif method == "tools/list":
                result = {"tools": catalog()}
            elif method == "tools/call":
                try:
                    value = call(url, token, params)
                    result = {"content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False)}]}
                except ValueError as exc:
                    result = {"isError": True, "content": [{"type": "text", "text": str(exc)}]}
            else:
                sink.write(json.dumps({"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": "Method not found"}}) + "\n")
                sink.flush()
                continue
            reply = {"jsonrpc": "2.0", "id": request_id, "result": result}
        except (ValueError, TypeError, AttributeError):
            reply = {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32600, "message": "Invalid MCP request"}}
        sink.write(json.dumps(reply, ensure_ascii=False) + "\n")
        sink.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--token-file", required=True)
    args = parser.parse_args()
    parsed = urllib.parse.urlsplit(args.url)
    if parsed.scheme != "http" or parsed.hostname not in ("localhost", "127.0.0.1", "::1") or parsed.username or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        parser.error("The supervisor bridge must use a loopback URL.")
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
        sys.stdout.reconfigure(encoding="utf-8")
    serve(args.url.rstrip("/"), Path(args.token_file).read_text(encoding="utf-8").strip(), sys.stdin, sys.stdout)


if __name__ == "__main__":
    main()
