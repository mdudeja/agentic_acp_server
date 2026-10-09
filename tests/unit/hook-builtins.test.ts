import { describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { BuiltinHooksConfig } from 'src/config/schemas'
import { DEFAULT_CONFIG } from 'src/config/default_config'
import { HookManager } from 'src/hooks/HookManager'
import { MemoryTrustStore } from 'src/hooks/trust'
import { configWithoutBuiltins, makeHookHost } from 'tests/helpers/hooks'

/** A manager with only `name` enabled (default options + `options`). */
async function withBuiltin<K extends keyof BuiltinHooksConfig>(
  name: K,
  options: Partial<BuiltinHooksConfig[K]> = {},
  hostOptions: Parameters<typeof makeHookHost>[0] = {},
) {
  const config = configWithoutBuiltins()
  config.hooks.builtin[name] = {
    ...structuredClone(DEFAULT_CONFIG.hooks.builtin[name]),
    ...options,
    enabled: true,
  }
  const { host, workspaceRoot } = makeHookHost({ ...hostOptions, config })
  const manager = new HookManager(host, {
    trustStore: new MemoryTrustStore(),
    globalDir: '/nonexistent',
  })
  await manager.load()
  return { manager, host, workspaceRoot }
}

const userPrompt = (text: string) => ({
  sessionId: 's1',
  acpSessionId: 'acp1',
  origin: 'user' as const,
  prompt: [{ type: 'text' as const, text }],
})

async function git(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  await proc.exited
  return (await new Response(proc.stdout).text()).trim()
}

describe('built-in hooks', () => {
  it('protectedPaths refuses protected reads and writes', async () => {
    const { manager, workspaceRoot } = await withBuiltin('protectedPaths')
    const at = (path: string) => join(workspaceRoot, path)

    const read = (path: string) =>
      manager.run('fs.beforeRead', { acpSessionId: 'a', path: at(path) })
    const write = (path: string) =>
      manager.run('fs.beforeWrite', {
        acpSessionId: 'a',
        path: at(path),
        content: '',
      })

    expect((await read('.env')).decision).toBe('deny')
    expect((await read('config/.env.production')).decision).toBe('deny')
    expect((await read('src/index.ts')).decision).toBeUndefined()
    expect((await write('.git/config')).decision).toBe('deny')
    expect((await write('src/index.ts')).decision).toBeUndefined()
  })

  it('commandPolicy denies dangerous commands and allows listed ones', async () => {
    const { manager } = await withBuiltin('commandPolicy', {
      allow: ['^bun test\\b'],
    })
    const terminal = (command: string, args: string[] = []) =>
      manager.run('terminal.beforeCreate', { acpSessionId: 'a', command, args })

    expect((await terminal('rm', ['-rf', '/'])).decision).toBe('deny')
    expect((await terminal('git', ['push', '--force'])).decision).toBe('deny')
    expect((await terminal('bun', ['test'])).decision).toBe('allow')
    expect((await terminal('ls')).decision).toBeUndefined()

    const permission = (rawInput: unknown) =>
      manager.run('permission.request', {
        acpSessionId: 'a',
        toolCall: { toolCallId: 't', title: 'Run command', rawInput },
        options: [],
      })
    expect((await permission({ command: 'rm -rf ~' })).decision).toBe('deny')
    expect((await permission({ command: ['bun', 'test', 'x'] })).decision).toBe(
      'allow',
    )
    // Titles alone never trigger the policy.
    expect((await permission(undefined)).decision).toBeUndefined()
  })

  it('secretRedaction redacts secrets from user prompts', async () => {
    const { manager, host } = await withBuiltin('secretRedaction', {
      patterns: ['internal-[0-9]{4}'],
    })
    const key = `ghp_${'a'.repeat(36)}`

    const outcome = await manager.run('prompt.before', {
      ...userPrompt(`use ${key} and AKIAABCDEFGHIJKLMNOP and internal-1234`),
      prompt: [
        {
          type: 'text',
          text: `use ${key} and AKIAABCDEFGHIJKLMNOP and internal-1234`,
        },
        {
          type: 'resource',
          resource: {
            uri: 'file:///k',
            text: 'sk-ant-abcdefghijklmnopqrstuvwxyz',
          },
        },
      ],
    })

    expect(outcome.input.prompt[0]).toEqual({
      type: 'text',
      text: 'use [REDACTED GitHub token] and [REDACTED AWS access key] and [REDACTED secret]',
    })
    expect((outcome.input.prompt[1] as any).resource.text).toBe(
      '[REDACTED API key]',
    )
    expect(host.notify).toHaveBeenCalledWith(
      'warn',
      'Redacted 4 secret(s) from the prompt',
    )

    const clean = await manager.run('prompt.before', userPrompt('nothing here'))
    expect(clean.input.prompt[0]).toEqual({
      type: 'text',
      text: 'nothing here',
    })
  })

  it('contextInjection prepends project files once per session', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'hooks-ctx-'))
    writeFileSync(join(workspaceRoot, 'AGENTS.md'), 'Use bun.')
    const { manager } = await withBuiltin(
      'contextInjection',
      { gitStatus: false },
      { workspaceRoot },
    )

    const first = await manager.run('prompt.before', userPrompt('hi'))
    expect(first.input.prompt).toEqual([
      { type: 'text', text: '[Project context]\n\n## AGENTS.md\n\nUse bun.' },
      { type: 'text', text: 'hi' },
    ])

    const second = await manager.run('prompt.before', userPrompt('again'))
    expect(second.input.prompt).toEqual([{ type: 'text', text: 'again' }])

    // Internal prompts are left alone.
    const internal = await manager.run('prompt.before', {
      ...userPrompt('summary'),
      sessionId: 's2',
      origin: 'internal',
    })
    expect(internal.input.prompt).toHaveLength(1)
  })

  it('usageBudget cancels the turn and refuses further prompts', async () => {
    const { manager, host } = await withBuiltin('usageBudget', {
      maxTokens: 1000,
    })
    const usage = (used: number) =>
      manager.run('session.update', {
        sessionId: 's1',
        acpSessionId: 'acp1',
        updateType: 'usage_update',
        update: { sessionUpdate: 'usage_update', used, size: 200000 },
      })

    await usage(500)
    expect(host.cancelTurn).not.toHaveBeenCalled()
    expect(
      (await manager.run('prompt.before', userPrompt('ok'))).decision,
    ).toBeUndefined()

    await usage(1500)
    expect(host.cancelTurn).toHaveBeenCalledWith('s1')
    expect(host.notify.mock.calls.at(-1)?.[0]).toBe('error')

    const blocked = await manager.run('prompt.before', userPrompt('more'))
    expect(blocked.decision).toBe('deny')
    expect(blocked.reason).toContain('1500 tokens used (limit 1000)')
  })

  it('notifyOnTurnEnd announces only long user turns', async () => {
    const { manager, host } = await withBuiltin('notifyOnTurnEnd', {
      minDurationMs: 1000,
    })
    const after = (durationMs: number, origin: 'user' | 'internal' = 'user') =>
      manager.run('prompt.after', {
        sessionId: 's1',
        acpSessionId: 'acp1',
        origin,
        stopReason: 'end_turn',
        durationMs,
      })

    await after(500)
    await after(5000, 'internal')
    expect(host.notify).not.toHaveBeenCalled()

    await after(42_000)
    expect(host.notify).toHaveBeenCalledWith(
      'info',
      'Turn finished (end_turn) after 42s',
    )
  })

  it('formatOnWrite runs the command for matching files', async () => {
    const { manager, workspaceRoot } = await withBuiltin('formatOnWrite', {
      commands: { '**/*.md': 'cp {file} {file}.formatted' },
    })
    const write = async (name: string) => {
      const path = join(workspaceRoot, name)
      writeFileSync(path, 'content')
      await manager.run('fs.afterWrite', { acpSessionId: 'a', path })
      return Bun.file(`${path}.formatted`).exists()
    }

    expect(await write('notes.md')).toBe(true)
    expect(await write('code.ts')).toBe(false)
  })

  it('auditLog appends JSONL records', async () => {
    const { manager, workspaceRoot } = await withBuiltin('auditLog')

    await manager.run('terminal.beforeCreate', {
      sessionId: 's1',
      acpSessionId: 'a',
      command: 'ls',
      args: ['-la'],
    })
    await manager.run('fs.afterWrite', {
      sessionId: 's1',
      acpSessionId: 'a',
      path: '/ws/a.ts',
    })

    const lines = (
      await Bun.file(join(workspaceRoot, '.agentic/audit.jsonl')).text()
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(lines).toMatchObject([
      { event: 'terminal.create', sessionId: 's1', command: 'ls -la' },
      { event: 'fs.write', sessionId: 's1', path: '/ws/a.ts' },
    ])
    expect(typeof lines[0].ts).toBe('string')
  })

  it('turnCheckpoint records dirty trees under its own ref and prunes old ones', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'hooks-git-'))
    await git(workspaceRoot, 'init', '-q')
    await git(workspaceRoot, 'config', 'user.email', 'test@example.com')
    await git(workspaceRoot, 'config', 'user.name', 'Test')
    writeFileSync(join(workspaceRoot, 'a.txt'), 'one')
    await git(workspaceRoot, 'add', '.')
    await git(workspaceRoot, 'commit', '-qm', 'init')

    const { manager } = await withBuiltin(
      'turnCheckpoint',
      { keep: 2 },
      { workspaceRoot },
    )
    const checkpoints = async () =>
      (
        await git(
          workspaceRoot,
          'reflog',
          'show',
          '--format=%gs',
          'refs/agentic/checkpoints',
        )
      )
        .split('\n')
        .filter(Boolean)

    // A clean tree records nothing.
    await manager.run('prompt.before', userPrompt('clean tree'))
    expect(await checkpoints()).toEqual([])

    for (const content of ['two', 'three', 'four']) {
      writeFileSync(join(workspaceRoot, 'a.txt'), content)
      await manager.run('prompt.before', userPrompt(content))
    }

    // Only the newest `keep` remain; the stash list and the tree are untouched.
    const kept = await checkpoints()
    expect(kept).toHaveLength(2)
    expect(kept[0]).toContain('agentic checkpoint before turn (session s1)')
    expect(await git(workspaceRoot, 'stash', 'list')).toBe('')
    expect(await Bun.file(join(workspaceRoot, 'a.txt')).text()).toBe('four')

    // The older kept checkpoint restores the tree as it was before turn "four".
    await git(workspaceRoot, 'checkout', '--', 'a.txt')
    await git(workspaceRoot, 'stash', 'apply', 'refs/agentic/checkpoints@{1}')
    expect(await Bun.file(join(workspaceRoot, 'a.txt')).text()).toBe('three')
  })

  it('projectInit only acts on the first connect', async () => {
    const { manager, host } = await withBuiltin('projectInit')
    const connected = (firstConnect: boolean, provider = 'echo') =>
      manager.run('agent.connected', {
        provider,
        agentId: 'agent1',
        cwd: '/tmp',
        firstConnect,
      })

    // The echo provider's CLI init succeeds; copilot has no CLI support.
    await connected(true)
    await connected(false)
    await connected(true, 'copilot')
    expect(host.notify).not.toHaveBeenCalled()
  })
})
