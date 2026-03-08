import * as readline from 'readline/promises'
import type {
  ICommsInterface,
  NotifyParams,
  QuestionNotificationParams,
  RespondParams,
} from './ICommsInterface'

export class ReadlineCommsInterface implements ICommsInterface {
  private _reader: readline.Interface | null = null
  private _messageCallback: ((message: string) => Promise<void>) | null = null
  private _closeCallback: (() => void) | null = null

  init(): Promise<void> {
    this._reader = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
      prompt: '>> ',
    })

    return Promise.resolve()
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

    return await this._reader.question(params.question)
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
