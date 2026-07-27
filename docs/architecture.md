# Architecture — enpiistudio

Status: draft v0  
Audience: implementer (solo / small team)  
Scope: personal daily driver, local-first

---

## 1. Purpose

**enpiistudio** is a personal agentic coding workspace.  
It hosts **enpii** (owned agent runtime) plus terminals, editor, and git — without depending on third-party coding CLIs (Claude Code, Codex, OpenCode, etc.).

North star hybrid:
- **CLIMonkey-like**: multi-pane project workspace for agents + tools
- **Warp-like**: modern terminal UX and agent session management (later depth)

v0 ships local-only. Remote SSH, tunnel, cloud agents are out of scope for this architecture revision.

---

## 2. Design principles

1. **Own the contract** — messages, tools, permissions, sessions are defined by enpiistudio; frameworks are optional organs.
2. **Model is pluggable** — user endpoint supports OpenAI + Anthropic shapes; internal schema is stable.
3. **Local-first** — project files, sessions, logs live on disk; no required cloud control plane.
4. **Safety at the host** — path allowlists, command gates, confirmations; never prompt-only safety.
5. **Thin core, rich shell** — agent intelligence in `agent-core`; UX in `desktop`.
6. **YAGNI** — no multi-tenant, billing, team SSO, or swarm orchestration in v0.

---

## 3. System context

```
┌─────────────────────────────────────────────────────────┐
│  enpiistudio desktop (Electron)                         │
│  layout: projects | mode nav + stage | inspector        │
│  modes: Agent (enpii) · Code · Terminal · Git…          │
└───────────────────────────┬─────────────────────────────┘
                            │ IPC
┌───────────────────────────▼─────────────────────────────┐
│  host runtime (Electron main)                           │
│  process mgr · pty · fs gateway · git · session store   │
└───────────┬─────────────────────────────┬───────────────┘
            │ stdio JSON-RPC              │
┌───────────▼───────────┐     ┌───────────▼───────────────┐
│  enpii (agent-core)   │     │  disk                     │
│  loop · tools · perms │     │  project/.enpii (cfg,     │
│  prompts · skills     │     │    AGENT, skills)         │
└───────────┬───────────┘     │  ~/.enpiistudio           │
            │                 │    sessions · memory      │
            │ HTTPS           │    global skills · logs   │
┌───────────▼───────────┐     └───────────────────────────┘
│  user AI endpoint     │
│  Anthropic + OpenAI   │
└───────────────────────┘
```

External systems (v0):
- User LLM endpoint (required)
- Local filesystem + git binary (required)
- Optional later: MCP servers, SSH, tunnel

---

## 4. Logical components

### 4.1 `desktop` (Electron + Svelte renderer)

Responsibilities:
- Window chrome: left **project list**, top **mode nav**, center **stage**, right **inspector**
- Modes: Agent (enpii timeline+composer), Code (Monaco + tree), Terminal (PTY), Git…
- Inspector: tokens, diffs, session history, approvals, run status
- Permission prompts (approve write / shell)
- Settings (endpoint, model, keys, themes)
- Brand palette: Deep Purple `#3D348B`, Gold `#E6AF2E`, Off-White `#F3F3F3`, Near-Black `#040303`

Does **not**:
- Run the agent loop itself (calls host / main)
- Talk to LLM directly (except optional debug)

### 4.2 `host` (Electron **main process** — Node/TS)

Responsibilities:
- BrowserWindow lifecycle, IPC to renderer (`contextBridge` / preload)
- Spawn/kill PTY sessions (`node-pty`)
- Enforce workspace root sandbox
- Spawn + bridge **enpii** sidecar (stdio JSON-RPC)
- Persist sessions (JSONL under `~/.enpiistudio/sessions/`; index SQLite global)
- File watch, git status polling
- Secret redaction on logs displayed in UI
- OS dialogs (open folder), keychain/safeStorage for secrets when available

### 4.3 `agent-core` / **enpii** (TypeScript)

Responsibilities:
- Provider adapters (Anthropic-primary schema, OpenAI secondary)
- Agent loop: model → tool_use → execute → observe
- Tool implementations (via host capabilities)
- Permission policy evaluation
- System prompt assembly (project + user + session)
- Context packing + compaction
- Structured events for UI timeline

Does **not**:
- Own UI
- Spawn third-party coding CLIs as the primary agent
- Hardcode a vendor “personality” as the only mode

### 4.4 On-disk layout

**Project-local** (boleh di-commit selektif):

