import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgenticServer } from '../../src/AgenticServer'
import type { ServerNotification } from 'src/comms/ICommsInterface'
import { InMemoryCommsInterface } from 'tests/helpers/InMemoryCommsInterface'
import { request } from 'tests/helpers/request'

/** Project hooks used by these tests (trusted via ACP_TRUST_PROJECT_HOOKS). */
const PROJECT_HOOKS = `
import { defineHook } from 'agentic-acp-server/hooks'

export default [
  defineHook({
    name: 'tagPrompts',
    event: 'prompt.before',
    match: { origin: 'user' },
    handler(input) {
      const text = input.prompt.map((b) => (b.type === 'text' ? b.text : '')).join('')
      if (text.includes('forbidden')) {
        return { decision: 'deny', reason: 'no forbidden words' }
      }
      return { prompt: [...input.prompt, { type: 'text', text: '[hooked]' }] }
    },
  }),
  defineHook({
    name: 'noBlockedFiles',
    event: 'fs.beforeWrite',
    match: { path: '**/blocked.txt' },
    handler: () => ({ decision: 'deny', reason: 'blocked by test' }),
  }),
  defineHook({
    name: 'recordSessions',
    event: 'session.created',
    handler(input) {
      ;(globalThis.__hookSessions ??= []).push(input.sessionId)
    },
  }),
]
`

describe('Commands.Hooks', () => {
  let server: AgenticServer
  let comms: InMemoryCommsInterface
  let workspace: string
  let notifications: ServerNotification[]

  beforeEach(async () => {
    process.env.ACP_TRUST_PROJECT_HOOKS = 'always'
    workspace = mkdtempSync(join(tmpdir(), 'hooks-e2e-'))
    mkdirSync(join(workspace, '.agentic', 'hooks'), { recursive: true })
    writeFileSync(
      join(workspace, '.agentic', 'hooks', 'project.ts'),
      PROJECT_HOOKS,
    )

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
    await server.init(workspace)
    await request(comms, 'client/init', { provider: 'echo', cwd: workspace })
  })

  afterEach(async () => {
    await server.dispose()
    delete process.env.ACP_TRUST_PROJECT_HOOKS
  })

  /** Text the echo agent says it received in `user_message_chunk`s. */
  const received = () =>
    notifications
      .filter(
        (n) =>
          n.method === 'agentic/session_update' &&
          (n.data as any).updateType === 'user_message_chunk',
      )
      .map((n) => (n.data as any).update.content.text as string)

  test('prompt.before rewrites what the agent receives', async () => {
    await request(comms, 'client/new_session', {})

    const { response } = await request(comms, 'client/ask', { prompt: 'hello' })

    expect(response.result).toEqual({ success: true })
    expect(received()).toEqual(['hello\n[hooked]'])
  })

  test('prompt.before can block a prompt', async () => {
    await request(comms, 'client/new_session', {})

    const { response } = await request(comms, 'client/ask', {
      prompt: 'something forbidden',
    })

    expect(response.result).toEqual({ success: false })
    expect(response.error?.message).toBe(
      'Prompt blocked by hook tagPrompts: no forbidden words',
    )
    expect(received()).toEqual([])
  })

  test('fs.beforeWrite guards agent writes and the editor is told', async () => {
    const client = server.getState().connection!.client
    const write = (path: string) =>
      client.writeTextFile({
        sessionId: 'acp-any',
        path: join(workspace, path),
        content: 'x',
      })

    await expect(write('blocked.txt')).rejects.toThrow(
      'blocked by hook noBlockedFiles: blocked by test',
    )
    // The protectedPaths built-in is on by default.
    await expect(write('.env')).rejects.toThrow('protectedPaths:write')
    await write('allowed.txt')
    expect(await Bun.file(join(workspace, 'allowed.txt')).text()).toBe('x')

    expect(
      notifications
        .filter((n) => n.method === 'agentic/hook')
        .map((n) => n.data),
    ).toEqual([
      {
        hook: 'noBlockedFiles',
        event: 'fs.beforeWrite',
        outcome: 'deny',
        reason: 'blocked by test',
      },
      expect.objectContaining({
        hook: 'protectedPaths:write',
        outcome: 'deny',
      }),
    ])
  })

  test('session lifecycle hooks run', async () => {
    ;(globalThis as any).__hookSessions = []
    const { response } = await request(comms, 'client/new_session', {})

    await Bun.sleep(10)
    expect((globalThis as any).__hookSessions).toEqual([
      response.result?.sessionId,
    ])
  })

  test('client/list_hooks and client/set_hook_enabled', async () => {
    const listed = await request(comms, 'client/list_hooks', {})
    const hooks = listed.response.result?.hooks as Array<{
      name: string
      source: string
      enabled: boolean
    }>

    expect(hooks.find((h) => h.name === 'tagPrompts')).toMatchObject({
      source: 'project',
      enabled: true,
    })
    expect(
      hooks.some(
        (h) => h.name === 'protectedPaths:read' && h.source === 'builtin',
      ),
    ).toBe(true)

    const toggled = await request(comms, 'client/set_hook_enabled', {
      name: 'tagPrompts',
      enabled: false,
    })
    expect(toggled.response.result).toEqual({ success: true })

    await request(comms, 'client/new_session', {})
    await request(comms, 'client/ask', { prompt: 'plain' })
    expect(received()).toEqual(['plain'])

    const unknown = await request(comms, 'client/set_hook_enabled', {
      name: 'nope',
      enabled: false,
    })
    expect(unknown.response.error?.message).toBe('No hook named nope')
  })

  test('client/reload_hooks picks up new hook files', async () => {
    writeFileSync(
      join(workspace, '.agentic', 'hooks', 'later.ts'),
      `export default { name: 'later', event: 'server.start', handler() {} }`,
    )

    const { response } = await request(comms, 'client/reload_hooks', {})

    expect(response.result).toMatchObject({
      success: true,
      errors: [],
      pendingTrust: [],
    })
    const listed = await request(comms, 'client/list_hooks', {})
    expect(
      (listed.response.result?.hooks as Array<{ name: string }>).some(
        (h) => h.name === 'later',
      ),
    ).toBe(true)
  })
})
