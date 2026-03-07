import * as readline from 'readline/promises'
import type {
  ICommsInterface,
  NotifyParams,
  QuestionNotificationParams,
  RespondParams,
} from './ICommsInterface'

export class ReadlineCommsInterface implements ICommsInterface {
  private _writer: readline.Interface | null = null
  private _messageCallback: ((message: string) => Promise<void>) | null = null
  private _closeCallback: (() => void) | null = null

  init(): Promise<void> {
    this._writer = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
      prompt: '>> ',
    })

    return Promise.resolve()
  }

  onMessage(callback: (message: string) => Promise<void>): void {
    this._messageCallback = callback

    this._writer?.removeAllListeners('line')

    this._writer?.on('line', async (line) => {
      if (!line.trim()) return
      if (this._messageCallback) {
        await this._messageCallback(line)
      }
    })
  }

  onClose(callback: () => void): void {
    this._closeCallback = callback

    this._writer?.removeAllListeners('close')

    this._writer?.on('close', () => {
      if (this._closeCallback) {
        this._closeCallback()
      }
    })
  }

  respond(params: RespondParams): void {
    if (!this._writer) {
      throw new Error('Readline interface not initialized')
    }

    this._writer.write(
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
    if (!this._writer) {
      throw new Error('Readline interface not initialized')
    }

    this._writer.write(
      JSON.stringify({
        jsonrpc: '2.0',
        type: 'notification',
        ...params,
      }) + '\n',
    )
  }

  async question(params: QuestionNotificationParams['data']): Promise<string> {
    if (!this._writer) {
      throw new Error('Readline interface not initialized')
    }

    return await this._writer.question(params.question)
  }

  dispose(): void {
    if (this._messageCallback) {
      this._messageCallback = null
    }

    if (this._writer) {
      this._writer.removeAllListeners('line')
      this._writer.close()
      this._writer = null
    }
  }
}
