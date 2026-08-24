import type {
  NewSessionResponse,
  PromptResponse,
} from '@agentclientprotocol/sdk'
import type { AppState } from 'src/state/types'

type TypeWithRequestId<T> = { requestId?: string; data: T }

export type AgentEvents = {
  'agent.created': TypeWithRequestId<AppState['agent']>
  'agent.loaded': TypeWithRequestId<AppState['agent']>
  'agent.spawned': TypeWithRequestId<AppState['agent']>
  'agent.killed': TypeWithRequestId<AppState['agent']>
  'agent.connected': TypeWithRequestId<AppState['agent']>
  'agent.updated': TypeWithRequestId<AppState['agent']>
  'agent.disconnected': AppState['agent']
  'agent.error': string
}

export type AgentEventNames = keyof AgentEvents

export type SessionEvents = {
  'session.acp_created': TypeWithRequestId<NewSessionResponse>
  'session.created': TypeWithRequestId<AppState['session']>
  'session.updated': TypeWithRequestId<AppState['session']>
  'session.loaded': TypeWithRequestId<AppState['session']>
  'session.suspended': TypeWithRequestId<AppState['session']>
  'session.completed': TypeWithRequestId<AppState['session']>
  'session.turnActive': TypeWithRequestId<{
    id: string
    active: boolean
    stopReason?: PromptResponse['stopReason']
    usage?: PromptResponse['usage']
  }>
  'session.deleted': TypeWithRequestId<string>
  'session.error': string
}

export type SessionEventNames = keyof SessionEvents

export type McpServerManagerEvents = {
  'mcpservermanager.started': string
  'mcpservermanager.stopped': string
  'mcpservermanager.error': string
}

export type McpServerEventNames = keyof McpServerManagerEvents

export type IndexerEvents = {
  'indexer.indexing': TypeWithRequestId<string>
  'indexer.ready': TypeWithRequestId<string>
  'indexer.error': string
}
