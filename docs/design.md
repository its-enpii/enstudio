# Design — EnStudio

Status: draft v0  
Product: **EnStudio** · Agent: **enpii**  
Scope: personal daily driver UI/UX

## Current design direction

The active preference is **macOS-inspired dark workspace chrome**: calm, compact, rounded, and reviewable. The UI should feel like a focused desktop tool, not a web dashboard and not a dense VS Code clone.

### Non-negotiables

- Near-black canvas, lifted panels, deep purple interaction, gold attention/running state.
- Compact spacing inside controls; breathable spacing only between major regions.
- Rounded cards and pills; avoid unnecessary borders, padding, and vertical gaps.
- Themed controls over native browser controls: use `SmartSelect`, `Switch`, and app dialogs.
- Destructive dialogs use explicit `Batal` / confirm actions; `Batal` receives initial focus.
- Never steal focus from an active input, select, modal, or attachment control.
- Agent composer stays usable and regains focus after a dialog closes when Agent mode remains active.
- One intentional scroll region per panel; avoid nested page/panel scrolling.

### Current interaction language

- Composer mode picker: `Manual`, `Accept Edits`, `Plan`, `Full Auto`.
- `Shift+Tab` cycles composer modes. `Alt+Tab` remains reserved for the operating system.
- Attachments support button, OS drag-and-drop, and copied files via `Ctrl/Cmd+V`.
- File navigation uses a collapsible tree with the active path visible.
- Worktree is presented as an isolated workspace; closing it clearly means discard after confirmation.
- Inspector contains contextual run/session/worktree information, not duplicate global settings.

---

## 0. Design authority

**Source of truth (in order):**
1. `docs/design/code.html` — live layout reference (open in browser)
2. `docs/design/screen.png` / `enstudio.png` — visual mockups
3. `docs/design/DESIGN.md` — tokens + brand notes
4. This file — product IA + milestones

App UI follows design — never the reverse. If code and design disagree, change the code.

## 1. Product feel

**One sentence:** A calm multi-pane workspace where *enpii* works on your repo like a pair programmer you control — not a chat toy, not a black-box CLI wrapper.

Keywords: local, explicit, parallel, interruptible, reviewable.

Anti-feel:
- Not “AI slot machine”
- Not crowded IDE clone of VS Code
- Not terminal-only purist (Warp depth comes later)
- Not auto-run everything

---

## 2. Primary user

Solo developer on Windows / macOS / Linux who:
- Has own OpenAI- + Anthropic-compatible endpoint
- Wants multi-session agents without paying / depending on Claude Code, Codex CLI, etc.
- Lives in project folders + git
- Accepts approving writes/shell early on

---

## 3. Core jobs-to-be-done

1. Open a project and see files + terminals + agent in one window  
2. Ask **enpii** to inspect / change code with visible tool steps  
3. Review diffs before they stick  
4. Run commands in real terminals alongside the agent  
5. Resume yesterday’s session  
6. Switch models/endpoints without changing workflow  

---

## 4. Information architecture

Canonical wireframe (source of layout truth):

```
┌────────────┬────────────────────────────────────┬────────────┐
│            │  top nav: Agent · Code · Terminal… │            │
│  LEFT      ├────────────────────────────────────┤  RIGHT     │
│  Project   │                                    │  Inspector │
│  sidebar   │  CENTER — main stage               │  · tokens  │
│  (list)    │  (content depends on nav mode)     │  · diffs   │
│            │                                    │  · sessions│
│            ├────────────────────────────────────┤  · meta    │
│            │  composer / mode footer (context)  │            │
└────────────┴────────────────────────────────────┴────────────┘
```

### 4.1 Regions

| Region | Role |
|---|---|
| **Left — Project sidebar** | List of projects (recent + pinned). Select active project. Add/open folder. Not a file tree primary. |
| **Top — Mode navbar** | Switches **center stage** mode: `Agent` · `Code` · `Terminal` · (later: `Git` · `Search` · `Logs`) |
| **Center — Main stage** | Primary work surface for the active mode |
| **Center bottom — Context footer** | Mode-specific: agent composer, terminal tabs strip, or editor status |
| **Right — Inspector** | Contextual intel: token/usage, file diffs, session history, approval queue, run status |

