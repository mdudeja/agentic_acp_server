/**
 * Scripted scenarios for the echo provider — a playground for editor UI work.
 *
 * A prompt whose text starts with `/<name> [args...]` (where `<name>` is a key
 * of `SCENARIOS`) runs that scenario instead of the plain echo. Each scenario
 * drives the server exactly like a real agent would: it streams
 * `session/update` notifications and issues agent → client requests
 * (permission, fs, terminal, elicitation), awaiting the editor's answers.
 *
 * The echo provider advertises every scenario as an ACP available command
 * (`availableCommands()`) once a session is created, loaded, resumed or
 * forked. Send `/help` for the list, or `/commands` to re-send them.
 *
 * `ECHO_STUB_DELAY_MS` sets the pause between streamed chunks (default 30);
 * every other pause scales with it, so `0` runs scenarios instantly.
 */

const DEFAULT_DELAY_MS = 30
const SPEED =
  Number(process.env.ECHO_STUB_DELAY_MS ?? DEFAULT_DELAY_MS) / DEFAULT_DELAY_MS

/** What a scenario can do; implemented by the echo provider. */
export type ScenarioContext = {
  sessionId: string
  cwd: string
  args: string[]
  signal: AbortSignal
  /** Sends one `session/update` notification. */
  update: (update: Record<string, unknown>) => void
  /** Sends an agent → client request and resolves with its result. */
  request: (method: string, params: Record<string, unknown>) => Promise<any>
  /** Sends an agent → client notification. */
  notify: (method: string, params: Record<string, unknown>) => void
}

/** Ends the turn with this stop reason (default `end_turn`). */
export type ScenarioResult = { stopReason?: string } | void

/** Thrown to answer `session/prompt` with a JSON-RPC error instead. */
export class ScenarioError extends Error {
  constructor(
    message: string,
    readonly code: number = -32603,
  ) {
    super(message)
  }
}

export type Scenario = {
  description: string
  /** Shown as the command's input hint. */
  hint?: string
  run: (ctx: ScenarioContext) => Promise<ScenarioResult>
}

/** Resolves after `ms`, or rejects with an `AbortError` on cancel. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError())
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function abortError() {
  return new DOMException('Prompt cancelled', 'AbortError')
}

/** A pause of `ms` at the default speed, scaled by `ECHO_STUB_DELAY_MS`. */
const pause = (ctx: ScenarioContext, ms: number) =>
  sleep(ms * SPEED, ctx.signal)

let idCounter = 0
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${++idCounter}`

/** Streams `text` as word-sized chunks of the given chunk update type. */
async function stream(
  ctx: ScenarioContext,
  text: string,
  kind: 'agent_message_chunk' | 'agent_thought_chunk' = 'agent_message_chunk',
  delayMs: number = DEFAULT_DELAY_MS,
) {
  const messageId = nextId('msg')
  for (const piece of text.match(/\S+\s*|\s+/g) ?? []) {
    ctx.update({
      sessionUpdate: kind,
      messageId,
      content: { type: 'text', text: piece },
    })
    await pause(ctx, delayMs)
  }
}

const say = (ctx: ScenarioContext, text: string) => stream(ctx, text)

const MARKDOWN = `## Echo stub: markdown

Here is a **bold** claim, some \`inline code\`, and a [link](https://agentclientprotocol.com).

1. First item
2. Second item
   - nested bullet

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}!\`
}
\`\`\`

| Column | Value |
|--------|-------|
| alpha  | 1     |
| beta   | 2     |

> A blockquote to finish.
`

const SAMPLE_OLD = `function add(a, b) {
  return a + b
}
`

const SAMPLE_NEW = `/** Adds two numbers. */
function add(a: number, b: number): number {
  return a + b
}
`

/** Picks a model value other than the current one, for `config_option_update`. */
function toggledConfigOptions() {
  return [
    {
      id: 'model',
      category: 'model',
      name: 'Model',
      type: 'select',
      currentValue: 'model2',
      options: [
        { name: 'Model 1', value: 'model1' },
        { name: 'Model 2', value: 'model2' },
      ],
    },
  ]
}

