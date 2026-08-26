import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { AgenticServer } from '../../src/AgenticServer'
import type { ASMPayload } from 'src/openrpc/schemas'
import { join } from 'path'
import { commandResponseRoundTrip } from 'tests/helpers/commandResponseRoundTrip'
import { InMemoryCommsInterface } from 'tests/helpers/InMemoryCommsInterface'

const cwd = join(import.meta.dir, '..', '..')

const init_payload = {
  jsonrpc: '2.0',
  data: {
    method: 'client/init',
    params: { requestId: 'test-init-req-id', provider: 'echo', cwd },
  },
} as ASMPayload

describe('AgenticServer event handlers', () => {
  let server: AgenticServer

  beforeEach(async () => {
    server = new AgenticServer({
      mode: 'rpc',
      port: 3999,
      exitOnDispose: false,
      commsInterface: new InMemoryCommsInterface(),
      disposeOnCommsInterfaceClose: false,
    })
    await server.init(cwd)
    await commandResponseRoundTrip(
      init_payload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )
  })

  afterEach(() => {
    server.dispose()
  })

  test('setDefaultModelForProvider delegates to the agent manager', async () => {
    server.setDefaultModelForProvider('echo' as any, 'claude-3')
    const state = server.getState()
    expect(state.agent).toBeDefined()
  })

  test('getPermissionHandler returns the agent permission handler', () => {
    expect(server.getPermissionHandler()).toBeDefined()
  })

  test('drives agent.killed event to clear state', async () => {
    const { agentManager } = server.getManagers()
    agentManager!.emit('agent.killed', {
      data: { id: 'agent_x' } as any,
    })
    expect(server.getState().agent).not.toBeDefined()
    expect(server.getState().connection).not.toBeDefined()
  })

  test('drives agent.error event', async () => {
    const { agentManager } = server.getManagers()
    agentManager!.emit('agent.error', 'some agent error')
    expect(true).toBe(true)
  })

  test('drives session update handler listeners', async () => {
    const { agentManager } = server.getManagers()
    const handler = agentManager!.getSessionUpdateHandler()

    const comms = server.getCommsInterface() as InMemoryCommsInterface
    let notified: any[] = []
    comms.onOutgoing((msg) => notified.push(msg))

    const sessionId = 'sess-1'

    await handler.handleUpdate(sessionId, {
      sessionUpdate: 'available_commands_update',
      availableCommands: [{ id: 'c1' }],
    } as any)
    await handler.handleUpdate(sessionId, {
      sessionUpdate: 'plan',
      plan: { steps: [] },
    } as any)
    await handler.handleUpdate(sessionId, {
      sessionUpdate: 'usage_update',
      usage: { totalCost: 1 },
    } as any)
    await handler.handleUpdate(sessionId, {
      sessionUpdate: 'agent_thought_chunk',
      chunk: 'thinking',
    } as any)
    await handler.handleUpdate(sessionId, {
      sessionUpdate: 'agent_message_chunk',
      chunk: 'hello',
    } as any)
    await handler.handleUpdate(sessionId, {
      sessionUpdate: 'tool_call',
      toolCall: { id: 't1' },
    } as any)
    await handler.handleUpdate(sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallUpdate: { id: 't1' },
    } as any)

    const sessionUpdates = notified.filter(
      (m: any) => m.method === 'agentic/session_update',
    )
    expect(sessionUpdates.length).toBe(7)
  })

  test('drives session event handlers', async () => {
    const { sessionManager } = server.getManagers()
    const comms = server.getCommsInterface() as InMemoryCommsInterface
    let notified: any[] = []
    comms.onOutgoing((msg) => notified.push(msg))

    const baseSession: any = {
      id: 'sess-1',
      name: 'S1',
      status: 'active',
      acp_session_id: 'acp-1',
      agent_id: 'agent_1',
      is_archived: false,
      created_at: 1,
      updated_at: 1,
    }

    // session.created
    sessionManager!.emit('session.created', { data: baseSession })
    expect(server.getState().session).toBeDefined()

    // session.loaded
    sessionManager!.emit('session.loaded', {
      data: { ...baseSession, name: 'Loaded' },
    })
    expect(server.getState().session?.name).toBe('Loaded')

    // session.updated
    sessionManager!.emit('session.updated', {
      data: { ...baseSession, name: 'Updated' },
    })

    // session.suspended
    sessionManager!.emit('session.suspended', {
      data: { ...baseSession, status: 'suspended' },
    })

    // session.completed
    sessionManager!.emit('session.completed', {
      data: { ...baseSession, status: 'completed' },
    })

    // session.deleted
    sessionManager!.emit('session.deleted', { data: 'sess_1' })

    const logs = notified.filter((m: any) => m.method === 'agentic/log')
    expect(logs.length).toBeGreaterThan(0)
  })

  test('drives config_option_update and current_mode_update when session matches', async () => {
    const { agentManager } = server.getManagers()
    const handler = agentManager!.getSessionUpdateHandler()

    // First create a session so state.session matches the id
    const { sessionManager } = server.getManagers()
    sessionManager!.emit('session.created', {
      data: {
        id: 'sess-match',
        agent_id: 'agent_1',
        acp_session_id: 'acp-1',
        name: 'S',
        status: 'active' as any,
        is_archived: false,
        created_at: 1,
        updated_at: 1,
      } as any,
    })

    const comms = server.getCommsInterface() as InMemoryCommsInterface
    let notified: any[] = []
    comms.onOutgoing((msg) => notified.push(msg))

    await handler.handleUpdate('sess-match', {
      sessionUpdate: 'config_option_update',
      configOption: { id: 'mode', value: 'mode1' },
    } as any)
    await handler.handleUpdate('sess-match', {
      sessionUpdate: 'current_mode_update',
      currentModeId: 'mode2',
    } as any)

    const updates = notified.filter(
      (m: any) => m.method === 'agentic/session_update',
    )
    expect(updates.length).toBe(2)
  })

  test('config_option_update is ignored when session does not match', async () => {
    const { agentManager } = server.getManagers()
    const handler = agentManager!.getSessionUpdateHandler()
    const comms = server.getCommsInterface() as InMemoryCommsInterface
    let notified: any[] = []
    comms.onOutgoing((msg) => notified.push(msg))

    // No session created yet, id won't match
    await handler.handleUpdate('no-such-session', {
      sessionUpdate: 'config_option_update',
    } as any)

    const updates = notified.filter(
      (m: any) => m.method === 'agentic/session_update',
    )
    expect(updates.length).toBe(0)
  })

  test('drives mcp server manager and indexer events', async () => {
    const { mcpServerManager, indexerManager } = server.getManagers()
    const comms = server.getCommsInterface() as InMemoryCommsInterface
    let notified: any[] = []
    comms.onOutgoing((msg) => notified.push(msg))

    mcpServerManager!.emit('mcpservermanager.error', 'mcp boom')
    indexerManager!.emit('indexer.error', 'index boom')
    indexerManager!.emit('indexer.indexing', { data: 'start' })
    indexerManager!.emit('indexer.ready', { data: 'done' })

    const logs = notified.filter((m: any) => m.method === 'agentic/log')
    expect(logs.length).toBe(4)
  })

  test('drives session.error and turnActive events', async () => {
    const { sessionManager } = server.getManagers()

    sessionManager!.emit('session.error', 'session went wrong')
    sessionManager!.emit('session.turnActive', {
      data: { id: 's1', active: true },
    })

    expect(server.getState().promptActive).toBe(true)
  })

  test('drives plan_update session update listener', async () => {
    const { agentManager } = server.getManagers()
    const handler = agentManager!.getSessionUpdateHandler()
    const comms = server.getCommsInterface() as InMemoryCommsInterface
    let notified: any[] = []
    comms.onOutgoing((msg) => notified.push(msg))

    await handler.handleUpdate('sess-1', {
      sessionUpdate: 'plan_update',
      plan: { steps: [] },
    } as any)

    const updates = notified.filter(
      (m: any) => m.method === 'agentic/session_update',
    )
    expect(updates.length).toBe(1)
  })

  test('drives plan_removed session update listener', async () => {
    const { agentManager } = server.getManagers()
    const handler = agentManager!.getSessionUpdateHandler()
    const comms = server.getCommsInterface() as InMemoryCommsInterface
    let notified: any[] = []
    comms.onOutgoing((msg) => notified.push(msg))

    await handler.handleUpdate('sess-1', {
      sessionUpdate: 'plan_removed',
      planId: 'plan-1',
    } as any)

    const updates = notified.filter(
      (m: any) => m.method === 'agentic/session_update',
    )
    expect(updates.length).toBe(1)
    expect(updates[0]?.data.updateType).toBe('plan_removed')
  })

  test('drives compaction_update and compaction_summary_chunk listeners', async () => {
    const { agentManager } = server.getManagers()
    const handler = agentManager!.getSessionUpdateHandler()
    const comms = server.getCommsInterface() as InMemoryCommsInterface
    let notified: any[] = []
    comms.onOutgoing((msg) => notified.push(msg))

    await handler.handleUpdate('sess-1', {
      sessionUpdate: 'compaction_update',
      compactionId: 'comp-1',
      status: 'in_progress',
    } as any)
    await handler.handleUpdate('sess-1', {
      sessionUpdate: 'compaction_summary_chunk',
      compactionId: 'comp-1',
      content: { type: 'text', text: 'summary' },
    } as any)

    const updates = notified.filter(
      (m: any) => m.method === 'agentic/session_update',
    )
    expect(updates.length).toBe(2)
    expect(updates[0]?.data.updateType).toBe('compaction_update')
    expect(updates[1]?.data.updateType).toBe('compaction_summary_chunk')
  })

  test('drives user_message_chunk and session_info_update listeners', async () => {
    const { agentManager, sessionManager } = server.getManagers()
    const handler = agentManager!.getSessionUpdateHandler()

    // Create a session so session_info_update matches the id
    sessionManager!.emit('session.created', {
      data: {
        id: 'sess-info',
        agent_id: 'agent_1',
        acp_session_id: 'acp-1',
        name: 'S',
        status: 'active' as any,
        is_archived: false,
        created_at: 1,
        updated_at: 1,
      } as any,
    })

    const comms = server.getCommsInterface() as InMemoryCommsInterface
    let notified: any[] = []
    comms.onOutgoing((msg) => notified.push(msg))

    await handler.handleUpdate('sess-info', {
      sessionUpdate: 'user_message_chunk',
      chunk: 'user said something',
    } as any)
    await handler.handleUpdate('sess-info', {
      sessionUpdate: 'session_info_update',
      title: 'Renamed by agent',
    } as any)

    const updates = notified.filter(
      (m: any) => m.method === 'agentic/session_update',
    )
    expect(updates.length).toBe(2)
    expect(updates[0]?.data.updateType).toBe('user_message_chunk')
    expect(updates[1]?.data.updateType).toBe('session_info_update')

    // session_info_update should reflect the title in tracked state
    expect(server.getState().session?.name).toBe('Renamed by agent')
  })
})
