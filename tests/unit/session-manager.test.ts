import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test'
import { SessionManager } from '../../src/managers/SessionManager'
import { SessionStatus } from '../../src/database/schemas'

describe('SessionManager', () => {
  let mockServerInstance: any
  let mockDb: any
  let sessionManager: SessionManager

  beforeEach(() => {
    mockServerInstance = {
      getState: () => ({
        agent: {
          id: 'agent_1',
          provider_name: 'echo',
          cwd: '/tmp',
          default_model_id: 'claude-3',
        },
        connection: {
          initResponse: {
            authMethods: [{ id: 'method1', name: 'Method 1' }],
            agentCapabilities: {
              loadSession: true,
              sessionCapabilities: { fork: true, resume: true },
            },
          },
          clientContext: {
            request: mock(async (_method: string, _params: any) => {
              // Default fallback per-method responses
              return {}
            }),
            notify: mock(async () => {}),
          },
        },
      }),
      getCommsInterface: () => ({
        question: mock(() => Promise.resolve('1')),
      }),
      getPermissionHandler: () => ({
        rejectAllPending: mock(() => {}),
      }),
      getManagers: () => ({
        agentManager: { setCliInited: mock(() => {}) },
        mcpServerManager: { getMcpServers: () => [] },
      }),
      setDefaultModelForProvider: mock(() => Promise.resolve()),
    }

    // Override request mock behaviour per test
    mockServerInstance.getState().connection.clientContext.request = mock(
      async (method: string) => {
        switch (method) {
          case 'session/new':
            return {
              sessionId: 'new_session_123',
              configOptions: [
                {
                  id: 'mode',
                  name: 'Mode',
                  type: 'select',
                  currentValue: 'mode1',
                  options: [
                    { name: 'Mode 1', value: 'mode1' },
                    { name: 'Mode 2', value: 'mode2' },
                  ],
                },
                {
                  id: 'model',
                  name: 'Model',
                  type: 'select',
                  currentValue: 'model1',
                  options: [
                    { name: 'Model 1', value: 'model1' },
                    { name: 'Model 2', value: 'model2' },
                  ],
                },
              ],
              modes: { currentModeId: 'mode1', availableModes: [] },
            }
          case 'session/load':
            return { configOptions: [], modes: {} }
          case 'session/fork':
            return { sessionId: 'forked_session', configOptions: [], modes: {} }
          case 'session/resume':
            return {
              sessionId: 'resumed_session',
              configOptions: [],
              modes: {},
            }
          case 'session/prompt':
            return { stopReason: 'end_turn', usage: {} }
          case 'session/set_config_option':
            return {}
          default:
            return {}
        }
      },
    )

    mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () =>
              Promise.resolve([
                {
                  id: 'session_1',
                  agent_id: 'agent_1',
                  acp_session_id: 'acp_session_1',
                  name: 'Session 1',
                  status: SessionStatus.active,
                },
              ]),
          }),
        }),
      }),
      insert: () => ({
        values: () => ({
          returning: () =>
            Promise.resolve([
              {
                id: 'new_session',
                agent_id: 'agent_1',
                acp_session_id: 'acp_session_new',
                name: 'New Session',
              },
            ]),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () =>
              Promise.resolve([
                { id: 'updated_session', status: SessionStatus.suspended },
              ]),
          }),
        }),
      }),
      delete: () => ({
        where: () => Promise.resolve(),
      }),
    }

    mock.module('../../src/database/AgenticDB', () => ({
      AgenticDB: {
        getInstance: () => ({
          getDB: () => mockDb,
        }),
      },
    }))

    // Mock the configs loader
    mock.module('../../src/config/loader', () => ({
      loadConfig: () =>
        Promise.resolve({ sessions: { memoryPath: '.agentic/sessions' } }),
    }))

    mock.module('../../src/cli/factory', () => ({
      createProviderCLI: () => ({
        init: mock(() => Promise.resolve()),
        exportSession: mock(() => Promise.resolve({ success: true })),
        importSession: mock(() => Promise.resolve({ success: true })),
        deleteSession: mock(() => Promise.resolve({ success: true })),
        listSessions: mock(() =>
          Promise.resolve({ success: true, data: { sessions: [] } }),
        ),
        stats: mock(() =>
          Promise.resolve({ success: true, data: { total: 10 } }),
        ),
      }),
    }))

    sessionManager = new SessionManager(mockServerInstance)
  })

  afterEach(() => {
    sessionManager.dispose()
    mock.restore()
  })

  describe('init', () => {
    it('emits error if no agent found', async () => {
      mockServerInstance.getState = () => ({ agent: null })
      const emitSpy = mock(() => {})
      sessionManager.on('session.error', emitSpy)

      await sessionManager.init()

      expect(emitSpy).toHaveBeenCalledTimes(1)
      expect((emitSpy.mock.calls[0] as any[])[0]).toBe(
        'No active agent found in state',
      )
    })

    it('loads sessions and sets up connection', async () => {
      await sessionManager.init()

      const sessions = sessionManager.listSessions()
      expect(sessions.length).toBe(1)
      expect(sessions[0]?.id).toBe('session_1')
    })
  })

  describe('createNewSession', () => {
    it('creates new session and calls server createSession', async () => {
      await sessionManager.init()
      const emitSpy = mock(() => {})
      sessionManager.on('session.created', emitSpy)

      await sessionManager.createNewSession('Custom Name')

      expect(emitSpy).toHaveBeenCalledTimes(1)
      expect((emitSpy.mock.calls[0] as any[])[0].data.id).toBe('new_session')
      const requestMock = (sessionManager as any).connection.clientContext
        .request
      expect(requestMock).toHaveBeenCalledWith('session/new', expect.anything())
    })
  })

  describe('loadSession', () => {
    it('loads an existing session from tracked list', async () => {
      await sessionManager.init()

      const emitSpy = mock(() => {})
      sessionManager.on('session.loaded', emitSpy)

      await sessionManager.loadSession('session_1')

      expect(emitSpy).toHaveBeenCalledTimes(1)
      const requestMock = (sessionManager as any).connection.clientContext
        .request
      expect(requestMock).toHaveBeenCalledWith(
        'session/load',
        expect.anything(),
      )
    })

    it('emits error if session not found', async () => {
      await sessionManager.init()

      const emitSpy = mock(() => {})
      sessionManager.on('session.error', emitSpy)

      await sessionManager.loadSession('nonexistent')

      expect(emitSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('suspendCurrentSession', () => {
    it('suspends active session', async () => {
      await sessionManager.init()
      await sessionManager.loadSession('session_1') // Make it active

      const emitSpy = mock(() => {})
      sessionManager.on('session.suspended', emitSpy)

      await sessionManager.suspendCurrentSession()

      expect(emitSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('deleteSession', () => {
    it('deletes session from db and tracking maps', async () => {
      await sessionManager.init()

      const emitSpy = mock(() => {})
      sessionManager.on('session.deleted', emitSpy)

      await sessionManager.deleteSession('session_1')

      expect(emitSpy).toHaveBeenCalledTimes(1)
      expect(sessionManager.listSessions().length).toBe(0)
    })
  })

  describe('listSessions', () => {
    it('returns mapped session summary objects', async () => {
      await sessionManager.init()
      const sessions = sessionManager.listSessions()
      expect(sessions.length).toBe(1)
      expect(sessions[0]).toHaveProperty('id')
      expect(sessions[0]).toHaveProperty('name')
      expect(sessions[0]).toHaveProperty('status')
    })
  })

  describe('prompt', () => {
    it('sends prompt and manages turn lifecycle events', async () => {
      await sessionManager.init()
      await sessionManager.loadSession('session_1')

      const emitSpy = mock(() => {})
      sessionManager.on('session.turnActive', emitSpy)

      await sessionManager.prompt([{ type: 'text', text: 'hello' }])

      // Emits twice: once for active=true, once for active=false when turn ends
      expect(emitSpy).toHaveBeenCalledTimes(2)
      expect((emitSpy.mock.calls[0] as any[])[0].data.active).toBe(true)
      expect((emitSpy.mock.calls[1] as any[])[0].data.active).toBe(false)
      const requestMock = (sessionManager as any).connection.clientContext
        .request
      expect(requestMock).toHaveBeenCalledWith(
        'session/prompt',
        expect.anything(),
      )
    })
  })

  describe('cancelTurn', () => {
    it('sends cancel notification and marks turn inactive', async () => {
      await sessionManager.init()
      await sessionManager.loadSession('session_1')

      const emitSpy = mock(() => {})
      sessionManager.on('session.turnActive', emitSpy)

      await sessionManager.cancelTurn()

      expect(emitSpy).toHaveBeenCalledTimes(1)
      expect((emitSpy.mock.calls[0] as any[])[0].data.active).toBe(false)
      expect((emitSpy.mock.calls[0] as any[])[0].data.stopReason).toBe(
        'cancelled',
      )
      const notifyMock = (sessionManager as any).connection.clientContext
        .notify
      expect(notifyMock).toHaveBeenCalledWith(
        'session/cancel',
        expect.anything(),
      )
    })

    it('emits error when no active session', async () => {
      await sessionManager.init()
      const emitSpy = mock(() => {})
      sessionManager.on('session.error', emitSpy)

      await sessionManager.cancelTurn()
      expect(emitSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('exportSession', () => {
    it('returns error when session not found', async () => {
      await sessionManager.init()
      const res = await sessionManager.exportSession('nonexistent')
      expect(res.result.success).toBe(false)
      expect(res.error).toContain('not found')
    })
  })

  describe('listSessionsFromAgent', () => {
    it('uses provider CLI when session/list not advertised', async () => {
      await sessionManager.init()
      const res = await sessionManager.listSessionsFromAgent()
      expect(res.result.success).toBe(true)
    })
  })

  describe('setSessionConfigOption', () => {
    it('emits error when no active session', async () => {
      await sessionManager.init()
      const emitSpy = mock(() => {})
      sessionManager.on('session.error', emitSpy)

      await sessionManager.setSessionConfigOption('mode', 'x')
      expect(emitSpy).toHaveBeenCalledTimes(1)
    })
  })
})
