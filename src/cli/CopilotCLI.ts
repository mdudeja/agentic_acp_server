import { Providers } from 'src/data/providers'
import { BaseCLI } from './BaseCLI'

export class CopilotCLI extends BaseCLI {
  override readonly name = Providers.copilot

  constructor(cwd?: string) {
    super('copilot', cwd)
  }
}
