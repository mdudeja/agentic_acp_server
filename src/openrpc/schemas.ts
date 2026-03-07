/**
 * TypeBox schemas for the Agentic Server JSON-RPC interface.
 *
 * These schemas are the single source of truth for:
 *  1. TypeScript types (via Static<>) — replacing hand-written types in ICommsInterface.ts
 *  2. Runtime validation (via Check() from typebox/value) — incoming message validation
 *  3. OpenRPC spec generation — schema values drop directly into the spec as JSON Schema
 *
 * Adding a new method:
 *  1. Define its params schema here with Type.Object(...)
 *  2. Add it to ASMPayloadDataSchema's union
 *  3. Export the Static<> type alias
 *  4. Add it to openrpc/spec.ts
 */

import { Type } from 'typebox'
import type { Static } from 'typebox/type'
import { PROVIDERS } from 'src/data/providers'

// ---------------------------------------------------------------------------
// Shared / primitive schemas
// ---------------------------------------------------------------------------

export const ProviderSchema = Type.Union(
  Object.keys(PROVIDERS).map((k) => Type.Literal(k)),
)

export const LogLevelSchema = Type.Union([
  Type.Literal('info'),
  Type.Literal('warn'),
  Type.Literal('error'),
])

export const EditorContextSchema = Type.Object({
  type: Type.Union([
    Type.Literal('selection'),
    Type.Literal('file'),
    Type.Literal('workspace'),
    Type.Literal('keymaps'),
    Type.Literal('diagnostics'),
    Type.Literal('image'),
    Type.Literal('audio'),
    Type.Literal('link'),
  ]),
  text: Type.String(),
  metadata: Type.Optional(
    Type.Object({
      mimetype: Type.Optional(Type.String()),
      name: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
      data: Type.Optional(Type.String()), // Base64-encoded string for binary data like images/audio
      uri: Type.Optional(Type.String()), // For links or references to external resources
      size: Type.Optional(Type.Number()), // Size in bytes
    }),
  ),
  annotations: Type.Optional(
    Type.Object({
      audience: Type.Optional(
        Type.Array(
          Type.Union([Type.Literal('user'), Type.Literal('assitant')]),
        ),
      ),
      priority: Type.Optional(Type.Number()), // Between 0 and 1, where 1 is highest priority
      lastModified: Type.Optional(Type.String()), // ISO date string
    }),
  ),
})

// EnvVariable and TerminalExitStatus come from @agentclientprotocol/sdk
const EnvVariableSchema = Type.Object({}, { additionalProperties: true })
const TerminalExitStatusSchema = Type.Object({}, { additionalProperties: true })

// ---------------------------------------------------------------------------
// CLIENT → SERVER: per-method param schemas
// ---------------------------------------------------------------------------

export const InitParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  provider: ProviderSchema,
  cwd: Type.String(),
})

export const DisposeParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  reason: Type.Optional(Type.String()),
  agentId: Type.Optional(Type.String()),
})

export const AskParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  prompt: Type.String(),
  contexts: Type.Optional(Type.Array(EditorContextSchema)),
})

export const AnswerParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  questionId: Type.String(),
  answer: Type.String(),
})

// Session sub-schemas
export const NewSessionParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  sessionName: Type.Optional(Type.String()),
})

export const LoadSessionParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  sessionId: Type.String(),
})

export const RenameSessionParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  sessionId: Type.String(),
  newName: Type.String(),
})

export const DeleteSessionParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  sessionId: Type.String(),
})

export const ArchiveSessionParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  sessionId: Type.String(),
  archive: Type.Boolean(),
})

export const ForkSessionParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  sessionId: Type.String(),
  newName: Type.Optional(Type.String()),
})

export const ResumeSessionParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  sessionId: Type.String(),
})

export const SwitchSessionModeParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  sessionId: Type.String(),
})

export const SwitchModelParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  sessionId: Type.String(),
  model: Type.String(),
})

export const ListSessionsParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
})

// Terminal response sub-schemas (client replies to agentic/terminal requests)
const TerminalResponseCreateSchema = Type.Object({
  request: Type.Literal('create'),
  params: Type.Object({
    terminalId: Type.String(),
    jobId: Type.Optional(Type.Number()),
  }),
})
const TerminalResponseGetOutputSchema = Type.Object({
  request: Type.Literal('get_output'),
  params: Type.Object({
    stdout: Type.String(),
    stderr: Type.String(),
    exitStatus: Type.Optional(TerminalExitStatusSchema),
    truncated: Type.Optional(Type.Boolean()),
  }),
})
const TerminalResponseWaitExitSchema = Type.Object({
  request: Type.Literal('wait_exit'),
  params: Type.Object({ exitStatus: TerminalExitStatusSchema }),
})
const TerminalResponseKillSchema = Type.Object({
  request: Type.Literal('kill'),
  params: Type.Object({ success: Type.Boolean() }),
})
const TerminalResponseReleaseSchema = Type.Object({
  request: Type.Literal('release'),
  params: Type.Object({ success: Type.Boolean() }),
})

