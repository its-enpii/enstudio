# Schema — EnStudio

Status: draft v0  
Contract version: **0.1.0**  
Product: **EnStudio** · Agent: **enpii**

This document is the machine-oriented source of truth for configs, messages, tools, and events.  
Types are described in TypeScript-like notation (implement in TS for agent-core).

---

## 1. Conventions

- JSON field names: `camelCase`  
- Timestamps: ISO-8601 UTC strings  
- Paths: absolute OS paths in host; workspace-relative in model-facing tool args when possible  
- IDs: `ulid` or `uuid v4` strings  
- Money/tokens: integers when present; omit if unknown  

```ts
type ISODateTime = string
type Id = string
type AbsolutePath = string
type RelPath = string
```

---

## 2. Config

### 2.1 User config — `~/.enpiistudio/config.toml`

Logical JSON shape (TOML equivalent):

```ts
interface UserConfig {
  contractVersion: "0.1.0"
  ui?: {
    theme?: "dark" | "light" | "system"
    scale?: number
  }
  defaultPermissionMode?: PermissionMode
  endpoint: EndpointConfig
  /** optional extra endpoints selectable in UI */
  endpoints?: Record<string, EndpointConfig>
  agent?: {
    /** global instructions prepended for all projects */
    instructions?: string
    maxTurns?: number          // default 40
    maxOutputTokens?: number
    temperature?: number
  }
  security?: {
    denyGlobs?: string[]
    shellAllowlist?: string[]  // if non-empty, only these binary names
    redactPatterns?: string[]  // regex strings
  }
}
```

### 2.2 Endpoint

```ts
interface EndpointConfig {
  id?: string
  label?: string
  baseUrl: string
  apiKeyEnv?: string          // e.g. "ENPII_API_KEY"
  apiKey?: string             // discouraged in file; prefer env/keychain
  dialect: "anthropic" | "openai"
  model: string
  /** optional headers */
  headers?: Record<string, string>
  timeoutMs?: number
}
```

### 2.3 Project config — `<project>/.enpii/config.toml`

```ts
interface ProjectConfig {
  contractVersion: "0.1.0"
  name?: string
  permissionMode?: PermissionMode
  endpointId?: string           // select from user endpoints
  modelOverride?: string
  denyGlobs?: string[]          // merged with user denies
  agent?: {
    /** load memory from ~/.enpiistudio/memory (global + this project) */
    loadMemory?: boolean
    maxMemoryChars?: number
    /** skill names or globs to prefer auto-list in prompt */
    skills?: string[]
  }
}
```

### 2.3.1 Global data roots

```ts
/** All under user home app dir */
interface GlobalPaths {
  root: AbsolutePath                    // ~/.enpiistudio
  config: AbsolutePath                  // .../config.toml
  memoryGlobal: AbsolutePath            // .../memory/global
  memoryProject: (projectHash: string) => AbsolutePath  // .../memory/projects/<hash>
  sessionsProject: (projectHash: string) => AbsolutePath // .../sessions/projects/<hash>
  skillsGlobal: AbsolutePath            // .../skills
  logs: AbsolutePath
  stateDb: AbsolutePath                 // .../state.db
}

/** Project-local */
interface ProjectPaths {
  enpiiDir: AbsolutePath                // <project>/.enpii
  config: AbsolutePath                  // .../config.toml
  agentMd: AbsolutePath                 // .../AGENT.md
  skills: AbsolutePath                  // .../skills
}
```

`projectHash`: stable id from canonical absolute project root (e.g. sha256 prefix). Used so renames can be remapped later via `state.db`.

### 2.4 Permission modes

```ts
type PermissionMode =
  | "read_only"
  | "ask"                 // default: confirm write + shell
  | "autopilot_workspace" // auto-allow writes in jail; shell still ask
  | "full"                // dangerous; still respect deny globs + jail
```

### 2.5 Project agent instructions

File: `<project>/.enpii/AGENT.md`  
Format: free markdown. Not JSON. Injected into system prompt as project instructions.

### 2.6 Skills

Skill file: markdown with optional YAML frontmatter.

```ts
interface SkillFrontmatter {
  name: string
  description: string
  /** when to consider loading */
  triggers?: string[]
}

interface Skill {
  name: string
  description: string
  body: string              // markdown after frontmatter
  source: "project" | "global"
  path: AbsolutePath
}
```

Resolve: project skills override global skills **same `name`**.

