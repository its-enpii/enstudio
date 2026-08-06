# Terminal UX Design

Status: proposed
Date: 2026-08-04

## 1. Experience statement

Terminal mode should feel like a project work log that is still fully compatible with real command-line programs. Completed work is readable as blocks; live programs receive direct terminal input; Code mode remains the place for editing files.

The visual reference is a dark, low-chrome command transcript with contextual metadata above each command, compact actions, and a persistent composer at the bottom.

## 2. Information architecture

```text
TerminalStage
├── Session tabs
├── Pane workspace
│   └── Terminal session view
│       ├── Transcript viewport
│       │   ├── Session notice blocks
│       │   ├── Command blocks
│       │   └── Active compatibility surface
│       └── Sticky composer
├── History drawer
└── Session/profile menu
```

Terminal state remains project-scoped. Switching project restores that project's tabs and pane arrangement without killing another project's running sessions.

## 3. Command block

```text
┌─────────────────────────────────────────────────────────────┐
│ F:\workspace\project   main*   exit 0   342 ms   10:14:08 │
│ npm -v                                                      │
│ 11.15.0                                                     │
│                                                             │
│ Copy command · Copy output · Edit · Run again · More        │
└─────────────────────────────────────────────────────────────┘
```

### Header

Display, in priority order:

1. cwd relative to project when possible;
2. Git branch and dirty indicator when available;
3. running/result state;
4. duration;
5. completion time.

Metadata wraps or collapses before the command text loses usable width. Exit state always has an icon/text label in addition to color.

### Command

- Render as selectable monospace text.
- Preserve multiline structure.
- Provide a separate copy action.
- Never show hidden input.
- A redacted command displays a clear placeholder, not misleading partial text.

### Output

- Stream while running.
- Preserve ANSI styling supported by the transcript renderer or provide an xterm-backed output region.
- Link recognized workspace paths to Code mode only after safe path resolution.
- Truncate visually large completed output with “Show more”; do not discard live PTY state.
- Allow collapse/expand.
- Mark output that was not persisted or was truncated.

### Actions

Primary actions:

- Copy command.
- Copy output.
- Edit in composer.
- Run again.

Secondary menu:

- Run from original directory.
- Open cwd.
- Pin command.
- Export block.
- Delete history entry.
- Report integration issue/start classic session.

“Run again” MUST either populate a visible confirmation/composer state or be an explicitly configured shortcut. It never runs from a hover action without a deliberate activation.

## 4. Composer states

The bottom composer is sticky within each pane and has four states.

### 4.1 Prompt ready

```text
[folder project/path] [branch main] [pwsh] [private off]
> npm test_
```

Capabilities:

- multiline editing;
- command/path/history suggestions;
- current cwd and shell profile;
- private-mode indicator;
- `Enter` submits when single-line;
- `Shift+Enter` inserts newline;
- configurable alternative: `Ctrl+Enter` submits multiline.

Suggestions must be visibly local/history-based unless the user invokes an external assistant action.

### 4.2 Foreground input

When a program owns stdin:

```text
npm create ...
Package name: _
```

- Composer label changes to “Input to running process”.
- Input is forwarded to the active PTY.
- History suggestions and command metadata capture are disabled.
- If terminal echo is active, output appears in the running block as emitted by the PTY.
- When the terminal reports hidden/no-echo input, EnStudio neither mirrors nor retains the user's keystrokes. A child process can still print its own text, so private mode remains the recommended control for sensitive sessions.

### 4.3 Running without expected input

For servers/watchers:

- Composer remains in foreground-input state because the process may still accept keys.
- A prominent interrupt button sends `Ctrl+C`.
- A separate terminate action is available in the block menu.
- Starting another shell command requires a new tab/session, not fake multiplexing in the same shell.

### 4.4 Session exited

- Composer is disabled.
- Show exit code and actions: Restart same profile, Duplicate session, Close tab.
- Existing transcript remains readable.

## 5. Compatibility surface

The compatibility surface exists for any program that controls terminal state, not specifically for editing files.

Triggers:

- alternate-screen mode;
- unsupported cursor-addressing behavior in the block projection;
- user-selected classic mode.

Presentation:

```text
┌─ running block: lazygit ────────────────────────────────┐
│ [xterm.js compatibility surface occupies available area]│
└─────────────────────────────────────────────────────────┘
```

Rules:

- Keep the xterm surface in the active block/pane.
- Route all keyboard and mouse terminal events directly to the PTY.
- Hide normal block actions while the surface has focus, except interrupt/terminate and escape/help.
- On alternate-screen exit, restore the transcript scroll position and focus the composer if the shell prompt is ready.
- Offer “Open file in Code mode” only through explicit path actions; do not intercept Vim/Neovim keystrokes.
- The user can force the entire session into classic mode from the session menu.

