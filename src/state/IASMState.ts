import type {
  AvailableCommand,
  ClientSideConnection,
  InitializeResponse,
  SessionConfigOption,
  SessionModelState,
  SessionModeState,
} from '@agentclientprotocol/sdk'
import type { Subprocess } from 'bun'
import type { AcpClient } from 'src/acp/Client'
import type { AgenticConfig } from 'src/config/schemas'
import type { Agent, Session } from 'src/database/schemas'

export type ASMState = {
  workspaceRoot?: string
  config?: AgenticConfig
  agent?: Agent['Select'] & {
    process?: Subprocess
  }
  session?: Session['Select'] & {
    configOptions?: SessionConfigOption[]
    models?: SessionModelState
    modes?: SessionModeState
  }
  connection?: {
    csc: ClientSideConnection
    client: AcpClient
    initResponse: InitializeResponse
  }
  promptActive?: boolean
  availableCommands?: {
    [sessionId: string]: AvailableCommand[]
  }
}

export interface IASMState {
  setItem(key: keyof ASMState, value: any): void
  updateItem(key: keyof ASMState, value: any): void
  deleteItem(key: keyof ASMState): void
  getItem(key: keyof ASMState): any
  getState(): ASMState
}
