# Project agent instructions

_Auto-generated starter brief. Edit freely — enpii will not overwrite once you change this file._

Project: @enstudio/agent-core

Top-level:
- dist/
- scripts/
- src/
- package.json
- tsconfig.json

Stack signals: TypeScript

npm scripts:
- dev: tsx watch src/cli.ts
- build: tsc -p tsconfig.json
- start: node dist/cli.js
- typecheck: tsc -p tsconfig.json --noEmit
- test: tsx --test src/*.test.ts src/**/*.test.ts

Prefer search_codebase / grep / glob before broad reads. Keep diffs small.
