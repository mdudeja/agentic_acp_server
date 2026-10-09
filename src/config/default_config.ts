import type { AgenticConfig } from './schemas'

export const DEFAULT_CONFIG: AgenticConfig = {
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
