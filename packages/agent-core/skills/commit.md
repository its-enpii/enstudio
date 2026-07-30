---
name: commit
description: Create clean git commits from current changes
---

# commit

Create clean, well-structured commits.

## When to use

User asks to commit, prepare a PR, or stage a clean history. Or `/skill commit`.

## Workflow

1. `git_status` and `git_diff` (staged + unstaged)
2. Categorize: feature / fix / refactor / docs / test
3. Draft message (see Commit message)
4. Stage relevant paths only (`git_stage` per file or clear sets) — never secrets, `.env`, huge binaries
5. `git_commit`

## Commit message

Shape:

```
type(scope): short summary

Optional body — why, not what. Wrap ~72 chars.
```

- **type:** `feat` | `fix` | `refactor` | `docs` | `test` | `chore` | `perf` | `build` | `ci`
- **scope:** optional area (`desktop`, `agent-core`, `git`)
- **summary:** imperative, present tense, no trailing period, ≤~72 chars total first line
- **body:** only when needed — motivation, trade-offs, follow-ups; not a file list
- Match project convention if `.enpii/AGENT.md` or recent log already sets one; else conventional above

Examples:

```
feat(agent): add create-skill bundled skill
```

```
fix(git): restore staged list scroll height

flex-1 min-h-0 collapsed the list to 0. Cap with max-h instead.
```

```
refactor(desktop): drop bubble duration timer
```

Bad: `Fixed stuff`, `Update files.`, past tense, vague “WIP”, dump of every path.

## Rules

- Prefer explicit paths over staging everything
- No `--no-verify` / hook skip unless user asks
- Do not amend published history unless user asks
- If a hook fails: fix, then new commit (do not force-amend)
- One logical change per commit when practical; split if mixed feature+chore