Discovery paths:
- `<project>/.enpii/skills/**/*.md`
- `~/.enpiistudio/skills/**/*.md`

v0 loading:
1. Build catalog (name + description only) for system or tool listing  
2. Full body injected only when selected (`/skill <name>`, user attach, or future `load_skill` tool)

### 2.7 Memory files

```
~/.enpiistudio/memory/global/**/*.md
~/.enpiistudio/memory/projects/<projectHash>/**/*.md
```

Free markdown. Loaded only if `loadMemory` enabled; char-capped; project memory preferred over global when both present for same topic (simple concat with headings in v0).

---

## 3. Canonical messages (internal)

Anthropic-like blocks. Used inside enpii regardless of wire dialect.

```ts
type Role = "user" | "assistant"

interface Message {
  role: Role
  content: string | ContentBlock[]
}

type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock

interface TextBlock {
  type: "text"
  text: string
}

interface ToolUseBlock {
  type: "tool_use"
  id: Id
  name: ToolName
  input: Record<string, unknown>
}

interface ToolResultBlock {
  type: "tool_result"
  toolUseId: Id
  content: string
  isError?: boolean
}
```

Wire mapping:
| Internal | Anthropic API | OpenAI tools |
|---|---|---|
| `tool_use` | `tool_use` content block | `tool_calls[]` on assistant message |
| `tool_result` | `tool_result` user content | `role: tool` message |
| `text` | `text` block | `content` string/parts |

---

## 4. Tools

### 4.1 Tool names

```ts
type ToolName =
  | "read_file"
  | "write_file"
  | "edit_file"
  | "glob"
  | "grep"
  | "run_shell"
  | "list_dir"
  | "git_status"
```

### 4.2 Tool definition (sent to model)

```ts
interface ToolDefinition {
  name: ToolName
  description: string
  inputSchema: JsonSchemaObject  // JSON Schema draft-07 subset
}
```

### 4.3 Tool inputs

```ts
interface ReadFileInput {
  path: RelPath
  offset?: number   // 1-based start line
  limit?: number    // max lines
}

interface WriteFileInput {
  path: RelPath
  content: string
}

interface EditFileInput {
  path: RelPath
  /** exact old text; must match uniquely unless replaceAll */
  oldString: string
  newString: string
  replaceAll?: boolean
}

interface GlobInput {
  pattern: string
  path?: RelPath      // subdirectory
}

interface GrepInput {
  pattern: string
  path?: RelPath
  glob?: string
  caseInsensitive?: boolean
  headLimit?: number
}

interface RunShellInput {
  command: string
  cwd?: RelPath       // relative to workspace; default root
  timeoutMs?: number
}

interface ListDirInput {
  path?: RelPath
  maxEntries?: number
}

interface GitStatusInput {
  /** include unstaged diff summary */
  diff?: boolean
}
```

### 4.4 Tool result (host → enpii)

```ts
interface ToolExecutionResult {
  toolUseId: Id
  name: ToolName
  ok: boolean
  /** textual payload for model */
  content: string
  /** structured extras for UI; not always sent to model */
  ui?: {
    diff?: FileDiff
    exitCode?: number
    truncated?: boolean
    durationMs?: number
    paths?: RelPath[]
  }
  errorCode?:
    | "path_escape"
    | "denied_by_policy"
    | "needs_approval"
    | "user_denied"
    | "not_found"
    | "timeout"
    | "exec_failed"
    | "invalid_args"
    | "internal"
}
```

```ts
interface FileDiff {
  path: RelPath
  before?: string
  after?: string
  unified?: string
  additions?: number
  deletions?: number
}
```

### 4.5 Approval

```ts
interface ApprovalRequest {
  id: Id
  sessionId: Id
  toolUseId: Id
  name: ToolName
  input: Record<string, unknown>
  preview?: {
    diff?: FileDiff
    command?: string
    cwd?: AbsolutePath
  }
  createdAt: ISODateTime
}

type ApprovalDecision =
  | { type: "deny" }
  | { type: "allow_once" }
  | { type: "allow_session" }  // same tool name + equal input fingerprint policy TBD: v0 = tool name scope for shell? prefer allow_once default in UI
```

v0 recommendation: **Allow for session** applies to tool name within session for `write_file`/`edit_file` inside jail; for `run_shell` prefer allow_once only unless user enables broader autopilot.

---

## 5. Session

