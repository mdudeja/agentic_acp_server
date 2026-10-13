import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgenticServer } from '../../src/AgenticServer'
import { InMemoryCommsInterface } from 'tests/helpers/InMemoryCommsInterface'
import { request } from 'tests/helpers/request'

/** Runs git in `cwd` and returns trimmed stdout. */
async function git(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  await proc.exited
  return (await new Response(proc.stdout).text()).trim()
}

describe('Commands.Checkpoints', () => {
  let server: AgenticServer
  let comms: InMemoryCommsInterface
  let workspace: string

  /** A git workspace with the turnCheckpoint hook on or off, and an echo session. */
  async function start(enabled: boolean) {
    workspace = mkdtempSync(join(tmpdir(), 'checkpoints-e2e-'))
    await git(workspace, 'init', '-q')
    writeFileSync(join(workspace, 'a.txt'), 'original\n')
    mkdirSync(join(workspace, '.agentic'))
    writeFileSync(
      join(workspace, '.agentic', 'agentic_acp_config.json'),
      JSON.stringify({ hooks: { builtin: { turnCheckpoint: { enabled } } } }),
    )

    comms = new InMemoryCommsInterface()
    server = new AgenticServer({
      mode: 'rpc',
      exitOnDispose: false,
      commsInterface: comms,
      disposeOnCommsInterfaceClose: false,
    })
    await server.init(workspace)
    await request(comms, 'client/init', { provider: 'echo', cwd: workspace })
    const created = await request(comms, 'client/new_session', {})
    return created.response.result?.sessionId as string
  }

  afterEach(async () => {
    await server.dispose()
  })

  test('lists, diffs and restores the checkpoint taken before a turn', async () => {
    const sessionId = await start(true)

    await request(comms, 'client/ask', { prompt: '/touch a.txt changed' })
    await request(comms, 'client/ask', { prompt: '/touch b.txt new file' })

    const listed = await request(comms, 'client/list_checkpoints', { sessionId })
    const result = listed.response.result!
    expect(result.enabled).toBe(true)
    expect(result.root).toBe(await git(workspace, 'rev-parse', '--show-toplevel'))
    expect(result.checkpoints.map((c: any) => [c.kind, c.prompt])).toEqual([
      ['turn', '/touch b.txt new file'],
      ['turn', '/touch a.txt changed'],
    ])
    const first = result.checkpoints[1].sha

    const changed = await request(comms, 'client/checkpoint_changes', { sha: first })
    expect(changed.response.result?.files).toEqual([
      { path: 'a.txt', status: 'modified', added: 1, removed: 1, binary: false },
      { path: 'b.txt', status: 'added', added: 1, removed: 0, binary: false },
    ])

    const file = await request(comms, 'client/checkpoint_file', { sha: first, path: 'a.txt' })
    expect(file.response.result).toEqual({ success: true, content: 'original\n', binary: false })

    const restored = await request(comms, 'client/restore_checkpoint', { sha: first, sessionId })
    expect(restored.response.result).toMatchObject({
      success: true,
      restored: ['a.txt'],
      deleted: ['b.txt'],
    })
    expect(readFileSync(join(workspace, 'a.txt'), 'utf8')).toBe('original\n')
    expect(existsSync(join(workspace, 'b.txt'))).toBe(false)

    const after = await request(comms, 'client/list_checkpoints', { sessionId, limit: 1 })
    expect(after.response.result?.checkpoints[0]).toMatchObject({
      sha: restored.response.result?.backup,
      kind: 'restore',
    })
  })

  test('errors are answered, not dropped', async () => {
    await start(true)
    const { response } = await request(comms, 'client/checkpoint_changes', { sha: 'deadbeef' })
    expect(response.error?.message).toContain('Not a checkpoint')
  })

  test('reports the hook as disabled', async () => {
    const sessionId = await start(false)
    await request(comms, 'client/ask', { prompt: '/touch a.txt changed' })

    const { response } = await request(comms, 'client/list_checkpoints', { sessionId })
    expect(response.result).toEqual({ success: true, enabled: false, checkpoints: [] })
  })
})
