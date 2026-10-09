import type { BuiltinHooksConfig } from 'src/config/schemas'
import type { HookContext } from '../types'
import { commandLine } from '../match'
import { defineHook } from '../public'
import { logWarning } from 'src/utils/logger'

type Options = BuiltinHooksConfig['indexerFirst']

/** Prefix agentic-indexer puts on results that found nothing. */
export const NO_RESULTS_MARKER = '[no-results]'

interface TurnState {
  /** An indexer tool was called this turn. */
  indexerUsed: boolean
  /** An indexer tool reported `[no-results]` this turn. */
  noResults: boolean
  /** Tool call ids of indexer calls, to match their later updates. */
  indexerCalls: Set<string>
  denials: number
  /** The fail-open / warn notice was already sent this turn. */
  notified: boolean
}

const newTurn = (): TurnState => ({
  indexerUsed: false,
  noResults: false,
  indexerCalls: new Set(),
  denials: 0,
  notified: false,
})

function compile(pattern: string, option: string): RegExp | null {
  try {
    return new RegExp(pattern)
  } catch (error) {
    logWarning(
      `[hooks] indexerFirst: ignoring invalid ${option} regex ${pattern}: ${error}`,
    )
    return null
  }
}

const GUIDE = (unlockOn: Options['unlockOn']) =>
  [
    '[Code exploration policy]',
    'This workspace is indexed by the `agentic-indexer` MCP server. To find and read code:',
    '1. Start with its tools: `search_codebase` (symbols, files, semantic search), `inspect_symbol`, `trace_code_graph`, `inspect_imports`.',
    '2. Read code with `read_code`, or read a line range at the `file:line` the index returned.',
    unlockOn === 'noResults'
      ? `3. Use grep/find or read whole files only after an indexer tool answered \`${NO_RESULTS_MARKER}\`. Until then such reads and searches are refused.`
      : '3. Use grep/find or read whole files only after you have queried the indexer in this turn. Until then such reads and searches are refused.',
  ].join('\n')

/**
 * Makes agents explore the codebase through agentic-indexer before raw
 * searches and whole-file reads. See `docs/hooks.md` ("Using indexerFirst")
 * for what each provider routes through these hooks.
 */
