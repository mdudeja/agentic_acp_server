import * as acp from '@agentclientprotocol/sdk'
import type { AgenticServer } from 'main'
import { logError } from 'src/utils/logger'

export class SessionUpdateHandler {
  private listeners: Map<
    acp.SessionUpdate['sessionUpdate'],
    Set<(sessionId: string, update: any) => Promise<void>>
  > = new Map()

  constructor(private readonly server_instance: AgenticServer) {}

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
