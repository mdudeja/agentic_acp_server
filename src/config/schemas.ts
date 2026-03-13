import { Type } from 'typebox'
import type { Static } from 'typebox/type'

export enum SymbolKind {
  function = 'function',
  class = 'class',
  interface = 'interface',
  type = 'type',
  var = 'var',
  const = 'const',
  let = 'let',
  method = 'method',
  property = 'property',
  enum = 'enum',
  namespace = 'namespace',
  module = 'module',
  arrowFunction = 'arrowFunction',
  decorator = 'decorator',
}

export enum DocstringStrategy {
  none = 'none',
  comment_before = 'comment_before',
  comment_after = 'comment_after',
}

const NodesInfoSchema = Type.Object({
  kind: Type.Array(
    Type.Enum(SymbolKind, {
      description: 'The kind of symbol this node represents',
    }),
  ),
  name_field: Type.Optional(
    Type.String({ description: 'The name field of the symbol' }),
  ),
  parameters_field: Type.Optional(
    Type.String({ description: 'The parameters field of the symbol' }),
  ),
  return_type_field: Type.Optional(
    Type.String({ description: 'The return type field of the symbol' }),
  ),
  docstring: Type.Optional(
    Type.Enum(DocstringStrategy, {
      description:
        'The strategy to extract docstrings for this symbol, e.g. none, comment_before, comment_after',
    }),
  ),
})

const LanguageConfigSchema = Type.Object({
  extensions: Type.Array(Type.String()),
  treesitter: Type.Object({
    parser: Type.Optional(
      Type.String({ description: 'Path to .so parser file' }),
    ),
    language_name: Type.String({
      description:
        'Tree-sitter language name, e.g. "python", "javascript", etc.',
    }),
    nodes_info: Type.Record(Type.String(), NodesInfoSchema, {
      description:
        'A record of symbol types and their corresponding fields to extract',
    }),
    container_nodes: Type.Array(Type.String(), {
      description:
        'A list of node types that can contain other symbols, e.g. class, function, etc.',
    }),
    typedef_nodes: Type.Array(Type.String(), {
      description:
        'A list of node types that define types, e.g. class, interface, type alias, etc.',
    }),
    decorator_nodes: Type.Array(Type.String(), {
      description:
        'A list of node types that define decorators, e.g. function decorators, class decorators, etc.',
    }),
  }),
})

export const IndexerConfigSchema = Type.Object({
  enabled: Type.Boolean({ default: false }),
  languages: Type.Record(Type.String(), LanguageConfigSchema),
})

export const AgenticConfigSchema = Type.Object({
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

export type NodesInfo = Static<typeof NodesInfoSchema>
export type IndexerConfig = Static<typeof IndexerConfigSchema>
export type LanguageConfig = Static<typeof LanguageConfigSchema>
export type AgenticConfig = Static<typeof AgenticConfigSchema>
