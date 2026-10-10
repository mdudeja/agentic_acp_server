import { resolve } from 'node:path'
import type { BuiltinHooksConfig } from 'src/config/schemas'
import { defineHook } from '../public'

/**
 * Prepends project context to user prompts: the configured files (e.g.
 * `AGENTS.md`) and the git branch/status. With `firstPromptOnly`, each
 * session gets it once (remembered across restarts).
 */
export function contextInjection(
  options: BuiltinHooksConfig['contextInjection'],
) {
  return [
    defineHook({
      name: 'contextInjection',
      event: 'prompt.before',
      description: 'Adds project files and git status to user prompts',
      match: { origin: 'user' },
      priority: 40,
      onError: 'ignore',
      /** Processes a session request, handling either user or internal origin prompts and managing the associated session. */
      async handler(input, ctx) {
        if (
          options.firstPromptOnly &&
          (await ctx.store.get(`injected:${input.sessionId}`))
        ) {
          return
        }

        const parts: string[] = []

        for (const file of options.files) {
          const handle = Bun.file(resolve(ctx.workspaceRoot, file))
          if (await handle.exists()) {
            parts.push(`## ${file}\n\n${(await handle.text()).trim()}`)
          }
        }

        if (options.gitStatus) {
          const branch = await ctx.exec('git rev-parse --abbrev-ref HEAD')
          const status = await ctx.exec('git status --short')
          if (branch.exitCode === 0 && status.exitCode === 0) {
            parts.push(
              `## Git\n\nBranch: ${branch.stdout.trim()}\n\n` +
                (status.stdout.trim() || '(working tree clean)'),
            )
          }
        }

        if (parts.length === 0) {
          return
        }

        if (options.firstPromptOnly) {
          await ctx.store.set(`injected:${input.sessionId}`, true)
        }

        return {
          prompt: [
            {
              type: 'text',
              text: `[Project context]\n\n${parts.join('\n\n')}`,
            },
            ...input.prompt,
          ],
        }
      },
    }),
  ]
}
