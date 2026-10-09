import type { BuiltinHooksConfig } from 'src/config/schemas'
import { createProviderCLI } from 'src/cli/factory'
import type { Providers } from 'src/data/providers'
import { defineHook } from '../public'

/**
 * On the first connect of a (provider, cwd) agent, runs the provider CLI's
 * project init command (e.g. `opencode run --command /init`) in the
 * background.
 */
export function projectInit(options: BuiltinHooksConfig['projectInit']) {
  return [
    defineHook({
      name: 'projectInit',
      event: 'agent.connected',
      description: "Runs the provider CLI's init command on the first connect",
      onError: 'ignore',
      // Project init can run a full agent turn.
      timeoutMs: 10 * 60_000,
      async handler(input, ctx) {
        if (!input.firstConnect || !options.runProviderInit) {
          return
        }

        const cli = createProviderCLI(input.provider as Providers, input.cwd)
        if (!cli) {
          return
        }

        ctx.log.info(`Running ${input.provider} project init`)
        const result = await cli.init()
        if (!result.success) {
          ctx.notify(
            `Project init for ${input.provider} failed: ${result.stderr.trim()}`,
            'warn',
          )
        }
      },
    }),
  ]
}
