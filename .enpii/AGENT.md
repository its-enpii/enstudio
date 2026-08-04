# Project agent instructions

_Auto-generated starter brief. Edit freely — enpii will not overwrite once you change this file._

Language: match the user. Indonesian in → Indonesian out. No Vietnamese or other mix unless asked. Code/paths/commands stay as-is.

Project: enpiistudio

Top-level:
- apps/
- docs/
- packages/
- reference/
- package-lock.json
- package.json
- README.md
- tsconfig.base.json

npm scripts:
- dev: npm run dev -w @enstudio/desktop
- dev:devtools: npm run dev:devtools -w @enstudio/desktop
- build: npm run build -w @enstudio/agent-core && npm run build -w @enstudio/deskto
- dev:agent: npm run dev -w @enstudio/agent-core
- typecheck: npm run typecheck -w @enstudio/agent-core && npm run typecheck -w @enpiistudi
- test: npm run test -w @enstudio/agent-core
- pack:check: npm run build && npm run typecheck && npm run test
- pack: npm run pack -w @enstudio/desktop
- dist: npm run dist -w @enstudio/desktop
- dist:linux: npm run dist:linux -w @enstudio/desktop
- dist:win: npm run dist:win -w @enstudio/desktop
- dist:mac: npm run dist:mac -w @enstudio/desktop

Git: branch: main

Prefer search_codebase / grep / glob before broad reads. Keep diffs small.
