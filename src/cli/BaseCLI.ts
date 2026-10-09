import { logDebug, logWarning } from 'src/utils/logger'
import type { CLIProvider, CLIResult, StatsOptions } from './types'
import { spawnShellCommand } from 'src/utils/shell'
import {
  PROVIDER_CLI,
  Providers,
  type ProviderCLICommands,
} from 'src/data/providers'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
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

  /**
   * The provider's command template for `op`, or `null` when it has none.
   * An empty template means "not supported": running it would invoke the
   * bare provider binary (often an interactive session).
   */
  private _template(op: keyof ProviderCLICommands): string[] | null {
    const template = PROVIDER_CLI[this.name].commands[op]
    return template && template.length > 0 ? template : null
  }

  private _unsupported(op: keyof ProviderCLICommands): Promise<CLIResult> {
    return Promise.resolve({
      success: false,
      stdout: '',
      stderr: `${op} is not supported by the ${this.name} CLI`,
      exitCode: 1,
    })
  }

  deleteSession(sessionId: string): Promise<CLIResult> {
    const template = this._template('deleteSession')
    if (!template) {
      return this._unsupported('deleteSession')
    }
    return this.exec(replacePlaceholdersInCommands(template, [sessionId]))
  }

  /**
   * Runs the export command and writes its stdout to `outputPath`. Writing
   * here (rather than via shell redirection in the template) keeps every
   * template argument safely escaped.
   */
  async exportSession(
    sessionId: string,
    outputPath: string,
  ): Promise<CLIResult> {
    const template = this._template('exportSession')
    if (!template) {
      return this._unsupported('exportSession')
    }

    const result = await this.exec(
      replacePlaceholdersInCommands(template, [sessionId, outputPath]),
    )

    if (!result.success) {
      return result
    }

    const target = resolve(this.cwd ?? process.cwd(), outputPath)
    try {
      await mkdir(dirname(target), { recursive: true })
      await Bun.write(target, result.stdout)
    } catch (error) {
      return {
        ...result,
        success: false,
        stderr: `Failed to write export to ${target}: ${error}`,
      }
    }

    return result
  }

  importSession(filePath: string): Promise<CLIResult> {
    const template = this._template('importSession')
    if (!template) {
      return this._unsupported('importSession')
    }
    return this.exec(replacePlaceholdersInCommands(template, [filePath]))
  }

  listSessions(format = 'json'): Promise<CLIResult> {
    const template = this._template('listSessions')
    if (!template) {
      return this._unsupported('listSessions')
    }
    return this.exec(replacePlaceholdersInCommands(template, [format]))
  }

  stats(options: StatsOptions = {}): Promise<CLIResult> {
    const template = this._template('stats')
    if (!template) {
      return this._unsupported('stats')
    }

    const days = options.days ?? 7
    return this.exec(replacePlaceholdersInCommands(template, [String(days)]))
  }

  init(): Promise<CLIResult> {
    const template = this._template('init')
    if (!template) {
      return this._unsupported('init')
    }
    return this.exec(template)
  }
}
