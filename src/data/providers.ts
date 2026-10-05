export const PROVIDERS = {
  copilot: {
    name: 'Copilot',
    command: 'copilot',
    args: ['--acp'],
  },
  opencode: {
    name: 'OpenCode',
    command: 'opencode',
    args: ['acp'],
  },
  gemini: {
    name: 'Gemini',
    command: 'gemini',
    args: ['--acp'],
  },
  codex: {
    name: 'Codex',
    command: 'codex-acp',
    args: [],
  },
  claude: {
    name: 'Claude',
    command: 'claude-agent-acp',
    args: [],
  },
  echo: {
    name: 'Echo',
    command: 'bun',
    args: ['run', 'tests/fixtures/echo-provider.ts'],
  },
}

export enum Providers {
  copilot = 'copilot',
  opencode = 'opencode',
  gemini = 'gemini',
  codex = 'codex',
  claude = 'claude',
  echo = 'echo',
}

// ---------------------------------------------------------------------------
// CLI command mappings
// ---------------------------------------------------------------------------

export interface ProviderCLICommands {
  deleteSession: string[]
  exportSession: string[]
  importSession: string[]
  listSessions: string[]
  stats: string[]
  init: string[]
}

export interface ProviderCLIConfig {
  /** Whether CLI operations are implemented for this provider. */
  available: boolean
  commands: ProviderCLICommands
}

export const PROVIDER_CLI: Record<Providers, ProviderCLIConfig> = {
  [Providers.copilot]: {
    available: false,
    commands: {
      deleteSession: ['/session', 'delete', '$1'],
      exportSession: [],
      importSession: [],
      listSessions: [],
      stats: [],
      init: ['init'],
    },
  },
  [Providers.echo]: {
    available: true,
    commands: {
      deleteSession: [],
      exportSession: [],
      importSession: [],
      listSessions: [],
      stats: [],
      init: [],
    },
  },
  [Providers.opencode]: {
    available: true,
    commands: {
      deleteSession: ['session', 'delete', '$1'],
      exportSession: ['export', '$1', '2>&1', '|', 'tee', '$2'],
      importSession: ['import', '$1'],
      listSessions: ['session', 'list', '--format', '$1'],
      stats: ['stats', '--models', '--days', '$1', '--project', ''],
      init: ['run', '--command', '/init'],
    },
  },
  [Providers.gemini]: {
    available: false,
    commands: {
      deleteSession: ['--delete-session', '$1'],
      exportSession: [],
      importSession: [],
      listSessions: ['--list-sessions'],
      stats: ['/stats'],
      init: ['/init'],
    },
  },
  [Providers.codex]: {
    available: false,
    commands: {
      deleteSession: ['cli', 'delete', '$1'],
      exportSession: [],
      importSession: [],
      listSessions: [],
      stats: ['cli', '/usage'],
      init: ['cli', '/init'],
    },
  },
  [Providers.claude]: {
    available: false,
    commands: {
      deleteSession: ['--cli', 'rm', '$1'],
      exportSession: [],
      importSession: [],
      listSessions: [],
      stats: [],
      init: ['--cli', '/init'],
    },
  },
} as const
