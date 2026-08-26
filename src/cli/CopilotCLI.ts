// Placeholder: Copilot CLI commands are not yet verified.
// Replace each method body once the correct CLI sub-commands are confirmed.
import { BaseCLI } from './BaseCLI'
import type { CLIProvider, CLIResult, StatsOptions } from './types'

const NOT_IMPLEMENTED: CLIResult = {
  success: false,
  stdout: '',
  stderr: 'Not implemented',
  exitCode: 1,
}

export class CopilotCLI extends BaseCLI implements CLIProvider {
  constructor(cwd?: string) {
    super('copilot', cwd)
  }

  deleteSession(_sessionId: string): Promise<CLIResult> {
    return Promise.resolve(NOT_IMPLEMENTED)
  }

  exportSession(_sessionId: string, _outputPath: string): Promise<CLIResult> {
    return Promise.resolve(NOT_IMPLEMENTED)
  }

  importSession(_filePath: string): Promise<CLIResult> {
    return Promise.resolve(NOT_IMPLEMENTED)
  }

  listSessions(_format?: string): Promise<CLIResult> {
    return Promise.resolve(NOT_IMPLEMENTED)
  }

  stats(_options?: StatsOptions): Promise<CLIResult> {
    return Promise.resolve(NOT_IMPLEMENTED)
  }

  init(): Promise<CLIResult> {
    return Promise.resolve(NOT_IMPLEMENTED)
  }
}
