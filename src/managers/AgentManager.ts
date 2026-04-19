import {
  ClientSideConnection,
  ndJsonStream,
  type Agent as AcpAgent,
  PROTOCOL_VERSION,
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
import type { Subprocess } from 'bun'
import { tapStream } from 'src/utils/helpers'
import { logDebug, logError } from 'src/utils/logger'
import { spawnShellCommand } from 'src/utils/shell'
import { BaseManager } from './BaseManager'
import { SessionUpdateHandler } from 'src/acp/handlers/SessionUpdateHandler'

type SpawnFn = (opts: {
  command: string
  args: string[]
  cwd?: string
  env?: Bun.Env
}) => Subprocess

export class AgentManager extends BaseManager<AgentEvents> {
  private db: ReturnType<AgenticDB['getDB']>
  private agent: AppState['agent'] | null = null

  private fileSystemHandler: FileSystemHandler
  private permissionHandler: PermissionHandler
  private terminalHandler: TerminalHandler
  private sessionUpdateHandler: SessionUpdateHandler

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

    if (this.agent.process) {
      return
    }

    this.agent.process = this.spawnFn({
      command: this.agent.provider_command,
      args: this.agent.provider_args,
      cwd: this.agent.cwd,
      env: this.agent.env || undefined,
    })

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

    const client = new AcpClient(
      this.fileSystemHandler,
      this.permissionHandler,
      this.terminalHandler,
      this.sessionUpdateHandler,
    )

    const connection = new ClientSideConnection((agent: AcpAgent) => {
      client.setAgent(agent)
      return client
    }, tappedStream)

    //Initialize the connection
    const initResponse = await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: {
        name: `${process.env.EDITOR_NAME} Agentic Client`,
        version: '0.1',
      },
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true,
        },
        terminal: true,
      },
    })

    logDebug(`Connection initialized!`)
    // ;(async () => {
    //   await connection.closed
    //   logDebug(`Connection closed for agent ${this.agent?.id}`)
    //   this.emit('agent.disconnected', this.agent ?? undefined)
    //   this.dispose()
    // })()
    this.emit('agent.connected', {
      requestId,
      data: this.agent,
    })

    return { connection, client, initResponse }
  }

  public handleTerminalResponse(msg: ASMPayloadParams['client/terminal']) {
    this.terminalHandler.handleResponse(msg)
  }

  public kill(requestId?: string) {
    if (!this.agent || !this.agent.process) {
      return
    }

    logDebug(`Killing process for agent ${this.agent.id}`)

    try {
      this.agent.process.kill('SIGKILL')
      this.agent.process = undefined
      this.emit('agent.killed', {
        requestId,
        data: this.agent,
      })
    } catch (error) {
      logError(`Failed to kill process for agent ${this.agent.id}:`, error)
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
      this.agent = agent
      this.emit('agent.updated', {
        requestId,
        data: agent,
      })
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
      this.agent = agent
      this.emit('agent.updated', {
        requestId,
        data: agent,
      })
    }
  }

  public getSessionUpdateHandler() {
    return this.sessionUpdateHandler
  }

  public getPermissionHandler() {
    return this.permissionHandler
  }

  public dispose(requestId?: string) {
    if (this.permissionHandler) {
      this.permissionHandler.dispose()
    }

    if (this.terminalHandler) {
      this.terminalHandler.dispose()
    }

    if (this.fileSystemHandler) {
      this.fileSystemHandler.dispose()
    }

    this.removeAllListeners()
    this.kill(requestId)
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
