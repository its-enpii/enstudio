# enpiistudio

Personal agentic coding workspace. Built-in agent: **enpii**.

See [`docs/`](./docs/) for architecture, design, PRD, rules, and schema.

## Stack (v0)

- Electron + Svelte + Vite
- `@enpiistudio/agent-core` Node sidecar (stdio JSON-RPC)
- User-owned OpenAI / Anthropic-compatible endpoint (wired later)

## Develop

```bash
npm install
npm run build -w @enpiistudio/agent-core
npm run dev
```

DevTools (detached):

```powershell
# PowerShell
$env:ENPII_DEVTOOLS = "1"; npm run dev
```

```bash
# bash / Git Bash
ENPII_DEVTOOLS=1 npm run dev
```

Or: `npm run dev:devtools` from repo root / desktop package.

If Electron prints `failed to install correctly` after `npm install` (common on some Windows setups when the zip is cached but not extracted):

```powershell
$zip = "$env:LOCALAPPDATA\electron\Cache\*\electron-v*-win32-x64.zip" | Get-Item | Select-Object -First 1
Expand-Archive $zip.FullName node_modules\electron\dist -Force
Set-Content node_modules\electron\path.txt "electron.exe" -NoNewline
```

## Workspace layout

```
apps/desktop          Electron shell + Svelte UI
packages/agent-core   enpii sidecar
docs/                 product docs
```

## Status

See **[`docs/progress.md`](./docs/progress.md)** for done work and next targets.

- [x] Monorepo scaffold
- [x] UI chrome (projects | modes | inspector)
- [x] enpii health + real LLM loop (OpenAI-compatible)
- [x] Read tools + write tools with ask-mode approval
- [x] Session persist / resume
- [ ] Settings UI · shell tool · Monaco · terminal · git
