import * as acp from '@agentclientprotocol/sdk'
import type { AgenticServer } from 'src/AgenticServer'
import { logError } from 'src/utils/logger'

export class SessionUpdateHandler {
  private listeners: Map<
    acp.SessionUpdate['sessionUpdate'],
    Set<(sessionId: string, update: any) => Promise<void>>
  > = new Map()

  /**
   * `session/update` notifications seen on the wire vs. fully handled. The
   * SDK resolves a request as soon as its response is read, but delivers
   * earlier notifications through several async hops, so a response can
   * overtake the updates that preceded it. `whenDrained()` closes that gap.
   */
  private received = 0
  private handled = 0
  private drainWaiters: Array<{ target: number; resolve: () => void }> = []

  constructor(private readonly server_instance: AgenticServer) {}

  /** Called by the connection's receive tap for each `session/update`. */
  noteReceived() {
    this.received += 1
  }

  /**
   * Resolves once every `session/update` received so far has been handled
   * by all listeners, or after `timeoutMs` (so a dropped notification can
   * never hang the caller).
   */
  whenDrained(timeoutMs: number = 2000): Promise<void> {
    const target = this.received

    if (this.handled >= target) {
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      const timer = setTimeout(done, timeoutMs)
      const waiter = { target, resolve: done }
      this.drainWaiters.push(waiter)

      function done() {
        clearTimeout(timer)
        resolve()
      }
    })
  }

  private _markHandled() {
    this.handled += 1
    this.drainWaiters = this.drainWaiters.filter((waiter) => {
      if (this.handled >= waiter.target) {
        waiter.resolve()
        return false
      }
      return true
    })
  }

  on<K extends acp.SessionUpdate['sessionUpdate']>(
    event: K,
    listener: (
      sessionId: string,
      update: acp.SessionUpdate & { sessionUpdate: K },
    ) => Promise<void>,
  ) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }

    this.listeners.get(event)!.add(listener)
  }

  off<K extends acp.SessionUpdate['sessionUpdate']>(
    event: K,
    listener: (
      sessionId: string,
      update: acp.SessionUpdate & { sessionUpdate: K },
    ) => Promise<void>,
  ) {
    this.listeners.get(event)?.delete(listener)
  }

  async handleUpdate<K extends acp.SessionUpdate['sessionUpdate']>(
    sessionId: string,
    update: acp.SessionUpdate & { sessionUpdate: K },
  ) {
    try {
      await this._dispatch(sessionId, update)
    } finally {
      this._markHandled()
    }
  }

  private async _dispatch(sessionId: string, update: acp.SessionUpdate) {
    const listeners = this.listeners.get(update.sessionUpdate)

    if (!listeners) {
      return
    }

    for (const listener of listeners) {
      try {
        await listener(sessionId, update)
      } catch (error) {
        logError(
          `Error in session update listener for sessionId: ${sessionId}, event ${update.sessionUpdate}:`,
          error,
        )
        this.server_instance.getCommsInterface().notify({
          method: 'agentic/log',
          data: {
            level: 'error',
            message: `Error in session update listener for sessionId: ${sessionId}, event ${update.sessionUpdate}: ${error instanceof Error ? error.message : String(error)}`,
          },
        })
      }
    }
  }
}
