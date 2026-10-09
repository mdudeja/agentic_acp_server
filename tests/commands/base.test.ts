import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test'
import { AgenticServer } from '../../src/AgenticServer'
import { WebsocketCommsInterface } from 'src/comms/WebsocketCommsInterface'
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

describe('Commands.Base', () => {
  let server: AgenticServer

  beforeEach(async () => {
    let comms = new InMemoryCommsInterface()
    server = new AgenticServer({
      mode: process.env.ACP_APP_MODE || 'server',
      port: parseInt(process.env.ACP_HTTP_PORT ?? '3778', 10),
      exitOnDispose: false,
      commsInterface: process.env.ACP_APP_MODE === 'rpc' ? comms : undefined,
      disposeOnCommsInterfaceClose: false,
    })
    await server.init(cwd)
  })

  afterEach(async () => {
    await server.dispose()
  })

  test('sets up comms interface on init', async () => {
    expect(server.getCommsInterface()).toBeDefined()
    expect(server.getCommsInterface()).toBeInstanceOf(
      process.env.ACP_APP_MODE === 'rpc'
        ? InMemoryCommsInterface
        : WebsocketCommsInterface,
    )
  })

  test('init fails with invalid provider', async () => {
    const payload = {
      ...init_payload,
      data: {
        ...init_payload.data,
        params: {
          ...init_payload.data.params,
          provider: 'invalid-provider',
        },
      },
    } as unknown as ASMPayload

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

  test('init fails with missing cwd', async () => {
    const payload = {
      ...init_payload,
      data: {
        ...init_payload.data,
        params: {
          ...init_payload.data.params,
          cwd: undefined,
        },
      },
    }

    try {
      await commandResponseRoundTrip(
        payload as ASMPayload,
        server.getCommsInterface() as InMemoryCommsInterface,
      )
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as any).message).toMatch(/Received error notification/)
    }
  })

  test('inits on client/init', async () => {
    const messages = await commandResponseRoundTrip(
      init_payload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )
    const lastMessage = messages[messages.length - 1] as
      | ServerResponse
      | undefined

    expect(lastMessage).toBeDefined()
    expect(lastMessage!.type).toBe('response')
    expect(lastMessage!.id).toBe(init_payload.data.params.requestId)
    expect(lastMessage!.result).toMatchObject({ success: true })
    expect(lastMessage!.result).toContainKey('agentId')
  })

  test('state post client/init', async () => {
    await commandResponseRoundTrip(
      init_payload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    // small delay to ensure all async state updates have completed before we check
    await new Promise((resolve) => setTimeout(resolve, 200))

    const state = server.getState()

    expect(state).toBeDefined()
    expect(state.agent).toBeDefined()
    expect(state.session).not.toBeDefined()
    expect(state.connection).toBeDefined()

    const managers = server.getManagers()
    expect(managers).toBeDefined()
    expect(managers.stateManager).toBeDefined()
    expect(managers.agentManager).toBeDefined()
    expect(managers.sessionManager).toBeDefined()
  })

  test('client/ask without an active session returns an error', async () => {
    const payload = {
      jsonrpc: '2.0',
      data: {
        method: 'client/ask',
        params: {
          requestId: 'test-ask-req-id',
          prompt: 'What is the meaning of life?',
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

  test('client/ask without a prompt returns an error', async () => {
    const payload = {
      jsonrpc: '2.0',
      data: {
        method: 'client/ask',
        params: {
          requestId: 'test-ask-req-id',
          // prompt is missing
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

  test('client/ask with valid prompt and an active session returns a succcess response', async () => {
    // First, initialize the server to create an active session
    await commandResponseRoundTrip(
      init_payload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    await new Promise((resolve) => setTimeout(resolve, 100))

    //create a new session
    const newSessionPayload = {
      jsonrpc: '2.0',
      data: {
        method: 'client/new_session',
        params: {
          requestId: 'test-session-new-req-id',
        },
      },
    } as ASMPayload

    await commandResponseRoundTrip(
      newSessionPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    // Then, send a client/ask command with a valid prompt
    const askPayload = {
      jsonrpc: '2.0',
      data: {
        method: 'client/ask',
        params: {
          requestId: 'test-ask-req-id',
          prompt: 'What is the meaning of life?',
        },
      },
    } as ASMPayload

    const messages = await commandResponseRoundTrip(
      askPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )
    const lastMessage = messages[messages.length - 1] as
      | ServerResponse
      | undefined

    expect(lastMessage).toBeDefined()
    expect(lastMessage!.type).toBe('response')
    expect(lastMessage!.id).toBe(askPayload.data.params.requestId)
    expect(lastMessage!.result).toMatchObject({ success: true })
  })

  test('disposes properly', async () => {
    const disposeSpy = spyOn(server, 'dispose')
    await server.dispose()
    expect(disposeSpy).toHaveBeenCalled()
  })
})
