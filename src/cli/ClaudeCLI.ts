import { Providers } from 'src/data/providers'
import { BaseCLI } from './BaseCLI'

/** A command-line interface (CLI) implementation for Claude, designed to interact with Claude programmatically. */
export class ClaudeCLI extends BaseCLI {
  override readonly name = Providers.claude

  /** Initializes the Claude command-line interface. The constructor can optionally be provided with a specific directory to work in. */
  constructor(cwd?: string) {
    super('claude-agent-acp', cwd)
  }
}
