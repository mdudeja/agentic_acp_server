import { and, desc, eq } from 'drizzle-orm'
import type { AgenticServer } from 'src/AgenticServer'
import { join } from 'node:path'
import { createProviderCLI } from 'src/cli/factory'
import type { CLIProvider } from 'src/cli/types'
import { AgenticDB } from 'src/database/AgenticDB'
import { sessions, SessionStatus, type Session } from 'src/database/schemas'
import type { AppState, TrackedSession } from 'src/state/types'
import { BaseManager } from './BaseManager'
import type { SessionEvents } from 'src/data/events'
import { logWarning } from 'src/utils/logger'
import {
  methods,
  RequestError,
  type ContentBlock,
  type McpServer,
  type NewSessionResponse,
  type SessionConfigOption,
  type SessionConfigSelect,
} from '@agentclientprotocol/sdk'

type TrackedConnection = NonNullable<AppState['connection']>

export class SessionManager extends BaseManager<SessionEvents> {
  private db: ReturnType<AgenticDB['getDB']>
  private sessions: Map<string, TrackedSession> = new Map()
  private connection: TrackedConnection | null = null
  private activeSessionId: string | null = null
  private providerCLI: CLIProvider | null = null

  /**
   * Guards against looping on an auth failure: set once we have already
   * retried session creation after authenticating, and reset on success.
   */
  private retriedAfterAuth: boolean = false

  constructor(private readonly server_instance: AgenticServer) {
    super()
    const dbInstance = AgenticDB.getInstance()
    this.db = dbInstance.getDB()
  }

  /**
   * Returns the list of MCP servers (from config + indexer) formatted for ACP
   * session lifecycle requests.
   */
  private _mcpServers(): McpServer[] {
    return (
      this.server_instance
        .getManagers()
        .mcpServerManager?.getMcpServers()
        .map((v) => ({ ...v, env: [] })) ?? []
    )
  }

