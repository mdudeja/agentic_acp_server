import { AgentManager } from 'src/managers/AgentManager'
import { Providers } from 'src/data/providers'
import { resolvePath } from 'src/utils/paths'
import { logDebug, logError, logInfo, logWarning } from 'src/utils/logger'
import { generateCatchblock, getNestedValue } from 'src/utils/helpers'
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
import { NesManager } from 'src/managers/NesManager'
import { loadConfig } from './config/loader'
import { McpServerManager } from './managers/McpServerManager'
import { IndexerManager } from './managers/IndexerManager'
import { error } from 'node:console'
import type { AgentCapabilities } from 'node_modules/@agentclientprotocol/sdk/dist/schema'
import type { NestedKeyOf } from './state/types'
import { MiscActionsManager } from './managers/MiscActionsManager'

export class AgenticServer {
  private stateManager: AppStateManager
  private commsInterface: ICommsInterface
  private agentManager: AgentManager | null = null
  private sessionManager: SessionManager | null = null
  private activeProvider: Providers | null = null
  private pendingInitMethod: 'client/init' | 'client/switch_provider' =
    'client/init'
  private nesManager: NesManager | null = null
  private mcpServerManager: McpServerManager | null = null
  private indexerManager: IndexerManager | null = null
  private miscActionsManager: MiscActionsManager | null = null
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
      await this._initMiscActionsManager()
      await this._initMcpServerManager()
      await this._initIndexerManager()
      await this._initSessionManager()
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
      nesManager: this.nesManager,
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

