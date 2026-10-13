import { spawn } from 'bun'
import { randomUUID } from 'node:crypto'
import { readdirSync, rmdirSync, rmSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path'

/** Where checkpoints are recorded (one reflog entry each). */
export const CHECKPOINT_REF = 'refs/agentic/checkpoints'

/** The server's own state; never snapshotted, never restored. */
const EXCLUDE = ':(exclude,glob)**/.agentic/**'

export type CheckpointKind = 'turn' | 'restore'

export interface Checkpoint {
  sha: string
  sessionId: string | null
  kind: CheckpointKind
  /** First line of the prompt that started the turn (empty for backups). */
  prompt: string
  createdAt: string
}

export interface CheckpointChange {
  path: string
  status: 'added' | 'modified' | 'deleted'
  added: number
  removed: number
  binary: boolean
}

export interface RestoreResult {
  /** Checkpoint of the tree as it was just before the restore. */
  backup: string
  restored: string[]
  deleted: string[]
}

interface GitResult {
  exitCode: number
  stdout: Uint8Array
  stderr: string
}

// Checkpoints are internal commits: give them a fixed identity, so they
// work in repos without `user.name`, and never sign them.
const IDENTITY = {
  GIT_AUTHOR_NAME: 'agentic',
  GIT_AUTHOR_EMAIL: 'agentic@localhost',
  GIT_COMMITTER_NAME: 'agentic',
  GIT_COMMITTER_EMAIL: 'agentic@localhost',
}

/** Runs `git` (no shell) in `root`. */
async function git(
  root: string,
  args: string[],
  opts: { env?: Record<string, string>; stdin?: string } = {},
): Promise<GitResult> {
  const proc = spawn({
    cmd: ['git', '-c', 'core.quotepath=off', ...args],
    cwd: root,
    env: { ...process.env, ...opts.env },
    stdin: opts.stdin === undefined ? 'ignore' : new Blob([opts.stdin]),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).bytes(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, stdout, stderr }
}

/** Like `git`, but throws on failure and returns trimmed stdout text. */
async function gitText(
  root: string,
  args: string[],
  opts?: { env?: Record<string, string>; stdin?: string },
): Promise<string> {
  const result = await git(root, args, opts)
  if (result.exitCode !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`)
  }
  return new TextDecoder().decode(result.stdout).trim()
}

/**
 * The repository's top level. Checkpoints cover the whole repository, and
 * every path they report is relative to it.
 */
export async function toplevel(root: string): Promise<string> {
  return gitText(root, ['rev-parse', '--show-toplevel'])
}

async function headSha(root: string): Promise<string | null> {
  const result = await git(root, ['rev-parse', '--verify', '-q', 'HEAD'])
  return result.exitCode === 0
    ? new TextDecoder().decode(result.stdout).trim()
    : null
}

/**
 * Runs `fn` with a throwaway index, so the real index (what the user has
 * staged) is never touched.
 */
async function withTempIndex<T>(
  root: string,
  fn: (env: Record<string, string>) => Promise<T>,
): Promise<T> {
  const rel = await gitText(root, [
    'rev-parse',
    '--git-path',
    `agentic-index-${randomUUID()}`,
  ])
  const path = resolve(root, rel)
  try {
    return await fn({ GIT_INDEX_FILE: path })
  } finally {
    rmSync(path, { force: true })
  }
}

/**
 * The tree id of the working tree as it is now: tracked files plus
 * untracked ones that aren't ignored (`.agentic/` excepted).
 */
export async function worktreeTree(root: string): Promise<string> {
  root = await toplevel(root)
  const head = await headSha(root)
  return withTempIndex(root, async (env) => {
    if (head) {
      await gitText(root, ['read-tree', head], { env })
    }
    await gitText(root, ['add', '-A', '--', '.', EXCLUDE], { env })
    return gitText(root, ['write-tree'], { env })
  })
}

/**
 * Records the working tree as a checkpoint without touching the tree, the
 * index or the stash list. Clean trees are recorded too, so every turn is
 * a rollback target.
 */
export async function snapshot(
  root: string,
  meta: { sessionId?: string; kind: CheckpointKind; prompt?: string },
): Promise<string> {
  root = await toplevel(root)
  const tree = await worktreeTree(root)
  const head = await headSha(root)
  const title =
    (meta.prompt ?? '').split('\n').find((line) => line.trim())?.trim() ?? ''
  const message = [
    (title || `agentic ${meta.kind} checkpoint`).slice(0, 72),
    '',
    `Agentic-Session: ${meta.sessionId ?? ''}`,
    `Agentic-Kind: ${meta.kind}`,
    `Agentic-Created: ${new Date().toISOString()}`,
    '',
  ].join('\n')

  const sha = await gitText(
    root,
    [
      'commit-tree',
      '--no-gpg-sign',
      tree,
      ...(head ? ['-p', head] : []),
      '-F',
      '-',
    ],
    { env: IDENTITY, stdin: message },
  )
  await gitText(root, [
    'update-ref',
    '--create-reflog',
    '-m',
    `agentic checkpoint (${meta.kind})`,
    CHECKPOINT_REF,
    sha,
  ])
  return sha
}

/** Parses a checkpoint commit message (see `snapshot`). */
function parse(sha: string, body: string): Checkpoint | null {
  const trailer = (name: string) =>
    body.match(new RegExp(`^${name}: ?(.*)$`, 'm'))?.[1]?.trim()
  const kind = trailer('Agentic-Kind')
  if (kind !== 'turn' && kind !== 'restore') {
    return null
  }
  const first = body.split('\n')[0] ?? ''
  return {
    sha,
    sessionId: trailer('Agentic-Session') || null,
    kind,
    prompt: first === `agentic ${kind} checkpoint` ? '' : first,
    createdAt: trailer('Agentic-Created') ?? '',
  }
}

/** Checkpoints, newest first, optionally only one session's. */
export async function list(
  root: string,
  opts: { sessionId?: string; limit?: number } = {},
): Promise<Checkpoint[]> {
  root = await toplevel(root)
  const result = await git(root, [
    'log',
    '-g',
    '--format=%H%x00%B%x1e',
    CHECKPOINT_REF,
  ])
  if (result.exitCode !== 0) {
    // No checkpoint recorded yet.
    return []
  }

  const seen = new Set<string>()
  const checkpoints: Checkpoint[] = []
  for (const record of new TextDecoder().decode(result.stdout).split('\x1e')) {
    const [sha, body] = record.replace(/^\n+/, '').split('\0')
    if (!sha || body === undefined || seen.has(sha)) {
      continue
    }
    seen.add(sha)
    const checkpoint = parse(sha, body)
    if (!checkpoint) {
      continue
    }
    if (opts.sessionId && checkpoint.sessionId !== opts.sessionId) {
      continue
    }
    checkpoints.push(checkpoint)
    if (opts.limit && checkpoints.length >= opts.limit) {
      break
    }
  }
  return checkpoints
}

/** Fails unless `sha` is a recorded checkpoint. */
async function assertCheckpoint(root: string, sha: string) {
  if (!/^[0-9a-f]{4,64}$/i.test(sha)) {
    throw new Error(`Not a checkpoint: ${sha}`)
  }
  const resolved = await git(root, ['rev-parse', '--verify', '-q', `${sha}^{commit}`])
  const full = new TextDecoder().decode(resolved.stdout).trim()
  const known = await list(root)
  if (resolved.exitCode !== 0 || !known.some((c) => c.sha === full)) {
    throw new Error(`Not a checkpoint: ${sha}`)
  }
  return full
}

/** Rejects paths that would escape the workspace. */
export function checkPaths(paths: string[]): string[] {
  return paths.map((path) => {
    const clean = normalize(path)
    if (
      !clean ||
      isAbsolute(clean) ||
      clean === '..' ||
      clean.startsWith(`..${sep}`)
    ) {
      throw new Error(`Path must be relative to the workspace: ${path}`)
    }
    return clean.split(sep).join('/')
  })
}

/** Splits NUL-separated git output. */
function fields(bytes: Uint8Array): string[] {
  return new TextDecoder().decode(bytes).split('\0')
}

/** Files that differ between checkpoint `sha` and `to` (default: the live tree). */
export async function changes(
  root: string,
  sha: string,
  opts: { paths?: string[]; to?: string } = {},
): Promise<CheckpointChange[]> {
  root = await toplevel(root)
  const from = await assertCheckpoint(root, sha)
  const to = opts.to ?? (await worktreeTree(root))
  const pathspec = ['--', ...(opts.paths ? checkPaths(opts.paths) : [])]

  const names = await git(root, [
    'diff',
    '--name-status',
    '-z',
    '--no-renames',
    from,
    to,
    ...pathspec,
  ])
  const stats = await git(root, [
    'diff',
    '--numstat',
    '-z',
    '--no-renames',
    from,
    to,
    ...pathspec,
  ])
  if (names.exitCode !== 0 || stats.exitCode !== 0) {
    throw new Error(`git diff failed: ${names.stderr || stats.stderr}`)
  }

  const counts = new Map<string, { added: number; removed: number; binary: boolean }>()
  for (const entry of fields(stats.stdout)) {
    const match = entry.match(/^(\d+|-)\t(\d+|-)\t([\s\S]+)$/)
    if (match) {
      const [, added, removed, path] = match as unknown as [string, string, string, string]
      counts.set(path, {
        added: added === '-' ? 0 : Number(added),
        removed: removed === '-' ? 0 : Number(removed),
        binary: added === '-',
      })
    }
  }

  const status = { A: 'added', D: 'deleted' } as const
  const parts = fields(names.stdout)
  const result: CheckpointChange[] = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const code = parts[i] as string
    const path = parts[i + 1] as string
    const count = counts.get(path) ?? { added: 0, removed: 0, binary: false }
    result.push({
      path,
      status: status[code as keyof typeof status] ?? 'modified',
      ...count,
    })
  }
  return result
}

/** A file's content at checkpoint `sha` (`null` when it didn't exist). */
export async function fileAt(
  root: string,
  sha: string,
  path: string,
): Promise<{ content: string | null; binary: boolean }> {
  root = await toplevel(root)
  const from = await assertCheckpoint(root, sha)
  const [clean] = checkPaths([path]) as [string]
  const shown = await git(root, ['show', `${from}:${clean}`])
  if (shown.exitCode !== 0) {
    return { content: null, binary: false }
  }
  const binary = shown.stdout.subarray(0, 8192).includes(0)
  return {
    content: binary ? null : new TextDecoder().decode(shown.stdout),
    binary,
  }
}

/** Removes `dir` and its empty parents, stopping at `root`. */
function removeEmptyDirs(root: string, dir: string) {
  let current = dir
  while (current.startsWith(root + sep) && current !== root) {
    try {
      if (readdirSync(current).length > 0) {
        return
      }
      rmdirSync(current)
    } catch {
      return
    }
    current = dirname(current)
  }
}

/**
 * Makes the working tree (or just `paths`) match checkpoint `sha`: files
 * that differ are rewritten, files created since are deleted. Unchanged
 * files and the real index are left alone. A `restore` checkpoint of the
 * tree as it was is recorded first, so the rollback can itself be undone.
 */
export async function restore(
  root: string,
  sha: string,
  opts: { paths?: string[]; sessionId?: string } = {},
): Promise<RestoreResult> {
  root = await toplevel(root)
  const from = await assertCheckpoint(root, sha)
  const backup = await snapshot(root, {
    sessionId: opts.sessionId,
    kind: 'restore',
  })
  const changed = await changes(root, from, {
    paths: opts.paths,
    // The backup is exactly the live tree.
    to: `${backup}^{tree}`,
  })

  const restored = changed
    .filter((c) => c.status !== 'added')
    .map((c) => c.path)
  const deleted = changed
    .filter((c) => c.status === 'added')
    .map((c) => c.path)

  if (restored.length > 0) {
    await withTempIndex(root, async (env) => {
      await gitText(root, ['read-tree', from], { env })
      await gitText(root, ['checkout-index', '-f', '-z', '--stdin'], {
        env,
        stdin: restored.join('\0'),
      })
    })
  }

  for (const path of deleted) {
    const absolute = join(root, path)
    rmSync(absolute, { force: true })
    removeEmptyDirs(resolve(root), dirname(resolve(absolute)))
  }

  return { backup, restored, deleted }
}

/** Deletes reflog entries beyond the newest `keep` (oldest first). */
export async function prune(root: string, keep: number) {
  root = await toplevel(root)
  const listed = await git(root, ['reflog', 'show', '--format=%H', CHECKPOINT_REF])
  if (listed.exitCode !== 0) {
    return
  }

  const count = new TextDecoder()
    .decode(listed.stdout)
    .split('\n')
    .filter(Boolean).length
  // Highest index first, so the remaining indexes don't shift.
  for (let index = count - 1; index >= Math.max(keep, 1); index -= 1) {
    await gitText(root, ['reflog', 'delete', `${CHECKPOINT_REF}@{${index}}`])
  }
}
