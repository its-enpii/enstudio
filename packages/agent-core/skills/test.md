---
name: test
description: Write and run tests for features, bugs, or refactors
---

# test

Write and run tests.

## When to use

User asks for tests, coverage, or to verify behavior. Or `/skill test`.

## Workflow

1. Scope:
   - New feature → happy path + edge cases
   - Bug fix → regression test that would have failed before
   - Refactor → existing suite must still pass
2. Match project patterns: discover scripts via package.json / `AGENT.md`; use `run_shell` for the project test command
3. Tests should be independent, deterministic, and fast (mock external I/O)
4. Run tests and fix failures you introduced

## Rules

- Test behavior, not internals
- Descriptive names for scenarios
- Do not test framework/library code
- Mock at boundaries (network, FS outside the project jail when needed)
