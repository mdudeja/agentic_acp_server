import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { deleteAsync } from 'del'
import {
  changes,
  checkPaths,
  fileAt,
  list,
  prune,
  restore,
  snapshot,
} from 'src/checkpoints/git'

/** Runs git in `cwd` and returns trimmed stdout. */
async function git(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  await proc.exited
  return (await new Response(proc.stdout).text()).trim()
}

describe('checkpoints (git)', () => {
  let root: string
  const read = (path: string) => readFileSync(join(root, path), 'utf8')
  const write = (path: string, text: string) => {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), text)
  }

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'checkpoints-'))
    await git(root, 'init', '-q')
    await git(root, 'config', 'user.email', 'test@example.com')
    await git(root, 'config', 'user.name', 'Test')
    write('a.txt', 'one\ntwo\nthree\n')
    write('.gitignore', 'ignored.log\n')
    await git(root, 'add', '.')
    await git(root, 'commit', '-qm', 'init')
  })

  afterAll(async () => {
    await deleteAsync(join(tmpdir(), 'checkpoints-*'), {
      force: true,
      onlyDirectories: true,
    })
  })

  it('records clean trees and untracked files without touching index, tree or stash', async () => {
    const clean = await snapshot(root, { sessionId: 's1', kind: 'turn', prompt: 'first\nmore' })
    write('new.txt', 'untracked\n')
    write('ignored.log', 'noise\n')
    write('.agentic/state.json', '{}')
    await git(root, 'add', 'a.txt')
    const status = await git(root, 'status', '--porcelain')

    const dirty = await snapshot(root, { sessionId: 's2', kind: 'turn', prompt: 'second' })

    expect(await git(root, 'status', '--porcelain')).toBe(status)
    expect(await git(root, 'stash', 'list')).toBe('')
    expect(await git(root, 'ls-tree', '--name-only', clean)).toBe('.gitignore\na.txt')
    expect(await git(root, 'ls-tree', '--name-only', dirty)).toBe('.gitignore\na.txt\nnew.txt')

    const all = await list(root)
    expect(all.map((c) => [c.sha, c.sessionId, c.prompt])).toEqual([
      [dirty, 's2', 'second'],
      [clean, 's1', 'first'],
    ])
    expect((await list(root, { sessionId: 's1' })).map((c) => c.sha)).toEqual([clean])
    expect(await list(root, { limit: 1 })).toHaveLength(1)
  })

  it('lists nothing before the first checkpoint', async () => {
    expect(await list(root)).toEqual([])
  })

  it('reports changes since a checkpoint and file content at it', async () => {
    write('gone.txt', 'bye\n')
    const sha = await snapshot(root, { kind: 'turn' })
    write('a.txt', 'one\nTWO\nthree\nfour\n')
    write('dir/added.txt', 'hi\n')
    rmSync(join(root, 'gone.txt'))

    const files = await changes(root, sha)
    expect(files).toEqual([
      { path: 'a.txt', status: 'modified', added: 2, removed: 1, binary: false },
      { path: 'dir/added.txt', status: 'added', added: 1, removed: 0, binary: false },
      { path: 'gone.txt', status: 'deleted', added: 0, removed: 1, binary: false },
    ])
    expect(await fileAt(root, sha, 'a.txt')).toEqual({ content: 'one\ntwo\nthree\n', binary: false })
    expect(await fileAt(root, sha, 'dir/added.txt')).toEqual({ content: null, binary: false })
  })

  it('refuses unknown shas and escaping paths', async () => {
    const head = await git(root, 'rev-parse', 'HEAD')
    expect(changes(root, head)).rejects.toThrow('Not a checkpoint')
    expect(() => checkPaths(['../x'])).toThrow()
    expect(() => checkPaths(['/etc/passwd'])).toThrow()
    expect(checkPaths(['./dir//x.txt'])).toEqual(['dir/x.txt'])
  })

  it('restores the whole tree, removing created files, and records a backup', async () => {
    write('gone.txt', 'bye\n')
    const sha = await snapshot(root, { sessionId: 's1', kind: 'turn' })
    write('a.txt', 'changed\n')
    write('dir/sub/added.txt', 'hi\n')
    rmSync(join(root, 'gone.txt'))

    const result = await restore(root, sha, { sessionId: 's1' })

    expect(read('a.txt')).toBe('one\ntwo\nthree\n')
    expect(read('gone.txt')).toBe('bye\n')
    expect(existsSync(join(root, 'dir'))).toBe(false)
    expect(result.restored.sort()).toEqual(['a.txt', 'gone.txt'])
    expect(result.deleted).toEqual(['dir/sub/added.txt'])
    expect(await changes(root, sha)).toEqual([])

    // The backup undoes the rollback.
    const [backup] = await list(root, { limit: 1 })
    expect(backup).toMatchObject({ sha: result.backup, kind: 'restore', sessionId: 's1' })
    await restore(root, result.backup)
    expect(read('a.txt')).toBe('changed\n')
    expect(read('dir/sub/added.txt')).toBe('hi\n')
    expect(existsSync(join(root, 'gone.txt'))).toBe(false)
  })

  it('restores only the given paths', async () => {
    const sha = await snapshot(root, { kind: 'turn' })
    write('a.txt', 'changed\n')
    write('b.txt', 'new\n')

    const result = await restore(root, sha, { paths: ['b.txt'] })

    expect(result).toMatchObject({ restored: [], deleted: ['b.txt'] })
    expect(read('a.txt')).toBe('changed\n')
    expect(existsSync(join(root, 'b.txt'))).toBe(false)
  })

  it('works from a subdirectory of the repository', async () => {
    write('sub/x.txt', 'x\n')
    const sha = await snapshot(join(root, 'sub'), { kind: 'turn' })
    write('sub/x.txt', 'y\n')
    expect((await changes(join(root, 'sub'), sha)).map((c) => c.path)).toEqual(['sub/x.txt'])
    await restore(join(root, 'sub'), sha)
    expect(read('sub/x.txt')).toBe('x\n')
  })

  it('prunes all but the newest `keep`', async () => {
    for (const prompt of ['1', '2', '3', '4']) {
      await snapshot(root, { kind: 'turn', prompt })
    }
    await prune(root, 2)
    expect((await list(root)).map((c) => c.prompt)).toEqual(['4', '3'])
  })
})
