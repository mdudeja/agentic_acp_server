import type {
  NewSessionResponse,
  PromptResponse,
} from '@agentclientprotocol/sdk'
import type { ASMState } from 'src/state/IASMState'

type TypeWithRequestId<T> = { requestId?: string; data: T }

export type AgentEvents = {
  'agent.created': TypeWithRequestId<ASMState['agent']>
  'agent.loaded': TypeWithRequestId<ASMState['agent']>
  'agent.spawned': TypeWithRequestId<ASMState['agent']>
  'agent.killed': TypeWithRequestId<ASMState['agent']>
  'agent.connected': TypeWithRequestId<ASMState['agent']>
  'agent.updated': TypeWithRequestId<ASMState['agent']>
  'agent.disconnected': ASMState['agent']
  'agent.error': string
}

export type AgentEventNames = keyof AgentEvents

export type SessionEvents = {
  'session.acp_created': TypeWithRequestId<NewSessionResponse>
  'session.created': TypeWithRequestId<ASMState['session']>
  'session.updated': TypeWithRequestId<ASMState['session']>
  'session.loaded': TypeWithRequestId<ASMState['session']>
  'session.renamed': TypeWithRequestId<ASMState['session']>
  'session.completed': TypeWithRequestId<ASMState['session']>
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
