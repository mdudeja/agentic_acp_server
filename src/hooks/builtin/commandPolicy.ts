import type { BuiltinHooksConfig } from 'src/config/schemas'
import { logWarning } from 'src/utils/logger'
import { commandLine } from '../match'
import { defineHook } from '../public'

/** Compiles an array of string patterns into RegExp objects. */
function compile(patterns: string[]): RegExp[] {
  return patterns.flatMap((pattern) => {
    try {
      return [new RegExp(pattern)]
    } catch (error) {
      logWarning(
        `[hooks] commandPolicy: ignoring invalid regex ${pattern}: ${error}`,
      )
      return []
    }
  })
}

/** The command a permission request is for, if the tool exposes one. */
function permissionCommand(rawInput: unknown): string | null {
  const command = (rawInput as { command?: unknown } | null)?.command
  if (typeof command === 'string') return command
  if (Array.isArray(command)) return command.join(' ')
  return null
}

/**
 * Allows or denies commands by regex: terminal commands the agent runs
 * through the client, and permission requests for tools that carry a
 * `command`. `deny` wins over `allow`; anything unmatched is left alone.
 */
export function commandPolicy(options: BuiltinHooksConfig['commandPolicy']) {
  const allow = compile(options.allow)
  const deny = compile(options.deny)

  /** Evaluates a line of text and returns a decision based on the evaluation. */
  const decide = (line: string | null) => {
    if (!line) return
    const denied = deny.find((re) => re.test(line))
    if (denied) {
      return {
        decision: 'deny' as const,
        reason: `\`${line}\` matches deny rule ${denied} (hooks.builtin.commandPolicy)`,
      }
    }
    const allowed = allow.find((re) => re.test(line))
    if (allowed) {
      return {
        decision: 'allow' as const,
        reason: `\`${line}\` matches allow rule ${allowed}`,
      }
    }
  }

  return [
    defineHook({
      name: 'commandPolicy:terminal',
      event: 'terminal.beforeCreate',
      description: 'Allows/denies terminal commands by regex',
      priority: 10,
      handler: (input) => decide(commandLine(input)),
    }),
    defineHook({
      name: 'commandPolicy:permission',
      event: 'permission.request',
      description: 'Answers permission requests for commands by regex',
      priority: 10,
      handler: (input) => decide(permissionCommand(input.toolCall.rawInput)),
    }),
  ]
}
