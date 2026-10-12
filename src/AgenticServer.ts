import { AgentManager } from 'src/managers/AgentManager'
import { Providers } from 'src/data/providers'
import { resolvePath } from 'src/utils/paths'
import { logDebug, logError, logInfo } from 'src/utils/logger'
import { generateCatchblock, getNestedValue } from 'src/utils/helpers'
import type {
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
import { loadConfig } from 'src/config/loader'
import { McpServerManager } from 'src/managers/McpServerManager'
import { IndexerManager } from 'src/managers/IndexerManager'
import type { AgentCapabilities } from '@agentclientprotocol/sdk'
import type { NestedKeyOf } from 'src/state/types'
import { MiscActionsManager } from 'src/managers/MiscActionsManager'
import { HookManager } from 'src/hooks/HookManager'
import type { HookEventName, HookInput } from 'src/hooks/events'
import type { HookHost, HookRunOutcome } from 'src/hooks/types'
import type { HandlerContext, WiringDeps } from 'src/server/context'
import { dispatch } from 'src/server/dispatch'
import { notifyLog, respondWithError } from 'src/server/respond'
import { wireAgentEvents } from 'src/server/wiring/agent-events'
import { wireSessionEvents } from 'src/server/wiring/session-events'
import { wireSessionUpdates } from 'src/server/wiring/session-updates'
import {
  wireHookEvents,
  wireIndexerEvents,
  wireMcpEvents,
  wireMiscActionEvents,
  wireNesEvents,
} from 'src/server/wiring/manager-events'

/**
 * Owns the managers and the agent lifecycle. Incoming ASM requests are
 * routed by `src/server/dispatch.ts` to `src/server/handlers/*`; manager
 * events are turned into editor notifications by `src/server/wiring/*`.
 */
export class AgenticServer {
  private stateManager: AppStateManager
  private commsInterface: ICommsInterface
  private agentManager: AgentManager | null = null
  private sessionManager: SessionManager | null = null
  private activeProvider: Providers | null = null
  private nesManager: NesManager | null = null
  private mcpServerManager: McpServerManager | null = null
  private indexerManager: IndexerManager | null = null
  private miscActionsManager: MiscActionsManager | null = null
  private hookManager: HookManager | null = null
  private exitOnDispose: boolean
  private disposeOnCommsInterfaceClose: boolean
  private port?: number
  private disposing: Promise<void> | null = null
  private handlerContext: HandlerContext
  private wiringDeps: WiringDeps

  /** Upper bound on agent teardown during shutdown. */
  private static readonly DISPOSE_TIMEOUT_MS = 5000

  /** Initializes and configures an AgenticServer instance based on the provided configuration. */
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
    this.handlerContext = this._createHandlerContext()
    this.wiringDeps = {
      comms: this.commsInterface,
      state: this.stateManager,
      runHooks: (event, input) => this._runHooks(event, input),
    }
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
      await this._initHookManager()
      await this._initMiscActionsManager()
      this._initMcpServerManager()
      this._initIndexerManager()
      // Created now so requests before `client/init` get a clear "no active
      // session/agent" answer; it is initialised once an agent connects.
      this._ensureSessionManager()
    } catch (err) {
      generateCatchblock(
        this.commsInterface,
        err,
        'Failed to initialize Agentic Server',
      )
    }
  }

  /** Retrieves the communication interface for handling communication tasks. */
  getCommsInterface() {
    return this.commsInterface
  }

  /** Retrieves the current application state. */
  getState() {
    return this.stateManager.getState()
  }

  /** A method used to get all managers. */
  getManagers() {
    return {
      stateManager: this.stateManager,
      agentManager: this.agentManager,
      sessionManager: this.sessionManager,
      nesManager: this.nesManager,
      mcpServerManager: this.mcpServerManager,
      indexerManager: this.indexerManager,
      hookManager: this.hookManager,
    }
  }

  /** Sets the default model for a specified provider. This allows the provider to use the specified model by default for its operations. The optional requestId can be used to associate the setting with a particular request context. */
  setDefaultModelForProvider(
    provider: Providers,
    modelId: string,
    requestId?: string,
  ) {
    this.agentManager?.setDefaultModelForProvider(provider, modelId, requestId)
  }

  /** Retrieves the permission handler if available, otherwise returns undefined. */
  getPermissionHandler() {
    return this.agentManager?.getPermissionHandler()
  }

  /**
   * Shuts the server down. Idempotent: the comms `onClose` callback,
   * `client/dispose` and SIGINT can all trigger it, and they share one run.
   */
  dispose(): Promise<void> {
    this.disposing ??= this._dispose()
    return this.disposing
  }

  /** Disposes resources and performs cleanup. */
  private async _dispose() {
    // First, while everything is still up. Bounded by the hooks' timeouts.
    try {
      await this.hookManager?.run('server.shutdown', {
        workspaceRoot: this._workspaceRoot(),
      })
    } catch (error) {
      logError('server.shutdown hooks failed', error)
    }

    this.sessionManager?.dispose()
    this.nesManager?.dispose()
    this.mcpServerManager?.dispose()
    this.indexerManager?.dispose()

    // The agent must be stopped before exiting: its teardown drains in-flight
    // ACP requests, closes the connection and kills the process. It is
    // bounded so a wedged agent cannot block shutdown forever.
    if (this.agentManager) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          this.agentManager.dispose(),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, AgenticServer.DISPOSE_TIMEOUT_MS)
          }),
        ])
      } catch (error) {
        logError('Failed to dispose agent manager', error)
      } finally {
        clearTimeout(timer)
      }
      this.agentManager = null
    }

    this.hookManager?.dispose()

    // Comms and state go last: teardown above may still notify the editor
    // or read state.
    this.commsInterface?.dispose()
    this.stateManager.dispose()

    if (this.exitOnDispose) {
      process.exit(0)
    }
  }

  /** Checks if a specific capability exists. */
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

  /** Initializes the communication interface for establishing communication. */
  private _initCommsInterface() {
    this.commsInterface.init(this.port)

    this.commsInterface.onMessage(async (message: string) => {
      let raw: unknown
      try {
        raw = JSON.parse(message)

        if (!Check(ASMPayloadSchema, raw)) {
          const errs = [...Errors(ASMPayloadSchema, raw)]
            .map((e) => `  ${e.instancePath || '/'}: ${e.message}`)
            .join('\n')
          throw new Error(`Invalid payload:\n${errs}`)
        }
        await dispatch(raw, this.handlerContext)
      } catch (err) {
        generateCatchblock(
          this.commsInterface,
          err,
          `Failed to process incoming message for ${message}`,
        )
        respondWithError(this.commsInterface, raw, err)
      }
    })

    this.commsInterface.onClose(() => {
      if (this.disposeOnCommsInterfaceClose) {
        logInfo('Comms interface closed. Shutting down server...')
        this.dispose()
      }
    })
  }

  /** What ASM request handlers may use of the server (see `HandlerContext`). */
  private _createHandlerContext(): HandlerContext {
    /** Ensures the manager is not null; throws an error if it is. */
    const required = <T>(manager: T | null, error: string): T => {
      if (!manager) {
        throw new Error(error)
      }
      return manager
    }

    return {
      comms: this.commsInterface,
      state: this.stateManager,
      activeProvider: () => this.activeProvider,
      sessions: (hint = 'Call client/init first.') =>
        required(
          this.sessionManager,
          `SessionManager not initialized. ${hint}`,
        ),
      nes: () =>
        required(
          this.nesManager,
          'NesManager not initialized. Call client/init first.',
        ),
      hooks: () => required(this.hookManager, 'HookManager not initialized.'),
      indexer: () =>
        required(
          this.indexerManager,
          'IndexerManager not initialized. Call client/init first.',
        ),
      agent: () => this.agentManager,
      startProvider: (params, method) => this._initAgentManager(params, method),
      dispose: () => this.dispose(),
    }
  }

  /** Gets the root directory of the workspace. */
  private _workspaceRoot(): string {
    return this.stateManager.getItem('workspaceRoot') ?? process.cwd()
  }

  /** What hooks may use of the server (see `HookHost`). */
  private _hookHost(): HookHost {
    return {
      workspaceRoot: () => this._workspaceRoot(),
      config: () => this.stateManager.getItem('config'),
      provider: () => this.activeProvider,
      activeSession: () => {
        const session = this.stateManager.getItem('session')
        return session
          ? {
              id: session.id,
              acpSessionId: session.acp_session_id,
              name: session.name ?? null,
              status: session.status,
            }
          : null
      },
      notify: (level, message) => {
        try {
          notifyLog(this.commsInterface, level, message)
        } catch (error) {
          logError('Failed to send hook notification', error)
        }
      },
      ask: (question, options, signal) =>
        this.commsInterface.question(
          { questionId: 'hook_question', question, options },
          { signal },
        ),
      cancelTurn: async (sessionId) => {
        await this.sessionManager?.cancelTurn(sessionId)
      },
    }
  }

  /**
   * Loads hooks (built-ins, global and trusted project files; untrusted
   * project files wait for `client/init`) and announces hook decisions and
   * failures to the editor as `agentic/hook`.
   */
  private async _initHookManager() {
    this.hookManager = new HookManager(
      this.stateManager.getItem('workspaceRoot')!,
      this._hookHost(),
    )
    wireHookEvents(this.hookManager, this.commsInterface)

    const summary = await this.hookManager.load()
    if (summary.pendingTrust.length > 0) {
      notifyLog(
        this.commsInterface,
        'info',
        `${summary.pendingTrust.length} project hook file(s) need your approval; you will be asked on client/init.`,
      )
    }

    void this._runHooks('server.start', {
      workspaceRoot: this._workspaceRoot(),
    })
  }

  /** Runs hooks, never throwing into the caller's flow. */
  private async _runHooks<E extends HookEventName>(
    event: E,
    input: HookInput<E>,
  ): Promise<HookRunOutcome<E>> {
    if (!this.hookManager) {
      return { input }
    }

    try {
      return await this.hookManager.run(event, input)
    } catch (error) {
      logError(`Hooks for ${event} failed`, error)
      return { input }
    }
  }

  /** Initialize the management of miscellaneous actions. */
  private async _initMiscActionsManager() {
    this.miscActionsManager = new MiscActionsManager(
      this.stateManager.getItem('workspaceRoot') ?? '',
      this,
    )
    wireMiscActionEvents(this.miscActionsManager, this.commsInterface)

    await this.miscActionsManager.init()
  }

  /** Initialize the MCP server manager. */
  private _initMcpServerManager() {
    this.mcpServerManager = new McpServerManager(this)
    // Listeners before `init()`: it can emit synchronously.
    wireMcpEvents(this.mcpServerManager, this.commsInterface)
    this.mcpServerManager.init()
  }

  /** Initializes the indexer manager to manage indexes. */
  private _initIndexerManager() {
    this.indexerManager = new IndexerManager(this)
    // Listeners before `init()`: it emits `indexer.ready` synchronously.
    wireIndexerEvents(this.indexerManager, this.commsInterface)
    this.indexerManager.init()

    // Background indexing at startup; failures are reported via `indexer.error`.
    this.indexerManager.runCommand('index').catch((error) => {
      logError('Indexer run failed', error)
    })
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

  /**
   * Starts (or reuses) the agent for `(provider, cwd)` and answers the
   * request. Returns whether the agent is connected.
   *
   * The steps run as one awaited sequence (load → spawn → connect → session
   * init) so that any failure is answered with an error instead of leaving
   * the editor waiting for a response that never comes.
   */
  private async _initAgentManager(
    params: ASMPayloadParams['client/init'],
    method: 'client/init' | 'client/switch_provider' = 'client/init',
  ): Promise<boolean> {
    const resolvedCwd = resolvePath(params.cwd)
    const providerId = (params.provider || 'copilot') as Providers

    logDebug(
      `Initializing agent with provider ${providerId} in directory ${resolvedCwd}`,
    )

    // Project hook files found at startup are asked about here, once an
    // editor is attached to answer, and before the agent starts (so their
    // `agent.beforeSpawn` hooks apply).
    if (this.hookManager?.pendingTrust().length) {
      await this.hookManager.resolvePendingTrust()
    }

    const isSameProvider =
      this.agentManager?.getProvider() === providerId &&
      this.agentManager?.getCwd() === resolvedCwd

    // Already active and connected: nothing to spawn — answer immediately.
    // The session list is still refreshed in case the DB changed.
    if (
      isSameProvider &&
      this.stateManager.getState().connection &&
      this.agentManager?.isAlive()
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
      return true
    }

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
      // Once per instance: listeners live on the manager.
      wireAgentEvents(this.agentManager, this.wiringDeps)
      wireSessionUpdates(this.agentManager, {
        ...this.wiringDeps,
        sessions: () => this.sessionManager,
      })
    }

    this.activeProvider = providerId

    try {
      const agentId = await this._startAgent(params.requestId)

      this.commsInterface?.respond({
        method,
        id: params.requestId,
        result: { success: true, agentId },
      })
      return true
    } catch (error) {
      // Don't leave a half-started process behind; the next init starts clean.
      await this._teardownAgent(params.requestId)

      const message = error instanceof Error ? error.message : String(error)
      logError(`Failed to start ${providerId} agent: ${message}`)
      this.commsInterface?.respond({
        method,
        id: params.requestId,
        result: { success: false },
        error: { message: `Failed to start ${providerId} agent: ${message}` },
      })
      return false
    }
  }

  /**
   * Loads, spawns and connects the current `AgentManager`, then initialises
   * the session manager against it. Throws on any failure; the detailed
   * reason has already been reported through `agent.error`.
   */
  private async _startAgent(requestId?: string): Promise<string> {
    const agentManager = this.agentManager!

    await agentManager.init(requestId)
    const agent = agentManager.getAgent()
    if (!agent) {
      throw new Error('Failed to load agent')
    }

    const spawn = await this._runHooks('agent.beforeSpawn', {
      provider: agent.provider_name,
      cwd: agent.cwd,
      command: agent.provider_command,
      args: agent.provider_args,
      env: agent.env ?? {},
    })
    if (spawn.decision === 'deny') {
      throw new Error(
        `Agent start blocked by hook ${spawn.decidedBy}: ${spawn.reason ?? 'no reason given'}`,
      )
    }

    agentManager.spawn(requestId, {
      command: spawn.input.command,
      args: spawn.input.args,
      env: spawn.input.env,
    })
    if (!agentManager.isAlive()) {
      throw new Error(`Failed to spawn \`${spawn.input.command}\``)
    }

    const connection = await agentManager.connect(requestId)
    if (!connection) {
      throw new Error('Failed to connect to agent')
    }

    // `cli_inited` marks that the first connect of this agent was handled
    // (the `projectInit` built-in runs the provider's init on it).
    const firstConnect = !agent.cli_inited
    void this._runHooks('agent.connected', {
      provider: agent.provider_name,
      agentId: agent.id,
      cwd: agent.cwd,
      firstConnect,
    })
    if (firstConnect) {
      await agentManager.setCliInited(requestId)
    }

    // Initialise the session manager (loads/scopes this agent's sessions)
    // BEFORE responding, so a caller that immediately lists sessions does
    // not race the reload.
    await this._initSessionManager()

    return agent.id
  }

  /**
   * Creates (once) and (re-)initialises the SessionManager.
   *
   * The manager is a singleton for the server's lifetime: listeners are wired
   * only on first construction, and subsequent calls simply re-`init()` it
   * against the now-active agent/connection (e.g. after a provider switch).
   */
  private async _initSessionManager() {
    await this._ensureSessionManager().init()

    if (this.stateManager.getItem('config')?.nes.enabled) {
      this._initNesManager()
    }
  }

  /** Creates the SessionManager singleton (and its listeners) on first use. */
  private _ensureSessionManager(): SessionManager {
    if (!this.sessionManager) {
      this.sessionManager = new SessionManager(this)
      wireSessionEvents(this.sessionManager, this.wiringDeps)
    }

    return this.sessionManager
  }

  /**
   * Creates the NesManager once and (re-)points it at the current
   * connection. Called on every session-manager init (init, idempotent init,
   * provider switch), so listeners must only be attached on creation.
   */
  private _initNesManager() {
    if (!this.nesManager) {
      this.nesManager = new NesManager(this)
      wireNesEvents(this.nesManager, this.commsInterface)
    }

    if (this.stateManager.getState().connection) {
      this.nesManager.init()
    }
  }
}
