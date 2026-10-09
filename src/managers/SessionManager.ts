import { and, desc, eq } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import type { AgenticServer } from 'src/AgenticServer'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { createProviderCLI } from 'src/cli/factory'
import type { CLIProvider } from 'src/cli/types'
import { AgenticDB } from 'src/database/AgenticDB'
import {
  sessionSummaries,
  sessions,
  SessionStatus,
  type Session,
} from 'src/database/schemas'
import type { AppState, TrackedSession } from 'src/state/types'
import { BaseManager } from './BaseManager'
import type { SessionEvents } from 'src/data/events'
import { logWarning } from 'src/utils/logger'
import {
  ok,
  runTierQueue,
  tierError,
  unavailable,
  type SessionOpSource,
} from 'src/sessionops/queue'
import type { SessionOpTier } from 'src/config/schemas'
import {
  methods,
  RequestError,
  type ContentBlock,
  type McpServer,
  type NewSessionResponse,
  type PromptResponse,
  type SessionConfigOption,
  type SessionConfigSelect,
} from '@agentclientprotocol/sdk'
import { resolveOptionAnswer, uriToEmbeddedResource } from 'src/utils/helpers'

type TrackedConnection = NonNullable<AppState['connection']>

/**
 * Outcome of a session operation. Failures are also emitted as
 * `session.error` (for logging); the result lets the dispatcher answer the
 * editor's request truthfully instead of always reporting success.
 */
export type SessionOpResult<T extends object = {}> =
  | ({ success: true } & T)
  | { success: false; error: string }

/** Uniform, client-facing view of a session config option. */
export type SessionConfigOptionView = {
  id: string
  name: string
  description: string | null
  category: string | null
  type: 'select' | 'boolean'
  currentValue: string | boolean
  options?: Array<{
    value: string
    name: string
    description?: string | null
    group?: string
  }>
}

export class SessionManager extends BaseManager<SessionEvents> {
  private db: ReturnType<AgenticDB['getDB']>
  private sessions: Map<string, TrackedSession> = new Map()
  /**
   * ACP session id → local session id for every tracked session. Agents
   * address `session/update` notifications by ACP id; this index translates
   * them for any session (not just the active one), including updates that
   * arrive while a `session/load` replays history.
   */
  private acpSessionIds: Map<string, string> = new Map()
  private connection: TrackedConnection | null = null
  private activeSessionId: string | null = null
  private providerCLI: CLIProvider | null = null

  /** Armed assistant-text capture for the summarize prompt (see `beginCapture`). */
  private _captureSessionId: string | null = null
  private _captureBuffer: Map<string, string[]> | null = null
  private _captureListener:
    | ((sessionId: string, update: any) => Promise<void>)
    | null = null

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

  /**
   * Resolves the ordered tiers to try for a session operation. `source` of
   * `'auto'` (or omitted) uses the configured policy in `config.sessionOps`;
   * an explicit tier runs that tier alone.
   */
  private _tiersFor(
    op: 'list' | 'export' | 'import' | 'delete',
    source?: SessionOpSource,
  ): SessionOpTier[] {
    if (source && source !== 'auto') {
      return [source]
    }
    const configured = this.server_instance.getState().config?.sessionOps?.[op]
    return configured && configured.length > 0 ? configured : ['memory']
  }

  /** Emits `session.error` and returns the matching failed result. */
  private _fail(error: string): { success: false; error: string } {
    this.emit('session.error', error)
    return { success: false, error }
  }

