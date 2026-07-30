---
name: debug
description: Diagnose and fix bugs systematically
---

# debug

Diagnose and fix bugs with evidence.

## When to use

User reports a bug, error, or unexpected behavior. Or `/skill debug`.

## Workflow

1. Reproduce: exact steps or command
2. Read the error: stack, logs, codes
3. Locate: `grep` / `search_codebase` / `read_file`
4. Hypothesize root cause
5. Verify with surrounding code or a focused check (`run_shell` tests)
6. Minimal fix at the root cause
7. Re-check related paths

## Rules

- Read the error before thrashing the tree
- Do not guess-edit — confirm first
- Fix cause, not symptom
- After 3 failed approaches, summarize attempts and ask
