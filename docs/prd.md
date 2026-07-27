# PRD — enpiistudio

Status: draft v0  
Product name: **enpiistudio**  
Agent name: **enpii**  
Owner: personal / private product  
Last updated: 2026-07-27

---

## 1. Summary

**enpiistudio** is a local-first desktop workspace for AI-assisted software development.  
Its built-in agent **enpii** runs on the user’s own OpenAI- and Anthropic-compatible endpoint.  

The product combines:
- multi-pane agent + terminal + editor workflow (CLIMonkey-inspired)
- modern session-centric operator UX (Warp-inspired, partial)

It does **not** depend on third-party coding CLIs as the core agent.

---

## 2. Problem

Today the author must:
1. Pay or maintain multiple vendor CLIs (Claude Code, Codex, OpenCode, …)  
2. Juggle terminals and editors around those CLIs  
3. Accept each CLI’s baked-in personality, tool policy, and release churn  
4. Already own a capable multi-protocol AI endpoint — underused as a first-class agent backend  

Existing options:
| Option | Gap |
|---|---|
| Vendor CLIs | Lock-in, personality not owned, weak multi-pane workspace |
| CLIMonkey-class hosts | Great workspace; agent still external CLI |
| Warp-class ADE | Excellent UX; not “own harness + own endpoint” first |
| Raw API scripts | No durable workspace UX |

---

## 3. Goals

### 3.1 Product goals (v0)

1. Run **enpii** against user endpoint (Anthropic + OpenAI dialects)  
2. Open local projects; edit with Monaco; multi terminal panes  
3. Agent tools: read/search/edit/write/shell/git status with host-side permissions  
4. Multi enpii sessions per project  
5. Session resume from disk  
6. Daily-driver reliability on Windows (also macOS/Linux builds planned)

### 3.2 Strategic goals

- Own **agent contract** (prompts, tools, events, permissions)  
- Keep path open to multi-agent orchestration later without rewrite  
- Remain personal-scale: no multi-tenant cloud requirement  

### 3.3 Non-goals (v0)

- Replace third-party CLIs feature-for-feature on day one  
- Cloud-hosted agents / team admin / SSO  
- SSH remote project + 1-click tunnel (CLIMonkey parity extras)  
- Full Warp block terminal  
- Plugin marketplace  
- Mobile app  

---

## 4. Users

| Persona | Need |
|---|---|
| Primary: solo power user (author) | Own agent + workspace on own endpoint |
| Secondary: similar indie devs (later) | Same, if product ever shared |

v0 success = **author uses it daily instead of CLI host + vendor CLIs for most tasks**.

---

## 5. User stories

### Must (P0)

1. As a user, I can configure base URL, API key, model, and API dialect so enpii talks to my endpoint.  
2. As a user, I can open a local folder as a project.  
3. As a user, I can create an enpii session and chat with streaming responses.  
4. As a user, enpii can read and search my project files via tools.  
5. As a user, I must approve before enpii writes/edits files or runs shell.  
6. As a user, I can see a diff for proposed file changes.  
7. As a user, I can open multiple terminals in the project.  
8. As a user, I can stop an in-progress enpii run.  
9. As a user, I can reopen the app and continue a past session transcript.  
10. As a user, paths outside the project root are not writable by tools.

### Should (P1)

11. Git status + file diff + commit from UI.  
12. Multiple concurrent enpii sessions.  
13. `@file` / selection references in composer.  
14. Permission modes: Ask / Read-only / Autopilot-workspace.  
15. Token/usage display when endpoint returns usage.  
16. Project `AGENT.md` instructions honored by enpii.  
17. Project + global **skills** discoverable; load on demand (`/skill` or attach).

### Could (P2)

18. Global memory folder auto-injected (capped).  
19. Compact command for long sessions.  
20. Export transcript markdown.  
21. Optional OS notification on approval while unfocused.

### Later (explicit backlog)

Shipped early (beyond original Later list; still personal-scale):

