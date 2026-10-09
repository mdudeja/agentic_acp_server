import type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  EnvVariable,
  KillTerminalRequest,
  KillTerminalResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  TerminalExitStatus,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
} from '@agentclientprotocol/sdk'
import type { AgenticServer } from 'src/AgenticServer'
import type {
  ASMPayloadParams,
  TerminalNotificationParams,
  TerminalRequestToEditor,
  TerminalResponseFromEditor,
} from 'src/comms/ICommsInterface'
import { logDebug, logWarning } from 'src/utils/logger'

/**
 * Represents a terminal instance managed by the handler.
 */
export interface HandledTerminal {
  terminalId: string
  command?: string
  cwd?: string
  env?: EnvVariable[]
  stdout: string
  stderr: string
  exitStatus?: TerminalExitStatus
  outputByteLimit?: number
  isRunning: boolean
}

/**
 * Terminal operation method names
 */
type TerminalMethod = keyof TerminalRequestToEditor

/**
 * Resolver for a pending terminal operation.
 */
interface PendingOperation<T> {
  resolve: (value: T) => void
  reject: (error: Error) => void
  timeout?: ReturnType<typeof setTimeout>
}

/**
 * Handler for terminal operations.
 * Manages terminal instances in the Editor, sending commands and collecting output.
 */
export class TerminalHandler {
  private terminals: Map<string, HandledTerminal> = new Map()
  private pendingOperations = new Map<string, PendingOperation<any>>()
  private requestIdCounter = 0

  /**
   * Creates a new TerminalHandler instance.
   *
   * @param server_instance - The AgenticServer instance for accessing system resources
   */
  constructor(private readonly server_instance: AgenticServer) {}

  /**
   * Called by the main server when a terminal response is received from the Editor.
   * Resolves the corresponding pending operation.
   */
  handleResponse(msg: ASMPayloadParams['client/terminal']) {
    const commsInterface = this.server_instance.getCommsInterface()
    const pending = this.pendingOperations.get(msg.requestId)
    if (!pending) {
      logWarning(
        `No pending terminal operation found for request: ${msg.requestId}`,
      )
      commsInterface?.respond({
        method: 'client/terminal',
        id: msg.requestId,
        error: {
          message: `No pending terminal operation found for requestId ${msg.requestId}`,
        },
      })
      return
    }

    if (pending.timeout) {
      clearTimeout(pending.timeout)
    }

    this.pendingOperations.delete(msg.requestId)

    if (msg.error) {
      pending.reject(new Error(msg.error.message || String(msg.error)))
      commsInterface?.respond({
        method: 'client/terminal',
        id: msg.requestId,
        error: {
          message: msg.error.message || String(msg.error),
        },
      })
    } else {
      pending.resolve(msg.response)
      commsInterface?.respond({
        method: 'client/terminal',
        id: msg.requestId,
        result: { success: true, requestId: msg.requestId },
      })
    }
  }

  /**
   * Creates a new terminal in the Editor and runs the specified command.
   */
  async createTerminal(
    params: CreateTerminalRequest,
  ): Promise<CreateTerminalResponse> {
    logDebug('Creating terminal with params:', params)

    const requestId = this._generateRequestId()
    const terminalId = `term_${Date.now()}`

    // Create terminal record
    const terminal: HandledTerminal = {
      terminalId,
      command: params.command,
      cwd: params.cwd ?? undefined,
      env: params.env ?? undefined,
      stdout: '',
      stderr: '',
      isRunning: true,
      outputByteLimit: params.outputByteLimit ?? undefined,
    }

    this.terminals.set(terminalId, terminal)

    // Send request to the Editor and wait for response
    let response: TerminalResponseFromEditor['create']
    try {
      response = await this._terminalRequest('create', {
        requestId,
        terminalId,
        command: params.command,
        cwd: params.cwd ?? undefined,
        env: params.env ?? undefined,
        outputByteLimit: params.outputByteLimit ?? undefined,
      })
    } catch (error) {
      // Don't keep a record for a terminal that was never created.
      this.terminals.delete(terminalId)
      throw error
    }

    // The agent addresses later calls by the id returned here, so the record
    // must be stored under the editor's id when it chose a different one.
    const editorTerminalId = response.params.terminalId || terminalId
    if (editorTerminalId !== terminalId) {
      this.terminals.delete(terminalId)
      terminal.terminalId = editorTerminalId
      this.terminals.set(editorTerminalId, terminal)
    }

    return {
      _meta: params._meta,
      terminalId: editorTerminalId,
    }
  }

  /**
   * Retrieves the current output from a terminal.
   */
  async terminalOutput(
    params: TerminalOutputRequest,
  ): Promise<TerminalOutputResponse> {
    logDebug('Getting terminal output for:', params.terminalId)

    const terminal = this.terminals.get(params.terminalId)
    if (!terminal) {
      throw new Error(`Terminal not found: ${params.terminalId}`)
    }

    const requestId = this._generateRequestId()

    // Request current output from the Editor and wait for response
    const response = await this._terminalRequest(
      'get_output',
      {
        requestId,
        terminalId: params.terminalId,
      },
      10000,
    )

    // Update local terminal state
    terminal.stdout = response.params.stdout || ''
    terminal.stderr = response.params.stderr || ''
    if (response.params.exitStatus !== undefined) {
      terminal.exitStatus = response.params.exitStatus
      terminal.isRunning = false
    }

    return {
      _meta: params._meta,
      // ACP has a single output stream; keep both rather than dropping
      // stdout whenever anything was written to stderr.
      output: terminal.stdout + terminal.stderr,
      exitStatus: terminal.exitStatus,
      truncated: response.params.truncated ?? false,
    }
  }

