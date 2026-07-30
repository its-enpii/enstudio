---
name: plan
description: Design an implementation plan before coding
---

# plan

Design a plan before large multi-step work.

## When to use

User asks to plan, design, or architect before implement. Or `/skill plan`. Prefer runtime plan mode / `plan_tasks` for durable drafts when the work is large.

## Workflow

1. Problem, constraints, success criteria
2. Explore: reuse, existing patterns, files to touch (`search_codebase`, `grep`, `read_file`)
3. Steps with dependencies and risks
4. Present: context → concrete steps (paths) → how to verify

## Rules

- Read before proposing edits
- Prefer edit over new files
- Match plan size to task size
- Do not invent a second plan if an approved plan is already on disk