Default open: **Agent** mode + last project.

### 4.2 Mode → center content

| Nav mode | Center main | Center footer |
|---|---|---|
| **Agent** | enpii timeline (chat + tool cards) | Composer + attach + send/stop |
| **Code** | Monaco editor + file tabs; optional mini file tree inside stage | Tab bar / path / dirty state |
| **Terminal** | xterm session(s), split optional later | Terminal tabs + cwd |
| **Git** (P1) | Status + diff list | Commit form |
| **Logs** (P2) | Diagnostics stream | Filter |

### 4.3 Right inspector (persistent)

Always visible (collapsible width). Sections stacked / accordion:

1. **Run / model** — model name, permission mode, stop, status (`idle` / `running` / `awaiting_approval`)  
2. **Tokens** — input / output / total for current turn + session (when endpoint returns usage)  
3. **Diffs** — pending + recent file changes from enpii; click → expand unified diff or jump to Code mode  
4. **Sessions** — history list for current project; switch / new / archive  
5. **Approvals** — sticky when non-empty (may also pin as modal/bar over center)

Inspector follows **active project + active session**, not global app state only.

### 4.4 Left project sidebar

- Search/filter projects  
- Items: name, path short, last opened, running-agent badge  
- Actions: Open folder, Remove from list, Pin  
- Selecting project swaps center + inspector context  

File tree lives under **Code** mode (center), not as the left primary rail — avoids VS Code clone feel; left rail = **portfolio of projects**.

---

## 5. Key surfaces

### 5.1 Agent mode (center) — primary enpii UX

Anatomy:
1. **Session strip** (optional thin bar under nav) — session title, model chip  
2. **Timeline** — assistant text, tool cards, system notices  
3. **Composer** (center footer) — multi-line input, `@file` / selection refs, send  
4. **Approvals** — prefer right inspector; critical ones may toast over composer  

Timeline item types:
- User message  
- Assistant markdown  
- Tool call card: name, args summary, status (running/ok/fail), expand raw  
- Diff hint card: path +/− → focuses inspector Diffs  
- Error / retry  

Rules:
- Tool noise collapsible; default one-line summary  
- Long shell output truncated; “open in Terminal mode”  
- **Stop** aborts stream; available in inspector + composer  

### 5.2 Code mode (center)

- Monaco, multi-tab  
- Nested file tree (collapsible) on left edge of center stage only  
- Open from tree, tool results, inspector diffs  
- Dirty buffer indicator  
- Agent writes: host → disk → if buffer dirty on same file → conflict prompt  

Conflict policy v0: block overwrite of dirty buffer until user chooses overwrite / keep.

### 5.3 Diff review

Primary home: **right inspector → Diffs**.  
Full-screen optional: open in Code mode split (later).

Flow v0:
1. enpii proposes `edit_file` / `write_file`  
2. Approval + diff preview (inspector)  
3. User Approve → host applies  
4. Transcript records applied patch  

Actions: Approve / Deny / Open in Code / Copy patch.

### 5.4 Terminal mode (center)

- xterm.js per PTY  
- Project cwd default  
- Independent of enpii `run_shell` (non-interactive tool)  
- Multi-tab terminals in center footer strip  

### 5.5 Git (P1 — nav item)

- Branch, changed files, diff, stage, commit  
- No PR hosting in v0  

### 5.6 Cross-mode navigation rules

- Click path in Agent timeline → Code mode on that file  
- Click diff in inspector → expand here; double-click → Code mode  
- “Open in terminal” on shell tool → Terminal mode  
- Mode switch **does not** kill running enpii session  


---

## 6. Session model (UX)

**Session** = named enpii conversation bound to one project root.

User can:
- Create session (“New enpii”)  
- Rename  
- Archive / delete  
- Duplicate context (optional later)  

Session list shows: title, last active, model, running indicator.