```
<project>/
  .enpii/
    config.toml          # project overrides
    AGENT.md             # personality / instructions (owned by user)
    skills/              # project skills (*.md) — optional, shareable
    logs/                # optional local debug only; prefer global logs
  <source code>
```

**Global** (`~/.enpiistudio/` — user machine, not in repo):

```
~/.enpiistudio/
  config.toml
  credentials            # OS keychain preferred; file fallback if needed
  memory/                # durable notes (global + per-project subdirs)
    global/              # applies to all projects
    projects/<hash>/     # scoped by project root hash or slug
  sessions/
    projects/<hash>/
      <sessionId>.jsonl
  skills/                # user-global skills (*.md)
  logs/
  state.db               # optional SQLite index
```

**Skills**
- Markdown playbooks / procedures enpii may load on demand or by name
- Resolve order: **project** `.enpii/skills/` → **global** `~/.enpiistudio/skills/`
- Not automatic full dump into every prompt; listed + loaded when relevant (name match, user `/skill`, or agent tool `load_skill` later)

**Memory / sessions**
- Live only under global home — keeps repos clean, multi-clone safe
- Session path keyed by project identity (canonical root path hash)

---

## 5. Process model

v0 topology (locked):

```
enpiistudio.exe (Electron)
  ├── main process (Node/TS host)
  │     · IPC ↔ renderer
  │     · node-pty, fs jail, git, session store
  │     · spawns enpii sidecar
  ├── renderer (Svelte + Vite)
  └── enpii agent-core (Node/TS sidecar)
         ↕ stdio JSON-RPC 2.0
```

Locked decisions:
- **Shell:** Electron (not Tauri)
- **UI:** Svelte + Vite (not React / not SvelteKit)
- **agent-core:** local Node sidecar (not in renderer)
- **Transport main ↔ enpii:** **stdio JSON-RPC 2.0** (not localhost HTTP)
- **Transport main ↔ renderer:** Electron IPC + preload (`contextBridge`)

Rationale:
- Electron keeps whole app stack in TS/Node — faster solo iteration on Windows
- Sidecar isolates agent crashes from UI
- stdio avoids open ports / firewall noise

Later optional: run agent-core inside a utility process — keep JSON-RPC message shapes stable either way.

Each **enpii session** = one agent loop instance + transcript + permission context.  
Each **terminal pane** = one PTY, independent of agent sessions (agents may also request `run_shell` without showing a full interactive TUI).

---

## 6. Data flow — single agent turn

```
User prompt (UI)
  → host validates session + workspace
  → enpii appends user message
  → enpii builds request (system + tools + messages)
  → provider adapter → user AI endpoint
  → stream tokens/events → UI
  → on tool_use:
        enpii asks host to execute tool
        host checks permission policy
        if needs_approval → UI modal → user decision
        host executes (fs/shell/git)
        tool_result → enpii → continue loop
  → end_turn → UI idle
```

Streaming must surface:
- text deltas
- tool call start/args/result
- permission requests
- errors / cost / token usage (if endpoint provides)

---

## 7. Provider strategy

Internal canonical message model: **Anthropic-like** (`user` / `assistant` / `tool_result`, `tool_use` blocks).

Adapters:
| Adapter | When |
|---|---|
| `anthropic` | Primary path; Messages API shape |
| `openai` | Chat Completions (or Responses) + tools |

User configures:
- `base_url`
- `api_key` (or env)
- `model`
- `api_dialect`: `anthropic` | `openai`

enpii never assumes Anthropic-hosted Claude; endpoint is always user-owned/configured.

---

## 8. Tools (capability surface)

Tools run **in host**, declared **to model** by agent-core.

v0 tool set:
| Tool | Capability |
|---|---|
| `read_file` | Read text file under workspace |
| `write_file` | Create/overwrite file |
| `edit_file` | Apply patch / ranged edit |
| `glob` | File path patterns |
| `grep` | Content search (ripgrep) |
| `run_shell` | Command in workspace cwd |
| `git_status` | Porcelain status / diff summary |
| `list_dir` | Directory listing |

All paths normalized + confined to workspace root (and explicit extra mounts if ever added).

---

## 9. Permissions

Layers:
1. **Static policy** — deny globs (e.g. `.env`, `**/*.pem`), allow workspace root
2. **Mode** — `read_only` | `workspace_write` | `workspace_write_shell` | `full` (v0: start with confirm-on-write + confirm-on-shell)
3. **Interactive approval** — UI gate for mutating tools
4. **Hooks** (optional later) — pre/post tool scripts