- Worktree-isolated multi-agent board (ClawTeam *isolation* patterns)  
- MCP client (stdio + HTTP tools/list|call)  
- Host vendor CLIs as optional Terminal panes  
- SSH / tunnel + embedded browser  
- Block-ish terminal UX for shell/MCP tool cards  

### v1 agent surface (from `reference/` — see `docs/progress.md`)

Target = OpenHarness-class **tool surface** on enpii’s own contract, not a CLI clone:

| Priority | Capability | Primary reference |
|---|---|---|
| P0 | `web_fetch` + `web_search` | OpenHarness web tools |
| P1 | In-loop task board (`task_*`) | OpenHarness task tools |
| P1 | In-loop sub-agent + messaging | OH `agent` / ClawTeam spawn |
| P2 | Formal plan mode + ask-user | OH plan + ask_user |
| P2 | Parallel read-only tool exec | OH engine parallel tools |
| P2 | MCP resources (+ OAuth if needed) | OH MCP resources/auth |
| P3 | Schedule / cron durable fires | OH cron + loop-engineering automations |
| P3 | Swarm mailbox / templates | ClawTeam team layer |

Non-goals remain: marketplace, multi-tenant, mobile, full Warp redesign.

---

## 6. Scope by milestone

| Milestone | Outcome | Exit criteria |
|---|---|---|
| **M0** Spike | Sidecar enpii loop + endpoint | Read tool round-trip works headless |
| **M1** Shell | Electron app, open folder, editor, terminal | Daily file edit without agent |
| **M2** Agent R/O | enpii panel, stream, read/glob/grep | Useful Q&A on codebase |
| **M3** Mutating | write/edit + approvals + diff | Agent implements small change safely |
| **M4** Shell tool | run_shell + multi session + resume | Real tasks end-to-end |
| **M5** Git + polish | git panel, reliability, packaging | Author daily driver |
| **M6** Agent web + tasks | `web_*` + durable task board in-loop | Agent researches + tracks multi-step without leaving chat |
| **M7** Sub-agent | `agent` tool → worktree session + message | Model spawns isolated helper; user can still use board |
| **M8** Loop ops | plan/ask polish, parallel tools, cron optional | Unattended-friendly loops without leaving local-first model |

v0 product = **M5 complete** (2026-07).  
v1 agent = **M6–M8** guided by `reference/OpenHarness`, `reference/ClawTeam`, `reference/loop-engineering`.

---

## 7. Functional requirements

### 7.1 Project

- FR-P1 Open/close recent projects  
- FR-P2 Persist UI layout per project  
- FR-P3 `.enpii/` created on first agent use (`config`, `AGENT.md`, optional `skills/`)  
- FR-P4 Global `~/.enpiistudio/` holds `sessions/`, `memory/`, user `skills/`, logs

### 7.2 enpii agent

- FR-A1 Streaming generation  
- FR-A2 Tool loop until `end_turn` or stop  
- FR-A3 Anthropic dialect adapter  
- FR-A4 OpenAI dialect adapter  
- FR-A5 System prompt assembly: built-in minimal + user global + project `AGENT.md` + skills catalog  
- FR-A6 Cancel/stop  
- FR-A7 Error surfacing with retry  
- FR-A8 Skills resolve project → global; same name = project wins  
- FR-A9 Session transcripts written under global sessions path keyed by project hash

### 7.3 Tools

- FR-T1 `read_file`  
- FR-T2 `write_file`  
- FR-T3 `edit_file`  
- FR-T4 `glob`  
- FR-T5 `grep`  
- FR-T6 `run_shell`  
- FR-T7 `list_dir`  
- FR-T8 `git_status` (P1)

### 7.4 Permissions

- FR-S1 Workspace root jail  
- FR-S2 Deny sensitive globs (configurable)  
- FR-S3 Interactive approve for mutating tools in Ask mode  
- FR-S4 Session-level allow memory  

### 7.5 Desktop UX

