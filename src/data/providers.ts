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