  async init() {
    const currentAgent = this.server_instance.getState().agent

    if (!currentAgent) {
      this.emit('session.error', 'No active agent found in state')
      return
    }

    // Clear first: `init()` may run again for the same server instance (e.g.
    // after a provider switch), and stale entries must not survive.
    this.sessions.clear()
    this.acpSessionIds.clear()

    const availableSessions = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.agent_id, currentAgent.id))
      .orderBy(desc(sessions.created_at))

    availableSessions.forEach((session) => {
      this.sessions.set(session.id, session)
      this.acpSessionIds.set(session.acp_session_id, session.id)
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

  async createNewSession(
    name?: string,
    requestId?: string,
  ): Promise<SessionOpResult<{ sessionId: string }>> {
    const currentAgent = this.server_instance.getState().agent

    if (!currentAgent) {
      return this._fail('No active agent found in state')
    }

    if (this.activeSessionId) {
      await this.suspendCurrentSession(requestId)
    }

    const newSession = await this._createAcpSession(currentAgent, requestId)

    if (!newSession) {
      return this._fail('Failed to create new session')
    }

    // Allocate the local id up front and index it before the DB insert, so
    // updates the agent sends right after `session/new` can be routed.
    const localId = createId()
    this.acpSessionIds.set(newSession.sessionId, localId)

    const sessionRecord: Session['Insert'] = {
      id: localId,
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
      this.acpSessionIds.delete(newSession.sessionId)
      return this._fail('Failed to insert new session into database')
    }
    this.acpSessionIds.set(newSession.sessionId, insertedSession.id)

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

    return { success: true, sessionId: createdSession.id }
  }

  async suspendCurrentSession(requestId?: string): Promise<SessionOpResult> {
    if (!this.activeSessionId) {
      return this._fail('No active session to suspend')
    }

    const session = this.sessions.get(this.activeSessionId)
    if (!session) {
      return this._fail('Session to suspend not found')
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

    return { success: true }
  }

  async renameSession(
    newName: string,
    id?: string,
    requestId?: string,
  ): Promise<SessionOpResult> {
    return this._updateSession('name', newName, id, requestId)
  }

  /**
   * Deletes a session. Runs the configured tier queue (`acp` → `cli` by
   * default): the ACP tier is skipped when the agent does not advertise
   * `sessionCapabilities.delete`, and a failing ACP attempt advances to the
   * CLI tier rather than aborting. The local DB row is always removed last so
   * the session disappears from the client-side list regardless of the
   * provider outcome.
   */
  async deleteSession(
    id: string,
    requestId?: string,
    source?: SessionOpSource,
  ): Promise<{ result: { success: boolean }; error?: string }> {
    const session = this.sessions.get(id)

    if (!session) {
      const error = `Session with ID ${id} not found`
      this.emit('session.error', error)
      return { result: { success: false }, error }
    }

    const queued = await runTierQueue<void>({
      op: 'delete',
      tiers: this._tiersFor('delete', source),
      handlers: {
        acp: async () => {
          if (!this.connection) {
            return unavailable('No active connection for ACP delete')
          }
          if (
            !this.server_instance.hasCapability('sessionCapabilities.delete')
          ) {
            return unavailable(
              'Agent does not advertise sessionCapabilities.delete',
            )
          }
          try {
            await this.connection.clientContext.request(
              methods.agent.session.delete,
              { sessionId: session.acp_session_id },
            )
            return ok(undefined)
          } catch (error) {
            return tierError(`Failed to delete session via ACP: ${error}`)
          }
        },
        cli: async () => {
          if (!this.providerCLI) {
            return unavailable('No CLI provider available for this provider')
          }
          const result = await this.providerCLI.deleteSession(
            session.acp_session_id,
          )
          if (!result.success) {
            logWarning(
              `[SessionManager] CLI session deletion failed: ${result.stderr}`,
            )
          }
          return ok(undefined)
        },
      },
    })

    await this.db.delete(sessions).where(eq(sessions.id, id))
    this.sessions.delete(id)
    this.acpSessionIds.delete(session.acp_session_id)
    if (this.activeSessionId === id) {
      this.activeSessionId = null
    }

    this.emit('session.deleted', { requestId, data: id })

    if (!queued.ok) {
      return {
        result: { success: false },
        error: `Provider delete did not complete (${queued.reason}): ${queued.message}`,
      }
    }

    return { result: { success: true } }
  }

  async archiveSession(
    id: string,
    requestId?: string,
    exportBeforeArchive?: boolean,
  ): Promise<SessionOpResult> {
    const session = this.sessions.get(id)

    if (!session) {
      return this._fail(`Session with ID ${id} not found`)
    }

    // Best-effort export before archiving
    if (exportBeforeArchive) {
      await this.exportSession(id)
    }

    return this._updateSession('is_archived', true, id, requestId)
  }

  async unarchiveSession(
    id: string,
    requestId?: string,
  ): Promise<SessionOpResult> {
    const session = this.sessions.get(id)

    if (!session) {
      return this._fail(`Session with ID ${id} not found`)
    }

    return this._updateSession('is_archived', false, id, requestId)
  }

  async loadSession(id: string, requestId?: string): Promise<SessionOpResult> {
    const session = this.sessions.get(id)

    if (!session) {
      return this._fail(`Session with ID ${id} not found`)
    }

    if (!this.server_instance.hasCapability('loadSession')) {
      return this._fail('The connected server does not support loading sessions. Please create a new session instead.')
    }

    if (this.activeSessionId) {
      await this.suspendCurrentSession(requestId)
    }

    const currentAgent = this.server_instance.getState().agent

    if (!currentAgent) {
      return this._fail('No active agent found in state')
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

    return { success: true }
  }

  async forkSession(
    sessionId: string,
    newName?: string,
    requestId?: string,
  ): Promise<SessionOpResult<{ sessionId: string }>> {
    const sessionToFork = this.sessions.get(sessionId)

    if (!sessionToFork) {
      return this._fail(`Session with ID ${sessionId} not found`)
    }

    if (!this.server_instance.hasCapability('sessionCapabilities.fork')) {
      return this._fail('The connected server does not support forking sessions. Please create a new session instead.')
    }

    const currentAgent = this.server_instance.getState().agent

    if (!currentAgent) {
      return this._fail('No active agent found in state')
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
        sessionId: sessionToFork.acp_session_id,
        cwd: currentAgent.cwd,
        mcpServers: this._mcpServers(),
      },
    )

    const localId = createId()
    this.acpSessionIds.set(forkedSession.sessionId, localId)

    const sessionRecord: Session['Insert'] = {
      id: localId,
      agent_id: currentAgent.id,
      acp_session_id: forkedSession.sessionId,
      name: newName ?? `(Fork) ${sessionToFork.name ?? sessionToFork.id}`,
    }

    const insertedSession = await this.db
      .insert(sessions)
      .values(sessionRecord)
      .returning()
      .then((res) => res[0])

    if (!insertedSession) {
      this.acpSessionIds.delete(forkedSession.sessionId)
      return this._fail('Failed to insert forked session into database')
    }
    this.acpSessionIds.set(forkedSession.sessionId, insertedSession.id)

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

    return { success: true, sessionId: insertedSession.id }
  }

  async resumeSession(
    id: string,
    requestId?: string,
  ): Promise<SessionOpResult> {
    const session = this.sessions.get(id)

    if (!session) {
      return this._fail(`Session with ID ${id} not found`)
    }

    if (session.status === SessionStatus.active) {
      return this._fail(`Session with ID ${id} is already active`)
    }

    if (session.status === SessionStatus.completed) {
      return this._fail(`Session with ID ${id} is completed and cannot be resumed`)
    }

    if (!this.server_instance.hasCapability('sessionCapabilities.resume')) {
      return this._fail('The connected server does not support resuming sessions. Please load the session instead.')
    }

    const currentAgent = this.server_instance.getState().agent

    if (!currentAgent) {
      return this._fail('No active agent found in state')
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

    return { success: true }
  }

  /**
   * Applies an agent-initiated session update (`config_option_update` or
   * `current_mode_update`) to the tracked session and persists it, so local
   * state does not drift from the agent's own changes.
   */
  /** Maps an ACP session id to the local session id, if it is tracked. */
  resolveLocalSessionId(acpSessionId: string): string | undefined {
    return this.acpSessionIds.get(acpSessionId)
  }

  async applyAgentUpdate(
    sessionId: string,
    update:
      | { type: 'config_option_update'; configOptions: SessionConfigOption[] }
      | { type: 'current_mode_update'; currentModeId: string },
  ): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return
    }

    if (update.type === 'config_option_update') {
      await this._applyConfigOptions(session, update.configOptions)
      return
    }

    const updated: TrackedSession = {
      ...session,
      modes: {
        availableModes: session.modes?.availableModes ?? [],
        currentModeId: update.currentModeId,
        _meta: session.modes?._meta,
      },
    }

    this.sessions.set(sessionId, updated)
    await this._updateSession('modes', updated.modes, sessionId)
  }

  async switchSessionMode(
    id?: string,
    requestId?: string,
  ): Promise<SessionOpResult> {
    const sessionId = id || this.activeSessionId

    if (!sessionId) {
      return this._fail('No active session ID found to switch mode')
    }

    const session = this.sessions.get(sessionId)

    if (!session) {
      return this._fail(`Session with ID ${sessionId} not found`)
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
      return this._fail('No available modes found for this session')
    }

    const questionOptions = availableModes.map((mode) => ({
      id: mode.id,
      label: mode.name,
      description: mode.description ?? undefined,
    }))

    const answer = await this.server_instance.getCommsInterface().question({
      questionId: 'select_session_mode',
      question: `Please select a mode for this session`,
      options: questionOptions,
    })

    const modeId = resolveOptionAnswer(answer, questionOptions)

    if (!modeId) {
      return this._fail('Invalid selection for session mode')
    }

    return this._setSessionMode(session, modeId, requestId)
  }

  async switchSessionModel(
    id?: string,
    requestId?: string,
  ): Promise<SessionOpResult> {
    const sessionId = id || this.activeSessionId

    if (!sessionId) {
      return this._fail('No active session ID found to switch model')
    }

    const session = this.sessions.get(sessionId)

    if (!session) {
      return this._fail(`Session with ID ${sessionId} not found`)
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
      return this._fail('No available models found for this session')
    }

    const questionOptions = availableModels.map((model) => ({
      id: model.modelId,
      label: model.name,
      description: model.description ?? undefined,
    }))

    const answer = await this.server_instance.getCommsInterface().question({
      questionId: 'select_session_model',
      question: `Please select a model for this session`,
      options: questionOptions,
    })

    const modelId = resolveOptionAnswer(answer, questionOptions)

    if (!modelId) {
      return this._fail('Invalid selection for session model')
    }

    return this._setSessionModel(session, modelId, requestId)
  }

  /**
   * Flattens a `select` option's choices (including grouped choices) into a
   * uniform shape for the client.
   */
  private _flattenSelectOptions(option: SessionConfigOption): Array<{
    value: string
    name: string
    description?: string | null
    group?: string
  }> {
    if (option.type !== 'select') {
      return []
    }

    const raw = (option as SessionConfigSelect).options
    if (!raw) {
      return []
    }

    const flat: Array<{
      value: string
      name: string
      description?: string | null
      group?: string
    }> = []

    for (const entry of raw) {
      if ('group' in entry && Array.isArray((entry as any).options)) {
        const group = entry as { group: string; name: string; options: any[] }
        for (const opt of group.options) {
          flat.push({
            value: opt.value,
            name: opt.name,
            description: opt.description ?? null,
            group: group.name ?? group.group,
          })
        }
      } else {
        const opt = entry as {
          value: string
          name: string
          description?: string
        }
        flat.push({
          value: opt.value,
          name: opt.name,
          description: opt.description ?? null,
        })
      }
    }

    return flat
  }

  /**
   * Lists the session's agent-advertised configuration options in a uniform,
   * client-friendly shape. Covers `select` (incl. grouped) and `boolean`
   * options, and surfaces `category` so the client can identify the mode /
   * model / thought-level selectors.
   */
  listConfigOptions(sessionId?: string):
    | {
        success: true
        sessionId: string
        configOptions: SessionConfigOptionView[]
      }
    | { success: false; error: string } {
    const id = sessionId || this.activeSessionId

    if (!id) {
      return { success: false, error: 'No active session ID found' }
    }

    const session = this.sessions.get(id)

    if (!session) {
      return { success: false, error: `Session with ID ${id} not found` }
    }

    const configOptions: SessionConfigOptionView[] = (
      session.configOptions ?? []
    ).map((op) => ({
      id: op.id,
      name: op.name,
      description: op.description ?? null,
      category: op.category ?? null,
      type: op.type,
      currentValue: op.type === 'boolean' ? op.currentValue : op.currentValue,
      options:
        op.type === 'select' ? this._flattenSelectOptions(op) : undefined,
    }))

    return { success: true, sessionId: id, configOptions }
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
   * Applies the agent-returned config options to the tracked session and
   * persists them. `session/set_config_option` returns the full, authoritative
   * set (with current values), so we trust it over any local guess.
   */
  private async _applyConfigOptions(
    session: TrackedSession,
    configOptions: SessionConfigOption[],
    requestId?: string,
  ) {
    const updated: TrackedSession = { ...session, configOptions }
    this.sessions.set(session.id, updated)
    await this._updateSession(
      'configOptions',
      configOptions,
      session.id,
      requestId,
    )
  }

  /**
   * Sets a session config option. `optionIdOrCategory` matches by `id` first,
   * then by `category`.
   *
   * Returns the updated option list on success, or `null` when the
   * session/option was not found. The agent's response is authoritative and is
   * persisted to the tracked session.
   */
  async setSessionConfigOption(
    optionIdOrCategory: string,
    value: any,
    id?: string,
    requestId?: string,
  ): Promise<SessionConfigOptionView[] | null> {
    const sessionId = id || this.activeSessionId

    if (!sessionId) {
      this.emit(
        'session.error',
        'No active session ID found to set config option',
      )
      return null
    }

    const session = this.sessions.get(sessionId)

    if (!session) {
      this.emit('session.error', `Session with ID ${sessionId} not found`)
      return null
    }

    const configOption = this._findConfigOption(session, optionIdOrCategory)

    if (!configOption) {
      this.emit(
        'session.error',
        `Config option ${optionIdOrCategory} not found for this session`,
      )
      return null
    }

    // Send the agent-chosen `id`, never the category we resolved it by.
    const resp =
      configOption.type === 'boolean'
        ? await this.connection!.clientContext.request(
            methods.agent.session.setConfigOption,
            {
              configId: configOption.id,
              sessionId: session.acp_session_id,
              type: 'boolean',
              value: Boolean(value),
            },
          )
        : await this.connection!.clientContext.request(
            methods.agent.session.setConfigOption,
            {
              configId: configOption.id,
              sessionId: session.acp_session_id,
              value: String(value),
            },
          )

    const configOptions = resp?.configOptions ?? session.configOptions ?? []
    await this._applyConfigOptions(session, configOptions, requestId)

    const listed = this.listConfigOptions(session.id)
    return listed.success ? listed.configOptions : []
  }

  /**
   * Sets the session's thought / reasoning level, resolved from the config
   * option whose `category === 'thought_level'` (the only spec-sanctioned
   * carrier for reasoning effort).
   */
  async setThoughtLevel(
    value: string,
    id?: string,
    requestId?: string,
  ): Promise<SessionConfigOptionView[] | null> {
    return this.setSessionConfigOption('thought_level', value, id, requestId)
  }

  async exportSession(
    id: string,
    outputPath?: string,
    source?: SessionOpSource,
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

    const queued = await runTierQueue<string>({
      op: 'export',
      tiers: this._tiersFor('export', source),
      handlers: {
        acp: async () => {
          const writeResult = await this.writeSessionSummary(id)
          if (!writeResult.result.success) {
            return tierError('Failed to write session summary')
          }
          return ok(writeResult.result.filePath ?? '')
        },
        cli: async () => {
          if (!this.providerCLI) {
            return unavailable('No CLI provider available for this provider')
          }
          if (!resolvedPath) {
            return tierError(
              'Cannot determine output path and no default configured',
            )
          }
          const result = await this.providerCLI.exportSession(
            session.acp_session_id,
            resolvedPath,
          )
          if (!result.success) {
            return tierError(result.stderr || 'Session export failed')
          }
          return ok(resolvedPath)
        },
      },
    })

    if (!queued.ok) {
      return { result: { success: false }, error: queued.message }
    }

    return { result: { success: true, filePath: queued.value } }
  }

  async importSession(
    filePath: string,
    source?: SessionOpSource,
  ): Promise<{ result: { success: boolean }; error?: string }> {
    const queued = await runTierQueue<void>({
      op: 'import',
      tiers: this._tiersFor('import', source),
      handlers: {
        acp: async () => {
          const fileBlob = await uriToEmbeddedResource(filePath, undefined, {
            audience: ['assistant'],
          })
          const prompted = await this.prompt([
            fileBlob,
            {
              type: 'text',
              text: 'Use this information as initial context to answer questions and provide guidance in this session. Do not repeat the information back to me unless I ask you to.',
            },
          ])
          if (!prompted.success) {
            return tierError(prompted.error)
          }
          return ok(undefined)
        },
        cli: async () => {
          if (!this.providerCLI) {
            return unavailable('No CLI provider available for this provider')
          }
          const result = await this.providerCLI.importSession(filePath)
          if (!result.success) {
            return tierError(result.stderr || 'Session import failed')
          }
          return ok(undefined)
        },
      },
    })

    if (!queued.ok) {
      return { result: { success: false }, error: queued.message }
    }

    return { result: { success: true } }
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

  /** Local projection of the in-memory session map (always available). */
  private _localSessions() {
    return Array.from(this.sessions.values()).map((session) => ({
      id: session?.id,
      name: session?.name,
      status: session?.status,
      mode: session?.modes?.currentModeId,
    }))
  }

  listSessions() {
    return this._localSessions()
  }

  /**
   * Lists sessions through the configured tier queue (`memory` → `acp` →
   * `cli` by default).
   *
   * - `memory` returns the local projection (never fails).
   * - `acp` calls `session/list` when the agent advertises
   *   `sessionCapabilities.list`.
   * - `cli` shells out to the provider CLI's `session list`.
   *
   * Pass `source` to force a single tier (the old `listSessionsFromAgent`
   * behaviour was roughly `acp`-then-`cli`).
   */
  async listSessionsQueued(source?: SessionOpSource): Promise<{
    result: { success: boolean; sessions?: unknown }
    error?: string
    tier?: SessionOpTier
  }> {
    const queued = await runTierQueue<unknown>({
      op: 'list',
      tiers: this._tiersFor('list', source),
      handlers: {
        memory: async () => ok(this._localSessions()),
        acp: async () => {
          if (!this.connection) {
            return unavailable('No active connection for ACP list')
          }
          if (!this.server_instance.hasCapability('sessionCapabilities.list')) {
            return unavailable(
              'Agent does not advertise sessionCapabilities.list',
            )
          }
          try {
            const resp = await this.connection.clientContext.request(
              methods.agent.session.list,
              {},
            )
            return ok(resp.sessions)
          } catch (error) {
            return tierError(`Failed to list sessions via ACP: ${error}`)
          }
        },
        cli: async () => {
          if (!this.providerCLI) {
            return unavailable('No CLI provider available for this provider')
          }
          const result = await this.providerCLI.listSessions()
          if (!result.success) {
            return tierError(result.stderr || 'Session list failed')
          }
          return ok(result.data)
        },
      },
    })

    if (!queued.ok) {
      return { result: { success: false }, error: queued.message }
    }

    return {
      result: { success: true, sessions: queued.value },
      tier: queued.tier,
    }
  }

  async prompt(
    prompt: ContentBlock[],
    id?: string,
    requestId?: string,
  ): Promise<SessionOpResult<{ stopReason?: PromptResponse['stopReason'] }>> {
    const sessionId = id || this.activeSessionId

    if (!sessionId) {
      return this._fail('No active session ID found to send prompt')
    }

    const session = this.sessions.get(sessionId)

    if (!session) {
      return this._fail(`Session with ID ${sessionId} not found`)
    }

    if (!this.connection) {
      return this._fail(
        'No active connection found. Please use `client/init` command first.',
      )
    }

    this.emit('session.turnActive', {
      requestId: requestId,
      data: {
        id: sessionId,
        active: true,
      },
    })

    // The turn must always be marked finished, even when the request rejects
    // (agent crash, connection closed), or `promptActive` stays stuck on.
    let resp: PromptResponse | undefined
    try {
      resp = await this.connection.clientContext.request(
        methods.agent.session.prompt,
        {
          sessionId: session.acp_session_id,
          prompt,
        },
      )
    } finally {
      this.emit('session.turnActive', {
        requestId: requestId,
        data: {
          id: sessionId,
          active: false,
          stopReason: resp?.stopReason,
          usage: resp?.usage,
        },
      })
    }

    return { success: true, stopReason: resp.stopReason }
  }

  /**
   * Arms assistant-text capture for a single upcoming turn on `sessionId`.
   *
   * Registers an ADDITIONAL `agent_message_chunk` listener on the agent's
   * `SessionUpdateHandler` (a multi-subscriber fan-out), so the existing
   * editor-forwarding subscriber keeps running untouched. The listener only
   * exists between `beginCapture`/`endCapture`, appends synchronously (the
   * handler awaits listeners sequentially, so it must not do I/O), and is
   * guarded by `sessionId`. `prompt()` auto-disarms at turn end.
   */
  beginCapture(sessionId: string): void {
    if (this._captureListener) {
      this.endCapture()
    }

    const handler = this.server_instance
      .getManagers()
      .agentManager?.getSessionUpdateHandler()

    if (!handler) {
      return
    }

    this._captureSessionId = sessionId
    this._captureBuffer = new Map()

    this._captureListener = async (updateSessionId: string, update: any) => {
      if (updateSessionId !== this._captureSessionId || !this._captureBuffer) {
        return
      }
      const content = update?.content
      const text =
        content?.type === 'text'
          ? (content.text as string)
          : typeof content?.text === 'string'
            ? (content.text as string)
            : ''
      if (!text) {
        return
      }
      const key = update?.messageId ?? 'default'
      const existing = this._captureBuffer.get(key) ?? []
      existing.push(text)
      this._captureBuffer.set(key, existing)
    }

    handler.on('agent_message_chunk', this._captureListener)
  }

  /** Disarms capture and returns the accumulated assistant text. */
  endCapture(): string {
    const handler = this.server_instance
      .getManagers()
      .agentManager?.getSessionUpdateHandler()

    if (handler && this._captureListener) {
      handler.off('agent_message_chunk', this._captureListener)
    }

    const text = this._captureBuffer
      ? Array.from(this._captureBuffer.values())
          .map((parts) => parts.join(''))
          .join('\n\n')
      : ''

    this._captureSessionId = null
    this._captureBuffer = null
    this._captureListener = null

    return text
  }

  /**
   * Generates a Markdown summary of the ACTIVE session and writes it to
   * `<cwd>/<config.sessions.summaryPath>/<sessionId>.md`, upserting a
   * `session_summaries` row.
   *
   * Only the active session of the active provider can be summarized: the
   * agent already holds that conversation in context, so we simply ask it to
   * summarize. Other sessions are rejected (no transcript is kept).
   */
  async writeSessionSummary(sessionId?: string): Promise<{
    result: { success: boolean; filePath?: string; summary?: string }
    error?: string
  }> {
    const id = sessionId || this.activeSessionId

    if (!id) {
      const error = 'No active session ID found to summarize'
      this.emit('session.error', error)
      return { result: { success: false }, error }
    }

    const session = this.sessions.get(id)

    if (!session) {
      const error = `Session with ID ${id} not found`
      this.emit('session.error', error)
      return { result: { success: false }, error }
    }

    if (id !== this.activeSessionId) {
      const error =
        'Only the active session can be summarized (the agent must already hold its context)'
      this.emit('session.error', error)
      return { result: { success: false }, error }
    }

    const agent = this.server_instance.getState().agent
    const config = this.server_instance.getState().config ?? null
    const cwd = agent?.cwd

    if (!cwd || !config) {
      const error = 'Cannot determine workspace cwd/config for the summary file'
      this.emit('session.error', error)
      return { result: { success: false }, error }
    }

    // Ask the active agent to summarize the conversation it is holding.
    // Capture stays armed across the prompt; we then give the streamed
    // notifications a brief moment to drain before reading the buffer
    // (the prompt response can arrive before the last chunks on the wire).
    // NOTE: capture is keyed on the ACP session id carried by notifications.
    // The capture listener is always removed, even if the prompt rejects.
    this.beginCapture(session.acp_session_id)
    let summary: string
    try {
      const prompted = await this.prompt(
        [
          {
            type: 'text',
            text: 'Summarize our conversation so far. Capture the goal, key decisions, important context/files, current state, and any next steps. Output only the summary as Markdown.',
          },
        ],
        id,
      )

      if (!prompted.success) {
        return { result: { success: false }, error: prompted.error }
      }

      await new Promise((resolve) => setTimeout(resolve, 75))
    } finally {
      summary = this.endCapture()
    }

    if (!summary.trim()) {
      const error = 'Agent returned an empty summary'
      this.emit('session.error', error)
      return { result: { success: false }, error }
    }

    const filePath = join(cwd, config.sessions.summaryPath, `${id}.md`)
    const header = [
      '---',
      `sessionId: ${id}`,
      `name: ${session.name ?? ''}`,
      `provider: ${agent?.provider_name ?? ''}`,
      `acpSessionId: ${session.acp_session_id}`,
      `generatedAt: ${new Date().toISOString()}`,
      '---',
      '',
    ].join('\n')

    try {
      await mkdir(join(cwd, config.sessions.summaryPath), { recursive: true })
      await Bun.write(filePath, header + summary + '\n')
    } catch (error) {
      const message = `Failed to write summary file: ${error}`
      this.emit('session.error', message)
      return { result: { success: false }, error: message }
    }

    // Upsert the mapping (one summary per session).
    const existing = await this.db
      .select()
      .from(sessionSummaries)
      .where(eq(sessionSummaries.session_id, id))
      .then((res) => res[0])

    if (existing) {
      await this.db
        .update(sessionSummaries)
        .set({ file_path: filePath, format: 'markdown' })
        .where(eq(sessionSummaries.session_id, id))
    } else {
      await this.db
        .insert(sessionSummaries)
        .values({ session_id: id, file_path: filePath, format: 'markdown' })
    }

    return { result: { success: true, filePath, summary } }
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

    this.server_instance
      .getPermissionHandler()
      ?.rejectAllPending(session.acp_session_id)

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
    this.acpSessionIds.clear()
    this.activeSessionId = null
    this.connection = null
    this._captureSessionId = null
    this._captureBuffer = null
    this._captureListener = null
  }

  /**
   * Runs the ACP `authenticate` handshake. Returns `true` when it succeeded.
   *
   * Availability is decided by `initResponse.authMethods`, not by the
   * `auth` agent capability: that capability advertises optional extras
   * (e.g. logout), and agents may offer auth methods without it.
   */
  private async _authenticate(): Promise<boolean> {
    if (!this.connection) {
      this.emit(
        'session.error',
        '2. No active connection found. Please use `client/init` command first.',
      )
      return false
    }

    const authMethods = this.connection.initResponse.authMethods

    if (!authMethods || authMethods.length === 0) {
      this.emit(
        'session.error',
        'No authentication methods available from the server.',
      )
      return false
    }

    let selectedMethod = authMethods[0]

    if (authMethods.length > 1) {
      const questionOptions = authMethods.map((method) => ({
        id: method.id,
        label: method.name,
        description: method.description ?? undefined,
      }))

      const userResponse = await this.server_instance
        .getCommsInterface()
        .question({
          questionId: 'select_auth_method',
          question: `Multiple authentication methods are available. Please select one`,
          options: questionOptions,
        })

      const selectedId = resolveOptionAnswer(
        userResponse,
        questionOptions,
      )
      const matched = authMethods.find((m) => m.id === selectedId)

      if (!matched) {
        this.emit(
          'session.error',
          'Invalid selection for authentication method.',
        )
        return false
      }

      selectedMethod = matched
    }

    if (!selectedMethod) {
      this.emit('session.error', 'No authentication method selected.')
      return false
    }

    try {
      await this.connection.clientContext.request(methods.agent.authenticate, {
        methodId: selectedMethod.id,
      })
    } catch (error) {
      this.emit('session.error', `Authentication failed: ${error}`)
      return false
    }

    return true
  }

  /**
   * Creates the ACP session. On an auth error it authenticates and retries
   * exactly once; `afterAuth` marks that retry (per call, so one failed
   * attempt never blocks later session creation).
   */
  private async _createAcpSession(
    currentAgent: NonNullable<AppState['agent']>,
    requestId?: string,
    afterAuth: boolean = false,
  ): Promise<NewSessionResponse | void> {
    if (!this.connection) {
      this.emit(
        'session.error',
        '3. No active connection found. Please use `client/init` command first.',
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

      if (afterAuth) {
        this.emit(
          'session.error',
          'Session creation failed after authentication attempt. Please check your credentials and try again.',
        )
        return
      }

      if (!(await this._authenticate())) {
        return
      }

      return await this._createAcpSession(currentAgent, requestId, true)
    }
  }

  private async _updateSession<T extends keyof Session['Update']>(
    field: T,
    value: Session['Update'][T],
    id?: string,
    requestId?: string,
  ): Promise<SessionOpResult> {
    const sessionId = id || this.activeSessionId

    if (!sessionId) {
      return this._fail('No active session ID found to update')
    }

    const session = this.sessions.get(sessionId)

    if (!session) {
      return this._fail(`Session with ID ${sessionId} not found`)
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

    return { success: true }
  }

  private async _setSessionMode(
    session: TrackedSession,
    modeId: string,
    requestId?: string,
  ): Promise<SessionOpResult> {
    if (!this.connection) {
      return this._fail(
        'No active connection found. Please use `client/init` command first.',
      )
    }

    await this.connection.clientContext.request(
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
    // `setSessionConfigOption` applies + persists the agent-returned options.
    if (this._findConfigOption(updated, 'mode')) {
      await this.setSessionConfigOption('mode', modeId, session.id, requestId)
    }

    // `_updateSession` persists and emits `session.updated` itself.
    return this._updateSession('modes', updated.modes, session.id, requestId)
  }

  private async _setSessionModel(
    session: TrackedSession,
    modelId: string,
    requestId?: string,
  ): Promise<SessionOpResult> {
    // There is no dedicated `session/set_model` method — model selection is
    // expressed through the config option whose `category` is `model` (or
    // `model_config`). The `id` is agent-chosen, so resolve it by category.
    const modelOption =
      this._findConfigOption(session, 'model') ??
      this._findConfigOption(session, 'model_config')

    if (!modelOption) {
      return this._fail('No model config option found for this session')
    }

    // `setSessionConfigOption` applies + persists the agent-returned options
    // (authoritative), so no local guesswork is needed here.
    const updated = await this.setSessionConfigOption(
      modelOption.id,
      modelId,
      session.id,
      requestId,
    )

    if (!updated) {
      // `setSessionConfigOption` has already emitted the reason.
      return { success: false, error: `Failed to set model ${modelId}` }
    }

    const activeAgent = this.server_instance.getState().agent
    if (activeAgent) {
      this.server_instance.setDefaultModelForProvider(
        activeAgent.provider_name,
        modelId,
        requestId,
      )
    }

    return { success: true }
  }
}