    if (this.nesManager) {
      this.nesManager.dispose()
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

  hasCapability(capability: NestedKeyOf<AgentCapabilities>) {
    const capabilities: AgentCapabilities | undefined =
      this.stateManager.getState().connection?.initResponse?.agentCapabilities

    if (!capabilities) {
      logError(
        'Agent capabilities not available. Either no agent available or client/init not run yet',
      )
      return
    }

    const val = getNestedValue(capabilities, capability)

    return val !== undefined && val !== null && val !== false
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
          `Failed to process incoming message for ${message}`,
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

  private async _initMiscActionsManager() {
    this.miscActionsManager = new MiscActionsManager(
      this.stateManager.getItem('workspaceRoot') ?? '',
      this,
    )

    this.miscActionsManager.on('action.queued', (action) => {
      this.commsInterface?.notify({
        method: 'agentic/log',
        data: {
          level: 'info',
          message: `Misc Actions Manager: ${action?.data} queued`,
        },
      })
    })

    this.miscActionsManager.on('action.started', (action) => {
      this.commsInterface?.notify({
        method: 'agentic/log',
        data: {
          level: 'info',
          message: `Misc Actions Manager: ${action?.data} started`,
        },
      })
    })

    this.miscActionsManager.on('action.completed', (action) => {
      this.commsInterface?.notify({
        method: 'agentic/log',
        data: {
          level: 'info',
          message: `Misc Actions Manager: ${action?.data} completed`,
        },
      })
    })

    await this.miscActionsManager.init()
  }

  /**
   * Tears down the active agent: disposes the manager (killing its process and
   * releasing handler listeners) and clears the agent/connection slots.
   */
  private async _teardownAgent(requestId?: string) {
    if (!this.agentManager) {
      return
    }
    await this.agentManager.dispose(requestId)
    this.agentManager = null
    this.activeProvider = null
    this.stateManager?.deleteItem('agent')
    this.stateManager?.deleteItem('connection')
  }

  private async _initAgentManager(
    params: ASMPayloadParams['client/init'],
    method: 'client/init' | 'client/switch_provider' = 'client/init',
  ) {
    const resolvedCwd = resolvePath(params.cwd)
    const providerId = (params.provider || 'copilot') as Providers

    logDebug(
      `Initializing agent with provider ${providerId} in directory ${resolvedCwd}`,
    )

    const isSameProvider =
      this.agentManager?.getProvider() === providerId &&
      this.agentManager?.getCwd() === resolvedCwd

    // Already active and connected: nothing to spawn — answer immediately.
    // (Re-running `init()` would emit `agent.loaded` → `spawn()` → early
    // return, so no `agent.connected` would ever fire and the caller would
    // hang.) The session list is still refreshed in case the DB changed.
    if (
      isSameProvider &&
      this.stateManager.getState().connection &&
      this.agentManager?.getAgent()?.process
    ) {
      this.stateManager.setItem('agent', this.agentManager.getAgent()!)
      await this._initSessionManager()
      this.commsInterface?.respond({
        method,
        id: params.requestId,
        result: {
          success: true,
          agentId: this.agentManager.getAgent()!.id,
        },
      })
      return
    }

    this.pendingInitMethod = method

    if (this.agentManager && !isSameProvider) {
      // Single-active-provider: a switch tears the previous agent down.
      logDebug(
        `Switching provider from ${this.agentManager.getProvider()} to ${providerId}`,
      )
      await this._teardownAgent(params.requestId)
    }

    if (!this.agentManager) {
      this.agentManager = new AgentManager(
        Providers[providerId],
        resolvedCwd,
        this,
      )
      this._prepareAgentEventHandlers()
      this._prepareSessionUpdateHandler()
    }

    this.activeProvider = providerId

    await this.agentManager.init(params.requestId)
  }

  /**
   * Registers the agent event handlers. Called once per `AgentManager`
   * instance (listeners live on the instance, so re-registering on a reused
   * manager would fire every event N times).
   */
  private _prepareAgentEventHandlers() {
    if (!this.agentManager) {
      return
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

      this.stateManager?.setItem('connection', connectData)
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

      this.stateManager?.setItem('agent', agent.data)

      // Initialise the session manager (loads/scopes this agent's sessions)
      // BEFORE responding, so a caller that immediately lists sessions does
      // not race the reload.
      await this._initSessionManager()

      this.commsInterface?.respond({
        method: this.pendingInitMethod,
        id: agent.requestId,
        result: { success: true, agentId: agent.data.id },
      })
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

  /**
   * Creates (once) and (re-)initialises the SessionManager.
   *
   * The manager is a singleton for the server's lifetime: listeners are wired
   * only on first construction, and subsequent calls simply re-`init()` it
   * against the now-active agent/connection (e.g. after a provider switch).
   */
  private async _initSessionManager() {
    if (!this.sessionManager) {
      this.sessionManager = new SessionManager(this)
      this._prepareSessionEventHandlers()
    }

    await this.sessionManager.init()

    if (this.stateManager.getItem('config')?.nes.enabled) {
      this._initNesManager()
    }
  }

  private _prepareSessionEventHandlers() {
    if (!this.sessionManager) {
      return
    }
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
  }

  private _initNesManager() {
    this.nesManager = new NesManager(this)
    this.nesManager.init()

    this.nesManager.on('nes.error', (errorMessage) => {
      logError(`NES error: ${errorMessage}`)
      this.commsInterface?.notify({
        method: 'agentic/log',
        data: {
          level: 'error',
          message: `NES error: ${errorMessage}`,
        },
      })
    })

    this.nesManager.on('nes.started', (payload) => {
      this.commsInterface?.notify({
        method: 'agentic/log',
        data: {
          level: 'info',
          message: `NES session started with ID ${payload?.data}`,
        },
      })
    })

    this.nesManager.on('nes.closed', (payload) => {
      this.commsInterface?.notify({
        method: 'agentic/log',
        data: {
          level: 'info',
          message: `NES session closed with ID ${payload?.data}`,
        },
      })
    })
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

        // Keep the tracked session (and DB) in sync with the agent's change.
        await this.sessionManager?.applyAgentUpdate(sessionId, {
          type: 'config_option_update',
          configOptions: update.configOptions,
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

        if (!currentSession || currentSession.id !== sessionId) {
          return
        }

        await this.sessionManager?.applyAgentUpdate(sessionId, {
          type: 'current_mode_update',
          currentModeId: update.currentModeId,
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

    sessionUpdateHandler.on('plan_update', async (sessionId, update) => {
      this.commsInterface?.notify({
        method: 'agentic/session_update',
        data: {
          sessionId,
          updateType: 'plan_update',
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

    sessionUpdateHandler.on('user_message_chunk', async (sessionId, update) => {
      this.commsInterface?.notify({
        method: 'agentic/session_update',
        data: {
          sessionId,
          updateType: 'user_message_chunk',
          update,
        },
      })
    })

    sessionUpdateHandler.on('plan_removed', async (sessionId, update) => {
      this.commsInterface?.notify({
        method: 'agentic/session_update',
        data: {
          sessionId,
          updateType: 'plan_removed',
          update,
        },
      })
    })

    sessionUpdateHandler.on(
      'session_info_update',
      async (sessionId, update) => {
        const currentSession = this.stateManager?.getItem('session')

        if (!currentSession || currentSession.id !== sessionId) {
          return
        }

        // Reflect title changes in the tracked session state.
        if (update.title !== undefined) {
          this.stateManager?.setItem('session', {
            ...currentSession,
            name: update.title ?? currentSession.name,
          })
        }

        this.commsInterface?.notify({
          method: 'agentic/session_update',
          data: {
            sessionId,
            updateType: 'session_info_update',
            update,
          },
        })
      },
    )

    sessionUpdateHandler.on('compaction_update', async (sessionId, update) => {
      this.commsInterface?.notify({
        method: 'agentic/session_update',
        data: {
          sessionId,
          updateType: 'compaction_update',
          update,
        },
      })
    })

    sessionUpdateHandler.on(
      'compaction_summary_chunk',
      async (sessionId, update) => {
        this.commsInterface?.notify({
          method: 'agentic/session_update',
          data: {
            sessionId,
            updateType: 'compaction_summary_chunk',
            update,
          },
        })
      },
    )
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

      case 'client/list_providers': {
        const state = this.stateManager.getState()
        const providers = Object.values(Providers).map((provider) => ({
          provider,
          active: this.activeProvider === provider,
          agentId:
            this.activeProvider === provider ? (state.agent?.id ?? null) : null,
          connected:
            this.activeProvider === provider && Boolean(state.connection),
        }))

        this.commsInterface?.respond({
          method: 'client/list_providers',
          id: params.requestId,
          result: { success: true, providers },
        })
        break
      }

      case 'client/switch_provider': {
        const state = this.stateManager.getState()
        const cwd = params.cwd ?? state.agent?.cwd ?? state.workspaceRoot
        const previousProvider = this.activeProvider

        if (!cwd) {
          this.commsInterface?.respond({
            method: 'client/switch_provider',
            id: params.requestId,
            result: { success: false },
            error: {
              message:
                'No cwd provided and none known from the active agent/workspace',
            },
          })
          break
        }

        try {
          await this._initAgentManager(
            {
              requestId: params.requestId,
              provider: params.provider,
              cwd,
            },
            'client/switch_provider',
          )
        } catch (error) {
          this.commsInterface?.respond({
            method: 'client/switch_provider',
            id: params.requestId,
            result: { success: false },
            error: {
              message: `Failed to switch provider: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          })
          break
        }

        this.commsInterface?.notify({
          method: 'agentic/log',
          data: {
            level: 'info',
            message: `Switched provider from ${previousProvider ?? 'none'} to ${params.provider}`,
          },
        })
        break
      }

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

        const result = await this.sessionManager.deleteSession(
          params.sessionId,
          params.requestId,
          params.source,
        )
        this.commsInterface?.respond({
          method: 'client/delete_session',
          id: params.requestId,
          result: result.result,
          error: result.error,
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

      case 'client/list_config_options': {
        if (!this.sessionManager) {
          throw new Error(
            'SessionManager not initialized. Call client/init first.',
          )
        }

        const result = this.sessionManager.listConfigOptions(params.sessionId)
        this.commsInterface?.respond({
          method: 'client/list_config_options',
          id: params.requestId,
          result: result.success
            ? {
                success: true,
                sessionId: result.sessionId,
                configOptions: result.configOptions,
              }
            : { success: false },
          error: result.success ? undefined : { message: result.error },
        })
        break
      }

      case 'client/set_config_option': {
        if (!this.sessionManager) {
          throw new Error(
            'SessionManager not initialized. Call client/init first.',
          )
        }

        const configOptions = await this.sessionManager.setSessionConfigOption(
          params.optionId,
          params.value,
          params.sessionId,
          params.requestId,
        )
        this.commsInterface?.respond({
          method: 'client/set_config_option',
          id: params.requestId,
          result: configOptions
            ? { success: true, configOptions }
            : { success: false },
          error: configOptions
            ? undefined
            : { message: `Config option ${params.optionId} not found` },
        })
        break
      }

      case 'client/list_sessions': {
        if (!this.sessionManager) {
          throw new Error(
            'SessionManager not initialized. Call client/init first.',
          )
        }

        const result = await this.sessionManager.listSessionsQueued(
          params.source,
        )
        this.commsInterface?.respond({
          method: 'client/list_sessions',
          id: params.requestId,
          result: result.result,
          error: result.error,
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
          params.source,
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

        const result = await this.sessionManager.importSession(
          params.filePath,
          params.source,
        )
        this.commsInterface?.respond({
          method: 'client/import_session',
          id: params.requestId,
          result: result.result,
          error: result.error,
        })
        break
      }

      case 'client/summarize_session': {
        if (!this.sessionManager) {
          throw new Error(
            'SessionManager not initialized. Call client/init first.',
          )
        }

        const result = await this.sessionManager.writeSessionSummary(
          params.sessionId,
        )
        this.commsInterface?.respond({
          method: 'client/summarize_session',
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

      case 'client/nes_start': {
        if (!this.nesManager) {
          throw new Error('NesManager not initialized. Call client/init first.')
        }

        const result = await this.nesManager.startNes(
          {
            workspaceUri: params.workspaceUri,
            workspaceFolders: params.workspaceFolders,
            repository: params.repository,
          },
          params.requestId,
        )
        this.commsInterface?.respond({
          method: 'client/nes_start',
          id: params.requestId,
          result: result
            ? { success: true, sessionId: result.sessionId }
            : { success: false },
        })
        break
      }

      case 'client/nes_suggest': {
        if (!this.nesManager) {
          throw new Error('NesManager not initialized. Call client/init first.')
        }

        const result = await this.nesManager.suggestNes(
          {
            sessionId: params.sessionId,
            uri: params.uri,
            version: params.version,
            position: params.position,
            selection: params.selection,
            triggerKind: params.triggerKind,
            context: params.context,
          },
          params.requestId,
        )
        this.commsInterface?.respond({
          method: 'client/nes_suggest',
          id: params.requestId,
          result: result
            ? { success: true, suggestions: result.suggestions }
            : { success: false },
        })
        break
      }

      case 'client/nes_close': {
        if (!this.nesManager) {
          throw new Error('NesManager not initialized. Call client/init first.')
        }

        const result = await this.nesManager.closeNes(
          params.sessionId,
          params.requestId,
        )
        this.commsInterface?.respond({
          method: 'client/nes_close',
          id: params.requestId,
          result: result ?? { success: false },
        })
        break
      }

      case 'client/nes_accept': {
        if (!this.nesManager) {
          throw new Error('NesManager not initialized. Call client/init first.')
        }

        const result = await this.nesManager.acceptNes(
          params.sessionId,
          params.id,
          params.requestId,
        )
        this.commsInterface?.respond({
          method: 'client/nes_accept',
          id: params.requestId,
          result: result ?? { success: false },
        })
        break
      }

      case 'client/nes_reject': {
        if (!this.nesManager) {
          throw new Error('NesManager not initialized. Call client/init first.')
        }

        const result = await this.nesManager.rejectNes(
          params.sessionId,
          params.id,
          params.reason,
          params.requestId,
        )
        this.commsInterface?.respond({
          method: 'client/nes_reject',
          id: params.requestId,
          result: result ?? { success: false },
        })
        break
      }

      case 'client/nes_did_open': {
        if (!this.nesManager) {
          throw new Error('NesManager not initialized. Call client/init first.')
        }

        await this.nesManager.didOpenDocument(
          {
            sessionId: params.sessionId,
            uri: params.uri,
            languageId: params.languageId,
            version: params.version,
            text: params.text,
          },
          params.requestId,
        )
        this.commsInterface?.respond({
          method: 'client/nes_did_open',
          id: params.requestId,
          result: { success: true },
        })
        break
      }

      case 'client/nes_did_change': {
        if (!this.nesManager) {
          throw new Error('NesManager not initialized. Call client/init first.')
        }

        await this.nesManager.didChangeDocument(
          {
            sessionId: params.sessionId,
            uri: params.uri,
            version: params.version,
            contentChanges: params.contentChanges,
          },
          params.requestId,
        )
        this.commsInterface?.respond({
          method: 'client/nes_did_change',
          id: params.requestId,
          result: { success: true },
        })
        break
      }

      case 'client/nes_did_close': {
        if (!this.nesManager) {
          throw new Error('NesManager not initialized. Call client/init first.')
        }

        await this.nesManager.didCloseDocument(
          params.sessionId,
          params.uri,
          params.requestId,
        )
        this.commsInterface?.respond({
          method: 'client/nes_did_close',
          id: params.requestId,
          result: { success: true },
        })
        break
      }

      case 'client/nes_did_save': {
        if (!this.nesManager) {
          throw new Error('NesManager not initialized. Call client/init first.')
        }

        await this.nesManager.didSaveDocument(
          params.sessionId,
          params.uri,
          params.requestId,
        )
        this.commsInterface?.respond({
          method: 'client/nes_did_save',
          id: params.requestId,
          result: { success: true },
        })
        break
      }

      case 'client/nes_did_focus': {
        if (!this.nesManager) {
          throw new Error('NesManager not initialized. Call client/init first.')
        }

        await this.nesManager.didFocusDocument(
          {
            sessionId: params.sessionId,
            uri: params.uri,
            version: params.version,
            position: params.position,
            visibleRange: params.visibleRange,
          },
          params.requestId,
        )
        this.commsInterface?.respond({
          method: 'client/nes_did_focus',
          id: params.requestId,
          result: { success: true },
        })
        break
      }

      default:
        logWarning(`Unhandled method: ${(payload.data as any).method}`)
        break
    }
  }
}
