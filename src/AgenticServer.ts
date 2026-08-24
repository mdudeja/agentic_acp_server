import { AgentManager } from 'src/managers/AgentManager'
import { Providers } from 'src/data/providers'
import { resolvePath } from 'src/utils/paths'
import { logDebug, logError, logInfo, logWarning } from 'src/utils/logger'
import { generateCatchblock } from 'src/utils/helpers'
import { createContentBlocks } from 'src/ingester'
import type {
  ASMPayload,
  ASMPayloadParams,
  ICommsInterface,
} from 'src/comms/ICommsInterface'
import { ASMPayloadSchema } from 'src/openrpc/schemas'
import { Check, Errors } from 'typebox/value'
import { ReadlineCommsInterface } from 'src/comms/ReadlineCommsInterface'
import { WebsocketCommsInterface } from 'src/comms/WebsocketCommsInterface'
import { AppStateManager } from 'src/state'
import { SessionManager } from 'src/managers/SessionManager'
import { loadConfig } from './config/loader'
import { McpServerManager } from './managers/McpServerManager'
import { IndexerManager } from './managers/IndexerManager'
import { error } from 'node:console'

export class AgenticServer {
  private stateManager: AppStateManager
  private commsInterface: ICommsInterface
  private agentManager: AgentManager | null = null
  private sessionManager: SessionManager | null = null
  private mcpServerManager: McpServerManager | null = null
  private indexerManager: IndexerManager | null = null
  private exitOnDispose: boolean
  private disposeOnCommsInterfaceClose: boolean
  private port?: number

  constructor(config: {
    mode: 'rpc' | 'server'
    port?: number
    commsInterface?: ICommsInterface
    /** Set to false in tests to prevent process.exit() on dispose. Defaults to true. */
    exitOnDispose?: boolean
    disposeOnCommsInterfaceClose?: boolean
  }) {
    logInfo(`Starting Agentic Server in ${config.mode.toUpperCase()} mode...`)
    this.port = config.port
    this.stateManager = new AppStateManager()
    this.exitOnDispose = config.exitOnDispose ?? true
    this.disposeOnCommsInterfaceClose =
      config.disposeOnCommsInterfaceClose ?? true
    this.commsInterface =
      config.commsInterface ??
      (config.mode === 'rpc'
        ? new ReadlineCommsInterface()
        : new WebsocketCommsInterface())
  }

  /**
   * RPC mode (default): listen for JSON-RPC payloads on stdin and respond on stdout.
   */
  async init(workspace_root: string) {
    this.stateManager.setItem('workspaceRoot', workspace_root)

    const config = await loadConfig(workspace_root)
    this.stateManager.setItem('config', config)

    try {
      this._initCommsInterface()
      this._initMcpServerManager()
      this._initIndexerManager()
    } catch (err) {
      generateCatchblock(
        this.commsInterface,
        err,
        'Failed to initialize Agentic Server',
      )
    }
  }

  getCommsInterface() {
    return this.commsInterface
  }

  getState() {
    return this.stateManager.getState()
  }

  getManagers() {
    return {
      stateManager: this.stateManager,
      agentManager: this.agentManager,
      sessionManager: this.sessionManager,
      mcpServerManager: this.mcpServerManager,
      indexerManager: this.indexerManager,
    }
  }

  setDefaultModelForProvider(
    provider: Providers,
    modelId: string,
    requestId?: string,
  ) {
    this.agentManager?.setDefaultModelForProvider(provider, modelId, requestId)
  }

  getPermissionHandler() {
    return this.agentManager?.getPermissionHandler()
  }

  dispose() {
    if (this.stateManager) {
      this.stateManager.dispose()
    }

    if (this.sessionManager) {
      this.sessionManager.dispose()
    }

    if (this.agentManager) {
      this.agentManager.dispose()
    }

    if (this.commsInterface) {
      this.commsInterface.dispose()
    }

    if (this.mcpServerManager) {
      this.mcpServerManager.dispose()
    }

    if (this.indexerManager) {
      this.indexerManager.dispose()
    }

    if (this.exitOnDispose) {
      process.exit(0)
    }
  }

