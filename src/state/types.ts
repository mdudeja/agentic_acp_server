import type {
  AvailableCommand,
  ClientContext,
  InitializeResponse,
} from '@agentclientprotocol/sdk'
import type { Subprocess } from 'bun'
import type { AcpClient } from 'src/acp/Client'
import type { AgenticConfig } from 'src/config/schemas'
import type { Agent, Session } from 'src/database/schemas'

/**
 * A session as tracked by the server.
 *
 * This is the in-memory representation used by `SessionManager` and exposed via
 * `AppState.session` for the *active* session. It pairs the persisted DB row
 * (`Session['Select']`) with the runtime ACP metadata the agent reported at
 * session creation / load time (modes + config options).
 *
 * It intentionally does **not** hold an `ActiveSession` handle. Prompting and
 * session updates go through the connection's `ClientContext` (via `request`/
 * `notify`), so the same representation works whether the session was created
 * fresh, loaded, forked, or resumed.
 */
export type TrackedSession = Session['Select']

export type AppState = {
  workspaceRoot?: string
  config?: AgenticConfig
  agent?:
    | (Agent['Select'] & {
        process?: Subprocess
      })
    | null
  /** The currently active session (if any). */
  session?: TrackedSession | null
  connection?: {
    clientContext: ClientContext
    client: AcpClient
    initResponse: InitializeResponse
  }
  promptActive?: boolean
  availableCommands?: {
    [sessionId: string]: AvailableCommand[]
  }
}

export interface IStateManager {
  setItem(key: keyof AppState, value: any): void
  updateItem(key: keyof AppState, value: any): void
  deleteItem(key: keyof AppState): void
  getItem(key: keyof AppState): any
  getState(): AppState
}

export type NestedKeyOf<T, Prefix extends string = ''> = {
  [K in keyof T & string]: NonNullable<T[K]> extends object
    ? NestedKeyOf<NonNullable<T[K]>, `${Prefix}${K}.`> | `${Prefix}${K}`
    : `${Prefix}${K}`
}[keyof T & string]
