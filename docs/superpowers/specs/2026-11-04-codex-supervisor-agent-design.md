# Dedicated Codex supervisor agent

The user's correction is explicit: this is a dedicated agent in the conversation
list, controlled in ordinary chat. The existing settings page is optional detail.
Implement inline in the existing worktree; preserve all existing changes.

## Approach

Use a real Hermes profile named `codex-supervisor`, its normal durable sessions,
model picker and composer. Give it a narrowly scoped MCP server for context,
reading a selected Codex chat, starting/resuming and pausing the existing watch.
A name/role without tools cannot perform supervision. A synthetic phone-only bot
would lose the host's memory and lifecycle. Those alternatives do not meet the
request. Provision the managed profile idempotently from the paired phone, with
an independently keyed, hidden analysis-only profile for background review.
Never replace an unrelated existing profile or change the owner's profiles.

## Chat and authority

Persist the latest actual user directive at acceptance of the dedicated agent's
durable turn. Tools receive this authoritative context, not instructions invented
by the agent. Start/resume/pause use its opaque directive identity, Jev checks of
the requested action/target/goal, and a freshness check before side effects.
Unclear destinations prompt a choice; clear authorized requests act immediately.
The agent may observe running chats; continuing waits for the existing failure
rules. Codex's login, relay, permissions and model remain unchanged.

The MCP credential is scoped to these tools and stays on the host. Normal device
tokens remain required for the phone. Both services stay on loopback. Model
choices and identity live in Hermes. Closing the phone does not end the watch.

## Interface and verification

Provision one visible, host-pinned Codex supervisor agent. It opens the regular
chat/composer/model picker and explains its role in the empty conversation.
Show the watch's current status and latest analysis in that chat, with a link to
the existing detailed page. No local transcript or renderer persistence.

Test profile provisioning/collisions, scoped authentication, verified natural
directives, ambiguous target rejection, stale directives, idempotency, MCP wire
format, phone identity/model choice and ordinary-agent regression. Validate
native and browser flows using simulated model/transport responses; separately
report whether live Hermes/model/remote runtime validation is available.
