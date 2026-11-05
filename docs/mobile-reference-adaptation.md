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
| Host resources and gateway daily usage | Authenticated bridge endpoint and compact settings page added; distinguish unit/UI checks from the specific live checks recorded below |
| Computer display | Reference protocol inspected; mobile viewer, host capture configuration and real connection still needed |
| Voice readout | Per-agent opt-in saved on the host; system TTS reads a fresh successful reply only while its chat is visible. Navigation/background/mute/disconnect stop it. Native adapter/store tests pass; phone audio still needs device validation |
| Voice input and group behavior | Existing partial/demo behavior still needs full integration |
| Attachments | Mobile picker and bridge upload path implemented; native picker/device behavior still requires iPhone validation |
| Notifications | Per-agent preference defaults on and is saved to the host; native local reply alerts and tap routing wired. Server push while iOS is suspended/terminated is not implemented; device delivery still needs iPhone validation |
| Team/private permissions and agent management permissions | Must map to enforceable Hermes capabilities; do not add cosmetic toggles |
| Task dock / bot sections | Mobile components and bridge routes implemented; real task execution remains Hermes' responsibility |

## Verified fixes on 2026-11-05 (not yet packaged)

- Thinking avatars: the active state no longer skips gaze updates. A shared SVG
  body transform gently rotates and lifts the silhouette and eye mask together,
  without the extra squash/stretch or shear that exaggerated deformation, independently of
  the orbit rings. Component regressions cover every shape, repeated idle/active
  transitions, ring fade-out and reduced motion. Browser sampling found 45 distinct
  body poses in both chat header and list, with no runtime errors. No iPhone claim.
- Provider inventory: existing custom profiles queried model discovery without
  their endpoint credential and fell back to one configured model. The explicit
  `provider_catalog` repair registers the same endpoint using that profile's
  `CUSTOM_API_KEY` environment reference, with verification and a config backup.
  Public authenticated bridge checks returned 76 provider models for Atlas and
  the Codex supervisor. This verifies the catalog, not availability of every
  model; two trial models encountered upstream failures/timeouts. A real Atlas
  turn explicitly selecting `gpt-6.1-sol` subsequently completed with `OK`, and
  its temporary session was removed.
- Codex supervision: mobile binds the dedicated supervisor profile and preserves
  watch status if chat listing fails. A private SSH-forwarded Unix socket now
  reaches the Windows companion from the container. Public bridge status and
  thread routes returned HTTP 200 and 12 desktop chats; the watch remains stopped.
  The computer, companion and reconnecting tunnel must remain running. This is
  read-only connection verification, not proof of unattended supervision. Killing
  the tunnel's SSH child also verified automatic reconnection and a successful
  subsequent read of the same 12 chats.
- Notifications: each agent now has its own working switch, default on, with no
  global switch. Completion alerts exclude the currently visible conversation,
  muted agents and cancelled runs; repeated recovery callbacks are deduplicated.
  System permission is requested only through the explicit settings action. Taps
  wait for connection restoration and open the original session. Native adapter,
  store and routing tests pass; browser checks at 320, 390 and 1005 pixels cover
  both languages, per-agent isolation, a fresh server preference read and failed
  save preservation. These checks use a mock bridge and do not prove iPhone
  notification delivery. Only local alerts are configured, without APNs
  entitlements; server push while the app is suspended/terminated remains open.
- The two agent permission switches still need enforceable Hermes capabilities.
  They remain disabled and are not implemented permissions.
- Read replies aloud: the compact per-agent setting now saves to host prefs,
  default off. Expo Speech reads final text only, chunks long replies without
  discarding text, and cancels on navigation/background/mute/disconnect/unmount.
  Old transcripts, restored runs, failed/cancelled turns and duplicate completion
  callbacks do not start speech. Native failures cannot fail a Hermes reply.
  This is system TTS, not voice recording or server transcription. Physical iOS
  audio and silent-mode behavior remain unverified on the user's phone.

Do not package or publish while the user is refining the interface. Before
claiming completion, connect to the user's actual deployment, verify profile
isolation, scheduled runs, model overrides and the chosen computer service,
and test on the target iOS 17 device.
