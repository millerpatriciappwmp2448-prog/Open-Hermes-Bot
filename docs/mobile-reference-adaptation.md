# Mobile reference adaptation

The app remains a client for the Hermes harness. This is a capability audit,
not a claim that the reference applications have been fully reproduced.

## Evidence checked on 2026-10-31

- Open-Hermes-Bot mobile source and bridge in this working tree. Profiles,
  sessions, model choices and schedules continue to belong to Hermes.
- [Hermes Bot Kit](https://github.com/thomasbek3/hermes-bot-kit): current raw
  README retrieved on this date, plus the local reference checkout
  `4bfdd1bf3c7ad20458e4793666550af760b76d97`. Desktop plugins use Hermes
  Desktop contribution points and DOM/CSS. They cannot be imported as React
  Native components.
- [Computer viewer](https://github.com/thomasbek3/hermes-bot-kit/tree/master/computer-viewer):
  VNC/websockify and optional H.264, with separate host capture and agent
  computer tools. A headless Linux server needs a desktop/capture service
  before a phone can display a desktop. A mobile viewer is still outstanding.
- User-provided Grok Bot screenshots: conversation settings include a model,
  description/instructions, notifications, speech, permissions and export.
  These screenshots are the visual reference; no claim of access to private
  Grok implementation or a verified live Grok settings catalog.
- Supplied Herald IPA inspection showed session, system statistics and usage
  endpoint strings. Those strings are capability clues, not a verified API
  contract. No code from that binary was copied.
- [Hermes API server source](https://github.com/NousResearch/hermes-agent/blob/main/gateway/platforms/api_server.py)
  retrieved on this date: authenticated `/health/detailed` exposes version,
  active agents and `metrics_today` (UTC day, requests, messages, tokens,
  latency P95). The bridge whitelists only these fields.

## Current implementation and remaining work

| Capability | Current evidence / boundary |
| --- | --- |
| Compact chat, animated avatars, bilingual UI, themes | Mobile source and browser checks; no new device validation |
| Chat settings: model, description, pin, export, clear, delete agent | Wired to existing bridge or explicitly marked demo; primary agent protected |
| Scheduled jobs and generated sessions | Bridge API and session pagination implemented; natural-language task creation remains Hermes' tool responsibility |
| All-source session history | Reads server records including cron and other channels; no fabricated news feed |
| Host resources and gateway daily usage | Authenticated bridge endpoint and compact settings page added; unit and mocked browser checks; real server unverified |
| Computer display | Reference protocol inspected; mobile viewer, host capture configuration and real connection still needed |
| Voice readout, attachments, group behavior | Existing partial/demo behavior still needs full integration |
| Notifications | Honest disabled state; no iOS background push implementation |
| Team/private permissions and agent management permissions | Must map to enforceable Hermes capabilities; do not add cosmetic toggles |
| Task dock / bot sections | Reference inspected; no mobile implementation yet |

Do not package or publish while the user is refining the interface. Before
claiming completion, connect to the user's actual deployment, verify profile
isolation, scheduled runs, model overrides and the chosen computer service,
and test on the target iOS 17 device.
