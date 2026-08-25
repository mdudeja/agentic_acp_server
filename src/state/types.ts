import type {
  ActiveSession,
  AvailableCommand,
  ClientContext,
  InitializeResponse,
} from '@agentclientprotocol/sdk'
import type { Subprocess } from 'bun'
import type { AcpClient } from 'src/acp/Client'
import type { AgenticConfig } from 'src/config/schemas'
import type { Agent, Session } from 'src/database/schemas'

export type AppState = {
  workspaceRoot?: string
  config?: AgenticConfig
  agent?:
    | (Agent['Select'] & {
        process?: Subprocess
      })
    | null
  session?: Session['Select'] & {
    sessionRef?: ActiveSession
  }
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