export function indexerFirst(options: Options) {
  const toolPattern = compile(options.toolPattern, 'toolPattern')
  const searchCommands = compile(options.searchCommands, 'searchCommands')
  const turns = new Map<string, TurnState>()

  const turn = (acpSessionId: string) => {
    let state = turns.get(acpSessionId)
    if (!state) {
      state = newTurn()
      turns.set(acpSessionId, state)
    }
    return state
  }

  const isIndexerTool = (title: string | undefined) =>
    Boolean(title && toolPattern?.test(title))

  /** A number (`offset: 10`) or a list of numbers (`view_range: [1, 40]`). */
  const isRangeValue = (value: unknown) =>
    typeof value === 'number' ||
    (Array.isArray(value) &&
      value.length > 0 &&
      value.every((item) => typeof item === 'number'))

  const hasRange = (rawInput: unknown) => {
    const raw = rawInput as Record<string, unknown> | null | undefined
    return options.rangeKeys.some((key) => isRangeValue(raw?.[key]))
  }

  /** Read-kind tools that search (e.g. Copilot's grep: `kind: 'read'` + `pattern`). */
  const hasSearchInput = (rawInput: unknown) => {
    const raw = rawInput as Record<string, unknown> | null | undefined
    return options.searchKeys.some((key) => typeof raw?.[key] === 'string')
  }

  /**
   * The shared gate: `undefined` lets the action through, a result denies
   * it. Fails open in `warn` mode, with the indexer off, and after
   * `maxDenialsPerTurn` denials.
   */
  const gate = (acpSessionId: string, what: string, ctx: HookContext) => {
    if (!ctx.config?.indexer.enabled) return

    const state = turn(acpSessionId)
    const unlocked =
      options.unlockOn === 'noResults' ? state.noResults : state.indexerUsed
    if (unlocked) return

    const reason =
      options.unlockOn === 'noResults'
        ? `${what} is only allowed after an agentic-indexer tool returned ${NO_RESULTS_MARKER}. Use search_codebase / inspect_symbol, then read_code or a ranged read (hooks.builtin.indexerFirst)`
        : `${what} is only allowed after querying agentic-indexer (search_codebase / inspect_symbol) in this turn (hooks.builtin.indexerFirst)`

    if (options.mode === 'warn') {
      if (!state.notified) {
        state.notified = true
        ctx.notify(`indexerFirst (warn): ${reason}`, 'warn')
      }
      return
    }

    if (state.denials >= options.maxDenialsPerTurn) {
      if (!state.notified) {
        state.notified = true
        ctx.notify(
          `indexerFirst: ${state.denials} actions refused this turn; allowing the rest of it.`,
          'warn',
        )
      }
      return
    }

    state.denials++
    return { decision: 'deny' as const, reason }
  }

  return [
    defineHook({
      name: 'indexerFirst:reset',
      event: 'prompt.before',
      description: 'Starts a fresh indexer-first turn',
      priority: 1,
      handler(input) {
        turns.set(input.acpSessionId, newTurn())
      },
    }),
    defineHook({
      name: 'indexerFirst:guide',
      event: 'prompt.before',
      description: 'Tells the agent to explore through agentic-indexer first',
      match: { origin: 'user' },
      priority: 45,
      onError: 'ignore',
      async handler(input, ctx) {
        if (!ctx.config?.indexer.enabled) return

        const key = `guided:${input.sessionId}`
        if (options.firstPromptOnly && (await ctx.store.get(key))) {
          return
        }
        if (options.firstPromptOnly) {
          await ctx.store.set(key, true)
        }

        return {
          prompt: [
            { type: 'text', text: GUIDE(options.unlockOn) },
            ...input.prompt,
          ],
        }
      },
    }),
    defineHook({
      name: 'indexerFirst:track',
      event: 'session.update',
      description: 'Records indexer tool calls and empty results',
      match: { updateType: ['tool_call', 'tool_call_update'] },
      handler(input) {
        const update = input.update as {
          toolCallId?: string
          title?: string | null
          content?: unknown
          rawOutput?: unknown
        }
        const state = turn(input.acpSessionId)
        const id = update.toolCallId

        if (isIndexerTool(update.title ?? undefined)) {
          state.indexerUsed = true
          if (id) state.indexerCalls.add(id)
        }
        if (!id || !state.indexerCalls.has(id)) return

        const output = JSON.stringify([update.content, update.rawOutput])
        if (output.includes(NO_RESULTS_MARKER)) {
          state.noResults = true
        }
      },
    }),
    defineHook({
      name: 'indexerFirst:permission',
      event: 'permission.request',
      description:
        'Allows indexer tools; refuses raw searches and whole-file reads until the indexer is used',
      priority: 20,
      handler(input, ctx) {
        const { toolCall } = input
        if (isIndexerTool(toolCall.title)) {
          return {
            decision: 'allow',
            reason: 'agentic-indexer tool (indexerFirst)',
          }
        }

        const command = commandLine(input)
        const isSearch =
          toolCall.kind === 'search' ||
          (toolCall.kind === 'read' && hasSearchInput(toolCall.rawInput)) ||
          (toolCall.kind === 'execute' &&
            command !== null &&
            Boolean(searchCommands?.test(command)))
        const isFullRead =
          toolCall.kind === 'read' && !hasRange(toolCall.rawInput)

        if (isSearch) {
          return gate(input.acpSessionId, `Searching (${toolCall.title})`, ctx)
        }
        if (isFullRead) {
          return gate(
            input.acpSessionId,
            `Reading a whole file (${toolCall.title})`,
            ctx,
          )
        }
      },
    }),
    defineHook({
      name: 'indexerFirst:read',
      event: 'fs.beforeRead',
      description: 'Refuses whole-file reads until the indexer is used',
      priority: 20,
      handler(input, ctx) {
        if (input.line != null || input.limit != null) return
        return gate(input.acpSessionId, `Reading all of ${input.path}`, ctx)
      },
    }),
    defineHook({
      name: 'indexerFirst:terminal',
      event: 'terminal.beforeCreate',
      description: 'Refuses grep/find-style searches until the indexer is used',
      priority: 20,
      handler(input, ctx) {
        const command = commandLine(input)
        if (command === null || !searchCommands?.test(command)) return
        return gate(input.acpSessionId, `Running \`${command}\``, ctx)
      },
    }),
  ]
}
