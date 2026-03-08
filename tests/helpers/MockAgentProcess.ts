/**
 * The shape of the ACP initialize response result that the agent returns.
 * Matches what @agentclientprotocol/sdk ClientSideConnection.initialize() expects.
 */
export interface MockInitResult {
  protocolVersion: number
  agentCapabilities: {
    loadSession?: boolean
    [key: string]: unknown
  }
  authMethods?: readonly unknown[]
  agentInfo?: { name: string; [key: string]: unknown }
}

/**
 * MockAgentProcess simulates an ACP agent process for unit tests.
 *
 * Design:
 *  - ClientSideConnection.initialize() writes an ndJSON request to agent stdin.
 *  - It then reads one ndJSON response from agent stdout, matching on `id`.
 *  - Only after initialize() resolves does the SDK route subsequent frames
 *    (sessionUpdate, requestPermission, …) to AcpClient handler methods.
 *
 * This mock:
 *  - Exposes `stdout` as a ReadableStream<Uint8Array> backed by a controller.
 *  - Exposes `stdin` as an object that intercepts writes, buffers the raw bytes,
 *    splits on newlines, and — upon seeing an `initialize` request — immediately
 *    pushes the matched response (with correct `id`) to the stdout controller.
 *  - `send(frame)` lets tests push arbitrary ndJSON frames to stdout at any time
 *    (useful for post-connect agent-initiated messages).
 *  - `kill()` / `close()` terminates the readable stream.
 *
 * Usage in tests:
 *   const mock = new MockAgentProcess({ protocolVersion: 1, agentCapabilities: {} })
 *   const am = new AgentManager(provider, cwd, server, () => mock as unknown as Subprocess)
 *   await am.init(); am.spawn(); await am.connect()
 */
export class MockAgentProcess {
  readonly stdout: ReadableStream<Uint8Array>
  readonly stdin: {
    write(data: Uint8Array | string): void
    end(): void
  }

  private _controller!: ReadableStreamDefaultController<Uint8Array>
  private _encoder = new TextEncoder()
  private _decoder = new TextDecoder()
  private _buf = ''
  private _closed = false
  private _initResult: MockInitResult

  constructor(initResult: MockInitResult) {
    this._initResult = initResult

    // stdout — the readable stream that ndJsonStream will consume
    this.stdout = new ReadableStream<Uint8Array>({
      start: (ctrl) => {
        this._controller = ctrl
      },
    })

    // stdin — intercepts bytes written by ndJsonStream's writable side
    this.stdin = {
      write: (data: Uint8Array | string) => {
        const text =
          typeof data === 'string'
            ? data
            : this._decoder.decode(data, { stream: true })
        this._buf += text

        let nl: number
        while ((nl = this._buf.indexOf('\n')) !== -1) {
          const line = this._buf.slice(0, nl).trim()
          this._buf = this._buf.slice(nl + 1)
          if (line) this._handleFrame(line)
        }
      },
      end: () => {
        this.close()
      },
    }
  }

  // ---------------------------------------------------------------------------
  // Test helpers
  // ---------------------------------------------------------------------------

  /**
   * Push an arbitrary ndJSON frame to stdout.
   * Call this after `connect()` returns to simulate agent-initiated messages.
   */
  send(frame: object): void {
    this._push(frame)
  }

  /** Terminate the stdout stream (simulates agent process exit). */
  close(): void {
    if (this._closed) return
    this._closed = true
    try {
      this._controller.close()
    } catch {
      // already closed — ignore
    }
  }

  /** Bun Subprocess-compatible kill method. */
  kill(_signal?: string | number): void {
    this.close()
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private _handleFrame(line: string): void {
    let frame: { id?: unknown; method?: string; params?: unknown }
    try {
      frame = JSON.parse(line)
    } catch {
      return
    }

    if (frame.method === 'initialize') {
      // Echo the id back so ClientSideConnection.initialize() can match it
      this._push({
        jsonrpc: '2.0',
        id: frame.id,
        result: this._initResult,
      })
    }
    // Other methods (newSession, loadSession, etc.) are not auto-handled here;
    // tests can stage responses manually via send().
  }

  private _push(frame: object): void {
    if (this._closed) return
    this._controller.enqueue(this._encoder.encode(JSON.stringify(frame) + '\n'))
  }
}
