import type { ContentBlock } from '@agentclientprotocol/sdk'
import { Type } from 'typebox'
import type { Static, TObject, TSchema } from 'typebox/type'

/**
 * The hook event catalogue: for each event, the input a hook receives, the
 * result it may return, and how the runner combines hooks.
 *
 * This is the single source of truth for hook types (via `Static<>`) and
 * for runtime validation of hook results (via `Check()`), in the same way
 * `src/openrpc/schemas.ts` is for the ASM surface.
 *
 * Modes:
 * - `observe`: every matching hook runs in parallel; results are ignored.
 * - `sequential`: hooks run one at a time in priority order. A result may
 *   change the event's transformable fields (later hooks see the change)
 *   and may return a `decision`; the first `allow`/`deny` ends the chain
 *   (`ask` asks the user, who then decides).
 */

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** A decision returned by a hook on a `sequential` event. */
export const HookDecisionSchema = Type.Union([
  Type.Literal('allow'),
  Type.Literal('deny'),
  Type.Literal('ask'),
])

const StringMap = Type.Record(Type.String(), Type.String())

/** ACP content blocks, typed for hooks but only shallowly validated. */
const PromptSchema = Type.Unsafe<ContentBlock[]>(
  Type.Array(Type.Object({ type: Type.String() })),
)

/**
 * Session ids for events raised by the agent (permissions, fs, terminals,
 * updates). `sessionId` is the local id the editor knows; it is absent when
 * the ACP session is not (yet) tracked.
 */
const AgentSessionRef = {
  sessionId: Type.Optional(Type.String()),
  acpSessionId: Type.String(),
}

const SessionInfoSchema = Type.Object({
  sessionId: Type.String(),
  acpSessionId: Type.String(),
  name: Type.Union([Type.String(), Type.Null()]),
})

type OnError = 'allow' | 'deny' | 'ignore'

interface EventDefinition<
  Mode extends 'observe' | 'sequential',
  Input extends TSchema,
  Result extends TSchema,
> {
  mode: Mode
  input: Input
  result: Result
  /** Result fields that replace the matching input fields. */
  transform: readonly string[]
  /** What a failing/timed-out hook means unless it sets `onError` itself. */
  onError: OnError
  description: string
}

/** Monitors an object and allows for a description of what is being observed. */
function observe<I extends TObject>(input: I, description: string) {
  return {
    mode: 'observe',
    input,
    result: Type.Any(),
    transform: [],
    onError: 'ignore',
    description,
  } as const satisfies EventDefinition<'observe', I, TSchema>
}

/**
 * A `sequential` event whose result is `{ decision?, reason? }` plus the
 * optional transformable fields in `transform`.
 */
function sequential<
  I extends TObject,
  T extends Record<string, TSchema> = Record<never, TSchema>,