  /**
   * Waits for a terminal to exit and returns the exit code.
   */
  async waitForTerminalExit(
    params: WaitForTerminalExitRequest,
  ): Promise<WaitForTerminalExitResponse> {
    logDebug('Waiting for terminal exit:', params.terminalId)

    const terminal = this.terminals.get(params.terminalId)
    if (!terminal) {
      throw new Error(`Terminal not found: ${params.terminalId}`)
    }

    // If already exited, return immediately
    if (!terminal.isRunning && terminal.exitStatus !== undefined) {
      return {
        _meta: params._meta,
        exitCode: terminal.exitStatus.exitCode,
        signal: terminal.exitStatus.signal,
      }
    }

    const requestId = this._generateRequestId()

    // Wait for exit notification (longer timeout for long-running commands)
    const response = await this._terminalRequest(
      'wait_exit',
      {
        requestId,
        terminalId: params.terminalId,
      },
      300000, // 5 minute timeout
    )

    // Update local terminal state
    terminal.exitStatus = response.params.exitStatus
    terminal.stdout = ''
    terminal.stderr = ''
    terminal.isRunning = false

    return {
      _meta: params._meta,
      exitCode: (response.params.exitStatus as TerminalExitStatus).exitCode,
      signal: (response.params.exitStatus as TerminalExitStatus).signal,
    }
  }

  /**
   * Kills a running terminal.
   */
  async killTerminal(
    params: KillTerminalRequest,
  ): Promise<KillTerminalResponse> {
    logDebug('Killing terminal:', params.terminalId)

    const terminal = this.terminals.get(params.terminalId)
    if (!terminal) {
      throw new Error(`Terminal not found: ${params.terminalId}`)
    }

    const requestId = this._generateRequestId()

    // Send kill request to the Editor and wait for confirmation
    const response = await this._terminalRequest(
      'kill',
      {
        requestId,
        terminalId: params.terminalId,
        signal: 'SIGTERM',
      },
      5000,
    )

    if (!response.params.success) {
      throw new Error(`Failed to kill terminal: ${params.terminalId}`)
    }

    // Mark terminal as not running
    terminal.isRunning = false

    return {
      _meta: params._meta,
    }
  }

  /**
   * Releases/closes a terminal and removes it from tracking.
   */
  async releaseTerminal(
    params: ReleaseTerminalRequest,
  ): Promise<ReleaseTerminalResponse> {
    logDebug('Releasing terminal:', params.terminalId)

    const terminal = this.terminals.get(params.terminalId)
    if (!terminal) {
      throw new Error(`Terminal not found: ${params.terminalId}`)
    }

    const requestId = this._generateRequestId()

    // Send release request to the Editor and wait for confirmation
    await this._terminalRequest(
      'release',
      {
        requestId,
        terminalId: params.terminalId,
      },
      5000,
    )

    // Remove from tracking
    this.terminals.delete(params.terminalId)

    return {
      _meta: params._meta,
    }
  }

  /**
   * Gets all active terminals.
   */
  getActiveTerminals(): HandledTerminal[] {
    return Array.from(this.terminals.values())
  }

  /**
   * Generates a unique request ID for terminal operations.
   */
  private _generateRequestId(): string {
    return `terminal_req_${Date.now()}_${++this.requestIdCounter}`
  }

  /**
   * Sends a terminal request to the Editor and returns a promise that resolves with the response.
   */
  private _terminalRequest<M extends TerminalMethod>(
    method: M,
    params: TerminalRequestToEditor[M],
    timeoutMs: number = 30000,
  ): Promise<TerminalResponseFromEditor[M]> {
    return new Promise((resolve, reject) => {
      const requestId = params.requestId

      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingOperations.delete(requestId)
        reject(
          new Error(
            `Terminal operation '${method}' timed out after ${timeoutMs}ms: ${requestId}`,
          ),
        )
      }, timeoutMs)

      // Store the pending operation
      this.pendingOperations.set(requestId, {
        resolve,
        reject,
        timeout,
      })

      const commsInterface = this.server_instance.getCommsInterface()
      if (!commsInterface) {
        clearTimeout(timeout)
        this.pendingOperations.delete(requestId)
        reject(new Error('Comms interface not available'))
        return
      }

      const data: TerminalNotificationParams = {
        method: 'agentic/terminal',
        data: params,
      }

      commsInterface.notify(data)
    })
  }

  /**
   * Cleans up all terminals and pending operations.
   */
  dispose() {
    // Clear all pending operations
    for (const [_, pending] of this.pendingOperations.entries()) {
      if (pending.timeout) {
        clearTimeout(pending.timeout)
      }
      pending.reject(new Error('TerminalHandler disposed'))
    }
    this.pendingOperations.clear()

    // Clear all terminals
    this.terminals.clear()
    logDebug('TerminalHandler disposed')
  }
}
