import type { BuiltinHooksConfig } from 'src/config/schemas'
import { shellEscape } from 'src/utils/shell'
import { matchesGlob } from '../match'
import { defineHook } from '../public'

/**
 * Runs a formatter after the agent writes a file. `commands` maps a glob to
 * a shell command in which `{file}` is replaced by the quoted path.
 */
export function formatOnWrite(options: BuiltinHooksConfig['formatOnWrite']) {
  return [
    defineHook({
      name: 'formatOnWrite',
      event: 'fs.afterWrite',
      description: 'Formats files after the agent writes them',
      timeoutMs: 30_000,
      async handler(input, ctx) {
        for (const [glob, command] of Object.entries(options.commands)) {
          if (!matchesGlob(input.path, glob, ctx.workspaceRoot)) {
            continue
          }

          const result = await ctx.exec(
            command.replaceAll('{file}', shellEscape(input.path)),
          )
          if (result.exitCode !== 0) {
            ctx.log.warn(
              `\`${command}\` failed for ${input.path}: ${result.stderr.trim()}`,
            )
          }
        }
      },
    }),
  ]
}
