import type { AgentManager } from 'src/managers/AgentManager'
import type { WiringDeps } from 'src/server/context'
import { notifyLog } from 'src/server/respond'
import { logDebug, logError } from 'src/utils/logger'

/**
 * Registers the agent event handlers. Call once per `AgentManager` instance
 * (listeners live on the instance, so re-registering on a reused manager
 * would fire every event N times).
 */
export function wireAgentEvents(
  agentManager: AgentManager,
  { comms, state, runHooks }: WiringDeps,
) {
  agentManager.on('agent.error', (errorMessage) => {
    logError(`Agent error: ${errorMessage}`)
    notifyLog(comms, 'error', `Agent error: ${errorMessage}`)
  })

  agentManager.on('agent.loaded', (agent) => {
    if (!agent || !agent.data) {
      logError('Loaded event received without agent data')
      notifyLog(comms, 'error', 'Failed to load agent: Failed to load agent')
      return
    }

    logDebug(`Agent loaded with ID ${agent.data.id}`)
    state.setItem('agent', agent.data)
  })

  agentManager.on('agent.spawned', (agent) => {
    if (!agent || !agent.data) {
      logError('Spawned event received without agent data')
      notifyLog(comms, 'error', 'Failed to spawn agent: Failed to spawn agent')
      return
    }

    logDebug(`Agent spawned with ID ${agent.data.id}`)
    state.setItem('agent', agent.data)
    notifyLog(comms, 'info', `Agent spawned with ID ${agent.data.id}`)
  })

  agentManager.on('agent.connected', (agent) => {
    if (!agent || !agent.data) {
      logError('Connected event received without agent data')
      notifyLog(comms, 'error', 'Failed to connect agent: Missing agent data')
      return
    }

    logDebug(`Agent with ID ${agent.data.id} connected`)
    state.setItem('agent', agent.data)
  })

  agentManager.on('agent.disconnected', (agent) => {
    const agentId = agent?.data?.id ?? 'unknown'
    const message = `Agent ${agentId} exited unexpectedly (code ${agent?.exitCode ?? 'unknown'}). Run client/init to restart it.`

    state.deleteItem('connection')
    state.setItem('promptActive', false)
    notifyLog(comms, 'error', message)

    if (agent?.data) {
      void runHooks('agent.exited', {
        provider: agent.data.provider_name,
        agentId: agent.data.id,
        exitCode: agent.exitCode,
      })
    }
  })

  agentManager.on('agent.updated', (agent) => {
    if (!agent || !agent.data) {
      logError('Updated event received without agent data')
      return
    }

    logDebug(`Agent with ID ${agent.data.id} updated`)
    state.setItem('agent', agent.data)
    notifyLog(comms, 'info', `Agent with ID ${agent.data.id} updated`)
  })

  agentManager.on('agent.killed', (agent) => {
    if (!agent || !agent.data) {
      logError('Killed event received without agent data')
      return
    }

    notifyLog(comms, 'info', `Agent with ID ${agent.data.id} was killed`)
    logDebug(`Agent with ID ${agent.data.id} was killed`)
    state.deleteItem('agent')
    state.deleteItem('connection')
  })
}