export const TerminalResponseFromEditorSchema = {
  create: TerminalResponseCreateSchema,
  get_output: TerminalResponseGetOutputSchema,
  wait_exit: TerminalResponseWaitExitSchema,
  kill: TerminalResponseKillSchema,
  release: TerminalResponseReleaseSchema,
}

export const TerminalResponseSchema = Type.Union([
  TerminalResponseCreateSchema,
  TerminalResponseGetOutputSchema,
  TerminalResponseWaitExitSchema,
  TerminalResponseKillSchema,
  TerminalResponseReleaseSchema,
])

export const TerminalParamsSchema = Type.Object({
  requestId: Type.String(),
  error: Type.Optional(Type.Any()),
  response: TerminalResponseSchema,
})

// ---------------------------------------------------------------------------
// CLIENT → SERVER: full payload schemas (method + params per variant)
// ---------------------------------------------------------------------------

const InitPayloadSchema = Type.Object({
  method: Type.Literal('client/init'),
  params: InitParamsSchema,
})
const DisposePayloadSchema = Type.Object({
  method: Type.Literal('client/dispose'),
  params: DisposeParamsSchema,
})
const AskPayloadSchema = Type.Object({
  method: Type.Literal('client/ask'),
  params: AskParamsSchema,
})
const AnswerPayloadSchema = Type.Object({
  method: Type.Literal('client/answer'),
  params: AnswerParamsSchema,
})
const TerminalPayloadSchema = Type.Object({
  method: Type.Literal('client/terminal'),
  params: TerminalParamsSchema,
})

// Session management payloads
const NewSessionPayloadSchema = Type.Object({
  method: Type.Literal('client/new_session'),
  params: NewSessionParamsSchema,
})
const LoadSessionPayloadSchema = Type.Object({
  method: Type.Literal('client/load_session'),
  params: LoadSessionParamsSchema,
})
const RenameSessionPayloadSchema = Type.Object({
  method: Type.Literal('client/rename_session'),
  params: RenameSessionParamsSchema,
})
const DeleteSessionPayloadSchema = Type.Object({
  method: Type.Literal('client/delete_session'),
  params: DeleteSessionParamsSchema,
})
const ArchiveSessionPayloadSchema = Type.Object({
  method: Type.Literal('client/archive_session'),
  params: ArchiveSessionParamsSchema,
})
const ForkSessionPayloadSchema = Type.Object({
  method: Type.Literal('client/fork_session'),
  params: ForkSessionParamsSchema,
})
const ResumeSessionPayloadSchema = Type.Object({
  method: Type.Literal('client/resume_session'),
  params: ResumeSessionParamsSchema,
})
const SwitchSessionModePayloadSchema = Type.Object({
  method: Type.Literal('client/switch_session_mode'),
  params: SwitchSessionModeParamsSchema,
})
const SwitchModelPayloadSchema = Type.Object({
  method: Type.Literal('client/switch_model'),
  params: SwitchModelParamsSchema,
})
const ListSessionsPayloadSchema = Type.Object({
  method: Type.Literal('client/list_sessions'),
  params: ListSessionsParamsSchema,
})

export const ASMPayloadDataSchema = Type.Union([
  InitPayloadSchema,
  DisposePayloadSchema,
  AskPayloadSchema,
  AnswerPayloadSchema,
  TerminalPayloadSchema,
  NewSessionPayloadSchema,
  LoadSessionPayloadSchema,
  RenameSessionPayloadSchema,
  DeleteSessionPayloadSchema,
  ArchiveSessionPayloadSchema,
  ForkSessionPayloadSchema,
  ResumeSessionPayloadSchema,
  SwitchSessionModePayloadSchema,
  SwitchModelPayloadSchema,
  ListSessionsPayloadSchema,
])

export const ASMPayloadSchema = Type.Object({
  jsonrpc: Type.Literal('2.0'),
  data: ASMPayloadDataSchema,
})

// ---------------------------------------------------------------------------
// SERVER → CLIENT: notification schemas (outgoing — for documentation only,
// not validated since we construct these ourselves)
// ---------------------------------------------------------------------------

// Respond notifications (server → client)
export const RespondParamsSchema = Type.Object({
  method: Type.Union([
    Type.Literal('client/init'),
    Type.Literal('client/dispose'),
    Type.Literal('client/ask'),
    Type.Literal('client/answer'),
    Type.Literal('client/terminal'),
    Type.Literal('client/new_session'),
    Type.Literal('client/load_session'),
    Type.Literal('client/rename_session'),
    Type.Literal('client/delete_session'),
    Type.Literal('client/archive_session'),
    Type.Literal('client/fork_session'),
    Type.Literal('client/resume_session'),
    Type.Literal('client/switch_session_mode'),
    Type.Literal('client/switch_model'),
    Type.Literal('client/list_sessions'),
  ]),
  id: Type.Optional(Type.String()),
  error: Type.Optional(Type.Any()),
  result: Type.Optional(Type.Any()),
})

// Log notifications (server → client)
export const LogNotificationParamsSchema = Type.Object({
  method: Type.Literal('agentic/log'),
  data: Type.Object({
    level: LogLevelSchema,
    message: Type.String(),
  }),
})

