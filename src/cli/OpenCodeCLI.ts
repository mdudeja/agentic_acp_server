import { Providers } from 'src/data/providers'
import { BaseCLI } from './BaseCLI'

/** A command-line interface for interacting with OpenCode functionality. */
export class OpenCodeCLI extends BaseCLI {
  override readonly name = Providers.opencode

  /** Initializes a new instance of the OpenCode CLI with the specified or default working directory. */
  constructor(cwd?: string) {
    super('opencode', cwd)
  }
}
