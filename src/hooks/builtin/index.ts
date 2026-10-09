import type { BuiltinHooksConfig } from 'src/config/schemas'
import type { AnyHookDefinition } from '../types'
import { auditLog } from './auditLog'
import { commandPolicy } from './commandPolicy'
import { contextInjection } from './contextInjection'
import { formatOnWrite } from './formatOnWrite'
import { notifyOnTurnEnd } from './notifyOnTurnEnd'
import { projectInit } from './projectInit'
import { protectedPaths } from './protectedPaths'
import { secretRedaction } from './secretRedaction'
import { turnCheckpoint } from './turnCheckpoint'
import { usageBudget } from './usageBudget'

/**
 * The enabled built-in hooks, each with its config block (exposed to the
 * hook as `ctx.options`).
 */
export function builtinHooks(
  config: BuiltinHooksConfig,
): Array<{ def: AnyHookDefinition; options: Record<string, unknown> }> {
  const groups: Array<[{ enabled: boolean }, () => AnyHookDefinition[]]> = [
    [config.projectInit, () => projectInit(config.projectInit)],
    [config.protectedPaths, () => protectedPaths(config.protectedPaths)],
    [config.commandPolicy, () => commandPolicy(config.commandPolicy)],
    [config.formatOnWrite, () => formatOnWrite(config.formatOnWrite)],
    [config.auditLog, () => auditLog(config.auditLog)],
    [config.notifyOnTurnEnd, () => notifyOnTurnEnd(config.notifyOnTurnEnd)],
    [config.turnCheckpoint, () => turnCheckpoint(config.turnCheckpoint)],
    [config.contextInjection, () => contextInjection(config.contextInjection)],
    [config.usageBudget, () => usageBudget(config.usageBudget)],
    [config.secretRedaction, () => secretRedaction(config.secretRedaction)],
  ]

  return groups
    .filter(([options]) => options.enabled)
    .flatMap(([options, create]) =>
      create().map((def) => ({
        def,
        options: options as Record<string, unknown>,
      })),
    )
}
