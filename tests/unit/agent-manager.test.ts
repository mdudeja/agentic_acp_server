import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test'
import { AgentManager } from '../../src/managers/AgentManager'
import type { AgenticServer } from '../../src/AgenticServer'
import { PROVIDERS, Providers } from '../../src/data/providers'

describe('AgentManager', () => {
  let mockServerInstance: AgenticServer
  let mockDb: any
  let agentManager: AgentManager
  let mockSpawnFn: ReturnType<typeof mock>

  beforeEach(() => {
    mockServerInstance = {
      getState: () => ({
        agent: { id: 'agent_1', provider_name: Providers.echo, cwd: '/tmp' },
      }),
      getCommsInterface: () => ({
        notify: mock(() => {}),
        respond: mock(() => {}),
      }),
    } as any

    mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      }),
      insert: () => ({
        values: () => ({
          returning: () =>
            Promise.resolve([
              { id: 'agent_1', provider_name: Providers.echo, cwd: '/tmp' },
            ]),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () =>
              Promise.resolve([
                {
                  id: 'agent_1',
                  provider_name: Providers.echo,
                  cwd: '/tmp',
                  cli_inited: true,
                },
              ]),
          }),
        }),
      }),
    }

    mock.module('../../src/database/AgenticDB', () => ({
      AgenticDB: {
        getInstance: () => ({
          getDB: () => mockDb,
        }),
      },
    }))

    mockSpawnFn = mock((_opts) => {
      // The mocked process stays alive until it is killed.
      let exit!: (code: number) => void
      const exited = new Promise<number>((resolve) => {
        exit = resolve
      })
      return {
        stdin: { write: mock(), end: mock() },
        stdout: { read: mock() },
        kill: mock(() => exit(137)),
        exitCode: null,
        exited,
      }
    })

    agentManager = new AgentManager(
      Providers.echo,
      '/tmp',
      mockServerInstance,
      mockSpawnFn as any,
    )
  })

  afterEach(() => {
    agentManager.dispose()
    mock.restore()
  })

  describe('init', () => {
    it('creates a new agent if none exists', async () => {
      const emitSpy = mock(() => {})
      agentManager.on('agent.created', emitSpy)

      await agentManager.init()

      expect(emitSpy).toHaveBeenCalledTimes(1)
      expect((emitSpy.mock.calls[0] as any[])[0].data.id).toBe('agent_1')
    })

    it('loads existing agent if found', async () => {
      mockDb.select = () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () =>
                Promise.resolve([
                  {
                    id: 'existing_agent',
                    provider_name: Providers.echo,
                    cwd: '/tmp',
                    provider_command: PROVIDERS.echo.command,
                    provider_args: PROVIDERS.echo.args,
                    provider_title: PROVIDERS.echo.name,
                  },
                ]),
            }),
          }),
        }),
      })

      const emitSpy = mock(() => {})
      agentManager.on('agent.loaded', emitSpy)

      await agentManager.init()

      expect(emitSpy).toHaveBeenCalledTimes(1)
      expect((emitSpy.mock.calls[0] as any[])[0].data.id).toBe('existing_agent')
    })
  })

  describe('provider config sync', () => {
    it('updates a stored agent whose command is out of date', async () => {
      mockDb.select = () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () =>
                Promise.resolve([
                  {
                    id: 'agent_1',
                    provider_name: Providers.echo,
                    cwd: '/tmp',
                    provider_command: 'old-binary',
                    provider_args: ['--old'],
                    provider_title: 'Echo',
                  },
                ]),
            }),
          }),
        }),
      })
      let written: any
      mockDb.update = () => ({
        set: (values: any) => {
          written = values
          return {
            where: () => ({
              returning: () =>
                Promise.resolve([{ id: 'agent_1', cwd: '/tmp', ...values }]),
            }),
          }
        },
      })

      await agentManager.init()

      expect(written).toEqual({
        provider_command: PROVIDERS.echo.command,
        provider_args: PROVIDERS.echo.args,
        provider_title: PROVIDERS.echo.name,
      })
      expect(agentManager.getAgent()?.provider_command).toBe(
        PROVIDERS.echo.command,
      )
    })
  })

  describe('spawn', () => {
    it('emits error if not initialized', () => {
      const emitSpy = mock(() => {})
      agentManager.on('agent.error', emitSpy)

      agentManager.spawn()

      expect(emitSpy).toHaveBeenCalledTimes(1)
      expect((emitSpy.mock.calls[0] as any[])[0]).toBe(
        'Agent is not initialized',
      )
    })

    it('spawns agent process using provided spawnFn', async () => {
      await agentManager.init()

      const emitSpy = mock(() => {})
      agentManager.on('agent.spawned', emitSpy)

      agentManager.spawn()

      expect(mockSpawnFn).toHaveBeenCalledTimes(1)
      expect(emitSpy).toHaveBeenCalledTimes(1)
      expect((emitSpy.mock.calls[0] as any[])[0].data.process).toBeDefined()
    })

    it('does not spawn if already running', async () => {
      await agentManager.init()
      agentManager.spawn()
      mockSpawnFn.mockClear()

      agentManager.spawn()
      expect(mockSpawnFn).toHaveBeenCalledTimes(0)
    })
  })

  describe('process exit', () => {
    /** Spawn mock whose process exits when `exit(code)` is called. */
    function exitableProcess() {
      let exit!: (code: number) => void
      const exited = new Promise<number>((resolve) => {
        exit = resolve
      })
      mockSpawnFn.mockImplementation(() => ({
        stdin: { write: mock(), end: mock() },
        stdout: { read: mock() },
        kill: mock(() => exit(137)),
        exitCode: null,
        exited,
      }))
      return { exit, exited }
    }

    it('emits agent.disconnected when the process exits on its own', async () => {
      const { exit, exited } = exitableProcess()
      await agentManager.init()
      agentManager.spawn()
      expect(agentManager.isAlive()).toBe(true)

      const disconnected = mock(() => {})
      agentManager.on('agent.disconnected', disconnected)

      exit(1)
      await exited

      expect(disconnected).toHaveBeenCalledTimes(1)
      expect((disconnected.mock.calls[0] as any[])[0].exitCode).toBe(1)
      expect(agentManager.isAlive()).toBe(false)
      expect(agentManager.getAgent()?.process).toBeUndefined()
    })

    it('does not report an intentional kill as a disconnect', async () => {
      const { exited } = exitableProcess()
      await agentManager.init()
      agentManager.spawn()

      const disconnected = mock(() => {})
      agentManager.on('agent.disconnected', disconnected)

      await agentManager.kill()
      await exited

      expect(disconnected).not.toHaveBeenCalled()
    })
  })

  describe('kill', () => {
    it('kills the process and sets it to undefined', async () => {
      await agentManager.init()
      agentManager.spawn()

      const emitSpy = mock(() => {})
      agentManager.on('agent.killed', emitSpy)

      await agentManager.kill()

      expect(emitSpy).toHaveBeenCalledTimes(1)
    })

    it('does nothing if no agent or no process', async () => {
      const emitSpy = mock(() => {})
      agentManager.on('agent.killed', emitSpy)

      await agentManager.kill() // no agent

      await agentManager.init()
      await agentManager.kill() // no process

      expect(emitSpy).toHaveBeenCalledTimes(0)
    })
  })

  describe('setCliInited', () => {
    it('updates the database and emits updated event', async () => {
      await agentManager.init()

      const emitSpy = mock(() => {})
      agentManager.on('agent.updated', emitSpy)

      await agentManager.setCliInited()

      expect(emitSpy).toHaveBeenCalledTimes(1)
      expect((emitSpy.mock.calls[0] as any[])[0].data.cli_inited).toBe(true)
    })

    it('emits error if not initialized', async () => {
      const emitSpy = mock(() => {})
      agentManager.on('agent.error', emitSpy)

      await agentManager.setCliInited()

      expect(emitSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('dispose', () => {
    it('kills process, clears agent, removes listeners', async () => {
      await agentManager.init()
      agentManager.spawn()

      const emitSpy = mock(() => {})
      agentManager.on('agent.spawned', emitSpy)

      await agentManager.dispose()

      // Should clear listeners
      agentManager.emit('agent.spawned', undefined as any)
      expect(emitSpy).toHaveBeenCalledTimes(0)
    })
  })
})
