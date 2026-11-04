# Codex Supervisor Implementation Plan

> Execute inline in this session; the user has requested continuing the chosen design.

**Goal:** Supervise an explicitly selected existing desktop Codex chat from Hermes.
**Architecture:** Node companion on the Codex computer; authenticated bridge proxy;
phone UI; server-side Hermes model and TypeSafe semantic checks.
**Tech Stack:** Node 24 built-ins, Python standard library, Expo React Native.
**Spec:** ../specs/2026-11-04-codex-supervisor-design.md

## Global Constraints

- Preserve existing dirty bridge/mobile files and work on the existing feature branch.
- No commits, deployments, model/relay configuration changes or unsolicited chat sends.
- No renderer persistence or provider secrets in phone responses.
- Desktop integration validates its tools and never launches another runtime.
- Execute inline; no subagents.

## Review Focus

- An active 429 retry must never create a duplicate turn.
- Reconnection after an ambiguous send must reconcile rather than resend.
- User pause or a newly arriving turn invalidates in-flight review and retry work.
- Authentication/quota errors and manual stops must not create recovery loops.
- Model or TypeSafe failure must not take down deterministic transport recovery.

### Task 1: Desktop adapter

Create companion/desktop.cjs and companion/tests/desktop.test.cjs.
Expose DesktopClient({pipePath, callerThreadId}).list/read/send and close.
Test fragmented frames, tool contract validation, read mapping, tool errors,
timeouts/connection loss and bounded responses using a real local test socket.
Run node --test companion/tests/desktop.test.cjs red, implement, then green.
Verify a read of the current live chat without sending.

### Task 2: Durable supervisor and model review

Create companion/supervisor.cjs, companion/reviewer.cjs and corresponding tests.
Expose Supervisor({desktop,store,review,clock,random}).start/pause/tick/status.
Persist one watch plus outbox atomically. Test the Review Focus conditions, HTTP
Retry-After dates, repeated failures beyond a fixed retry ceiling and restart.
Review through TypeSafe and Hermes session stream; centralize criteria, validate
all model output, keep deterministic recovery functional without credentials.
Run node --test companion/tests/*.test.cjs red then green for each unit.

### Task 3: Host API and bridge proxy

Create companion/server.cjs, companion/README.md and bridge/hermes_bridge/codex.py.
Expose token-authenticated loopback /status, /threads, /watch and /pause.
Bridge authenticated /v1/codex/* routes forward only these fixed endpoints.
Test auth, disabled/missing config, bounded requests, unknown upstream failures,
and secret omission. Run node and Python suites.

### Task 4: Phone interface

Create mobile/src/screens/CodexSupervisorScreen.tsx and a focused API module.
Add a settings route, following existing styling; select chat, goal, profile/model,
start/pause, status and analysis. Use server data, no localStorage. Verify native
typecheck and navigation/loading/failure behaviour in the existing screen harness.

### Task 5: Final verification

Run all companion tests, Python bridge suite, mobile typecheck, existing mobile
scripts and root npm test. Inspect final diff for persistence/secrets/races.
Start a local companion and verify authenticated live list/read/status; leave no
watch enabled and report any missing model configuration or remote tunnel.
