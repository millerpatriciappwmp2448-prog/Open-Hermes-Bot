"""Stdio MCP adapter that lets one Hermes agent reach the others (stdlib only).

Hermes starts this per profile. Every call goes back to the bridge with the
profile's own token, and the bridge checks the profile's switches each time.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

TARGET = {"type": "string", "minLength": 1, "maxLength": 64, "description": "Agent id from list_agents or list_created."}

TOOLS = {
    "list_agents": (
        "List the other Hermes agents on this server you can message: id, name, tag and description.",
        {},
        [],
        True,
    ),
    "message_agent": (
        "Send a message to another Hermes agent and wait for its reply. The other agent sees that the message comes from you, not from the user.",
        {"agent": TARGET, "message": {"type": "string", "minLength": 1, "maxLength": 4000}},
        ["agent", "message"],
        False,
    ),
    "create_agent": (
        "Create a new Hermes agent that you manage. Give it a clear title and a description of its job.",
        {
            "title": {"type": "string", "minLength": 1, "maxLength": 80},
            "description": {"type": "string", "maxLength": 600},
            "name": {"type": "string", "maxLength": 64, "description": "Optional lowercase id."},
        },
        ["title"],
        False,
    ),
    "list_created": (
        "List the agents you created.",
        {},
        [],
        True,
    ),
    "update_created": (
        "Change the title, description or tag of an agent you created.",
        {
            "agent": TARGET,
            "title": {"type": "string", "maxLength": 80},
            "description": {"type": "string", "maxLength": 600},
            "tag": {"type": "string", "maxLength": 40},
        },
        ["agent"],
        False,
    ),
    "delete_created": (
        "Delete an agent you created. Its conversations go with it.",
        {"agent": TARGET},
        ["agent"],
        False,
    ),
}


def catalog():
    tools = []
    for name, (description, properties, required, read_only) in TOOLS.items():
        tools.append({
            "name": name,
            "description": description,
            "inputSchema": {"type": "object", "properties": properties, "required": required, "additionalProperties": False},
            "annotations": {"readOnlyHint": read_only, "destructiveHint": name == "delete_created", "openWorldHint": False},
        })
    return tools


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def call(url, token, params):
    if not isinstance(params, dict) or params.get("name") not in TOOLS:
        raise ValueError("Unknown agent tool.")
    body = {"name": params["name"], "arguments": params.get("arguments") or {}}
    request = urllib.request.Request(
        url + "/v1/agents/tool",
        method="POST",
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
    )
    try:
        # A message to another agent waits for its whole reply.
        with urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect()).open(request, timeout=310) as response:
            raw = response.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError("The agent tool response was too large.")
        return json.loads(raw)
    except urllib.error.HTTPError as exc:
        try:
            error = json.loads(exc.read(64000)).get("error", {})
            message = error.get("message") or "The agent tool failed."
        except (ValueError, AttributeError):
            message = "The agent tool failed."
        raise ValueError(message) from exc
    except (OSError, urllib.error.URLError) as exc:
        raise ValueError("The Hermes bridge is unavailable; nothing was done.") from exc


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
                result = {
                    "protocolVersion": version if version in ("2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25") else "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "hermes-agents", "version": "1.0.0"},
                }
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
        parser.error("The agent bridge must use a loopback URL.")
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
        sys.stdout.reconfigure(encoding="utf-8")
    serve(args.url.rstrip("/"), Path(args.token_file).read_text(encoding="utf-8").strip(), sys.stdin, sys.stdout)


if __name__ == "__main__":
    main()