>(input: I, options: { transform?: T; onError: OnError; description: string }) {
  const transformSchemas = Object.fromEntries(
    Object.entries(options.transform ?? {}).map(([key, schema]) => [
      key,
      Type.Optional(schema),
    ]),
  ) as { [K in keyof T]: ReturnType<typeof Type.Optional<T[K]>> }

  return {
    mode: 'sequential',
    input,
    result: Type.Object({
      decision: Type.Optional(HookDecisionSchema),
      reason: Type.Optional(Type.String()),
      ...transformSchemas,
    }),
    transform: Object.keys(options.transform ?? {}),
    onError: options.onError,
    description: options.description,
  } as const
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export const HOOK_EVENTS = {
  'server.start': observe(
    Type.Object({ workspaceRoot: Type.String() }),
    'The server finished starting (before any agent is connected).',
  ),
  'server.shutdown': observe(
    Type.Object({ workspaceRoot: Type.String() }),
    'The server is shutting down; awaited (bounded by hook timeouts).',
  ),

  'agent.beforeSpawn': sequential(
    Type.Object({
      provider: Type.String(),
      cwd: Type.String(),
      command: Type.String(),
      args: Type.Array(Type.String()),
      env: StringMap,
    }),
    {
      transform: {
        command: Type.String(),
        args: Type.Array(Type.String()),
        env: StringMap,
      },
      onError: 'ignore',
      description:
        'About to start the agent process. Change command/args/env, or deny to refuse the start.',
    },
  ),
  'agent.connected': observe(
    Type.Object({
      provider: Type.String(),
      agentId: Type.String(),
      cwd: Type.String(),
      /** First connection for this (provider, cwd) agent. */
      firstConnect: Type.Boolean(),
    }),
    'The agent process is running and the ACP handshake succeeded.',
  ),
  'agent.exited': observe(
    Type.Object({
      provider: Type.String(),
      agentId: Type.String(),
      exitCode: Type.Union([Type.Number(), Type.Null()]),
    }),
    'The agent process exited on its own (crash or failed start).',
  ),

  'session.created': observe(SessionInfoSchema, 'A new session was created.'),
  'session.loaded': observe(
    SessionInfoSchema,
    'A session became active (new, load, fork or resume).',
  ),
  'session.suspended': observe(
    SessionInfoSchema,
    'The active session was replaced by another one.',
  ),
  'session.deleted': observe(
    Type.Object({ sessionId: Type.String() }),
    'A session was deleted.',
  ),

  'prompt.before': sequential(
    Type.Object({
      sessionId: Type.String(),
      acpSessionId: Type.String(),
      /** `internal` prompts are sent by the server itself (e.g. summaries). */
      origin: Type.Union([Type.Literal('user'), Type.Literal('internal')]),
      prompt: PromptSchema,
    }),
    {
      transform: { prompt: PromptSchema },
      onError: 'deny',
      description:
        'About to send a prompt. Rewrite the content blocks, or deny to block it.',
    },
  ),
  'prompt.after': observe(
    Type.Object({
      sessionId: Type.String(),
      acpSessionId: Type.String(),
      origin: Type.Union([Type.Literal('user'), Type.Literal('internal')]),
      stopReason: Type.Optional(Type.String()),
      usage: Type.Optional(Type.Any()),
      durationMs: Type.Number(),
      /** Set when the prompt request failed. */
      error: Type.Optional(Type.String()),
    }),
    'A prompt turn finished (or failed).',
  ),

  'permission.request': sequential(
    Type.Object({
      ...AgentSessionRef,
      toolCall: Type.Object({
        toolCallId: Type.String(),
        title: Type.Optional(Type.String()),
        kind: Type.Optional(Type.String()),
        rawInput: Type.Optional(Type.Unknown()),
      }),
      options: Type.Array(
        Type.Object({
          optionId: Type.String(),
          name: Type.String(),
          kind: Type.String(),
        }),
      ),
    }),
    {
      onError: 'deny',
      description:
        'The agent asks permission for a tool call. allow/deny answer it without asking the user.',
    },
  ),

  'fs.beforeRead': sequential(
    Type.Object({
      ...AgentSessionRef,
      path: Type.String(),
      line: Type.Optional(Type.Number()),
      limit: Type.Optional(Type.Number()),
    }),
    {
      onError: 'deny',
      description: 'The agent reads a file through the client. Deny to refuse.',
    },
  ),
  'fs.beforeWrite': sequential(
    Type.Object({
      ...AgentSessionRef,
      path: Type.String(),
      content: Type.String(),
    }),
    {
      transform: { content: Type.String() },
      onError: 'deny',
      description:
        'The agent writes a file through the client. Rewrite the content, or deny to refuse.',
    },
  ),
  'fs.afterWrite': observe(
    Type.Object({ ...AgentSessionRef, path: Type.String() }),
    'A file write by the agent succeeded.',
  ),

  'terminal.beforeCreate': sequential(
    Type.Object({
      ...AgentSessionRef,
      command: Type.String(),
      args: Type.Array(Type.String()),
      cwd: Type.Optional(Type.String()),
      env: Type.Optional(StringMap),
    }),
    {
      transform: {
        command: Type.String(),
        args: Type.Array(Type.String()),
        cwd: Type.String(),
        env: StringMap,
      },
      onError: 'deny',
      description:
        'The agent runs a command in a terminal. Rewrite it, or deny to refuse.',
    },
  ),
  'terminal.afterExit': observe(
    Type.Object({
      ...AgentSessionRef,
      terminalId: Type.String(),
      command: Type.Optional(Type.String()),
      exitCode: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
      signal: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    }),
    'A terminal command the agent waited on has exited.',
  ),

  'session.update': observe(
    Type.Object({
      ...AgentSessionRef,
      /** The ACP `sessionUpdate` kind, e.g. `tool_call`, `usage_update`. */
      updateType: Type.String(),
      update: Type.Any(),
    }),
    'The agent streamed a session update. Match on `updateType`.',
  ),

  'elicitation.request': sequential(
    Type.Object({
      acpSessionId: Type.Optional(Type.String()),
      mode: Type.String(),
      message: Type.String(),
      requestedSchema: Type.Optional(Type.Any()),
      url: Type.Optional(Type.String()),
      /** Form answers collected so far by earlier hooks. */
      content: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),
    {
      transform: { content: Type.Record(Type.String(), Type.Unknown()) },
      onError: 'ignore',
      description:
        'The agent asks the user for input. allow answers it with `content`; deny declines.',
    },
  ),
} as const

export type HookEventName = keyof typeof HOOK_EVENTS

export const HOOK_EVENT_NAMES = Object.keys(HOOK_EVENTS) as HookEventName[]

export type HookInput<E extends HookEventName> = Static<
  (typeof HOOK_EVENTS)[E]['input']
>

/**
 * Result types per event, precomputed (an indexed map rather than a
 * conditional type, so TypeScript can contextually type handler return
 * literals like `{ decision: 'deny' }`).
 */
type HookResultMap = {
  [E in HookEventName]: (typeof HOOK_EVENTS)[E]['mode'] extends 'sequential'
    ? Static<(typeof HOOK_EVENTS)[E]['result']>
    : unknown
}

/** What a hook may return for event `E` (observe events ignore it). */
export type HookResult<E extends HookEventName> = HookResultMap[E]

export type HookDecision = Static<typeof HookDecisionSchema>
