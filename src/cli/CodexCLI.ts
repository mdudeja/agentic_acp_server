import { Providers } from 'src/data/providers'
import { BaseCLI } from './BaseCLI'

/** A command-line interface for interacting with Codex AI, enabling users to perform various operations through CLI commands. */
export class CodexCLI extends BaseCLI {
  override readonly name = Providers.codex

  /** Initialize the Codex CLI with the specified working directory or the current directory if none is provided. */
  constructor(cwd?: string) {
    super('codex-acp', cwd)
  }
}
