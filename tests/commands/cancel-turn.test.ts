import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { AgenticServer } from '../../src/AgenticServer'
import type { ASMPayload } from 'src/openrpc/schemas'
import { join } from 'path'
import { commandResponseRoundTrip } from 'tests/helpers/commandResponseRoundTrip'
import type { ServerResponse } from 'src/comms/ICommsInterface'
import { InMemoryCommsInterface } from 'tests/helpers/InMemoryCommsInterface'

const cwd = join(import.meta.dir, '..', '..')

const init_payload = {
  jsonrpc: '2.0',
  data: {
    method: 'client/init',
    params: {
      requestId: 'test-init-req-id',
      provider: 'echo',
      cwd,
    },
  },
} as ASMPayload

describe('Commands.CancelTurn', () => {
  let server: AgenticServer
  let activeSessionId: string

  beforeEach(async () => {
    const comms = new InMemoryCommsInterface()
    server = new AgenticServer({
      mode: process.env.ACP_APP_MODE || 'server',
      port: parseInt(process.env.ACP_HTTP_PORT ?? '3778', 10),
      exitOnDispose: false,
      commsInterface: process.env.ACP_APP_MODE === 'rpc' ? comms : undefined,
      disposeOnCommsInterfaceClose: false,
    })
    await server.init(cwd)

    await commandResponseRoundTrip(
      init_payload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )
    await new Promise((resolve) => setTimeout(resolve, 100))

    const newSessionResp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/new_session',
          params: { requestId: 'setup-new-session' },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )
    const created = newSessionResp.find(
      (m) => m.type === 'response' && m.method === 'client/new_session',
    ) as ServerResponse
    activeSessionId = created.result?.sessionId as string
  })

  afterEach(async () => {
    await server.dispose()
  })

  test('cancels the active session turn and answers success', async () => {
    const resp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/cancel_turn',
          params: { requestId: 'cancel', sessionId: activeSessionId },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const last = resp.find(
      (m) => m.type === 'response' && m.method === 'client/cancel_turn',
    ) as ServerResponse
    expect(last.result?.success).toBe(true)
  })

  test('reports an unknown session to the editor', async () => {
    // The round trip rejects on the error notification the server sends.
    await expect(
      commandResponseRoundTrip(
        {
          jsonrpc: '2.0',
          data: {
            method: 'client/cancel_turn',
            params: { requestId: 'cancel-unknown', sessionId: 'nope' },
          },
        } as ASMPayload,
        server.getCommsInterface() as InMemoryCommsInterface,
      ),
    ).rejects.toThrow('Session with ID nope not found')
  })
})
