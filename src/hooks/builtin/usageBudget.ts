import type { BuiltinHooksConfig } from 'src/config/schemas'
import { defineHook } from '../public'

/**
 * Stops sessions that exceed a usage budget: cancels the running turn when
 * a `usage_update` goes over the limit, and refuses further prompts in that
 * session (until the server restarts).
 */
export function usageBudget(options: BuiltinHooksConfig['usageBudget']) {
  const overBudget = new Map<string, string>()

  const exceeded = (update: {
    used?: number
    cost?: { amount?: number } | null
  }) => {
    if (options.maxTokens != null && (update.used ?? 0) > options.maxTokens) {
      return `${update.used} tokens used (limit ${options.maxTokens})`
    }
    const cost = update.cost?.amount
    if (options.maxCost != null && cost != null && cost > options.maxCost) {
      return `cost ${cost} (limit ${options.maxCost})`
    }
    return null
  }

  return [
    defineHook({
      name: 'usageBudget:watch',
      event: 'session.update',
      description: 'Cancels the turn when usage goes over budget',
      match: { updateType: 'usage_update' },
      async handler(input, ctx) {
        if (!input.sessionId || overBudget.has(input.sessionId)) {
          return
        }

        const reason = exceeded(input.update)
        if (!reason) {
          return
        }

        overBudget.set(input.sessionId, reason)
        ctx.notify(
          `Usage budget exceeded: ${reason}. Cancelling the turn.`,
          'error',
        )
        await ctx.cancelTurn(input.sessionId)
      },
    }),
    defineHook({
      name: 'usageBudget:prompt',
      event: 'prompt.before',
      description: 'Refuses prompts in sessions over budget',
      match: { origin: 'user' },
      priority: 10,
      handler(input) {
        const reason = overBudget.get(input.sessionId)
        if (reason) {
          return {
            decision: 'deny',
            reason: `This session is over its usage budget: ${reason}`,
          }
        }
      },
    }),
  ]
}
