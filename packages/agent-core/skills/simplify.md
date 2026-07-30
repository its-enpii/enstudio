---
name: simplify
description: Refactor code to be simpler without changing behavior
---

# simplify

Reduce complexity while preserving behavior.

## When to use

User asks to simplify, clean up, or refactor. Or `/skill simplify`.

## Workflow

1. Read the target fully
2. Find: needless abstraction, duplication, dead code, over-engineering
3. Prefer delete over restructure
4. Keep tests green (`run_shell` project test/typecheck when present)

## Rules

- No feature creep — behavior stays the same
- Three similar lines beat a premature helper
- Drop shims for removed APIs
- Do not comment the obvious
