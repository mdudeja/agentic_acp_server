import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { HookManager } from 'src/hooks/HookManager'
import { MemoryTrustStore } from 'src/hooks/trust'
import { configWithoutBuiltins, makeHookHost } from 'tests/helpers/hooks'

/** A hook file that tags `server.start` runs into `globalThis.__hookRuns`. */
const hookSource = (name: string, tag = name) => `
import { defineHook } from 'agentic-acp-server/hooks'
export default defineHook({
  name: ${JSON.stringify(name)},
  event: 'server.start',
  handler() {
    ;(globalThis.__hookRuns ??= []).push(${JSON.stringify(tag)})
  },
})
`

const runs = () => ((globalThis as any).__hookRuns ??= []) as string[]

function setup(options: Parameters<typeof makeHookHost>[0] = {}) {
  const globalDir = mkdtempSync(join(tmpdir(), 'hooks-global-'))
  const { host, workspaceRoot, config } = makeHookHost(options)
  const projectDir = join(workspaceRoot, '.agentic', 'hooks')
  mkdirSync(projectDir, { recursive: true })
  const trustStore = new MemoryTrustStore()
  const manager = new HookManager(host, { trustStore, globalDir })

  const start = async () => {
    runs().length = 0
    await manager.run('server.start', { workspaceRoot })
    return [...runs()].sort()
  }

  return {
    manager,
    host,
    config,
    workspaceRoot,
    globalDir,
    projectDir,
    trustStore,
    start,
  }
}

afterEach(() => {
  delete process.env.ACP_TRUST_PROJECT_HOOKS
})

describe('hook loading', () => {
  it('loads global hooks without asking, importing the virtual API module', async () => {
    const { manager, globalDir, host, start } = setup()
    writeFileSync(join(globalDir, 'mine.ts'), hookSource('mine'))

    const summary = await manager.load()

    expect(summary).toMatchObject({ loaded: 1, pendingTrust: [], errors: [] })
    expect(host.ask).not.toHaveBeenCalled()
    expect(manager.list()[0]).toMatchObject({ name: 'mine', source: 'global' })
    expect(await start()).toEqual(['mine'])
  })

  it('skips helper and declaration files', async () => {
    const { manager, globalDir } = setup()
    writeFileSync(join(globalDir, '_shared.ts'), 'export const x = 1')
    writeFileSync(join(globalDir, 'types.d.ts'), 'export {}')
    writeFileSync(join(globalDir, 'notes.md'), '# notes')

    expect((await manager.load()).errors).toEqual([])
    expect(manager.list()).toEqual([])
  })

  it('reports bad files and still loads the good ones', async () => {
    const { manager, globalDir } = setup()
    writeFileSync(join(globalDir, 'a-good.ts'), hookSource('good'))
    writeFileSync(join(globalDir, 'b-syntax.ts'), 'export default {{{')
    writeFileSync(
      join(globalDir, 'c-invalid.ts'),
      `export default [{ name: 'x', event: 'nope', handler() {} }, { event: 'server.start' }]`,
    )
    writeFileSync(join(globalDir, 'd-empty.ts'), 'export const notDefault = 1')

    const summary = await manager.load()

    expect(manager.list().map((h) => h.name)).toEqual(['good'])
    // One error per bad file, and one per invalid export.
    expect(summary.errors.map((e) => e.file.split('/').pop()).sort()).toEqual([
      'b-syntax.ts',
      'c-invalid.ts',
      'c-invalid.ts',
      'd-empty.ts',
    ])
    expect(
      summary.errors.find((e) => e.file.endsWith('d-empty.ts'))?.error,
    ).toBe('no default export')
  })

  it('a project hook replaces a same-named global one', async () => {
    const { manager, globalDir, projectDir, start } = setup()
    process.env.ACP_TRUST_PROJECT_HOOKS = 'always'
    writeFileSync(join(globalDir, 'h.ts'), hookSource('shared', 'global'))
    writeFileSync(join(projectDir, 'h.ts'), hookSource('shared', 'project'))

    await manager.load()

    expect(await start()).toEqual(['project'])
  })

  it('reloads a changed file', async () => {
    const { manager, globalDir, start } = setup()
    const file = join(globalDir, 'h.ts')
    writeFileSync(file, hookSource('h', 'v1'))
    await manager.load()
    expect(await start()).toEqual(['v1'])

    writeFileSync(file, hookSource('h', 'v2'))
    const later = new Date(Date.now() + 5000)
    utimesSync(file, later, later)
    await manager.load()

    expect(await start()).toEqual(['v2'])
  })
})

