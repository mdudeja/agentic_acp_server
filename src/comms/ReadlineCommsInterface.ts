import * as readline from 'readline/promises'
import type {
  ICommsInterface,
  NotifyParams,
  QuestionNotificationParams,
  RespondParams,
} from './ICommsInterface'
import { PendingQuestions, parseAnswerPayload } from './PendingQuestions'

export class ReadlineCommsInterface implements ICommsInterface {
  private _reader: readline.Interface | null = null
  private _messageCallback: ((message: string) => Promise<void>) | null = null
  private _closeCallback: (() => void) | null = null
  private _questions = new PendingQuestions()

  init(): Promise<void> {
    // Input only: stdout carries the JSON-RPC stream, so readline must never
    // write to it (prompts/echo would corrupt the protocol).
    this._reader = readline.createInterface({
      input: process.stdin,
      terminal: false,
    })

    return Promise.resolve()
  }

  hasPendingQuestions(): boolean {
    return this._questions.size > 0
  }

  onMessage(callback: (message: string) => Promise<void>): void {
    this._messageCallback = callback

    this._reader?.removeAllListeners('line')

    this._reader?.on('line', async (line) => {
      if (!line.trim()) return

      // Answers to pending questions are resolved here rather than going
      // through the dispatcher: the dispatcher may be blocked awaiting the
      // very turn that asked the question. Unknown answers fall through so
      // the dispatcher responds with an error.
      const answer = parseAnswerPayload(line)
      if (answer && this._questions.has(answer.questionId)) {
        this.processAnswer(line)
        return
      }

      if (this._messageCallback) {
        await this._messageCallback(line)
      }
    })
  }

  onClose(callback: () => void): void {
    this._closeCallback = callback

    this._reader?.removeAllListeners('close')

    this._reader?.on('close', () => {
      if (this._closeCallback) {
        this._closeCallback()
      }
    })
  }

  respond(params: RespondParams): void {
    if (!this._reader) {
      throw new Error('Readline interface not initialized')
    }

    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        type: 'response',
        ...params,
        error: params.error
          ? {
              code: -32000,
              message: params.error.message || String(params.error),
            }
          : undefined,
      }) + '\n',
    )
  }

  notify(params: NotifyParams): void {
    if (!this._reader) {
      throw new Error('Readline interface not initialized')
    }

    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        type: 'notification',
        ...params,
      }) + '\n',
    )
  }

  async question(
    params: QuestionNotificationParams['data'],
    opts?: { signal?: AbortSignal },
  ): Promise<string> {
    if (!this._reader) {
      throw new Error('Readline interface not initialized')
    }

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

    if (this._messageCallback) {
      this._messageCallback = null
    }

    if (this._reader) {
      this._reader.removeAllListeners('line')
      this._reader.close()
      this._reader = null
    }
  }
}
