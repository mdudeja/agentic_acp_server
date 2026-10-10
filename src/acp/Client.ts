import * as acp from '@agentclientprotocol/sdk'
import type { FileSystemHandler } from 'src/acp/handlers/FileSystemHandler'
import type { PermissionHandler } from 'src/acp/handlers/PermissionHandler'
import type { TerminalHandler } from 'src/acp/handlers/TerminalHandler'
import type { SessionUpdateHandler } from 'src/acp/handlers/SessionUpdateHandler'
import type { ElicitationHandler } from 'src/acp/handlers/ElicitationHandler'
import type { HookEventName, HookInput } from 'src/hooks/events'
import type { HookRunner } from 'src/hooks/types'
import { resolvePath } from 'src/utils/paths'

/** How the ACP client reaches the hook system. */
export interface AcpClientHooks {
  run: HookRunner
  /** The local session id for an ACP session id, if tracked. */
  localSessionId(acpSessionId: string): string | undefined
}

const NO_HOOKS: AcpClientHooks = {
  run: async <E extends HookEventName>(_event: E, input: HookInput<E>) => ({
    input,
  }),
  localSessionId: () => undefined,
}

/** Converts an array of environment variables into a record format, using the variable names as keys and their corresponding values. If the input is null or undefined, returns an empty object. */
const toRecord = (env: acp.EnvVariable[] | null | undefined) =>
  env
    ? Object.fromEntries(env.map(({ name, value }) => [name, value]))
    : undefined

/** Transforms an environment object into an array of key-value pairs. */
const toPairs = (env: Record<string, string> | undefined) =>
  env
    ? Object.entries(env).map(([name, value]) => ({ name, value }))
    : undefined

/**
 * The ACP client: every agent → client request arrives here. Each method
 * runs the matching hook event first (see `src/hooks/events.ts`), then
 * delegates to its handler.
 */
export class AcpClient implements acp.Client {
  private agent: acp.Agent | null = null
  /** Command lines of created terminals, for `terminal.afterExit`. */
  private terminalCommands = new Map<string, string>()

  /** Initializes a new instance of the AcpClient with the specified handlers and hooks. */
  constructor(
    private readonly fsHandler: FileSystemHandler,
    private readonly permissionHandler: PermissionHandler,
    private readonly terminalHandler: TerminalHandler,
    private readonly sessionUpdateHander: SessionUpdateHandler,
    private readonly elicitationHandler: ElicitationHandler,
    private readonly hooks: AcpClientHooks = NO_HOOKS,
  ) {}

  /** Sets the agent for the current context. */
  setAgent(agent: acp.Agent) {
    this.agent = agent
  }

  /** Retrieves the current agent or returns null if no agent is available. */
  getAgent(): acp.Agent | null {
    return this.agent
  }

  /** Establishes a reference to the session using the provided ACP session ID. */
  private _sessionRef(acpSessionId: string) {
    return {
      sessionId: this.hooks.localSessionId(acpSessionId),
      acpSessionId,
    }
  }

  /** Requests permission to access resources on behalf of the user. */
  async requestPermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    const outcome = await this.hooks.run('permission.request', {
      ...this._sessionRef(params.sessionId),
      toolCall: {
        toolCallId: params.toolCall.toolCallId,
        title: params.toolCall.title ?? undefined,
        kind: params.toolCall.kind ?? undefined,
        rawInput: params.toolCall.rawInput,
      },
      options: params.options.map(({ optionId, name, kind }) => ({
        optionId,
        name,
        kind,
      })),
    })

    if (outcome.decision) {
      const kinds =
        outcome.decision === 'allow'
          ? ['allow_once', 'allow_always']
          : ['reject_once', 'reject_always']
      const option = kinds
        .map((kind) => params.options.find((opt) => opt.kind === kind))
        .find(Boolean)

      if (option) {
        return {
          _meta: params._meta,
          outcome: { outcome: 'selected', optionId: option.optionId },
        }
      }
      if (outcome.decision === 'deny') {
        return { _meta: params._meta, outcome: { outcome: 'cancelled' } }
      }
      // An allow with no allow option: let the user choose.
    }

