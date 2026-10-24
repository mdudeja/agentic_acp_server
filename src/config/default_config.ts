import type { AgenticConfig } from './schemas'

export const DEFAULT_CONFIG: AgenticConfig = {
  debugLogs: false,
  indexer: {
    enabled: true,
    commands: {
      index: 'agentic-indexer index',
    },
    mcpServerConfig: {
      'agentic-indexer': {
        command: 'agentic-indexer',
        args: ['serve'],
      },
    },
  },
  mcpServers: {},
  hooks: {
    enabled: true,
    paths: [],
    trustProjectHooks: 'prompt',
    defaultTimeoutMs: 5000,
    disabled: [],
    options: {},
    builtin: {
      projectInit: { enabled: true, runProviderInit: true },
      protectedPaths: {
        enabled: true,
        read: [
          '**/.env',
          '**/.env.*',
          '**/*.pem',
          '**/*.key',
          '**/id_rsa*',
          '**/id_ed25519*',
          '**/.ssh/**',
          '**/.aws/credentials',
          '**/.netrc',
        ],
        write: [
          '**/.env',
          '**/.env.*',
          '**/*.pem',
          '**/*.key',
          '**/id_rsa*',
          '**/id_ed25519*',
          '**/.ssh/**',
          '**/.aws/credentials',
          '**/.netrc',
          '**/.git/**',
        ],
      },
      commandPolicy: {
        enabled: true,
        allow: [],
        deny: [
          '\\brm\\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)[a-zA-Z]*\\s+(/|~|\\$HOME)(\\s|$)',
          '\\bgit\\s+push\\b.*(--force\\b|\\s-f\\b)',
          '\\bmkfs(\\.|\\s)',
          '\\bdd\\s+.*\\bof=/dev/',
          ':\\(\\)\\s*\\{\\s*:\\|:&\\s*\\};:',
        ],
      },
      formatOnWrite: { enabled: true, commands: {} },
      auditLog: { enabled: false, path: '.agentic/audit.jsonl' },
      notifyOnTurnEnd: { enabled: true, minDurationMs: 30000 },
      turnCheckpoint: { enabled: false, keep: 20 },
      contextInjection: {
        enabled: false,
        files: ['AGENTS.md'],
        gitStatus: true,
        firstPromptOnly: true,
      },
      usageBudget: { enabled: false },
      indexerFirst: {
        enabled: false,
        mode: 'gate',
        unlockOn: 'noResults',
        firstPromptOnly: false,
        // Indexer tool names as a whole word: after a start/space/`:`/`/`/
        // `_`/`-` (e.g. `mcp__agentic-indexer__read_code`) and before an
        // end/space/`(`/`:`, so file paths like `tools/read_code.ts` don't
        // match.
        toolPattern:
          '(?:^|[\\s:/_-])(?:search_codebase|read_code|inspect_symbol|inspect_imports|trace_code_graph|analyze_change_impact|explore_architecture|analyze_quality|audit_index)(?:$|[\\s(:])',
        rangeKeys: [
          'offset',
          'limit',
          'line',
          'startLine',
          'start_line',
          'endLine',
          'end_line',
          // Copilot's file view
          'view_range',
        ],
        // Copilot's grep/glob tools report `kind: 'read'`
        searchKeys: ['pattern', 'regex', 'glob'],
        searchCommands:
          '^(?:rg|grep|egrep|fgrep|ag|ack|find|fd|git\\s+grep)\\b',
        maxDenialsPerTurn: 2,
      },
      secretRedaction: { enabled: true, patterns: [] },
    },
  },
  sessions: {
    memoryPath: '.agentic/sessions/',
    summaryPath: '.agentic/sessions/summaries/',
  },
  sessionOps: {
    list: ['memory', 'acp', 'cli'],
    export: ['acp', 'cli'],
    import: ['acp', 'cli'],
    delete: ['acp', 'cli'],
  },
  addToGitignore: true,
  addToNpmignore: false,
  addToDockerignore: false,
  fs: {
    outsideWorkspaceWrites: 'ask',
  },
  nes: {
    enabled: true,
  },
}