  async init() {
    const currentAgent = this.server_instance.getState().agent

    if (!currentAgent) {
      this.emit('session.error', 'No active agent found in state')
      return
    }

    const availableSessions = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.agent_id, currentAgent.id))
      .orderBy(desc(sessions.created_at))

    availableSessions.forEach((session) => {
      this.sessions.set(session.id, session)
    })

    const connection = this.server_instance.getState()?.connection

    if (!connection) {
      this.emit(
        'session.error',
        '1. No active connection found. Please use `client/init` command first.',
      )
      return
    }

    this.connection = connection

    this.providerCLI = createProviderCLI(
      currentAgent.provider_name,
      currentAgent.cwd,
    )

    if (this.providerCLI && !currentAgent.cli_inited) {
      await this.providerCLI.init()
      const { agentManager } = this.server_instance.getManagers()
      await agentManager?.setCliInited()
    }
  }

  async createNewSession(name?: string, requestId?: string) {
    const currentAgent = this.server_instance.getState().agent

    if (!currentAgent) {
      this.emit('session.error', 'No active agent found in state')
      return
    }

    if (this.activeSessionId) {
      await this.suspendCurrentSession(requestId)
    }

    const newSession = await this._createAcpSession(currentAgent, requestId)

    if (!newSession) {
      this.emit('session.error', 'Failed to create new session')
      return
    }

    const sessionRecord: Session['Insert'] = {
      agent_id: currentAgent.id,
      acp_session_id: newSession.sessionId,
      name: name || `Session ${this.sessions.size + 1}`,
    }

    const insertedSession = await this.db
      .insert(sessions)
      .values(sessionRecord)
      .returning()
      .then((res) => res[0])

    if (!insertedSession) {
      this.emit('session.error', 'Failed to insert new session into database')
      return
    }

    const trackedSession: TrackedSession = {
      ...insertedSession,
      modes: newSession.modes ?? null,
      configOptions: newSession.configOptions ?? null,
    }

    this.sessions.set(insertedSession.id, trackedSession)
    this.activeSessionId = insertedSession.id
    this.server_instance
      .getManagers()
      .stateManager?.setItem('session', trackedSession)

    const createdSession = this.sessions.get(insertedSession.id)!

    this.emit('session.created', {
      requestId,
      data: createdSession,
    })

    const activeAgent = this.server_instance.getState().agent

    if (activeAgent && activeAgent.default_model_id) {
      await this._setSessionModel(
        createdSession,
        activeAgent.default_model_id,
        requestId,
      )
    }
    this.emit('session.loaded', {
      requestId,
      data: createdSession,
    })
  }

  async suspendCurrentSession(requestId?: string) {
    if (!this.activeSessionId) {
      this.emit('session.error', 'No active session to suspend')
      return
    }

    const session = this.sessions.get(this.activeSessionId)
    if (!session) {
      this.emit('session.error', 'Session to suspend not found')
      return
    }
    const suspendedId = this.activeSessionId
    await this._updateSession(
      'status',
      SessionStatus.suspended,
      suspendedId,
      requestId,
    )
    this.activeSessionId = null
    // Emit the post-update record (the persisted/updated status), not the
    // stale object read before `_updateSession` replaced it in the map.
    this.emit('session.suspended', {
      requestId,
      data: this.sessions.get(suspendedId) ?? session,
    })
  }

  async renameSession(newName: string, id?: string, requestId?: string) {
    await this._updateSession('name', newName, id, requestId)
  }

  //  TODO: Trigger cleanup of any resources associated with the session (e.g. exported session files, CLI sessions)
  async deleteSession(id: string, requestId?: string) {
    const session = this.sessions.get(id)

    if (!session) {
      this.emit('session.error', `Session with ID ${id} not found`)
      return
    }

    if (this.server_instance.hasCapability('sessionCapabilities.delete')) {
      try {
        await this.connection!.clientContext.request(
          methods.agent.session.delete,
          { sessionId: session.acp_session_id },
        )
      } catch (error) {
        this.emit('session.error', `Failed to delete session via ACP: ${error}`)
        return
      }
    } else if (this.providerCLI) {
      const result = await this.providerCLI.deleteSession(
        session.acp_session_id,
      )
      if (!result.success) {
        logWarning(
          `[SessionManager] CLI session deletion failed: ${result.stderr}`,
        )
      }
    }

    await this.db.delete(sessions).where(eq(sessions.id, id))
    this.sessions.delete(id)

    this.emit('session.deleted', { requestId, data: id })
  }

  async archiveSession(
    id: string,
    requestId?: string,
    exportBeforeArchive?: boolean,
  ) {
    const session = this.sessions.get(id)

    if (!session) {
      this.emit('session.error', `Session with ID ${id} not found`)
      return
    }

    // Best-effort export before archiving
    if (exportBeforeArchive) {
      await this.exportSession(id)
    }

    await this._updateSession('is_archived', true, id, requestId)
  }

  async unarchiveSession(id: string, requestId?: string) {
    const session = this.sessions.get(id)

    if (!session) {
      this.emit('session.error', `Session with ID ${id} not found`)
      return
    }

    await this._updateSession('is_archived', false, id, requestId)
  }

  async loadSession(id: string, requestId?: string) {
    const session = this.sessions.get(id)

    if (!session) {
      this.emit('session.error', `Session with ID ${id} not found`)
      return
    }

    if (!this.server_instance.hasCapability('loadSession')) {
      this.emit(
        'session.error',
        'The connected server does not support loading sessions. Please create a new session instead.',
      )
      return
    }

    if (this.activeSessionId) {
      await this.suspendCurrentSession(requestId)
    }

    const currentAgent = this.server_instance.getState().agent

    if (!currentAgent) {
      this.emit('session.error', 'No active agent found in state')
      return
    }

    const loaded = await this.connection!.clientContext.request(
      methods.agent.session.load,
      {
        cwd: currentAgent.cwd,
        mcpServers: this._mcpServers(),
        sessionId: session.acp_session_id,
      },
    )
    this.activeSessionId = id
    await this._updateSession('status', SessionStatus.active, id, requestId)

    const loadedSession: TrackedSession = {
      ...session,
      configOptions: loaded.configOptions ?? session.configOptions,
      modes: loaded.modes ?? session.modes,
    }
    this.sessions.set(id, loadedSession)

    this.emit('session.loaded', {
      requestId,
      data: loadedSession,
    })
  }

  async forkSession(sessionId: string, newName?: string, requestId?: string) {
    const sessionToFork = this.sessions.get(sessionId)

    if (!this.server_instance.hasCapability('sessionCapabilities.fork')) {
      this.emit(
        'session.error',
        'The connected server does not support forking sessions. Please create a new session instead.',
      )
      return
    }

    const currentAgent = this.server_instance.getState().agent

    if (!currentAgent) {
      this.emit('session.error', 'No active agent found in state')
      return
    }

    await this._updateSession(
      'status',
      SessionStatus.suspended,
      sessionId,
      requestId,
    )

    const forkedSession = await this.connection!.clientContext.request(
      methods.agent.session.fork,
      {
        sessionId: sessionToFork!.acp_session_id,
        cwd: currentAgent.cwd,
        mcpServers: this._mcpServers(),
      },
    )

    const sessionRecord: Session['Insert'] = {
      agent_id: currentAgent.id,
      acp_session_id: forkedSession.sessionId,
      name: newName ?? `(Fork) ${sessionToFork!.name ?? sessionToFork!.id}`,
    }

    const insertedSession = await this.db
      .insert(sessions)
      .values(sessionRecord)
      .returning()
      .then((res) => res[0])

    if (!insertedSession) {
      this.emit(
        'session.error',
        'Failed to insert forked session into database',
      )
      return
    }

    this.activeSessionId = insertedSession.id

    const forkedSessionData: TrackedSession = {
      ...insertedSession,
      configOptions:
        forkedSession.configOptions ?? sessionToFork?.configOptions ?? null,
      modes: forkedSession.modes ?? sessionToFork?.modes ?? null,
    }
    this.sessions.set(insertedSession.id, forkedSessionData)
    // `setItem` (not `updateItem`) — the previous active session may already
    // have been cleared, and `updateItem` throws on a missing key.
    this.server_instance
      .getManagers()
      .stateManager?.setItem('session', forkedSessionData)

    await this._updateSession(
      'status',
      SessionStatus.active,
      insertedSession.id,
      requestId,
    )
    this.emit('session.loaded', {
      requestId,
      data: forkedSessionData,
    })
  }

  async resumeSession(id: string, requestId?: string) {
    const session = this.sessions.get(id)

    if (!session) {
      this.emit('session.error', `Session with ID ${id} not found`)
      return
    }

    if (session.status === SessionStatus.active) {
      this.emit('session.error', `Session with ID ${id} is already active`)
      return
    }

    if (session.status === SessionStatus.completed) {
      this.emit(
        'session.error',
        `Session with ID ${id} is completed and cannot be resumed`,
      )
      return
    }

    if (!this.server_instance.hasCapability('sessionCapabilities.resume')) {
      this.emit(
        'session.error',
        'The connected server does not support resuming sessions. Please load the session instead.',
      )
      return
    }

    const currentAgent = this.server_instance.getState().agent

    if (!currentAgent) {
      this.emit('session.error', 'No active agent found in state')
      return
    }

    const resumedSession = await this.connection!.clientContext.request(
      methods.agent.session.resume,
      {
        sessionId: session.acp_session_id,
        cwd: currentAgent.cwd,
        mcpServers: this._mcpServers(),
      },
    )

    this.activeSessionId = id
    const resumedSessionData: TrackedSession = {
      ...session,
      configOptions: resumedSession.configOptions ?? session.configOptions,
      modes: resumedSession.modes ?? session.modes,
    }
    this.sessions.set(id, resumedSessionData)
    await this._updateSession('status', SessionStatus.active, id, requestId)
    this.emit('session.loaded', {
      requestId,
      data: resumedSessionData,
    })
  }

  async switchSessionMode(id?: string, requestId?: string) {
    const sessionId = id || this.activeSessionId

    if (!sessionId) {
      this.emit('session.error', 'No active session ID found to switch mode')
      return
    }

    const session = this.sessions.get(sessionId)

    if (!session) {
      this.emit('session.error', `Session with ID ${sessionId} not found`)
      return
    }

    const availableModes =
      session.modes?.availableModes ||
      session.configOptions
        ?.filter((op) => op.category === 'mode')
        .flatMap((op) =>
          (op as SessionConfigSelect).options?.map((opt) => ({
            name: opt.name as string,
            id: opt.value as string,
            description: opt.description ?? undefined,
          })),
        )

    if (!availableModes || availableModes.length === 0) {
      this.emit('session.error', 'No available modes found for this session')
      return
    }

    const selectedMode = await this.server_instance
      .getCommsInterface()
      .question({
        questionId: 'select_session_mode',
        question: `Please select a mode for this session:\n${availableModes
          ?.map(
            (mode, index) => `${index + 1}. ${mode.name} - ${mode.description}`,
          )
          .join('\n')}`,
      })

    const selectedIndex = parseInt(selectedMode) - 1

    if (
      isNaN(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex >= (availableModes?.length ?? 0)
    ) {
      this.emit('session.error', 'Invalid selection for session mode')
      return
    }

    const modeId = availableModes![selectedIndex]?.id

    await this._setSessionMode(session, modeId!, requestId)
  }

  async switchSessionModel(id?: string, requestId?: string) {
    const sessionId = id || this.activeSessionId

    if (!sessionId) {
      this.emit('session.error', 'No active session ID found to switch model')
      return
    }

    const session = this.sessions.get(sessionId)

    if (!session) {
      this.emit('session.error', `Session with ID ${sessionId} not found`)
      return
    }

    const availableModels = session.configOptions
      ?.filter((op) => op.category === 'model')
      .flatMap((op) =>
        (op as SessionConfigSelect).options?.map((opt) => ({
          name: opt.name as string,
          modelId: opt.value as string,
          description: opt.description ?? undefined,
        })),
      )

    if (!availableModels || availableModels.length === 0) {
      this.emit('session.error', 'No available models found for this session')
      return
    }

    const selectedModel = await this.server_instance
      .getCommsInterface()
      .question({
        questionId: 'select_session_model',
        question: `Please select a model for this session:\n${availableModels
          ?.map(
            (model, index) =>
              `${index + 1}. ${model.name} - ${model.description}`,
          )
          .join('\n')}`,
      })

    const selectedIndex = parseInt(selectedModel) - 1

    if (
      isNaN(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex >= (availableModels?.length ?? 0)
    ) {
      this.emit('session.error', 'Invalid selection for session model')
      return
    }

    const modelId = availableModels![selectedIndex]?.modelId

    await this._setSessionModel(session, modelId!, requestId)
  }

  /**
   * Finds a config option by its `id` first, then by its semantic `category`
   * (e.g. `'mode'`, `'model'`, `'model_config'`). The ACP schema only pins down
   * `category`; the `id` is agent-chosen, so callers that know the meaning of
   * the option should resolve it by category.
   */
  private _findConfigOption(
    session: TrackedSession,
    idOrCategory: string,
  ): SessionConfigOption | undefined {
    return (
      session.configOptions?.find((op) => op.id === idOrCategory) ??
      session.configOptions?.find((op) => op.category === idOrCategory)
    )
  }

  /**
   * Sets a session config option. `optionIdOrCategory` matches by `id` first,
   * then by `category`.
   *
   * Returns `true` when the option was found and applied, `false` when the
   * session/option was not found — callers can use this to avoid persisting a
   * selection that never reached the wire.
   */
  async setSessionConfigOption(
    optionIdOrCategory: string,
    value: any,
    id?: string,
  ): Promise<boolean> {
    const sessionId = id || this.activeSessionId

    if (!sessionId) {
      this.emit(
        'session.error',
        'No active session ID found to set config option',
      )
      return false
    }

    const session = this.sessions.get(sessionId)

    if (!session) {
      this.emit('session.error', `Session with ID ${sessionId} not found`)
      return false
    }

    const configOption = this._findConfigOption(session, optionIdOrCategory)

    if (!configOption) {
      this.emit(
        'session.error',
        `Config option ${optionIdOrCategory} not found for this session`,
      )
      return false
    }

    // Send the agent-chosen `id`, never the category we resolved it by.
    if (configOption.type === 'boolean') {
      await this.connection!.clientContext.request(
        methods.agent.session.setConfigOption,
        {
          configId: configOption.id,
          sessionId: session.acp_session_id,
          type: 'boolean',
          value: Boolean(value),
        },
      )
      return true
    }

    await this.connection!.clientContext.request(
      methods.agent.session.setConfigOption,
      {
        configId: configOption.id,
        sessionId: session.acp_session_id,
        value: String(value),
      },
    )
    return true
  }

  async exportSession(
    id: string,
    outputPath?: string,
  ): Promise<{
    result: { success: boolean; filePath?: string }
    error?: string
  }> {
    const session = this.sessions.get(id)
    if (!session) {
      return {
        result: { success: false },
        error: `Session with ID ${id} not found`,
      }
    }

    if (!this.providerCLI) {
      return {
        result: { success: false },
        error: 'No CLI provider available for this provider',
      }
    }
    const cwd = this.server_instance.getState().agent?.cwd
    const config = this.server_instance.getState().config ?? null
    const resolvedPath =
      outputPath ??
      (cwd && config
        ? join(
            cwd,
            config.sessions.memoryPath,
            `${session.acp_session_id}.json`,
          )
        : undefined)
    if (!resolvedPath) {
      return {
        result: { success: false },
        error: 'Cannot determine output path and no default configured',
      }
    }
    const result = await this.providerCLI.exportSession(
      session.acp_session_id,
      resolvedPath,
    )
    return {
      result: {
        success: result.success,
        filePath: result.success ? resolvedPath : undefined,
      },
      error: result.success ? undefined : result.stderr,
    }
  }

  //TODO: Investigate whether this creates a new session. If so, what's the id of that session
  async importSession(
    filePath: string,
  ): Promise<{ result: { success: boolean }; error?: string }> {
    if (!this.providerCLI) {
      return {
        result: { success: false },
        error: 'No CLI provider available for this provider',
      }
    }
    const result = await this.providerCLI.importSession(filePath)
    return {
      result: { success: result.success },
      error: result.success ? undefined : result.stderr,
    }
  }

  async getStats(
    days?: number,
  ): Promise<{ result: { success: boolean; data?: unknown }; error?: string }> {
    if (!this.providerCLI) {
      return {
        result: { success: false },
        error: 'No CLI provider available for this provider',
      }
    }
    const result = await this.providerCLI.stats({ days })
    return {
      result: {
        success: result.success,
        data: result.success ? result.data : undefined,
      },
      error: result.success ? undefined : result.stderr,
    }
  }

  listSessions() {
    return Array.from(this.sessions.values()).map((session) => ({
      id: session?.id,
      name: session?.name,
      status: session?.status,
      mode: session?.modes?.currentModeId,
    }))
  }

  /**
   * Lists sessions from the agent over ACP (`session/list`), falling back to
   * the provider CLI when the agent does not advertise the `session/list`
   * capability. Returns the parsed CLI output when available.
   */
  async listSessionsFromAgent(): Promise<{
    result: { success: boolean; sessions?: unknown }
    error?: string
  }> {
    if (this.server_instance.hasCapability('sessionCapabilities.list')) {
      try {
        const resp = await this.connection!.clientContext.request(
          methods.agent.session.list,
          {},
        )
        return {
          result: { success: true, sessions: resp.sessions },
        }
      } catch (error) {
        return {
          result: { success: false },
          error: `Failed to list sessions via ACP: ${error}`,
        }
      }
    }

    if (!this.providerCLI) {
      return {
        result: { success: false },
        error: 'No CLI provider available for this provider',
      }
    }

    const result = await this.providerCLI.listSessions()
    return {
      result: { success: result.success, sessions: result.data },
      error: result.success ? undefined : result.stderr,
    }
  }

  async prompt(prompt: ContentBlock[], id?: string, requestId?: string) {
    const sessionId = id || this.activeSessionId

    if (!sessionId) {
      this.emit('session.error', 'No active session ID found to send prompt')
      return
    }

    const session = this.sessions.get(sessionId)

    if (!session) {
      this.emit('session.error', `Session with ID ${sessionId} not found`)
      return
    }

    this.emit('session.turnActive', {
      requestId: requestId,
      data: {
        id: sessionId,
        active: true,
      },
    })

    const resp = await this.connection!.clientContext.request(
      methods.agent.session.prompt,
      {
        sessionId: session.acp_session_id,
        prompt,
      },
    )

    this.emit('session.turnActive', {
      requestId: requestId,
      data: {
        id: sessionId,
        active: false,
        stopReason: resp.stopReason,
        usage: resp.usage,
      },
    })
  }

  async cancelTurn(id?: string, requestId?: string) {
    const sessionId = id || this.activeSessionId

    if (!sessionId) {
      this.emit('session.error', 'No active session ID found to cancel turn')
      return
    }

    const session = this.sessions.get(sessionId)

    if (!session) {
      this.emit('session.error', `Session with ID ${sessionId} not found`)
      return
    }

    await this.connection!.clientContext.notify(methods.agent.session.cancel, {
      sessionId: session.acp_session_id,
    })

    this.server_instance.getPermissionHandler()?.rejectAllPending(sessionId)

    this.emit('session.turnActive', {
      requestId: requestId,
      data: {
        id: sessionId,
        active: false,
        stopReason: 'cancelled',
      },
    })
  }

  dispose() {
    this.removeAllListeners()
    this.sessions.clear()
    this.activeSessionId = null
    this.connection = null
  }

  private async _authenticate() {
    if (!this.connection) {
      this.emit(
        'session.error',
        '2. No active connection found. Please use `client/init` command first.',
      )
      return
    }

    if (!this.server_instance.hasCapability('auth')) {
      this.emit(
        'session.error',
        'The server does not have authentication capabilities. Please login outside this application',
      )
    }

    const authMethods = this.connection.initResponse.authMethods

    if (!authMethods || authMethods.length === 0) {
      this.emit(
        'session.error',
        'No authentication methods available from the server.',
      )
      return
    }

    let selectedMethod = authMethods[0]

    if (authMethods.length > 1) {
      const options = authMethods.map((method) => ({
        label: method.name,
        description: method.description,
        value: method,
      }))

      const userResponse = await this.server_instance
        .getCommsInterface()
        .question({
          questionId: 'select_auth_method',
          question: `Multiple authentication methods are available. Please select one:
        ${options.map((option, index) => `${index + 1}. ${option.label} - ${option.description}`).join('\n')}
        `,
        })

      const selectedIndex = parseInt(userResponse) - 1

      if (
        isNaN(selectedIndex) ||
        selectedIndex < 0 ||
        selectedIndex >= options.length
      ) {
        this.emit(
          'session.error',
          'Invalid selection for authentication method.',
        )
        return
      }

      selectedMethod = options[selectedIndex]?.value
    }

    if (!selectedMethod) {
      this.emit('session.error', 'No authentication method selected.')
      return
    }

    try {
      await this.connection.clientContext.request(methods.agent.authenticate, {
        methodId: selectedMethod.id,
      })
    } catch (error) {
      this.emit('session.error', `Authentication failed: ${error}`)
      return
    }
  }

  private async _createAcpSession(
    currentAgent: NonNullable<AppState['agent']>,
    requestId?: string,
  ): Promise<NewSessionResponse | void> {
    if (!this.connection) {
      this.emit(
        'session.error',
        '3. No active connection found. Please use `client/init` command first.',
      )
      return
    }

    if (this.retriedAfterAuth) {
      this.emit(
        'session.error',
        'Session creation failed after authentication attempt. Please check your credentials and try again.',
      )
      return
    }

    try {
      const newSession = await this.connection.clientContext.request(
        methods.agent.session.new,
        {
          cwd: currentAgent.cwd,
          mcpServers: this._mcpServers(),
        },
      )

      this.retriedAfterAuth = false
      this.emit('session.acp_created', {
        requestId,
        data: newSession,
      })
      return newSession
    } catch (error) {
      const errorIsAuthError =
        (error instanceof RequestError && error.code === -32000) ||
        (error as any)?.code === -32000 ||
        (error as any)?.message?.toLowerCase().includes('auth')

      if (!errorIsAuthError) {
        this.emit('session.error', `Failed to create new session: ${error}`)
        return
      }

      await this._authenticate()
      this.retriedAfterAuth = true
      return await this._createAcpSession(currentAgent, requestId)
    }
  }

  private async _updateSession<T extends keyof Session['Update']>(
    field: T,
    value: Session['Update'][T],
    id?: string,
    requestId?: string,
  ) {
    const sessionId = id || this.activeSessionId

    if (!sessionId) {
      this.emit('session.error', 'No active session ID found to update')
      return
    }

    const session = this.sessions.get(sessionId)

    if (!session) {
      this.emit('session.error', `Session with ID ${sessionId} not found`)
      return
    }

    const updatedSession = { ...session, [field]: value }

    await this.db
      .update(sessions)
      .set({ [field]: value })
      .where(and(eq(sessions.id, sessionId)))

    this.sessions.set(sessionId, updatedSession)

    if (sessionId === this.activeSessionId) {
      // `setItem` (not `updateItem`) — the state slot may have been cleared
      // (e.g. the session was suspended) and `updateItem` throws on a missing key.
      this.server_instance
        .getManagers()
        .stateManager?.setItem('session', updatedSession)
    }

    this.emit('session.updated', {
      requestId,
      data: updatedSession,
    })
  }

  private async _setSessionMode(
    session: TrackedSession,
    modeId: string,
    requestId?: string,
  ) {
    if (!session) {
      return
    }

    await this.connection!.clientContext.request(
      methods.agent.session.setMode,
      {
        sessionId: session.acp_session_id,
        modeId,
      },
    )

    const updated: TrackedSession = {
      ...session,
      modes: {
        ...session.modes!,
        currentModeId: modeId,
      },
    }
    this.sessions.set(session.id, updated)

    // `session/set_mode` is authoritative. Agents that *also* surface the mode
    // as a `category: 'mode'` config option get it kept in sync; agents that
    // don't must not be sent a config call for a non-existent option.
    if (this._findConfigOption(updated, 'mode')) {
      await this.setSessionConfigOption('mode', modeId, session.id)
    }

    // `_updateSession` persists and emits `session.updated` itself.
    await this._updateSession('modes', updated.modes, session.id, requestId)
  }

  private async _setSessionModel(
    session: TrackedSession,
    modelId: string,
    requestId?: string,
  ) {
    if (!session) {
      return
    }

    // There is no dedicated `session/set_model` method — model selection is
    // expressed through the config option whose `category` is `model` (or
    // `model_config`). The `id` is agent-chosen, so resolve it by category.
    const modelOption =
      this._findConfigOption(session, 'model') ??
      this._findConfigOption(session, 'model_config')

    if (!modelOption) {
      this.emit(
        'session.error',
        'No model config option found for this session',
      )
      return
    }

    await this.setSessionConfigOption(modelOption.id, modelId, session.id)

    // Reflect the new selection locally so the persisted/mirrored state is not
    // stale (the agent call itself does not echo the option value back).
    const updated: TrackedSession = {
      ...session,
      configOptions: (session.configOptions ?? []).map((op) =>
        op.id === modelOption.id && op.type === 'select'
          ? { ...op, currentValue: modelId }
          : op,
      ),
    }
    this.sessions.set(session.id, updated)

    await this._updateSession(
      'configOptions',
      updated.configOptions,
      session.id,
      requestId,
    )

    const activeAgent = this.server_instance.getState().agent
    if (activeAgent) {
      this.server_instance.setDefaultModelForProvider(
        activeAgent.provider_name,
        modelId,
        requestId,
      )
    }
  }
}