export const SCENARIOS: Record<string, Scenario> = {
  help: {
    description: 'List the available stub scenarios',
    run: async (ctx) => {
      const lines = Object.entries(SCENARIOS).map(
        ([name, s]) =>
          `- \`/${name}${s.hint ? ` ${s.hint}` : ''}\` — ${s.description}`,
      )
      await say(ctx, `### Echo stub scenarios\n\n${lines.join('\n')}\n`)
    },
  },

  commands: {
    description: 'Re-send the scenarios as ACP available commands',
    run: async (ctx) => {
      ctx.update(availableCommandsUpdate())
      await say(ctx, 'Re-sent the stub scenarios as available commands.')
    },
  },

  markdown: {
    description: 'Stream a markdown-heavy agent message',
    run: async (ctx) => {
      await say(ctx, MARKDOWN)
    },
  },

  thought: {
    description: 'Stream agent thoughts, then an answer',
    run: async (ctx) => {
      await stream(
        ctx,
        'The user wants to see reasoning. I should think step by step, ' +
          'consider the options, and then answer concisely.',
        'agent_thought_chunk',
      )
      await say(ctx, 'Done thinking — here is the answer: **42**.')
    },
  },

  slow: {
    description: 'Stream a long message slowly (to test cancel)',
    hint: '[seconds]',
    run: async (ctx) => {
      const seconds = Number(ctx.args[0] ?? 15)
      const words = Math.max(1, Math.round((seconds * 1000) / 150))
      const text = Array.from({ length: words }, (_, i) =>
        i % 12 === 11 ? `word${i + 1}.\n` : `word${i + 1}`,
      ).join(' ')
      await stream(ctx, text, 'agent_message_chunk', 150)
    },
  },

  resource: {
    description: 'Send resource_link and embedded resource content blocks',
    run: async (ctx) => {
      await say(ctx, 'Here are some references:\n')
      ctx.update({
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'resource_link',
          uri: `file://${ctx.cwd}/README.md`,
          name: 'README.md',
          mimeType: 'text/markdown',
        },
      })
      ctx.update({
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'resource',
          resource: {
            uri: `file://${ctx.cwd}/example.ts`,
            mimeType: 'text/x-typescript',
            text: SAMPLE_NEW,
          },
        },
      })
    },
  },

  tool_call: {
    description: 'A read tool call: pending → in_progress → completed',
    hint: '[path]',
    run: async (ctx) => {
      const path = ctx.args[0] ?? `${ctx.cwd}/README.md`
      const toolCallId = nextId('tool')
      ctx.update({
        sessionUpdate: 'tool_call',
        toolCallId,
        title: `Read ${path}`,
        kind: 'read',
        status: 'pending',
        locations: [{ path, line: 1 }],
        rawInput: { path },
      })
      await pause(ctx, 400)
      ctx.update({
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: 'in_progress',
      })
      await pause(ctx, 800)
      ctx.update({
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: 'completed',
        content: [
          {
            type: 'content',
            content: { type: 'text', text: '(42 lines read)' },
          },
        ],
        rawOutput: { lines: 42 },
      })
      await say(ctx, `I read \`${path}\`.`)
    },
  },

  tool_failed: {
    description: 'A tool call that fails',
    run: async (ctx) => {
      const toolCallId = nextId('tool')
      ctx.update({
        sessionUpdate: 'tool_call',
        toolCallId,
        title: 'Search for "nonexistent_symbol"',
        kind: 'search',
        status: 'in_progress',
        rawInput: { query: 'nonexistent_symbol' },
      })
      await pause(ctx, 700)
      ctx.update({
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: 'failed',
        content: [
          {
            type: 'content',
            content: {
              type: 'text',
              text: 'Error: ripgrep exited with code 2',
            },
          },
        ],
      })
      await say(ctx, 'The search failed, sorry.')
    },
  },

  tools: {
    description: 'Several concurrent tool calls of different kinds',
    run: async (ctx) => {
      const kinds = ['read', 'search', 'fetch', 'think', 'execute'] as const
      const ids = kinds.map((kind) => {
        const toolCallId = nextId('tool')
        ctx.update({
          sessionUpdate: 'tool_call',
          toolCallId,
          title: `A ${kind} tool`,
          kind,
          status: 'in_progress',
        })
        return toolCallId
      })
      for (const toolCallId of ids) {
        await pause(ctx, 500)
        ctx.update({
          sessionUpdate: 'tool_call_update',
          toolCallId,
          status: 'completed',
        })
      }
      await say(ctx, 'All tools finished.')
    },
  },

  diff: {
    description: 'An edit tool call carrying a diff',
    hint: '[path]',
    run: async (ctx) => {
      const path = ctx.args[0] ?? `${ctx.cwd}/example.ts`
      const toolCallId = nextId('tool')
      ctx.update({
        sessionUpdate: 'tool_call',
        toolCallId,
        title: `Edit ${path}`,
        kind: 'edit',
        status: 'in_progress',
        locations: [{ path, line: 1 }],
      })
      await pause(ctx, 500)
      ctx.update({
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: 'completed',
        content: [
          { type: 'diff', path, oldText: SAMPLE_OLD, newText: SAMPLE_NEW },
        ],
      })
      await say(ctx, 'Added types and a doc comment.')
    },
  },

  permission: {
    description:
      'Ask for permission before an edit; outcome drives the tool call',
    hint: '[path]',
    run: async (ctx) => {
      const path = ctx.args[0] ?? `${ctx.cwd}/example.ts`
      const toolCallId = nextId('tool')
      const toolCall = {
        toolCallId,
        title: `Edit ${path}`,
        kind: 'edit',
        status: 'pending',
        locations: [{ path }],
        content: [
          { type: 'diff', path, oldText: SAMPLE_OLD, newText: SAMPLE_NEW },
        ],
      }
      ctx.update({ sessionUpdate: 'tool_call', ...toolCall })

      const response = await ctx.request('session/request_permission', {
        sessionId: ctx.sessionId,
        toolCall,
        options: [
          { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          {
            optionId: 'allow-always',
            name: 'Always allow',
            kind: 'allow_always',
          },
          { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
          {
            optionId: 'reject-always',
            name: 'Always reject',
            kind: 'reject_always',
          },
        ],
      })

      const outcome = response?.outcome
      if (outcome?.outcome === 'cancelled') {
        return { stopReason: 'cancelled' }
      }
      const allowed = String(outcome?.optionId ?? '').startsWith('allow')
      ctx.update({
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: allowed ? 'completed' : 'failed',
      })
      await say(
        ctx,
        `Permission outcome: \`${outcome?.optionId}\` — ${allowed ? 'edit applied' : 'edit skipped'}.`,
      )
    },
  },

  read_file: {
    description: 'Ask the client to read a file (fs/read_text_file)',
    hint: '<path> [line] [limit]',
    run: async (ctx) => {
      const path = ctx.args[0] ?? 'README.md'
      const line = ctx.args[1] ? Number(ctx.args[1]) : undefined
      const limit = ctx.args[2] ? Number(ctx.args[2]) : undefined
      const { content } = await ctx.request('fs/read_text_file', {
        sessionId: ctx.sessionId,
        path,
        ...(line ? { line } : {}),
        ...(limit ? { limit } : {}),
      })
      await say(ctx, `Read \`${path}\`:\n\n\`\`\`\n${content}\n\`\`\`\n`)
    },
  },

  write_file: {
    description: 'Ask the client to write a file (fs/write_text_file)',
    hint: '[path]',
    run: async (ctx) => {
      const path = ctx.args[0] ?? '.agentic/echo-stub.txt'
      await ctx.request('fs/write_text_file', {
        sessionId: ctx.sessionId,
        path,
        content: `Written by the echo stub at ${new Date().toISOString()}\n`,
      })
      await say(ctx, `Wrote \`${path}\`.`)
    },
  },

  touch: {
    description:
      'Write a workspace file directly, bypassing fs/write_text_file (like agents that edit on their own)',
    hint: '<path> [text...]',
    run: async (ctx) => {
      const path = ctx.args[0] ?? 'echo-touched.txt'
      const text =
        ctx.args.length > 1
          ? `${ctx.args.slice(1).join(' ')}\n`
          : `Touched by the echo stub at ${new Date().toISOString()}\n`
      const toolCallId = nextId('tool')
      ctx.update({
        sessionUpdate: 'tool_call',
        toolCallId,
        title: `Write ${path}`,
        kind: 'edit',
        status: 'in_progress',
        locations: [{ path }],
        rawInput: { path },
      })
      await Bun.write(path.startsWith('/') ? path : `${ctx.cwd}/${path}`, text)
      ctx.update({
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: 'completed',
      })
      await say(ctx, `Wrote \`${path}\` directly.`)
    },
  },

  terminal: {
    description: 'Run a command in a client terminal, embedded in a tool call',
    hint: '[command...]',
    run: async (ctx) => {
      const [command, args] = ctx.args.length
        ? [ctx.args.join(' '), []]
        : ['echo', ['hello from the echo agent']]
      const { terminalId } = await ctx.request('terminal/create', {
        sessionId: ctx.sessionId,
        command,
        args,
        cwd: ctx.cwd,
      })
      const toolCallId = nextId('tool')
      ctx.update({
        sessionUpdate: 'tool_call',
        toolCallId,
        title: `Run ${command}`,
        kind: 'execute',
        status: 'in_progress',
        content: [{ type: 'terminal', terminalId }],
        rawInput: { command, args },
      })
      const exit = await ctx.request('terminal/wait_for_exit', {
        sessionId: ctx.sessionId,
        terminalId,
      })
      const { output } = await ctx.request('terminal/output', {
        sessionId: ctx.sessionId,
        terminalId,
      })
      await ctx.request('terminal/release', {
        sessionId: ctx.sessionId,
        terminalId,
      })
      ctx.update({
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: exit?.exitCode === 0 ? 'completed' : 'failed',
        rawOutput: { ...exit, output },
      })
      await say(ctx, `Command exited with \`${exit?.exitCode}\`.`)
    },
  },

  elicitation: {
    description: 'Ask for structured input (form elicitation)',
    run: async (ctx) => {
      const response = await ctx.request('elicitation/create', {
        mode: 'form',
        sessionId: ctx.sessionId,
        message: 'Tell me a bit about the project.',
        requestedSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', title: 'Project name' },
            stars: {
              type: 'integer',
              title: 'Stars',
              description: 'GitHub stars',
            },
            public: { type: 'boolean', title: 'Public?' },
            tags: {
              type: 'array',
              title: 'Tags',
              items: { type: 'string', enum: ['lua', 'neovim', 'acp'] },
            },
          },
          required: ['name'],
        },
      })
      await say(
        ctx,
        `Elicitation \`${response?.action}\`:\n\n\`\`\`json\n${JSON.stringify(response?.content ?? null, null, 2)}\n\`\`\`\n`,
      )
    },
  },

  elicitation_url: {
    description: 'Ask the user to visit a URL (URL elicitation)',
    run: async (ctx) => {
      const elicitationId = nextId('elicit')
      const response = await ctx.request('elicitation/create', {
        mode: 'url',
        sessionId: ctx.sessionId,
        elicitationId,
        url: 'https://agentclientprotocol.com/protocol/elicitation',
        message: 'Please sign in to continue.',
      })
      if (response?.action === 'accept') {
        ctx.notify('elicitation/complete', { elicitationId })
      }
      await say(ctx, `URL elicitation \`${response?.action}\`.`)
    },
  },

  plan: {
    description: 'Send a plan and progress its entries',
    run: async (ctx) => {
      const entries = [
        {
          content: 'Read the relevant files',
          priority: 'high',
          status: 'pending',
        },
        { content: 'Write the change', priority: 'high', status: 'pending' },
        { content: 'Run the tests', priority: 'medium', status: 'pending' },
        { content: 'Update the docs', priority: 'low', status: 'pending' },
      ]
      const send = () =>
        ctx.update({
          sessionUpdate: 'plan',
          entries: entries.map((e) => ({ ...e })),
        })
      send()
      for (const entry of entries) {
        await pause(ctx, 600)
        entry.status = 'in_progress'
        send()
        await pause(ctx, 600)
        entry.status = 'completed'
        send()
      }
      await say(ctx, 'Plan complete.')
    },
  },

  plan_update: {
    description: 'Send plan_update (items, then markdown), then plan_removed',
    run: async (ctx) => {
      const planId = nextId('plan')
      ctx.update({
        sessionUpdate: 'plan_update',
        plan: {
          type: 'items',
          planId,
          entries: [
            { content: 'Investigate', priority: 'high', status: 'completed' },
            { content: 'Implement', priority: 'high', status: 'in_progress' },
          ],
        },
      })
      await pause(ctx, 1000)
      ctx.update({
        sessionUpdate: 'plan_update',
        plan: {
          type: 'markdown',
          planId,
          content: '## Plan\n\n- [x] Investigate\n- [x] Implement\n- [ ] Ship',
        },
      })
      await pause(ctx, 1000)
      ctx.update({ sessionUpdate: 'plan_removed', planId })
      await say(ctx, 'Plan updated, then removed.')
    },
  },

  usage: {
    description: 'Send growing context usage (usage_update)',
    run: async (ctx) => {
      const size = 200_000
      for (const used of [12_000, 48_000, 110_000, 185_000]) {
        ctx.update({
          sessionUpdate: 'usage_update',
          used,
          size,
          cost: { amount: used / 1_000_000, currency: 'USD' },
        })
        await pause(ctx, 500)
      }
      await say(ctx, 'Context is nearly full.')
    },
  },

  compaction: {
    description: 'Simulate a context compaction with a streamed summary',
    hint: '[fail]',
    run: async (ctx) => {
      const compactionId = nextId('compaction')
      ctx.update({
        sessionUpdate: 'compaction_update',
        compactionId,
        status: 'in_progress',
      })
      for (const text of [
        'Summary: ',
        'the user asked for stubs; ',
        'we built them.',
      ]) {
        await pause(ctx, 400)
        ctx.update({
          sessionUpdate: 'compaction_summary_chunk',
          compactionId,
          content: { type: 'text', text },
        })
      }
      await pause(ctx, 400)
      ctx.update(
        ctx.args[0] === 'fail'
          ? {
              sessionUpdate: 'compaction_update',
              compactionId,
              status: 'failed',
              error: 'Out of budget',
            }
          : {
              sessionUpdate: 'compaction_update',
              compactionId,
              status: 'completed',
            },
      )
    },
  },

  title: {
    description: 'Rename the session (session_info_update)',
    hint: '[title...]',
    run: async (ctx) => {
      const title =
        ctx.args.join(' ') || `Echo stub ${new Date().toLocaleTimeString()}`
      ctx.update({
        sessionUpdate: 'session_info_update',
        title,
        updatedAt: new Date().toISOString(),
      })
      await say(ctx, `Renamed the session to "${title}".`)
    },
  },

  mode: {
    description: 'Switch the mode from the agent side (current_mode_update)',
    hint: '[modeId]',
    run: async (ctx) => {
      const currentModeId = ctx.args[0] ?? 'mode2'
      ctx.update({ sessionUpdate: 'current_mode_update', currentModeId })
      await say(ctx, `Switched mode to \`${currentModeId}\`.`)
    },
  },

  config: {
    description: 'Change the model from the agent side (config_option_update)',
    run: async (ctx) => {
      ctx.update({
        sessionUpdate: 'config_option_update',
        configOptions: toggledConfigOptions(),
      })
      await say(ctx, 'Switched the model to `model2`.')
    },
  },

  stop: {
    description: 'End the turn with a given stop reason',
    hint: '<end_turn|max_tokens|max_turn_requests|refusal|cancelled>',
    run: async (ctx) => {
      const stopReason = ctx.args[0] ?? 'max_tokens'
      await say(ctx, `Stopping with \`${stopReason}\`.`)
      return { stopReason }
    },
  },

  error: {
    description: 'Fail the prompt with a JSON-RPC error',
    hint: '[message...]',
    run: async (ctx) => {
      await say(ctx, 'Something is about to go wrong…')
      throw new ScenarioError(
        ctx.args.join(' ') || 'Echo stub: simulated agent error',
      )
    },
  },

  tour: {
    description: 'Run every non-interactive scenario in sequence',
    run: async (ctx) => {
      for (const name of [
        'thought',
        'markdown',
        'plan',
        'tool_call',
        'tools',
        'diff',
        'tool_failed',
        'usage',
        'compaction',
        'title',
      ]) {
        await SCENARIOS[name]!.run({ ...ctx, args: [] })
      }
    },
  },
}

/** An `available_commands_update` listing every scenario. */
export function availableCommandsUpdate() {
  return {
    sessionUpdate: 'available_commands_update',
    availableCommands: Object.entries(SCENARIOS).map(([name, s]) => ({
      name,
      description: s.description,
      ...(s.hint ? { input: { hint: s.hint } } : {}),
    })),
  }
}

/**
 * Finds a `/<scenario> args...` command in the prompt's text blocks. Only
 * known scenario names match, so other slash text is echoed as usual.
 */
export function parseScenario(
  texts: string[],
): { name: string; scenario: Scenario; args: string[] } | null {
  for (const text of texts) {
    const match = text.trim().match(/^\/(\w+)(?:\s+(.*))?$/s)
    if (!match) continue
    const scenario = SCENARIOS[match[1]!]
    if (!scenario) continue
    const args = (match[2] ?? '').trim().split(/\s+/).filter(Boolean)
    return { name: match[1]!, scenario, args }
  }
  return null
}
