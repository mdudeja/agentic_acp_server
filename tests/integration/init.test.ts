import { describe, it, expect, afterEach } from 'bun:test'
import { join } from 'node:path'
import { ServerHarness } from '../helpers/ServerHarness'

// Workspace root — echo provider args are relative to this directory
const WORKSPACE_ROOT = join(import.meta.dir, '..', '..')

let harness: ServerHarness

afterEach(() => {
  harness?.dispose()
})

describe('E2E: client/init', () => {
  it('returns { success: true, agentId } for the echo provider', async () => {
    harness = ServerHarness.create()

    harness.send({
      jsonrpc: '2.0',
      data: {
        method: 'client/init',
        params: { provider: 'echo', cwd: WORKSPACE_ROOT, requestId: 'req-init-1' },
      },
    })

    const resp = await harness.waitFor('client/init', 'response') as any

    expect(resp.result.success).toBe(true)
    expect(typeof resp.result.agentId).toBe('string')
    expect(resp.result.agentId.length).toBeGreaterThan(0)
  })

  it('returns { success: true, sessionId } for client/new_session after init', async () => {
    harness = ServerHarness.create()

    harness.send({
      jsonrpc: '2.0',
      data: {
        method: 'client/init',
        params: { provider: 'echo', cwd: WORKSPACE_ROOT, requestId: 'req-init-2' },
      },
    })

    await harness.waitFor('client/init', 'response')

    harness.send({
      jsonrpc: '2.0',
      data: {
        method: 'client/new_session',
        params: { requestId: 'req-session-1' },
      },
    })

    const resp = await harness.waitFor('client/new_session', 'response') as any

    expect(resp.result.success).toBe(true)
    expect(typeof resp.result.sessionId).toBe('string')
    expect(resp.result.sessionId.length).toBeGreaterThan(0)
  })
})
