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

import { Type, type TLiteral } from 'typebox'
import type { Static } from 'typebox/type'
import { PROVIDERS } from 'src/data/providers'

// ---------------------------------------------------------------------------
// Shared / primitive schemas
// ---------------------------------------------------------------------------

type ProviderId = keyof typeof PROVIDERS

export const ProviderSchema = Type.Union(
  (Object.keys(PROVIDERS) as ProviderId[]).map((k) => Type.Literal(k)) as [
    TLiteral<ProviderId>,
    ...TLiteral<ProviderId>[],
  ],
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
  export: Type.Optional(Type.Boolean()),
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
  model: Type.Optional(Type.String()),
})

export const ListSessionsParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
})

export const ExportSessionParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  sessionId: Type.String(),
  outputPath: Type.Optional(Type.String()),
})

export const ImportSessionParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  filePath: Type.String(),
})

export const StatsParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  days: Type.Optional(Type.Number()),
})

// NES (Next Edit Suggestions) sub-schemas
const PositionSchema = Type.Object({
  line: Type.Number(),
  character: Type.Number(),
})

const RangeSchema = Type.Object({
  start: PositionSchema,
  end: PositionSchema,
})

export const NesStartParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  workspaceUri: Type.Optional(Type.String()),
  workspaceFolders: Type.Optional(
    Type.Array(
      Type.Object({
        uri: Type.String(),
        name: Type.String(),
      }),
    ),
  ),
  repository: Type.Optional(
    Type.Object({
      name: Type.String(),
      owner: Type.String(),
      remoteUrl: Type.String(),
    }),
  ),
})

export const NesSuggestParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  sessionId: Type.String(),
  uri: Type.String(),
  version: Type.Number(),
  position: PositionSchema,
  selection: Type.Optional(RangeSchema),
  triggerKind: Type.Union([
    Type.Literal('automatic'),
    Type.Literal('diagnostic'),
    Type.Literal('manual'),
  ]),
  context: Type.Optional(Type.Any()),
})

export const NesCloseParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  sessionId: Type.String(),
})

export const NesAcceptParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  sessionId: Type.String(),
  id: Type.String(),
})

export const NesRejectParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  sessionId: Type.String(),
  id: Type.String(),
  reason: Type.Optional(
    Type.Union([
      Type.Literal('rejected'),
      Type.Literal('ignored'),
      Type.Literal('replaced'),
      Type.Literal('cancelled'),
    ]),
  ),
})

export const NesDidOpenParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  sessionId: Type.String(),
  uri: Type.String(),
  languageId: Type.String(),
  version: Type.Number(),
  text: Type.String(),
})

export const NesDidChangeParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  sessionId: Type.String(),
  uri: Type.String(),
  version: Type.Number(),
  contentChanges: Type.Array(
    Type.Object({
      range: Type.Optional(RangeSchema),
      text: Type.String(),
    }),
  ),
})

export const NesDidCloseParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  sessionId: Type.String(),
  uri: Type.String(),
})

export const NesDidSaveParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  sessionId: Type.String(),
  uri: Type.String(),
})

export const NesDidFocusParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
  sessionId: Type.String(),
  uri: Type.String(),
  version: Type.Number(),
  position: PositionSchema,
  visibleRange: RangeSchema,
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

