# Progress — enpiistudio / enpii

Status: **working daily-driver slice** (agent + code + terminal + git + settings + approval queue + worktree)
Last updated: 2026-07-27 (v0 daily-driver closed; agent roadmap vs `reference/` locked)

## Done

### Shell & monorepo
- Electron + Svelte 5 + Vite monorepo (`apps/desktop`, `packages/agent-core`)
- UI chrome from `docs/design/code.html`: 3-pane shell, top mode nav, project sidebar, inspector
- Spacing: **8px** shell pad/gap (product choice; mock used 16px in places)
- Open folder as icon beside sidebar search
- Plain CSS tokens (`--studio-*`) — **not** Tailwind (migrate deferred)

### Agent core (`@enpiistudio/agent-core`)
- stdio JSON-RPC sidecar: `health`, `config.get`/`config.set`, `session.*`, `git.*`
- Provider: OpenAI-compatible Chat Completions + Anthropic Messages (`ENPII_*` env or `~/.enpiistudio/config.toml`, legacy JSON OK)
- Real multi-round tool loop (max 8 rounds), stream text + tool events
- **Read tools:** `list_dir`, `read_file`, `glob`, `grep` (workspace path jail)
- **Write tools:** `write_file`, `edit_file` (jail, size caps, unique replace)
- **Shell tool:** `run_shell` (cwd jail, timeout, stdout/stderr caps; blocks force-push / reset --hard / clean -fdx)
- **Git tools + RPC:** status/diff/history/stage/commit/branch/stash/tag/remote/fetch/pull/push/conflict
- `edit_file` normalizes CRLF/LF so Windows files match model newlines
- Permission modes: `read_only` blocks writes+shell; `ask` → approval; autopilot auto-writes (shell/git still ask); full auto-allows shell
- RPC: `session.approve` + `session.approve_all` (`allow` | `deny`), timeout deny, stop cancels all pending
- **Approval queue:** multi pending waiters per round; batch allow/deny
- **Worktree mode:** `git worktree` add/list/remove under `~/.enpiistudio/worktrees/<hash>/`; session jailed to worktree path with `baseProjectRoot` storage
- Worktree **preview / apply (merge into main) / discard** (+ delete `enpii/*` branch)
- RPC: `git.worktree_*`, `session.worktree_start|preview|apply|discard`
- Session persist under `~/.enpiistudio/sessions/…` (path normalize Windows); list/resume/new
- Goal contract per run: acceptance criteria plus round/token/runtime budgets
- Durable atomic run checkpoints under `~/.enpiistudio/runs/<session>/<run>.json`
- Run lifecycle records queued/running/approval/completed/failed/cancelled outcomes
- Max-round exhaustion and budget breaches now fail explicitly instead of ending silently
- Independent fresh-context verifier reviews acceptance criteria and successful write diffs
- Failed verification triggers a bounded repair loop (`maxRepairAttempts`, default 1)
- Write diff evidence is captured before mutation, fixing overwrite previews
- Project checks auto-discover `typecheck`, `test`, then `build` from root `package.json`
- Verification commands run through the normal shell approval, jail, timeout, and block policy
- Explicit goal `verificationCommands` override discovery (max 5)
- Provider retries transient HTTP/network failures with bounded exponential backoff and `Retry-After`
- Retry delays stop immediately on abort; auth and malformed successful responses fail without retry
- In-memory circuit breaker isolates repeated failures per endpoint/model and probes after cooldown
- Provider retry/circuit lifecycle is emitted to desktop RPC events
- Project `.enpii/AGENT.md` is safely loaded into every run with size and symlink guards
- Global/project skill catalogs are discovered recursively; project skills override matching global names
- Skill bodies stay out of normal prompts and load only through `/skill <name>`
- Context fingerprint/catalog snapshot persists under `~/.enpiistudio/projects/<projectHash>/context.json`
- Project context lifecycle is emitted as a `project_context` desktop RPC event
- Run telemetry remains in state/checkpoints; the duplicate Inspector panel was removed in favor of the compact status UI
- Casual greetings bypass project tools and answer directly
- `New Session` stops an active/pending run, creates a distinct session, and refreshes the visible session switcher
- Run checkpoints now persist and emit repair-attempt counts
- Unit tests cover config, context, provider resilience, persist, git, approval queue, verifier, tools, shell, write + CRLF

