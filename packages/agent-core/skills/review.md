---
name: review
description: Review code or a diff for bugs, security, and quality
---

# review

Review code for bugs, security issues, and quality.

## When to use

User asks to review code, a PR, or a diff. Or `/skill review`.

## Workflow

1. Read the changed files or `git_diff` thoroughly
2. Check for:
   - **Bugs**: logic errors, off-by-one, null access, races
   - **Security**: injection, XSS, secrets, path traversal
   - **Performance**: N+1, wasteful work, missing indexes
   - **Tests**: new paths and edge cases covered?
   - **Style**: naming, dead code, needless complexity (skip pure formatter nits if a linter exists)
3. Concrete feedback with `file:line` references
4. Severity order: critical > major > minor > nit

## Rules

- Specific: "line 42 may throw if user is null" not "check nulls"
- Suggest a fix, not only the problem
- Note good patterns too
- Do not rewrite the whole file unless asked
