/** OpenAI function-calling tool schemas. */
export const TOOL_DEFS = [
  {
    type: 'function' as const,
    function: {
      name: 'plan_tasks',
      description: 'Publish a concise execution plan before making changes. Use 2-12 concrete steps; each step needs a title and may include detail.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            minItems: 2,
            maxItems: 12,
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                detail: { type: 'string' },
              },
              required: ['title'],
              additionalProperties: false,
            },
          },
        },
        required: ['tasks'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_dir',
      description: 'List entries in a directory under the project root.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path relative to project root. Default "."',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 text file under the project root.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' },
          maxBytes: {
            type: 'number',
            description: 'Optional max bytes to read (default 120000)',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'glob',
      description: 'Find file paths matching a glob pattern under the project root.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob e.g. **/*.ts or src/**/*.svelte',
          },
          maxResults: {
            type: 'number',
            description: 'Max paths to return (default 200)',
          },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'grep',
      description: 'Search file contents for a string or regex under the project root.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Substring or JS regex source' },
          path: {
            type: 'string',
            description: 'Subdirectory or file to search (default ".")',
          },
          regex: {
            type: 'boolean',
            description: 'Treat pattern as regex (default false)',
          },
          maxResults: {
            type: 'number',
            description: 'Max matches (default 50)',
          },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_codebase',
      description:
        'Ranked lexical search over filenames and text contents. Prefer this for "where is X?" discovery in large projects before many greps.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search words or phrase (space-separated terms ANDed by score)',
          },
          path: {
            type: 'string',
            description: 'Subdirectory to search (default ".")',
          },
          maxResults: {
            type: 'number',
            description: 'Max ranked hits (default 20, max 50)',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_file',
      description:
        'Create or overwrite a UTF-8 text file under the project root. Requires approval in ask mode.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' },
          content: { type: 'string', description: 'Full file contents to write' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'edit_file',
      description:
        'Replace an exact unique substring in a text file. old_string must match once. Requires approval in ask mode.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' },
          old_string: { type: 'string', description: 'Exact text to find (must be unique)' },
          new_string: { type: 'string', description: 'Replacement text' },
        },
        required: ['path', 'old_string', 'new_string'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_status',
      description: 'Read the current Git branch and working tree status.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_diff',
      description: 'Read a Git diff for the whole workspace or one file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Optional file path relative to project root' },
          staged: { type: 'boolean', description: 'Read staged diff when true' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_history',
      description: 'Read recent Git commits.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'Commit count, maximum 100' } },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_branches',
      description: 'Read local and remote Git branches.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_stashes',
      description: 'Read the current Git stash list.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_remotes',
      description: 'Read configured Git remotes and URLs.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_tags',
      description: 'Read Git tags in the current repository.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_conflicts',
      description: 'Read Git conflict files with Base, Current, and Incoming contents.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_stage',
      description: 'Stage one file or all workspace changes. Requires approval unless permission mode is full.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' },
          all: { type: 'boolean', description: 'Stage all changes when true' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_unstage',
      description: 'Unstage one file or all staged changes. Requires approval unless permission mode is full.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root' },
          all: { type: 'boolean', description: 'Unstage everything when true' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_commit',
      description: 'Commit staged changes with a message. Requires approval unless permission mode is full.',
      parameters: {
        type: 'object',
        properties: { message: { type: 'string', description: 'Commit message' } },
        required: ['message'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_branch',
      description: 'Create, switch, rename, or safely delete a Git branch. Requires approval unless permission mode is full.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'switch', 'rename', 'delete'] },
          name: { type: 'string', description: 'Branch name for create, switch, or delete' },
          newName: { type: 'string', description: 'New branch name for rename' },
          remote: { type: 'boolean', description: 'Switch from a remote tracking branch' },
        },
        required: ['action', 'name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_stash',
      description: 'Create, apply, pop, or safely drop a Git stash. Requires approval unless permission mode is full.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'apply', 'pop', 'drop'] },
          ref: { type: 'string', description: 'Stash reference such as stash@{0}' },
          message: { type: 'string', description: 'Message for a new stash' },
          includeUntracked: { type: 'boolean', description: 'Include untracked files when creating' },
        },
        required: ['action'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_fetch',
      description: 'Fetch Git remote references. Requires approval unless permission mode is full.',
      parameters: {
        type: 'object',
        properties: { remote: { type: 'string', description: 'Optional remote name' } },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_pull',
      description: 'Pull using fast-forward-only. Requires a clean tree and approval unless permission mode is full.',
      parameters: {
        type: 'object',
        properties: {
          remote: { type: 'string', description: 'Optional remote name' },
          branch: { type: 'string', description: 'Optional remote branch name' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_push',
      description: 'Push without force. Requires approval unless permission mode is full.',
      parameters: {
        type: 'object',
        properties: {
          remote: { type: 'string', description: 'Optional remote name' },
          branch: { type: 'string', description: 'Optional branch name' },
          setUpstream: { type: 'boolean', description: 'Set upstream on first push' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_resolve_conflict',
      description: 'Resolve one Git conflict by choosing ours, theirs, or marking the manually edited file resolved. Requires approval unless permission mode is full.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Conflicted file path relative to project root' },
          resolution: { type: 'string', enum: ['ours', 'theirs', 'mark'] },
        },
        required: ['path', 'resolution'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_tag',
      description: 'Create or delete a Git tag. Requires approval unless permission mode is full.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'delete'] },
          name: { type: 'string', description: 'Tag name' },
          message: { type: 'string', description: 'Optional annotation message; creates an annotated tag' },
          target: { type: 'string', description: 'Commit hash or HEAD for create; defaults to HEAD' },
        },
        required: ['action', 'name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_shell',
      description:
        'Run a non-interactive shell command in the project workspace. stdout/stderr captured. Requires approval in ask mode (and autopilot). Prefer short commands (tests, builds, git status).',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Shell command to run (non-interactive)',
          },
          cwd: {
            type: 'string',
            description: 'Working directory relative to project root (default ".")',
          },
          timeoutMs: {
            type: 'number',
            description: 'Kill after this many ms (default 60000, max 300000)',
          },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'memory_write',
      description:
        'Write a durable markdown note under ~/.enpiistudio/memory (global or this project). Injected into future prompts. Requires approval in ask mode.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Note slug (filename without .md), e.g. prefs or api-notes',
          },
          content: { type: 'string', description: 'Full markdown body to store' },
          scope: {
            type: 'string',
            enum: ['project', 'global'],
            description: 'project (default) or global memory',
          },
        },
        required: ['name', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'memory_search',
      description: 'Search durable memory notes (global + project) by substring or regex.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Substring or regex source' },
          regex: { type: 'boolean', description: 'Treat query as regex (default false)' },
          maxResults: { type: 'number', description: 'Max hits (default 20)' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'memory_delete',
      description:
        'Delete a durable memory note under ~/.enpiistudio/memory. Requires approval in ask mode.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Note slug (filename without .md)',
          },
          scope: {
            type: 'string',
            enum: ['project', 'global'],
            description: 'project (default) or global memory',
          },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'mcp_list_tools',
      description:
        'List tools from configured MCP servers (~/.enpiistudio/mcp.json and project .enpii/mcp.json). Optional server name filter.',
      parameters: {
        type: 'object',
        properties: {
          server: {
            type: 'string',
            description: 'Optional MCP server id; omit to list all configured servers',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'mcp_call_tool',
      description:
        'Call a tool on a configured MCP server. Requires approval in ask mode. Prefer native enpii tools when possible.',
      parameters: {
        type: 'object',
        properties: {
          server: { type: 'string', description: 'MCP server id from mcp.json' },
          tool: { type: 'string', description: 'Tool name on that server' },
          arguments: {
            type: 'object',
            description: 'JSON arguments object for the MCP tool',
          },
        },
        required: ['server', 'tool'],
        additionalProperties: false,
      },
    },
  },
]

export const WRITE_TOOL_NAMES = new Set([
  'write_file',
  'edit_file',
  'replace_file',
  'memory_write',
  'memory_delete',
])
export const SHELL_TOOL_NAMES = new Set(['run_shell'])
export const MCP_MUTATING_TOOL_NAMES = new Set(['mcp_call_tool'])
export const GIT_MUTATING_TOOL_NAMES = new Set(['git_stage', 'git_unstage', 'git_commit', 'git_branch', 'git_stash', 'git_fetch', 'git_pull', 'git_push', 'git_resolve_conflict', 'git_tag'])

export function isMutatingTool(name: string): boolean {
  return (
    WRITE_TOOL_NAMES.has(name) ||
    SHELL_TOOL_NAMES.has(name) ||
    GIT_MUTATING_TOOL_NAMES.has(name) ||
    MCP_MUTATING_TOOL_NAMES.has(name)
  )
}

export type ToolName =
  | 'plan_tasks'
  | 'list_dir'
  | 'read_file'
  | 'glob'
  | 'grep'
  | 'search_codebase'
  | 'write_file'
  | 'edit_file'
  | 'replace_file'
  | 'git_status'
  | 'git_diff'
  | 'git_history'
  | 'git_branches'
  | 'git_stashes'
  | 'git_remotes'
  | 'git_tags'
  | 'git_conflicts'
  | 'git_stage'
  | 'git_unstage'
  | 'git_commit'
  | 'git_branch'
  | 'git_stash'
  | 'git_fetch'
  | 'git_pull'
  | 'git_push'
  | 'git_resolve_conflict'
  | 'git_tag'
  | 'run_shell'
  | 'memory_write'
  | 'memory_search'
  | 'memory_delete'
  | 'mcp_list_tools'
  | 'mcp_call_tool'