  private _initCommsInterface() {
    this.commsInterface.onMessage(async (message: string) => {
      try {
        const raw: unknown = JSON.parse(message)

        if (!Check(ASMPayloadSchema, raw)) {
          const errs = [...Errors(ASMPayloadSchema, raw)]
            .map((e) => `  ${e.instancePath || '/'}: ${e.message}`)
            .join('\n')
          throw new Error(`Invalid payload:\n${errs}`)
        }
        await this._process_payload(raw)
      } catch (err) {
        generateCatchblock(
          this.commsInterface!,
          err,
          'Failed to process incoming message',
        )
      }
    })

    this.commsInterface.onClose(() => {
      if (this.disposeOnCommsInterfaceClose) {
        logInfo('Comms interface closed. Shutting down server...')
        this.dispose()
      }
    })

    this.commsInterface.init(this.port)
  }

  private async _initAgentManager(params: ASMPayloadParams['client/init']) {
    const resolvedCwd = resolvePath(params.cwd)
    const providerId = params.provider || 'copilot'

    logDebug(
      `Initializing agent with provider ${providerId} in directory ${resolvedCwd}`,
    )

    if (!this.agentManager) {
      this.agentManager = new AgentManager(
        Providers[providerId],
        resolvedCwd,
        this,
      )
    }

    this.agentManager.on('agent.error', (errorMessage) => {
      logError(`Agent error: ${errorMessage}`)
      this.commsInterface?.notify({
        method: 'agentic/log',
        data: {
          level: 'error',
          message: `Agent error: ${errorMessage}`,
        },
      })
    })

    this.agentManager.on('agent.loaded', (agent) => {
      if (!agent || !agent.data) {
        logError('Loaded event received without agent data')
        const err = new Error('Failed to load agent')
        this.commsInterface?.notify({
          method: 'agentic/log',
          data: {
            level: 'error',
            message: `Failed to load agent: ${err.message}`,
          },
        })
        return
      }

      logDebug(`Agent loaded with ID ${agent.data.id}`)
      this.stateManager?.setItem('agent', agent.data)

      this.agentManager?.spawn(agent.requestId)
    })

    this.agentManager.on('agent.spawned', async (agent) => {
      if (!agent || !agent.data) {
        logError('Spawned event received without agent data')
        const err = new Error('Failed to spawn agent')
        this.commsInterface?.notify({
          method: 'agentic/log',
          data: {
            level: 'error',
            message: `Failed to spawn agent: ${err.message}`,
          },
        })
        return
      }

      logDebug(`Agent spawned with ID ${agent.data.id}`)
      this.stateManager?.setItem('agent', agent.data)

      this.commsInterface?.notify({
        method: 'agentic/log',
        data: {
          level: 'info',
          message: `Agent spawned with ID ${agent.data.id}`,
        },
      })

      if (!this.agentManager) {
        logError('AgentManager not initialized when handling spawned event')
        return
      }

      const connectData = await this.agentManager.connect(agent.requestId)

      if (!connectData) {
        logError('Failed to establish connection in spawned event')
        return
      }

      const { connection, client, initResponse } = connectData

      this.stateManager?.setItem('connection', {
        csc: connection,
        client,
        initResponse,
      })
    })

    this.agentManager.on('agent.connected', async (agent) => {
      if (!agent || !agent.data) {
        logError('Connected event received without agent data')
        this.commsInterface?.notify({
          method: 'agentic/log',
          data: {
            level: 'error',
            message: 'Failed to connect agent: Missing agent data',
          },
        })
        return
      }

      logDebug(`Agent with ID ${agent.data.id} connected`)
      this.commsInterface?.respond({
        method: 'client/init',
        id: agent.requestId,
        result: { success: true, agentId: agent.data.id },
      })

      this.stateManager?.setItem('agent', agent.data)

      await this._initSessionManager()
    })

    this.agentManager.on('agent.updated', (agent) => {
      if (!agent || !agent.data) {
        logError('Updated event received without agent data')
        return
      }

      logDebug(`Agent with ID ${agent.data.id} updated`)
      this.stateManager?.setItem('agent', agent.data)
      this.commsInterface?.notify({
        method: 'agentic/log',
        data: {
          level: 'info',
          message: `Agent with ID ${agent.data.id} updated`,
        },
      })
    })

    this.agentManager.on('agent.killed', (agent) => {
      if (!agent || !agent.data) {
        logError('Killed event received without agent data')
        return
      }

      this.commsInterface?.notify({
        method: 'agentic/log',
        data: {
          level: 'info',
          message: `Agent with ID ${agent.data.id} was killed`,
        },
      })

      logDebug(`Agent with ID ${agent.data.id} was killed`)
      this.stateManager?.deleteItem('agent')
      this.stateManager?.deleteItem('connection')
    })

    this._prepareSessionUpdateHandler()

    await this.agentManager.init(params.requestId)
  }

