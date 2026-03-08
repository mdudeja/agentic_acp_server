import { spawn, type Subprocess } from 'bun'
import { createId } from '@paralleldrive/cuid2'
import { unlinkSync } from 'node:fs'
import { join } from 'node:path'

// Workspace root relative to this file (tests/helpers/ → ../../)
const WORKSPACE_ROOT = join(import.meta.dir, '..', '..')

interface Waiter {
  method: string
  msgType: string
  resolve: (msg: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Spawns the full AgenticServer as a subprocess (rpc mode) backed by an
 * isolated temp SQLite DB. Buffers stdout ndJSON lines and lets tests await
 * specific response / notification messages by method + type.
 */
export class ServerHarness {
  private readonly _proc: Subprocess
  private readonly _dbPath: string
  private readonly _encoder = new TextEncoder()
  private readonly _decoder = new TextDecoder()

  private _buf = ''
  private _collected: unknown[] = []
  private _waiters: Waiter[] = []

  private constructor(proc: Subprocess, dbPath: string) {
    this._proc = proc
    this._dbPath = dbPath
    this._startReading()
  }

  /**
   * Spawn a fresh server instance backed by a throwaway SQLite DB.
   * The server auto-runs migrations on startup via AgenticDB.getDB().
   */
  static create(): ServerHarness {
    const dbPath = `/tmp/agentic-test-${createId()}.db`

    const proc = spawn({
      cmd: ['bun', 'run', 'index.ts'],
      cwd: WORKSPACE_ROOT,
      env: {
        ...process.env,
        APP_MODE: 'rpc',
        DB_FILE_URL: dbPath,
        LOG_LEVEL: 'error',
        LOG_TRAFFIC: 'false',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    return new ServerHarness(proc, dbPath)
  }

  /**
   * Write a JSON-RPC payload to the server's stdin.
   */
  send(payload: object): void {
    const line = JSON.stringify(payload) + '\n'
    ;(this._proc.stdin as import('bun').FileSink).write(
      this._encoder.encode(line),
    )
  }

  /**
   * Wait for the next message matching `method` + `type` on stdout.
   * - type `'response'` = `respond()` output  (has `.result` / `.error`)
   * - type `'notification'` = `notify()` output (has `.data`)
   * Already-buffered messages are checked first (FIFO).
   */
  waitFor(
    method: string,
    msgType: 'response' | 'notification',
    timeoutMs = 10_000,
  ): Promise<unknown> {
    const existing = this._collected.findIndex(
      (m: any) => m.method === method && m.type === msgType,
    )
    if (existing !== -1) {
      const [msg] = this._collected.splice(existing, 1)
      return Promise.resolve(msg)
    }

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._waiters.findIndex((w) => w.timer === timer)
        if (idx !== -1) this._waiters.splice(idx, 1)
        reject(
          new Error(
            `ServerHarness timed out waiting for ${msgType}:${method} after ${timeoutMs}ms`,
          ),
        )
      }, timeoutMs)

      this._waiters.push({ method, msgType, resolve, reject, timer })
    })
  }

  /**
   * Kill the server process and delete the temp DB file.
   */
  dispose(): void {
    try {
      this._proc.kill('SIGTERM')
    } catch {
      // already dead
    }
    try {
      unlinkSync(this._dbPath)
    } catch {
      // already removed
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private _startReading(): void {
    const stdout = this._proc.stdout as ReadableStream<Uint8Array>
    ;(async () => {
      const reader = stdout.getReader()
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (!value) continue

          this._buf += this._decoder.decode(value, { stream: true })

          let nl: number
          while ((nl = this._buf.indexOf('\n')) !== -1) {
            const line = this._buf.slice(0, nl).trim()
            this._buf = this._buf.slice(nl + 1)
            if (!line) continue

            let msg: unknown
            try {
              msg = JSON.parse(line)
            } catch {
              continue
            }

            this._dispatch(msg)
          }
        }
      } finally {
        reader.releaseLock()
      }
    })()
  }

  private _dispatch(msg: unknown): void {
    const m = msg as any
    const idx = this._waiters.findIndex(
      (w) => w.method === m.method && w.msgType === m.type,
    )

    if (idx !== -1) {
      const waiter = this._waiters.splice(idx, 1)[0]!
      clearTimeout(waiter.timer)
      waiter.resolve(msg)
    } else {
      this._collected.push(msg)
    }
  }
}
