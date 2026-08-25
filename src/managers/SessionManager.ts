import { and, desc, eq } from 'drizzle-orm'
import type { AgenticServer } from 'src/AgenticServer'
import { join } from 'node:path'
import { createProviderCLI } from 'src/cli/factory'
import type { CLIProvider } from 'src/cli/types'
import { AgenticDB } from 'src/database/AgenticDB'
import { sessions, SessionStatus, type Session } from 'src/database/schemas'
import type { AppState } from 'src/state/types'
import { BaseManager } from './BaseManager'
import type { SessionEvents } from 'src/data/events'
import { logWarning } from 'src/utils/logger'
import {
  methods,
  RequestError,
  type ContentBlock,
  type LoadSessionResponse,
  type SessionConfigSelect,
} from '@agentclientprotocol/sdk'

export class SessionManager extends BaseManager<SessionEvents> {
  private db: ReturnType<AgenticDB['getDB']>
  private sessions: Map<string, AppState['session']> = new Map()
  private connection: AppState['connection'] | null = null
  private activeSessionId: string | null = null
  private providerCLI: CLIProvider | null = null

  private authenticationAttempted: boolean = false

  constructor(private readonly server_instance: AgenticServer) {
    super()
    const dbInstance = AgenticDB.getInstance()
    this.db = dbInstance.getDB()
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

    this.sessions.set(insertedSession.id, {
      ...insertedSession,
      sessionRef: newSession,
    })
    this.activeSessionId = insertedSession.id

    this.emit('session.created', {
      requestId,
      data: this.sessions.get(this.activeSessionId),
    })

    const activeAgent = this.server_instance.getState().agent

    if (activeAgent && activeAgent.default_model_id) {
      await this._setSessionModel(
        this.sessions.get(this.activeSessionId)!,
        activeAgent.default_model_id,
        requestId,
      )
    }
    this.emit('session.loaded', {
      requestId,
      data: this.sessions.get(this.activeSessionId),
    })
  }