  private async _initMcpServerManager() {
    this.mcpServerManager = new McpServerManager(this)
    this.mcpServerManager.init()

    this.mcpServerManager.on('mcpservermanager.error', (errorMessage) => {
      logError(`McpServerManager error: ${errorMessage}`)
      this.commsInterface?.notify({
        method: 'agentic/log',
        data: {
          level: 'error',
          message: `McpServerManager error: ${errorMessage}`,
        },
      })
    })
  }

  private async _initIndexerManager() {
    this.indexerManager = new IndexerManager(this)
    this.indexerManager.init()

    this.indexerManager.on('indexer.error', (errorMessage) => {
      logError(`IndexerError: ${errorMessage}`)
      this.commsInterface?.notify({
        method: 'agentic/log',
        data: {
          level: 'error',
          message: `Indexer error: ${errorMessage}`,
        },
      })
    })

    this.indexerManager.on('indexer.indexing', (payload) => {
      this.commsInterface?.notify({
        method: 'agentic/log',
        data: {
          level: 'info',
          message: `Indexing started: ${payload?.data}`,
        },
      })
    })

    this.indexerManager.on('indexer.ready', (payload) => {
      this.commsInterface?.notify({
        method: 'agentic/log',
        data: {
          level: 'info',
          message: `Indexing MCP is ready ${payload?.data}`,
        },
      })

      logWarning('Server setup complete. Awaiting commands...')
    })

    this.indexerManager.runCommand('index')
  }

  private async _initSessionManager() {
    this.sessionManager = new SessionManager(this)

    this.sessionManager.on('session.error', (errorMessage) => {
      logError(`Session error: ${errorMessage}`)
      this.commsInterface?.notify({
        method: 'agentic/log',
        data: {
          level: 'error',
          message: `Session error: ${errorMessage}`,
        },
      })
    })

    this.sessionManager.on('session.created', (session) => {
      if (!session || !session.data) {
        logError('Created event received without session data')
        const err = new Error('Failed to create session')
        this.commsInterface?.notify({
          method: 'agentic/log',
          data: {
            level: 'error',
            message: `Failed to create session: ${err.message}`,
          },
        })
        return
      }

      logDebug(`Session created with ID ${session.data.id}`)
      this.stateManager?.setItem('session', session.data)

      this.commsInterface?.respond({
        method: 'client/new_session',
        id: session.requestId,
        result: { success: true, sessionId: session.data.id },
      })
    })

    this.sessionManager.on('session.loaded', (session) => {
      if (!session || !session.data) {
        logError('Loaded event received without session data')
        const err = new Error('Failed to load session')
        this.commsInterface?.notify({
          method: 'agentic/log',
          data: {
            level: 'error',
            message: `Failed to load session: ${err.message}`,
          },
        })
        return
      }

      logDebug(`Session loaded with ID ${session.data.id}`)
      this.stateManager?.setItem('session', session.data)

      this.commsInterface?.notify({
        method: 'agentic/log',
        data: {
          level: 'info',
          message: `Session loaded with ID ${session.data.id} and name ${session.data.name}`,
        },
      })
    })

    this.sessionManager.on('session.updated', (session) => {
      if (!session || !session.data) {
        logError('Updated event received without session data')
        return
      }

      logDebug(`Session with ID ${session.data.id} updated`)
      this.stateManager?.setItem('session', session.data)
      this.commsInterface?.notify({
        method: 'agentic/log',
        data: {
          level: 'info',
          message: `Session with ID ${session.data.id} updated`,
        },
      })
    })

    this.sessionManager.on('session.deleted', (sessionId) => {
      if (!sessionId || !sessionId.data) {
        logError('Deleted event received without session ID')
        return
      }
      logDebug(`Session with ID ${sessionId.data} deleted`)
      const currentSession = this.stateManager?.getItem('session')
      if (currentSession && currentSession.id === sessionId.data) {
        this.stateManager?.deleteItem('session')
      }
      this.commsInterface?.notify({
        method: 'agentic/log',
        data: {
          level: 'info',
          message: `Session with ID ${sessionId.data} deleted`,
        },
      })
    })

    this.sessionManager.on('session.completed', (session) => {
      if (!session || !session.data) {
        logError('Completed event received without session data')
        return
      }

      logDebug(`Session with ID ${session.data.id} completed`)
      this.stateManager?.setItem('session', session.data)
      this.commsInterface?.notify({
        method: 'agentic/log',
        data: {
          level: 'info',
          message: `Session with ID ${session.data.id} completed`,
        },
      })
    })

    this.sessionManager.on('session.suspended', (session) => {
      if (!session || !session.data) {
        logError('Suspended event received without session data')
        return
      }

      logDebug(`Session with ID ${session.data.id} suspended`)
      this.stateManager?.setItem('session', session.data)
      this.commsInterface?.notify({
        method: 'agentic/log',
        data: {
          level: 'info',
          message: `Session with ID ${session.data.id} suspended`,
        },
      })
    })

    this.sessionManager.on('session.turnActive', (session) => {
      if (!session || !session.data) {
        logError('TurnActive event received without session data')
        return
      }

      this.stateManager?.setItem('promptActive', session.data.active)
    })

    await this.sessionManager.init()
  }

