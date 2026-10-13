import { CHECKPOINT_REF, prune, snapshot } from 'src/checkpoints/git'
import type { BuiltinHooksConfig } from 'src/config/schemas'
import { defineHook } from '../public'

export { CHECKPOINT_REF }

/**
 * Before each user turn, records the whole working tree (tracked files plus
 * untracked ones that aren't ignored) as a commit, without touching the
 * tree, the index or your stash list. Each checkpoint is an entry in the
 * reflog of `CHECKPOINT_REF`, and only the newest `keep` are kept.
 *
 * The editor lists, diffs and restores them through `client/list_checkpoints`,
 * `client/checkpoint_changes`, `client/checkpoint_file` and
 * `client/restore_checkpoint` (see `src/checkpoints/git.ts`).
 *
 * `git gc` may expire entries per `gc.reflogExpireUnreachable`.
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
      /** Snapshots the working tree, tagged with the session and the prompt, then prunes old checkpoints. */
      async handler(input, ctx) {
        // `client/ask` puts the user's text last, after attached contexts
        // (and after anything earlier hooks prepended).
        const prompt = input.prompt
          .map((block) => (block.type === 'text' ? block.text : ''))
          .findLast((text) => text.trim())

        try {
          const sha = await snapshot(ctx.workspaceRoot, {
            sessionId: input.sessionId,
            kind: 'turn',
            prompt,
          })
          ctx.log.info(`Saved checkpoint ${sha.slice(0, 8)}`)
          await prune(ctx.workspaceRoot, options.keep)
        } catch (error) {
          // Not a git repository, or git failed: the turn goes ahead anyway.
          ctx.log.warn(`Could not store checkpoint: ${String(error)}`)
        }
      },
    }),
  ]
}
