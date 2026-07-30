---
name: verify
description: Run project linters, formatters, and typechecks (ESLint, Pint, tsc, …)
---

# verify

Check code quality with the project's own tools before claiming done.

## When to use

User asks to lint, format, typecheck, or verify code quality. Or after edits before commit/PR. Or `/skill verify`.

Not for unit/integration tests — use `/skill test`. Not for root-cause debugging — use `/skill debug`.

## Discover

1. Read `package.json` scripts, `composer.json` scripts, `Makefile`, `AGENT.md`, CI configs
2. Prefer project scripts over ad-hoc binaries
3. Scope: touched files when possible; whole package/workspace when user says full check

## Tool map

| Signal | Prefer command (via `run_shell`) |
|---|---|
| `scripts.typecheck` / `tsconfig` | `npm run typecheck` or `npx tsc --noEmit` |
| ESLint / `eslint.config.*` | `npm run lint` or `npx eslint <paths>` |
| Prettier | `npm run format` / `npm run format:check` or `npx prettier --check <paths>` |
| PHP + Laravel Pint | `./vendor/bin/pint --test` (check) then `./vendor/bin/pint` (fix) |
| PHPStan / Psalm | `./vendor/bin/phpstan analyse` / `./vendor/bin/psalm` |
| PHPUnit / Pest (syntax only if no full test ask) | skip unless user wants tests → `/skill test` |
| Ruff / Black / mypy | `ruff check`, `black --check`, `mypy` |
| Biome | `npx biome check <paths>` |
| monorepo workspaces | run in the package that owns the change (`-w` / filter) |

Windows: use local `node_modules/.bin` / `vendor/bin` paths; prefer npm scripts so OS differences stay in package.json.

Order when several apply: **typecheck → lint → format-check → (optional) tests only if user asked**.

## Workflow

1. Detect stack + available commands (list what you will run)
2. Run checks with `run_shell`; capture exit code + relevant output
3. Failures:
   - Auto-fixable style (Pint, Prettier write, `eslint --fix`): fix, re-run check
   - Real errors (types, lint rules, static analysis): fix root cause with `read_file` / `edit_file`, re-run
4. Report: command → pass/fail → remaining issues (path:line if present)
5. Stop after 2–3 fix cycles on the same error; summarize and ask

## Rules

- Do not invent a linter the repo does not use
- Do not skip failing checks and claim verified
- Do not run full test suites under this skill unless user asked (point to `test`)
- Prefer check/dry-run flags first; write/fix only after seeing the delta
- Keep scope tight: changed packages/files, not the entire monorepo by default
- Match existing project config; do not add new lint rules mid-task
