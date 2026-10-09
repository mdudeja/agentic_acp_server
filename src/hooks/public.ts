/**
 * The public API for hook files: `import { defineHook } from
 * 'agentic-acp-server/hooks'`.
 *
 * At runtime that specifier is a virtual module registered by the hook
 * loader (see `HOOKS_MODULE_SOURCE`), so hook files work without
 * installing anything. For editor types, map the specifier to this file in
 * your tsconfig `paths`.
 */
import type { AnyHookDefinition } from './types'

export type {
  HookContext,
  HookDefinition,
  HookDecision,
  HookErrorPolicy,
  HookEventName,
  HookExecResult,
  HookInput,
  HookMatch,
  HookResult,
  HookSessionSnapshot,
  HookStore,
} from './types'

/**
 * Identity helper that types a hook definition by its `event`: the handler's
 * input and allowed result follow from the event name.
 *
 * (Typed as the union of all definitions, discriminated by `event`, rather
 * than generically: generic inference would widen handler return literals
 * such as `{ decision: 'deny' }` to `string`.)
 */
export function defineHook(hook: AnyHookDefinition): AnyHookDefinition {
  return hook
}

/** The specifier hook files import the public API from. */
export const HOOKS_MODULE_ID = 'agentic-acp-server/hooks'

/** Runtime source of the virtual `agentic-acp-server/hooks` module. */
export const HOOKS_MODULE_SOURCE =
  'export function defineHook(hook) { return hook }\n'
