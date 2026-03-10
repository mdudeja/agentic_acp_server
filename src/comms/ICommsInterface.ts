import type {
  LogNotificationParams,
  QuestionNotificationParams,
  TerminalNotificationParams,
  RespondParams,
  ASMPayloadParams,
  SessionUpdateNotificationParams,
} from 'src/openrpc/schemas'

// ---------------------------------------------------------------------------
// Incoming RPC types
// ---------------------------------------------------------------------------
export type {
  ASMPayload,
  ASMPayloadParams,
  EditorContext,
  TerminalRequestToEditor,
  TerminalResponseFromEditor,
} from 'src/openrpc/schemas'

// ---------------------------------------------------------------------------
// Outgoing RPC types
// ---------------------------------------------------------------------------

export type {
  RespondParams,
  LogNotificationParams,
  QuestionNotificationParams,
  TerminalNotificationParams,
} from 'src/openrpc/schemas'

// ---------------------------------------------------------------------------
// SERVER → CLIENT notification types
// ---------------------------------------------------------------------------

export type NotifyMethods =
  | 'agentic/log'
  | 'agentic/terminal'
  | 'agentic/question'

export type NotifyParams =
  | LogNotificationParams
  | TerminalNotificationParams
  | QuestionNotificationParams
  | SessionUpdateNotificationParams

// ---------------------------------------------------------------------------
// ASMMethod union — kept for switch/case exhaustiveness checks in main.ts
// ---------------------------------------------------------------------------
export type ASMMethod = keyof ASMPayloadParams

export type ServerResponse = {
  jsonrpc: '2.0'
  type: 'response'
} & RespondParams

export type ServerNotification = {
  jsonrpc: '2.0'
  type: 'notification'
} & NotifyParams

export interface PendingQuestion {
  resolve: (answer: string) => void
  reject: (error: Error) => void
  timeout?: ReturnType<typeof setTimeout>
}

// ---------------------------------------------------------------------------
// ICommsInterface contract
// ---------------------------------------------------------------------------
export interface ICommsInterface {
  init(port?: number): Promise<void>
  onMessage(callback: (message: string) => Promise<void>): void
  onClose(callback: () => void): void
  respond(params: RespondParams): void
  notify(params: NotifyParams): void
  question(params: QuestionNotificationParams['data']): Promise<string>
  hasPendingQuestions(): boolean
  processAnswer(message: string): void
  dispose(): void
}
