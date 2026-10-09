import { describe, expect, it, mock } from 'bun:test'
import { HookManager } from 'src/hooks/HookManager'
import { Providers } from 'src/data/providers'
import { defineHook } from 'src/hooks/public'
import { MemoryTrustStore } from 'src/hooks/trust'
import type { AnyHookDefinition } from 'src/hooks/types'
import { configWithoutBuiltins, makeHookHost } from 'tests/helpers/hooks'

function makeManager(options: Parameters<typeof makeHookHost>[0] = {}) {
  const { host, config, workspaceRoot } = makeHookHost(options)
  const manager = new HookManager(host, {
    trustStore: new MemoryTrustStore(),
    globalDir: '/nonexistent',
  })
  return { manager, host, config, workspaceRoot }
}

const write = (content = 'x') => ({
  acpSessionId: 'acp1',
  path: '/ws/file.txt',
  content,
})

describe('HookManager', () => {
  describe('sequential events', () => {
    it('runs hooks by priority, then registration order', async () => {
      const { manager } = makeManager()
      const order: string[] = []
      const hook = (name: string, priority?: number): AnyHookDefinition =>
        defineHook({
          name,
          event: 'fs.beforeWrite',
          priority,
          handler: () => {
            order.push(name)
          },
        })

      manager.register(hook('late', 200), 'config')
      manager.register(hook('first-default'), 'config')
      manager.register(hook('early', 1), 'config')
      manager.register(hook('second-default'), 'config')

      await manager.run('fs.beforeWrite', write())

      expect(order).toEqual([
        'early',
        'first-default',
        'second-default',
        'late',
      ])
    })

    it('chains transforms: each hook sees the previous result', async () => {
      const { manager } = makeManager()
      manager.register(
        defineHook({
          name: 'a',
          event: 'fs.beforeWrite',
          handler: (input) => ({ content: `${input.content}a` }),
        }),
        'config',
      )
      manager.register(
        defineHook({
          name: 'b',
          event: 'fs.beforeWrite',
          handler: (input) => ({ content: `${input.content}b` }),
        }),
        'config',
      )

      const outcome = await manager.run('fs.beforeWrite', write('x'))

      expect(outcome.input.content).toBe('xab')
      expect(outcome.decision).toBeUndefined()
    })

    it('stops at the first decision and reports who decided', async () => {
      const { manager } = makeManager()
      const later = mock(() => {})
      const decided = mock(() => {})
      manager.on('hook.decided', decided)

      manager.register(
        defineHook({
          name: 'guard',
          event: 'fs.beforeWrite',
          handler: () => ({ decision: 'deny', reason: 'protected' }),
        }),
        'config',
      )
      manager.register(
        defineHook({ name: 'later', event: 'fs.beforeWrite', handler: later }),
        'config',
      )

      const outcome = await manager.run('fs.beforeWrite', write())

      expect(outcome).toMatchObject({
        decision: 'deny',
        reason: 'protected',
        decidedBy: 'guard',
      })
      expect(later).not.toHaveBeenCalled()
      expect(decided).toHaveBeenCalledWith({
        hook: 'guard',
        event: 'fs.beforeWrite',
        decision: 'deny',
        reason: 'protected',
      })
    })

    it('resolves `ask` by asking the user', async () => {
      const ask = defineHook({
        name: 'confirm',
        event: 'fs.beforeWrite',
        handler: () => ({ decision: 'ask', reason: 'big change' }),
      })

      const allowing = makeManager({ answer: 'allow' })
      allowing.manager.register(ask, 'config')
      expect(
        (await allowing.manager.run('fs.beforeWrite', write())).decision,
      ).toBe('allow')
      expect(allowing.host.ask.mock.calls[0]?.[0]).toContain('big change')

      const denying = makeManager({ answer: 'deny' })
      denying.manager.register(ask, 'config')
      expect(
        (await denying.manager.run('fs.beforeWrite', write())).decision,
      ).toBe('deny')
    })

    it('gives each hook its own copy of the input', async () => {
      const { manager } = makeManager()
      manager.register(
        defineHook({
          name: 'mutator',
          event: 'fs.beforeWrite',
          handler: (input) => {
            input.content = 'mutated'
          },
        }),
        'config',
      )

      const outcome = await manager.run('fs.beforeWrite', write('original'))

      expect(outcome.input.content).toBe('original')
    })

    it('ignores (and reports) an invalid result', async () => {
      const { manager } = makeManager()
      const errors = mock(() => {})
      manager.on('hook.error', errors)
      manager.register(
        {
          name: 'bad',
          event: 'fs.beforeWrite',
          handler: () => ({ decision: 'maybe' }),
        } as unknown as AnyHookDefinition,
        'config',
      )
      manager.register(
        defineHook({
          name: 'good',
          event: 'fs.beforeWrite',
          handler: () => ({ content: 'ok' }),
        }),
        'config',
      )

      const outcome = await manager.run('fs.beforeWrite', write())

      expect(outcome.decision).toBeUndefined()
      expect(outcome.input.content).toBe('ok')
      expect(errors).toHaveBeenCalledTimes(1)
    })
  })

  describe('failures', () => {
    it('a failing guard denies by default', async () => {
      const { manager } = makeManager()
      manager.register(
        defineHook({
          name: 'broken',
          event: 'fs.beforeWrite',
          handler: () => {
            throw new Error('boom')
          },
        }),
        'config',
      )

      const outcome = await manager.run('fs.beforeWrite', write())

      expect(outcome.decision).toBe('deny')
      expect(outcome.reason).toContain('boom')
    })

    it('onError: ignore lets the chain continue', async () => {
      const { manager } = makeManager()
      manager.register(
        defineHook({
          name: 'broken',
          event: 'fs.beforeWrite',
          onError: 'ignore',
          handler: () => {
            throw new Error('boom')
          },
        }),
        'config',
      )

      expect(
        (await manager.run('fs.beforeWrite', write())).decision,
      ).toBeUndefined()
    })

    it('times out slow hooks and aborts their signal', async () => {
      const { manager } = makeManager()
      let signal: AbortSignal | undefined
      manager.register(
        defineHook({
          name: 'slow',
          event: 'agent.beforeSpawn',
          timeoutMs: 20,
          handler: async (_input, ctx) => {
            signal = ctx.signal
            await Bun.sleep(200)
            return { command: 'never' }
          },
        }),
        'config',
      )

      const outcome = await manager.run('agent.beforeSpawn', {
        provider: 'echo',
        cwd: '/ws',
        command: 'agent',
        args: [],
        env: {},
      })

      // agent.beforeSpawn ignores failures by default.
      expect(outcome.decision).toBeUndefined()
      expect(outcome.input.command).toBe('agent')
      expect(signal?.aborted).toBe(true)
    })

    it('an observe hook failing does not affect the others', async () => {
      const { manager } = makeManager()
      const ok = mock(() => {})
      manager.register(
        defineHook({
          name: 'broken',
          event: 'server.start',
          handler: () => {
            throw new Error('boom')
          },
        }),
        'config',
      )
      manager.register(
        defineHook({ name: 'ok', event: 'server.start', handler: ok }),
        'config',
      )

      await manager.run('server.start', { workspaceRoot: '/ws' })

      expect(ok).toHaveBeenCalledTimes(1)
    })
  })

  describe('matching and enabling', () => {
    it('applies matchers', async () => {
      const { manager, workspaceRoot } = makeManager({
        provider: Providers.opencode,
      })
      const seen: string[] = []
      const record = (name: string) => () => {
        seen.push(name)
      }

      manager.register(
        defineHook({
          name: 'env-files',
          event: 'fs.beforeWrite',
          match: { path: '**/.env*' },
          handler: record('env-files'),
        }),
        'config',
      )
      manager.register(
        defineHook({
          name: 'src-ts',
          event: 'fs.beforeWrite',
          match: { path: 'src/**/*.ts' },
          handler: record('src-ts'),
        }),
        'config',
      )
      manager.register(
        defineHook({
          name: 'other-provider',
          event: 'fs.beforeWrite',
          match: { provider: Providers.copilot },
          handler: record('other-provider'),
        }),
        'config',
      )

      await manager.run('fs.beforeWrite', {
        acpSessionId: 'a',
        path: `${workspaceRoot}/.env.local`,
        content: '',
      })
      await manager.run('fs.beforeWrite', {
        acpSessionId: 'a',
        path: `${workspaceRoot}/src/app/main.ts`,
        content: '',
      })

      expect(seen).toEqual(['env-files', 'src-ts'])
    })

    it('matches commands, update types and prompt origins', async () => {
      const { manager } = makeManager()
      const seen: string[] = []

      manager.register(
        defineHook({
          name: 'git',
          event: 'terminal.beforeCreate',
          match: { command: '^git ' },
          handler: () => {
            seen.push('git')
          },
        }),
        'config',
      )
      manager.register(
        defineHook({
          name: 'tools',
          event: 'session.update',
          match: { updateType: 'tool_call' },
          handler: () => {
            seen.push('tools')
          },
        }),
        'config',
      )
      manager.register(
        defineHook({
          name: 'user-only',
          event: 'prompt.before',
          match: { origin: 'user' },
          handler: () => {
            seen.push('user-only')
          },
        }),
        'config',
      )

      await manager.run('terminal.beforeCreate', {
        acpSessionId: 'a',
        command: 'git',
        args: ['status'],
      })
      await manager.run('terminal.beforeCreate', {
        acpSessionId: 'a',
        command: 'ls',
        args: [],
      })
      await manager.run('session.update', {
        acpSessionId: 'a',
        updateType: 'agent_message_chunk',
        update: {},
      })
      await manager.run('session.update', {
        acpSessionId: 'a',
        updateType: 'tool_call',
        update: {},
      })
      const prompt = { sessionId: 's', acpSessionId: 'a', prompt: [] }
      await manager.run('prompt.before', { ...prompt, origin: 'internal' })
      await manager.run('prompt.before', { ...prompt, origin: 'user' })

      expect(seen).toEqual(['git', 'tools', 'user-only'])
    })

    it('honours config.disabled by name and group, and runtime toggles', async () => {
      const { manager } = makeManager({
        config: configWithoutBuiltins({ disabled: ['audit'] }),
      })
      const seen: string[] = []
      for (const name of ['audit:a', 'audit:b', 'kept']) {
        manager.register(
          defineHook({
            name,
            event: 'server.start',
            handler: () => {
              seen.push(name)
            },
          }),
          'config',
        )
      }

      await manager.run('server.start', { workspaceRoot: '/ws' })
      expect(seen).toEqual(['kept'])

      expect(manager.setEnabled('audit:b', true)).toBe(true)
      expect(manager.setEnabled('kept', false)).toBe(true)
      expect(manager.setEnabled('missing', true)).toBe(false)

      seen.length = 0
      await manager.run('server.start', { workspaceRoot: '/ws' })
      expect(seen).toEqual(['audit:b'])
      expect(manager.list().map((h) => [h.name, h.enabled])).toEqual([
        ['audit:a', false],
        ['audit:b', true],
        ['kept', false],
      ])
    })

    it('runs nothing when hooks are disabled', async () => {
      const { manager } = makeManager({
        config: configWithoutBuiltins({ enabled: false }),
      })
      const handler = mock(() => {})
      manager.register(
        defineHook({ name: 'x', event: 'server.start', handler }),
        'config',
      )

      await manager.run('server.start', { workspaceRoot: '/ws' })

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('context', () => {
    it('gives user hooks their options, a store and exec', async () => {
      const { manager, workspaceRoot } = makeManager({
        config: configWithoutBuiltins({ options: { tagger: { tag: 'v1' } } }),
      })
      const results: unknown[] = []

      manager.register(
        defineHook({
          name: 'tagger',
          event: 'server.start',
          handler: async (_input, ctx) => {
            await ctx.store.set(
              'runs',
              ((await ctx.store.get<number>('runs')) ?? 0) + 1,
            )
            const echoed = await ctx.exec('echo hello')
            results.push(
              ctx.options.tag,
              echoed.stdout.trim(),
              ctx.workspaceRoot,
            )
          },
        }),
        'config',
      )

      await manager.run('server.start', { workspaceRoot })
      await manager.run('server.start', { workspaceRoot })

      expect(results.slice(0, 3)).toEqual(['v1', 'hello', workspaceRoot])
      const stored = await Bun.file(
        `${workspaceRoot}/.agentic/hooks-state/tagger.json`,
      ).json()
      expect(stored).toEqual({ runs: 2 })
    })
  })
})
