import { Providers } from 'src/data/providers'
import { BaseCLI } from './BaseCLI'
import type { CLIResult, StatsOptions } from './types'

/** Handles command-line interactions for an echo service, providing input echoing functionality. */
export class EchoProviderCLI extends BaseCLI {
  override readonly name = Providers.echo

  /** Initializes the EchoProviderCLI with the specified or default current working directory. */
  constructor(cwd?: string) {
    super('echo', cwd)
  }

  /** Deletes a session based on the provided session ID. */
  override deleteSession(sessionId: string): Promise<CLIResult> {
    return Promise.resolve({
      success: true,
      stdout: `Deleted session ${sessionId}`,
      stderr: '',
      exitCode: 0,
    })
  }

  /** Exports the specified session to a file at the given output path. */
  override exportSession(
    sessionId: string,
    outputPath: string,
  ): Promise<CLIResult> {
    return Promise.resolve({
      success: true,
      stdout: `Exported session ${sessionId} to ${outputPath}`,
      stderr: '',
      exitCode: 0,
    })
  }

  /** Imports a session from the specified file. */
  override importSession(filePath: string): Promise<CLIResult> {
    return Promise.resolve({
      success: true,
      stdout: `Imported session from ${filePath}`,
      stderr: '',
      exitCode: 0,
    })
  }

  /** Lists available sessions in the current environment. Optionally accepts a format parameter to specify the output format. */
  override listSessions(_format?: string): Promise<CLIResult> {
    return Promise.resolve({
      success: true,
      stdout: `No sessions`,
      stderr: '',
      exitCode: 0,
      data: { sessions: [] },
    })
  }

  /** Fetches and displays statistical data. */
  override stats(_options?: StatsOptions): Promise<CLIResult> {
    return Promise.resolve({
      success: true,
      stdout: `Stats not available`,
      stderr: '',
      exitCode: 0,
      data: {
        totalSessions: 0,
        activeSessions: 0,
        completedSessions: 0,
      },
    })
  }

  /** Initializes the CLI application. */
  override init(): Promise<CLIResult> {
    return Promise.resolve({
      success: true,
      stdout: `Initialized`,
      stderr: '',
      exitCode: 0,
    })
  }
}
