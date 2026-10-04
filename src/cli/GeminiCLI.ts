import { Providers } from 'src/data/providers'
import { BaseCLI } from './BaseCLI'

export class GeminiCLI extends BaseCLI {
  override readonly name = Providers.gemini

  constructor(cwd?: string) {
    super('gemini', cwd)
  }
}