Parallel sessions allowed. No automatic shared chat memory between sessions in v0.  
Shared inputs: project `AGENT.md`, project/global **skills**, optional global **memory** store (`~/.enpiistudio/memory`).  
Transcripts live globally per project hash — not inside the git repo.

---

## 7. Composer UX

Inputs:
- Text (markdown)  
- References: `@file`, `@selection`, drag path from tree  
- Slash commands (minimal v0): `/clear`, `/mode`, `/model`, `/compact`

Send behavior:
- Enter send (configurable)  
- Shift+Enter newline  
- Disable send while streaming unless queue mode (v0: no queue; wait or stop)

---

## 8. Permission UX

When tool needs approval:

```
┌ enpii wants to edit src/app.ts ──────────────┐
│ 12 lines changed · view diff                 │
│ [Deny]  [Allow once]  [Allow for session]    │
└──────────────────────────────────────────────┘
```

Shell:

```
┌ enpii wants to run shell ────────────────────┐
│ pnpm test --filter api                       │
│ cwd: F:/.../project                          │
│ [Deny]  [Allow once]  [Allow for session]    │
└──────────────────────────────────────────────┘
```

Keyboard: `Y` allow once, `N` deny, `S` allow session (when focused).

Modes exposed in header:
- **Ask** (default) — confirm writes + shell  
- **Read-only** — no mutating tools  
- **Autopilot workspace** — auto-allow writes in root; still ask shell (optional toggle)

---

## 9. Empty states

| State | Message / CTA |
|---|---|
| No project | “Open a folder to start” |
| Project, no session | “Start enpii” primary button |
| No endpoint configured | Blocking setup card: base URL, key, model, dialect |
| Agent error | Inline error + retry + open logs |

Onboarding v0: single settings sheet, not multi-step wizard.

---

## 10. Visual language

### 10.1 Brand palette (anchors)

Empat warna inti — **wajib jadi pusat** semua UI. Boleh pakai warna turunan / pendukung lain, **asal tidak jauh** dari keempat ini (tint, shade, opacity, slight hue shift dalam keluarga yang sama).

| Token | Name | Hex | Usage |
|---|---|---|---|
| `--color-purple` | Deep Purple | `#3D348B` | Primary brand, nav active, key buttons, focus ring |
| `--color-gold` | Gold | `#E6AF2E` | Accent, running/attention, highlights, badges |
| `--color-offwhite` | Off-White | `#F3F3F3` | Light surfaces, text on dark, light-mode bg |
| `--color-nearblack` | Near-Black | `#040303` | Dark-mode bg, primary text on light, chrome |

**Aturan turunan**
- Surface, border, hover, disabled → mix / opacity dari purple · gold · off-white · near-black  
- Boleh lavender/plum soft dari purple, amber soft dari gold, warm gray dari near-black+off-white  
- Jangan masuk hue asing (cyan neon, pink hot, hijau branding) untuk chrome  
- Semantic success/danger: boleh hijau/merah **desaturated**, kecil, hanya status — bukan aksen brand baru  

Contoh turunan (boleh diganti selama tetap dekat):

| Token | Role | Guidance |
|---|---|---|
| `--surface-0` | App background | Near-Black dark / Off-White light |
| `--surface-1` | Sidebar / inspector | Near-black + slight purple lift |
| `--surface-2` | Cards / timeline | Satu step di atas surface-1 |
| `--border` | Dividers | Purple ~20–30% opacity atau warm gray dekat near-black |
| `--text-primary` | Body | Off-White on dark; Near-Black on light |
| `--text-muted` | Secondary | Off-White ~55–65% |
| `--accent` | CTA / active | Deep Purple (+ lighter hover) |
| `--accent-hot` | Running / token pulse | Gold (+ softer gold muted) |
| `--success` | Tool ok | desaturated green, minimal |
| `--danger` | Fail / deny | desaturated red, minimal |

### 10.2 Theme

- **Dark-first** default: Near-Black canvas, Off-White text, Purple interactive, Gold attention  
- Light mode: Off-White canvas, Near-Black text, same Purple/Gold family  
- Accent di luar 4 warna inti: hanya lewat turunan dekat, bukan palet baru

