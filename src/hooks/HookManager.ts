import { isAbsolute, relative, resolve } from 'node:path'
import { Check } from 'typebox/value'
import type { HookManagerEvents } from 'src/data/events'
import type { HooksConfig } from 'src/config/schemas'
import { BaseManager } from 'src/managers/BaseManager'
import { resolveOptionAnswer } from 'src/utils/helpers'
import { logDebug, logWarning } from 'src/utils/logger'
import { builtinHooks } from './builtin'
import { createHookContext, FileHookStore } from './context'
import { HOOK_EVENTS, type HookEventName, type HookInput } from './events'
import {
  globalHooksDir,
  importHookFile,
  listHookFiles,
  projectHooksDir,
} from './loader'
import { matches } from './match'
import { DbTrustStore, sha256, type TrustStore } from './trust'
import type {
  AnyHookDefinition,
  HookHost,
  HookInfo,
  HookRunOutcome,
  HookSource,
  HookStore,
} from './types'

const DEFAULT_PRIORITY = 100
const DEFAULT_TIMEOUT_MS = 5000

interface RegisteredHook {
  def: AnyHookDefinition
  source: HookSource
  file?: string
  /** Built-in options (user hooks read `config.hooks.options[name]`). */
  options?: Record<string, unknown>
  /** Registration order, the tie-breaker for equal priorities. */
  order: number
}

export interface HookLoadError {
  file: string
  error: string
}

export interface HookLoadSummary {
  loaded: number
  pendingTrust: string[]
  errors: HookLoadError[]
}

type InvokeResult =
  | { status: 'ok'; result: unknown }
  | { status: 'invalid' }
  | { status: 'failed'; error: string }

const ASK_OPTIONS = [
  { id: 'allow', label: 'Allow' },
  { id: 'deny', label: 'Deny' },
]

const TRUST_OPTIONS = [
  { id: 'trust', label: 'Trust', description: 'Run this file’s hooks' },
  { id: 'skip', label: 'Skip', description: 'Don’t run it (until it changes)' },
]

/**
 * Loads hooks (built-in, global, configured and trusted project files) and
 * runs them for events raised by the server. See `docs/hooks.md`.
 */
export class HookManager extends BaseManager<HookManagerEvents> {
  private hooks: Map<string, RegisteredHook> = new Map()
  private enabledOverrides: Map<string, boolean> = new Map()
  private pending: string[] = []
  private loadErrors: HookLoadError[] = []
  private stores: Map<string, HookStore> = new Map()
  private order = 0
  private readonly trustStore: TrustStore
  private readonly globalDir?: string

  /** Initializes a new instance of the HookManager with the specified host and optional configurations. */
  constructor(
    private readonly workspaceRoot: string,
    private readonly host: HookHost,
    options: { trustStore?: TrustStore; globalDir?: string } = {},
  ) {
    super()
    this.trustStore = options.trustStore ?? new DbTrustStore(this.workspaceRoot)
    this.globalDir = options.globalDir
  }