  private async _initNewSession(
    params: ASMPayloadParams['client/new_session'],
  ) {
    if (!this.agentManager || !this.sessionManager) {
      throw new Error(
        'AgentManager or SessionManager not initialized. Cannot create session.',
      )
    }

    await this.sessionManager.createNewSession(
      params.sessionName,
      params.requestId,
    )
  }

  private _prepareSessionUpdateHandler() {
    if (!this.agentManager) {
      logError(
        'AgentManager not initialized. Cannot prepare SessionUpdateHandler.',
      )
      return
    }

    const sessionUpdateHandler = this.agentManager.getSessionUpdateHandler()

    sessionUpdateHandler.on(
      'available_commands_update',
      async (sessionId, update) => {
        this.stateManager?.setItem('availableCommands', {
          [sessionId]: update.availableCommands,
        })

        this.commsInterface?.notify({
          method: 'agentic/session_update',
          data: {
            sessionId,
            updateType: 'available_commands_update',
            update,
          },
        })
      },
    )

    sessionUpdateHandler.on(
      'config_option_update',
      async (sessionId, update) => {
        const currentSession = this.stateManager?.getItem('session')

        if (!currentSession || currentSession.id !== sessionId) {
          return
        }

        const updatedConfigOptions = [
          ...(currentSession.configOptions || []),
          update.configOptions,
        ].flat()

        this.stateManager?.setItem('session', {
          ...currentSession,
          configOptions: updatedConfigOptions,
        })

        this.commsInterface?.notify({
          method: 'agentic/session_update',
          data: {
            sessionId,
            updateType: 'config_option_update',
            update,
          },
        })
      },
    )

    sessionUpdateHandler.on(
      'current_mode_update',
      async (sessionId, update) => {
        const currentSession = this.stateManager?.getItem('session')

        if (
          !currentSession ||
          currentSession.id !== sessionId ||
          !currentSession.modes
        ) {
          return
        }

        this.stateManager?.setItem('session', {
          ...currentSession,
          modes: {
            ...currentSession.modes,
            currentModeId: update.currentModeId,
          },
        })

        this.commsInterface?.notify({
          method: 'agentic/session_update',
          data: {
            sessionId,
            updateType: 'current_mode_update',
            update,
          },
        })
      },
    )

    sessionUpdateHandler.on('plan', async (sessionId, update) => {
      this.commsInterface?.notify({
        method: 'agentic/session_update',
        data: {
          sessionId,
          updateType: 'plan',
          update,
        },
      })
    })

    sessionUpdateHandler.on('usage_update', async (sessionId, update) => {
      this.commsInterface?.notify({
        method: 'agentic/session_update',
        data: {
          sessionId,
          updateType: 'usage_update',
          update,
        },
      })
    })

    sessionUpdateHandler.on(
      'agent_thought_chunk',
      async (sessionId, update) => {
        this.commsInterface?.notify({
          method: 'agentic/session_update',
          data: {
            sessionId,
            updateType: 'agent_thought_chunk',
            update,
          },
        })
      },
    )

    sessionUpdateHandler.on(
      'agent_message_chunk',
      async (sessionId, update) => {
        this.commsInterface?.notify({
          method: 'agentic/session_update',
          data: {
            sessionId,
            updateType: 'agent_message_chunk',
            update,
          },
        })
      },
    )

    sessionUpdateHandler.on('tool_call', async (sessionId, update) => {
      this.commsInterface?.notify({
        method: 'agentic/session_update',
        data: {
          sessionId,
          updateType: 'tool_call',
          update,
        },
      })
    })

    sessionUpdateHandler.on('tool_call_update', async (sessionId, update) => {
      this.commsInterface?.notify({
        method: 'agentic/session_update',
        data: {
          sessionId,
          updateType: 'tool_call_update',
          update,
        },
      })
    })
  }

