# Terminal Product Requirements

Status: proposed
Date: 2026-08-04

## 1. Context and goal

EnStudio currently hosts a conventional xterm.js terminal. The replacement should preserve shell compatibility while making terminal work easier to inspect, repeat, search, and connect to the active project.

The primary experience is a chronological stream of command blocks. A block groups the command, output, working directory, Git context, timing, and result. The terminal remains a real PTY rather than a command runner, so prompts, password input, REPLs, watchers, SSH, and terminal applications continue to work.

## 2. Primary user

A single developer working locally in one or more EnStudio projects who wants:

- a terminal integrated with Agent, Code, and Git modes;
- durable and searchable command history;
- clear separation between commands and their output;
- fewer repeated commands and less lost context;
- compatibility with existing CLI tools without using another terminal window.

## 3. Product principles

1. **Real shell, better presentation.** Never emulate PowerShell/Bash semantics in the renderer.
2. **Block first, PTY always.** Blocks are a projection of the PTY stream, not a replacement transport.
3. **History is useful metadata.** Store command context, not only raw shell text.
4. **Code mode edits files.** Terminal compatibility exists for CLI programs, not to duplicate the editor.
5. **Local and private by default.** No terminal content leaves the device unless the user explicitly sends it to an external service.
6. **Graceful degradation.** Unknown shells and malformed markers remain usable as a classic xterm terminal.
7. **No silent execution.** Suggestions, history, and future AI assistance populate the composer but never execute automatically.

## 4. Goals

### P0

- Replace the current terminal center stage with command blocks for supported shells.
- Retain normal PTY behavior and process lifecycle.
- Support PowerShell 7 as the first fully integrated shell.
- Record command, cwd, timestamps, duration, and exit code.
- Provide searchable local history and rerun/edit actions.
- Accept continued input for prompts, REPLs, login flows, and watchers.
- Fall back to an embedded compatibility terminal when block rendering is insufficient.
- Preserve current project isolation, tabs, split panes, SSH launch, copy/paste, resize, and completion behavior where applicable.

### P1

- Windows PowerShell 5.1 integration.
- WSL Bash integration.
- Git context snapshot per completed command.
- Restore recent terminal sessions after renderer reload or app restart where the PTY is still alive.
- Configurable output persistence and retention.
- Export selected command blocks as plain text or Markdown.

### P2

- CMD integration.
- Rich history query grammar.
- Named/pinned commands and reusable snippets.
- Cross-project history when explicitly selected.
- Optional command explanation or generation after an explicit user action.

## 5. Non-goals

- Implementing a new shell language.
- Implementing terminal escape sequences from scratch.
- Replacing Code mode with Vim, Neovim, or another terminal editor.
- Guaranteeing structured blocks for every shell on the first release.
- Cloud synchronization of history.
- Storing full output without limits.
- Automatically executing generated commands.
- Becoming the Windows default terminal application in the first delivery.
- Replacing the agent `run_shell` tool; agent tool execution and user terminal sessions remain separate security domains.

## 6. User stories

### Command blocks

- As a developer, I can run `npm test` and see its command, output, cwd, exit code, and duration in one block.
- As a developer, I can copy only a command or only its output.
- As a developer, I can collapse a noisy completed block without losing its history.
- As a developer, I can rerun a previous command from its original directory or insert it into the composer for editing.

### Continued interaction

- As a developer, I can answer `Are you sure? (y/N)` without starting a second shell command.
- As a developer, I can use `python`, `mysql`, `ssh`, watch mode, and similar long-lived processes.
- As a developer, I can open a TUI program; EnStudio temporarily exposes a compatibility terminal surface and returns to block mode after the program exits its alternate screen.

### History

- As a developer, I can search by command text, project, cwd, exit status, and time.
- As a developer, I can use private mode so new commands and output are not persisted.
- As a developer, I can delete one entry, one session, one project's history, or all terminal history.
- As a developer, I can see when a command was redacted or intentionally not stored.

### Cross-mode behavior

- As a developer, I can open a path recognized in terminal output in Code mode.
- As a developer, I can open the active cwd in the project tree or system file manager.
- As a developer, switching modes does not kill the active PTY.

## 7. Functional requirements

### 7.1 Session and shell

- A terminal session MUST own exactly one PTY process.
- A session MUST have a stable identifier independent of its visible tab title.
- The first integrated profile MUST be PowerShell 7 (`pwsh`).
- If `pwsh` is unavailable, EnStudio MAY offer Windows PowerShell or the platform default shell in classic mode.
- Shell integration MUST be injected per spawned session and MUST NOT require permanent modification of the user's shell profile.
- Closing a tab with a running foreground process MUST require confirmation unless the user has disabled that warning.

### 7.2 Block lifecycle

A command block has these states:

```text
draft -> submitted -> running -> completed
                         |          |
                         |          +-> failed (non-zero exit)
                         +-> interrupted
                         +-> detached/unknown
```

