import type {
  ICommsInterface,
  NotifyParams,
  QuestionNotificationParams,
  RespondParams,
  ServerNotification,
  ServerResponse,
  ASMPayload,
} from 'src/comms/ICommsInterface'
import {
  PendingQuestions,
  parseAnswerPayload,
} from 'src/comms/PendingQuestions'

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
  private _questions = new PendingQuestions()

  init(): Promise<void> {
    return Promise.resolve()
  }

  hasPendingQuestions(): boolean {
    return this._questions.size > 0
  }

  onMessage(callback: (message: string) => Promise<void>): void {
    this._messageCallback = async (message: string) => {
      const answer = parseAnswerPayload(message)
      if (answer && this._questions.has(answer.questionId)) {
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

  async question(
    params: QuestionNotificationParams['data'],
    opts?: { signal?: AbortSignal },
  ): Promise<string> {
    const { questionId, answer } = this._questions.register(
      params.questionId,
      opts?.signal,
    )

    if (this._questions.has(questionId)) {
      this.notify({
        method: 'agentic/question',
        data: {
          questionId,
          question: params.question,
          options: params.options,
        },
      })
    }

    return answer
  }

  processAnswer(message: string): void {
    this._questions.processAnswer(message, (params) => this.respond(params))
  }

  dispose(): void {
    this._questions.rejectAll(new Error('Comms interface disposed'))
    this._closeCallback?.()
  }
}
