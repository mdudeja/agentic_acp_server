import * as readline from 'readline/promises'
import type {
  ICommsInterface,
  NotifyParams,
  QuestionNotificationParams,
  RespondParams,
} from './ICommsInterface'
import { PendingQuestions, parseAnswerPayload } from './PendingQuestions'

/** Provides a readline-based communication interface for handling messages or commands. */
export class ReadlineCommsInterface implements ICommsInterface {
  private _reader: readline.Interface | null = null
  private _messageCallback: ((message: string) => Promise<void>) | null = null
  private _closeCallback: (() => void) | null = null
  private _questions = new PendingQuestions()

  /** Initializes the application or system by setting up necessary configurations and dependencies. */
  init(): Promise<void> {
    // Input only: stdout carries the JSON-RPC stream, so readline must never
    // write to it (prompts/echo would corrupt the protocol).
    this._reader = readline.createInterface({
      input: process.stdin,
      terminal: false,
    })

    return Promise.resolve()
  }

  /** Checks if there are any pending questions. */
  hasPendingQuestions(): boolean {
    return this._questions.size > 0
  }

  /** Registers a callback to handle incoming messages. The callback is invoked asynchronously when a message is received. */
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

  /** Sets up a callback to execute when a close event occurs. */
  onClose(callback: () => void): void {
    this._closeCallback = callback

    this._reader?.removeAllListeners('close')

    this._reader?.on('close', () => {
      if (this._closeCallback) {
        this._closeCallback()
      }
    })
  }

  /** Handles and processes a response, taking appropriate action based on the input. */
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

  /** Sends a notification based on the provided parameters. */
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

  /** Asks a question and returns the response as a string. */
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

  /** Processes an answer message to perform validation or further handling. */
  processAnswer(message: string): void {
    this._questions.processAnswer(message, (params) => this.respond(params))
  }

  /** Releases resources and performs cleanup operations when the object is no longer needed. Should be called to prevent memory leaks and ensure proper resource management. */
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
