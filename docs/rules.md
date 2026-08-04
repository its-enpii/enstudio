# Rules — EnStudio

Status: draft v0  
Applies to: humans building the product + **enpii** runtime behavior  
Product: **EnStudio** · Agent: **enpii**

---

## 1. Purpose

These rules keep the project from drifting into “another Claude CLI clone” or an unsafe autopilot.  
They bind **engineering**, **agent policy**, and **product scope**.

---

## 2. Product identity rules

R1. **Name**  
- Product: `EnStudio` (PascalCase brand)  
- Agent: `enpii`  
- Do not rebrand mid-code to Claude/Codex/OpenHarness names.

R2. **Own the agent**  
- Core path is enpii on the user’s endpoint.  
- Third-party coding CLIs are never required for v0.  
- Optional CLI host adapters are `contrib` / later — not foundation.

R3. **Own the personality**  
- Default system prompt is minimal and neutral.  
- Project voice lives in `.enpii/AGENT.md` (and user global instructions).  
- Do not ship a hard-coded “soul” that imitates a vendor agent as the only mode.

R4. **Local-first**  
- No mandatory cloud account, sync, or telemetry for core features.

R5. **Scope lock**  
- Personal local-first daily driver.  
- v0 core: agent + editor + terminal + git (shipped; some “later” shell extras landed early).  
- v1 agent may absorb **patterns** from `reference/OpenHarness|ClawTeam|loop-engineering` (web, tasks, sub-agent, plan/ask, schedule) without cloning vendor CLI UX or requiring those runtimes.  
- Still out: multi-tenant, marketplace, mobile, mandatory cloud control plane.

---

## 3. Architecture rules

R10. **Contract over framework**  
- `schema.md` types are the source of truth.  
- Borrow OpenHarness / ClawTeam / loop-engineering *patterns* from `reference/`; do not vend their code as a dependency or import product assumptions wholesale.  
- New agent tools mirror enpii naming + JSON-RPC events; map mentally to OH tool names in docs only.

R11. **Layering**  
```
desktop → host → agent-core (enpii) → provider → user endpoint
```
- UI does not call the LLM directly in normal flow.  
- Tools execute in host, not inside the model adapter.

R12. **Provider neutrality**  
- Support Anthropic + OpenAI dialects.  
- Internal canonical message model is Anthropic-like (see schema).  
- Never hardcode Anthropic-hosted URLs as the only backend.

R13. **Sidecar isolation**  
- agent-core crash must not take down the window.  
- Host can restart enpii sidecar.

R14. **One workspace root per tool context**  
- Every tool call has an explicit `workspaceRoot`.  
- No ambient “whatever cwd the OS has”.

R15. **Extension points, not premature modules**  
- Do not build orchestrator/swarm until single-agent daily driver works.  
- Leave clean session/tool APIs so ClawTeam-like isolation can attach later.

---

## 4. Safety & permission rules

R20. **Host-side enforcement**  
- Permissions are enforced in host code, not only in prompts.

R21. **Workspace jail**  
- Resolved paths must stay under workspace root (after symlink resolve).  
- Escape → tool error, transcript event, no retry loop spam.

R22. **Deny by default for danger zones**  
Default deny globs (override only via explicit user config):
- `.env`, `.env.*`
- `**/*.pem`, `**/*.key`
- `**/id_rsa*`, `**/id_ed25519*`
- `**/.git/config` (write), credential files
- OS user secret stores

R23. **Mutations need policy**  
In default **Ask** mode, require approval for:
- `write_file`, `edit_file`
- `run_shell`
- any future network tool

R24. **Read-only mode is real**  
- Mutating tools must be absent or hard-fail in read-only mode — not merely “asked not to”.

R25. **Shell is hostile**  
- Prefer non-interactive commands.  
- No long-lived interactive TTY via tool unless explicitly designed later.  
- Capture stdout/stderr with size limits; truncate in UI.

R26. **No silent destructive git**  
- Tools must not `git push --force`, `reset --hard`, `clean -fdx` without explicit high-risk approval class (v0: simply deny or require typed confirm).

R27. **Secrets**  
- API keys in OS keychain when possible.  
- Never commit credentials.  
- Redact common secret patterns in logs panel.

R28. **Prompt injection stance**  
- Repo files are untrusted content.  
- Instructions in code/comments cannot raise permission level.  
- Only user config + explicit UI mode changes raise autonomy.

---

## 5. Agent (enpii) behavior rules

