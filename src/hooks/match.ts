import { isAbsolute, relative, resolve } from 'node:path'
import type { HookMatch } from './types'
import type { Providers } from 'src/data/providers'

const asList = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value]

/**
 * Whether `path` matches any of `patterns`. Each glob is tried on the
 * absolute path and, for paths inside `root`, on the workspace-relative
 * path, so both `**\/.env*` and `src/**\/*.ts` style patterns work.
 */
export function matchesGlob(
  path: string,
  patterns: string | string[],
  root: string,
): boolean {
  const absolute = resolve(root, path)
  const rel = relative(root, absolute)
  const candidates = [absolute]
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
    candidates.push(rel)
  }

  return asList(patterns).some((pattern) => {
    const glob = new Bun.Glob(pattern)
    return candidates.some((candidate) => glob.match(candidate))
  })
}

/** The full command line of a terminal/permission input, for matching. */
export function commandLine(input: Record<string, unknown>): string | null {
  if (typeof input.command === 'string') {
    const args = Array.isArray(input.args) ? (input.args as string[]) : []
    return [input.command, ...args].join(' ')
  }

  // Permission requests: tools usually carry the command in `rawInput`.
  const toolCall = input.toolCall as
    | { title?: string; rawInput?: unknown }
    | undefined
  if (toolCall) {
    const raw = toolCall.rawInput as Record<string, unknown> | undefined
    const rawCommand = raw?.command
    if (typeof rawCommand === 'string') return rawCommand
    if (Array.isArray(rawCommand)) return rawCommand.join(' ')
    return toolCall.title ?? null
  }

  return null
}

function toRegExp(pattern: string | RegExp): RegExp {
  return typeof pattern === 'string' ? new RegExp(pattern) : pattern
}

/**
 * Evaluates a hook's matcher against an event input. A criterion only
 * applies when the input carries the value it tests.
 */
export function matches(
  match: HookMatch | undefined,
  input: Record<string, unknown>,
  context: { provider: Providers | null; workspaceRoot: string },
): boolean {
  if (!match) return true

  if (match.provider !== undefined) {
    if (
      !context.provider ||
      !asList(match.provider).includes(context.provider)
    ) {
      return false
    }
  }

  if (match.path !== undefined && typeof input.path === 'string') {
    if (!matchesGlob(input.path, match.path, context.workspaceRoot)) {
      return false
    }
  }

  if (match.command !== undefined) {
    const line = commandLine(input)
    if (line !== null && !toRegExp(match.command).test(line)) {
      return false
    }
  }

  if (match.updateType !== undefined && typeof input.updateType === 'string') {
    if (!asList(match.updateType).includes(input.updateType)) {
      return false
    }
  }

  if (match.origin !== undefined && typeof input.origin === 'string') {
    if (match.origin !== input.origin) {
      return false
    }
  }

  return true
}
