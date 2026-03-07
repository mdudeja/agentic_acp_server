import { logDebug, logInfo, logWarning } from 'src/utils/logger'
import type {
  ICommsInterface,
  NotifyParams,
  QuestionNotificationParams,
  RespondParams,
  ASMPayload,
  ASMPayloadParams,
} from './ICommsInterface'
import { renderOpenRpcDocs } from 'src/utils/renderopenrpcdocs'
import { resolvePath } from 'src/utils/paths'

const OPENRPC_SPEC_PATH = resolvePath(
  process.env.OPENRPC_SCHEMA_PATH || 'src/openrpc/openrpc.json',
)

interface PendingQuestion {
  resolve: (answer: string) => void
  reject: (error: Error) => void
  timeout?: ReturnType<typeof setTimeout>
}

export class WebsocketCommsInterface implements ICommsInterface {
  private _port: number = 3777
  private _ws: Bun.ServerWebSocket | null = null
  private _messageCallback: ((message: string) => Promise<void>) | null = null
  private _closeCallback: (() => void) | null = null
  private _pendingQuestions: Map<string, PendingQuestion> = new Map()

  init(port?: number): Promise<void> {
    this._port = port || this._port

    Bun.serve({
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
        open: (ws) => {
          logDebug('WebSocket connection opened')
          this._ws = ws
        },
        message: async (_, message) => {
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
        close: () => {
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

  onMessage(callback: (message: string) => Promise<void>): void {
    this._messageCallback = async (message: string) => {
      if (
        this._pendingQuestions.size > 0 &&
        message.includes('client/answer')
      ) {
        this._processAnswer(message)
        return
      }

      await callback(message)
    }
  }

  onClose(callback: () => void): void {
    this._closeCallback = callback
  }

  private _processAnswer(message: string) {
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
    } catch (err) {
      console.error('Failed to process answer:', message)
    }
  }

  respond(params: RespondParams): void {
    if (!this._ws) {
      throw new Error('WebSocket not initialized')
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
      console.warn('WebSocket not initialized, cannot send notification')
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

  question(params: QuestionNotificationParams['data']): Promise<string> {
    if (!this._ws) {
      throw new Error('WebSocket not initialized')
    }

    return new Promise((resolve) => {
      const questionId = `question_${Date.now()}`
      this._pendingQuestions.set(questionId, { resolve, reject: () => {} })

      this.notify({
        method: 'agentic/question',
        data: {
          questionId,
          question: params.question,
        },
      })
    })
  }

  dispose(): void {
    this._messageCallback = null
    this._closeCallback = null
    this._pendingQuestions.clear()

    if (this._ws) {
      this._ws.close()
      this._ws = null
    }
  }
}
