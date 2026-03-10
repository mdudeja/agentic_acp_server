import { BaseCLI } from './BaseCLI'
import type { CLIProvider, CLIResult, StatsOptions } from './types'

export class EchoProviderCLI extends BaseCLI implements CLIProvider {
  deleteSession(sessionId: string): Promise<CLIResult> {
    return Promise.resolve({
      success: true,
      stdout: `Deleted session ${sessionId}`,
      stderr: '',
      exitCode: 0,
    })
  }
  exportSession(sessionId: string, outputPath: string): Promise<CLIResult> {
    return Promise.resolve({
      success: true,
      stdout: `Exported session ${sessionId} to ${outputPath}`,
      stderr: '',
      exitCode: 0,
    })
  }
  importSession(filePath: string): Promise<CLIResult> {
    return Promise.resolve({
      success: true,
      stdout: `Imported session from ${filePath}`,
      stderr: '',
      exitCode: 0,
    })
  }
  stats(_options?: StatsOptions): Promise<CLIResult> {
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
  init(): Promise<CLIResult> {
    return Promise.resolve({
      success: true,
      stdout: `Initialized`,
      stderr: '',
      exitCode: 0,
    })
  }
}
