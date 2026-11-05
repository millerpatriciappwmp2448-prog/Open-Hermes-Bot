# Codex supervisor companion

The companion observes an existing Codex desktop chat and sends authorized
continuation or review guidance through that desktop runtime. Magpie, Codex login,
model/provider settings and credentials are unchanged. A new Codex process is not
started. This uses a version-sensitive desktop app-tools pipe, with capability
checks before use; it is not a public Codex API.

The phone is the interface. The watch, retry deadlines, events and delivery outbox
live on the Codex computer. Closing the phone does not stop a watch. The computer
must stay awake and Codex desktop must remain available.

## Start on Windows

Use Node 24. There are no additional companion dependencies. From a Codex desktop
chat with app tools enabled, run:

```powershell
& '.\companion\windows.ps1' -Action Register
& '.\companion\windows.ps1' -Action Start
& '.\companion\windows.ps1' -Action Status
```

Start runs a hidden Node process independent of the phone. Stop the process with
`-Action Stop`; this preserves the saved watch, so the next start resumes it. To
disable supervision, use **Pause supervision** on the phone before stopping.
Startup does not create or enable a new watch. No login startup task is installed.
After a Codex desktop restart, run `-Action Register` from a desktop chat again;
the running companion reloads that connection within 10 seconds.

For a foreground process, use `node companion/server.cjs`. `--register` only
records the current desktop connection and exits. The default service address is
`http://127.0.0.1:8770`. The state directory is `HERMES_CODEX_HOME`, or
`HERMES_HOME/codex-supervisor`, or `~/.hermes/codex-supervisor` in that order.
Keep `token`, `connection.json`, `watch.json` and logs private; do not commit them.
They can contain goals, recent chat excerpts and delivery instructions.

## Connect the Hermes bridge

The bridge accepts the phone's existing paired device token. It proxies only
status, chat listing, watch and pause operations. The companion has a separate
random token, generated in its state directory at first startup.

When both processes run on the same computer, set `HERMES_CODEX_URL` on the bridge
to `http://127.0.0.1:8770`. It can read the companion token in the shared Hermes
home, or the bridge service can receive it as `HERMES_CODEX_TOKEN`.

When Hermes runs on a remote Linux host, use an SSH reverse tunnel from the Codex
computer. For example, for an existing SSH host alias `hermes-host`:

```powershell
ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -R 127.0.0.1:8770:127.0.0.1:8770 -L 127.0.0.1:8766:127.0.0.1:8765 hermes-host
```

On the remote bridge service, set `HERMES_CODEX_URL=http://127.0.0.1:8770` and
`HERMES_CODEX_TOKEN` to the companion's token, delivered through the service's
private environment file. Restart the bridge after changing its environment.
The reverse tunnel and companion must keep running. Do not expose port 8770 on a
public interface. No SSH destination or service configuration is changed by the
companion scripts.

If the bridge runs inside Docker, host loopback is not container loopback. Use
a private Unix socket under an existing bind mount instead. On the bridge, set
`HERMES_CODEX_SOCKET` to the **container** path and `HERMES_CODEX_TOKEN` to the
companion token. Alternatively, write `codex-companion.json` in the bridge's
state directory with `socket` and `token` fields, owned by the bridge user with
mode `0600`. Explicit service environment settings take precedence.

The repository includes `companion/ssh_tunnel.py` for this case. Run it on the
Codex computer with `--host`, `--identity`, `--socket` (the **host** path), and
`--state-dir`. It reconnects after network interruptions and removes only stale
sockets it owns. Add `--group-readable` when the socket directory's inherited
group is the bridge user's group. Give the SSH user only the required directory
traverse/write permissions; do not open the entire Hermes data directory.
On Windows, start the helper with `Start-Process -WindowStyle Hidden` and quoted
absolute arguments. It must remain running with the companion; restart it after
a computer reboot. It creates no public listener and does not enable a watch.

For model review, set these variables in the companion's environment **before**
starting it:

| Variable | Meaning |
| --- | --- |
| `TYPESAFE_API_KEY` | TypeSafe key, used only on the host with `jev-latest` |
| `HERMES_CODEX_BRIDGE_URL` | Bridge root URL; `http://127.0.0.1:8766` with the example tunnel |
| `HERMES_CODEX_BRIDGE_TOKEN` | A separately paired bridge device token for the companion |
| `HERMES_CODEX_PORT` | Optional companion port, default 8770; also pass `-Port` to the Windows helper |

Pair a companion device through the bridge's ordinary one-use pairing-code
flow. This credential opens the bridge, not the model provider. Model credentials
stay on the Hermes host and the phone selects among that host's available models.
Restart the companion after changing these environment variables.

## Review agent

Choose a dedicated Hermes profile for analysis. Preserve its model/provider
configuration, and set this in that profile's `config.yaml`, then reload the
profile/gateway:

```yaml
platform_toolsets:
  api_server: [no_mcp]
```

The bridge requires this explicit setting and checks the running profile's
`/v1/toolsets` before creating a review. An empty list alone still inherits MCP
tools in Hermes. The reviewer proposes text only; sending to Codex belongs to the
companion. A tool-enabled or unsupported profile causes a visible review error,
while deterministic 429/network recovery continues. No existing profile is
silently reconfigured.

The phone entry is **Settings > Codex supervisor**. Select the existing local chat,
write the goal and completion checks, choose the review profile/model, and start
once. This authorizes automatic messages to that selected chat. Ordinary retries
and supported corrections need no repeated confirmation. Model choice applies to
the supervisor only; Codex keeps its own configuration. Disabling analysis keeps
automatic network recovery available.

## Recovery rules

- Poll every 10 seconds. A running turn, including Codex's own retry loop, remains
  running. Silence alone does not trigger a continuation.
- A confirmed failed turn with a recoverable 429/network error schedules a retry.
  Honor Retry-After when available; otherwise use exponential backoff with jitter,
  from about 30 seconds up to about 15 minutes. There is no retry-count ceiling.
- Authentication, exhausted quota, manual interruption and approval/input waits
  require attention. The companion never approves an operation for the user.
- Re-read the destination before sending. Pause, new activity or changed evidence
  invalidates a pending decision. Model review cannot block transport recovery.
- Persist an opaque marker before sending. A lost acknowledgment waits for that
  marker in recent desktop turns; it never blindly resends. If the marker cannot
  be observed, delivery stays unknown and automatic sends remain suspended.
- Semantic signals are probabilities. Criteria and thresholds are centralized in
  `reviewer.cjs`; high-confidence guidance still requires fresh evidence. A
  completed Codex turn alone does not establish the whole goal is complete.

## Verify

```powershell
node --test companion/tests/*.test.cjs
cd bridge
python -m unittest discover -s tests
```

Automated transport/model responses simulate failures. They do not prove real
unattended recovery through a live relay. A live desktop read verifies connection
and observation without sending any prompt. The installed phone build, remote
tunnel and selected review model need their own runtime validation.