- A block MUST be created from shell integration markers, not from guessing that every Enter key submits a command.
- Output MUST remain byte-order consistent with PTY delivery.
- Completion MUST record an exit code when the shell provides one.
- Missing or malformed markers MUST NOT prevent terminal use; the session changes to degraded/classic mode.
- A command block MAY remain running indefinitely for servers, watchers, REPLs, or remote sessions.

### 7.3 Input routing

- At a recognized shell prompt, the command composer MAY provide multiline editing and suggestions.
- While a foreground program owns input, keyboard data MUST be sent directly to the PTY.
- Password/hidden-input prompts MUST disable local echo, suggestion capture, and command persistence for the submitted secret value.
- `Ctrl+C` with an xterm selection copies; without a selection it MUST reach the PTY as interrupt.
- Paste MUST preserve the shell's bracketed-paste behavior when supported.

### 7.4 Compatibility surface

- The same xterm instance SHOULD remain attached throughout a session to avoid losing terminal state.
- When alternate-screen mode is detected, EnStudio MUST show the xterm surface for the active block/pane.
- Leaving alternate-screen mode MUST return to the block transcript without killing the process.
- Users MUST be able to force classic mode per session if block integration behaves incorrectly.
- Code mode remains the recommended file-editing surface; the compatibility surface is not labeled as an editor.

### 7.5 History

- History MUST be local-only by default.
- The durable record MUST support command text, shell profile, cwd, timing, exit code, session, project, persistence policy, and optional Git context.
- Output persistence MUST be disabled or bounded according to user settings.
- History search MUST not block PTY rendering.
- Replaying a history entry MUST show the command before execution.
- Running from the original cwd MUST validate that the path still exists and remains allowed for the session.

### 7.6 Sensitive content

- Private sessions MUST write no command text or output to durable history.
- EnStudio MUST support user-defined redaction patterns.
- Obvious secret-bearing commands SHOULD be marked `redacted` or `excluded` before persistence.
- Raw output MUST never be sent to an LLM merely to provide terminal history or suggestions.
- Keystrokes entered while the terminal reports hidden/no-echo input MUST never be mirrored or persisted by EnStudio. Content independently printed by the child process is still treated as untrusted output and remains subject to private mode, output policy, and redaction.

### 7.7 Git context

- Git metadata MUST be collected asynchronously.
- Git discovery MUST be bounded by timeout and cached by cwd/repository root.
- Git failure MUST not delay command submission or block completion.
- The initial snapshot MAY include repository root, branch/detached head, dirty state, ahead, and behind.

## 8. Non-functional requirements

### Performance

- Keystroke-to-PTY latency target: p95 below 16 ms inside the application process boundary.
- PTY output MUST render incrementally; persistence and Git work run off the hot path.
- Block transcript virtualization MUST keep sessions usable with at least 10,000 completed blocks.
- The renderer MUST cap retained raw output in memory and support lazy loading for persisted output.

### Reliability

- A renderer reload MUST not automatically kill host-owned PTYs.
- Database failure MUST degrade to non-persistent terminal use.
- Parser failure MUST degrade to classic mode.
- A failed shell-integration bootstrap MUST present a visible diagnostic and a retry/classic-mode action.

### Accessibility

- Every block action MUST be keyboard reachable.
- Exit status MUST not rely on color alone.
- History search, output, and the composer MUST have stable focus behavior and screen-reader labels.
- Reduced-motion settings MUST disable animated block transitions.

## 9. Acceptance criteria

```text
Given PowerShell 7 is installed
When a user opens Terminal mode
Then EnStudio starts a PTY in the active project directory and shows a ready composer

Given the prompt is ready
When the user runs `npm -v`
Then one block contains the command, streamed output, cwd, duration, and exit code

Given a command asks `Continue? (y/N)`
When the user types `y` and presses Enter
Then the input reaches the same foreground process and no second command block is created

Given a program enters the alternate screen
When its escape sequence reaches the renderer
Then the active block displays the compatibility terminal surface

Given that program leaves the alternate screen
When the shell prompt returns
Then the block transcript becomes primary again and the next command can be composed

Given history contains commands from multiple projects
When the user opens history from one project
Then results are project-scoped unless cross-project search is explicitly enabled

Given private mode is active
When commands complete
Then no command text or output is written to durable terminal history

Given shell markers become invalid
When the parser cannot recover within its bounded buffer
Then EnStudio keeps the PTY usable in classic mode and shows a non-blocking diagnostic
```

## 10. Success measures

- At least 95% of completed PowerShell commands produce one correctly bounded block in internal compatibility tests.
- No EnStudio-captured hidden-input keystrokes are observed in block or history tests.
- Existing SSH, pane, tab, resize, clipboard, and terminal process smoke tests continue to pass.
- A developer can use Terminal mode for a normal project session without opening an external terminal.

## 11. Open product questions

- Should output persistence default to off, metadata-only, or bounded text? Proposed: metadata-only until the user opts in.
- Should history retention be unlimited for metadata? Proposed: 180 days with a configurable unlimited option.
- Should classic mode be selectable per shell profile or only per session? Proposed: both.
- Should a rerun default to the current cwd or original cwd? Proposed: insert command in current composer; provide a separate “run from original directory” action.
