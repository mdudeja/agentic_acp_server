import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { AgenticServer } from '../../src/AgenticServer'
import { AgentManager } from '../../src/managers/AgentManager'
import type { ASMPayload } from 'src/openrpc/schemas'
import type {
  ServerNotification,
  ServerResponse,
} from 'src/comms/ICommsInterface'
import { join } from 'path'
import { InMemoryCommsInterface } from 'tests/helpers/InMemoryCommsInterface'

const cwd = join(import.meta.dir, '..', '..')

/**
 * Failure paths must still answer the request. Unlike
 * `commandResponseRoundTrip`, this does not bail out on error-level logs
 * (failures log by design); it waits for the response to `requestId`.
 */
function request(
  comms: InMemoryCommsInterface,
  method: string,
  params: Record<string, unknown>,
): Promise<{ response: ServerResponse; notifications: ServerNotification[] }> {
  const requestId = `${method}-${Math.random()}`
  const notifications: ServerNotification[] = []

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error(`No response to ${method} within 5s`))
    }, 5000)

    const unsubscribe = comms.onOutgoing((msg) => {
      if (msg.type === 'notification') {
        notifications.push(msg)
        return
      }
      if (msg.id === requestId) {
        clearTimeout(timeout)
        unsubscribe()
        resolve({ response: msg, notifications })
      }
    })

    comms
      .send({
        jsonrpc: '2.0',
        data: { method, params: { requestId, ...params } },
      } as ASMPayload)
      .catch(reject)
  })
}

describe('Commands.Failures', () => {
  let server: AgenticServer
  let comms: InMemoryCommsInterface

  beforeEach(async () => {
    comms = new InMemoryCommsInterface()
    server = new AgenticServer({
      mode: 'rpc',
      exitOnDispose: false,
      commsInterface: comms,
      disposeOnCommsInterfaceClose: false,
    })
    await server.init(cwd)
  })

  afterEach(async () => {
    await server.dispose()
  })

  const init = () => request(comms, 'client/init', { provider: 'echo', cwd })

  test('client/init reports a failed agent start and can be retried', async () => {
    const connectSpy = spyOn(AgentManager.prototype, 'connect')
    connectSpy.mockResolvedValueOnce(undefined)

    const failed = await init()
    expect(failed.response.result).toEqual({ success: false })
    expect(failed.response.error?.message).toContain('Failed to connect')
    // The half-started agent was torn down.
    expect(server.getManagers().agentManager).toBeNull()

    connectSpy.mockRestore()

    const retried = await init()
    expect(retried.response.result?.success).toBe(true)
    expect(server.getManagers().agentManager?.isAlive()).toBe(true)
  })

  test('session operations report failures instead of success', async () => {
    await init()

    const load = await request(comms, 'client/load_session', {
      sessionId: 'missing',
    })
    expect(load.response.result).toEqual({ success: false })
    expect(load.response.error?.message).toBe(
      'Session with ID missing not found',
    )

    const rename = await request(comms, 'client/rename_session', {
      sessionId: 'missing',
      newName: 'x',
    })
    expect(rename.response.result).toEqual({ success: false })

    const ask = await request(comms, 'client/ask', { prompt: 'hi' })
    expect(ask.response.result).toEqual({ success: false })
    expect(ask.response.error?.message).toBe(
      'No active session ID found to send prompt',
    )
  })

  test('client/new_session responds from the dispatcher, once', async () => {
    await init()

    const responses: ServerResponse[] = []
    comms.onOutgoing((msg) => {
      if (msg.type === 'response' && msg.method === 'client/new_session') {
        responses.push(msg)
      }
    })

    const created = await request(comms, 'client/new_session', {})
    expect(created.response.result?.success).toBe(true)
    expect(created.response.result?.sessionId).toBe(
      server.getState().session?.id,
    )
    expect(responses.length).toBe(1)
  })

  test('a handler that throws still answers the request', async () => {
    await init()
    spyOn(server.getManagers().sessionManager!, 'loadSession').mockRejectedValue(
      new Error('agent exploded'),
    )

    const { response } = await request(comms, 'client/load_session', {
      sessionId: 'anything',
    })
    expect(response.result).toEqual({ success: false })
    expect(response.error?.message).toBe('agent exploded')
  })

  test('client/index is answered with the outcome', async () => {
    // Stubbed: a real index run depends on the local `agentic-indexer`.
    spyOn(server.getManagers().indexerManager!, 'runCommand').mockResolvedValue(
      { success: false, error: 'index failed' },
    )

    const { response } = await request(comms, 'client/index', {})
    expect(response.result).toEqual({ success: false })
    expect(response.error?.message).toBe('index failed')
  })

  test('an agent crash is detected and client/init restarts it', async () => {
    await init()
    const agentManager = server.getManagers().agentManager!
    const proc = agentManager.getAgent()!.process!

    const logs: string[] = []
    comms.onOutgoing((msg) => {
      if (msg.type === 'notification' && msg.method === 'agentic/log') {
        logs.push((msg.data as { message: string }).message)
      }
    })

    // Kill the process behind the manager's back, as a crash would.
    proc.kill('SIGKILL')
    await proc.exited
    await Bun.sleep(0)

    expect(agentManager.isAlive()).toBe(false)
    expect(server.getState().connection).toBeUndefined()
    expect(logs.some((m) => m.includes('exited unexpectedly'))).toBe(true)

    const restarted = await init()
    expect(restarted.response.result?.success).toBe(true)
    expect(server.getManagers().agentManager?.isAlive()).toBe(true)
    expect(server.getState().connection).toBeDefined()
  })

  test('dispose is idempotent and waits for the agent to stop', async () => {
    await init()
    const proc = server.getManagers().agentManager!.getAgent()!.process!

    const first = server.dispose()
    const second = server.dispose()
    expect(second).toBe(first)

    await first
    expect(proc.killed || proc.exitCode !== null).toBe(true)
  })

  test('the NES manager is created once across re-inits', async () => {
    await init()
    const nesManager = server.getManagers().nesManager
    expect(nesManager).toBeDefined()

    await init()
    await request(comms, 'client/switch_provider', { provider: 'echo', cwd })

    expect(server.getManagers().nesManager).toBe(nesManager)
  })
})
