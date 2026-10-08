import { Type } from 'typebox'
import type { Static } from 'typebox/type'

export const McpServerConfigSchema = Type.Object({
  command: Type.String(),
  args: Type.Array(Type.String()),
})

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

export const AgenticConfigSchema = Type.Object({
  mcpServers: Type.Optional(
    Type.Record(Type.String(), McpServerConfigSchema, {
      description: 'MCP Server Config for Indexer',
    }),
  ),
  indexer: IndexerConfigSchema,
  hooks: Type.Object({
    projectInit: Type.Object({
      enabled: Type.Boolean({ default: true }),
      runProviderInit: Type.Boolean({ default: true }),
    }),
    sessionCleanup: Type.Object({
      enabled: Type.Boolean({ default: false }),
    }),
  }),
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
  nes: Type.Object({
    enabled: Type.Boolean({
      default: false,
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
