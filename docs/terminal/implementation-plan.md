# Terminal Implementation Plan

Status: proposed
Date: 2026-08-04

## 1. Starting point

The current implementation already provides:

- Electron main-process PTY ownership with `node-pty`;
- preload-isolated terminal IPC;
- xterm.js rendering and fitting;
- tabs and two-pane split support;
- project-scoped terminal workspace state;
- SSH profile launch;
- path command completion/ghost suggestions;
- terminal use inside Agent mode for vendor CLIs.

The new feature should preserve those behaviors while decomposing the large terminal component and adding host-owned structured state.

## 2. Delivery strategy

Use vertical slices behind a feature flag. Every slice must leave classic terminal mode usable. Avoid a one-shot rewrite of `TerminalStage.svelte`.

Proposed flag:

```ts
terminal: {
  blocks: {
    enabled: false
  }
}
```

The flag begins as developer-only, then becomes a user setting during compatibility testing, then defaults on for supported PowerShell profiles.

## 3. Phase 0 — characterization and extraction

### Goals

- Freeze current behavior with targeted tests/self-checks.
- Move PTY concerns out of `electron/main.ts` without behavior changes.
- Move terminal workspace state out of the monolithic Svelte component.

### Proposed modules

```text
apps/desktop/electron/terminal/
├── terminalHost.ts
├── shellProfiles.ts
├── pathCompletion.ts
└── types.ts

apps/desktop/src/lib/terminal/
├── terminalWorkspace.svelte.ts
├── xtermSession.ts
├── types.ts
└── classic/
    └── ClassicTerminalPane.svelte
```

### Verification

- Existing terminal opens in project cwd.
- Tabs, rename, split, project switch, SSH, resize, zoom, copy/paste, ghost completion, close, and exit behavior remain unchanged.
- `npm run typecheck:desktop` and the existing build pass.

### Rollback

Revert extraction commits; no persistence or behavior migration exists yet.

## 4. Phase 1 — typed host protocol and live-session ownership

### Goals

- Introduce typed session APIs alongside current IPC.
- Keep PTYs alive across renderer reload.
- Add sequence numbers, snapshots, subscriptions, and acknowledgements.

### Host work

- Replace ad hoc PTY map values with `TerminalSessionHost` records.
- Validate cwd/profile/dimensions/write size.
- Add a bounded event journal per session.
- Associate sessions with project and window context.
- Add graceful app-shutdown behavior.

### Renderer work

- Subscribe/replay rather than relying only on global `terminal:data` listeners.
- Reattach xterm instances after remount.
- Show a truncation notice when replay history is incomplete.

### Tests

- Renderer unsubscribe/re-subscribe.
- PTY continues while Terminal mode is hidden.
- Renderer reload recovers a live command.
- Invalid/foreign session ids are rejected.

### Exit criterion

Classic terminal UI runs entirely through the new typed protocol while the old IPC remains available only for rollback.

## 5. Phase 2 — PowerShell integration and parser

### Goals

- Produce reliable prompt/command/completion events for PowerShell 7.
- Keep visible prompt and PSReadLine behavior intact.

### Work

- Add temporary bootstrap generator.
- Add per-session nonce and protocol version.
- Implement streaming OSC parser as a state machine.
- Emit integration diagnostics and degraded mode.
- Add fixture scripts for normal, multiline, failed, interrupted, prompt-input, and long-running commands.

### Required tests

- Marker split at every byte boundary.
- Multiple markers plus normal output in one chunk.
- Payload Unicode and long cwd.
- Fake marker with wrong nonce.
- User profile error.
- `Ctrl+C` and shell recovery.
- Multiline PowerShell command produces one block.

### Exit criterion

At least 95% of the PowerShell compatibility corpus maps to correct block boundaries, and any failure remains usable in classic mode.

## 6. Phase 3 — command-block transcript

### Goals

- Add the new primary visual experience without changing host execution semantics.

### Proposed renderer modules

```text
apps/desktop/src/lib/terminal/blocks/
├── BlockTerminalPane.svelte
├── CommandTranscript.svelte
├── CommandBlock.svelte
├── CommandComposer.svelte
├── SessionNoticeBlock.svelte
├── commandReducer.ts
└── transcriptVirtualizer.ts
```

### Work

- Build blocks from host events.
- Attach one xterm instance to the active running region/compatibility surface.
- Add collapse, copy, edit, rerun, interrupt, terminate, and open-cwd actions.
- Preserve selection and scroll position.
- Virtualize completed blocks and cap in-memory output.
- Add force-classic action.

### Exit criterion

Normal PowerShell work can be completed entirely in block mode while TUI/unsupported behavior can fall back without restarting the application.

## 7. Phase 4 — history persistence and search

### Goals

- Add first-party local history using desktop-owned `~/.enpiistudio/terminal/history.db`.
- Keep persistence off the PTY hot path.

### Host work

```text
apps/desktop/electron/terminal/history/
├── terminalHistoryRepository.ts
├── terminalHistoryMigration.ts
├── terminalHistorySearch.ts
├── terminalRedaction.ts
└── terminalRetention.ts
```

- Create the terminal database and apply versioned schema migrations.
- Queue command start/finalization writes.
- Add metadata-only default policy.
- Add private session and redaction/exclusion.
- Add cursor-based project-scoped search.
- Add deletion and pin operations.

### Renderer work

```text
apps/desktop/src/lib/terminal/history/
├── TerminalHistoryDrawer.svelte
├── TerminalHistoryRow.svelte
└── terminalHistoryState.svelte.ts
```

