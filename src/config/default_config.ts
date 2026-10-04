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
  hooks: {
    projectInit: { enabled: true, runProviderInit: true },
    sessionCleanup: { enabled: false },
  },
  sessions: {
    memoryPath: '.agentic/sessions/',
  },
  addToGitignore: true,
  addToNpmignore: false,
  addToDockerignore: false,
  nes: {
    enabled: true,
  },
}
