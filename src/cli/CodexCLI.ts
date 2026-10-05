import { Providers } from 'src/data/providers'
import { BaseCLI } from './BaseCLI'

export class CodexCLI extends BaseCLI {
  override readonly name = Providers.codex

  constructor(cwd?: string) {
    super('codex-acp', cwd)
  }
}