### Desktop UX
- Live agent chat with tool cards matching mock (`tool:name`, glow dot, Completed/Failed)
- **Action Required** cards (gold) for write/shell/git approval — per-tool + **Allow all / Deny all**
- Unified-diff preview (GitHub-style `+/-` colors) for pending writes
- Recent Diffs in inspector after successful writes
- App launch creates a fresh Agent session per project; session history remains manually selectable and runtime state is cached per project
- Collapse tool output by default (`details`); one tool card per result (no call+result dupes)
- Auto-scroll chat (stick-to-bottom; release when user scrolls up)
- Assistant markdown render (headings, lists, bold, code, fences, `---` HR) — zero extra deps
- Composer auto-focus + re-focus on blur (except other text fields / busy)
- **Code mode** — jailed explorer tree, CodeMirror editor, multi tabs, exact compare-and-replace save, syntax highlight
- Editor changes never bypass agent approval when proposed via agent; manual Code saves are trusted user actions (path jail + conflict + atomic write)
- **Terminal mode** — multi tabs, rename, real Electron PTY + xterm resize/input/cleanup
- **Git mode** — full GitStage (status/diff/stage/commit/branch/stash/remote/tag/fetch/pull/push/conflict)
- Settings modal (TopNav gear + Inspector): base URL / API key / model / dialect / permission mode
- Inspector **Worktree** → isolated session + preview + **Apply to main** / **Discard**
- Command palette, notification center, browser stage scaffolding present in tree
- Composer **`@file` / `@selection` refs**: autocomplete via `project.search_files`, inject file/selection body into prompt (display text keeps bare `@…`)
- **Concurrent sessions**: live UI state per session id; switch/new while another run streams; events route to live map; per-session busy lock in core
- **Token/usage polish**: compact k/M labels, budget bar, in/out/Σ meta when endpoint returns usage
- **Session usage persist**: `SessionMeta.usage` accumulate + disk; `session_usage` event replace totals; list/open restore Σ
- **Global memory inject**: `~/.enpiistudio/memory/{global,projects/<hash>}/**/*.md` capped into system context
- **Memory tools**: `memory_write` / `memory_delete` / `memory_search` (ranked; write/delete approve)
- **Session memory toggle**: Inspector checkbox → `session.set_load_memory` (FR-S4)
- **Deny sensitive globs**: built-in `.env`/keys/credentials + optional `denyGlobs` in config (FR-S2)
- **Auto `.enpii/`**: `ensureEnpiiDir` on first prompt (AGENT.md + skills/) (FR-P3)
- **Layout per project**: sidebar/inspector widths in localStorage project record + drag resizers (FR-P2)
- **Worktree multi list**: Inspector linked worktrees from `git.worktree_list` → open matching session
- **Compact long session**: `/compact` + `session.compact` + **auto-compact** mid-run (≥36 msgs / 120k chars / 70% token budget)
- **Memory search ranking**: name hit + body hit + recency half-life
- **Export transcript MD**: `/export`, Inspector Export, command palette → save dialog
- **OS notif on approval**: Electron `Notification` + focus main window on click
- **Sidecar reliability**: auto-restart enpii on crash (bounded backoff)
- **Worktree polish**: conflict list on apply (no remove), keep-branch checkbox, list remove ×
- **Settings denyGlobs**: Permissions tab textarea → `config.set`
- **Compact undo**: `session.compact_undo` + `/undo-compact` + palette; in-memory pre-compact snapshot (one-shot)
- **Packaging scaffold**: electron-builder config; `npm run pack` / `npm run dist`; agent-core shipped as extraResources

