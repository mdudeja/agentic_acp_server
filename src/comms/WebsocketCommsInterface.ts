import { logDebug, logInfo, logWarning } from 'src/utils/logger'
import type {
  ICommsInterface,
  NotifyParams,
  QuestionNotificationParams,
  RespondParams,
} from './ICommsInterface'
import { renderOpenRpcDocs } from 'src/utils/renderopenrpcdocs'
import { resolvePath } from 'src/utils/paths'
import { PendingQuestions, parseAnswerPayload } from './PendingQuestions'

const OPENRPC_SPEC_PATH = resolvePath(
  process.env.ACP_OPENRPC_SCHEMA_PATH || 'src/openrpc/openrpc.json',
)

export class WebsocketCommsInterface implements ICommsInterface {
  private server: Bun.Server<any> | null = null
  private _port: number = 3777
  private _ws: Bun.ServerWebSocket | null = null
  private _messageCallback: ((message: string) => Promise<void>) | null = null
  private _closeCallback: (() => void) | null = null
  private _questions = new PendingQuestions()

  init(port?: number): Promise<void> {
    this._port = port || this._port

    this.server = Bun.serve({
      port: this._port,
      fetch: async (req, server) => {
        if (req.method !== 'GET') {
          return new Response('Method Not Allowed', { status: 405 })
        }

        const { pathname } = new URL(req.url)

        if (pathname === '/ws') {
          if (server.upgrade(req)) {
            return
          }
          return new Response('Upgrade Failed', { status: 500 })
        }

        if (pathname === '/openrpc.json') {
          return new Response(Bun.file(OPENRPC_SPEC_PATH), {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          })
        }

        if (pathname === '/docs') {
          const spec = await Bun.file(OPENRPC_SPEC_PATH).json()
          return new Response(renderOpenRpcDocs(spec), {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        }

        return new Response('Not Found', { status: 404 })
      },
      websocket: {
        // One editor connection at a time: a new connection (e.g. the editor
        // reconnecting) replaces the previous one, and only the current
        // connection's messages and close are acted on.
        open: (ws) => {
          logDebug('WebSocket connection opened')
          const previous = this._ws
          this._ws = ws

          if (previous && previous !== ws) {
            logWarning(
              'A new WebSocket connection replaced the existing one; closing the old connection',
            )
            previous.close(4000, 'Replaced by a newer connection')
          }
        },
        message: async (ws, message) => {
          if (ws !== this._ws) {
            return
          }

          let msgStr: string

          if (message instanceof ArrayBuffer) {
            msgStr = new TextDecoder().decode(message)
          } else {
            msgStr = message.toString()
          }

          if (!msgStr.trim()) return

          if (this._messageCallback) {
            await this._messageCallback(msgStr || '')
          }
        },
        close: (ws) => {
          // A replaced connection closing must not shut the server down.
          if (ws !== this._ws) {
            return
          }

          this._ws = null
          if (this._closeCallback) {
            this._closeCallback()
          }
        },
      },
    })

    logInfo(
      `WebsocketCommsInterface running on ws://localhost:${this._port}/ws\n` +
        `  OpenRPC spec : http://localhost:${this._port}/openrpc.json\n` +
        `  Docs         : http://localhost:${this._port}/docs`,
    )

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

  processAnswer(message: string): void {
    this._questions.processAnswer(message, (params) => this.respond(params))
  }

  respond(params: RespondParams): void {
    // Like `notify`: a response for an editor that has disconnected is
    // dropped rather than thrown into the handler that produced it.
    if (!this._ws) {
      logWarning(
        `WebSocket not connected, dropping response for ${params.method}`,
      )
      return
    }

    this._ws.send(
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
    if (!this._ws) {
      logWarning('WebSocket not connected, dropping notification')
      return
    }

    this._ws.send(
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
    if (!this._ws) {
      throw new Error('WebSocket not initialized')
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

  dispose(): void {
    this._messageCallback = null
    this._closeCallback = null
    this._questions.rejectAll(new Error('Comms interface disposed'))

    if (this._ws) {
      this._ws.close()
      this._ws = null
    }

    if (this.server) {
      this.server.stop()
      this.server = null
    }
  }
}
