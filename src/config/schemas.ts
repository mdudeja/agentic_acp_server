import { Type } from 'typebox'
import type { Static } from 'typebox/type'

/** A local MCP server started as a subprocess (the default `type`). */
export const McpStdioServerConfigSchema = Type.Object({
  type: Type.Optional(Type.Literal('stdio')),
  command: Type.String(),
  args: Type.Array(Type.String()),
  env: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description: 'Environment variables for the server process',
    }),
  ),
})

/**
 * A remote MCP server. Only sent to agents that advertise the matching
 * `mcpCapabilities.http` / `mcpCapabilities.sse`.
 */
export const McpRemoteServerConfigSchema = Type.Object({
  type: Type.Union([Type.Literal('http'), Type.Literal('sse')]),
  url: Type.String(),
  headers: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description: 'HTTP headers sent with every request',
    }),
  ),
})

export const McpServerConfigSchema = Type.Union([
  McpStdioServerConfigSchema,
  McpRemoteServerConfigSchema,
])

export const IndexerConfigSchema = Type.Object({
  enabled: Type.Boolean({ default: false }),
  commands: Type.Optional(Type.Record(Type.String(), Type.String())),
  mcpServerConfig: Type.Optional(
    Type.Record(Type.String(), McpServerConfigSchema, {
      description: 'MCP Server Config for Indexer',
    }),
  ),
})

/** A tier a session operation may be served from, in fallback order. */
export const SessionOpTierSchema = Type.Union([
  Type.Literal('memory'),
  Type.Literal('acp'),
  Type.Literal('cli'),
])

/** Session operations governed by the fallback tier policy. */
export const SessionOpSchema = Type.Union([
  Type.Literal('list'),
  Type.Literal('export'),
  Type.Literal('import'),
  Type.Literal('delete'),
])

/**
 * Ordered fallback tiers per session operation. The first tier that can serve
 * the operation wins; a tier is skipped only when it is *unavailable*
 * (capability absent / no ACP method / no provider CLI).
 */
export const SessionOpsConfigSchema = Type.Object({
  list: Type.Array(SessionOpTierSchema, {
    default: ['memory', 'acp', 'cli'],
    description: 'Fallback tiers for listing sessions',
  }),
  export: Type.Array(SessionOpTierSchema, {
    default: ['acp', 'cli'],
    description: 'Fallback tiers for exporting a session',
  }),
  import: Type.Array(SessionOpTierSchema, {
    default: ['acp', 'cli'],
    description: 'Fallback tiers for importing a session',
  }),
  delete: Type.Array(SessionOpTierSchema, {
    default: ['acp', 'cli'],
    description: 'Fallback tiers for deleting a session',
  }),
})

const BuiltinToggle = (enabled: boolean, description: string) =>
  Type.Boolean({ default: enabled, description })

/** Options for the built-in hooks (each can be turned off with `enabled`). */
export const BuiltinHooksConfigSchema = Type.Object({
  projectInit: Type.Object({
    enabled: BuiltinToggle(
      true,
      'Run project setup on the first agent connect',
    ),
    runProviderInit: Type.Boolean({
      default: true,
      description: "Run the provider CLI's init command (e.g. `/init`)",
    }),
  }),
  protectedPaths: Type.Object({
    enabled: BuiltinToggle(
      true,
      'Refuse agent reads/writes of protected files',
    ),
    read: Type.Array(Type.String(), {
      description: 'Globs the agent may not read through the client',
    }),
    write: Type.Array(Type.String(), {
      description: 'Globs the agent may not write through the client',
    }),
  }),
  commandPolicy: Type.Object({
    enabled: BuiltinToggle(true, 'Allow/deny commands by regex'),
    allow: Type.Array(Type.String(), {
      description:
        'Regexes for commands to run without asking (terminals and permission requests)',
    }),
    deny: Type.Array(Type.String(), {
      description: 'Regexes for commands that are always refused',
    }),
  }),
  formatOnWrite: Type.Object({
    enabled: BuiltinToggle(true, 'Format files after the agent writes them'),
    commands: Type.Record(Type.String(), Type.String(), {
      description:
        'Glob → shell command; `{file}` is replaced by the (quoted) file path',
    }),
  }),
  auditLog: Type.Object({
    enabled: BuiltinToggle(false, 'Append agent activity to a JSONL file'),
    path: Type.String({ description: 'Log file, relative to the workspace' }),
  }),
  notifyOnTurnEnd: Type.Object({
    enabled: BuiltinToggle(true, 'Notify when a long turn finishes'),
    minDurationMs: Type.Number({
      description: 'Only turns at least this long are announced',
    }),
    command: Type.Optional(
      Type.String({
        description:
          'Also run this shell command (e.g. `notify-send "Agent finished"`)',
      }),
    ),
  }),
  turnCheckpoint: Type.Object({
    enabled: BuiltinToggle(
      false,
      'Snapshot the working tree before each user turn, under refs/agentic/checkpoints (restore with `git stash apply <sha>`)',
    ),
    keep: Type.Number({
      default: 20,
      description: 'How many checkpoints to keep (older ones are pruned)',
    }),
  }),
  contextInjection: Type.Object({
    enabled: BuiltinToggle(false, 'Prepend project context to user prompts'),
    files: Type.Array(Type.String(), {
      description: 'Files (relative to the workspace) to include, if present',
    }),
    gitStatus: Type.Boolean({ description: 'Include branch and `git status`' }),
    firstPromptOnly: Type.Boolean({
      description: 'Only inject into the first prompt of each session',
    }),
  }),
  usageBudget: Type.Object({
    enabled: BuiltinToggle(false, 'Cancel turns that exceed a usage budget'),
    maxTokens: Type.Optional(
      Type.Number({ description: 'Context tokens used (usage_update.used)' }),
    ),
    maxCost: Type.Optional(
      Type.Number({ description: 'Session cost (usage_update.cost.amount)' }),
    ),
  }),
  indexerFirst: Type.Object({
    enabled: BuiltinToggle(
      false,
      'Make the agent explore through agentic-indexer before raw searches and whole-file reads',
    ),
    mode: Type.Union([Type.Literal('gate'), Type.Literal('warn')], {
      description:
        '`gate` refuses early searches/reads; `warn` only notifies (useful when trying a new provider)',
    }),
    unlockOn: Type.Union(
      [Type.Literal('noResults'), Type.Literal('indexerUsed')],
      {
        description:
          'What allows raw searches/whole-file reads in a turn: an indexer result marked `[no-results]`, or any indexer call',
      },
    ),
    firstPromptOnly: Type.Boolean({
      description:
        'Only add the exploration rule to the first prompt of each session',
    }),
    toolPattern: Type.String({
      description:
        'Regex matched against tool-call titles to recognise agentic-indexer tools',
    }),
    rangeKeys: Type.Array(Type.String(), {
      description:
        '`rawInput` keys holding a number or number list that make a read permission request a ranged (always allowed) read',
    }),
    searchKeys: Type.Array(Type.String(), {
      description:
        '`rawInput` string keys that make a `read`-kind permission request a search (e.g. a grep `pattern`)',
    }),
    searchCommands: Type.String({
      description: 'Regex for shell commands that count as raw code searches',
    }),
    maxDenialsPerTurn: Type.Number({
      description:
        'After this many refusals in one turn, allow the rest of it (so an agent cannot get stuck)',
    }),
  }),
  secretRedaction: Type.Object({
    enabled: BuiltinToggle(true, 'Redact secrets from user prompts'),
    patterns: Type.Array(Type.String(), {
      description: 'Extra regexes to redact, on top of the built-in ones',
    }),
  }),
})

