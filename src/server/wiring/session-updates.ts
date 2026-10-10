import type { SessionUpdate } from '@agentclientprotocol/sdk'
import type { AgentManager } from 'src/managers/AgentManager'
import type { SessionManager } from 'src/managers/SessionManager'
import type { WiringDeps } from 'src/server/context'
import { logDebug } from 'src/utils/logger'

type SessionUpdateDeps = Pick<WiringDeps, 'comms' | 'state'> & {
  /** The SessionManager singleton, read at event time. */
  sessions: () => SessionManager | null
}

// Updates that are only forwarded to the editor. Updates for every tracked
// session are forwarded (not just the active one): `session/load` replays
// history while the previous session is still the active mirror.
const FORWARD_ONLY = [
  'plan',
  'plan_update',
  'plan_removed',
  'usage_update',
  'agent_thought_chunk',
  'agent_message_chunk',
  'user_message_chunk',
  'tool_call',
  'tool_call_update',
  'compaction_update',
  'compaction_summary_chunk',
] as const

/**
 * Subscribes to the agent's `session/update` fan-out: applies agent-side
 * changes (mode, config options, title, commands) to the tracked session and
 * forwards every update for a tracked session to the editor as
 * `agentic/session_update`. Call once per `AgentManager` instance.
 */
export function wireSessionUpdates(
  agentManager: AgentManager,
  { comms, state, sessions }: SessionUpdateDeps,
) {
  const sessionUpdateHandler = agentManager.getSessionUpdateHandler()

  /**
   * Translates the ACP session id carried by `session/update` notifications
   * into the local session id the editor knows. Returns `undefined` (and the
   * update is dropped) for sessions this server does not track.
   */
  const localSessionId = (acpSessionId: string): string | undefined => {
    const localId = sessions()?.resolveLocalSessionId(acpSessionId)

    if (!localId) {
      logDebug(
        `Dropping session update for unknown ACP session ${acpSessionId}`,
      )
    }

    return localId
  }

  /** Propagates the given session update to ensure the session reflects the latest changes. */
  const forward = (sessionId: string, update: SessionUpdate) => {
    comms.notify({
      method: 'agentic/session_update',
      data: {
        sessionId,
        updateType: update.sessionUpdate,
        update,
      },
    })
  }

  for (const updateType of FORWARD_ONLY) {
    sessionUpdateHandler.on(updateType, async (acpSessionId, update) => {
      const sessionId = localSessionId(acpSessionId)

      if (sessionId) {
        forward(sessionId, update)
      }
    })
  }

  sessionUpdateHandler.on(
    'available_commands_update',
    async (acpSessionId, update) => {
      const sessionId = localSessionId(acpSessionId)

      if (!sessionId) {
        return
      }

      state.setItem('availableCommands', {
        ...state.getItem('availableCommands'),
        [sessionId]: update.availableCommands,
      })

      forward(sessionId, update)
    },
  )

  sessionUpdateHandler.on(
    'config_option_update',
    async (acpSessionId, update) => {
      const sessionId = localSessionId(acpSessionId)

      if (!sessionId) {
        return
      }

      // Keep the tracked session (and DB) in sync with the agent's change.
      await sessions()?.applyAgentUpdate(sessionId, {
        type: 'config_option_update',
        configOptions: update.configOptions,
      })

      forward(sessionId, update)
    },
  )

  sessionUpdateHandler.on(
    'current_mode_update',
    async (acpSessionId, update) => {
      const sessionId = localSessionId(acpSessionId)

      if (!sessionId) {
        return
      }

      await sessions()?.applyAgentUpdate(sessionId, {
        type: 'current_mode_update',
        currentModeId: update.currentModeId,
      })

      forward(sessionId, update)
    },
  )

  sessionUpdateHandler.on(
    'session_info_update',
    async (acpSessionId, update) => {
      const sessionId = localSessionId(acpSessionId)

      if (!sessionId) {
        return
      }

      // Persist title changes on the tracked session (map, DB and, if it is
      // active, the state mirror).
      if (typeof update.title === 'string') {
        await sessions()?.applyAgentUpdate(sessionId, {
          type: 'session_info_update',
          title: update.title,
        })
      }

      forward(sessionId, update)
    },
  )
}