## 6. History experience

### Entry points

- `Ctrl+R` opens project-scoped history.
- History icon opens a side drawer.
- Up arrow at an empty ready composer selects recent commands from the current cwd first.

### Search

Initial search is simple text with filter chips:

- Project/current project.
- cwd.
- Shell.
- Exit: success/failure/interrupted.
- Time range.
- Pinned only.

P2 query syntax may add:

```text
npm cwd:gateway exit:1 since:7d shell:pwsh
```

### Result row

```text
npm install
…\whatsapp-gateway · main · exit 0 · 12.4 s · 2 days ago
```

Actions:

- Enter: insert into composer.
- `Ctrl+Enter`: run after explicit visible confirmation, if enabled.
- Open original session/block.
- Run from original cwd.
- Pin/delete.

History never silently changes the active cwd.

## 7. Session tabs and panes

The current tab/pane behavior is retained with these refinements:

- Tab title defaults to cwd folder or active foreground process when reliable.
- Running, attention-required, private, degraded, and exited states receive compact indicators.
- A pane owns its own composer and focus.
- Split duplicates the shell profile and starts in the current cwd; it does not clone process state.
- Closing the last visible pane does not automatically delete persisted history.

## 8. Cross-mode interactions

### Terminal to Code

- `Ctrl+click` a verified workspace path opens it in Code mode.
- A file and line pattern such as `src/app.ts:42` opens the line when parsing is unambiguous.
- Paths outside the project require an explicit external-open action and remain subject to existing app policy.

### Code to Terminal

- “Open terminal here” creates or focuses a session at the selected file's directory.
- “Run selected text” only populates the composer; it does not execute automatically.

### Agent to Terminal

- “Open in terminal” from an agent shell tool inserts the command or opens its cwd.
- Agent approvals do not grant terminal commands additional permissions; the terminal is direct user control.

## 9. Keyboard map

| Shortcut | Behavior |
|---|---|
| `Ctrl+R` | Open terminal history |
| `Ctrl+Shift+T` | New terminal session |
| `Ctrl+Shift+W` | Close active terminal tab with running-process confirmation |
| `Ctrl+PageUp/Down` | Previous/next terminal tab |
| `Ctrl+Shift+\` | Split active pane |
| `Ctrl+C` | Copy selection; otherwise send interrupt |
| `Ctrl+Shift+C` | Always copy selection/text when available |
| `Ctrl+Shift+V` | Paste to composer or PTY according to state |
| `Shift+Enter` | Newline in ready composer |
| `Escape` | Close history/menu; does not terminate a process |

Application shortcuts must not consume keys while an alternate-screen program owns them, except a documented escape chord for application chrome.

## 10. Empty, degraded, and error states

### No shell profile

```text
No supported shell was found.
[Configure profiles] [Retry detection]
```

### Integration unavailable

```text
Command blocks are unavailable for this session.
The shell is still usable in compatibility mode.
[Start classic terminal] [View diagnostic]
```

### History unavailable

Show a single non-blocking notice. The terminal continues without durable history; do not repeat a toast for every command.

### Output omitted

Use explicit labels:

- “Output not saved by preference.”
- “Saved output truncated at 1 MiB.”
- “Private session — history not saved.”

## 11. Privacy controls

Session menu:

- Start private session.
- Save command metadata: on/off.
- Save bounded output: on/off.
- Output limit.

Settings:

- retention period;
- cross-project history default;
- redaction patterns;
- clear project/all history;
- default classic/block mode per profile.

Private state is always visible near the composer and tab; it must not be a hidden settings-only mode.

## 12. Accessibility

- Transcript has document semantics; each block has an accessible command label and status.
- Live output uses restrained announcements to avoid flooding screen readers.
- Focus returns predictably after history selection, block action, or compatibility exit.
- All status chips have text equivalents.
- Hit targets meet the app's existing control-size standard.
- Selection and focus remain distinguishable in both dark and light themes.

## 13. Responsive behavior

- Under narrow width, metadata collapses into a summary menu.
- In split panes, actions become icon buttons with tooltips.
- The composer stays at least three visible text rows when multiline.
- Compatibility xterm gets priority over decorative metadata.
- Transcript virtualization must not change scroll position when older blocks load.

## 14. UX acceptance scenarios

```text
Given a completed command has 20,000 output lines
When the user returns to the block
Then the transcript stays responsive and the output is collapsed/virtualized

Given the composer is ready and empty
When the user presses Up
Then the nearest relevant history command is inserted without executing

Given a foreground process asks for a password
When the user types
Then no characters, suggestion, or history row exposes the password

Given a TUI is active
When the user presses its navigation keys
Then the application does not steal them for tab or history navigation

Given a recognized workspace path appears in output
When the user activates it
Then Code mode opens the verified file and optional line
```
