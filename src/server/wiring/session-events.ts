import type { SessionManager } from 'src/managers/SessionManager'
import type { WiringDeps } from 'src/server/context'
import { notifyLog } from 'src/server/respond'
import type { TrackedSession } from 'src/state/types'
import { logDebug, logError } from 'src/utils/logger'

/**
 * Registers the session event handlers: keeps the active-session mirror in
 * `AppState` current, tells the editor, and raises the session lifecycle
 * hooks. Call once, when the SessionManager singleton is created.
 */
export function wireSessionEvents(
  sessionManager: SessionManager,
  { comms, state, runHooks }: WiringDeps,
) {
  sessionManager.on('session.error', (errorMessage) => {
    logError(`Session error: ${errorMessage}`)
    notifyLog(comms, 'error', `Session error: ${errorMessage}`)
  })

  sessionManager.on('session.created', (session) => {
    if (!session || !session.data) {
      logError('Created event received without session data')
      notifyLog(
        comms,
        'error',
        'Failed to create session: Failed to create session',
      )
      return
    }

    logDebug(`Session created with ID ${session.data.id}`)
    state.setItem('session', session.data)
  })

  sessionManager.on('session.loaded', (session) => {
    if (!session || !session.data) {
      logError('Loaded event received without session data')
      notifyLog(
        comms,
        'error',
        'Failed to load session: Failed to load session',
      )
      return
    }

    logDebug(`Session loaded with ID ${session.data.id}`)
    state.setItem('session', session.data)
    notifyLog(
      comms,
      'info',
      `Session loaded with ID ${session.data.id} and name ${session.data.name}`,
    )
  })

  sessionManager.on('session.updated', (session) => {
    if (!session || !session.data) {
      logError('Updated event received without session data')
      return
    }

    logDebug(`Session with ID ${session.data.id} updated`)
    state.setItem('session', session.data)
    notifyLog(comms, 'info', `Session with ID ${session.data.id} updated`)
  })

  sessionManager.on('session.deleted', (sessionId) => {
    if (!sessionId || !sessionId.data) {
      logError('Deleted event received without session ID')
      return
    }

    logDebug(`Session with ID ${sessionId.data} deleted`)
    const currentSession = state.getItem('session')
    if (currentSession && currentSession.id === sessionId.data) {
      state.deleteItem('session')
    }
    notifyLog(comms, 'info', `Session with ID ${sessionId.data} deleted`)
  })

  sessionManager.on('session.completed', (session) => {
    if (!session || !session.data) {
      logError('Completed event received without session data')
      return
    }

    logDebug(`Session with ID ${session.data.id} completed`)
    state.setItem('session', session.data)
    notifyLog(comms, 'info', `Session with ID ${session.data.id} completed`)
  })

  sessionManager.on('session.suspended', (session) => {
    if (!session || !session.data) {
      logError('Suspended event received without session data')
      return
    }

    logDebug(`Session with ID ${session.data.id} suspended`)
    state.setItem('session', session.data)
    notifyLog(comms, 'info', `Session with ID ${session.data.id} suspended`)
  })

  sessionManager.on('session.turnActive', (session) => {
    if (!session || !session.data) {
      logError('TurnActive event received without session data')
      return
    }

    state.setItem('promptActive', session.data.active)
  })

  // Session lifecycle hooks (observe-only; never block the session flow).
  // Registered after the state updates above, so hooks see the new mirror.
  const sessionInfo = (session: TrackedSession) => ({
    sessionId: session.id,
    acpSessionId: session.acp_session_id,
    name: session.name ?? null,
  })
  sessionManager.on('session.created', (session) => {
    if (session?.data) {
      void runHooks('session.created', sessionInfo(session.data))
    }
  })
  sessionManager.on('session.loaded', (session) => {
    if (session?.data) {
      void runHooks('session.loaded', sessionInfo(session.data))
    }
  })
  sessionManager.on('session.suspended', (session) => {
    if (session?.data) {
      void runHooks('session.suspended', sessionInfo(session.data))
    }
  })
  sessionManager.on('session.deleted', (session) => {
    if (session?.data) {
      void runHooks('session.deleted', { sessionId: session.data })
    }
  })
}