### Config (local only — never commit secrets)
- Example: `.env.example` (`ENPII_BASE_URL`, `ENPII_API_KEY`, `ENPII_MODEL`, `ENPII_DIALECT`)
- User: `~/.enpiistudio/config.toml` (preferred; saves write TOML); legacy `config.json` still loads
- Project overlay: `.enpii/config.toml` (no API keys; model/dialect/permission/denyGlobs)
- Priority: env → project TOML → user TOML → user JSON → defaults
- `denyGlobs?: string[]` optional in user/project config

### Recently shipped (this loop)
- **Multi-platform dist**: win nsis+portable, mac dmg, linux AppImage+deb; `dist:*` scripts; unsigned + signing env docs
- **MCP HTTP**: Streamable HTTP JSON-RPC client (`mcp-http.ts`); `mcp.json` `url`+headers; Settings shows transport
- **Smart compact**: keep last 8 turns raw; summarize older middle only
- **`search_codebase` fast path**: path-name short-circuit + tighter scan caps
- **UX**: project search/pin, session rename, palette skips input steal, approval Y/N/S
- **Chat-default brain**: auto-brief stub `.enpii/AGENT.md` from FS snapshot (stack/scripts/tree); always inject compact `projectSnapshot`
- **`search_codebase` tool**: ranked lexical filename+content discovery for large repos
- **Allow for session**: approval `scope=session` grants mutation kind (write/shell/git/mcp) until stop; UI buttons + batch
- **Anthropic dialect** full Messages API adapter (`provider/anthropic.ts`) + `providerChat` router in loop/verifier
- **SQLite session index** `~/.enpiistudio/sessions/index.db` (node:sqlite); JSON transcripts remain source of truth
- **TOML config** user+project; auto scaffold `.enpii/config.toml` on first agent use
- **MCP client (stdio)** `mcp.json` user+project; tools `mcp_list_tools` / `mcp_call_tool` (call needs approval); RPC `mcp.*`
- **Block terminal UX** agent chat: rich `term-block` for `run_shell`/`mcp_call_tool` (cmd line + copy + taller output)
- **SSH/tunnel** live tunnels + interactive **Terminal → SSH** PTY host open
- **Host vendor CLIs** Terminal toolbar menu (claude/codex/aider/gemini) → PTY
- **Multi-agent worktrees** spawn/board/fan-out + **Apply all** (`session.worktree_apply_many`)
- **Browser stage** multi-tab + bookmarks/history/downloads/webview + DevTools + **per-project partition**
- **Packaging** electron-builder icon via `build/icon.png` (`node apps/desktop/scripts/gen-icon.mjs`)
- **Settings Network** SSH tunnels + MCP server list

- **Apply-all report** Inspector per-agent ok/skip/conflict + **click path → Code** / Open Git

### PRD checklist (v0)

| # | Item | Status |
|---|------|--------|
| 4 | MCP client | stdio + tools + Settings list |
| 5 | Host vendor CLIs | Terminal menu → PTY |
| 6 | SSH / tunnel | live tunnels + Terminal SSH PTY |
| 7 | Embedded browser | multi-tab + DevTools + per-project partition |
| 8 | Block terminal UX | `term-block` for shell/MCP |
| 9 | Worktree multi-agent | spawn/board/fan-out/apply-all + conflict→Code |
| 10 | Anthropic dialect | full Messages adapter |
| 11 | Session SQLite index | `sessions/index.db` |
| 12 | Config TOML | user + project |
| 13 | Deny globs FR-S2 | config + Settings |
| 14 | Memory toggle FR-S4 | session checkbox |
| 15 | Layout FR-P2 | per-project widths |
| 16 | Auto `.enpii/` FR-P3 | AGENT.md + skills + config.toml + mcp.json |

