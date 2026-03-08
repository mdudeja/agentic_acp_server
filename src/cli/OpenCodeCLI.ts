import { replacePlaceholdersInCommands } from 'src/utils/shell'
import { BaseCLI } from './BaseCLI'
import type { CLIProvider, CLIResult, StatsOptions } from './types'
import { PROVIDER_CLI, Providers } from 'src/data/providers'

export class OpenCodeCLI extends BaseCLI implements CLIProvider {
  private readonly name = Providers.opencode

  constructor(cwd?: string) {
    super('opencode', cwd)
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