describe('project hook trust', () => {
  it('leaves unknown project files pending, then asks', async () => {
    const { manager, projectDir, host, start } = setup({ answer: 'trust' })
    const file = join(projectDir, 'p.ts')
    writeFileSync(file, hookSource('p'))

    const summary = await manager.load()
    expect(summary.pendingTrust).toEqual([file])
    expect(host.ask).not.toHaveBeenCalled()
    expect(await start()).toEqual([])

    await manager.resolvePendingTrust()

    expect(host.ask).toHaveBeenCalledTimes(1)
    expect(host.ask.mock.calls[0]?.[0]).toContain(file)
    expect(await start()).toEqual(['p'])
  })

  it('remembers trust until the file changes', async () => {
    const { manager, projectDir, host, start } = setup({ answer: 'trust' })
    const file = join(projectDir, 'p.ts')
    writeFileSync(file, hookSource('p'))

    await manager.load({ askTrust: true })
    await manager.load()
    expect(host.ask).toHaveBeenCalledTimes(1)
    expect(await start()).toEqual(['p'])

    writeFileSync(file, hookSource('p', 'changed'))
    const summary = await manager.load()
    expect(summary.pendingTrust).toEqual([file])
    expect(await start()).toEqual([])
  })

  it('a skipped file stays skipped unless askSkipped', async () => {
    let answer = 'skip'
    const { manager, projectDir, host, start } = setup({ answer: () => answer })
    writeFileSync(join(projectDir, 'p.ts'), hookSource('p'))

    await manager.load({ askTrust: true })
    expect(await start()).toEqual([])

    await manager.load({ askTrust: true })
    expect(host.ask).toHaveBeenCalledTimes(1)

    answer = 'trust'
    await manager.load({ askTrust: true, askSkipped: true })
    expect(host.ask).toHaveBeenCalledTimes(2)
    expect(await start()).toEqual(['p'])
  })

  it('trustProjectHooks: never skips project files without asking', async () => {
    const { manager, projectDir, host } = setup({
      config: configWithoutBuiltins({ trustProjectHooks: 'never' }),
    })
    writeFileSync(join(projectDir, 'p.ts'), hookSource('p'))

    const summary = await manager.load({ askTrust: true })

    expect(summary).toMatchObject({ loaded: 0, pendingTrust: [] })
    expect(host.ask).not.toHaveBeenCalled()
  })

  it('ACP_TRUST_PROJECT_HOOKS=always trusts project files', async () => {
    const { manager, projectDir, host, start } = setup()
    process.env.ACP_TRUST_PROJECT_HOOKS = 'always'
    writeFileSync(join(projectDir, 'p.ts'), hookSource('p'))

    await manager.load()

    expect(host.ask).not.toHaveBeenCalled()
    expect(await start()).toEqual(['p'])
  })

  it('config.paths: files outside the workspace load, inside need trust', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'hooks-outside-'))
    writeFileSync(join(outside, 'o.ts'), hookSource('outside'))

    const { manager, workspaceRoot, config, start } = setup()
    mkdirSync(join(workspaceRoot, 'tools'))
    writeFileSync(join(workspaceRoot, 'tools', 'i.ts'), hookSource('inside'))
    config.hooks.paths = [outside, 'tools/i.ts']

    const summary = await manager.load()

    expect(summary.pendingTrust).toEqual([join(workspaceRoot, 'tools', 'i.ts')])
    expect(await start()).toEqual(['outside'])
  })
})