```ts
interface SessionMeta {
  id: Id
  contractVersion: "0.1.0"
  projectRoot: AbsolutePath
  title: string
  createdAt: ISODateTime
  updatedAt: ISODateTime
  model: string
  dialect: "anthropic" | "openai"
  permissionMode: PermissionMode
  status: "idle" | "running" | "awaiting_approval" | "error" | "archived"
  endpointId?: string
}
```

Transcript path:  
`~/.enpiistudio/sessions/projects/<projectHash>/<sessionId>.jsonl`

Each line: one `TranscriptEvent` JSON object.

---

## 6. Transcript events

```ts
interface TranscriptEventBase {
  id: Id
  sessionId: Id
  ts: ISODateTime
}

type TranscriptEvent =
  | SessionStartedEvent
  | UserMessageEvent
  | AssistantMessageEvent
  | StreamDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | ApprovalRequestEvent
  | ApprovalDecisionEvent
  | StatusEvent
  | ErrorEvent
  | UsageEvent
  | CompactedEvent
```

```ts
interface SessionStartedEvent extends TranscriptEventBase {
  type: "session_started"
  meta: SessionMeta
}

interface UserMessageEvent extends TranscriptEventBase {
  type: "user_message"
  message: Message  // role user
}

interface AssistantMessageEvent extends TranscriptEventBase {
  type: "assistant_message"
  message: Message  // role assistant (final for turn slice)
}

interface StreamDeltaEvent extends TranscriptEventBase {
  type: "stream_delta"
  text: string
}

interface ToolCallEvent extends TranscriptEventBase {
  type: "tool_call"
  toolUse: ToolUseBlock
}

interface ToolResultEvent extends TranscriptEventBase {
  type: "tool_result"
  result: ToolExecutionResult
}

interface ApprovalRequestEvent extends TranscriptEventBase {
  type: "approval_request"
  request: ApprovalRequest
}

interface ApprovalDecisionEvent extends TranscriptEventBase {
  type: "approval_decision"
  requestId: Id
  decision: ApprovalDecision
}

interface StatusEvent extends TranscriptEventBase {
  type: "status"
  status: SessionMeta["status"]
  detail?: string
}

interface ErrorEvent extends TranscriptEventBase {
  type: "error"
  message: string
  retriable?: boolean
  cause?: string
}

interface UsageEvent extends TranscriptEventBase {
  type: "usage"
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

interface CompactedEvent extends TranscriptEventBase {
  type: "compacted"
  /** summary text retained */
  summary: string
  droppedEventCount: number
}
```

---

## 7. Host ↔ enpii RPC (sidecar)

Transport (locked): **stdio JSON-RPC 2.0** between Electron **main** and **enpii** sidecar.

- Main process spawns `enpii` Node process; speaks JSON-RPC on **stdin/stdout**
- One JSON message per line (NDJSON framing) unless Content-Length framing is adopted later — **v0 default: NDJSON lines**
- stderr = logs only (never RPC payloads)
- Notifications (server → client events) = JSON-RPC notifications (no `id`)

HTTP localhost is **not** used in v0 for agent RPC.

Renderer never speaks stdio to enpii directly — only via main IPC.

Payload shapes below.

### 7.1 Methods

```ts
/** create or load session */
// method: session.upsert
interface SessionUpsertParams {
  projectRoot: AbsolutePath
  sessionId?: Id
  title?: string
  permissionMode?: PermissionMode
  endpoint?: EndpointConfig
}

// method: session.prompt
interface SessionPromptParams {
  sessionId: Id
  text: string
  attachments?: Array<{
    type: "file_ref" | "selection"
    path: RelPath
    startLine?: number
    endLine?: number
    text?: string
  }>
}

// method: session.stop
interface SessionStopParams {
  sessionId: Id
}

// method: session.decide
interface SessionDecideParams {
  sessionId: Id
  requestId: Id
  decision: ApprovalDecision
}

// method: session.get
interface SessionGetParams {
  sessionId: Id
}
```

### 7.2 Server → client notifications (events)

Same as `TranscriptEvent` plus live stream:

```ts
type HostNotification =
  | { method: "event"; params: TranscriptEvent }
  | { method: "stream"; params: { sessionId: Id; text: string } }
```

### 7.3 Tool bridge (enpii → host)

When enpii needs a tool:

```ts
// method: tool.execute
interface ToolExecuteParams {
  sessionId: Id
  workspaceRoot: AbsolutePath
  toolUseId: Id
  name: ToolName
  input: Record<string, unknown>
  permissionMode: PermissionMode
}

// returns ToolExecutionResult
// may return ok:false errorCode needs_approval without executing
```

Host is sole executor of fs/shell.

---

## 8. Provider request (logical)

```ts
interface ProviderRequest {
  dialect: "anthropic" | "openai"
  baseUrl: string
  model: string
  system: string
  messages: Message[]
  tools: ToolDefinition[]
  maxTokens?: number
  temperature?: number
  stream: boolean
}

interface ProviderStreamEvent {
  type: "text_delta" | "tool_use_start" | "tool_use_args" | "tool_use_end" | "message_end" | "error" | "usage"
  text?: string
  toolUse?: ToolUseBlock
  usage?: { inputTokens?: number; outputTokens?: number }
  error?: string
  stopReason?: "end_turn" | "tool_use" | "max_tokens" | "stop" | "error"
}
```

---

## 9. System prompt assembly

Order (concatenate with clear headings):

1. Built-in enpii core (short, safety + identity)  
2. User global instructions (`UserConfig.agent.instructions`)  
3. Project `AGENT.md`  
4. Skills catalog (names + descriptions only; or full bodies if explicitly loaded)  
5. Optional memory excerpts from **global store** (capped)  
6. Runtime facts: `workspaceRoot`, `projectHash`, date, permissionMode, platform  

```ts
interface PromptAssemblyInput {
  workspaceRoot: AbsolutePath
  projectHash: string
  permissionMode: PermissionMode
  userInstructions?: string
  projectAgentMd?: string
  skillCatalog?: Array<{ name: string; description: string; source: "project" | "global" }>
  loadedSkills?: Array<{ name: string; body: string }>
  memoryExcerpts?: string[]
  platform: "win32" | "darwin" | "linux"
  now: ISODateTime
}
```

---

## 10. SQLite index (optional but recommended)

Table sketches:

```sql
CREATE TABLE projects (
  root TEXT PRIMARY KEY,
  opened_at TEXT,
  layout_json TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  project_root TEXT NOT NULL,
  title TEXT,
  created_at TEXT,
  updated_at TEXT,
  status TEXT,
  model TEXT,
  dialect TEXT,
  permission_mode TEXT,
  transcript_path TEXT
);

CREATE TABLE settings_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Transcript body remains JSONL on disk (debuggable, append-only).

---

## 11. Error envelope

```ts
interface ErrorBody {
  code: string
  message: string
  details?: unknown
}
```

RPC errors use JSON-RPC error object with `ErrorBody` in `data`.

---

## 12. Compatibility

| contractVersion | Notes |
|---|---|
| `0.1.0` | Initial draft; breaking changes allowed until 1.0.0 |

When loading older transcripts with unsupported version: open read-only or migrate with explicit function.

---

## 13. Minimal examples

### User prompt event

```json
{
  "id": "01J...",
  "sessionId": "01J...",
  "ts": "2026-07-24T12:00:00.000Z",
  "type": "user_message",
  "message": {
    "role": "user",
    "content": "Tambahkan validasi email di form login."
  }
}
```

### Tool call

```json
{
  "type": "tool_call",
  "id": "01J...",
  "sessionId": "01J...",
  "ts": "2026-07-24T12:00:01.000Z",
  "toolUse": {
    "type": "tool_use",
    "id": "tu_1",
    "name": "grep",
    "input": { "pattern": "login", "glob": "*.ts" }
  }
}
```

### Approval request

```json
{
  "type": "approval_request",
  "id": "01J...",
  "sessionId": "01J...",
  "ts": "2026-07-24T12:00:05.000Z",
  "request": {
    "id": "ap_1",
    "sessionId": "01J...",
    "toolUseId": "tu_2",
    "name": "edit_file",
    "input": {
      "path": "src/login.ts",
      "oldString": "function login() {",
      "newString": "function login(email: string) {"
    },
    "preview": {
      "diff": {
        "path": "src/login.ts",
        "additions": 1,
        "deletions": 1,
        "unified": "@@ ..."
      }
    },
    "createdAt": "2026-07-24T12:00:05.000Z"
  }
}
```

---

## 14. Related docs

- [Architecture](./architecture.md)  
- [Design](./design.md)  
- [PRD](./prd.md)  
- [Rules](./rules.md)  
