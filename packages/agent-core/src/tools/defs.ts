/** OpenAI function-calling tool schemas. */
export const TOOL_DEFS = [
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
]

export const WRITE_TOOL_NAMES = new Set(['write_file', 'edit_file'])

export type ToolName =
  | 'list_dir'
  | 'read_file'
  | 'glob'
  | 'grep'
  | 'write_file'
  | 'edit_file'
