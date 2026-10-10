import type { ICommsInterface } from 'src/comms/ICommsInterface'
import type { HookManager } from 'src/hooks/HookManager'
import type { IndexerManager } from 'src/managers/IndexerManager'
import type { McpServerManager } from 'src/managers/McpServerManager'
import type { MiscActionsManager } from 'src/managers/MiscActionsManager'
import type { NesManager } from 'src/managers/NesManager'
import { notifyLog } from 'src/server/respond'
import { logError, logWarning } from 'src/utils/logger'

/** Announces hook decisions and failures to the editor as `agentic/hook`. */
export function wireHookEvents(
  hookManager: HookManager,
  comms: ICommsInterface,
) {
  hookManager.on('hook.decided', (payload) => {
    if (!payload) return
    comms.notify({
      method: 'agentic/hook',
      data: {
        hook: payload.hook,
        event: payload.event,
        outcome: payload.decision,
        reason: payload.reason,
      },
    })
  })

  hookManager.on('hook.error', (payload) => {
    if (!payload) return
    comms.notify({
      method: 'agentic/hook',
      data: {
        hook: payload.hook,
        event: payload.event,
        outcome: 'error',
        reason: payload.error,
      },
    })
  })
}

/** Establish connections to handle various action events, linking the MiscActionsManager with the communication interface. */
export function wireMiscActionEvents(
  miscActionsManager: MiscActionsManager,
  comms: ICommsInterface,
) {
  miscActionsManager.on('action.queued', (action) => {
    notifyLog(comms, 'info', `Misc Actions Manager: ${action?.data} queued`)
  })

  miscActionsManager.on('action.started', (action) => {
    notifyLog(comms, 'info', `Misc Actions Manager: ${action?.data} started`)
  })

  miscActionsManager.on('action.completed', (action) => {
    notifyLog(comms, 'info', `Misc Actions Manager: ${action?.data} completed`)
  })

  miscActionsManager.on('action.error', (errorMessage) => {
    logError(`Misc Actions Manager error: ${errorMessage}`)
    notifyLog(comms, 'error', `Misc Actions Manager error: ${errorMessage}`)
  })
}

/** Wire before `init()`: it can emit synchronously. */
export function wireMcpEvents(
  mcpServerManager: McpServerManager,
  comms: ICommsInterface,
) {
  mcpServerManager.on('mcpservermanager.error', (errorMessage) => {
    logError(`McpServerManager error: ${errorMessage}`)
    notifyLog(comms, 'error', `McpServerManager error: ${errorMessage}`)
  })
}

/** Wire before `init()`: it emits `indexer.ready` synchronously. */
export function wireIndexerEvents(
  indexerManager: IndexerManager,
  comms: ICommsInterface,
) {
  indexerManager.on('indexer.error', (errorMessage) => {
    logError(`IndexerError: ${errorMessage}`)
    notifyLog(comms, 'error', `Indexer error: ${errorMessage}`)
  })

  indexerManager.on('indexer.indexing', (payload) => {
    notifyLog(comms, 'info', `Indexing started: ${payload?.data}`)
  })

  indexerManager.on('indexer.ready', (payload) => {
    notifyLog(comms, 'info', `Indexing MCP is ready ${payload?.data}`)
    logWarning('Server setup complete. Awaiting commands...')
  })
}

/** Connects event handling between NesManager and the communication system, enabling proper event processing and notifications. */
export function wireNesEvents(nesManager: NesManager, comms: ICommsInterface) {
  nesManager.on('nes.error', (errorMessage) => {
    logError(`NES error: ${errorMessage}`)
    notifyLog(comms, 'error', `NES error: ${errorMessage}`)
  })

  nesManager.on('nes.started', (payload) => {
    notifyLog(comms, 'info', `NES session started with ID ${payload?.data}`)
  })

  nesManager.on('nes.closed', (payload) => {
    notifyLog(comms, 'info', `NES session closed with ID ${payload?.data}`)
  })
}
