import type { BuiltinHooksConfig } from 'src/config/schemas'
import { matchesGlob } from '../match'
import { defineHook } from '../public'

/** Refuses agent reads/writes (through the client) of files matching globs. */
export function protectedPaths(options: BuiltinHooksConfig['protectedPaths']) {
  const reason = (path: string, verb: string) =>
    `${path} is protected from agent ${verb}s (hooks.builtin.protectedPaths)`

  return [
    defineHook({
      name: 'protectedPaths:read',
      event: 'fs.beforeRead',
      description: 'Refuses reads of protected files',
      priority: 10,
      handler(input, ctx) {
        if (matchesGlob(input.path, options.read, ctx.workspaceRoot)) {
          return { decision: 'deny', reason: reason(input.path, 'read') }
        }
      },
    }),
    defineHook({
      name: 'protectedPaths:write',
      event: 'fs.beforeWrite',
      description: 'Refuses writes to protected files',
      priority: 10,
      handler(input, ctx) {
        if (matchesGlob(input.path, options.write, ctx.workspaceRoot)) {
          return { decision: 'deny', reason: reason(input.path, 'write') }
        }
      },
    }),
  ]
}
