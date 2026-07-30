---
name: route
description: Choose scout/implement/review, handoff vs agent spawn
---

# route

Pick the right collaboration path for multi-step coding work.

## When to use

User asks who should do the work, how to split, or `/skill route`. Before spawning many agents.

## Decision

| Need | Use |
|---|---|
| Same chat, bias style only | `handoff({ role })` — scout / implement / review / main |
| Isolated edits + merge later | `agent` with worktree (async if parent must continue) |
| Read-only survey | `agent` role `scout` or `handoff` scout |
| Critique after changes | `handoff` review or `agent` role `review` |
| Multi-step tracking | `task_create` + blockedBy; complete → auto-unblock |
| Cross-agent notes only | `mailbox_send` (does not wake recipient) |

## handoff vs agent

- **handoff**: same session transcript; cheaper; no worktree; call `handoff({ role: "main" })` to clear
- **agent**: nested turn, depth 1, max 4 live; default worktree; merge with `agent_apply` or drop with `agent_discard`

## Workflow

1. One sentence: goal + constraints
2. Choose row from table
3. If handoff: set role + optional brief, then work
4. If agent: spawn with clear prompt; async when parallel; apply only when committed + main clean
5. Prefer one worker; fan out only when domains are independent

## Rules

- Parent stays orchestrator — no deep agent-of-agent
- Do not handoff and spawn the same role redundantly
- Scout = read-first; do not "implement" under scout bias
- Mailbox ≠ live message; use `send_message` for idle live agents
