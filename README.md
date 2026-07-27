# enpiistudio

Personal agentic coding workspace. Built-in agent: **enpii**.

See [`docs/`](./docs/) for architecture, design, PRD, rules, and schema.

## Stack (v0)

- Electron + Svelte 5 + Vite
- `@enpiistudio/agent-core` Node sidecar (stdio JSON-RPC)
- User-owned OpenAI-compatible **or** Anthropic Messages endpoint

## Develop

```bash
npm install
npm run build -w @enpiistudio/agent-core
npm run dev
```

### Package / share (unsigned v0)

```bash
node apps/desktop/scripts/gen-icon.mjs   # once — apps/desktop/build/icon.png
npm run pack                            # unpacked dir (smoke)
npm run dist                            # current-OS installers → apps/desktop/release/
npm run dist:linux                      # AppImage + deb
npm run dist:win                        # NSIS + portable (run on Windows or with wine)
npm run dist:mac                        # dmg (run on macOS)
```

Artifacts land in `apps/desktop/release/`. **Unsigned by default** — expect SmartScreen (Windows) / Gatekeeper (macOS) warnings when sharing. Open anyway / right-click Open on first launch.

**Signing later (optional env — no code change):**

| OS | Env |
|----|-----|
| Windows Authenticode | `CSC_LINK` (pfx path/url), `CSC_KEY_PASSWORD` |
| macOS notarize | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (+ unset mac `identity: null` when using a real Developer ID) |

Auto-update / GitHub Releases publish is out of scope for v0.

DevTools (detached):

```powershell
# PowerShell
$env:ENPII_DEVTOOLS = "1"; npm run dev
```

```bash
# bash / Git Bash
ENPII_DEVTOOLS=1 npm run dev
```

Or: `npm run dev:devtools` from repo root / desktop package.

If Electron prints `failed to install correctly` after `npm install` (common on some Windows setups when the zip is cached but not extracted):

```powershell
$zip = "$env:LOCALAPPDATA\electron\Cache\*\electron-v*-win32-x64.zip" | Get-Item | Select-Object -First 1
Expand-Archive $zip.FullName node_modules\electron\dist -Force
Set-Content node_modules\electron\path.txt "electron.exe" -NoNewline
```

## Config (local only — never commit secrets)

Priority: `ENPII_*` env → project `.enpii/config.toml` → `~/.enpiistudio/config.toml` → legacy `config.json` → defaults.

| Path | Purpose |
|------|---------|
| `~/.enpiistudio/config.toml` | Provider (baseUrl, apiKey, model, dialect, permissionMode, denyGlobs) |
| `~/.enpiistudio/mcp.json` | MCP servers (stdio and/or HTTP `url`) |
| `~/.enpiistudio/ssh.json` | SSH hosts + local-forward tunnels |
| `~/.enpiistudio/sessions/` | JSON transcripts + SQLite `index.db` |
| `.enpii/AGENT.md` | Project agent instructions |
| `.enpii/config.toml` | Project overlay (no API keys) |
| `.enpii/mcp.json` | Project MCP servers |
| `.enpii/skills/**/*.md` | Project skills |

See `.env.example` for env vars.

## Workspace layout

```
apps/desktop          Electron shell + Svelte UI
packages/agent-core   enpii sidecar
docs/                 product docs
reference/            OpenHarness · ClawTeam · loop-engineering (patterns only)
```

## Status

See **[`docs/progress.md`](./docs/progress.md)** for shipped detail and the **v1 agent roadmap** (web → tasks → sub-agent → plan/ask → cron), mapped from `reference/OpenHarness`, `reference/ClawTeam`, `reference/loop-engineering`.

v0 daily-driver (PRD M5 + early shell extras) is in tree. Next agent work is **M6+** in [`docs/prd.md`](./docs/prd.md).

## Project context

- Put project instructions in `.enpii/AGENT.md`.
- Put shareable skills in `.enpii/skills/**/*.md`.
- Put global skills in `~/.enpiistudio/skills/**/*.md`.
- Project skills override global skills with the same `name`.
- Load a skill body for one run with `/skill <name>` in the prompt.

Skill frontmatter supports scalar `name` and `description` fields:

```md
---
name: review
description: Review changes conservatively
---
Run focused checks before broad checks.
```

- [x] Monorepo scaffold
- [x] UI chrome (projects | modes | inspector)
- [x] enpii health + LLM loop (OpenAI + Anthropic dialects)
- [x] Read/write tools + ask-mode approval queue
- [x] Session persist / SQLite index / resume
- [x] Settings · shell · terminal (PTY) · git · code · browser
- [x] Worktree multi-agent (spawn / board / fan-out / apply-all)
- [x] MCP client (stdio + HTTP) · SSH tunnels + interactive PTY · vendor CLI host
- [x] TOML config · deny globs · memory toggle · layout per project · auto `.enpii/`
- [x] Packaging scaffold (`electron-builder` + multi-target dist + signing env hooks)
- [x] v1 agent: `web_fetch` / `web_search` (OpenHarness patterns, SSRF guard)
- [x] v1 agent: in-loop durable `task_*` board
- [x] v1 agent: `agent` / worktree sub-agent + `send_message`
- [ ] v1 agent: plan/ask, parallel tools, cron (later)
- [ ] Signed installers when certs available (codesign / notarize / Authenticode)
