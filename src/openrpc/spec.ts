/**
 * OpenRPC specification — generated from TypeBox schemas.
 *
 * Schemas live in ./schemas.ts and are the single source of truth for:
 *  - TypeScript types (via Static<>)
 *  - Runtime validation (via Check() from typebox/value)
 *  - This OpenRPC spec (schema values here ARE the TypeBox TSchema objects)
 *
 * Run `bun run gen:openrpc` to write openrpc.json from this spec.
 */

import type { TObject } from 'typebox/type'
import type { OpenRpcParam, OpenRpcSpec } from './types'
import {
  AskParamsSchema,
  AnswerParamsSchema,
  InitParamsSchema,
  LogLevelSchema,
  EditorContextSchema,
  RespondParamsSchema,
  TerminalParamsSchema,
  TerminalRequestToEditorSchema,
  TerminalResponseSchema,
  DisposeParamsSchema,
  SwitchProviderParamsSchema,
  ListProvidersParamsSchema,
  NewSessionParamsSchema,
  ExportSessionParamsSchema,
  ImportSessionParamsSchema,
  SummarizeSessionParamsSchema,
  StatsParamsSchema,
  LoadSessionParamsSchema,
  RenameSessionParamsSchema,
  DeleteSessionParamsSchema,
  ArchiveSessionParamsSchema,
  ForkSessionParamsSchema,
  ResumeSessionParamsSchema,
  SwitchSessionModeParamsSchema,
  SwitchModelParamsSchema,
  ListConfigOptionsParamsSchema,
  SetConfigOptionParamsSchema,
  ListSessionsParamsSchema,
  NesStartParamsSchema,
  NesSuggestParamsSchema,
  NesCloseParamsSchema,
  NesAcceptParamsSchema,
  NesRejectParamsSchema,
  NesDidOpenParamsSchema,
  NesDidChangeParamsSchema,
  NesDidCloseParamsSchema,
  NesDidSaveParamsSchema,
  NesDidFocusParamsSchema,
} from './schemas'

// ---------------------------------------------------------------------------
// Helper — converts a TypeBox TObject's properties into OpenRPC param array.
// `required` is read from the schema itself; pass `meta` to add summaries.
// ---------------------------------------------------------------------------
function propsOf(
  schema: TObject,
  meta: Record<string, { summary?: string; description?: string }> = {},
): OpenRpcParam[] {
  const requiredSet = new Set<string>(schema.required ?? [])
  return Object.entries(schema.properties).map(([name, propSchema]) => ({
    name,
    required: requiredSet.has(name),
    summary: meta[name]?.summary,
    description: meta[name]?.description,
    schema: propSchema,
  }))
}

// Convenience — single param not part of an object schema
function param(
  name: string,
  schema: object,
  opts: { required?: boolean; summary?: string; description?: string } = {},
): OpenRpcParam {
  return {
    name,
    schema,
    required: opts.required ?? true,
    summary: opts.summary,
    description: opts.description,
  }
}

function successOnlyResult(name: string) {
  return {
    name,
    schema: {
      type: 'object',
      properties: { success: { type: 'boolean' }, error: { type: 'string' } },
      required: ['success'],
    },
  }
}