  private async _process_payload(payload: ASMPayload) {
    // Structural validation already done by Check(ASMPayloadSchema) before this call.
    const { method, params } = payload.data

    switch (method) {
      case 'client/init':
        await this._initAgentManager(params)
        break

      case 'client/new_session':
        await this._initNewSession(params)
        break

      case 'client/dispose':
        this.dispose()
        break

      case 'client/ask': {
        if (!this.sessionManager) {
          throw new Error(
            'SessionManager not initialized. Call client/init and client/new_session first.',
          )
        }

        const contentBlocks = await Promise.all(
          (params.contexts ?? []).map((ctx) =>
            createContentBlocks(params.prompt, ctx),
          ),
        )

        // If no contexts were provided, send the prompt as a single text block
        const blocks =
          contentBlocks.length > 0
            ? contentBlocks.flat()
            : [{ type: 'text' as const, text: params.prompt }]

        await this.sessionManager.prompt(blocks, undefined, params.requestId)
        this.commsInterface?.respond({
          method: 'client/ask',
          id: params.requestId,
          result: { success: true },
        })
        break
      }

      case 'client/answer':
        // In WebSocket mode, answers are intercepted at the comms layer.
        // In RPC mode, the readline question() call resolves directly.
        // If it has reached here, it means the questionId was not found in pendingQuestions, so we can return an error response.
        this.commsInterface?.respond({
          method: 'client/answer',
          id: params.requestId,
          error: {
            message: `No pending question found for questionId ${params.questionId}`,
          },
        })
        break

      case 'client/terminal':
        this.agentManager?.handleTerminalResponse(params)
        break

      case 'client/load_session': {
        if (!this.sessionManager) {
          throw new Error(
            'SessionManager not initialized. Call client/init first.',
          )
        }

        await this.sessionManager.loadSession(
          params.sessionId,
          params.requestId,
        )
        this.commsInterface?.respond({
          method: 'client/load_session',
          id: params.requestId,
          result: { success: true, sessionId: params.sessionId },
        })
        break
      }

      case 'client/rename_session': {
        if (!this.sessionManager) {
          throw new Error(
            'SessionManager not initialized. Call client/init first.',
          )
        }

        await this.sessionManager.renameSession(
          params.newName,
          params.sessionId,
          params.requestId,
        )
        this.commsInterface?.respond({
          method: 'client/rename_session',
          id: params.requestId,
          result: { success: true },
        })
        break
      }

      case 'client/delete_session': {
        if (!this.sessionManager) {
          throw new Error(
            'SessionManager not initialized. Call client/init first.',
          )
        }

        await this.sessionManager.deleteSession(
          params.sessionId,
          params.requestId,
        )
        this.commsInterface?.respond({
          method: 'client/delete_session',
          id: params.requestId,
          result: { success: true },
        })
        break
      }

      case 'client/archive_session': {
        if (!this.sessionManager) {
          throw new Error(
            'SessionManager not initialized. Call client/init first.',
          )
        }

        if (params.archive) {
          await this.sessionManager.archiveSession(
            params.sessionId,
            params.requestId,
            params.export,
          )
        } else {
          await this.sessionManager.unarchiveSession(
            params.sessionId,
            params.requestId,
          )
        }
        this.commsInterface?.respond({
          method: 'client/archive_session',
          id: params.requestId,
          result: { success: true },
        })
        break
      }

      case 'client/fork_session': {
        if (!this.sessionManager) {
          throw new Error(
            'SessionManager not initialized. Call client/init first.',
          )
        }

        await this.sessionManager.forkSession(
          params.sessionId,
          params.newName,
          params.requestId,
        )
        this.commsInterface?.respond({
          method: 'client/fork_session',
          id: params.requestId,
          result: { success: true },
        })
        break
      }

      case 'client/resume_session': {
        if (!this.sessionManager) {
          throw new Error(
            'SessionManager not initialized. Call client/init first.',
          )
        }

        await this.sessionManager.resumeSession(
          params.sessionId,
          params.requestId,
        )
        this.commsInterface?.respond({
          method: 'client/resume_session',
          id: params.requestId,
          result: { success: true, sessionId: params.sessionId },
        })
        break
      }

      case 'client/switch_session_mode': {
        if (!this.sessionManager) {
          throw new Error(
            'SessionManager not initialized. Call client/init first.',
          )
        }

        await this.sessionManager.switchSessionMode(
          params.sessionId,
          params.requestId,
        )
        this.commsInterface?.respond({
          method: 'client/switch_session_mode',
          id: params.requestId,
          result: { success: true },
        })
        break
      }

      case 'client/switch_model': {
        if (!this.sessionManager) {
          throw new Error(
            'SessionManager not initialized. Call client/init first.',
          )
        }

        await this.sessionManager.switchSessionModel(
          params.sessionId,
          params.requestId,
        )
        this.commsInterface?.respond({
          method: 'client/switch_model',
          id: params.requestId,
          result: { success: true },
        })
        break
      }

      case 'client/list_sessions': {
        if (!this.sessionManager) {
          throw new Error(
            'SessionManager not initialized. Call client/init first.',
          )
        }

        const sessions = this.sessionManager.listSessions()
        this.commsInterface?.respond({
          method: 'client/list_sessions',
          id: params.requestId,
          result: { success: true, sessions },
        })
        break
      }

      case 'client/export_session': {
        if (!this.sessionManager) {
          throw new Error(
            'SessionManager not initialized. Call client/init first.',
          )
        }

        const result = await this.sessionManager.exportSession(
          params.sessionId,
          params.outputPath,
        )
        this.commsInterface?.respond({
          method: 'client/export_session',
          id: params.requestId,
          result: result.result,
          error: result.error,
        })
        break
      }

      case 'client/import_session': {
        if (!this.sessionManager) {
          throw new Error(
            'SessionManager not initialized. Call client/init first.',
          )
        }

        const result = await this.sessionManager.importSession(params.filePath)
        this.commsInterface?.respond({
          method: 'client/import_session',
          id: params.requestId,
          result: result.result,
          error: result.error,
        })
        break
      }

      case 'client/stats': {
        if (!this.sessionManager) {
          throw new Error(
            'SessionManager not initialized. Call client/init first.',
          )
        }

        const result = await this.sessionManager.getStats(params.days)
        this.commsInterface?.respond({
          method: 'client/stats',
          id: params.requestId,
          result: result.result,
          error: result.error,
        })
        break
      }

      case 'client/index': {
        if (!this.indexerManager) {
          throw new error(
            'IndexerManager not initialized. Call client/init first.',
          )
        }

        this.indexerManager.runCommand('index', params.requestId)
        break
      }

      default:
        logWarning(`Unhandled method: ${(payload.data as any).method}`)
        break
    }
  }
}
