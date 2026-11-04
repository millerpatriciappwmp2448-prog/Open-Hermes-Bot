# Codex supervision

The user approved unattended continuation of one explicitly selected Codex chat,
including recoverable relay 429 failures, and configurable model-assisted review.
Magpie and Codex login remain Codex's responsibility.

## Connection and ownership

Use the desktop app's local app-tools pipe for list_threads, read_thread and
send_message_to_thread. A new app-server process does not share the desktop's
live runtime. On this Windows installation the desktop pipe works and the daemon
control socket does not. Keep this adapter version-sensitive and fail visibly if
the three required tools disappear. Do not start a second Codex runtime.

A Node 24 companion on the Codex computer is the supervision host. It owns the
watch specification and outbox under ~/.hermes/codex-supervisor, not in a renderer
or localStorage. The bridge proxies authenticated phone requests to its loopback
HTTP service. For a remote Hermes host use an authenticated SSH reverse tunnel;
never bind the companion to a public address. The phone is an interface only.

## Behaviour

The person selects an existing chat, writes the goal, chooses a Hermes profile
and optional model/provider, and starts supervision once. A watch starts at the
latest turn, not at an old historical failure. Poll every 10 seconds; review
changed evidence no more than once per minute. Pausing cancels future actions.
Manual interrupted turns and approval/input waits require the person; no automatic
approval, restart of a user-stopped turn, or alteration of Codex sandbox settings.

Only a failed turn with an explicit recoverable transport error can trigger the
deterministic retry path. An active turn (including Codex's own retries) is left
running. Use Retry-After when exposed; otherwise exponentially back off from 30
seconds to 15 minutes with jitter. There is no retry-count ceiling. Quota/auth
errors require attention. Silence alone is not proof of a stopped task.

Persist pending sends before dispatch, include an opaque action marker in the
visible prompt, reconcile that marker after reconnect/restart, and never blindly
repeat an ambiguously acknowledged send. Re-read live state before every send;
cancel stale decisions if the turn, evidence or watch revision changed.

Model review uses server-side TypeSafe jev-latest for narrow semantic judgments,
then the chosen Hermes profile for evidence, analysis and proposed instructions.
Jev verifies a proposed automatic correction is supported and within the goal.
Centralize criteria and conservative thresholds (0.95 to act; human-required
signal >= 0.5 blocks). Missing credentials/model service disable semantic actions
visibly but do not disable deterministic network recovery. A successful Codex turn
is not itself proof the user's overall goal is complete.

The interface shows observed state, next retry, recent actions, analysis, model
availability, and pause/resume. No status-change notifications for unchanged data.
Do not automatically enable a watch merely by installing or testing the service.

## Alternatives considered

Independent app-server: good for threads it owns, cannot establish desktop live
ownership here. CLI queue: delivery alone does not provide enough live state.
GUI automation: fragile. The verified local desktop pipe is the selected adapter;
it is an experimental desktop integration, with contract validation at connect.

## Verification

Use actual local desktop reads plus simulated transports/model responses for
retry/review tests. Cover active retries, Retry-After, repeated 429s, quota/auth,
manual stop, approval, restart, duplicate/ambiguous delivery, stale decisions and
pause during asynchronous work. Do not manufacture a real relay outage or send
test prompts to unrelated chats. Report simulated versus live evidence separately.