export const IndexParamsSchema = Type.Object({
  requestId: Type.Optional(Type.String()),
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
const ExportSessionPayloadSchema = Type.Object({
  method: Type.Literal('client/export_session'),
  params: ExportSessionParamsSchema,
})
const ImportSessionPayloadSchema = Type.Object({
  method: Type.Literal('client/import_session'),
  params: ImportSessionParamsSchema,
})
const StatsPayloadSchema = Type.Object({
  method: Type.Literal('client/stats'),
  params: StatsParamsSchema,
})
const IndexPayloadSchema = Type.Object({
  method: Type.Literal('client/index'),
  params: IndexParamsSchema,
})

// NES payloads
const NesStartPayloadSchema = Type.Object({
  method: Type.Literal('client/nes_start'),
  params: NesStartParamsSchema,
})
const NesSuggestPayloadSchema = Type.Object({
  method: Type.Literal('client/nes_suggest'),
  params: NesSuggestParamsSchema,
})
const NesClosePayloadSchema = Type.Object({
  method: Type.Literal('client/nes_close'),
  params: NesCloseParamsSchema,
})
const NesAcceptPayloadSchema = Type.Object({
  method: Type.Literal('client/nes_accept'),
  params: NesAcceptParamsSchema,
})
const NesRejectPayloadSchema = Type.Object({
  method: Type.Literal('client/nes_reject'),
  params: NesRejectParamsSchema,
})
const NesDidOpenPayloadSchema = Type.Object({
  method: Type.Literal('client/nes_did_open'),
  params: NesDidOpenParamsSchema,
})
const NesDidChangePayloadSchema = Type.Object({
  method: Type.Literal('client/nes_did_change'),
  params: NesDidChangeParamsSchema,
})
const NesDidClosePayloadSchema = Type.Object({
  method: Type.Literal('client/nes_did_close'),
  params: NesDidCloseParamsSchema,
})
const NesDidSavePayloadSchema = Type.Object({
  method: Type.Literal('client/nes_did_save'),
  params: NesDidSaveParamsSchema,
})
const NesDidFocusPayloadSchema = Type.Object({
  method: Type.Literal('client/nes_did_focus'),
  params: NesDidFocusParamsSchema,
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
  ExportSessionPayloadSchema,
  ImportSessionPayloadSchema,
  StatsPayloadSchema,
  IndexPayloadSchema,
  NesStartPayloadSchema,
  NesSuggestPayloadSchema,
  NesClosePayloadSchema,
  NesAcceptPayloadSchema,
  NesRejectPayloadSchema,
  NesDidOpenPayloadSchema,
  NesDidChangePayloadSchema,
  NesDidClosePayloadSchema,
  NesDidSavePayloadSchema,
  NesDidFocusPayloadSchema,
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
    Type.Literal('client/export_session'),
    Type.Literal('client/import_session'),
    Type.Literal('client/stats'),
    Type.Literal('client/index'),
    Type.Literal('client/nes_start'),
    Type.Literal('client/nes_suggest'),
    Type.Literal('client/nes_close'),
    Type.Literal('client/nes_accept'),
    Type.Literal('client/nes_reject'),
    Type.Literal('client/nes_did_open'),
    Type.Literal('client/nes_did_change'),
    Type.Literal('client/nes_did_close'),
    Type.Literal('client/nes_did_save'),
    Type.Literal('client/nes_did_focus'),
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
export type ExportSessionParams = Static<typeof ExportSessionParamsSchema>
export type ImportSessionParams = Static<typeof ImportSessionParamsSchema>
export type StatsParams = Static<typeof StatsParamsSchema>
export type NesStartParams = Static<typeof NesStartParamsSchema>
export type NesSuggestParams = Static<typeof NesSuggestParamsSchema>
export type NesCloseParams = Static<typeof NesCloseParamsSchema>
export type NesAcceptParams = Static<typeof NesAcceptParamsSchema>
export type NesRejectParams = Static<typeof NesRejectParamsSchema>
export type NesDidOpenParams = Static<typeof NesDidOpenParamsSchema>
export type NesDidChangeParams = Static<typeof NesDidChangeParamsSchema>
export type NesDidCloseParams = Static<typeof NesDidCloseParamsSchema>
export type NesDidSaveParams = Static<typeof NesDidSaveParamsSchema>
export type NesDidFocusParams = Static<typeof NesDidFocusParamsSchema>
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
  'client/export_session': ExportSessionParams
  'client/import_session': ImportSessionParams
  'client/stats': StatsParams
  'client/nes_start': NesStartParams
  'client/nes_suggest': NesSuggestParams
  'client/nes_close': NesCloseParams
  'client/nes_accept': NesAcceptParams
  'client/nes_reject': NesRejectParams
  'client/nes_did_open': NesDidOpenParams
  'client/nes_did_change': NesDidChangeParams
  'client/nes_did_close': NesDidCloseParams
  'client/nes_did_save': NesDidSaveParams
  'client/nes_did_focus': NesDidFocusParams
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
