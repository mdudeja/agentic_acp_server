import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientConnection,
  type ClientContext,
} from '@agentclientprotocol/sdk'
import { and, desc, eq } from 'drizzle-orm'
import type { AgenticServer } from 'src/AgenticServer'
import { AcpClient } from 'src/acp/Client'
import { FileSystemHandler } from 'src/acp/handlers/FileSystemHandler'
import { PermissionHandler } from 'src/acp/handlers/PermissionHandler'
import { TerminalHandler } from 'src/acp/handlers/TerminalHandler'
import type { AgentEvents } from 'src/data/events'
import { Providers, PROVIDERS } from 'src/data/providers'
import { AgenticDB } from 'src/database/AgenticDB'
import { agents, type Agent } from 'src/database/schemas'
import type { ASMPayloadParams } from 'src/openrpc/schemas'
import type { AppState } from 'src/state/types'
import { tapStream } from 'src/utils/helpers'
import { logDebug, logError } from 'src/utils/logger'
import { spawnShellCommand, type SpawnFn } from 'src/utils/shell'
import { BaseManager } from './BaseManager'
import type { Subprocess } from 'bun'
import { SessionUpdateHandler } from 'src/acp/handlers/SessionUpdateHandler'
import { ElicitationHandler } from 'src/acp/handlers/ElicitationHandler'

export class AgentManager extends BaseManager<AgentEvents> {
  private db: ReturnType<AgenticDB['getDB']>
  private agent: AppState['agent'] | null = null
  /** Live ACP connection handle, kept so teardown can close it gracefully. */
  private acpConnection: ClientConnection | null = null
  /**
   * In-flight `clientContext.request` promises on the live connection. Before
   * closing we drain these so `close()` does not abort a request mid-flight
   * (which surfaces as an "ACP connection closed" rejection to the caller).
   */
  private pendingRequests = new Set<Promise<unknown>>()
  /** Once set, the connection no longer accepts new requests. */
  private draining = false

  /** Max time to wait for in-flight requests to settle before force-closing. */
  private static readonly DRAIN_TIMEOUT_MS = 3000

  private fileSystemHandler: FileSystemHandler
  private permissionHandler: PermissionHandler
  private terminalHandler: TerminalHandler
  private sessionUpdateHandler: SessionUpdateHandler
  private elicitationHandler: ElicitationHandler

  constructor(
    private provider: Providers,
    private cwd: string,
    private readonly server_instance: AgenticServer,
    private spawnFn: SpawnFn = spawnShellCommand,
  ) {
    super()

    const dbInstance = AgenticDB.getInstance()
    this.db = dbInstance.getDB()

    this.fileSystemHandler = new FileSystemHandler()
    this.permissionHandler = new PermissionHandler(this.server_instance)
    this.terminalHandler = new TerminalHandler(this.server_instance)
    this.sessionUpdateHandler = new SessionUpdateHandler(this.server_instance)
    this.elicitationHandler = new ElicitationHandler(this.server_instance)
  }

  public async init(requestId?: string) {
    const existingAgent = await this.db
      .select()
      .from(agents)
      .where(
        and(eq(agents.provider_name, this.provider), eq(agents.cwd, this.cwd)),
      )
      .orderBy(desc(agents.created_at))
      .limit(1)
      .then((res) => res[0] || null)

    if (!existingAgent) {
      const agent = await this._createNew()
      if (!agent) {
        this.emit('agent.error', 'Failed to create new agent')
        return
      }

      this.agent = agent

      this.emit('agent.created', {
        requestId,
        data: agent,
      })
      this.emit('agent.loaded', {
        requestId,
        data: agent,
      })
      return
    }

    this.agent = existingAgent
    this.emit('agent.loaded', {
      requestId,
      data: existingAgent,
    })
  }

