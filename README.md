# Enpii Studio

Personal agentic coding workspace — enpii on your own endpoint.

## Overview

Enpii Studio is an Electron desktop application that provides an integrated development environment with:

- **Agent** — AI-powered coding assistant with multi-vendor LLM support
- **Code** — File editor with syntax highlighting (CodeMirror 6)
- **Terminal** — Modular command-card terminal with SSH support
- **Git** — Visual git interface for staging, committing, and branch management
- **Browser** — Built-in browser inspector

## Tech Stack

- **Runtime**: Electron (main + renderer)
- **Frontend**: Svelte 5 (runic syntax — `$state`, `$derived`, `$effect`)
- **Styling**: Tailwind CSS v4 with custom design tokens
- **Editor**: CodeMirror 6
- **Terminal**: xterm.js with node-pty backend
- **Build**: Vite + electron-builder

## Project Structure

```
apps/desktop/
+-- electron/              # Electron main process
¦   +-- main.ts            # App entry, IPC handlers
¦   +-- preload.ts         # Context bridge (renderer API)
¦   +-- terminal/          # PTY backend, shell integration
¦       +-- terminalHost.ts
¦       +-- terminalWorker.ts
¦       +-- shellMarkerParser.ts
¦       +-- powerShellIntegration.ts
¦       +-- eventJournal.ts
¦       +-- validation.ts
¦       +-- types.ts
+-- src/
¦   +-- app.css            # Global styles & design tokens
¦   +-- lib/
¦       +-- components/    # Svelte UI components
¦       ¦   +-- AgentStage.svelte
¦       ¦   +-- CodeStage.svelte
¦       ¦   +-- TerminalStage.svelte
¦       ¦   +-- GitStage.svelte
¦       ¦   +-- BrowserStage.svelte
¦       ¦   +-- ui/        # Reusable UI kit (Button, Badge, etc.)
¦       +-- terminal/      # Terminal frontend modules
¦       ¦   +-- tabStore.svelte.ts
¦       ¦   +-- surfaceManager.ts
¦       ¦   +-- ptyBridge.ts
¦       ¦   +-- helpers.ts
¦       ¦   +-- commandHistory.ts
¦       ¦   +-- constants.ts
¦       ¦   +-- types.ts
¦       +-- store.svelte.ts
¦       +-- icons/
¦       +-- enpii.ts       # API client
+-- docs/                  # Design & architecture docs
¦   +-- terminal/
¦   +-- architecture.md
¦   +-- design.md
¦   +-- prd.md
+-- package.json
```

## Terminal Architecture

The terminal uses a **command-card model** where each executed command produces a discrete `<article>` card in a scrollable timeline:

- **Shell integration markers** (`command_start`, `command_end`) drive block lifecycle
- **Prompt detection fallback** (`looksLikeShellPrompt`) handles environments without markers (including SSH remote shells)
- **Stream-follow detection** auto-identifies long-running commands (`docker logs -f`, `npm run dev`, etc.)
- **Unified input** via composer bar — routes to `runComposer()` or `sendProcessInput()` based on whether a command is running
- **SSH sessions** create a new PTY tab, connect via `ssh` command, and behave identically to local terminal once the remote prompt is detected

### Key Modules

| Module | Responsibility |
|---|---|
| `tabStore.svelte.ts` | Reactive tab/block state management |
| `surfaceManager.ts` | xterm.js terminal instance lifecycle |
| `ptyBridge.ts` | PTY ? renderer event bridge |
| `helpers.ts` | Prompt detection, ANSI stripping, output formatting |
| `commandHistory.ts` | Per-project persistent command history |

## Development

```bash
# Install dependencies
npm install

# Development (renderer + electron)
npm run dev

# Build for production
npm run build
```

## License

Private — All rights reserved.
