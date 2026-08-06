# EnStudio Terminal

Status: proposed implementation specification
Date: 2026-08-04
Scope: replacement for the current EnStudio terminal surface

This folder specifies the next EnStudio terminal experience: a local, project-aware terminal with command blocks and first-party history. Existing files directly under `docs/` remain the completed product baseline and are not changed by this proposal.

## Product decision

EnStudio keeps the real user shell and replaces only the terminal host and presentation layer.

- PowerShell, CMD, WSL, SSH, and child processes still run through a PTY.
- Normal completed commands are presented as durable command blocks.
- Programs that continue reading input stay attached to the same PTY through inline interactive input.
- Alternate-screen/TUI programs use a temporary compatibility surface inside the active command block.
- Code editing remains the responsibility of Code mode; terminal compatibility does not create a second editor product.
- Terminal history belongs to the desktop host and is stored locally in `~/.enpiistudio/terminal/history.db`.

## Documents

| Document | Purpose |
|---|---|
| [Product requirements](./prd.md) | Goals, scope, requirements, acceptance criteria, delivery slices |
| [Architecture](./architecture.md) | Components, PTY protocol, parser, persistence, security, failure handling |
| [UX design](./design.md) | Command-block interaction, composer, history, compatibility surface, keyboard behavior |
| [Data contracts](./schema.md) | TypeScript contracts, IPC messages, SQLite schema, retention rules |
| [Implementation plan](./implementation-plan.md) | Migration from the existing xterm terminal and validation checkpoints |

## Relationship to the current implementation

The repository already contains useful foundations:

- `apps/desktop/src/lib/components/TerminalStage.svelte` owns terminal tabs, panes, xterm instances, SSH launch, completion ghost text, and PTY lifecycle.
- `apps/desktop/electron/main.ts` owns `node-pty` processes and terminal IPC.
- `apps/desktop/electron/preload.ts` exposes the renderer-safe terminal API.
- `@xterm/xterm`, `@xterm/addon-fit`, and `node-pty` are already installed.

The work is therefore an incremental replacement of the terminal presentation and protocol, not a new standalone application.

## Normative language

`MUST`, `SHOULD`, and `MAY` indicate required, recommended, and optional behavior. When these documents conflict with the completed baseline docs, the baseline remains authoritative outside Terminal mode; this package is authoritative for the new terminal feature once approved for implementation.
