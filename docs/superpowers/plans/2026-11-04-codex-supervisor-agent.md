# Dedicated Supervisor Agent Implementation Plan

Execute inline; the user explicitly requests the agent itself. No delegation,
commits, deployment or live supervision messages during validation.

**Goal:** Talk to a dedicated Codex supervisor in the normal Hermes chat list.
**Architecture:** Managed Hermes profile and scoped MCP tools; the bridge records
authoritative directives and verifies changes through TypeSafe `jev-latest`;
the existing companion owns the durable watch and retry outbox.
**Spec:** ../specs/2026-11-04-codex-supervisor-agent-design.md

## Review focus

- An unrelated profile using the reserved name must never be overwritten.
- Tool-supplied text or an old user message must not authorize a new watch.
- An ambiguous running chat must not be guessed.
- A lost phone acceptance must not replace a later directive or replay a watch.
- The visible agent's model must reach background review without enabling tools
  on the hidden analysis profile.

## Tasks

1. Add failing bridge tests for managed profiles and directive tools. Implement
   `codex_agent.py`, scoped routes and authoritative durable-turn recording.
   Extend profile staging to configure the new profiles before gateway adoption.
2. Add failing MCP wire tests. Implement stdio `codex_tools.py`, restricted host
   credential and fixed tools. Add a bounded read operation to the companion and
   tests; no generic message sending endpoint.
3. Add failing phone store/screen tests. Provision through `ensureCodexAgent()` on
   connection, preserve capability metadata, show a live status card in its normal
   chat, keep normal model selection and server-backed pin/history.
4. Run companion, bridge, mobile typecheck/scripts and root suite; inspect diff.
   Test actual navigation with a simulated backend. State runtime limitations and
   update README for the dedicated chat entry and setup.
