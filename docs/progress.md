# Progress — enpiistudio / enpii

Status: **working daily-driver slice** (read tools + write with approval)  
Last updated: 2026-07-25

## Done

### Shell & monorepo
- Electron + Svelte 5 + Vite monorepo (`apps/desktop`, `packages/agent-core`)
- UI chrome from `docs/design/code.html`: 3-pane shell, top mode nav, project sidebar, inspector
- Spacing: **8px** shell pad/gap (product choice; mock used 16px in places)
- Open folder as icon beside sidebar search
- Plain CSS tokens (`--studio-*`) — **not** Tailwind (migrate deferred)

### Agent core (`@enpiistudio/agent-core`)
- stdio JSON-RPC sidecar: `health`, `config.get`, `session.*`
- Provider: OpenAI-compatible Chat Completions (`ENPII_*` env or `~/.enpiistudio/config.json`, BOM-safe)
- Real multi-round tool loop (max 8 rounds), stream text + tool events
- **Read tools:** `list_dir`, `read_file`, `glob`, `grep` (workspace path jail)
- **Write tools:** `write_file`, `edit_file` (jail, size caps, unique replace)
- `edit_file` normalizes CRLF/LF so Windows files match model newlines
- Permission modes: `read_only` blocks writes; `ask` (default) → approval; autopilot/full auto-allow
- RPC: `session.approve` (`allow` | `deny`), timeout deny, stop cancels pending approval
- Session persist under `~/.enpiistudio/sessions/…` (path normalize Windows); list/resume/new
- Unit tests: persist, SessionStore, R/O tools, write + CRLF + unified-diff preview (**10 pass**)

### Desktop UX
- Live agent chat with tool cards matching mock (`tool:name`, glow dot, Completed/Failed)
- **Action Required** card (gold) for write approval — Deny / Allow Edit, not inspector-only
- Unified-diff preview (GitHub-style `+/-` colors) for pending writes
- Recent Diffs in inspector after successful writes
- Session list clickable resume; hydrate latest project session; in-memory cache per project
- Collapse tool output by default (`details`); one tool card per result (no call+result dupes)
- Auto-scroll chat (stick-to-bottom; release when user scrolls up)
- Assistant markdown render (headings, lists, bold, code, fences, `---` HR) — zero extra deps
- Composer auto-focus + re-focus on blur (except other text fields / busy)

### Config (local only — never commit secrets)
- Example: `.env.example` (`ENPII_BASE_URL`, `ENPII_API_KEY`, `ENPII_MODEL`, `ENPII_DIALECT`)
- Runtime key: `~/.enpiistudio/config.json` preferred for desktop

## Next targets

Priority order (product, not just polish):

1. **Settings UI** — model / base URL / key / permission mode in-app (no hand-edit config)
2. **Shell tool** (gated) — `run_shell` with approval + cwd jail; mock already shows it
3. **Monaco Code mode** — open/edit files from project; jump from tool paths / diffs
4. **Terminal mode** — real PTY tabs beside agent
5. **Richer git surface** — status/diff/commit (mode or inspector)
6. **Multi-session UX** — title rename, archive, clearer “new vs resume”
7. **Approval queue** — multiple pending writes; batch allow
8. **Design parity pass** — remaining inspector/diff stats (+/− lines), composer icons, empty states vs mock
9. **Packaging** — installable Electron build for Windows (then macOS/Linux)
10. Optional: Tailwind migrate if design iteration speed becomes the bottleneck

## Non-goals (for now)
- Hosted multi-user SaaS
- Auto-run everything without approval as default
- Shipping API keys in the repo

## How to run
```bash
npm install
npm run build -w @enpiistudio/agent-core
npm run dev
```
Configure provider via `~/.enpiistudio/config.json` or `.env` (see `.env.example`).