// Question notifications (server → client)
export const QuestionNotificationParamsSchema = Type.Object({
  method: Type.Literal('agentic/question'),
  data: Type.Object({
    questionId: Type.Optional(Type.String()),
    question: Type.String(),
  }),
})

// Session update notifications (server → client)
export const SessionUpdateNotificationParamsSchema = Type.Object({
  method: Type.Literal('agentic/session_update'),
  data: Type.Object({
    sessionId: Type.String(),
    updateType: Type.String(),
    update: Type.Any(),
  }),
})

// Terminal requests (server → client)
export const TerminalRequestToEditorSchema = {
  create: Type.Object({
    requestId: Type.String(),
    terminalId: Type.String(),
    command: Type.String(),
    cwd: Type.Optional(Type.String()),
    env: Type.Optional(Type.Array(EnvVariableSchema)),
    outputByteLimit: Type.Optional(Type.Number()),
  }),
  get_output: Type.Object({
    requestId: Type.String(),
    terminalId: Type.String(),
  }),
  wait_exit: Type.Object({
    requestId: Type.String(),
    terminalId: Type.String(),
  }),
  kill: Type.Object({
    requestId: Type.String(),
    terminalId: Type.String(),
    signal: Type.String(),
  }),
  release: Type.Object({
    requestId: Type.String(),
    terminalId: Type.String(),
  }),
} as const

// Terminal notifications (server → client)
export const TerminalNotificationParamsSchema = Type.Union([
  Type.Object({
    method: Type.Literal('agentic/terminal'),
    data: TerminalRequestToEditorSchema.create,
  }),
  Type.Object({
    method: Type.Literal('agentic/terminal'),
    data: TerminalRequestToEditorSchema.get_output,
  }),
  Type.Object({
    method: Type.Literal('agentic/terminal'),
    data: TerminalRequestToEditorSchema.wait_exit,
  }),
  Type.Object({
    method: Type.Literal('agentic/terminal'),
    data: TerminalRequestToEditorSchema.kill,
  }),
  Type.Object({
    method: Type.Literal('agentic/terminal'),
    data: TerminalRequestToEditorSchema.release,
  }),
])

// ---------------------------------------------------------------------------
// Static type aliases for exported schemas
// ---------------------------------------------------------------------------

// Client → Server types
export type EditorContext = Static<typeof EditorContextSchema>
export type InitParams = Static<typeof InitParamsSchema>
export type DisposeParams = Static<typeof DisposeParamsSchema>
export type AskParams = Static<typeof AskParamsSchema>
export type AnswerParams = Static<typeof AnswerParamsSchema>
export type TerminalResponse = Static<typeof TerminalResponseSchema>
export type TerminalParams = Static<typeof TerminalParamsSchema>
export type NewSessionParams = Static<typeof NewSessionParamsSchema>
export type LoadSessionParams = Static<typeof LoadSessionParamsSchema>
export type RenameSessionParams = Static<typeof RenameSessionParamsSchema>
export type DeleteSessionParams = Static<typeof DeleteSessionParamsSchema>
export type ArchiveSessionParams = Static<typeof ArchiveSessionParamsSchema>
export type ForkSessionParams = Static<typeof ForkSessionParamsSchema>
export type ResumeSessionParams = Static<typeof ResumeSessionParamsSchema>
export type SwitchSessionModeParams = Static<
  typeof SwitchSessionModeParamsSchema
>
export type SwitchModelParams = Static<typeof SwitchModelParamsSchema>
export type ListSessionsParams = Static<typeof ListSessionsParamsSchema>
export type ASMPayload = Static<typeof ASMPayloadSchema>

export type TerminalResponseFromEditor = {
  [K in keyof typeof TerminalResponseFromEditorSchema]: Static<
    (typeof TerminalResponseFromEditorSchema)[K]
  >
}

// Utility: extract per-method params type from the union
export type ASMPayloadParams = {
  'client/init': InitParams
  'client/dispose': DisposeParams
  'client/ask': AskParams
  'client/answer': AnswerParams
  'client/terminal': TerminalParams
  'client/new_session': NewSessionParams
  'client/load_session': LoadSessionParams
  'client/rename_session': RenameSessionParams
  'client/delete_session': DeleteSessionParams
  'client/archive_session': ArchiveSessionParams
  'client/fork_session': ForkSessionParams
  'client/resume_session': ResumeSessionParams
  'client/switch_session_mode': SwitchSessionModeParams
  'client/switch_model': SwitchModelParams
  'client/list_sessions': ListSessionsParams
}

// Server → Client types
export type RespondParams = Static<typeof RespondParamsSchema>
export type LogNotificationParams = Static<typeof LogNotificationParamsSchema>
export type QuestionNotificationParams = Static<
  typeof QuestionNotificationParamsSchema
>
export type TerminalRequestToEditor = {
  [K in keyof typeof TerminalRequestToEditorSchema]: Static<
    (typeof TerminalRequestToEditorSchema)[K]
  >
}
export type TerminalNotificationParams = Static<
  typeof TerminalNotificationParamsSchema
>
export type SessionUpdateNotificationParams = Static<
  typeof SessionUpdateNotificationParamsSchema
>