### 10.3 Layout chrome (locked to mockup)

Floating cards on Near-Black canvas — **not** edge-to-edge IDE chrome.

| Token | Value | Use |
|---|---|---|
| `--space` | `8px` | Outer pad + gap antar panel (sidebar/center/inspector) + gap nav↔stage |
| `--radius-lg` | `24px` | Major panels (sidebar, stage, inspector) |
| `--radius-md` | `18px` | Top nav card, empty-state mark, dashed placeholders |
| `--radius-sm` | `12px` | Inner cards, bubbles, inputs |
| `--radius-xs` | `8px` | Buttons, icons |

Shell grid: `padding: 8px; gap: 8px; columns: 248px 1fr 300px`.  
Center column stacks **nav card** + **stage card** with `8px` gap (nav is its own rounded panel, not a strip glued to stage).

### 10.4 Typography & density

- UI: clean grotesque (system or one webfont)  
- Code: JetBrains Mono / system mono  
- Dense but not cramped; 8px spacing grid  
- Tool cards: subtle border; **running = Gold**, ok = success, fail = danger  
- Active nav item: Deep Purple pill  
- Primary button: Deep Purple bg + Off-White text  
- Destructive secondary: outline; confirm uses clear label  

### 10.5 Motion

- Respect `prefers-reduced-motion`  
- Stream tokens: no heavy blur/gradient marketing motion  
- Gold pulse allowed only on “running” indicator (subtle)  

No brand mascot required in v0 UI.

---

## 11. Keyboard map (v0 baseline)

| Shortcut | Action |
|---|---|
| `Ctrl+1` | Mode: Agent |
| `Ctrl+2` | Mode: Code |
| `Ctrl+3` | Mode: Terminal |
| `Ctrl+L` | Focus enpii composer (Agent mode) |
| `Ctrl+P` | Quick open file (Code) |
| `Ctrl+B` | Toggle left project sidebar |
| `Ctrl+Shift+I` | Toggle right inspector |
| `Ctrl+Enter` | Send (composer) |
| `Esc` | Stop generation (when streaming) / blur |

Exact bindings configurable later; document defaults in app.

---

## 12. Notification & running state

- Gold indicator on Agent nav + project row while loop active  
- Inspector status: `enpii · running · tool:grep`  
- OS notification optional when approval needed and window unfocused (P2)  


---

## 13. Content patterns

### Assistant text
- Markdown render; code fences copy button  
- File paths clickable → open editor  

### Tool card summary examples
- `read_file src/main.ts`  
- `edit_file src/main.ts (+12 −3)`  
- `run_shell pnpm test` (exit 0, 3.2s)  
- `grep "TODO" src/**` (14 hits)

### Errors
Human first line + expandable detail. Never dump raw stack into composer.

---

## 14. Desktop platform notes

- Windows 11 primary dev target (ConPTY realities)  
- Native window controls via Electron  
- File drop into composer / terminal where sensible  
- Remember window layout per project  

---

## 15. Accessibility (minimum)

- Focus rings visible  
- Approval buttons keyboard reachable  
- Contrast AA for text  
- Screen reader labels on icon-only controls  

---

## 16. Out of scope for design v0

- Block-based Warp terminal redesign  
- In-app browser preview  
- Mobile layout  
- Collaborative multi-user cursors  
- Marketplace themes  
- WhatsApp / chat gateways  

---

## 17. Design milestones

| Milestone | UX outcome |
|---|---|
| M1 | Shell chrome: left projects, top nav modes, center Code + Terminal, right inspector shell |
| M2 | Agent mode timeline + stream + read-only tools; tokens in inspector |
| M3 | Write/edit approvals + inspector diffs |
| M4 | Shell tool + multi session history in inspector |
| M5 | Git mode basic + polish palette/layout persistence |

---

## 18. Related docs

- [Architecture](./architecture.md)  
- [PRD](./prd.md)  
- [Rules](./rules.md)  
- [Schema](./schema.md)  