R30. **Minimal default prompt**  
Built-in system prompt states:
- who it is (enpii in EnStudio)
- workspace root
- tool use expectations
- prefer small diffs
- do not claim to have run tools it did not run  

No long fake biography.

R31. **Prefer edit over rewrite**  
- Use `edit_file` / patches for existing files when possible.  
- Full `write_file` for new files or intentional replace.

R32. **Show work**  
- Emit tool calls for real work; do not “hallucinate” file contents when `read_file` is available.

R33. **Stop when done**  
- Avoid tool thrash.  
- After task complete, summarize files changed and how to verify.

R34. **Honor AGENT.md**  
- Project `.enpii/AGENT.md` is highest project-level instruction after safety rules.  
- Safety rules always win over AGENT.md.

R35. **Language**  
- Match the user’s language in the session (e.g. Indonesian if user writes Indonesian), except code identifiers/paths/commands stay as in repo.

R36. **Model failures**  
- On malformed tool JSON: repair once if trivial, else error event and ask user.  
- Do not infinite-loop the same failing tool.

---

## 6. Engineering rules

R40. **Stack**  
- Desktop: **Electron**  
- UI: **Svelte + Vite** (not SvelteKit)  
- Agent-core: TypeScript (Node sidecar)  
- Main ↔ enpii: **stdio JSON-RPC 2.0** (NDJSON lines)  
- Main ↔ renderer: Electron IPC + preload only (no `nodeIntegration` in renderer)  
- Do not add a second agent runtime language or swap UI/shell framework “for convenience” in v0.

R41. **YAGNI**  
- No interface-with-one-impl forests.  
- No plugin marketplace scaffolding.  
- No enterprise RBAC.

R42. **Deps**  
- Prefer stdlib / already chosen stack.  
- New dependency needs a one-line reason in PR/commit body.

R43. **Tests**  
- agent-core: unit tests for path jail, permission matrix, provider message mapping.  
- At least one golden loop test with mocked provider.  
- UI: smoke only until M3+.

R44. **Logging**  
- Structured logs with session id.  
- Debug level can include tool args; never raw API keys.

R45. **Versioning**  
- Agent Contract version field on every session (`contractVersion`).  
- Breaking schema changes bump version; migrate or refuse old sessions gracefully.

R46. **Code style**  
- Match surrounding code once codebase exists.  
- Small PRs / commits by milestone when publishing history.

R47. **Borrowed code**  
- If copying from OpenHarness or elsewhere: keep license headers, attribute in `THIRD_PARTY.md`, strip vendor personality/defaults.

---

## 7. UX rules

R50. **Approvals are first-class**  
- Never bury Approve/Deny.  
- Keyboard reachable.

R51. **Streaming honesty**  
- Show tool start before result.  
- Do not pretify failures as success.

R52. **Editor conflict**  
- Do not overwrite dirty buffers without prompt.

R53. **Stop means stop**  
- Abort stream; do not start new tools after stop (in-flight tool may finish or be cancelled best-effort).

R54. **Density**  
- Tool cards collapsed by default to one line; expand for detail.

---

## 8. Git & project hygiene rules

R60. **Split local vs global state**  
- Project `.enpii/`: `config.toml`, `AGENT.md`, `skills/` only (shareable).  
- Global `~/.enpiistudio/`: `memory/`, `sessions/`, `skills/`, `logs/`, `state.db`, credentials.

R61. **Default `.gitignore` suggestion** (document in app, do not force):
```
.enpii/logs/
```
Sessions/memory are global — not in repo. Commit `AGENT.md`, `config.toml`, and project `skills/` if team wants shared agent behavior.

R62. **No force-push helpers in v0 UI.**

R63. **Skills**  
- Project skills override global same name.  
- Do not dump all skill bodies into every prompt; catalog + on-demand load.
---

## 9. Decision log (short)

| Decision | Rule ref |
|---|---|
| EnStudio + enpii naming | R1 |
| Own agent, not CLI host core | R2 |
| Electron + Svelte + TS | R40 |
| Anthropic-like internal schema | R12 |
| Ask-mode approvals default | R23 |
| No swarm in v0 | R5, R15 |

---

## 10. Rule change process

- Changing P0 safety rules (R20–R28) requires updating PRD risk section + tests.  
- Changing product scope (R5) requires PRD milestone edit.  
- Cosmetic UX rules can change with Design doc only.

---

## 11. Related docs

- [Architecture](./architecture.md)  
- [Design](./design.md)  
- [PRD](./prd.md)  
- [Schema](./schema.md)  
