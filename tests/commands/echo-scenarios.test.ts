import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { AgenticServer } from '../../src/AgenticServer'
import type { ServerNotification } from 'src/comms/ICommsInterface'
import { InMemoryCommsInterface } from 'tests/helpers/InMemoryCommsInterface'
import { request } from 'tests/helpers/request'

/** The echo provider's `/<scenario>` stubs, driven through the real server. */
describe('Commands.EchoScenarios', () => {
  let server: AgenticServer
  let comms: InMemoryCommsInterface
  let notifications: ServerNotification[]

  beforeEach(async () => {
    process.env.ECHO_STUB_DELAY_MS = '0'
    comms = new InMemoryCommsInterface()
    notifications = []
    comms.onOutgoing((msg) => {
      if (msg.type === 'notification') notifications.push(msg)
    })
    server = new AgenticServer({
      mode: 'rpc',
      exitOnDispose: false,
      commsInterface: comms,
      disposeOnCommsInterfaceClose: false,
    })
    const cwd = join(import.meta.dir, '..', '..')
    await server.init(cwd)
    await request(comms, 'client/init', { provider: 'echo', cwd })
    await request(comms, 'client/new_session', {})
  })

  afterEach(async () => {
    await server.dispose()
    delete process.env.ECHO_STUB_DELAY_MS
  })

  /** `updateType`s forwarded to the editor, in order. */
  const updateTypes = () =>
    notifications
      .filter((n) => n.method === 'agentic/session_update')
      .map((n) => (n.data as any).updateType as string)

  /** Concatenated agent message text forwarded to the editor. */
  const agentText = () =>
    notifications
      .filter(
        (n) =>
          n.method === 'agentic/session_update' &&
          (n.data as any).updateType === 'agent_message_chunk',
      )
      .map((n) => (n.data as any).update.content.text ?? '')
      .join('')

  test('a new session advertises the scenarios as available commands', async () => {
    const update = notifications.find(
      (n) =>
        n.method === 'agentic/session_update' &&
        (n.data as any).updateType === 'available_commands_update',
    )
    const names = (update?.data as any)?.update.availableCommands.map(
      (c: { name: string }) => c.name,
    )

    expect(names).toContain('permission')
    expect(names).toContain('help')
  })

  test('/tour streams every non-interactive update type', async () => {
    const { response } = await request(comms, 'client/ask', {
      prompt: '/tour',
    })

    expect(response.error).toBeUndefined()
    expect(new Set(updateTypes())).toEqual(
      new Set([
        'user_message_chunk',
        'agent_thought_chunk',
        'agent_message_chunk',
        'plan',
        'tool_call',
        'tool_call_update',
        'usage_update',
        'compaction_update',
        'compaction_summary_chunk',
        'session_info_update',
        'available_commands_update',
      ]),
    )
  })

  test('/permission waits for the editor answer', async () => {
    const asked = new Promise<string>((resolve) => {
      comms.onOutgoing((msg) => {
        if (msg.type === 'notification' && msg.method === 'agentic/question') {
          resolve((msg.data as any).questionId)
        }
      })
    })
    const ask = request(comms, 'client/ask', { prompt: '/permission' })

    const questionId = await asked
    await request(comms, 'client/answer', { questionId, answer: 'allow-once' })
    const { response } = await ask

    expect(response.error).toBeUndefined()
    expect(agentText()).toContain('`allow-once` — edit applied')
  })

  test('/read_file reads through the client fs handler', async () => {
    await request(comms, 'client/ask', {
      prompt: '/read_file tests/fixtures/path.txt',
    })

    expect(agentText()).toContain('Read `tests/fixtures/path.txt`')
  })

  test('/error answers the prompt with an error', async () => {
    const { response } = await request(comms, 'client/ask', {
      prompt: '/error boom',
    })

    expect(response.error?.message).toContain('boom')
  })

  test('client/cancel_turn stops a running scenario', async () => {
    process.env.ECHO_STUB_DELAY_MS = '30'
    await server.dispose()
    server = new AgenticServer({
      mode: 'rpc',
      exitOnDispose: false,
      commsInterface: comms,
      disposeOnCommsInterfaceClose: false,
    })
    const cwd = join(import.meta.dir, '..', '..')
    await server.init(cwd)
    await request(comms, 'client/init', { provider: 'echo', cwd })
    await request(comms, 'client/new_session', {})

    const ask = request(comms, 'client/ask', { prompt: '/slow 30' })
    await Bun.sleep(300)
    await request(comms, 'client/cancel_turn', {})
    // `/slow 30` streams for 30s; `request` would time out after 5s.
    const { response } = await ask

    expect(response.error).toBeUndefined()
    expect(agentText()).not.toContain('word200')
  })

  test('unknown slash text is echoed as usual', async () => {
    await request(comms, 'client/ask', { prompt: '/not_a_scenario' })

    expect(agentText()).toBe('Echo summary chunk (end)')
  })
})
