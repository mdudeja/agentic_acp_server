import { Providers } from 'src/data/providers'
import { BaseCLI } from './BaseCLI'

export class OpenCodeCLI extends BaseCLI {
  override readonly name = Providers.opencode

  constructor(cwd?: string) {
    super('opencode', cwd)
  }
}