  public spawn(requestId?: string) {
    if (!this.agent) {
      this.emit('agent.error', 'Agent is not initialized')
      return
    }

    // Guard against double-spawn, but only for the SAME provider. A stale
    // process belonging to another provider must not block this spawn.
    if (this.agent.process && this.agent.provider_name === this.provider) {
      return
    }

    const proc = this.spawnFn({
      command: this.agent.provider_command,
      args: this.agent.provider_args,
      cwd: this.agent.cwd,
      env: this.agent.env || undefined,
    })
    this.agent.process = proc
    proc.exited.then((exitCode) => this._onProcessExit(proc, exitCode))

    this.emit('agent.spawned', {
      requestId,
      data: this.agent,
    })
  }

  public async connect(requestId?: string) {
    if (!this.agent) {
      this.emit('agent.error', 'Agent is not initialized')
      return
    }

    if (!this.agent.process) {
      this.emit('agent.error', 'Agent process is not running')
      return
    }

    logDebug(`Connecting to agent ${this.agent.id}`)

    const self = this

    const { stdin, stdout } = this.agent.process
    if (
      !stdout ||
      typeof stdout === 'number' ||
      !stdin ||
      typeof stdin === 'number'
    ) {
      this.emit(
        'agent.error',
        `Agent process for agent ${this.agent.id} does not have valid stdio streams`,
      )
      return
    }

    // FileSink → WritableStream<Uint8Array> adapter
    const writableStdin = new WritableStream<Uint8Array>({
      write(chunk) {
        stdin.write(chunk)
      },
      close() {
        stdin.end()
      },
      abort() {
        stdin.end()
      },
    })

    const stream = ndJsonStream(writableStdin, stdout)
    const tappedStream = tapStream(stream)

    const acpClient = new AcpClient(
      this.fileSystemHandler,
      this.permissionHandler,
      this.terminalHandler,
      this.sessionUpdateHandler,
      this.elicitationHandler,
    )

    const app = client({
      name: `${process.env.ACP_EDITOR_NAME} Agentic Client`,
    })
      .onRequest(methods.client.session.requestPermission, (ctx) =>
        acpClient.requestPermission(ctx.params),
      )
      .onNotification(methods.client.session.update, (ctx) =>
        acpClient.sessionUpdate(ctx.params),
      )
      .onRequest(methods.client.elicitation.create, (ctx) =>
        acpClient.createElicitation(ctx.params),
      )
      .onNotification(methods.client.elicitation.complete, (ctx) =>
        acpClient.completeElicitation(ctx.params),
      )
      .onRequest(methods.client.fs.writeTextFile, (ctx) =>
        acpClient.writeTextFile(ctx.params),
      )
      .onRequest(methods.client.fs.readTextFile, (ctx) =>
        acpClient.readTextFile(ctx.params),
      )
      .onRequest(methods.client.terminal.create, (ctx) =>
        acpClient.createTerminal(ctx.params),
      )
      .onRequest(methods.client.terminal.output, (ctx) =>
        acpClient.terminalOutput(ctx.params),
      )
      .onRequest(methods.client.terminal.waitForExit, (ctx) =>
        acpClient.waitForTerminalExit(ctx.params),
      )
      .onRequest(methods.client.terminal.kill, (ctx) =>
        acpClient.killTerminal(ctx.params),
      )
      .onRequest(methods.client.terminal.release, (ctx) =>
        acpClient.releaseTerminal(ctx.params),
      )

    // `connect()` (unlike `connectWith()`) keeps the connection open for the
    // lifetime of the process. `connectWith()` closes the connection as soon
    // as its callback resolves, which would tear down the ACP session before
    // any `session/new` request could be made.
    const connection = app.connect(tappedStream)
    const rawClientContext = connection.agent

    // Keep the handle so teardown can close the connection cleanly.
    this.acpConnection = connection
    this.draining = false

    // Intercept `request` so we can track in-flight requests and drain them
    // before closing (`close()` aborts pending requests, which would reject
    // the caller with "ACP connection closed"). A Proxy is used because
    // `notify`/helpers live on the ClientContext prototype — a spread would
    // drop them. `notify` is fire-and-forget and needs no tracking.
    const clientContext: ClientContext = new Proxy(rawClientContext, {
      get(target, prop, receiver) {
        if (prop === 'request') {
          return (method: unknown, params: unknown, options?: unknown) => {
            if (self.draining) {
              throw new Error(
                'ACP connection is shutting down; request rejected',
              )
            }
            let p: Promise<unknown>
            try {
              p = (
                target.request as (
                  m: unknown,
                  p: unknown,
                  o?: unknown,
                ) => Promise<unknown>
              ).call(target, method, params, options)
            } catch (error) {
              return Promise.reject(error)
            }
            const tracked = Promise.resolve(p).finally(() => {
              self.pendingRequests.delete(tracked)
            })
            self.pendingRequests.add(tracked)
            return tracked
          }
        }
        return Reflect.get(target, prop, receiver)
      },
    })

    const initResponse = await clientContext.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: {
        name: `${process.env.ACP_EDITOR_NAME} Agentic Client`,
        version: '0.1',
      },
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
        terminal: true,
        session: {
          compaction: {},
          configOptions: {},
        },
        plan: {},
        auth: {
          terminal: true,
        },
        nes: {
          jump: {},
          rename: {},
          searchAndReplace: {},
        },
        positionEncodings: ['utf-8', 'utf-16', 'utf-32'],
        elicitation: {
          form: {},
          url: {},
        },
      },
    })

    logDebug(
      `Connection initialized! (protocol v${initResponse.protocolVersion})`,
    )

    // Publish the connection to state BEFORE emitting `agent.connected`, so
    // that the `agent.connected` handler (which initialises the
    // SessionManager) can read `state.connection` without racing.
    this.server_instance.getManagers().stateManager?.setItem('connection', {
      clientContext,
      client: acpClient,
      initResponse,
    })

    this.emit('agent.connected', {
      requestId,
      data: this.agent,
    })

    return {
      clientContext,
      client: acpClient,
      initResponse,
    }
  }

  /** Whether the agent subprocess is running. */
  public isAlive(): boolean {
    const proc = this.agent?.process
    return !!proc && proc.exitCode == null && !proc.killed
  }

  /**
   * Handles the agent process exiting on its own (crash, failed start, user
   * killed it). `kill()` detaches the process before stopping it, so an
   * intentional shutdown never lands here.
   *
   * Closing the ACP connection rejects in-flight requests (a running
   * `session/prompt`, or the `initialize` of a process that died on start)
   * instead of leaving them pending forever.
   */
  private _onProcessExit(proc: Subprocess, exitCode: number | null) {
    if (!this.agent || this.agent.process !== proc) {
      return
    }

    logError(
      `Agent process for agent ${this.agent.id} exited unexpectedly (code ${exitCode})`,
    )

    this.agent.process = undefined
    this.draining = true
    this.acpConnection?.close()
    this.acpConnection = null
    this.permissionHandler.rejectAllPending()

    this.emit('agent.disconnected', { data: this.agent, exitCode })
  }

  public handleTerminalResponse(msg: ASMPayloadParams['client/terminal']) {
    this.terminalHandler.handleResponse(msg)
  }

  public async kill(requestId?: string) {
    if (!this.agent || !this.agent.process) {
      return
    }

    logDebug(`Killing process for agent ${this.agent.id}`)

    // Detach first: closing the connection ends the agent's stdin, which may
    // make it exit on its own before the SIGKILL below. Detaching marks that
    // exit as intentional for `_onProcessExit`.
    const proc = this.agent.process
    this.agent.process = undefined

    try {
      // Drain-before-close: wait for in-flight `request`s to settle so
      // `close()` doesn't abort one and reject its caller with "ACP
      // connection closed". New requests are refused meanwhile.
      this.draining = true
      await this._drainPendingRequests()

      this.acpConnection?.close()
      await this.acpConnection?.closed
      this.acpConnection = null

      proc.kill('SIGKILL')
      // SIGKILL cannot be ignored, so this settles promptly; waiting means
      // callers (switch, shutdown) only proceed once the agent is gone.
      await proc.exited
      this.emit('agent.killed', {
        requestId,
        data: this.agent,
      })
    } catch (error) {
      logError(`Failed to kill process for agent ${this.agent.id}:`, error)
    }
  }

  /**
   * Waits for in-flight requests to settle, bounded by `DRAIN_TIMEOUT_MS`.
   * Never rejects; a request that fails during the drain must not mask the
   * teardown itself.
   */
  private async _drainPendingRequests() {
    while (this.pendingRequests.size > 0) {
      const snapshot = Array.from(this.pendingRequests)
      const settled = await Promise.race([
        Promise.allSettled(snapshot),
        new Promise<void>((resolve) =>
          setTimeout(resolve, AgentManager.DRAIN_TIMEOUT_MS),
        ),
      ])
      // `settled` is an array when the requests won; `undefined` on timeout.
      if (!Array.isArray(settled)) {
        logDebug(
          `Drain timed out with ${this.pendingRequests.size} request(s) still pending; forcing close`,
        )
        return
      }
      if (this.pendingRequests.size >= snapshot.length) {
        return
      }
    }
  }

  public async setDefaultModelForProvider(
    provider: Providers,
    modelId: string,
    requestId?: string,
  ) {
    const agent = await this.db
      .update(agents)
      .set({ default_model_id: modelId })
      .where(and(eq(agents.provider_name, provider), eq(agents.cwd, this.cwd)))
      .returning()
      .then((res) => res[0] || null)

    if (agent) {
      this._refreshAgentRow(agent, requestId)
    }
  }

  public async setCliInited(requestId?: string) {
    if (!this.agent) {
      this.emit('agent.error', 'Agent is not initialized')
      return
    }

    const agent = await this.db
      .update(agents)
      .set({ cli_inited: true })
      .where(eq(agents.id, this.agent.id))
      .returning()
      .then((res) => res[0] || null)

    if (agent) {
      this._refreshAgentRow(agent, requestId)
    }
  }

  /**
   * Replaces the cached agent with a freshly written DB row. The row has no
   * `process`, so the live subprocess handle is carried over; dropping it
   * would leave `kill()` unable to stop the agent.
   */
  private _refreshAgentRow(row: Agent['Select'], requestId?: string) {
    this.agent = { ...row, process: this.agent?.process }
    this.emit('agent.updated', {
      requestId,
      data: this.agent,
    })
  }

  public getProvider(): Providers {
    return this.provider
  }

  public getCwd(): string {
    return this.cwd
  }

  public getAgent() {
    return this.agent
  }

  public getSessionUpdateHandler() {
    return this.sessionUpdateHandler
  }

  public getPermissionHandler() {
    return this.permissionHandler
  }

  public getElicitationHandler() {
    return this.elicitationHandler
  }

  public async dispose(requestId?: string) {
    if (this.permissionHandler) {
      this.permissionHandler.dispose()
    }

    if (this.terminalHandler) {
      this.terminalHandler.dispose()
    }

    if (this.fileSystemHandler) {
      this.fileSystemHandler.dispose()
    }

    if (this.elicitationHandler) {
      this.elicitationHandler.dispose()
    }

    await this.kill(requestId)
    this.removeAllListeners()
    this.agent = null
  }

  private async _createNew() {
    const pConfig = PROVIDERS[this.provider]

    if (!pConfig) {
      this.emit('agent.error', `Unsupported provider: ${this.provider}`)
      return
    }

    const newAgent: Agent['Insert'] = {
      provider_name: this.provider,
      cwd: this.cwd,
      provider_title: pConfig.name,
      provider_command: pConfig.command,
      provider_args: pConfig.args as unknown as string[],
    }

    const created = await this.db?.insert(agents).values(newAgent).returning()
    return created && created.length && created[0]
  }
}
