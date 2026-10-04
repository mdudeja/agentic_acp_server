import { logDebug, logWarning } from 'src/utils/logger'
import type { CLIProvider, CLIResult, StatsOptions } from './types'
import { spawnShellCommand } from 'src/utils/shell'
import { PROVIDER_CLI, Providers } from 'src/data/providers'
import { replacePlaceholdersInCommands } from 'src/utils/shell'

/**
 * Base class for provider CLI wrappers.
 * Provides a single `exec()` helper that spawns the CLI binary,
 * captures stdout/stderr, and attempts JSON parsing of the output.
 */
export abstract class BaseCLI implements CLIProvider {
  protected readonly name: Providers = Providers.echo

  constructor(
    protected readonly command: string,
    protected readonly cwd?: string,
  ) {}

  protected async exec(args: string[]): Promise<CLIResult> {
    logDebug(`[CLI] ${this.command} ${args.join(' ')}`)

    const subproc = spawnShellCommand({
      command: this.command,
      args,
      cwd: this.cwd,
      env: process.env,
      stdioOpts: ['ignore', 'pipe', 'pipe'],
    })

    if (!subproc.stdout || !subproc.stderr) {
      logWarning(
        `[CLI] Failed to execute ${this.command}: stdout or stderr is not available`,
      )
      return {
        success: false,
        stdout: '',
        stderr: 'Failed to execute command',
        exitCode: -1,
      }
    }

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(subproc.stdout as ReadableStream).text(),
      new Response(subproc.stderr as ReadableStream).text(),
      subproc.exited,
    ])

    const success = exitCode === 0

    if (!success) {
      logWarning(
        `[CLI] ${this.command} ${args[0] ?? ''} exited with code ${exitCode}: ${stderr.trim()}`,
      )
    }

    let data: unknown
    if (success && stdout.trim()) {
      try {
        data = JSON.parse(stdout) as unknown
      } catch {
        // stdout is plain text; leave data undefined
      }
    }

    return { success, stdout, stderr, exitCode, data }
  }

  deleteSession(sessionId: string): Promise<CLIResult> {
    const baseCommand = PROVIDER_CLI[this.name].commands.deleteSession
    if (!baseCommand) {
      return Promise.resolve({
        success: false,
        stdout: '',
        stderr: 'Delete session command not defined for OpenCode CLI',
        exitCode: 1,
      })
    }
    return this.exec(replacePlaceholdersInCommands(baseCommand, [sessionId]))
  }

  exportSession(sessionId: string, outputPath: string): Promise<CLIResult> {
    const baseCommand = PROVIDER_CLI[this.name].commands.exportSession
    if (!baseCommand) {
      return Promise.resolve({
        success: false,
        stdout: '',
        stderr: 'Export session command not defined for OpenCode CLI',
        exitCode: 1,
      })
    }
    return this.exec(
      replacePlaceholdersInCommands(baseCommand, [sessionId, outputPath]),
    )
  }

  importSession(filePath: string): Promise<CLIResult> {
    const baseCommand = PROVIDER_CLI[this.name].commands.importSession
    if (!baseCommand) {
      return Promise.resolve({
        success: false,
        stdout: '',
        stderr: 'Import session command not defined for OpenCode CLI',
        exitCode: 1,
      })
    }
    return this.exec(replacePlaceholdersInCommands(baseCommand, [filePath]))
  }

  listSessions(format = 'json'): Promise<CLIResult> {
    const baseCommand = PROVIDER_CLI[this.name].commands.listSessions
    if (!baseCommand) {
      return Promise.resolve({
        success: false,
        stdout: '',
        stderr: 'List sessions command not defined for OpenCode CLI',
        exitCode: 1,
      })
    }
    return this.exec(replacePlaceholdersInCommands(baseCommand, [format]))
  }

  stats(options: StatsOptions = {}): Promise<CLIResult> {
    const baseCommand = PROVIDER_CLI[this.name].commands.stats
    if (!baseCommand) {
      return Promise.resolve({
        success: false,
        stdout: '',
        stderr: 'Stats command not defined for OpenCode CLI',
        exitCode: 1,
      })
    }

    const days = options.days ?? 7
    return this.exec(replacePlaceholdersInCommands(baseCommand, [String(days)]))
  }

  init(): Promise<CLIResult> {
    const baseCommand = PROVIDER_CLI[this.name].commands.init
    if (!baseCommand) {
      return Promise.resolve({
        success: false,
        stdout: '',
        stderr: 'Init command not defined for OpenCode CLI',
        exitCode: 1,
      })
    }
    return this.exec(baseCommand)
  }
}
