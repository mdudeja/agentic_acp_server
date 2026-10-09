import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AGENTIC_DIR } from 'src/config/loader'
import { HOOK_EVENTS } from './events'
import { HOOKS_MODULE_ID, HOOKS_MODULE_SOURCE } from './public'
import type { AnyHookDefinition } from './types'

let hooksModuleRegistered = false

/**
 * Makes `import { defineHook } from 'agentic-acp-server/hooks'` resolve in
 * hook files without installing anything (a Bun virtual module).
 */
export function registerHooksModule() {
  if (hooksModuleRegistered) return

  Bun.plugin({
    name: 'agentic-hooks-module',
    setup(build) {
      build.module(HOOKS_MODULE_ID, () => ({
        contents: HOOKS_MODULE_SOURCE,
        loader: 'js',
      }))
    },
  })
  hooksModuleRegistered = true
}

/** `~/.config/agentic/hooks` (or `$XDG_CONFIG_HOME`; `ACP_HOOKS_GLOBAL_DIR` overrides). */
export function globalHooksDir(): string {
  if (process.env.ACP_HOOKS_GLOBAL_DIR) {
    return process.env.ACP_HOOKS_GLOBAL_DIR
  }
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(configHome, 'agentic', 'hooks')
}

export function projectHooksDir(workspaceRoot: string): string {
  return join(workspaceRoot, AGENTIC_DIR, 'hooks')
}

/** `*.ts` / `*.js` / `*.mjs`, excluding declarations and `_helpers`. */
function isHookFile(name: string): boolean {
  return (
    /\.(ts|js|mjs)$/.test(name) &&
    !name.endsWith('.d.ts') &&
    !name.startsWith('_') &&
    !name.startsWith('.')
  )
}

/**
 * Hook files at `target`: the matching files directly inside it when it is
 * a directory (sorted, not recursive), the file itself when it is a file,
 * nothing when it does not exist.
 */
export async function listHookFiles(target: string): Promise<string[]> {
  let info
  try {
    info = await stat(target)
  } catch {
    return []
  }

  if (info.isFile()) {
    return [target]
  }

  const entries = await readdir(target, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && isHookFile(entry.name))
    .map((entry) => join(target, entry.name))
    .sort()
}

/** Why `value` is not a usable hook definition, or `null` if it is. */
export function validateHookDefinition(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return 'not an object'
  }

  const hook = value as Record<string, unknown>

  if (typeof hook.name !== 'string' || !hook.name.trim()) {
    return '`name` must be a non-empty string'
  }
  if (typeof hook.event !== 'string' || !(hook.event in HOOK_EVENTS)) {
    return `unknown event ${JSON.stringify(hook.event)}`
  }
  if (typeof hook.handler !== 'function') {
    return '`handler` must be a function'
  }
  if (hook.priority !== undefined && typeof hook.priority !== 'number') {
    return '`priority` must be a number'
  }
  if (hook.timeoutMs !== undefined && typeof hook.timeoutMs !== 'number') {
    return '`timeoutMs` must be a number'
  }
  if (
    hook.onError !== undefined &&
    !['allow', 'deny', 'ignore'].includes(hook.onError as string)
  ) {
    return '`onError` must be allow, deny or ignore'
  }

  return null
}

/**
 * Imports a hook file and returns its hooks (the default export: one hook
 * or an array). The import is keyed by the file's mtime so a changed file
 * is re-evaluated on reload. Modules it imports are cached as usual.
 */
export async function importHookFile(
  file: string,
): Promise<{ hooks: AnyHookDefinition[]; errors: string[] }> {
  registerHooksModule()

  const { mtimeMs } = await stat(file)
  // A plain path, not a `file://` URL: Bun ignores the query on file URLs,
  // which would serve the cached module after an edit.
  const mod = (await import(`${file}?v=${mtimeMs}`)) as {
    default?: unknown
  }

  if (mod.default === undefined) {
    return { hooks: [], errors: ['no default export'] }
  }

  const exported = Array.isArray(mod.default) ? mod.default : [mod.default]
  const hooks: AnyHookDefinition[] = []
  const errors: string[] = []

  exported.forEach((value, index) => {
    const problem = validateHookDefinition(value)
    if (problem) {
      errors.push(`export #${index}: ${problem}`)
    } else {
      hooks.push(value as AnyHookDefinition)
    }
  })

  return { hooks, errors }
}
