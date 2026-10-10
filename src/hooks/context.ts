import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AGENTIC_DIR } from 'src/config/loader'
import { logDebug, logError, logInfo, logWarning } from 'src/utils/logger'
import { spawnShellCommand } from 'src/utils/shell'
import type { HookEventName } from './events'
import type { HookContext, HookExecResult, HookHost, HookStore } from './types'

/**
 * JSON key/value store for one hook, persisted at
 * `<workspace>/.agentic/hooks-state/<hook>.json`. Writes are serialised so
 * concurrent `set`s from parallel hook runs can't interleave.
 */
export class FileHookStore implements HookStore {
  private data: Record<string, unknown> | null = null
  private writing: Promise<void> = Promise.resolve()

  /** Initializes a new instance of FileHookStore with the specified file path. */
  constructor(private readonly filePath: string) {}

  /** Retrieves the hook store for the specified workspace and hook name. */
  static forHook(workspaceRoot: string, hook: string): FileHookStore {
    const safeName = hook.replace(/[^A-Za-z0-9._-]/g, '_')
    return new FileHookStore(
      join(workspaceRoot, AGENTIC_DIR, 'hooks-state', `${safeName}.json`),
    )
  }

  /** Load and return data asynchronously. */
  private async _load(): Promise<Record<string, unknown>> {
    if (this.data) return this.data

    try {
      const file = Bun.file(this.filePath)
      this.data = (await file.exists())
        ? ((await file.json()) as Record<string, unknown>)
        : {}
    } catch (error) {
      logWarning(`[hooks] Ignoring unreadable store ${this.filePath}: ${error}`)
      this.data = {}
    }

    return this.data
  }

  /** Persists the current state asynchronously. */
  private _persist(): Promise<void> {
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true })
      await Bun.write(this.filePath, JSON.stringify(this.data ?? {}, null, 2))
    })
    return this.writing
  }

  /** Retrieves the data associated with the specified key, returning the data if found or undefined if not. */
  async get<T = unknown>(key: string): Promise<T | undefined> {
    return (await this._load())[key] as T | undefined
  }

  /** Sets a key-value pair asynchronously. */
  async set(key: string, value: unknown): Promise<void> {
    ;(await this._load())[key] = value
    await this._persist()
  }

  /** Deletes the entry identified by the given key. */
  async delete(key: string): Promise<void> {
    delete (await this._load())[key]
    await this._persist()
  }
}

/** Runs a shell command for a hook, killing it on timeout or abort. */
export async function execForHook(
  command: string,
  opts: { cwd: string; timeoutMs: number; signal: AbortSignal },
): Promise<HookExecResult> {
  const proc = spawnShellCommand({
    command,
    args: [],
    cwd: opts.cwd,
    stdioOpts: ['ignore', 'pipe', 'pipe'],
  })

  /** Kills the current process. */
  const kill = () => proc.kill()
  const timer = setTimeout(kill, opts.timeoutMs)
  opts.signal.addEventListener('abort', kill, { once: true })

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ])
    return { exitCode, stdout, stderr }
  } finally {
    clearTimeout(timer)
    opts.signal.removeEventListener('abort', kill)
  }
}

/** Creates a context for hooks, initializing it with the provided arguments to establish the environment and configuration necessary for hook execution. */
export function createHookContext(args: {
  hook: string
  event: HookEventName
  host: HookHost
  options: Record<string, unknown>
  signal: AbortSignal
  store: HookStore
  defaultExecTimeoutMs: number
}): HookContext {
  const { hook, event, host, signal } = args
  const workspaceRoot = host.workspaceRoot()
  const prefix = `[hook ${hook}]`

  return {
    hook,
    event,
    workspaceRoot,
    provider: host.provider(),
    session: host.activeSession(),
    config: host.config(),
    options: args.options,
    signal,
    log: {
      debug: (message) => logDebug(`${prefix} ${message}`),
      info: (message) => logInfo(`${prefix} ${message}`),
      warn: (message) => logWarning(`${prefix} ${message}`),
      error: (message) => logError(`${prefix} ${message}`),
    },
    notify: (message, level = 'info') => host.notify(level, message),
    ask: (question, options = []) => host.ask(question, options, signal),
    exec: (command, opts = {}) =>
      execForHook(command, {
        cwd: opts.cwd ?? workspaceRoot,
        timeoutMs: opts.timeoutMs ?? args.defaultExecTimeoutMs,
        signal,
      }),
    cancelTurn: (sessionId) => host.cancelTurn(sessionId),
    store: args.store,
  }
}
