import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { AgenticServer } from '../../src/AgenticServer'
import type { ASMPayload } from 'src/openrpc/schemas'
import { join } from 'path'
import { commandResponseRoundTrip } from 'tests/helpers/commandResponseRoundTrip'
import type { ServerResponse } from 'src/comms/ICommsInterface'
import { InMemoryCommsInterface } from 'tests/helpers/InMemoryCommsInterface'

const cwd = join(import.meta.dir, '..', '..')

const init_payload = {
  jsonrpc: '2.0',
  data: {
    method: 'client/init',
    params: {
      requestId: 'test-init-req-id',
      provider: 'echo',
      cwd,
    },
  },
} as ASMPayload

describe('Commands.Sessions', () => {
  let server: AgenticServer
  let activeSessionId: string

  beforeEach(async () => {
    let comms = new InMemoryCommsInterface()
    server = new AgenticServer({
      mode: process.env.ACP_APP_MODE || 'server',
      port: parseInt(process.env.ACP_HTTP_PORT ?? '3778', 10),
      exitOnDispose: false,
      commsInterface: process.env.ACP_APP_MODE === 'rpc' ? comms : undefined,
      disposeOnCommsInterfaceClose: false,
    })
    await server.init(cwd)

    await commandResponseRoundTrip(
      init_payload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Create a session to work with in each test
    const newSessionResp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/new_session',
          params: { requestId: 'setup-new-session' },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const sessionResponse = newSessionResp.find(
      (m) => m.type === 'response' && m.method === 'client/new_session',
    ) as ServerResponse | undefined

    activeSessionId = sessionResponse?.result?.sessionId as string
  })

  afterEach(() => {
    server.dispose()
  })

  // ---------------------------------------------------------------------------
  // client/new_session
  // ---------------------------------------------------------------------------

  test('client/new_session succeeds and returns a sessionId', async () => {
    const resp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/new_session',
          params: { requestId: 'new-session-req-1' },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const last = resp[resp.length - 1] as ServerResponse
    expect(last.type).toBe('response')
    expect(last.method).toBe('client/new_session')
    expect(last.error).toBeUndefined()
    expect(last.result?.success).toBe(true)
    expect(last.result?.sessionId).toBeDefined()
  })

  test('client/new_session with a custom name creates a named session', async () => {
    const resp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/new_session',
          params: {
            requestId: 'named-session-req',
            sessionName: 'My Test Session',
          },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const last = resp[resp.length - 1] as ServerResponse
    expect(last.type).toBe('response')
    expect(last.method).toBe('client/new_session')
    expect(last.error).toBeUndefined()
    expect(last.result?.success).toBe(true)
    expect(last.result?.sessionId).toBeDefined()

    // Verify the session was created with the correct name via list_sessions
    const listResp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/list_sessions',
          params: { requestId: 'list-after-named' },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const listLast = listResp[listResp.length - 1] as ServerResponse
    const sessions: any[] = listLast.result?.sessions ?? []
    const found = sessions.find((s) => s.id === last.result?.sessionId)
    expect(found?.name).toBe('My Test Session')
  })

  // ---------------------------------------------------------------------------
  // client/list_sessions
  // ---------------------------------------------------------------------------

  test('client/list_sessions returns a list containing the active session', async () => {
    const resp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/list_sessions',
          params: { requestId: 'list-sessions-req' },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const last = resp[resp.length - 1] as ServerResponse
    expect(last.type).toBe('response')
    expect(last.method).toBe('client/list_sessions')
    expect(last.error).toBeUndefined()
    expect(last.result?.success).toBe(true)
    expect(Array.isArray(last.result?.sessions)).toBe(true)

    const ids = (last.result?.sessions as any[]).map((s) => s.id)
    expect(ids).toContain(activeSessionId)
  })

  // ---------------------------------------------------------------------------
  // client/rename_session
  // ---------------------------------------------------------------------------

  test('client/rename_session renames an existing session', async () => {
    const resp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/rename_session',
          params: {
            requestId: 'rename-session-req',
            sessionId: activeSessionId,
            newName: 'Renamed Session',
          },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const last = resp[resp.length - 1] as ServerResponse
    expect(last.type).toBe('response')
    expect(last.method).toBe('client/rename_session')
    expect(last.error).toBeUndefined()
    expect(last.result?.success).toBe(true)

    // Confirm name changed via list
    const listResp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/list_sessions',
          params: { requestId: 'list-after-rename' },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )
    const listLast = listResp[listResp.length - 1] as ServerResponse
    const sessions: any[] = listLast.result?.sessions ?? []
    const found = sessions.find((s) => s.id === activeSessionId)
    expect(found?.name).toBe('Renamed Session')
  })

  test('client/rename_session emits session error for a non-existent sessionId', async () => {
    try {
      await commandResponseRoundTrip(
        {
          jsonrpc: '2.0',
          data: {
            method: 'client/rename_session',
            params: {
              requestId: 'rename-bad-id',
              sessionId: 'non-existent-session-id',
              newName: 'Ghost',
            },
          },
        } as ASMPayload,
        server.getCommsInterface() as InMemoryCommsInterface,
      )
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toMatch(/Received error notification/)
    }
  })

  // ---------------------------------------------------------------------------
  // client/archive_session
  // ---------------------------------------------------------------------------

  test('client/archive_session archives then unarchives a session', async () => {
    // Archive
    const archiveResp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/archive_session',
          params: {
            requestId: 'archive-session-req',
            sessionId: activeSessionId,
            archive: true,
          },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const archiveLast = archiveResp[archiveResp.length - 1] as ServerResponse
    expect(archiveLast.type).toBe('response')
    expect(archiveLast.method).toBe('client/archive_session')
    expect(archiveLast.error).toBeUndefined()
    expect(archiveLast.result?.success).toBe(true)

    // Unarchive
    const unarchiveResp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/archive_session',
          params: {
            requestId: 'unarchive-session-req',
            sessionId: activeSessionId,
            archive: false,
          },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const unarchiveLast = unarchiveResp[
      unarchiveResp.length - 1
    ] as ServerResponse
    expect(unarchiveLast.type).toBe('response')
    expect(unarchiveLast.method).toBe('client/archive_session')
    expect(unarchiveLast.error).toBeUndefined()
    expect(unarchiveLast.result?.success).toBe(true)
  })

  test('client/archive_session emits session error for a non-existent sessionId', async () => {
    try {
      await commandResponseRoundTrip(
        {
          jsonrpc: '2.0',
          data: {
            method: 'client/archive_session',
            params: {
              requestId: 'archive-bad-id',
              sessionId: 'non-existent-id',
              archive: true,
            },
          },
        } as ASMPayload,
        server.getCommsInterface() as InMemoryCommsInterface,
      )
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toMatch(/Received error notification/)
    }
  })

  // ---------------------------------------------------------------------------
  // client/load_session
  // ---------------------------------------------------------------------------

  test('client/load_session loads an existing session by id', async () => {
    const resp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/load_session',
          params: {
            requestId: 'load-session-req',
            sessionId: activeSessionId,
          },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const last = resp[resp.length - 1] as ServerResponse
    expect(last.type).toBe('response')
    expect(last.method).toBe('client/load_session')
    expect(last.error).toBeUndefined()
    expect(last.result?.success).toBe(true)
    expect(last.result?.sessionId).toBe(activeSessionId)
  })

  test('client/load_session emits session error for a non-existent sessionId', async () => {
    try {
      await commandResponseRoundTrip(
        {
          jsonrpc: '2.0',
          data: {
            method: 'client/load_session',
            params: {
              requestId: 'load-bad-id',
              sessionId: 'non-existent-session-id',
            },
          },
        } as ASMPayload,
        server.getCommsInterface() as InMemoryCommsInterface,
      )
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toMatch(/Received error notification/)
    }
  })

  // ---------------------------------------------------------------------------
  // client/fork_session
  // ---------------------------------------------------------------------------

  test('client/fork_session forks the active session', async () => {
    const resp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/fork_session',
          params: {
            requestId: 'fork-session-req',
            sessionId: activeSessionId,
          },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const last = resp[resp.length - 1] as ServerResponse
    expect(last.type).toBe('response')
    expect(last.method).toBe('client/fork_session')
    expect(last.error).toBeUndefined()
    expect(last.result?.success).toBe(true)

    // A new session should appear in the list
    const listResp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/list_sessions',
          params: { requestId: 'list-after-fork' },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )
    const listLast = listResp[listResp.length - 1] as ServerResponse
    const sessions: any[] = listLast.result?.sessions ?? []
    // Should now have at least 2 sessions (original + fork)
    expect(sessions.length).toBeGreaterThanOrEqual(2)
  })

  // ---------------------------------------------------------------------------
  // client/resume_session
  // ---------------------------------------------------------------------------

  test('client/resume_session resumes a suspended session', async () => {
    // First, create another session so the active one gets suspended
    await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/new_session',
          params: { requestId: 'second-session-for-resume' },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    // activeSessionId should now be suspended; try resuming it
    const resumeResp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/resume_session',
          params: {
            requestId: 'resume-session-req',
            sessionId: activeSessionId,
          },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const last = resumeResp[resumeResp.length - 1] as ServerResponse
    expect(last.type).toBe('response')
    expect(last.method).toBe('client/resume_session')
    expect(last.error).toBeUndefined()
    expect(last.result?.success).toBe(true)
    expect(last.result?.sessionId).toBe(activeSessionId)
  })

  test('client/resume_session emits session error for non-existent sessionId', async () => {
    try {
      await commandResponseRoundTrip(
        {
          jsonrpc: '2.0',
          data: {
            method: 'client/resume_session',
            params: {
              requestId: 'resume-bad-id',
              sessionId: 'non-existent-session-id',
            },
          },
        } as ASMPayload,
        server.getCommsInterface() as InMemoryCommsInterface,
      )
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toMatch(/Received error notification/)
    }
  })

  // ---------------------------------------------------------------------------
  // client/delete_session
  // ---------------------------------------------------------------------------

  test('client/delete_session removes a session from the list', async () => {
    // Create a throwaway session to delete
    const createResp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/new_session',
          params: { requestId: 'to-delete-session', sessionName: 'Throwaway' },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )
    const createLast = createResp[createResp.length - 1] as ServerResponse
    const throwawayId = createLast.result?.sessionId as string

    const deleteResp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/delete_session',
          params: {
            requestId: 'delete-session-req',
            sessionId: throwawayId,
          },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )

    const last = deleteResp[deleteResp.length - 1] as ServerResponse
    expect(last.type).toBe('response')
    expect(last.method).toBe('client/delete_session')
    expect(last.error).toBeUndefined()
    expect(last.result?.success).toBe(true)

    // Session should no longer appear in the list
    const listResp = await commandResponseRoundTrip(
      {
        jsonrpc: '2.0',
        data: {
          method: 'client/list_sessions',
          params: { requestId: 'list-after-delete' },
        },
      } as ASMPayload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )
    const listLast = listResp[listResp.length - 1] as ServerResponse
    const ids = (listLast.result?.sessions as any[]).map((s) => s.id)
    expect(ids).not.toContain(throwawayId)
  })

  test('client/delete_session emits session error for a non-existent sessionId', async () => {
    try {
      await commandResponseRoundTrip(
        {
          jsonrpc: '2.0',
          data: {
            method: 'client/delete_session',
            params: {
              requestId: 'delete-bad-id',
              sessionId: 'non-existent-session-id',
            },
          },
        } as ASMPayload,
        server.getCommsInterface() as InMemoryCommsInterface,
      )
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toMatch(/Received error notification/)
    }
  })

  // ---------------------------------------------------------------------------
  // client/switch_session_mode
  // ---------------------------------------------------------------------------

  test('client/switch_session_mode emits error when no available modes', async () => {
    const sessionManager = server.getManagers().sessionManager as any
    const session = sessionManager?.sessions.get(activeSessionId)
    if (session) {
      session.configOptions = []
      session.modes = undefined
    }

    try {
      await commandResponseRoundTrip(
        {
          jsonrpc: '2.0',
          data: {
            method: 'client/switch_session_mode',
            params: {
              requestId: 'switch-mode-no-modes',
              sessionId: activeSessionId,
            },
          },
        } as ASMPayload,
        server.getCommsInterface() as InMemoryCommsInterface,
      )
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toMatch(/No available modes found/)
    }
  })

  test('client/switch_session_mode succeeds and asks for mode selection', async () => {
    const payload = {
      jsonrpc: '2.0',
      data: {
        method: 'client/switch_session_mode',
        params: {
          requestId: 'switch-mode-success',
          sessionId: activeSessionId,
        },
      },
    } as ASMPayload

    // Setup an answer that will be sent when the question is asked
    const comms = server.getCommsInterface() as InMemoryCommsInterface
    const unsubscribe = comms.onOutgoing(async (msg) => {
      if (msg.type === 'notification' && msg.method === 'agentic/question') {
        const qMsg = msg as any
        // Send the answer (select option 2 'Mode 2')
        await comms.send({
          jsonrpc: '2.0',
          data: {
            method: 'client/answer',
            params: {
              requestId: 'answer-req-mode',
              questionId: qMsg.data.questionId,
              answer: '2',
            },
          },
        })
      }
    })

    const resp = await commandResponseRoundTrip(payload, comms)

    unsubscribe()

    const last = resp[resp.length - 1] as ServerResponse
    expect(last.type).toBe('response')
    expect(last.method).toBe('client/switch_session_mode')
    expect(last.error).toBeUndefined()
    expect(last.result?.success).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // client/switch_model
  // ---------------------------------------------------------------------------

  test('client/switch_model emits error when no available models', async () => {
    const sessionManager = server.getManagers().sessionManager as any
    const session = sessionManager?.sessions.get(activeSessionId)
    if (session) {
      session.configOptions = []
      session.models = undefined
    }

    try {
      await commandResponseRoundTrip(
        {
          jsonrpc: '2.0',
          data: {
            method: 'client/switch_model',
            params: {
              requestId: 'switch-model-no-models',
              sessionId: activeSessionId,
              model: 'dummy-model',
            },
          },
        } as ASMPayload,
        server.getCommsInterface() as InMemoryCommsInterface,
      )
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toMatch(/No available models found/)
    }
  })

  test('client/switch_model succeeds and asks for model selection', async () => {
    const payload = {
      jsonrpc: '2.0',
      data: {
        method: 'client/switch_model',
        params: {
          requestId: 'switch-model-success',
          sessionId: activeSessionId,
          model: 'dummy-model',
        },
      },
    } as ASMPayload

    const comms = server.getCommsInterface() as InMemoryCommsInterface
    const unsubscribe = comms.onOutgoing(async (msg) => {
      if (msg.type === 'notification' && msg.method === 'agentic/question') {
        const qMsg = msg as any
        // Send the answer (select option 1 'Model 1')
        await comms.send({
          jsonrpc: '2.0',
          data: {
            method: 'client/answer',
            params: {
              requestId: 'answer-req-model',
              questionId: qMsg.data.questionId,
              answer: '1',
            },
          },
        })
      }
    })

    const resp = await commandResponseRoundTrip(payload, comms)

    unsubscribe()

    const last = resp[resp.length - 1] as ServerResponse
    expect(last.type).toBe('response')
    expect(last.method).toBe('client/switch_model')
    expect(last.error).toBeUndefined()
    expect(last.result?.success).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // state consistency check
  // ---------------------------------------------------------------------------

  test('state reflects session after client/new_session', async () => {
    const state = server.getState()
    expect(state.session).toBeDefined()
    expect(state.session?.id).toBe(activeSessionId)
  })
})