- FR-U1 Multi-tab editor (Monaco)  
- FR-U2 Multi terminal (xterm + PTY)  
- FR-U3 enpii timeline + composer  
- FR-U4 Diff view for file changes  
- FR-U5 Settings for endpoint/model  

### 7.6 Persistence

- FR-D1 JSONL transcripts in `~/.enpiistudio/sessions/projects/<hash>/`  
- FR-D2 Session index (global SQLite)  
- FR-D3 User + project config TOML  
- FR-D4 Memory under `~/.enpiistudio/memory/`  
- FR-D5 Skills under project `.enpii/skills/` and `~/.enpiistudio/skills/`

---

## 8. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | App usable offline except LLM calls |
| NFR-2 | Agent tool path escape attempts hard-fail |
| NFR-3 | UI remains responsive while agent streams |
| NFR-4 | Windows 11 first-class; macOS/Linux buildable |
| NFR-5 | Crash of agent sidecar must not kill UI; reconnect/restart |
| NFR-6 | Transcript append durable after each turn event |
| NFR-7 | No telemetry required; if added later, opt-in only |
| NFR-8 | Secrets not written to project transcripts by settings UI |

---

## 9. Success metrics (personal product)

Qualitative / lightweight:
1. **Replacement rate** — % of coding agent tasks done in enpiistudio vs vendor CLIs (target: >70% after M5)  
2. **Trust** — zero silent destructive ops outside approvals  
3. **Resume works** — reopen session after restart without loss  
4. **Latency feel** — first token visible quickly; tool cards update live  
5. **Author NPS-to-self** — prefer opening enpiistudio over ad-hoc terminals for agent work  

No vanity DAU metrics in v0.

---

## 10. Constraints & assumptions

Assumptions:
- User endpoint supports tool/function calling in at least one dialect  
- `git` and shell available on PATH  
- Single user per machine install  

Constraints:
- Stack locked: **Electron** + **Svelte + Vite** UI + TypeScript agent-core + **stdio JSON-RPC**  
- License of borrowed code (e.g. MIT patterns from OpenHarness) must be respected if copied  
- v0 English UI strings OK; i18n later  

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Windows PTY fragility | Spike early; isolate terminal subsystem |
| Endpoint tool-call quirks | Dual adapters + conformance fixtures |
| Scope creep to CLIMonkey full clone | Enforce milestone exit criteria |
| Prompt injection via repo | Jail + deny list + no arbitrary network tools |
| Dirty editor vs agent write races | Explicit conflict policy |
| Over-borrowing OpenHarness personality | Rules doc: strip defaults; own `AGENT.md` |

---

## 12. Open questions (resolved for this draft)

| Question | Decision |
|---|---|
| Product name? | `enpiistudio` (lowercase, no spaces) |
| Agent name? | `enpii` |
| Stack? | Electron + Svelte/Vite + TS agent-core + stdio JSON-RPC |
| v0 scope? | Personal daily driver, local-first |
| Default agent? | Own agent only; vendor CLIs not foundation |
| Provider? | User endpoint; OpenAI + Anthropic supported |

Resolved (stack):
- UI framework: **Svelte**
- Sidecar transport: **stdio JSON-RPC 2.0**

Resolved (UI tooling):
- Webview app: **Vite + Svelte** (not SvelteKit)

Resolved (packaging default):
- **electron-builder** (NSIS/portable on Windows unless changed later)

Still open (non-blocking):
- Exact installer UX (NSIS vs portable-only, auto-update or not)

---

## 13. Launch definition (private v0)

v0 “launched” when author can:
1. Configure endpoint  
2. Open real project  
3. Ask enpii to implement a small feature with tests/commands  
4. Approve diffs and shell  
5. Commit via git panel or terminal  
6. Quit, reopen, resume  

No public marketing site required.

---

## 14. Related docs

- [Architecture](./architecture.md)  
- [Design](./design.md)  
- [Rules](./rules.md)  
- [Schema](./schema.md)  