  /** Retrieves the current configuration settings. */
  private get config(): HooksConfig | undefined {
    return this.host.config()?.hooks
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  /**
   * (Re)loads every hook. Project files (inside the workspace) run only once
   * trusted: with `askTrust` the user is asked now, otherwise unknown or
   * changed files are left pending for `resolvePendingTrust()`.
   * `askSkipped` re-asks about files the user skipped before.
   */
  async load(
    opts: { askTrust?: boolean; askSkipped?: boolean } = {},
  ): Promise<HookLoadSummary> {
    this.hooks.clear()
    this.pending = []
    this.loadErrors = []

    const config = this.config
    if (!config?.enabled) {
      return this._summary()
    }

    for (const { def, options } of builtinHooks(config.builtin)) {
      this.register(def, 'builtin', { options })
    }

    const root = this.host.workspaceRoot()
    const sources: Array<{ target: string; source: HookSource }> = [
      { target: this.globalDir ?? globalHooksDir(), source: 'global' },
      ...config.paths.map((path) => ({
        target: resolve(root, path),
        source: 'config' as const,
      })),
      { target: projectHooksDir(root), source: 'project' },
    ]

    for (const { target, source } of sources) {
      for (const file of await listHookFiles(target)) {
        const needsTrust = source !== 'global' && this._isInside(file, root)
        const trust = needsTrust ? await this._trustFor(file, opts) : 'trusted'

        if (trust === 'trusted') {
          await this._loadFile(file, source)
        }
      }
    }

    return this._summary()
  }

  /** Asks about files left pending by `load()`, loading the trusted ones. */
  async resolvePendingTrust(): Promise<HookLoadSummary> {
    const pending = this.pending
    this.pending = []

    for (const file of pending) {
      const trust = await this._askTrust(file)
      if (trust === 'trusted') {
        await this._loadFile(file, 'project')
      }
    }

    return this._summary()
  }

  /** Registers a hook (later registrations replace same-named hooks). */
  register(
    def: AnyHookDefinition,
    source: HookSource,
    extra: { file?: string; options?: Record<string, unknown> } = {},
  ) {
    const existing = this.hooks.get(def.name)
    if (existing) {
      logWarning(
        `[hooks] "${def.name}" from ${extra.file ?? source} replaces the one from ${existing.file ?? existing.source}`,
      )
    }

    this.hooks.set(def.name, {
      def,
      source,
      file: extra.file,
      options: extra.options,
      order: this.order++,
    })
  }

  /** Load a file from the specified path. */
  private async _loadFile(file: string, source: HookSource) {
    try {
      const { hooks, errors } = await importHookFile(file)
      hooks.forEach((def) => this.register(def, source, { file }))
      errors.forEach((error) => this._loadError(file, error))
    } catch (error) {
      this._loadError(
        file,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  /** Displays an error message when a file fails to load. */
  private _loadError(file: string, error: string) {
    logWarning(`[hooks] ${file}: ${error}`)
    this.loadErrors.push({ file, error })
  }

  /** Determines if a file is located within a specified root directory. */
  private _isInside(file: string, root: string): boolean {
    const rel = relative(root, file)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  }

  /**
   * Trust for a project file. The config can only *restrict* trust (it may
   * come from the repository); trusting everything requires the
   * `ACP_TRUST_PROJECT_HOOKS=always` env var.
   */
  private async _trustFor(
    file: string,
    opts: { askTrust?: boolean; askSkipped?: boolean },
  ): Promise<'trusted' | 'skip' | 'pending'> {
    if (process.env.ACP_TRUST_PROJECT_HOOKS === 'always') {
      return 'trusted'
    }
    if (this.config?.trustProjectHooks === 'never') {
      return 'skip'
    }

    const hash = sha256(await Bun.file(file).bytes())
    const record = await this.trustStore.get(file)

    if (record && record.sha256 === hash) {
      if (record.trusted) return 'trusted'
      if (!opts.askSkipped) return 'skip'
    }

    if (!opts.askTrust) {
      this.pending.push(file)
      return 'pending'
    }

    return this._askTrust(file)
  }

  /** Asks the user for confirmation about trusting a specific file and returns whether the file is trusted, skipped, or pending further action. */
  private async _askTrust(
    file: string,
  ): Promise<'trusted' | 'skip' | 'pending'> {
    const hash = sha256(await Bun.file(file).bytes())

    let answer: string
    try {
      answer = await this.host.ask(
        `A project hook file wants to run:\n${file}\n(sha256 ${hash.slice(0, 12)})\n\n` +
          'Hooks run with your user permissions. Trust this file?',
        TRUST_OPTIONS,
      )
    } catch (error) {
      logWarning(`[hooks] Could not ask about ${file}: ${error}`)
      this.pending.push(file)
      return 'pending'
    }

    const trusted = resolveOptionAnswer(answer, TRUST_OPTIONS) === 'trust'
    await this.trustStore.set(file, { sha256: hash, trusted })
    return trusted ? 'trusted' : 'skip'
  }

  /** Generates a summary of hook loads. */
  private _summary(): HookLoadSummary {
    return {
      loaded: this.hooks.size,
      pendingTrust: [...this.pending],
      errors: [...this.loadErrors],
    }
  }

  // -------------------------------------------------------------------------
  // Enable / list
  // -------------------------------------------------------------------------

  /** `group` of a `group:part` name. */
  private _group(name: string): string {
    return name.split(':')[0] ?? name
  }

  /** Checks if the specified feature or module is enabled. */
  isEnabled(name: string): boolean {
    const group = this._group(name)
    const override =
      this.enabledOverrides.get(name) ?? this.enabledOverrides.get(group)
    if (override !== undefined) {
      return override
    }

    const disabled = this.config?.disabled ?? []
    return !disabled.includes(name) && !disabled.includes(group)
  }

  /**
   * Enables/disables a hook (or a `group` of `group:part` hooks) for this
   * server run. Returns `false` when nothing has that name.
   */
  setEnabled(name: string, enabled: boolean): boolean {
    const known = [...this.hooks.keys()].some(
      (hook) => hook === name || this._group(hook) === name,
    )
    if (!known) {
      return false
    }

    this.enabledOverrides.set(name, enabled)
    return true
  }

  /** Retrieves a list of hooks. */
  list(): HookInfo[] {
    return [...this.hooks.values()]
      .sort(
        (a, b) =>
          a.def.event.localeCompare(b.def.event) ||
          (a.def.priority ?? DEFAULT_PRIORITY) -
            (b.def.priority ?? DEFAULT_PRIORITY) ||
          a.order - b.order,
      )
      .map(({ def, source, file }) => ({
        name: def.name,
        event: def.event,
        description: def.description,
        source,
        file,
        priority: def.priority ?? DEFAULT_PRIORITY,
        enabled: this.isEnabled(def.name),
      }))
  }

  /** Retrieves an array of pending trust items that require verification or approval. */
  pendingTrust(): string[] {
    return [...this.pending]
  }

  // -------------------------------------------------------------------------
  // Running
  // -------------------------------------------------------------------------

  /**
   * Runs the hooks for `event`. `observe` events run every matching hook in
   * parallel; `sequential` events run them in priority order, applying
   * transforms and stopping at the first allow/deny.
   */
  async run<E extends HookEventName>(
    event: E,
    input: HookInput<E>,
  ): Promise<HookRunOutcome<E>> {
    const hooks = this._hooksFor(event, input)
    if (hooks.length === 0) {
      return { input }
    }

    const definition = HOOK_EVENTS[event]

    if (definition.mode === 'observe') {
      await Promise.all(hooks.map((hook) => this._invoke(hook, event, input)))
      return { input }
    }

    let current = input
    for (const hook of hooks) {
      // A copy, so a hook mutating its input can't leak into the next one;
      // changes travel only through the result's transform fields.
      const call = await this._invoke(hook, event, structuredClone(current))

      if (call.status === 'failed') {
        const policy = hook.def.onError ?? definition.onError
        if (policy === 'ignore') continue
        return this._decided(
          event,
          hook,
          current,
          policy,
          `Hook failed: ${call.error}`,
        )
      }

      if (call.status !== 'ok' || !call.result) {
        continue
      }

      const result = call.result as Record<string, unknown>
      current = this._applyTransform(definition.transform, current, result)

      let decision = result.decision as string | undefined
      const reason = result.reason as string | undefined
      if (decision === 'ask') {
        decision = await this._askUser(hook, event, reason)
      }

      if (decision === 'allow' || decision === 'deny') {
        return this._decided(event, hook, current, decision, reason)
      }
    }

    return { input: current }
  }

  /** Retrieves the hooks registered for a specific event. */
  private _hooksFor(event: HookEventName, input: unknown): RegisteredHook[] {
    if (!this.config?.enabled) {
      return []
    }

    const context = {
      provider: this.host.provider(),
      workspaceRoot: this.host.workspaceRoot(),
    }

    return [...this.hooks.values()]
      .filter(
        (hook) =>
          hook.def.event === event &&
          this.isEnabled(hook.def.name) &&
          matches(hook.def.match, input as Record<string, unknown>, context),
      )
      .sort(
        (a, b) =>
          (a.def.priority ?? DEFAULT_PRIORITY) -
            (b.def.priority ?? DEFAULT_PRIORITY) || a.order - b.order,
      )
  }

  /** Applies transformations to specific fields using the input data and updates the result with the transformed values. */
  private _applyTransform<T>(
    fields: readonly string[],
    input: T,
    result: Record<string, unknown>,
  ): T {
    const changes = Object.fromEntries(
      fields
        .filter((field) => result[field] !== undefined)
        .map((field) => [field, result[field]]),
    )
    return Object.keys(changes).length > 0 ? { ...input, ...changes } : input
  }

  /** Determines whether to allow or deny based on hook input and returns the outcome, with an optional reason. */
  private _decided<E extends HookEventName>(
    event: E,
    hook: RegisteredHook,
    input: HookInput<E>,
    decision: 'allow' | 'deny',
    reason?: string,
  ): HookRunOutcome<E> {
    this.emit('hook.decided', { hook: hook.def.name, event, decision, reason })
    return { input, decision, reason, decidedBy: hook.def.name }
  }

  /** Prompts the user for permission when a hook is triggered and returns their decision (allow or deny). */
  private async _askUser(
    hook: RegisteredHook,
    event: HookEventName,
    reason: string | undefined,
  ): Promise<'allow' | 'deny'> {
    try {
      const answer = await this.host.ask(
        `Hook "${hook.def.name}" (${event}) asks for confirmation` +
          (reason ? `:\n${reason}` : '.') +
          '\n\nAllow?',
        ASK_OPTIONS,
      )
      return resolveOptionAnswer(answer, ASK_OPTIONS) === 'allow'
        ? 'allow'
        : 'deny'
    } catch (error) {
      logWarning(`[hooks] Could not ask for "${hook.def.name}": ${error}`)
      return 'deny'
    }
  }

  /** Retrieves or creates a store for the specified name. */
  private _storeFor(name: string): HookStore {
    let store = this.stores.get(name)
    if (!store) {
      store = FileHookStore.forHook(this.host.workspaceRoot(), name)
      this.stores.set(name, store)
    }
    return store
  }

  /** Invokes a registered hook in response to an event and returns the result. */
  private async _invoke(
    hook: RegisteredHook,
    event: HookEventName,
    input: unknown,
  ): Promise<InvokeResult> {
    const definition = HOOK_EVENTS[event]
    const name = hook.def.name
    const timeoutMs =
      hook.def.timeoutMs ?? this.config?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
    const controller = new AbortController()
    const ctx = createHookContext({
      hook: name,
      event,
      host: this.host,
      options: hook.options ?? this.config?.options?.[name] ?? {},
      signal: controller.signal,
      store: this._storeFor(name),
      defaultExecTimeoutMs: timeoutMs,
    })

    const started = performance.now()
    let timer: ReturnType<typeof setTimeout> | undefined

    try {
      const result = await Promise.race([
        Promise.resolve().then(() =>
          (hook.def.handler as (input: unknown, ctx: unknown) => unknown)(
            input,
            ctx,
          ),
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort()
            reject(new Error(`timed out after ${timeoutMs}ms`))
          }, timeoutMs)
        }),
      ])

      if (
        definition.mode === 'sequential' &&
        result != null &&
        !Check(definition.result, result)
      ) {
        const error = 'returned an invalid result (ignored)'
        logWarning(`[hooks] "${name}" ${error}: ${JSON.stringify(result)}`)
        this.emit('hook.error', { hook: name, event, error })
        return { status: 'invalid' }
      }

      const durationMs = Math.round(performance.now() - started)
      logDebug(`[hooks] "${name}" ran for ${event} in ${durationMs}ms`)
      this.emit('hook.ran', { hook: name, event, durationMs })
      return { status: 'ok', result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logWarning(`[hooks] "${name}" failed on ${event}: ${message}`)
      this.emit('hook.error', { hook: name, event, error: message })
      return { status: 'failed', error: message }
    } finally {
      clearTimeout(timer)
    }
  }

  /** Disposes of resources and performs cleanup tasks. */
  dispose() {
    this.removeAllListeners()
    this.hooks.clear()
    this.stores.clear()
  }
}
