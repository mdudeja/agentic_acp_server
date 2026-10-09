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

describe('Commands.SummarizeSession', () => {
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

  test('captures the agent stream and writes a summary file with metadata header', async () => {
    const resp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/summarize_session',
          params: { requestId: 'summarize', sessionId: activeSessionId },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const last = resp.find(
      (m) => m.type === 'response' && m.method === 'client/summarize_session',
    ) as ServerResponse

    expect(last.result?.success).toBe(true)
    expect(typeof last.result?.summary).toBe('string')
    // Echo streams "Echo summary chunk" + " (end)".
    expect(last.result?.summary).toContain('Echo summary chunk')
    expect(last.result?.filePath).toBeDefined()

    const file = Bun.file(last.result?.filePath as string)
    expect(await file.exists()).toBe(true)
    const contents = await file.text()
    expect(contents).toContain('---')
    expect(contents).toContain(`sessionId: ${activeSessionId}`)
    expect(contents).toContain('provider: echo')
    expect(contents).toContain('Echo summary chunk')
  })

  test('rejects summarizing a non-active session', async () => {
    const { sessionManager } = server.getManagers()
    let capturedError: string | undefined
    sessionManager!.on('session.error', (msg?: string) => {
      capturedError = msg
    })

    // Create a second session so the first is no longer active.
    const resp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/new_session',
          params: { requestId: 'another-session' },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )
    const second = resp.find(
      (m) => m.type === 'response' && m.method === 'client/new_session',
    ) as ServerResponse
    expect(second.result?.sessionId).not.toBe(activeSessionId)

    // Directly invoke the manager: the failure surfaces as a return value plus
    // a `session.error` emit (which the round-trip helper treats as fatal).
    const result = await sessionManager!.writeSessionSummary(activeSessionId)

    expect(result.result.success).toBe(false)
    expect(capturedError).toContain('active session')
  })
})
