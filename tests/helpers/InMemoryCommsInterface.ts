import type {
  ICommsInterface,
  NotifyParams,
  QuestionNotificationParams,
  RespondParams,
  ServerNotification,
  ServerResponse,
  ASMPayload,
  PendingQuestion,
  ASMPayloadParams,
} from 'src/comms/ICommsInterface'
import { logWarning } from 'src/utils/logger'

/**
 * In-process comms interface for rpc-mode tests.
 * Inject into AgenticServer via `config.commsInterface`, then pass to
 * `commandResponseRoundTrip` so the test can drive the server without
 * spawning a child process or touching stdin/stdout.
 */
export class InMemoryCommsInterface implements ICommsInterface {
  private _messageCallback: ((message: string) => Promise<void>) | null = null
  private _closeCallback: (() => void) | null = null
  private _outListeners: Array<
    (msg: ServerResponse | ServerNotification) => void
  > = []
  private _pendingQuestions: Map<string, PendingQuestion> = new Map()

  init(): Promise<void> {
    return Promise.resolve()
  }

  hasPendingQuestions(): boolean {
    return this._pendingQuestions.size > 0
  }

  onMessage(callback: (message: string) => Promise<void>): void {
    this._messageCallback = async (message: string) => {
      if (this.hasPendingQuestions() && message.includes('client/answer')) {
        this.processAnswer(message)
        return
      }

      await callback(message)
    }
  }

  onClose(callback: () => void): void {
    this._closeCallback = callback
  }

  /** Push a payload into the server's message handler (simulates client → server). */
  async send(payload: ASMPayload): Promise<void> {
    if (!this._messageCallback) {
      throw new Error(
        'InMemoryCommsInterface: no message callback registered — was server.init() called?',
      )
    }
    await this._messageCallback(JSON.stringify(payload))
  }

  /** Subscribe to outgoing messages (server → client). Returns an unsubscribe fn. */
  onOutgoing(
    listener: (msg: ServerResponse | ServerNotification) => void,
  ): () => void {
    this._outListeners.push(listener)
    return () => {
      this._outListeners = this._outListeners.filter((l) => l !== listener)
    }
  }

  respond(params: RespondParams): void {
    const msg: ServerResponse = {
      jsonrpc: '2.0',
      type: 'response',
      ...params,
      error: params.error
        ? {
            code: -32000,
            message: params.error.message || String(params.error),
          }
        : undefined,
    }
    this._outListeners.forEach((l) => l(msg))
  }

  notify(params: NotifyParams): void {
    const msg: ServerNotification = {
      jsonrpc: '2.0',
      type: 'notification',
      ...params,
    }
    this._outListeners.forEach((l) => l(msg))
  }

  async question(params: QuestionNotificationParams['data']): Promise<string> {
    return new Promise((resolve) => {
      const questionId = params.questionId ?? `question_${Date.now()}`
      this._pendingQuestions.set(questionId, { resolve, reject: () => {} })

      this.notify({
        method: 'agentic/question',
        data: {
          questionId,
          question: params.question,
          options: params.options,
        },
      })
    })
  }

  processAnswer(message: string): void {
    try {
      const parsed = JSON.parse(message) as ASMPayload
      const { method, params } = parsed.data

      if (method !== 'client/answer') {
        return
      }

      const receivedData = params as ASMPayloadParams['client/answer']

      const pendingQuestion = this._pendingQuestions.get(
        receivedData.questionId,
      )

      if (!pendingQuestion) {
        logWarning(
          `Received answer for questionId ${receivedData.questionId} but no pending question found`,
        )
        return
      }

      if (pendingQuestion.timeout) {
        clearTimeout(pendingQuestion.timeout)
      }

      this._pendingQuestions.delete(receivedData.questionId)

      pendingQuestion.resolve(receivedData.answer)

      this.respond({
        method: 'client/answer',
        id: params.requestId,
        result: {
          success: true,
          message: 'Answer received and processed',
          questionId: receivedData.questionId,
        },
      })
    } catch (err) {
      console.error('Failed to process answer:', message)
    }
  }

  dispose(): void {
    this._closeCallback?.()
  }
}
