import { Providers } from 'src/data/providers'
import { BaseCLI } from './BaseCLI'

/** A command-line interface for interacting with Gemini. Provides functionality to execute commands and manage configurations for Gemini operations. */
export class GeminiCLI extends BaseCLI {
  override readonly name = Providers.gemini

  /** Initializes the GeminiCLI with the current working directory, optionally specified. */
  constructor(cwd?: string) {
    super('gemini', cwd)
  }
}
