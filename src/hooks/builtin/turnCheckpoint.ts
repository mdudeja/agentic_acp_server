import type { BuiltinHooksConfig } from 'src/config/schemas'
import { shellEscape } from 'src/utils/shell'
import { defineHook } from '../public'
import type { HookContext } from '../types'

/** Where checkpoints are recorded (one reflog entry each). */
export const CHECKPOINT_REF = 'refs/agentic/checkpoints'

/**
 * Before each user turn, records the working tree as a stash-like commit
 * (`git stash create`) without touching the tree, the index or your stash
 * list. Each checkpoint is an entry in the reflog of `CHECKPOINT_REF`, and
 * only the newest `keep` are kept.
 *
 * - List: `git reflog refs/agentic/checkpoints`
 * - Restore: `git stash apply <sha>` (or `refs/agentic/checkpoints@{n}`)
 *
 * Untracked files are not included, and a clean tree records nothing.
 * `git gc` may also expire entries per `gc.reflogExpireUnreachable`.
 */
export function turnCheckpoint(options: BuiltinHooksConfig['turnCheckpoint']) {
  return [
    defineHook({
      name: 'turnCheckpoint',
      event: 'prompt.before',
      description: `Saves a git snapshot before each user turn (${CHECKPOINT_REF})`,
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
          `git update-ref --create-reflog -m ${shellEscape(message)} ${CHECKPOINT_REF} ${shellEscape(sha)}`,
        )
        if (stored.exitCode !== 0) {
          ctx.log.warn(`Could not store checkpoint: ${stored.stderr.trim()}`)
          return
        }
        ctx.log.info(
          `Saved checkpoint ${sha.slice(0, 8)} (restore: git stash apply ${sha.slice(0, 8)})`,
        )

        await prune(ctx, options.keep)
      },
    }),
  ]
}

/** Deletes reflog entries beyond the newest `keep` (oldest first). */
async function prune(ctx: HookContext, keep: number) {
  const listed = await ctx.exec(`git reflog show --format=%H ${CHECKPOINT_REF}`)
  if (listed.exitCode !== 0) {
    return
  }

  const count = listed.stdout.split('\n').filter(Boolean).length
  // Highest index first, so the remaining indexes don't shift.
  for (let index = count - 1; index >= Math.max(keep, 1); index -= 1) {
    const deleted = await ctx.exec(
      `git reflog delete ${shellEscape(`${CHECKPOINT_REF}@{${index}}`)}`,
    )
    if (deleted.exitCode !== 0) {
      ctx.log.warn(
        `Could not prune checkpoint ${index}: ${deleted.stderr.trim()}`,
      )
      return
    }
  }
}