## Reference map (`reference/`)

Pinned pattern sources (borrow patterns, not product personality — see `docs/rules.md`):

| Tree | Role for enpii |
|---|---|
| `reference/OpenHarness/` | Agent harness: 43+ tools, loop, perms, skills, MCP, plan/task/agent/cron |
| `reference/ClawTeam/` | Swarm: spawn → worktree → mailbox → board → templates |
| `reference/loop-engineering/` | Loop ops: schedule · worktree · skills · MCP · sub-agent · state/budget/gate |

**Shell (CLIMonkey/Warp-class desktop)** is largely ahead of these repos.  
**Agent brain** still trails OpenHarness tool surface + ClawTeam coordination + LE scheduling.

### Coverage vs reference (agent only)

| Area | enpii now |
|---|---|
| File / shell / local search / git | strong |
| AGENT.md, skills on-demand, memory, smart compact | strong |
| Jail + approval + deny globs + session grants | strong |
| Goal + verifier + repair + checkpoints | strong (LE maker/checker lite) |
| Worktree multi-agent board / apply | partial (ClawTeam isolation; no mailbox) |
| MCP stdio + HTTP tools/call | partial (no resources / OAuth) |
| Web search / fetch | **shipped** (`web_fetch` / `web_search`, SSRF guard) |
| In-loop `agent` + `task_*` + `send_message` | **missing** (UI fan-out only) |
| Formal plan mode + ask-user | **thin** (`plan_tasks` + composer Plan = read-only) |
| Parallel tool execution | **missing** (sequential) |
| Schedule / cron / durable loop fire | **missing** |
| Hooks, plugins, LSP, notebook, chat channels | out / YAGNI |

## Next targets

### Agent surface (v1 — absorb `reference/` patterns)

Ordered by impact for chat-default users; implement one phase at a time:

1. **P0 Web** — ✅ `web_fetch` + `web_search` (SSRF guards; `ENPII_WEB_SEARCH_URL` / `ENPII_WEB_PROXY`).
2. **P1 Task board** — durable `task_create|get|list|update|stop` (replace thin-only reliance on `plan_tasks` for multi-step work).
3. **P1 Sub-agent** — in-loop `agent` / `send_message` spawning jailed worktree sessions (reuse existing worktree RPC; OH `agent_tool` + ClawTeam spawn ideas).
4. **P2 Plan + ask** — `enter_plan_mode` / `exit_plan_mode` (block writes) + `ask_user` mid-run (structured questions → UI).
5. **P2 Parallel tools** — run read-only tool calls in one assistant round concurrently where safe.
6. **P2 MCP depth** — resources + prompts; OAuth when a real server requires it.
7. **P3 Schedule** — `cron_*` or host scheduler firing prompts (LE automations primitive; durable across restart).
8. **P3 Swarm depth** — mailbox / task deps / team templates (ClawTeam) only after P1 sub-agent is solid.

### Shell / ship (parallel, lower agent IQ)

- Signed installers when certs available (codesign/notarize / Authenticode)
- Browser multi-profile (beyond per-project partition)
- Persistent search index if monorepo `search_codebase` still slow after caps
- Wire Settings demos (theme light/system, maxTurns) or remove
- Design shortcuts still open: focus composer, quick-open, toggle sidebar/inspector, Esc-stop

## Non-goals (for now)
- Hosted multi-user SaaS / team SSO
- Auto-run everything without approval as default
- Shipping API keys in the repo
- Full OpenHarness plugin marketplace / chat-gateway channels
- Porting OH/ClawTeam code wholesale (TypeScript own contract only)
- Adaptive multi-machine P2P swarm (ClawTeam phase roadmap)

## How to run
```bash
npm install
npm run build -w @enpiistudio/agent-core
npm run dev
```
Configure provider via `~/.enpiistudio/config.toml` (or legacy `config.json`) / `.env` (see `.env.example`).