- Add `Ctrl+R` and filter chips.
- Insert selected command into composer.
- Add original-cwd action with path validation.
- Add privacy/persistence indicators.

### Required tests

- Private mode creates no rows.
- Output limit truncates persistence, not live output.
- Delete cascades output chunks.
- Project scoping is default.
- Equal-timestamp pagination is stable.
- Database unavailable degrades without terminal failure.

### Exit criterion

A user can search, edit, rerun, pin, and delete terminal commands with no external shell-history dependency.

## 8. Phase 5 — compatibility surface and interaction hardening

### Goals

- Make prompts, REPLs, watchers, SSH, and alternate-screen programs reliable.

### Work

- Track prompt/foreground/hidden-input states.
- Switch composer into direct-input mode.
- Detect alternate-screen entry/exit from xterm terminal state.
- Define application escape chord while TUI owns keyboard input.
- Confirm termination of running processes.
- Verify SSH and remote shells degrade correctly if nested integration is absent.

### Compatibility corpus

```text
pwsh prompt question
npm create
python REPL
php artisan tinker
mysql client
ssh localhost fixture
npm test -- --watch
node development server
fzf
lazygit or a deterministic alternate-screen fixture
```

### Exit criterion

All corpus cases either work in structured mode or visibly and safely use classic compatibility mode.

## 9. Phase 6 — Git context and cross-mode links

### Goals

- Add project context without delaying command execution.

### Work

- Introduce timeout-bounded Git context cache.
- Enrich completed blocks asynchronously.
- Resolve output paths against cwd/project root.
- Open verified paths in Code mode with optional line/column.
- Add Code mode “Open terminal here” and “Insert selection into terminal”.

### Security checks

- Reject traversal outside project for Code-mode open.
- Require explicit external-open behavior for outside paths.
- Never execute output text as a command.

## 10. Phase 7 — additional shells

Order:

1. Windows PowerShell 5.1.
2. WSL Bash.
3. CMD only if structured integration is reliable enough; otherwise retain classic mode.

Each shell adapter owns only bootstrap/marker behavior. PTY session, history, transcript, and security code remain shared.

## 11. Proposed file ownership changes

Existing files expected to change during implementation:

- `apps/desktop/electron/main.ts`: delegate terminal IPC to terminal host.
- `apps/desktop/electron/preload.ts`: expose typed terminal API.
- `apps/desktop/src/lib/components/TerminalStage.svelte`: become a composition/root component rather than owning all behavior.
- `apps/desktop/src/lib/store.svelte.ts`: terminal settings and feature flag only if global UI state is appropriate.
- `apps/desktop/src/lib/i18n/en.ts` and `apps/desktop/src/lib/i18n/id.ts`: terminal labels and errors.
- `apps/desktop/package.json`: no new runtime dependency expected for the initial slices.

New files should live under dedicated `electron/terminal` and `src/lib/terminal` directories. Avoid placing history behavior in `agent-core`; terminal sessions are a desktop-host concern.

## 12. Test strategy by layer

| Layer | Tests |
|---|---|
| Pure TypeScript | parser, reducer, redaction, query normalization, retention selection |
| Electron host | spawn fixture shell, IPC validation, process lifecycle, renderer replay |
| Svelte components | focused interaction tests where infrastructure exists; otherwise extracted pure reducers plus smoke checks |
| Packaging | Windows packaged app loads `node-pty`, bootstrap script, and writable state database |
| Manual | keyboard, selection, zoom, TUI, SSH, Unicode, project switching |

Do not introduce a broad UI test framework solely for this feature if the repository has none. Prefer pure state reducers and host integration fixtures, then add narrow component tests when existing tooling supports them.

## 13. Observability and diagnostics

Add counters/timings to local structured logs:

- PTY spawn time and failure category;
- integration activation/degraded reason;
- parser error count;
- event replay/truncation;
- persistence queue depth/failure;
- history search duration/result count;
- Git enrichment duration/timeout;
- output persistence truncation.

Never log raw command, output, environment, or hidden input by default.

## 14. Release gates

### Developer preview

- PowerShell 7 only.
- Feature flag off by default.
- Metadata history off by default until privacy tests pass.

### Opt-in preview

- Block mode selectable in Settings.
- Metadata-only history default for newly opted-in sessions.
- Visible classic-mode escape and diagnostics.

### Default for supported profiles

- Compatibility corpus passes on packaged Windows build.
- Crash/reload recovery passes.
- Private-mode and no-echo keystroke-capture tests pass.
- Performance targets pass for output flood and 10,000-block transcript fixtures.
- No regression in current tabs, panes, SSH, clipboard, resize, zoom, and project switching.

## 15. Rollback plan

- Flip `terminal.blocks.enabled` off.
- Keep typed host protocol if stable; classic renderer can use it.
- Stop writing new command rows without deleting existing history.
- Preserve old IPC until one stable release after block mode becomes default.
- If the database migration causes issues, disable the repository and continue non-persistent terminal operation; prefer a forward fix over destructive downgrade.

## 16. Definition of done

- Product, architecture, UX, and schema acceptance criteria are implemented.
- PowerShell 7 structured mode is a reliable daily driver.
- Unsupported behavior is never worse than current classic terminal behavior.
- History privacy controls are visible and tested.
- Packaged Windows application passes the release gates.
- User-facing terminal documentation and troubleshooting are added before general release.
