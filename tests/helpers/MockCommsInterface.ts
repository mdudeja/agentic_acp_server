import type {
  ICommsInterface,
  NotifyParams,
} from 'src/comms/ICommsInterface'
import type { RespondParams, QuestionNotificationParams } from 'src/openrpc/schemas'

type MessageCallback = (message: string) => Promise<void>
type CloseCallback = () => void

interface PendingWaiter {
  resolve: (msg: object) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class MockCommsInterface implements ICommsInterface {
  /** All outgoing messages (respond + notify) captured in order. */
  readonly outbox: object[] = []

  private _onMessageCallback: MessageCallback | null = null
  private _onCloseCallback: CloseCallback | null = null

  /** Pending waiters keyed by "respond:<id>" or "notify:<method>" */
  private _waiters = new Map<string, PendingWaiter[]>()

  // -------------------------------------------------------------------------
  // ICommsInterface implementation
  // -------------------------------------------------------------------------

  async init(_port?: number): Promise<void> {
    // No-op — MockCommsInterface is synchronous / in-process
  }

  onMessage(callback: MessageCallback): void {
    this._onMessageCallback = callback
  }

  onClose(callback: CloseCallback): void {
    this._onCloseCallback = callback
  }

  respond(params: RespondParams): void {
    this.outbox.push(params)
    this._resolveWaiters(`respond:${params.id}`, params)
    this._resolveWaiters('respond:*', params)
  }

  notify(params: NotifyParams): void {
    this.outbox.push(params)
    this._resolveWaiters(`notify:${params.method}`, params)
    this._resolveWaiters('notify:*', params)
  }

  question(_params: QuestionNotificationParams['data']): Promise<string> {
    throw new Error('MockCommsInterface.question() is not implemented')
  }

  dispose(): void {
    this._onCloseCallback?.()
    // Reject all remaining waiters
    for (const waiters of this._waiters.values()) {
      for (const w of waiters) {
        clearTimeout(w.timer)
        w.reject(new Error('MockCommsInterface disposed'))
      }
    }
    this._waiters.clear()
  }

  // -------------------------------------------------------------------------
  // Test helpers
  // -------------------------------------------------------------------------

  /**
   * Simulate an incoming message from the plugin (as if it arrived over the
   * real comms channel). Triggers the registered onMessage callback.
   */
  async inject(rawJson: string): Promise<void> {
    if (!this._onMessageCallback) {
      throw new Error(
        'MockCommsInterface.inject() called before onMessage() was registered',
      )
    }
    await this._onMessageCallback(rawJson)
  }

  /**
   * Wait for the next outgoing `respond()` call matching the given request id.
   * Pass `'*'` to match any response.
   */
  waitForResponse(id: string | '*', timeoutMs = 5000): Promise<RespondParams> {
    return this._waitFor(`respond:${id}`, timeoutMs) as Promise<RespondParams>
  }

  /**
   * Wait for the next outgoing `notify()` call matching the given method.
   * Pass `'*'` to match any notification.
   */
  waitForNotification(
    method: string | '*',
    timeoutMs = 5000,
  ): Promise<NotifyParams> {
    return this._waitFor(`notify:${method}`, timeoutMs) as Promise<NotifyParams>
  }

  /** Simulate the plugin closing the connection. */
  simulateClose(): void {
    this._onCloseCallback?.()
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private _waitFor(key: string, timeoutMs: number): Promise<object> {
    return new Promise<object>((resolve, reject) => {
      const timer = setTimeout(() => {
        const bucket = this._waiters.get(key)
        if (bucket) {
          const idx = bucket.findIndex((w) => w.timer === timer)
          if (idx !== -1) bucket.splice(idx, 1)
        }
        reject(new Error(`MockCommsInterface: timed out waiting for "${key}"`))
      }, timeoutMs)

      const waiter: PendingWaiter = { resolve, reject, timer }
      const bucket = this._waiters.get(key) ?? []
      bucket.push(waiter)
      this._waiters.set(key, bucket)
    })
  }

  private _resolveWaiters(key: string, value: object): void {
    const bucket = this._waiters.get(key)
    if (!bucket || bucket.length === 0) return
    // Resolve all waiters for this key (FIFO)
    const toResolve = bucket.splice(0)
    for (const w of toResolve) {
      clearTimeout(w.timer)
      w.resolve(value)
    }
  }
}
