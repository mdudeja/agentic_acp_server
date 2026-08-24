import type { IndexerEvents } from 'src/data/events'
import { BaseManager } from './BaseManager'
import type { AgenticServer } from 'src/AgenticServer'
import { logInfo } from 'src/utils/logger'
import { spawnShellCommand } from 'src/utils/shell'

export class IndexerManager extends BaseManager<IndexerEvents> {
  private commands?: Record<string, string>
  private state?: 'ready' | 'indexing' | 'errored'

  constructor(private readonly server_instance: AgenticServer) {
    super()
  }

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

  async runCommand(command: string, requestId?: string) {
    if (!this.commands || !this.commands[command]) {
      this.emit('indexer.error', 'Invalid command or no commands available')
      return
    }

    if (!this.server_instance.getState().config?.indexer?.enabled) {
      return
    }

    if (command === 'index') {
      this.state = 'indexing'
      this.emit('indexer.indexing', { requestId, data: 'Indexing started' })

      const proc = spawnShellCommand({
        command: `${this.commands[command]}`,
        args: [],
        cwd: this.server_instance.getState().workspaceRoot,
        stdioOpts: ['ignore', 'pipe', 'pipe'],
        env: undefined,
      })

      if (!proc.stdout || !proc.stderr) {
        this.emit('indexer.error', 'Could not find indexer stdio streams')
        return
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

        return
      }

      this.state = 'errored'
      this.emit('indexer.error', `An error occured during indexing: ${stderr}`)
    }
  }

  getState() {
    return this.state
  }

  dispose() {
    this.commands = undefined
    this.state = undefined
    this.removeAllListeners()
  }
}
