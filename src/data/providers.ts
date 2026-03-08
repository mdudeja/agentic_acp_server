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
    args: ['--experimental-acp'],
  },
} as const

export enum Providers {
  copilot = 'copilot',
  opencode = 'opencode',
  gemini = 'gemini',
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
      deleteSession: [],
      exportSession: [],
      importSession: [],
      listSessions: [],
      stats: [],
      init: [],
    },
  },
} as const
