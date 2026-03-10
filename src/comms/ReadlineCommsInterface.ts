import * as readline from 'readline/promises'
import type {
  ICommsInterface,
  NotifyParams,
  PendingQuestion,
  QuestionNotificationParams,
  RespondParams,
} from './ICommsInterface'
import { logDebug } from 'src/utils/logger'

export class ReadlineCommsInterface implements ICommsInterface {
  private _reader: readline.Interface | null = null
  private _messageCallback: ((message: string) => Promise<void>) | null = null
  private _closeCallback: (() => void) | null = null
  private _pendingQuestions: Map<string, PendingQuestion> = new Map()

  init(): Promise<void> {
    this._reader = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
      prompt: '>> ',
    })

    return Promise.resolve()
  }

  hasPendingQuestions(): boolean {
    return this._pendingQuestions.size > 0
  }

  onMessage(callback: (message: string) => Promise<void>): void {
    this._messageCallback = callback

    this._reader?.removeAllListeners('line')

    this._reader?.on('line', async (line) => {
      if (!line.trim()) return
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

  async question(params: QuestionNotificationParams['data']): Promise<string> {
    if (!this._reader) {
      throw new Error('Readline interface not initialized')
    }

    const questionId = `question_${Date.now()}`
    this._pendingQuestions.set(questionId, {
      resolve: (answer: string) => {
        this._pendingQuestions.delete(questionId)
        this.respond({
          method: 'client/answer',
          result: {
            success: true,
            message: 'Answer received and processed',
            questionId: questionId,
          },
        })
        this.processAnswer(answer)
        return answer
      },
      reject: (error: Error) => {
        this._pendingQuestions.delete(questionId)
        throw error
      },
    })

    const answer = await this._reader.question(params.question)
    const pendingQuestion = this._pendingQuestions.get(questionId)

    if (!pendingQuestion) {
      logDebug(
        `No pending question found for questionId ${questionId}, answer: ${answer}`,
      )
      return answer
    }

    pendingQuestion.resolve(answer)
    return answer
  }

  processAnswer(_: string): void {
    // no-op for readline interface since questions are handled by the interface itself.
    // here just to aid in testing
  }

  dispose(): void {
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
