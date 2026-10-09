import type { BuiltinHooksConfig } from 'src/config/schemas'
import { shellEscape } from 'src/utils/shell'
import { defineHook } from '../public'

/**
 * Before each user turn, records the working tree as a git stash entry
 * without touching the tree itself (`git stash create` + `git stash store`).
 * Undo a turn with `git stash apply stash@{n}`. Untracked files are not
 * included, and a clean tree records nothing.
 */
export function turnCheckpoint(_options: BuiltinHooksConfig['turnCheckpoint']) {
  return [
    defineHook({
      name: 'turnCheckpoint',
      event: 'prompt.before',
      description: 'Saves a git stash snapshot before each user turn',
      match: { origin: 'user' },
      // Late, so a prompt another hook blocks gets no checkpoint.
      priority: 900,
      onError: 'ignore',
      async handler(input, ctx) {
        const created = await ctx.exec('git stash create')
        const sha = created.stdout.trim()
        if (created.exitCode !== 0 || !sha) {
          return
        }

        const message = `agentic checkpoint before turn (session ${input.sessionId}) ${new Date().toISOString()}`
        const stored = await ctx.exec(
          `git stash store -m ${shellEscape(message)} ${shellEscape(sha)}`,
        )
        if (stored.exitCode === 0) {
          ctx.log.info(`Saved checkpoint ${sha.slice(0, 8)}`)
        } else {
          ctx.log.warn(`Could not store checkpoint: ${stored.stderr.trim()}`)
        }
      },
    }),
  ]
}
