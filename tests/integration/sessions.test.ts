import { describe, it, expect, afterEach } from 'bun:test'
import { join } from 'node:path'
import { ServerHarness } from '../helpers/ServerHarness'

const WORKSPACE_ROOT = join(import.meta.dir, '..', '..')

let harness: ServerHarness

afterEach(() => {
  harness?.dispose()
})

// ---------------------------------------------------------------------------
// Shared: boot the server, init the echo agent, create a session.
// Returns the sessionId.
// ---------------------------------------------------------------------------
async function initAndNewSession(h: ServerHarness): Promise<string> {
  h.send({
    jsonrpc: '2.0',
    data: {
      method: 'client/init',
      params: { provider: 'echo', cwd: WORKSPACE_ROOT, requestId: 'req-init' },
    },
  })
  await h.waitFor('client/init', 'response')

  h.send({
    jsonrpc: '2.0',
    data: {
      method: 'client/new_session',
      params: { sessionName: 'My Test Session', requestId: 'req-new-session' },
    },
  })
  const newResp = (await h.waitFor('client/new_session', 'response')) as any
  return newResp.result.sessionId as string
}

// ---------------------------------------------------------------------------

describe('E2E: session lifecycle', () => {
  it('list_sessions returns the newly created session', async () => {
    harness = ServerHarness.create()
    const sessionId = await initAndNewSession(harness)

    harness.send({
      jsonrpc: '2.0',
      data: {
        method: 'client/list_sessions',
        params: { requestId: 'req-list-1' },
      },
    })

    const resp = (await harness.waitFor(
      'client/list_sessions',
      'response',
    )) as any

    expect(resp.result.success).toBe(true)
    const sessions: any[] = resp.result.sessions
    const found = sessions.find((s: any) => s.id === sessionId)
    expect(found).toBeDefined()
    expect(found.name).toBe('My Test Session')
  })

  it('rename_session changes the session name visible in list_sessions', async () => {
    harness = ServerHarness.create()
    const sessionId = await initAndNewSession(harness)

    harness.send({
      jsonrpc: '2.0',
      data: {
        method: 'client/rename_session',
        params: {
          sessionId,
          newName: 'Renamed Session',
          requestId: 'req-rename',
        },
      },
    })
    const renameResp = (await harness.waitFor(
      'client/rename_session',
      'response',
    )) as any
    expect(renameResp.result.success).toBe(true)

    harness.send({
      jsonrpc: '2.0',
      data: {
        method: 'client/list_sessions',
        params: { requestId: 'req-list-2' },
      },
    })
    const listResp = (await harness.waitFor(
      'client/list_sessions',
      'response',
    )) as any

    const renamed = listResp.result.sessions.find(
      (s: any) => s.id === sessionId,
    )
    expect(renamed?.name).toBe('Renamed Session')
  })

  it('delete_session removes the session from list_sessions', async () => {
    harness = ServerHarness.create()
    const sessionId = await initAndNewSession(harness)

    harness.send({
      jsonrpc: '2.0',
      data: {
        method: 'client/delete_session',
        params: { sessionId, requestId: 'req-delete' },
      },
    })
    const deleteResp = (await harness.waitFor(
      'client/delete_session',
      'response',
    )) as any
    expect(deleteResp.result.success).toBe(true)

    harness.send({
      jsonrpc: '2.0',
      data: {
        method: 'client/list_sessions',
        params: { requestId: 'req-list-3' },
      },
    })
    const listResp = (await harness.waitFor(
      'client/list_sessions',
      'response',
    )) as any

    const sessions: any[] = listResp.result.sessions
    const deleted = sessions.find((s: any) => s.id === sessionId)
    expect(deleted).toBeUndefined()
  })
})
