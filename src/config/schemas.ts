import { Type } from 'typebox'
import type { Static } from 'typebox/type'

const LanguageConfigSchema = Type.Object({
  extensions: Type.Array(Type.String()),
  treesitter: Type.Optional(
    Type.Object({
      parser: Type.String({ description: 'Path to .so parser file' }),
    }),
  ),
})

export const AgenticConfigSchema = Type.Object({
  indexer: Type.Object({
    enabled: Type.Boolean({ default: false }),
    languages: Type.Record(Type.String(), LanguageConfigSchema),
  }),
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

export type LanguageConfig = Static<typeof LanguageConfigSchema>
export type AgenticConfig = Static<typeof AgenticConfigSchema>
