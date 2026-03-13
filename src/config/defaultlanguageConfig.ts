import { DocstringStrategy, SymbolKind, type LanguageConfig } from './schemas'

export const DEFAULT_LANGUAGE_CONFIG: Record<string, LanguageConfig> = {
  typescript: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    treesitter: {
      language_name: 'typescript',
      nodes_info: {
        function_declaration: {
          kind: [SymbolKind.function],
          name_field: 'name',
          parameters_field: 'parameters',
          return_type_field: 'return_type',
          docstring: DocstringStrategy.comment_before,
        },
        method_definition: {
          kind: [SymbolKind.method],
          name_field: 'name',
          parameters_field: 'parameters',
          return_type_field: 'return_type',
          docstring: DocstringStrategy.comment_before,
        },
        class_declaration: {
          kind: [SymbolKind.class],
          name_field: 'name',
          docstring: DocstringStrategy.comment_before,
        },
        public_field_definition: {
          kind: [SymbolKind.property],
          name_field: 'name',
          docstring: DocstringStrategy.comment_before,
        },
        variable_declaration: {
          kind: [SymbolKind.var],
          name_field: 'name',
        },
        lexical_declaration: {
          kind: [SymbolKind.let, SymbolKind.const],
          name_field: 'name',
        },
        interface_declaration: {
          kind: [SymbolKind.interface],
          name_field: 'name',
          docstring: DocstringStrategy.comment_before,
        },
        type_alias_declaration: {
          kind: [SymbolKind.type],
          name_field: 'name',
          docstring: DocstringStrategy.comment_before,
        },
        enum_declaration: {
          kind: [SymbolKind.enum],
          name_field: 'name',
          docstring: DocstringStrategy.comment_before,
        },
        decorator: {
          kind: [SymbolKind.decorator],
        },
        internal_module: {
          kind: [SymbolKind.namespace],
          name_field: 'name',
          docstring: DocstringStrategy.comment_before,
        },
        module: {
          kind: [SymbolKind.module],
          name_field: 'name',
          docstring: DocstringStrategy.comment_before,
        },
        arrow_function: {
          kind: [SymbolKind.arrowFunction],
          parameters_field: 'parameters',
          return_type_field: 'return_type',
          docstring: DocstringStrategy.comment_before,
        },
      },
      container_nodes: [
        'class_declaration',
        'module',
        'class',
        'internal_module',
      ],
      typedef_nodes: [
        'type_alias_declaration',
        'interface_declaration',
        'enum_declaration',
      ],
      decorator_nodes: ['decorator'],
    },
  },
  //   python: { extensions: ['.py'] },
  //   lua: { extensions: ['.lua'] },
  //   go: { extensions: ['.go'] },
}
