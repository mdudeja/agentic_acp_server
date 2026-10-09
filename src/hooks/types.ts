import type { AgenticConfig } from 'src/config/schemas'
import type {
  HookDecision,
  HookEventName,
  HookInput,
  HookResult,
} from './events'
import type { Providers } from 'src/data/providers'

export type {
  HookDecision,
  HookEventName,
  HookInput,
  HookResult,
} from './events'

/**
 * Narrows which inputs a hook runs for. Every field is optional; a field is
 * only checked when the event's input has the corresponding value.
 */
export interface HookMatch {
  /** Active provider id(s), e.g. `'opencode'`. */
  provider?: Providers | Providers[]
  /**
   * Glob(s) against `input.path`, tried on the absolute path and on the
   * path relative to the workspace (e.g. `'**\/.env*'`, `'src/**\/*.ts'`).
   */
  path?: string | string[]
  /** Regex against the full command line (`command` + `args`). */
  command?: string | RegExp
  /** `session.update` kind(s), e.g. `'tool_call'`. */
  updateType?: string | string[]
  /** Prompt origin for `prompt.*` events. */
  origin?: 'user' | 'internal'
}

/** What happens when a hook throws or times out. */
export type HookErrorPolicy = 'allow' | 'deny' | 'ignore'

export interface HookDefinition<E extends HookEventName = HookEventName> {
  /** Unique name. `group:part` names can be disabled together by `group`. */
  name: string
  event: E
  description?: string
  match?: HookMatch
  /** Lower runs first. Default 100. */
  priority?: number
  /** Default: `config.hooks.defaultTimeoutMs`. */
  timeoutMs?: number
  /** Default depends on the event (guards deny, others ignore). */
  onError?: HookErrorPolicy
  handler: (
    input: HookInput<E>,
    ctx: HookContext,
  ) => HookResult<E> | void | Promise<HookResult<E> | void>
}

/** A definition for any event, as stored by the registry. */
export type AnyHookDefinition = {
  [E in HookEventName]: HookDefinition<E>
}[HookEventName]

export interface HookSessionSnapshot {
  readonly id: string
  readonly acpSessionId: string
  readonly name: string | null
  readonly status: string
}

export interface HookStore {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

export interface HookExecResult {
  exitCode: number | null
  stdout: string
  stderr: string
}

/**
 * What a hook handler gets besides its input: a small, stable facade over
 * the server (never the server itself).
 */
export interface HookContext {
  /** This hook's name. */
  readonly hook: string
  readonly event: HookEventName
  readonly workspaceRoot: string
  readonly provider: Providers | null
  /** The active session, if any. */
  readonly session: HookSessionSnapshot | null
  readonly config: Readonly<AgenticConfig> | undefined
  /** Per-hook options: `config.hooks.options[name]` (or the built-in's block). */
  readonly options: Readonly<Record<string, unknown>>
  /** Aborted when the hook times out. */
  readonly signal: AbortSignal
  readonly log: {
    debug(message: string): void
    info(message: string): void
    warn(message: string): void
    error(message: string): void
  }
  /** Shows a message in the editor (`agentic/log`). */
  notify(message: string, level?: 'info' | 'warn' | 'error'): void
  /** Asks the user in the editor and returns the answer (an option id when options are given). */
  ask(
    question: string,
    options?: Array<{ id: string; label: string; description?: string }>,
  ): Promise<string>
  /** Runs a shell command (in the workspace by default). */
  exec(
    command: string,
    opts?: { cwd?: string; timeoutMs?: number },
  ): Promise<HookExecResult>
  /** Cancels the running turn of a session (the active one by default). */
  cancelTurn(sessionId?: string): Promise<void>
  /** Persistent per-hook key/value storage (JSON, under `.agentic/hooks-state/`). */
  readonly store: HookStore
}

/** The outcome of running an event's hooks. */
export interface HookRunOutcome<E extends HookEventName> {
  /** The input after transforms (unchanged for `observe` events). */
  input: HookInput<E>
  /** Set when a hook decided (`ask` is resolved into allow/deny). */
  decision?: Exclude<HookDecision, 'ask'>
  reason?: string
  /** Name of the hook that decided. */
  decidedBy?: string
}

export type HookRunner = <E extends HookEventName>(
  event: E,
  input: HookInput<E>,
) => Promise<HookRunOutcome<E>>

/**
 * What the hook system needs from the server. Implemented by
 * `AgenticServer`; tests can provide a fake.
 */
export interface HookHost {
  workspaceRoot(): string
  config(): AgenticConfig | undefined
  provider(): Providers | null
  activeSession(): HookSessionSnapshot | null
  notify(level: 'info' | 'warn' | 'error', message: string): void
  ask(
    question: string,
    options: Array<{ id: string; label: string; description?: string }>,
    signal?: AbortSignal,
  ): Promise<string>
  cancelTurn(sessionId?: string): Promise<void>
}

export type HookSource = 'builtin' | 'global' | 'project' | 'config'

/** A hook as listed by `client/list_hooks`. */
export interface HookInfo {
  name: string
  event: HookEventName
  description?: string
  source: HookSource
  file?: string
  priority: number
  enabled: boolean
}
