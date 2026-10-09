import { mock } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_CONFIG } from 'src/config/default_config'
import type { AgenticConfig, HooksConfig } from 'src/config/schemas'
import type { HookHost } from 'src/hooks/types'
import { Providers } from 'src/data/providers'

/** Default config with every built-in hook turned off. */
export function configWithoutBuiltins(
  hooks: Partial<HooksConfig> = {},
): AgenticConfig {
  const config = structuredClone(DEFAULT_CONFIG)
  for (const options of Object.values(config.hooks.builtin)) {
    options.enabled = false
  }
  config.hooks = { ...config.hooks, ...hooks }
  return config
}

/** A fake `HookHost` over a temp workspace, with spies for its actions. */
export function makeHookHost(
  options: {
    config?: AgenticConfig
    workspaceRoot?: string
    provider?: Providers | null
    answer?: string | ((question: string) => string)
  } = {},
) {
  const workspaceRoot =
    options.workspaceRoot ?? mkdtempSync(join(tmpdir(), 'hooks-ws-'))
  const config = options.config ?? configWithoutBuiltins()
  const answer = options.answer ?? 'deny'

  const host = {
    workspaceRoot: () => workspaceRoot,
    config: () => config,
    provider: () => options.provider ?? Providers.echo,
    activeSession: () => null,
    notify: mock((_level: string, _message: string) => {}),
    ask: mock(async (question: string) =>
      typeof answer === 'function' ? answer(question) : answer,
    ),
    cancelTurn: mock(async (_sessionId?: string) => {}),
  } satisfies HookHost

  return { host, config, workspaceRoot }
}
