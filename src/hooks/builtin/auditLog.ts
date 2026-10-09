import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { BuiltinHooksConfig } from 'src/config/schemas'
import type { HookContext } from '../types'
import { defineHook } from '../public'

/**
 * Appends agent activity (permission requests, tool calls, terminal
 * commands, file writes, finished turns) to a JSONL file. Runs first on
 * guarded events so it also records requests other hooks then refuse.
 */
export function auditLog(options: BuiltinHooksConfig['auditLog']) {
  const write = async (ctx: HookContext, record: Record<string, unknown>) => {
    const file = resolve(ctx.workspaceRoot, options.path)
    await mkdir(dirname(file), { recursive: true })
    await appendFile(
      file,
      JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n',
    )
  }

  const shared = { priority: 0, onError: 'ignore' as const }

  return [
    defineHook({
      ...shared,
      name: 'auditLog:permission',
      event: 'permission.request',
      description: 'Logs permission requests',
      async handler(input, ctx) {
        await write(ctx, {
          event: 'permission.request',
          sessionId: input.sessionId,
          title: input.toolCall.title,
          kind: input.toolCall.kind,
          rawInput: input.toolCall.rawInput,
        })
      },
    }),
    defineHook({
      ...shared,
      name: 'auditLog:toolCall',
      event: 'session.update',
      description: 'Logs tool calls and their status changes',
      match: { updateType: ['tool_call', 'tool_call_update'] },
      async handler(input, ctx) {
        const update = input.update as Record<string, unknown>
        await write(ctx, {
          event: input.updateType,
          sessionId: input.sessionId,
          toolCallId: update.toolCallId,
          title: update.title,
          kind: update.kind,
          status: update.status,
        })
      },
    }),
    defineHook({
      ...shared,
      name: 'auditLog:terminal',
      event: 'terminal.beforeCreate',
      description: 'Logs terminal commands',
      async handler(input, ctx) {
        await write(ctx, {
          event: 'terminal.create',
          sessionId: input.sessionId,
          command: [input.command, ...input.args].join(' '),
          cwd: input.cwd,
        })
      },
    }),
    defineHook({
      ...shared,
      name: 'auditLog:write',
      event: 'fs.afterWrite',
      description: 'Logs file writes',
      async handler(input, ctx) {
        await write(ctx, {
          event: 'fs.write',
          sessionId: input.sessionId,
          path: input.path,
        })
      },
    }),
    defineHook({
      ...shared,
      name: 'auditLog:prompt',
      event: 'prompt.after',
      description: 'Logs finished turns',
      async handler(input, ctx) {
        await write(ctx, {
          event: 'prompt.after',
          sessionId: input.sessionId,
          origin: input.origin,
          stopReason: input.stopReason,
          durationMs: input.durationMs,
          error: input.error,
        })
      },
    }),
  ]
}
