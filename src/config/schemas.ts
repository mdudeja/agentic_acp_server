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
  }),
  gitignore: Type.Boolean({
    default: true,
    description: 'Whether .agentic/ should be added to .gitignore',
  }),
})

export type McpServerConfig = Static<typeof McpServerConfigSchema>
export type IndexerConfig = Static<typeof IndexerConfigSchema>
export type AgenticConfig = Static<typeof AgenticConfigSchema>