    return this.permissionHandler.requestPermission(params)
  }

  /** Updates the session with new information from a notification. */
  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    // Observe-only: not awaited, so hooks never slow the update stream.
    void this.hooks.run('session.update', {
      ...this._sessionRef(params.sessionId),
      updateType: params.update.sessionUpdate,
      update: params.update,
    })

    await this.sessionUpdateHander.handleUpdate(params.sessionId, params.update)
  }

  /** Creates an elicitation asynchronously. */
  async createElicitation(
    params: acp.CreateElicitationRequest,
  ): Promise<acp.CreateElicitationResponse> {
    const fields = params as unknown as Record<string, unknown>
    const outcome = await this.hooks.run('elicitation.request', {
      acpSessionId:
        typeof fields.sessionId === 'string' ? fields.sessionId : undefined,
      mode: typeof fields.mode === 'string' ? fields.mode : 'unknown',
      message: params.message,
      requestedSchema: fields.requestedSchema,
      url: typeof fields.url === 'string' ? fields.url : undefined,
    })

    if (outcome.decision === 'deny') {
      return { action: 'decline' }
    }
    if (outcome.decision === 'allow') {
      return {
        action: 'accept',
        content: outcome.input
          .content as acp.ElicitationAcceptAction['content'],
      }
    }

    return this.elicitationHandler.createElicitation(params)
  }

  /** Completes the elicitation process by finalizing the notification. */
  async completeElicitation(
    params: acp.CompleteElicitationNotification,
  ): Promise<void> {
    await this.elicitationHandler.completeElicitation(params)
  }

  /* File system operations */
  async readTextFile(
    params: acp.ReadTextFileRequest,
  ): Promise<acp.ReadTextFileResponse> {
    const path = resolvePath(params.path)
    const outcome = await this.hooks.run('fs.beforeRead', {
      ...this._sessionRef(params.sessionId),
      path,
      line: params.line ?? undefined,
      limit: params.limit ?? undefined,
    })

    if (outcome.decision === 'deny') {
      throw new Error(
        `Reading ${path} was blocked by hook ${outcome.decidedBy}: ${outcome.reason ?? 'no reason given'}`,
      )
    }

    return this.fsHandler.readTextFile(params)
  }

  /** Writes text to a file, creating or updating the file as needed. */
  async writeTextFile(
    params: acp.WriteTextFileRequest,
  ): Promise<acp.WriteTextFileResponse> {
    const ref = this._sessionRef(params.sessionId)
    const path = resolvePath(params.path)
    const outcome = await this.hooks.run('fs.beforeWrite', {
      ...ref,
      path,
      content: params.content,
    })

    if (outcome.decision === 'deny') {
      throw new Error(
        `Writing ${path} was blocked by hook ${outcome.decidedBy}: ${outcome.reason ?? 'no reason given'}`,
      )
    }

    const result = await this.fsHandler.writeTextFile({
      ...params,
      content: outcome.input.content,
    })

    void this.hooks.run('fs.afterWrite', { ...ref, path })

    return result
  }

  /* Terminal operations */
  async createTerminal(
    params: acp.CreateTerminalRequest,
  ): Promise<acp.CreateTerminalResponse> {
    const ref = this._sessionRef(params.sessionId)
    const outcome = await this.hooks.run('terminal.beforeCreate', {
      ...ref,
      command: params.command,
      args: params.args ?? [],
      cwd: params.cwd ?? undefined,
      env: toRecord(params.env),
    })
    const { command, args, cwd, env } = outcome.input
    const commandLine = [command, ...args].join(' ')

    if (outcome.decision === 'deny') {
      throw new Error(
        `Running \`${commandLine}\` was blocked by hook ${outcome.decidedBy}: ${outcome.reason ?? 'no reason given'}`,
      )
    }

    const result = await this.terminalHandler.createTerminal({
      ...params,
      command,
      args,
      cwd: cwd ?? params.cwd,
      env: toPairs(env) ?? params.env,
    })
    this.terminalCommands.set(result.terminalId, commandLine)

    return result
  }

  /** Fetches and returns the terminals output based on the provided request. */
  async terminalOutput(
    params: acp.TerminalOutputRequest,
  ): Promise<acp.TerminalOutputResponse> {
    return this.terminalHandler.terminalOutput(params)
  }

  /** Waits for a terminal process to complete and returns its exit status. */
  async waitForTerminalExit(
    params: acp.WaitForTerminalExitRequest,
  ): Promise<acp.WaitForTerminalExitResponse> {
    const result = await this.terminalHandler.waitForTerminalExit(params)

    void this.hooks.run('terminal.afterExit', {
      ...this._sessionRef(params.sessionId),
      terminalId: params.terminalId,
      command: this.terminalCommands.get(params.terminalId),
      exitCode: result.exitCode,
      signal: result.signal,
    })

    return result
  }

  /** Terminates a terminal session by stopping its execution and releasing associated resources. */
  async killTerminal(
    params: acp.KillTerminalRequest,
  ): Promise<acp.KillTerminalResponse> {
    return this.terminalHandler.killTerminal(params)
  }

  /** Releases a terminal. */
  async releaseTerminal(
    params: acp.ReleaseTerminalRequest,
  ): Promise<acp.ReleaseTerminalResponse | void> {
    this.terminalCommands.delete(params.terminalId)
    return this.terminalHandler.releaseTerminal(params)
  }
}