export const HooksConfigSchema = Type.Object({
  enabled: Type.Boolean({ default: true, description: 'Run hooks at all' }),
  paths: Type.Array(Type.String(), {
    description:
      'Extra hook files or directories (relative to the workspace or absolute)',
  }),
  trustProjectHooks: Type.Union(
    [Type.Literal('prompt'), Type.Literal('never')],
    {
      default: 'prompt',
      description:
        'Hook files inside the workspace: ask before running them, or never run them. ' +
        'Always trusting them is only possible via ACP_TRUST_PROJECT_HOOKS=always, ' +
        'since this file may come from the repository.',
    },
  ),
  defaultTimeoutMs: Type.Number({
    default: 5000,
    description: 'Per-hook timeout unless the hook sets its own',
  }),
  disabled: Type.Array(Type.String(), {
    description: 'Hook names (or `group` of `group:part` names) to skip',
  }),
  options: Type.Record(
    Type.String(),
    Type.Record(Type.String(), Type.Unknown()),
    {
      description:
        'Per-hook options for user hooks, by hook name (`ctx.options`)',
    },
  ),
  builtin: BuiltinHooksConfigSchema,
})

export const AgenticConfigSchema = Type.Object({
  mcpServers: Type.Optional(
    Type.Record(Type.String(), McpServerConfigSchema, {
      description: 'MCP Server Config for Indexer',
    }),
  ),
  indexer: IndexerConfigSchema,
  hooks: HooksConfigSchema,
  sessions: Type.Object({
    memoryPath: Type.String({
      default: '.agentic/sessions/',
      description: 'Path to store exported sessions',
    }),
    summaryPath: Type.String({
      default: '.agentic/sessions/summaries/',
      description: 'Path to store generated session summaries',
    }),
  }),
  sessionOps: SessionOpsConfigSchema,
  addToGitignore: Type.Boolean({
    default: true,
    description: 'Whether .agentic/ should be added to .gitignore',
  }),
  addToNpmignore: Type.Boolean({
    default: false,
    description: 'Whether .agentic/ should be added to .npmignore',
  }),
  addToDockerignore: Type.Boolean({
    default: false,
    description: 'Whether .agentic/ should be added to .dockerignore',
  }),
  fs: Type.Object({
    outsideWorkspaceWrites: Type.Union(
      [Type.Literal('ask'), Type.Literal('allow'), Type.Literal('deny')],
      {
        default: 'ask',
        description:
          "Agent writes outside the agent's working directory: ask the user, allow, or deny",
      },
    ),
  }),
  nes: Type.Object({
    enabled: Type.Boolean({
      default: true,
      description: 'Whether Next Edit Suggestion (NES) should be enabled',
    }),
  }),
})

export type McpServerConfig = Static<typeof McpServerConfigSchema>
export type IndexerConfig = Static<typeof IndexerConfigSchema>
export type SessionOpTier = Static<typeof SessionOpTierSchema>
export type SessionOp = Static<typeof SessionOpSchema>
export type SessionOpsConfig = Static<typeof SessionOpsConfigSchema>
export type AgenticConfig = Static<typeof AgenticConfigSchema>
export type HooksConfig = Static<typeof HooksConfigSchema>
export type BuiltinHooksConfig = Static<typeof BuiltinHooksConfigSchema>
