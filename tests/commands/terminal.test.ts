import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test'
import { AgenticServer } from '../../src/AgenticServer'
import type { ASMPayload } from 'src/openrpc/schemas'
import { join } from 'path'
import { commandResponseRoundTrip } from 'tests/helpers/commandResponseRoundTrip'
import type { ServerResponse } from 'src/comms/ICommsInterface'
import { InMemoryCommsInterface } from 'tests/helpers/InMemoryCommsInterface'

describe('Commands.ClientTerminal', () => {
  let server: AgenticServer

  beforeEach(async () => {
    const init_payload = {
      jsonrpc: '2.0',
      data: {
        method: 'client/init',
        params: {
          requestId: 'test-init-req-id',
          provider: 'echo',
          cwd: join(import.meta.dir, '..', '..'),
        },
      },
    } as ASMPayload

    let comms = new InMemoryCommsInterface()
    server = new AgenticServer({
      mode: process.env.ACP_APP_MODE || 'server',
      port: parseInt(process.env.ACP_HTTP_PORT ?? '3778', 10),
      exitOnDispose: false,
      commsInterface: process.env.ACP_APP_MODE === 'rpc' ? comms : undefined,
      disposeOnCommsInterfaceClose: false,
    })
    await server.init(join(import.meta.dir, '..', '..'))

    // small delay to ensure server is fully initialized before sending init command
    await new Promise((resolve) => setTimeout(resolve, 100))

    await commandResponseRoundTrip(
      init_payload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )
  })

  afterEach(() => {
    server.dispose()
  })

  test('returns an error when there is no pending terminal operation for client/terminal', async () => {
    const payload = {
      jsonrpc: '2.0',
      data: {
        method: 'client/terminal',
        params: {
          requestId: 'non-existent-terminal-req-id',
          response: {
            request: 'create',
            params: {
              terminalId: 'term_fake',
            },
          },
        },
      },
    } as ASMPayload

    const resp = await commandResponseRoundTrip(
      payload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )
    const lastMessage = resp[resp.length - 1] as ServerResponse

    expect(lastMessage).toBeDefined()
    expect(lastMessage.type).toBe('response')
    expect(lastMessage.method).toBe('client/terminal')
    expect(lastMessage.error).toBeDefined()
    expect(lastMessage.error?.code).toBe(-32000)
    expect(lastMessage.error?.message).toContain(
      'No pending terminal operation found for requestId non-existent-terminal-req-id',
    )
  })

  test('returns an error when client/terminal is malformed', async () => {
    const payload = {
      jsonrpc: '2.0',
      data: {
        method: 'client/terminal',
        params: {
          // Missing requestId and response
        },
      },
    } as ASMPayload

    try {
      await commandResponseRoundTrip(
        payload,
        server.getCommsInterface() as InMemoryCommsInterface,
      )
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as any).message).toMatch(/Received error notification/)
    }
  })

  test('correct client/terminal resolves pending terminal operation', async () => {
    const { agentManager } = server.getManagers()
    expect(agentManager).toBeDefined()

    const terminalHandler = (agentManager as any).terminalHandler
    const spyHandleResponse = spyOn(terminalHandler, 'handleResponse')

    // Manually register a pending terminal operation so client/terminal can resolve it
    const pendingRequestId = 'terminal_req_test_123'

    const pendingPromise = new Promise<any>((resolve) => {
      terminalHandler.pendingOperations.set(pendingRequestId, {
        resolve: (value: any) => {
          resolve(value)
        },
        reject: (_err: Error) => {
          resolve(null)
        },
      })
    })

    const payload = {
      jsonrpc: '2.0',
      data: {
        method: 'client/terminal',
        params: {
          requestId: pendingRequestId,
          response: {
            request: 'create',
            params: {
              terminalId: 'term_abc123',
            },
          },
        },
      },
    } as ASMPayload

    // Wait a tick so the pending operation is registered before sending
    await new Promise((resolve) => setTimeout(resolve, 100))

    const resp = await commandResponseRoundTrip(
      payload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )
    const lastMessage = resp[resp.length - 1] as ServerResponse

    expect(lastMessage).toBeDefined()
    expect(lastMessage.type).toBe('response')
    expect(lastMessage.method).toBe('client/terminal')
    expect(lastMessage.error).toBeUndefined()
    expect(lastMessage.result).toBeDefined()
    expect(lastMessage.result?.success).toBe(true)
    expect(lastMessage.result?.requestId).toBe(pendingRequestId)

    const resolved = await pendingPromise
    expect(resolved).toBeDefined()
    expect(resolved.request).toBe('create')
    expect(resolved.params.terminalId).toBe('term_abc123')

    expect(spyHandleResponse).toHaveBeenCalledTimes(1)
  })

  test('client/terminal with error field rejects pending terminal operation', async () => {
    const { agentManager } = server.getManagers()
    expect(agentManager).toBeDefined()

    const terminalHandler = (agentManager as any).terminalHandler
    const pendingRequestId = 'terminal_req_error_456'
    let rejectedError: Error | null = null

    const pendingPromise = new Promise<void>((resolve) => {
      terminalHandler.pendingOperations.set(pendingRequestId, {
        resolve: (_: any) => resolve(),
        reject: (err: Error) => {
          rejectedError = err
          resolve()
        },
      })
    })

    const payload = {
      jsonrpc: '2.0',
      data: {
        method: 'client/terminal',
        params: {
          requestId: pendingRequestId,
          error: {
            message: 'Terminal creation failed',
          },
          response: {
            request: 'create',
            params: {
              terminalId: 'term_will_not_be_used',
            },
          },
        },
      },
    } as ASMPayload

    await new Promise((resolve) => setTimeout(resolve, 100))

    const resp = await commandResponseRoundTrip(
      payload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )
    const lastMessage = resp[resp.length - 1] as ServerResponse

    expect(lastMessage).toBeDefined()
    expect(lastMessage.type).toBe('response')
    expect(lastMessage.method).toBe('client/terminal')
    expect(lastMessage.error).toBeDefined()
    expect(lastMessage.error?.message).toContain('Terminal creation failed')

    await pendingPromise
    expect(rejectedError).toBeInstanceOf(Error)
    expect((rejectedError as any).message).toBe('Terminal creation failed')
  })
})
