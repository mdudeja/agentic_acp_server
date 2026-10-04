import { Providers } from 'src/data/providers'
import { BaseCLI } from './BaseCLI'
import type { CLIResult, StatsOptions } from './types'

export class EchoProviderCLI extends BaseCLI {
  override readonly name = Providers.echo

  constructor(cwd?: string) {
    super('echo', cwd)
  }

  override deleteSession(sessionId: string): Promise<CLIResult> {
    return Promise.resolve({
      success: true,
      stdout: `Deleted session ${sessionId}`,
      stderr: '',
      exitCode: 0,
    })
  }

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

  override importSession(filePath: string): Promise<CLIResult> {
    return Promise.resolve({
      success: true,
      stdout: `Imported session from ${filePath}`,
      stderr: '',
      exitCode: 0,
    })
  }

  override listSessions(_format?: string): Promise<CLIResult> {
    return Promise.resolve({
      success: true,
      stdout: `No sessions`,
      stderr: '',
      exitCode: 0,
      data: { sessions: [] },
    })
  }

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

  override init(): Promise<CLIResult> {
    return Promise.resolve({
      success: true,
      stdout: `Initialized`,
      stderr: '',
      exitCode: 0,
    })
  }
}
