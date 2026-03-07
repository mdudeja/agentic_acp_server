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
  NewSessionParamsSchema,
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
      result: {
        name: 'DisposeResult',
        schema: {
          type: 'object',
          required: ['success'],
          properties: {
            success: { type: 'boolean' },
          },
        },
      },
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
      result: {
        name: 'AskResult',
        schema: {
          type: 'object',
          required: ['success'],
          properties: { success: { type: 'boolean' } },
        },
      },
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
      result: {
        name: 'AnswerResult',
        schema: {
          type: 'object',
          required: ['success'],
          properties: { success: { type: 'boolean' } },
        },
      },
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
