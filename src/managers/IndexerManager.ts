import type { IndexerEvents } from 'src/data/events'
import { BaseManager } from './BaseManager'
import type { AgenticServer } from 'src/AgenticServer'
import { spawnShellCommand } from 'src/utils/shell'

/** Manages and coordinates multiple indexer instances to ensure efficient data retrieval and synchronization across the system. It handles the lifecycle of indexers and provides a centralized interface for managing indexing operations. */
export class IndexerManager extends BaseManager<IndexerEvents> {
  private commands?: Record<string, string>
  private state?: 'ready' | 'indexing' | 'errored'

  /** Initializes an IndexerManager instance with the specified server instance to manage indexing operations. */
  constructor(private readonly server_instance: AgenticServer) {
    super()
  }

  /** Initialize the component or object by setting up its initial state or configuration. */
  init() {
    const config = this.server_instance.getState().config

    if (!config) {
      this.emit(
        'indexer.error',
        'App config not found. Cannot create IndexerManager',
      )
      return
    }

    if (!config.indexer?.enabled) {
      return
    }

    this.commands = config.indexer.commands

    this.state = 'ready'
    this.emit('indexer.ready', { data: 'Indexer Ready' })
  }

  /**
   * Runs a configured indexer command. Resolves once it finishes, so a
   * `client/index` request can be answered with the outcome.
   */
  async runCommand(
    command: string,
    requestId?: string,
  ): Promise<{ success: true } | { success: false; error: string }> {
    // Checked first: with the indexer disabled there are no commands, and
    // that is not an error worth reporting on every startup.
    if (!this.server_instance.getState().config?.indexer?.enabled) {
      return { success: false, error: 'Indexer is disabled in config' }
    }

    const commandLine = this.commands?.[command]

    if (command !== 'index' || !commandLine) {
      const error = `Unknown indexer command: ${command}`
      this.emit('indexer.error', error)
      return { success: false, error }
    }

    this.state = 'indexing'
    this.emit('indexer.indexing', { requestId, data: 'Indexing started' })

    const proc = spawnShellCommand({
      command: commandLine,
      args: [],
      cwd: this.server_instance.getState().workspaceRoot,
      stdioOpts: ['ignore', 'pipe', 'pipe'],
      env: undefined,
    })

    if (!proc.stdout || !proc.stderr) {
      const error = 'Could not find indexer stdio streams'
      this.state = 'errored'
      this.emit('indexer.error', error)
      return { success: false, error }
    }

    const [_stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ])

    if (exitCode === 0) {
      this.state = 'ready'
      this.emit('indexer.ready', {
        requestId,
        data: `Indexing complete.`,
      })

      return { success: true }
    }

    const error = `An error occured during indexing: ${stderr}`
    this.state = 'errored'
    this.emit('indexer.error', error)
    return { success: false, error }
  }

  /** Retrieves the current operational state, which can be ready, indexing, errored, or undefined. */
  getState() {
    return this.state
  }

  /** Releases resources to prevent leaks and ensure efficient cleanup. */
  dispose() {
    this.commands = undefined
    this.state = undefined
    this.removeAllListeners()
  }
}
