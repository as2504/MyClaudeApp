# Lorewood Production Control Centre

A token-efficient production-management system for a Claude Code video pipeline:

- **Production bus**: a SQLite database (WAL mode) shared by the worker session, the PM, the
  watchdog and the phone app. Messages are append-only, with delivery and acknowledgement statuses.
- **Worker hooks** (`bus/hook.js`): Claude Code command hooks. They record events and deliver PM
  messages at safe checkpoints without calling a model.
- **PM trigger** (`bus/trigger.js`): starts one batched headless `claude -p` run only when an
  actionable message is waiting. It uses a lock, a debounce window and bounded retries.
- **Watchdog** (`bus/watchdog.js`): Task Scheduler runs it every 10 minutes. It does plain local
  checks and exits at once when nothing needs attention.
- **Phone PWA** (`web/`) and **backend** (`server/server.js`): dashboard, Ask PM, decisions, file
  review with audio/video/image/text previews, and Web Push with delivery confirmation.

```
 worker session ──hooks──▶ ┌──────────────┐ ◀── phone app (PWA) ◀── you
   ▲  (PostToolUse/Stop/    │  SQLite bus  │ ──▶ Web Push ──▶ phone
   │   asyncRewake listener)│  lorewood.db │
   └──── PM messages ◀───── └──────┬───────┘
                                   │ actionable?  (hooks, server, 10-min watchdog)
                                   ▼
                        PM Trigger (lock + debounce) ──▶ claude -p  (only now are tokens spent)
```

## How messages reach the worker without interrupting it
| Worker is… | Delivery path |
|---|---|
| running tools | `PostToolUse` hook adds the message as context after the current tool call |
| finishing a turn | `Stop` hook blocks the stop once, with the message as the reason |
| idle | `Stop` → `asyncRewake` listener (a background script with no tokens) exits 2 and wakes the session |
| user typing directly | `UserPromptSubmit` hook adds pending messages to the prompt context |

Every PM→worker message stays `delivered` until the worker runs `lw ack <id>`. Messages that are
never acknowledged are redelivered (at most 3 times) once the worker is idle, then flagged to the PM.

## Runtime data (not in this repo)
`LW_HOME` (default `C:\Local Disk D\LorewoodPM`) holds:
- `config.json`: settings (worker session id, port, PM model, `pmEnabled`)
- `CLAUDE.md`: the PM's standing instructions for headless runs
- `data/lorewood.db`: the bus
- `data/files/`: verified copies of files sent for review, plus phone previews. Originals are only read.
- `data/secrets.json`: app access key, cookie secret, VAPID keys, optional `pmOauthToken`
- `data/logs/`: PM run transcripts (JSON) and the server log

## Setup
1. `npm install`
2. `powershell -File scripts/install-tasks.ps1`: registers `\Lorewood\Watchdog` (every 10 min),
   `\Lorewood\PM Trigger` (on demand) and `\Lorewood\Server` (at logon).
3. Worker hooks live in the production folder's `.claude/settings.json`.
4. Headless PM sign-in: run `claude setup-token`, then put the token in `data/secrets.json` as
   `"pmOauthToken"`. Then `node bus/lw.js config --set pmEnabled=true`.
5. Remote access: put the server (`127.0.0.1:8787`) behind HTTPS, using Tailscale Serve/Funnel or a
   Cloudflare named tunnel. Set `publicUrl` in `config.json`.

## CLI
`node bus/lw.js help`. The worker uses `send`, `ask`, `ack`, `inbox` and `report-user-decision`. The PM
uses the `pm …` subcommands. `trigger` and `watchdog` are for the scheduler.