Default v0 mode: **workspace write with confirmation** for `write_file` / `edit_file` / `run_shell`.  
Reads auto-allow inside workspace.

---

## 10. Session & storage

| Data | Location | Format |
|---|---|---|
| Transcript | `~/.enpiistudio/sessions/projects/<hash>/<id>.jsonl` | append-only events |
| Session index | `~/.enpiistudio/state.db` | SQLite metadata |
| Project config | `<project>/.enpii/config.toml` | TOML |
| User config | `~/.enpiistudio/config.toml` | TOML |
| Memory | `~/.enpiistudio/memory/**/*.md` | markdown |
| Skills (project) | `<project>/.enpii/skills/**/*.md` | markdown |
| Skills (global) | `~/.enpiistudio/skills/**/*.md` | markdown |
| Logs | `~/.enpiistudio/logs/` | text/jsonl |

Transcript is source of truth for resume. UI may cache projections.

---

## 11. Multi-pane / multi-session

v0:
- N agent sessions per project (each enpii instance)
- N terminals per project
- Shared editor buffer set
- No cross-agent orchestration bus yet

Future (not v0 architecture commitment):
- ClawTeam-like worktree isolation per agent
- Leader/worker task board
- Shared inbox

Extension point: `orchestrator` module later talks to same agent-core API.

---

## 12. Security architecture

Threats in scope (personal app):
- Agent deletes/wrecks repo
- Shell exfil / secret leak to logs
- Path escape (`../` outside workspace)
- Prompt injection via repo files instructing exfil

Mitigations:
- Workspace jail for all tools
- Deny list for sensitive paths
- Confirm mutations
- Redact known secret patterns in UI logs
- No auto-network tools in v0 except LLM endpoint
- `run_shell` optional allowlist mode

Out of scope v0: multi-user isolation, remote sandbox VM, SOC2.

---

## 13. Non-goals (architecture)

- Replacing git hosting
- Training models
- Marketplace of agents
- Mandatory cloud sync
- Bundling third-party coding CLIs as core runtime

---

## 14. Tech stack (locked for v0 docs)

| Layer | Choice |
|---|---|
| Desktop shell | **Electron** |
| UI | **Svelte + Vite** (not SvelteKit) |
| Main ↔ renderer | Electron IPC + preload |
| Main ↔ enpii | **stdio JSON-RPC 2.0** |
| Editor | Monaco |
| Terminal | xterm.js + `node-pty` |
| Agent runtime | TypeScript (Node sidecar) |
| Local store | SQLite + JSONL transcripts |
| Search | ripgrep (bundled or system) |
| LLM | User endpoint (Anthropic + OpenAI compatible) |
| Packaging | electron-builder (default assumption) |

---

## 15. Build vs borrow

| Need | Approach |
|---|---|
| Agent loop / tools / perms | Own `agent-core` (TS); **borrow patterns** from `reference/OpenHarness` (not Python port, not OH personality) |
| Multi-agent isolation | Own worktree sessions; **borrow** spawn/board ideas from `reference/ClawTeam` |
| Loop ops (schedule, gates, state spine) | **borrow** primitives from `reference/loop-engineering` when unattended loops matter |
| Desktop workspace | Own (Electron + Svelte) — not in those references |
| Third-party CLIs | Optional Terminal host adapters — not foundation |

Pinned trees live under repo `reference/` (git checkouts). They are **read-only design input**, not runtime dependencies.

### v1 absorb order (detail: `docs/progress.md`)

```
web_fetch/search → task_* → agent/send_message(+worktree)
  → plan/ask → parallel read tools → MCP resources
    → cron/schedule → ClawTeam mailbox/templates
```

---

## 16. Evolution path

```
v0  enpii single-agent + multi-pane workspace + git/term   ✅
    (+ early: worktree board, MCP, SSH, browser, packaging)
v1  reference-parity agent surface (web, tasks, sub-agent, plan/ask)
v2  loop ops (cron/durable schedule, richer swarm mailbox)
v3  polish: signed ship, search index, browser profiles, OAuth MCP as needed
```

Each version must keep **Agent Contract** backward-compatible or versioned.

---

## 17. Related docs

- [Design](./design.md) — UX and interaction design
- [PRD](./prd.md) — product requirements
- [Progress](./progress.md) — shipped vs next (includes `reference/` coverage table)
- [Rules](./rules.md) — engineering & agent policy rules
- [Schema](./schema.md) — contracts, configs, events
- `reference/OpenHarness|ClawTeam|loop-engineering` — pinned pattern sources (not runtime)
