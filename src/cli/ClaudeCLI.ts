import { Providers } from 'src/data/providers'
import { BaseCLI } from './BaseCLI'

export class ClaudeCLI extends BaseCLI {
  override readonly name = Providers.claude

  constructor(cwd?: string) {
    super('claude-agent-acp', cwd)
  }
}
