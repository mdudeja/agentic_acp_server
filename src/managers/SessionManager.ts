import { and, desc, eq } from 'drizzle-orm'
import type { AgenticServer } from 'main'
import { AgenticDB } from 'src/database/AgenticDB'
import { sessions, SessionStatus, type Session } from 'src/database/schemas'
import type { ASMState } from 'src/state/IASMState'
import { BaseManager } from './BaseManager'
import type { SessionEvents } from 'src/data/events'
import { RequestError, type ContentBlock } from '@agentclientprotocol/sdk'

export class SessionManager extends BaseManager<SessionEvents> {
  private db: ReturnType<AgenticDB['getDB']>
  private sessions: Map<string, ASMState['session']> = new Map()
  private connection: ASMState['connection'] | null = null
  private activeSessionId: string | null = null

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
        'No active connection found. Please use `client/init` command first.',
      )
      return
    }

    this.connection = connection
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
      configOptions: newSession.configOptions ?? undefined,
      models: newSession.models ?? undefined,
      modes: newSession.modes ?? undefined,
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
      SessionStatus.completed,
      this.activeSessionId,
      requestId,
    )
    this.emit('session.completed', {
      requestId,
      data: this.sessions.get(this.activeSessionId),
    })
    this.activeSessionId = null
  }

  async renameSession(newName: string, id?: string, requestId?: string) {
    await this._updateSession('name', newName, id, requestId)
  }

  async deleteSession(id: string, requestId?: string) {
    const session = this.sessions.get(id)

    if (!session) {
      this.emit('session.error', `Session with ID ${id} not found`)
      return
    }

    await this.db.delete(sessions).where(eq(sessions.id, id))

    this.sessions.delete(id)
    this.emit('session.deleted', { requestId, data: id })
  }

  async archiveSession(id: string, requestId?: string) {
    const session = this.sessions.get(id)

    if (!session) {
      this.emit('session.error', `Session with ID ${id} not found`)
      return
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

    const loaded = await this.connection!.csc.loadSession({
      cwd: currentAgent.cwd,
      mcpServers: [],
      sessionId: session.acp_session_id,
    })
    this.activeSessionId = id
    await this._updateSession('status', SessionStatus.active, id, requestId)

    this.sessions.set(id, {
      ...session,
      configOptions: loaded.configOptions ?? session.configOptions,
      models: loaded.models ?? session.models,
      modes: loaded.modes ?? session.modes,
    })

    this.emit('session.loaded', {
      requestId,
      data: this.sessions.get(id),
    })
  }

  async forkSession(requestId?: string) {
    if (!this.activeSessionId) {
      this.emit('session.error', 'No active session to fork')
      return
    }

    const sessionToFork = this.sessions.get(this.activeSessionId)
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
      this.activeSessionId,
      requestId,
    )

    const forkedSession = await this.connection!.csc.unstable_forkSession({
      sessionId: sessionToFork!.acp_session_id,
      cwd: currentAgent.cwd,
    })
    this.activeSessionId = forkedSession.sessionId

    const sessionRecord: Session['Insert'] = {
      agent_id: currentAgent.id,
      acp_session_id: forkedSession.sessionId,
      name: `(Fork) ${sessionToFork!.name ?? sessionToFork!.id}`,
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

    this.sessions.set(insertedSession.id, {
      ...insertedSession,
      configOptions:
        forkedSession.configOptions ?? sessionToFork?.configOptions,
      models: forkedSession.models ?? sessionToFork?.models,
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

    const resumedSession = await this.connection!.csc.unstable_resumeSession({
      sessionId: session.acp_session_id,
      cwd: currentAgent.cwd,
    })

    this.activeSessionId = id
    this.sessions.set(id, {
      ...session,
      configOptions: resumedSession.configOptions ?? session.configOptions,
      models: resumedSession.models ?? session.models,
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
        ?.filter((op) => op.id === 'mode')
        .flatMap((op) =>
          op.options.map((opt) => ({
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

    const availableModels =
      session.models?.availableModels ||
      session.configOptions
        ?.filter((op) => op.id === 'model')
        .flatMap((op) =>
          op.options.map((opt) => ({
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
              `${index + 1}. ${model.name} - ${model.description}${model._meta?.copilotUsage ? ` (${model._meta.copilotUsage})` : ''}`,
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

  listSessions() {
    return Array.from(this.sessions.values()).map((session) => ({
      id: session?.id,
      name: session?.name,
      status: session?.status,
      model: session?.models?.currentModelId,
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
    this.sessions.clear()
    this.activeSessionId = null
    this.connection = null
  }

  private async _authenticate() {
    if (!this.connection) {
      this.emit(
        'session.error',
        'No active connection found. Please use `client/init` command first.',
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
      await this.connection.csc.authenticate({ methodId: selectedMethod.id })
      this.authenticationAttempted = true
    } catch (error) {
      this.emit('session.error', `Authentication failed: ${error}`)
      return
    }
  }

  private async _createAcpSession(
    currentAgent: ASMState['agent'],
    requestId?: string,
  ) {
    if (!this.connection) {
      this.emit(
        'session.error',
        'No active connection found. Please use `client/init` command first.',
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
      const newSession = await this.connection.csc.newSession({
        cwd: currentAgent!.cwd,
        mcpServers: [],
      })
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
        this.server_instance.dispose()
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
    session: ASMState['session'],
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

    this.setSessionConfigOption('mode', modeId, session.acp_session_id)

    this.emit('session.updated', {
      requestId,
      data: this.sessions.get(session.id),
    })
  }

  private async _setSessionModel(
    session: ASMState['session'],
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

    this.sessions.set(session.id, {
      ...session,
      models: {
        ...session.models!,
        currentModelId: modelId!,
      },
    })

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
