import { logDebug, logWarning } from 'src/utils/logger'
import type { CLIResult } from './types'
import { spawnShellCommand } from 'src/utils/shell'

/**
 * Base class for provider CLI wrappers.
 * Provides a single `exec()` helper that spawns the CLI binary,
 * captures stdout/stderr, and attempts JSON parsing of the output.
 */
export abstract class BaseCLI {
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
}
