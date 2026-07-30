---
name: create-skill
description: Author a new enpii skill (project, global, or bundled)
---

# create-skill

Write a reusable skill markdown file for enpii.

## When to use

User asks to create, draft, or scaffold a skill. Or `/skill create-skill`.

## Format

```md
---
name: short-kebab
description: One line, shown in the skill catalog (≤240 chars)
---

# short-kebab

One-line purpose.

## When to use

Trigger phrases + when NOT to use.

## Workflow

Numbered steps. Name real tools (`read_file`, `grep`, `run_shell`, `git_status`, …).

## Rules

Hard constraints. Prefer short bullets.
```

- Frontmatter keys: only `name` and `description` (scalars)
- Body: markdown, keep under ~20k when loaded
- File: `{name}.md` (basename used if frontmatter name missing)

## Where to write

| Scope | Path | When |
|---|---|---|
| project | `{workspace}/.enpii/skills/{name}.md` | default — this repo only |
| global | `~/.enpiistudio/skills/{name}.md` | all projects for this user |
| bundled | only if shipping defaults in agent-core | product maintainers |

Load order (later wins same name): **bundled → global → project**.

If `.enpii/` missing: `ensure_enpii` / scaffold first, then write under `skills/`.

## Workflow

1. Clarify: purpose, triggers, scope (project vs global)
2. Draft name: kebab-case, verb-ish (`review`, `migrate-api`) — no spaces
3. Write description: catalog line only; no process detail
4. Body: When to use → Workflow (tools by name) → Rules
5. `write_file` to the chosen path (create dirs if needed)
6. Tell user: restart/reload session or re-open project so catalog picks it up; invoke with `/skill {name}`

## Rules

- One skill = one job. Split if it spans unrelated workflows
- Match tone of existing bundled skills: short, imperative, tool-named
- Do not invent tools — only what enpii exposes
- Prefer project skill unless user says global/bundled
- Do not overwrite an existing skill without confirming
- No symlinks; plain `.md` only
- Keep body focused; catalog already lists name+description without loading body
