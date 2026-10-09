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

describe('Commands.ProviderSwitch', () => {
  let server: AgenticServer

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
  })

  afterEach(async () => {
    await server.dispose()
  })

  test('client/list_providers reports the active provider', async () => {
    const resp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/list_providers',
          params: { requestId: 'list-providers' },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const last = resp.find(
      (m) => m.type === 'response' && m.method === 'client/list_providers',
    ) as ServerResponse

    expect(last.result?.success).toBe(true)
    const active = (last.result?.providers as any[]).find((p) => p.active)
    expect(active.provider).toBe('echo')
    expect(active.connected).toBe(true)
  })

  test('client/switch_provider to the same provider stays connected without hanging', async () => {
    const resp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/switch_provider',
          params: { requestId: 'switch-same', provider: 'echo' },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const last = resp.find(
      (m) => m.type === 'response' && m.method === 'client/switch_provider',
    ) as ServerResponse

    expect(last).toBeDefined()
    expect(last.result?.success).toBe(true)
    expect(last.result?.agentId).toBeDefined()
  })

  test('client/switch_provider scopes the list to the new agent and restores it on switch-back', async () => {
    // Create a session under echo at `cwd`.
    const newSessionResp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/new_session',
          params: { requestId: 'setup-new-session-ps' },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )
    const created = newSessionResp.find(
      (m) => m.type === 'response' && m.method === 'client/new_session',
    ) as ServerResponse
    const echoSessionId = created.result?.sessionId as string
    expect(echoSessionId).toBeDefined()

    // Switch to a DIFFERENT (provider, cwd) identity: same binary so it can
    // spawn in CI, but a distinct agent row — which forces a teardown and a
    // fresh session scope.
    const otherCwd = join(cwd, 'src')
    const switchResp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/switch_provider',
          params: {
            requestId: 'switch-diff',
            provider: 'echo',
            cwd: otherCwd,
          },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const switched = switchResp.find(
      (m) => m.type === 'response' && m.method === 'client/switch_provider',
    ) as ServerResponse
    expect(switched.result?.success).toBe(true)

    const listAfterSwitch = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/list_sessions',
          params: { requestId: 'list-after-switch', source: 'memory' },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )
    const scoped = listAfterSwitch.find(
      (m) => m.type === 'response' && m.method === 'client/list_sessions',
    ) as ServerResponse

    // The echo session belongs to the other agent scope, so it is not listed.
    const scopedIds = (scoped.result?.sessions as any[]).map((s) => s.id)
    expect(scopedIds).not.toContain(echoSessionId)

    // Switch back and confirm the original session reappears.
    await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/switch_provider',
          params: { requestId: 'switch-back', provider: 'echo', cwd },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const listBack = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/list_sessions',
          params: { requestId: 'list-back', source: 'memory' },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )
    const restored = listBack.find(
      (m) => m.type === 'response' && m.method === 'client/list_sessions',
    ) as ServerResponse

    const restoredIds = (restored.result?.sessions as any[]).map((s) => s.id)
    expect(restoredIds).toContain(echoSessionId)
  })
})
