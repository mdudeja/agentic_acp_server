import type { BuiltinHooksConfig } from 'src/config/schemas'
import { defineHook } from '../public'

/** Tells the user when a long user turn finishes (and optionally runs a command). */
export function notifyOnTurnEnd(
  options: BuiltinHooksConfig['notifyOnTurnEnd'],
) {
  return [
    defineHook({
      name: 'notifyOnTurnEnd',
      event: 'prompt.after',
      description: 'Announces long turns when they finish',
      match: { origin: 'user' },
      /** Processes session-related events, handling termination, errors, and usage tracking. */
      async handler(input, ctx) {
        if (input.durationMs < options.minDurationMs) {
          return
        }

        const seconds = Math.round(input.durationMs / 1000)
        ctx.notify(
          input.error
            ? `Turn failed after ${seconds}s: ${input.error}`
            : `Turn finished (${input.stopReason ?? 'done'}) after ${seconds}s`,
          input.error ? 'warn' : 'info',
        )

        if (options.command) {
          await ctx.exec(options.command)
        }
      },
    }),
  ]
}
