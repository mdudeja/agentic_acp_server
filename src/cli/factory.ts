import { PROVIDER_CLI, Providers } from 'src/data/providers'
import { CopilotCLI } from './CopilotCLI'
import { GeminiCLI } from './GeminiCLI'
import { OpenCodeCLI } from './OpenCodeCLI'
import type { CLIProvider } from './types'

/**
 * Returns a CLIProvider instance for the given provider, or `null` if the
 * provider does not have CLI support enabled.
 */
export function createProviderCLI(
  provider: Providers,
  cwd: string,
): CLIProvider | null {
  if (!PROVIDER_CLI[provider]?.available) return null

  switch (provider) {
    case Providers.opencode:
      return new OpenCodeCLI(cwd)
    case Providers.copilot:
      return new CopilotCLI(cwd)
    case Providers.gemini:
      return new GeminiCLI(cwd)
    default:
      return null
  }
}