  async suspendCurrentSession(requestId?: string) {
    if (!this.activeSessionId) {
      this.emit('session.error', 'No active session to suspend')
      return
    }

    await this._updateSession(
      'status',
      SessionStatus.suspended,
      this.activeSessionId,
      requestId,
    )
    this.emit('session.suspended', {
      requestId,
      data: this.sessions.get(this.activeSessionId),
    })
    this.activeSessionId = null
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

    await this.db.delete(sessions).where(eq(sessions.id, id))
    this.sessions.delete(id)

    // Best-effort CLI cleanup — do not fail the RPC if this errors
    if (this.providerCLI) {
      const result = await this.providerCLI.deleteSession(
        session.acp_session_id,
      )
      if (!result.success) {
        logWarning(
          `[SessionManager] CLI session deletion failed: ${result.stderr}`,
        )
      }
    }

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

    const capabilities = this.connection!.initResponse.agentCapabilities

    if (!capabilities?.loadSession) {
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

    const mcpServers = this.server_instance
      .getManagers()
      .mcpServerManager?.getMcpServers()
      .map((v) => ({ ...v, env: [] }))

    const loaded: LoadSessionResponse =
      await this.connection!.clientContext.request('session/load', {
        cwd: currentAgent.cwd,
        mcpServers: mcpServers ?? [],
        sessionId: session.acp_session_id,
      })
    this.activeSessionId = id
    await this._updateSession('status', SessionStatus.active, id, requestId)

    this.sessions.set(id, {
      ...session,
      configOptions: loaded.configOptions ?? session.configOptions,
      modes: loaded.modes ?? session.modes,
    })

    this.emit('session.loaded', {
      requestId,
      data: this.sessions.get(id),
    })
  }

  async forkSession(sessionId: string, newName?: string, requestId?: string) {
    const sessionToFork = this.sessions.get(sessionId)
    const capabilities = this.connection!.initResponse.agentCapabilities

    if (!capabilities?.sessionCapabilities?.fork) {
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

    const forkedSession = await this.connection!.csc.unstable_forkSession({
      sessionId: sessionToFork!.acp_session_id,
      cwd: currentAgent.cwd,
    })

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

    this.sessions.set(insertedSession.id, {
      ...insertedSession,
      configOptions:
        forkedSession.configOptions ?? sessionToFork?.configOptions,
      modes: forkedSession.modes ?? sessionToFork?.modes,
    })

    await this._updateSession(
      'status',
      SessionStatus.active,
      insertedSession.id,
      requestId,
    )
    this.emit('session.loaded', {
      requestId,
      data: this.sessions.get(this.activeSessionId),
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

    const capabilities = this.connection!.initResponse.agentCapabilities

    if (!capabilities?.sessionCapabilities?.resume) {
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

    const mcpServers = this.server_instance
      .getManagers()
      .mcpServerManager?.getMcpServers()
      .map((v) => ({ ...v, env: [] }))
    const resumedSession = await this.connection!.csc.unstable_resumeSession({
      sessionId: session.acp_session_id,
      cwd: currentAgent.cwd,
      mcpServers: mcpServers ?? [],
    })

    this.activeSessionId = id
    this.sessions.set(id, {
      ...session,
      configOptions: resumedSession.configOptions ?? session.configOptions,
      modes: resumedSession.modes ?? session.modes,
    })
    await this._updateSession('status', SessionStatus.active, id, requestId)
    this.emit('session.loaded', {
      requestId,
      data: this.sessions.get(id),
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

  setSessionConfigOption(optionId: string, value: any, id?: string) {
    const sessionId = id || this.activeSessionId

    if (!sessionId) {
      this.emit(
        'session.error',
        'No active session ID found to set config option',
      )
      return
    }

    const session = this.sessions.get(sessionId)

    if (!session) {
      this.emit('session.error', `Session with ID ${sessionId} not found`)
      return
    }

    const configOption = session.configOptions?.find((op) => op.id === optionId)

    if (!configOption) {
      this.emit(
        'session.error',
        `Config option with ID ${optionId} not found for this session`,
      )
      return
    }

    this.connection!.csc.setSessionConfigOption({
      configId: optionId,
      sessionId: session.acp_session_id,
      value,
    })
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

    const resp = await this.connection!.csc.prompt({
      sessionId: session.acp_session_id,
      prompt,
    })

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

  async cancelTurn(id?: string) {
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

    await this.connection!.csc.cancel({
      sessionId: session.acp_session_id,
    })

    this.server_instance.getPermissionHandler()?.rejectAllPending(sessionId)

    this.emit('session.turnActive', {
      requestId: undefined,
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

    const authMethods = await this.connection.initResponse.authMethods

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
      this.authenticationAttempted = true
      await this.connection.csc.authenticate({ methodId: selectedMethod.id })
    } catch (error) {
      this.emit('session.error', `Authentication failed: ${error}`)
      return
    }
  }

  private async _createAcpSession(
    currentAgent: AppState['agent'],
    requestId?: string,
  ) {
    if (!this.connection) {
      this.emit(
        'session.error',
        '3. No active connection found. Please use `client/init` command first.',
      )
      return
    }

    if (this.authenticationAttempted) {
      this.emit(
        'session.error',
        'Session creation failed after authentication attempt. Please check your credentials and try again.',
      )
      return
    }

    try {
      const mcpServers = this.server_instance
        .getManagers()
        .mcpServerManager?.getMcpServers()
        .map((v) => ({ ...v, env: [] }))
      const newSession = await this.connection.clientContext
        .buildSession({
          cwd: this.server_instance.getState().workspaceRoot!,
          mcpServers: mcpServers ?? [],
        })
        .start()

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
      await this._createAcpSession(currentAgent, requestId)
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
    this.emit('session.updated', {
      requestId,
      data: this.sessions.get(sessionId),
    })
  }

  private async _setSessionMode(
    session: AppState['session'],
    modeId: string,
    requestId?: string,
  ) {
    if (!session) {
      return
    }

    await this.connection!.csc.setSessionMode({
      sessionId: session.acp_session_id,
      modeId: modeId!,
    })

    this.sessions.set(session.id, {
      ...session,
      modes: {
        ...session.modes!,
        currentModeId: modeId!,
      },
    })

    this.setSessionConfigOption('mode', modeId, session.id)

    this.emit('session.updated', {
      requestId,
      data: this.sessions.get(session.id),
    })
  }

  private async _setSessionModel(
    session: AppState['session'],
    modelId: string,
    requestId?: string,
  ) {
    if (!session) {
      return
    }

    await this.connection!.csc.unstable_setSessionModel({
      sessionId: session.acp_session_id,
      modelId: modelId!,
    })

    this.sessions.set(session.id, session)

    this.setSessionConfigOption('model', modelId!, session.id)

    this.server_instance.setDefaultModelForProvider(
      this.server_instance.getState().agent!.provider_name,
      modelId!,
      requestId,
    )

    this.emit('session.updated', {
      requestId,
      data: this.sessions.get(session.id),
    })
  }
}
