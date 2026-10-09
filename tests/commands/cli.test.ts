import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test'
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

describe('Commands.Cli', () => {
  let server: AgenticServer
  let activeSessionId: string

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

    await commandResponseRoundTrip(
      init_payload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Create a session to work with in each test
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

    const sessionResponse = newSessionResp.find(
      (m) => m.type === 'response' && m.method === 'client/new_session',
    ) as ServerResponse | undefined

    activeSessionId = sessionResponse?.result?.sessionId as string
  })

  afterEach(async () => {
    await server.dispose()
  })

  test('client/export_session with an invalid sessionId returns an error', async () => {
    const resp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/export_session',
          params: {
            requestId: 'export-invalid-session',
            sessionId: 'nonexistent-session-id',
          },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const last = resp[resp.length - 1] as ServerResponse
    expect(last.error).toBeDefined()
  })

  test('client/export_session calls provider cli exportSession and returns result', async () => {
    const { sessionManager } = server.getManagers()
    const exportSessionSpy = spyOn(
      (sessionManager as any).providerCLI,
      'exportSession',
    )

    const resp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/export_session',
          params: {
            requestId: 'export-valid-session',
            sessionId: activeSessionId,
            source: 'cli',
          },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const last = resp[resp.length - 1] as ServerResponse
    expect(exportSessionSpy).toHaveBeenCalledTimes(1)
    expect(last.result).toBeDefined()
    expect(last.result?.success).toBe(true)
    expect(last.result?.filePath).toBeDefined()
  })

  test('client/import_session without filePath returns an error', async () => {
    try {
      await commandResponseRoundTrip(
        {
          jsonrpc: '2.0',
          data: {
            method: 'client/import_session',
            params: {
              requestId: 'import-no-filepath',
            },
          },
        } as ASMPayload,
        server.getCommsInterface() as InMemoryCommsInterface,
      )
    } catch (error) {
      expect(error).toBeDefined()
      expect((error as Error).message).toMatch(/Received error notification/)
    }
  })

  test('client/import_session calls provider cli importSession and returns result', async () => {
    const { sessionManager } = server.getManagers()
    const importSessionSpy = spyOn(
      (sessionManager as any).providerCLI,
      'importSession',
    )

    const resp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/import_session',
          params: {
            requestId: 'import-valid-session',
            filePath: '/path/to/exported/session.json',
            source: 'cli',
          },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const last = resp[resp.length - 1] as ServerResponse

    expect(importSessionSpy).toHaveBeenCalledTimes(1)
    expect(resp).toBeDefined()
    expect(last.result).toBeDefined()
    expect(last.result?.success).toBe(true)
  })

  test('client/stats returns server stats', async () => {
    const { sessionManager } = server.getManagers()
    const statsSpy = spyOn((sessionManager as any).providerCLI, 'stats')
    const resp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/stats',
          params: { requestId: 'stats-request' },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const last = resp[resp.length - 1] as ServerResponse

    expect(last.result).toBeDefined()
    expect(last.result?.success).toBe(true)
    expect(last.result?.data.totalSessions).toBe(0)
    expect(last.result?.data.activeSessions).toBe(0)
    expect(last.result?.data.completedSessions).toBe(0)
    expect(statsSpy).toHaveBeenCalledTimes(1)
  })

  test('client/delete_session calls provider cli deleteSession and returns result', async () => {
    const { sessionManager } = server.getManagers()
    const deleteSessionSpy = spyOn(
      (sessionManager as any).providerCLI,
      'deleteSession',
    )

    const resp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/delete_session',
          params: {
            requestId: 'delete-session',
            sessionId: activeSessionId,
            source: 'cli',
          },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const last = resp[resp.length - 1] as ServerResponse

    expect(deleteSessionSpy).toHaveBeenCalledTimes(1)
    expect(last.result).toBeDefined()
    expect(last.result?.success).toBe(true)
  })
})
