import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import { WebsocketCommsInterface } from '../../src/comms/WebsocketCommsInterface'
import type { RespondParams, NotifyParams } from 'src/comms/ICommsInterface'

describe('WebsocketCommsInterface', () => {
  let ws: WebsocketCommsInterface
  let fakeWSSend: any
  let fakeServerStop: any
  let fakeServer: any
  let fakeWS: any

  beforeEach(async () => {
    fakeWSSend = mock(() => {})
    fakeServerStop = mock(() => {})
    fakeWS = { send: fakeWSSend, close: mock(() => {}) }

    fakeServer = { stop: fakeServerStop, config: null as any, ws: fakeWS }
    ;(Bun as any).serve = mock((config: any) => {
      fakeServer.config = config
      return fakeServer
    })

    ws = new WebsocketCommsInterface()
    await ws.init(3999)
    // Simulate a client opening the websocket so `this._ws` is set.
    fakeServer.config.websocket.open(fakeWS)
  })

  afterEach(() => {
    ws.dispose()
    mock.restore()
  })

  test('init binds the configured port', async () => {
    expect((Bun as any).serve).toHaveBeenCalled()
    expect((Bun as any).serve.mock.calls[0][0].port).toBe(3999)
  })

  test('onMessage callback receives incoming messages', async () => {
    let received = ''
    ws.onMessage(async (msg: string) => {
      received = msg
    })
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      data: { method: 'client/ask', params: { prompt: 'hi' } },
    })
    await fakeServer.config.websocket.message(fakeWS, payload)
    expect(received).toBe(payload)
  })

  test('question resolves when processAnswer matches the pending question', async () => {
    // Capture the question id by spying on notify, which sends the
    // agentic/question notification with the generated questionId.
    let questionId = ''
    const origNotify = (ws as any).notify
    ;(ws as any).notify = (params: any) => {
      if (params.method === 'agentic/question') {
        questionId = params.data.questionId
      }
      return origNotify.call(ws, params)
    }

    const questionPromise = ws.question({ question: 'Pick one' })
    // processAnswer parses a client/answer frame for that questionId
    ;(ws as any).processAnswer(
      JSON.stringify({
        jsonrpc: '2.0',
        data: {
          method: 'client/answer',
          params: { questionId, answer: 'chosen' },
        },
      }),
    )
    const result = await questionPromise
    expect(result).toBe('chosen')
  })

  test('respond sends a JSON-RPC response over the websocket', () => {
    ws.respond({
      method: 'client/ask',
      id: 'req-1',
      result: { success: true },
    } as RespondParams)
    const sent = fakeWSSend.mock.calls[0][0] as string
    expect(sent).toContain('"type":"response"')
    expect(sent).toContain('client/ask')
    expect(sent).toContain('"result":{"success":true}')
  })

  test('notify sends a notification over the websocket', () => {
    ws.notify({
      method: 'agentic/log',
      data: { level: 'info', message: 'hello' },
    } as NotifyParams)
    const sent = fakeWSSend.mock.calls[0][0] as string
    expect(sent).toContain('"type":"notification"')
    expect(sent).toContain('agentic/log')
  })

  test('respond is dropped (not thrown) when the websocket is not connected', () => {
    ws.dispose()
    expect(() =>
      ws.respond({
        method: 'client/ask',
        id: 'x',
        result: {},
      } as RespondParams),
    ).not.toThrow()
    expect(fakeWSSend).not.toHaveBeenCalled()
  })

  test('a new connection replaces the old one', async () => {
    const closeCallback = mock(() => {})
    ws.onClose(closeCallback)
    const received: string[] = []
    ws.onMessage(async (msg: string) => {
      received.push(msg)
    })

    const newerSend = mock(() => {})
    const newerWS = { send: newerSend, close: mock(() => {}) }
    fakeServer.config.websocket.open(newerWS)

    expect(fakeWS.close).toHaveBeenCalled()

    // The replaced connection closing does not shut the server down, and
    // its late messages are ignored.
    fakeServer.config.websocket.close(fakeWS)
    expect(closeCallback).not.toHaveBeenCalled()
    await fakeServer.config.websocket.message(fakeWS, '{"stale":true}')
    expect(received).toEqual([])

    ws.notify({
      method: 'agentic/log',
      data: { level: 'info', message: 'to newer' },
    } as NotifyParams)
    expect(newerSend).toHaveBeenCalledTimes(1)
    expect(fakeWSSend).not.toHaveBeenCalled()

    fakeServer.config.websocket.close(newerWS)
    expect(closeCallback).toHaveBeenCalledTimes(1)
  })

  test('dispose stops the server', () => {
    ws.dispose()
    expect(fakeServerStop).toHaveBeenCalled()
  })
})
