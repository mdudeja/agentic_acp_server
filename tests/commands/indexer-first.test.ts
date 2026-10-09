import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgenticServer } from '../../src/AgenticServer'
import type { ServerNotification } from 'src/comms/ICommsInterface'
import { InMemoryCommsInterface } from 'tests/helpers/InMemoryCommsInterface'
import { request } from 'tests/helpers/request'

/**
 * The `indexerFirst` built-in end to end: agent → client requests go through
 * the real ACP client (`connection.client`), so the hook decisions are the
 * ones a real agent would get.
 */
describe('Commands.IndexerFirst', () => {
  let server: AgenticServer
  let comms: InMemoryCommsInterface
  let workspace: string
  let notifications: ServerNotification[]

  beforeEach(async () => {
    workspace = mkdtempSync(join(tmpdir(), 'indexer-first-e2e-'))
    mkdirSync(join(workspace, '.agentic'), { recursive: true })
    writeFileSync(
      join(workspace, '.agentic', 'agentic_acp_config.json'),
      JSON.stringify({
        hooks: { builtin: { indexerFirst: { enabled: true } } },
      }),
    )
    writeFileSync(join(workspace, 'a.ts'), 'export const a = 1\n')

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
    await request(comms, 'client/new_session', {})
  })

  afterEach(async () => {
    await server.dispose()
  })

  const acpSessionId = () => server.getState().session!.acp_session_id
  const client = () => server.getState().connection!.client

  const read = (range?: { line: number; limit: number }) =>
    client().readTextFile({
      sessionId: acpSessionId(),
      path: join(workspace, 'a.ts'),
      ...range,
    })

  const update = (update: Record<string, unknown>) =>
    client().sessionUpdate({
      sessionId: acpSessionId(),
      update: update as never,
    })

  test('adds the exploration rule to user prompts', async () => {
    await request(comms, 'client/ask', { prompt: 'where is a?' })

    const received = notifications
      .filter(
        (n) =>
          n.method === 'agentic/session_update' &&
          (n.data as any).updateType === 'user_message_chunk',
      )
      .map((n) => (n.data as any).update.content.text as string)
    expect(received).toHaveLength(1)
    expect(received[0]).toStartWith('[Code exploration policy]')
    expect(received[0]).toEndWith('where is a?')
  })

  test('whole-file reads wait for an indexer [no-results]; ranged reads never do', async () => {
    await expect(read()).rejects.toThrow('indexerFirst:read')
    expect((await read({ line: 1, limit: 1 })).content).toContain('a = 1')

    await update({
      sessionUpdate: 'tool_call',
      toolCallId: 'idx1',
      title: 'agentic-indexer_search_codebase',
      kind: 'other',
      status: 'pending',
    })
    await update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'idx1',
      status: 'completed',
      rawOutput: {
        output: '[no-results] No symbols found matching the query.',
      },
    })
    // `session.update` hooks are fire-and-forget.
    await Bun.sleep(20)

    expect((await read()).content).toContain('a = 1')
  })

  test('answers read/search permission requests without asking the editor', async () => {
    const ask = (toolCall: Record<string, unknown>) =>
      client().requestPermission({
        sessionId: acpSessionId(),
        toolCall: { toolCallId: `p-${Math.random()}`, ...toolCall } as never,
        options: [
          { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
          { optionId: 'no', name: 'Reject', kind: 'reject_once' },
        ],
      })

    const grep = await ask({
      title: "Searching for 'a'",
      kind: 'read',
      rawInput: { pattern: 'a', paths: workspace },
    })
    expect(grep.outcome).toEqual({ outcome: 'selected', optionId: 'no' })

    const indexer = await ask({
      title: 'agentic-indexer_read_code',
      kind: 'read',
      rawInput: { name: 'a' },
    })
    expect(indexer.outcome).toEqual({ outcome: 'selected', optionId: 'yes' })

    expect(
      notifications.filter((n) => n.method === 'agentic/question'),
    ).toHaveLength(0)
    expect(
      notifications
        .filter((n) => n.method === 'agentic/hook')
        .map((n) => (n.data as any).hook),
    ).toEqual(['indexerFirst:permission', 'indexerFirst:permission'])
  })
})
