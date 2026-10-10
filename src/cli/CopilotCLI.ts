import { Providers } from 'src/data/providers'
import { BaseCLI } from './BaseCLI'

/** A command-line interface for interacting with Copilot, enabling the execution of commands and integration of Copilots features into CLI workflows. */
export class CopilotCLI extends BaseCLI {
  override readonly name = Providers.copilot

  /** Initializes a new instance of the CopilotCLI class, optionally setting the current working directory. */
  constructor(cwd?: string) {
    super('copilot', cwd)
  }
}