const nullResult = (description: string) => ({
  name: 'NotificationResult',
  schema: { type: 'null' as const, description },
})

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------
export const spec: OpenRpcSpec = {
  openrpc: '1.2.6',
  info: {
    title: 'Agentic Server',
    description:
      'JSON-RPC 2.0 interface between the Editor plugin client and the Agentic server.\n\n' +
      'All messages are wrapped in the envelope:\n' +
      '```json\n{ "jsonrpc": "2.0", "data": { "method": "<method>", "params": { ... } } }\n```\n\n' +
      '**CLIENT → SERVER** methods are sent by the Editor plugin.\n' +
      '**SERVER → CLIENT** methods are responses or notifications pushed by the server.',
    version: '0.1.0',
  },
  methods: [
    // -------------------------------------------------------------------------
    // CLIENT → SERVER
    // -------------------------------------------------------------------------
    {
      name: 'client/init',
      summary: 'Initialize the agent for the current workspace',
      description:
        'Creates and spawns an agent using the specified AI provider in the given ' +
        'working directory. Must be called before any other client/* methods. ' +
        'Responds with success and the spawned agent ID.',
      paramStructure: 'by-name',
      params: propsOf(InitParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        provider: { summary: 'AI provider to use' },
        cwd: { summary: 'Absolute path to the workspace root' },
      }),
      result: {
        name: 'InitResult',
        schema: {
          type: 'object',
          required: ['success', 'agentId'],
          properties: {
            success: { type: 'boolean' },
            agentId: {
              type: 'string',
              description: 'Stable ID of the spawned agent',
            },
          },
        },
      },
      examples: [
        {
          name: 'copilot init',
          params: [
            { name: 'provider', value: 'copilot' },
            { name: 'cwd', value: '/home/user/my-project' },
          ],
          result: {
            name: 'result',
            value: { success: true, agentId: 'cm9abc123def456' },
          },
        },
      ],
    },
    {
      name: 'client/new_session',
      summary: 'Start a new session with the active agent',
      description:
        'Begins a new session (conversation) with the currently active agent. ' +
        'Responds with success and the new session ID.',
      paramStructure: 'by-name',
      params: propsOf(NewSessionParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        sessionName: { summary: 'Optional name for the new session' },
      }),
      result: {
        name: 'NewSessionResult',
        schema: {
          type: 'object',
          required: ['success', 'sessionId'],
          properties: {
            success: { type: 'boolean' },
            sessionId: {
              type: 'string',
              description: 'Stable ID of the new session',
            },
          },
        },
      },
      examples: [
        {
          name: 'new session with name',
          params: [{ name: 'sessionName', value: 'Debugging session' }],
          result: {
            name: 'result',
            value: { success: true, sessionId: 'sess_abc123' },
          },
        },
        {
          name: 'new session without name',
          params: [],
          result: {
            name: 'result',
            value: { success: true, sessionId: 'sess_def456' },
          },
        },
      ],
    },
    {
      name: 'client/dispose',
      summary: 'Dispose the active agent and clean up resources',
      description:
        'Terminates the spawned agent and releases any associated resources. ' +
        'Should be called when the session is complete or the user wants to reset. ' +
        'Responds with success.',
      paramStructure: 'by-name',
      params: propsOf(DisposeParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        reason: { summary: 'Optional reason for disposal' },
        agentId: { summary: 'Optional ID of the specific agent to dispose' },
      }),
      result: successOnlyResult('DisposeResult'),
      examples: [
        {
          name: 'dispose with reason',
          params: [{ name: 'reason', value: 'Session complete' }],
          result: { name: 'result', value: { success: true } },
        },
        {
          name: 'dispose without reason',
          params: [],
          result: { name: 'result', value: { success: true } },
        },
      ],
    },
    {
      name: 'client/switch_provider',
      summary: 'Switch the active provider (single-active model)',
      description:
        'Tears down the current agent/connection and initialises the requested ' +
        'provider in the given `cwd` (defaults to the active agent/workspace). ' +
        'Only one provider is active at a time; the session list is scoped to it. ' +
        'Responds with success, the provider and the new agent id.',
      paramStructure: 'by-name',
      params: propsOf(SwitchProviderParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        provider: { summary: 'Provider to switch to' },
        cwd: {
          summary: 'Working directory; defaults to the current agent/workspace',
        },
      }),
      result: {
        name: 'SwitchProviderResult',
        schema: {
          type: 'object',
          required: ['success'],
          properties: {
            success: { type: 'boolean' },
            provider: { type: 'string' },
            agentId: { type: 'string' },
            error: { type: 'string' },
          },
        },
      },
      examples: [
        {
          name: 'switch to opencode',
          params: [{ name: 'provider', value: 'opencode' }],
          result: {
            name: 'result',
            value: { success: true, provider: 'opencode', agentId: 'agent_x' },
          },
        },
      ],
    },
    {
      name: 'client/list_providers',
      summary: 'List known providers and the active one',
      description:
        'Returns every known provider with whether it is the active provider ' +
        'and whether it currently has a live agent/connection.',
      paramStructure: 'by-name',
      params: propsOf(ListProvidersParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
      }),
      result: {
        name: 'ListProvidersResult',
        schema: {
          type: 'object',
          required: ['success', 'providers'],
          properties: {
            success: { type: 'boolean' },
            providers: {
              type: 'array',
              description: 'List of { provider, active, agentId, connected }',
            },
          },
        },
      },
    },
    {
      name: 'client/ask',
      summary: 'Send a prompt to the active agent',
      description:
        'Forwards a user prompt (with optional Editor context snippets) to the spawned ' +
        'agent. Requires a prior successful `client/init`.',
      paramStructure: 'by-name',
      params: propsOf(AskParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        prompt: { summary: "The user's question or instruction" },
        contexts: {
          summary: 'Optional Editor context objects to attach to the prompt',
        },
      }),
      result: successOnlyResult('AskResult'),
      examples: [
        {
          name: 'plain prompt',
          params: [
            { name: 'prompt', value: 'Explain what this function does' },
          ],
          result: { name: 'result', value: { success: true } },
        },
        {
          name: 'prompt with file context',
          params: [
            { name: 'prompt', value: 'Refactor this to use async/await' },
            {
              name: 'contexts',
              value: [
                {
                  type: 'selection',
                  content:
                    'function fetchData(url) {\n  return fetch(url).then(r => r.json())\n}',
                  metadata: {
                    filePath: 'src/api.ts',
                    startLine: 12,
                    endLine: 14,
                  },
                },
              ],
            },
          ],
          result: { name: 'result', value: { success: true } },
        },
      ],
    },
    {
      name: 'client/answer',
      summary: 'Reply to a question sent by the server via `agentic/question`',
      description:
        'The server pauses and sends an `agentic/question` notification when the agent ' +
        'needs user input. Supply the answer here, referencing the same `questionId`.',
      paramStructure: 'by-name',
      params: propsOf(AnswerParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        questionId: {
          summary:
            'ID of the question (from the `agentic/question` notification)',
        },
      }),
      result: successOnlyResult('AnswerResult'),
      examples: [
        {
          name: 'confirm a permission',
          params: [
            { name: 'questionId', value: 'q_xyz789' },
            { name: 'answer', value: 'yes' },
          ],
          result: { name: 'result', value: { success: true } },
        },
      ],
    },
    {
      name: 'client/terminal',
      summary: 'Send a terminal operation response back to the server',
      description:
        'The server sends `agentic/terminal` notifications requesting terminal actions ' +
        '(create, get_output, wait_exit, kill, release). The client performs the action ' +
        'and replies with the result, matching `requestId`.',
      paramStructure: 'by-name',
      params: propsOf(TerminalParamsSchema, {
        requestId: {
          summary:
            'Matches the `requestId` from the originating `agentic/terminal` notification',
        },
        error: { summary: 'Set if the terminal operation failed' },
        response: { summary: 'Discriminated union keyed on `request`' },
      }),
      result: nullResult('Fire-and-forget — no response'),
      examples: [
        {
          name: 'create terminal response',
          params: [
            { name: 'requestId', value: 'req_001' },
            {
              name: 'response',
              value: {
                request: 'create',
                params: { terminalId: 'term_abc', jobId: 42 },
              },
            },
          ],
          result: { name: 'result', value: null },
        },
        {
          name: 'get_output response',
          params: [
            { name: 'requestId', value: 'req_002' },
            {
              name: 'response',
              value: {
                request: 'get_output',
                params: {
                  stdout: 'Hello, world!\n',
                  stderr: '',
                  truncated: false,
                },
              },
            },
          ],
          result: { name: 'result', value: null },
        },
      ],
    },
    {
      name: 'client/load_session',
      summary: 'Load a previous session into the active agent',
      description:
        'Loads a previous session (conversation history) back into the currently active agent. ',
      paramStructure: 'by-name',
      params: propsOf(LoadSessionParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        sessionId: { summary: 'ID of the session to load' },
      }),
      result: {
        name: 'LoadSessionResult',
        schema: {
          type: 'object',
          required: ['success', 'sessionId'],
          properties: {
            success: { type: 'boolean' },
            sessionId: { type: 'string' },
          },
        },
      },
      examples: [
        {
          name: 'load session',
          params: [{ name: 'sessionId', value: 'sess_abc123' }],
          result: {
            name: 'result',
            value: { success: true, sessionId: 'sess_abc123' },
          },
        },
      ],
    },
    {
      name: 'client/rename_session',
      summary: 'Rename an existing session',
      description:
        'Renames a session with the given ID to the new name. ' +
        'Responds with success.',
      paramStructure: 'by-name',
      params: propsOf(RenameSessionParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        sessionId: { summary: 'ID of the session to rename' },
        newName: { summary: 'The new name for the session' },
      }),
      result: successOnlyResult('RenameSessionResult'),
      examples: [
        {
          name: 'rename session',
          params: [
            { name: 'sessionId', value: 'sess_abc123' },
            { name: 'newName', value: 'Renamed Session' },
          ],
          result: {
            name: 'result',
            value: { success: true },
          },
        },
      ],
    },
    {
      name: 'client/delete_session',
      summary: 'Delete a session and its associated resources',
      description:
        'Deletes the session with the given ID from the database, and triggers ' +
        'cleanup of any associated resources (e.g. exported session files, CLI sessions).',
      paramStructure: 'by-name',
      params: propsOf(DeleteSessionParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        sessionId: { summary: 'ID of the session to delete' },
      }),
      result: successOnlyResult('DeleteSessionResult'),
      examples: [
        {
          name: 'delete session',
          params: [{ name: 'sessionId', value: 'sess_abc123' }],
          result: {
            name: 'result',
            value: { success: true },
          },
        },
      ],
    },
    {
      name: 'client/archive_session',
      summary:
        'Archive or unarchive (if previously archived) a session (Mark as archived without deletion, with optional export)',
      description:
        'Archives or unarchives the session with the given ID. ' +
        'Optionally exports the session before archiving. ' +
        'Responds with success',
      paramStructure: 'by-name',
      params: propsOf(ArchiveSessionParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        sessionId: { summary: 'ID of the session to archive' },
        archive: {
          summary: 'Whether archive or unarchive. True means archive.',
        },
        exportBeforeArchive: {
          summary: 'Whether to export the session before archiving',
        },
      }),
      result: successOnlyResult('ArchiveSessionResult'),
      examples: [
        {
          name: 'archive session',
          params: [
            { name: 'sessionId', value: 'sess_abc123' },
            { name: 'archive', value: true },
            { name: 'exportBeforeArchive', value: true },
          ],
          result: {
            name: 'result',
            value: { success: true },
          },
        },
        {
          name: 'unarchive session',
          params: [
            { name: 'sessionId', value: 'sess_abc123' },
            { name: 'archive', value: false },
          ],
          result: {
            name: 'result',
            value: { success: true },
          },
        },
      ],
    },
    {
      name: 'client/fork_session',
      summary: 'Fork a session to create a new session with the same history',
      description:
        'Creates a new session by forking an existing session. The new session ' +
        'starts with the same conversation history as the original session, allowing ' +
        'the user to diverge the conversation in a new direction without losing the ' +
        'original session. Responds with success.',
      paramStructure: 'by-name',
      params: propsOf(ForkSessionParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        sessionId: { summary: 'ID of the session to fork' },
        newSessionName: { summary: 'Optional name for the new forked session' },
      }),
      result: successOnlyResult('ForkSessionResult'),
      examples: [
        {
          name: 'fork session',
          params: [
            { name: 'sessionId', value: 'sess_abc123' },
            { name: 'newSessionName', value: 'Forked Session' },
          ],
          result: {
            name: 'result',
            value: { success: true },
          },
        },
      ],
    },
    {
      name: 'client/resume_session',
      summary: 'Resume a session by loading it and making it active',
      description:
        'Resumes a session by loading its conversation history and making it the active session. ' +
        'Responds with success and session id.',
      paramStructure: 'by-name',
      params: propsOf(ResumeSessionParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        sessionId: { summary: 'ID of the session to resume' },
      }),
      result: successOnlyResult('ResumeSessionResult'),
      examples: [
        {
          name: 'resume session',
          params: [{ name: 'sessionId', value: 'sess_abc123' }],
          result: {
            name: 'result',
            value: { success: true },
          },
        },
      ],
    },
    {
      name: 'client/switch_session_mode',
      summary:
        'Triggers a change in mode for the session.' +
        'Prompts the user for selecting a mode from the available modes of the provider.' +
        'The mode is switched once the user responds. Responds with success.',
      paramStructure: 'by-name',
      params: propsOf(SwitchSessionModeParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        sessionId: { summary: 'ID of the session to switch mode' },
      }),
      result: successOnlyResult('SwitchSessionModeResult'),
    },
    {
      name: 'client/switch_model',
      summary: 'Switch the AI model for the active session',
      description:
        'Switches the AI model used by the currently active session. ' +
        'Prompts the user to select from the available models of the provider. ' +
        'Responds with success.',
      paramStructure: 'by-name',
      params: propsOf(SwitchModelParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        sessionId: { summary: 'ID of the session to switch model' },
      }),
      result: successOnlyResult('SwitchModelResult'),
    },
    {
      name: 'client/list_config_options',
      summary: 'List the session agent-advertised configuration options',
      description:
        'Returns the session config options (mode, model, thought_level, …) in a ' +
        'uniform shape, flattening grouped selects. `category` identifies the ' +
        'semantic selector; `options[].value` are the selectable values.',
      paramStructure: 'by-name',
      params: propsOf(ListConfigOptionsParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        sessionId: { summary: 'Session ID; defaults to the active session' },
      }),
      result: {
        name: 'ListConfigOptionsResult',
        schema: {
          type: 'object',
          required: ['success'],
          properties: {
            success: { type: 'boolean' },
            sessionId: { type: 'string' },
            configOptions: {
              type: 'array',
              description: 'Uniform config option views',
            },
            error: { type: 'string' },
          },
        },
      },
    },
    {
      name: 'client/set_config_option',
      summary: 'Set a session config option (mode / model / thought level)',
      description:
        'Sets a config option resolved by `id` first, then by semantic ' +
        '`category` (e.g. `mode`, `model`, `model_config`, `thought_level`). ' +
        'The agent response is authoritative and is persisted to the session. ' +
        'Responds with the updated config options.',
      paramStructure: 'by-name',
      params: propsOf(SetConfigOptionParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        sessionId: { summary: 'Session ID; defaults to the active session' },
        optionId: { summary: 'Config option id, or its category' },
        value: { summary: 'New value (string for selects, boolean for toggles)' },
      }),
      result: {
        name: 'SetConfigOptionResult',
        schema: {
          type: 'object',
          required: ['success'],
          properties: {
            success: { type: 'boolean' },
            configOptions: { type: 'array' },
            error: { type: 'string' },
          },
        },
      },
    },
    {
      name: 'client/list_sessions',
      summary: 'List all sessions for the current workspace',
      description:
        'Retrieves a list of all sessions associated with the current workspace, including ' +
        'metadata such as session names, IDs, creation dates, and whether they are archived. ' +
        'Responds with success and the list of sessions.',
      paramStructure: 'by-name',
      params: propsOf(ListSessionsParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        source: {
          summary:
            "Tier to use: 'memory' | 'acp' | 'cli' | 'auto' (defaults to the configured sessionOps policy)",
        },
      }),
      result: {
        name: 'ListSessionsResult',
        schema: {
          type: 'object',
          required: ['success', 'sessions'],
          properties: {
            success: { type: 'boolean' },
            sessions: {
              type: 'array',
              description: 'List of session metadata objects',
            },
            error: { type: 'string' },
          },
        },
      },
    },
    {
      name: 'client/export_session',
      summary: 'Export a session to a file via the provider CLI',
      description:
        'Invokes the provider CLI to export a session to a JSON file. ' +
        'If `outputPath` is omitted the server uses the default path from ' +
        '`.agentic/config.json` (`sessions.memoryPath/<acp_session_id>.json`). ' +
        'Returns the path where the file was written.',
      paramStructure: 'by-name',
      params: propsOf(ExportSessionParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        sessionId: { summary: 'Local session ID to export' },
        outputPath: {
          summary:
            'Destination file path; defaults to sessions.memoryPath/<id>.json',
        },
        source: {
          summary: "Tier to use: 'acp' | 'cli' | 'auto' (default: sessionOps policy)",
        },
      }),
      result: {
        name: 'ExportSessionResult',
        schema: {
          type: 'object',
          required: ['success'],
          properties: {
            success: { type: 'boolean' },
            filePath: {
              type: 'string',
              description: 'Path of the exported file',
            },
            error: { type: 'string' },
          },
        },
      },
      examples: [
        {
          name: 'export with explicit path',
          params: [
            { name: 'sessionId', value: 'sess_abc' },
            {
              name: 'outputPath',
              value: '/home/user/.agentic/sessions/sess_abc.json',
            },
          ],
          result: {
            name: 'result',
            value: {
              success: true,
              filePath: '/home/user/.agentic/sessions/sess_abc.json',
            },
          },
        },
      ],
    },
    {
      name: 'client/import_session',
      summary: 'Import a session from a file via the provider CLI',
      description:
        'Invokes the provider CLI to import a previously exported session file ' +
        'back into the provider. The session becomes available for loading afterward.',
      paramStructure: 'by-name',
      params: propsOf(ImportSessionParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        filePath: { summary: 'Path to the session JSON file to import' },
        source: {
          summary: "Tier to use: 'acp' | 'cli' | 'auto' (default: sessionOps policy)",
        },
      }),
      result: successOnlyResult('ImportSessionResult'),
      examples: [
        {
          name: 'import session',
          params: [
            {
              name: 'filePath',
              value: '/home/user/.agentic/sessions/sess_abc.json',
            },
          ],
          result: { name: 'result', value: { success: true } },
        },
      ],
    },
    {
      name: 'client/summarize_session',
      summary: 'Summarize the active session to a Markdown file',
      description:
        'Asks the active agent (which already holds the conversation in ' +
        'context) to summarize the session, then writes the summary to ' +
        '`sessions.summaryPath/<sessionId>.md` with a metadata header and ' +
        'upserts a `session_summaries` row. Only the ACTIVE session of the ' +
        'active provider can be summarized. Use the returned summary to seed ' +
        'a new session on another provider (summarize -> switch_provider -> ' +
        'new_session -> ask).',
      paramStructure: 'by-name',
      params: propsOf(SummarizeSessionParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        sessionId: { summary: 'Session ID; defaults to the active session' },
      }),
      result: {
        name: 'SummarizeSessionResult',
        schema: {
          type: 'object',
          required: ['success'],
          properties: {
            success: { type: 'boolean' },
            filePath: { type: 'string' },
            summary: { type: 'string' },
            error: { type: 'string' },
          },
        },
      },
    },
    {
      name: 'client/stats',
      summary: 'Retrieve token usage statistics from the provider',
      description:
        'Invokes the provider CLI to retrieve usage statistics. ' +
        'The `days` param limits the reporting window.',
      paramStructure: 'by-name',
      params: propsOf(StatsParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        days: {
          summary: 'Number of past days to include in the report (default: 7)',
        },
      }),
      result: {
        name: 'StatsResult',
        schema: {
          type: 'object',
          required: ['success'],
          properties: {
            success: { type: 'boolean' },
            data: { description: 'Raw stats object from the provider CLI' },
            error: { type: 'string' },
          },
        },
      },
      examples: [
        {
          name: 'stats last 7 days',
          params: [{ name: 'days', value: 7 }],
          result: {
            name: 'result',
            value: { success: true, data: { totalTokens: 42000, cost: 0.84 } },
          },
        },
      ],
    },
    {
      name: 'client/nes_start',
      summary: 'Start a NES (Next Edit Suggestions) session',
      description:
        'Starts a NES session with the agent. Only available if the agent ' +
        'advertises the `nes` capability. Responds with the NES session ID.',
      paramStructure: 'by-name',
      params: propsOf(NesStartParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        workspaceUri: { summary: 'Root URI of the workspace' },
        workspaceFolders: { summary: 'Workspace folders' },
        repository: { summary: 'Repository metadata, if a git repo' },
      }),
      result: {
        name: 'NesStartResult',
        schema: {
          type: 'object',
          required: ['success'],
          properties: {
            success: { type: 'boolean' },
            sessionId: { type: 'string' },
          },
        },
      },
    },
    {
      name: 'client/nes_suggest',
      summary: 'Request a NES suggestion for a document',
      description:
        'Requests a code suggestion from the agent for the given document and ' +
        'cursor position. Only available if the agent advertises the `nes` capability.',
      paramStructure: 'by-name',
      params: propsOf(NesSuggestParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        sessionId: { summary: 'NES session ID' },
        uri: { summary: 'URI of the document to suggest for' },
        version: { summary: 'Document version number' },
        position: { summary: 'Current cursor position' },
        selection: { summary: 'Current text selection range, if any' },
        triggerKind: { summary: 'What triggered the suggestion request' },
        context: { summary: 'Context attached to the suggestion request' },
      }),
      result: {
        name: 'NesSuggestResult',
        schema: {
          type: 'object',
          required: ['success'],
          properties: {
            success: { type: 'boolean' },
            suggestions: { type: 'array' },
          },
        },
      },
    },
    {
      name: 'client/nes_close',
      summary: 'Close a NES session',
      description:
        'Closes a NES session and frees up associated resources. Only available ' +
        'if the agent advertises the `nes` capability.',
      paramStructure: 'by-name',
      params: propsOf(NesCloseParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        sessionId: { summary: 'NES session ID to close' },
      }),
      result: successOnlyResult('NesCloseResult'),
    },
    {
      name: 'client/nes_accept',
      summary: 'Notify the agent that a NES suggestion was accepted',
      description:
        'Notifies the agent that a NES suggestion was accepted. Only available ' +
        'if the agent advertises the `nes` capability.',
      paramStructure: 'by-name',
      params: propsOf(NesAcceptParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        sessionId: { summary: 'NES session ID' },
        id: { summary: 'ID of the accepted suggestion' },
      }),
      result: successOnlyResult('NesAcceptResult'),
    },
    {
      name: 'client/nes_reject',
      summary: 'Notify the agent that a NES suggestion was rejected',
      description:
        'Notifies the agent that a NES suggestion was rejected. Only available ' +
        'if the agent advertises the `nes` capability.',
      paramStructure: 'by-name',
      params: propsOf(NesRejectParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        sessionId: { summary: 'NES session ID' },
        id: { summary: 'ID of the rejected suggestion' },
        reason: { summary: 'Reason for rejection' },
      }),
      result: successOnlyResult('NesRejectResult'),
    },
    {
      name: 'client/nes_did_open',
      summary: 'Notify the agent that a document was opened',
      description:
        'Notifies the agent that a document was opened. Only available if the ' +
        'agent advertises the `nes` capability.',
      paramStructure: 'by-name',
      params: propsOf(NesDidOpenParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        sessionId: { summary: 'NES session ID' },
        uri: { summary: 'URI of the opened document' },
        languageId: { summary: 'Language identifier of the document' },
        version: { summary: 'Document version number' },
        text: { summary: 'Full text content of the document' },
      }),
      result: successOnlyResult('NesDidOpenResult'),
    },
    {
      name: 'client/nes_did_change',
      summary: 'Notify the agent that a document was changed',
      description:
        'Notifies the agent that a document was changed. Only available if the ' +
        'agent advertises the `nes` capability.',
      paramStructure: 'by-name',
      params: propsOf(NesDidChangeParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        sessionId: { summary: 'NES session ID' },
        uri: { summary: 'URI of the changed document' },
        version: { summary: 'New document version number' },
        contentChanges: { summary: 'The content changes' },
      }),
      result: successOnlyResult('NesDidChangeResult'),
    },
    {
      name: 'client/nes_did_close',
      summary: 'Notify the agent that a document was closed',
      description:
        'Notifies the agent that a document was closed. Only available if the ' +
        'agent advertises the `nes` capability.',
      paramStructure: 'by-name',
      params: propsOf(NesDidCloseParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        sessionId: { summary: 'NES session ID' },
        uri: { summary: 'URI of the closed document' },
      }),
      result: successOnlyResult('NesDidCloseResult'),
    },
    {
      name: 'client/nes_did_save',
      summary: 'Notify the agent that a document was saved',
      description:
        'Notifies the agent that a document was saved. Only available if the ' +
        'agent advertises the `nes` capability.',
      paramStructure: 'by-name',
      params: propsOf(NesDidSaveParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        sessionId: { summary: 'NES session ID' },
        uri: { summary: 'URI of the saved document' },
      }),
      result: successOnlyResult('NesDidSaveResult'),
    },
    {
      name: 'client/nes_did_focus',
      summary: 'Notify the agent that a document received focus',
      description:
        'Notifies the agent that a document received focus. Only available if the ' +
        'agent advertises the `nes` capability.',
      paramStructure: 'by-name',
      params: propsOf(NesDidFocusParamsSchema, {
        requestId: { summary: 'Optional correlation ID for the request' },
        sessionId: { summary: 'NES session ID' },
        uri: { summary: 'URI of the focused document' },
        version: { summary: 'Document version number' },
        position: { summary: 'Current cursor position' },
        visibleRange: { summary: 'Portion of the file visible in the viewport' },
      }),
      result: successOnlyResult('NesDidFocusResult'),
    },

    // -------------------------------------------------------------------------
    // SERVER → CLIENT
    // -------------------------------------------------------------------------
    {
      name: 'agentic/respond',
      summary: '[Server → Client] Result or error for a prior client/* call',
      description:
        'Sent by the server after processing any `client/*` method. ' +
        '`method` echoes the original client method, `id` correlates to the ' +
        '`requestId` supplied in the params (if any). ' +
        'Exactly one of `result` or `error` will be present.',
      paramStructure: 'by-name',
      params: propsOf(RespondParamsSchema, {
        method: { summary: 'The client method this response belongs to' },
        type: {
          summary: 'The type of the message (`response` or `notification`)',
        },
        id: {
          summary: 'Correlates to the requestId sent in the client params',
        },
        error: { summary: 'Set when the server encountered an error' },
        result: { summary: 'Set on success — shape depends on the method' },
      }),
      result: nullResult('Notification — no response expected'),
      examples: [
        {
          name: 'successful init response',
          params: [
            { name: 'method', value: 'client/init' },
            { name: 'id', value: 'req_001' },
            { name: 'type', value: 'response' },
            {
              name: 'result',
              value: { success: true, agentId: 'cm9abc123def456' },
            },
          ],
          result: { name: 'result', value: null },
        },
        {
          name: 'error response',
          params: [
            { name: 'method', value: 'client/ask' },
            { name: 'id', value: 'req_002' },
            { name: 'type', value: 'response' },
            {
              name: 'error',
              value: { message: 'Agent not initialised' },
            },
          ],
          result: { name: 'result', value: null },
        },
      ],
    },
    {
      name: 'agentic/log',
      summary: '[Server → Client] Log message notification',
      description:
        'Pushed by the server to stream log output to the Editor plugin. Not a request — no response expected.',
      paramStructure: 'by-name',
      params: [
        param('level', LogLevelSchema),
        param('message', { type: 'string' }),
      ],
      result: nullResult('Notification — no response expected'),
      examples: [
        {
          name: 'info log',
          params: [
            { name: 'level', value: 'info' },
            { name: 'message', value: 'Agent spawned successfully' },
            { name: 'type', value: 'notification' },
          ],
          result: { name: 'result', value: null },
        },
      ],
    },
    {
      name: 'agentic/terminal',
      summary: '[Server → Client] Request a terminal operation in the Editor',
      description:
        'The server needs to execute a shell command. Sends this notification requesting ' +
        'the Editor plugin to manage the terminal lifecycle. ' +
        'The client must respond with `client/terminal` matching the `requestId`.',
      paramStructure: 'by-name',
      params: [
        param('request', {
          type: 'string',
          enum: Object.keys(TerminalRequestToEditorSchema),
        }),
        param('params', {
          oneOf: Object.entries(TerminalRequestToEditorSchema).map(
            ([key, schema]) => ({
              title: key,
              ...schema,
            }),
          ),
        }),
      ],
      result: nullResult('Notification — client responds via client/terminal'),
      examples: [
        {
          name: 'create terminal',
          params: [
            { name: 'request', value: 'create' },
            {
              name: 'params',
              value: {
                requestId: 'req_001',
                terminalId: 'term_abc',
                command: 'npm test',
                cwd: '/home/user/my-project',
              },
            },
            { name: 'type', value: 'notification' },
          ],
          result: { name: 'result', value: null },
        },
        {
          name: 'kill terminal',
          params: [
            { name: 'request', value: 'kill' },
            {
              name: 'params',
              value: {
                requestId: 'req_005',
                terminalId: 'term_abc',
                signal: 'SIGTERM',
              },
            },
            { name: 'type', value: 'notification' },
          ],
          result: { name: 'result', value: null },
        },
      ],
    },
    {
      name: 'agentic/question',
      summary:
        '[Server → Client] Ask the user a question and await their answer',
      description:
        'Sent by the server when the agent requires interactive input. ' +
        'The Editor plugin displays the question and calls `client/answer` with the matching `questionId`.',
      paramStructure: 'by-name',
      params: [
        param(
          'questionId',
          { type: 'string' },
          {
            required: false,
            summary:
              'Unique ID to correlate the answer — include in the `client/answer` call',
          },
        ),
        param('question', { type: 'string' }),
      ],
      result: nullResult('Notification — client responds via client/answer'),
      examples: [
        {
          name: 'permission question',
          params: [
            { name: 'questionId', value: 'q_xyz789' },
            {
              name: 'question',
              value: 'Allow the agent to delete files in /tmp/build? (yes/no)',
            },
            { name: 'type', value: 'notification' },
          ],
          result: { name: 'result', value: null },
        },
      ],
    },
    {
      name: 'agentic/session_update',
      summary:
        '[Server → Client] Notify about updates to the active session (e.g. new available commands)',
      description:
        'Sent by the server whenever there is an update related to the active session. ' +
        'The `updateType` field indicates the kind of update (e.g. `available_commands_update`), ' +
        'and the `update` field contains the relevant data payload.',
      paramStructure: 'by-name',
      params: [
        param('sessionId', { type: 'string' }),
        param('updateType', { type: 'string' }),
        param('update', { type: 'any' }),
      ],
      result: nullResult('Notification — no response expected'),
      examples: [
        {
          name: 'available commands update',
          params: [
            { name: 'sessionId', value: 'sess_abc123' },
            { name: 'updateType', value: 'available_commands_update' },
            {
              name: 'update',
              value: {
                availableCommands: [
                  {
                    name: 'run_tests',
                    description: 'Run the test suite',
                    args: [{ name: 'testFile', type: 'string' }],
                  },
                ],
              },
            },
            { name: 'type', value: 'notification' },
          ],
          result: { name: 'result', value: null },
        },
      ],
    },
  ],
}

// Suppress unused-import warnings — these are referenced only as JSON Schema
// values in the spec above (TypeScript doesn't see the .properties access as a usage).
void EditorContextSchema
void RespondParamsSchema
void TerminalResponseSchema
