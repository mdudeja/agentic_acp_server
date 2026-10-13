import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { deleteAsync } from 'del'
import type { BuiltinHooksConfig } from 'src/config/schemas'
import { list } from 'src/checkpoints/git'
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
  const manager = new HookManager(workspaceRoot, host, {
    trustStore: new MemoryTrustStore(),
    globalDir: '/nonexistent',
  })
  await manager.load()
  return { manager, host, workspaceRoot }
}

/** Prompts the user with a message and returns their response along with metadata about the interaction. */
const userPrompt = (text: string) => ({
  sessionId: 's1',
  acpSessionId: 'acp1',
  origin: 'user' as const,
  prompt: [{ type: 'text' as const, text }],
})

/** Runs Git version control commands in the specified directory. */
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
  afterAll(async () => {
    await deleteAsync('/tmp/hooks-*', {
      force: true,
      onlyDirectories: true,
    })
  })

  it('protectedPaths refuses protected reads and writes', async () => {
    const { manager, workspaceRoot } = await withBuiltin('protectedPaths')
    /** Constructs the full path by joining the workspace root with the given path. */
    const at = (path: string) => join(workspaceRoot, path)

    /** Reads a file from the specified path and returns a promise. */
    const read = (path: string) =>
      manager.run('fs.beforeRead', { acpSessionId: 'a', path: at(path) })
    /** Writes data to a file at the specified path. */
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
    /** Runs a terminal command with optional arguments. */
    const terminal = (command: string, args: string[] = []) =>
      manager.run('terminal.beforeCreate', { acpSessionId: 'a', command, args })

    expect((await terminal('rm', ['-rf', '/'])).decision).toBe('deny')
    expect((await terminal('git', ['push', '--force'])).decision).toBe('deny')
    expect((await terminal('bun', ['test'])).decision).toBe('allow')
    expect((await terminal('ls')).decision).toBeUndefined()

    /** Evaluates or requests permissions based on the provided input. Handles the permission request asynchronously and returns the outcome. */
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
    /** Records or updates the usage of a resource or feature in a session context. */
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
    /** Schedule a task to run after the specified duration in milliseconds. */
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
    /** Writes a name and returns whether the operation was successful. */
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

  it('turnCheckpoint snapshots every turn under its own ref and prunes old ones', async () => {
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

    // Clean trees count too: every turn is a rollback target.
    await manager.run('prompt.before', userPrompt('clean tree'))
    expect(await list(workspaceRoot)).toHaveLength(1)

    for (const content of ['two', 'three', 'four']) {
      writeFileSync(join(workspaceRoot, 'a.txt'), content)
      await manager.run('prompt.before', {
        ...userPrompt(content),
        // Contexts and injected text come first; the prompt is the last text.
        prompt: [
          { type: 'text' as const, text: '[Project context]' },
          { type: 'text' as const, text: `turn ${content}` },
        ],
      })
    }

    // Only the newest `keep` remain; the stash list and the tree are untouched.
    const kept = await list(workspaceRoot)
    expect(kept.map((c) => [c.sessionId, c.kind, c.prompt])).toEqual([
      ['s1', 'turn', 'turn four'],
      ['s1', 'turn', 'turn three'],
    ])
    expect(await git(workspaceRoot, 'stash', 'list')).toBe('')
    expect(await Bun.file(join(workspaceRoot, 'a.txt')).text()).toBe('four')
  })

  it('projectInit only acts on the first connect', async () => {
    const { manager, host } = await withBuiltin('projectInit')
    /** Handles establishing a connection, indicating whether its the first connection attempt and specifying the provider. */
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

describe('indexerFirst', () => {
  /** Sets up the configuration for hook execution, initializing the setup with optional custom options. */
  const setup = (options: Partial<BuiltinHooksConfig['indexerFirst']> = {}) =>
    withBuiltin('indexerFirst', options)

  type Manager = Awaited<ReturnType<typeof setup>>['manager']

  /** Executes tool calls within a session and manages the session update process. */
  const toolCall = (
    manager: Manager,
    update: Record<string, unknown>,
    updateType = 'tool_call',
  ) =>
    manager.run('session.update', {
      acpSessionId: 'acp1',
      updateType,
      update: { sessionUpdate: updateType, ...update },
    })

  /** Handles permission logic for a given tool call, requesting access as needed. */
  const permission = (
    manager: Manager,
    toolCall: { title?: string; kind?: string; rawInput?: unknown },
  ) =>
    manager.run('permission.request', {
      acpSessionId: 'acp1',
      toolCall: { toolCallId: 'p1', ...toolCall },
      options: [
        { optionId: 'y', name: 'Allow', kind: 'allow_once' },
        { optionId: 'n', name: 'Reject', kind: 'reject_once' },
      ],
    })

  /** Runs the read operation when the component or hook is ready to read. */
  const fullRead = (manager: Manager) =>
    manager.run('fs.beforeRead', { acpSessionId: 'acp1', path: '/w/a.ts' })

  /** An indexer call that found something, then one that found nothing. */
  const searchFound = (manager: Manager) =>
    toolCall(manager, {
      toolCallId: 't1',
      title: 'mcp__agentic-indexer__search_codebase',
      content: [{ type: 'text', text: '[FUNCTION] foo in a.ts:3' }],
    })
  /** Searches for empty entries in the manager. */
  const searchEmpty = async (manager: Manager) => {
    await toolCall(manager, {
      toolCallId: 't2',
      title: 'agentic-indexer/search_codebase',
    })
    await toolCall(
      manager,
      {
        toolCallId: 't2',
        status: 'completed',
        rawOutput: {
          content: [
            {
              type: 'text',
              text: '[no-results] No symbols found matching the query.',
            },
          ],
        },
      },
      'tool_call_update',
    )
  }

  it('refuses whole-file reads and searches until the indexer returns [no-results]', async () => {
    const { manager } = await setup({ maxDenialsPerTurn: 10 })

    expect((await fullRead(manager)).decision).toBe('deny')
    expect(
      (await permission(manager, { title: 'grep foo', kind: 'search' }))
        .decision,
    ).toBe('deny')

    // An indexer search that found something does not unlock raw access.
    await searchFound(manager)
    expect(
      (await permission(manager, { title: 'Read a.ts', kind: 'read' }))
        .decision,
    ).toBe('deny')

    await searchEmpty(manager)
    expect((await fullRead(manager)).decision).toBeUndefined()
    expect(
      (await permission(manager, { title: 'grep foo', kind: 'search' }))
        .decision,
    ).toBeUndefined()
    expect(
      (
        await manager.run('terminal.beforeCreate', {
          acpSessionId: 'acp1',
          command: 'rg',
          args: ['foo'],
        })
      ).decision,
    ).toBeUndefined()
  })

  it('always lets ranged reads, other kinds and indexer tools through', async () => {
    const { manager } = await setup()

    expect(
      (
        await manager.run('fs.beforeRead', {
          acpSessionId: 'acp1',
          path: '/w/a.ts',
          line: 10,
          limit: 20,
        })
      ).decision,
    ).toBeUndefined()
    expect(
      (
        await permission(manager, {
          title: 'Read a.ts',
          kind: 'read',
          rawInput: { path: 'a.ts', offset: 10 },
        })
      ).decision,
    ).toBeUndefined()
    expect(
      (await permission(manager, { title: 'Edit a.ts', kind: 'edit' }))
        .decision,
    ).toBeUndefined()
    expect(
      (
        await permission(manager, {
          title: 'read_code (agentic-indexer MCP Server)',
          kind: 'read',
        })
      ).decision,
    ).toBe('allow')
    expect(
      (
        await manager.run('terminal.beforeCreate', {
          acpSessionId: 'acp1',
          command: 'ls',
          args: [],
        })
      ).decision,
    ).toBeUndefined()
  })

  it('does not mistake file paths for indexer tools', async () => {
    const { manager } = await setup()
    await toolCall(manager, {
      toolCallId: 't9',
      title: 'Read src/server/tools/read_code.ts',
    })
    expect(
      (
        await permission(manager, {
          title: 'Read src/server/tools/read_code.ts',
          kind: 'read',
        })
      ).decision,
    ).toBe('deny')
  })

  it('treats shell searches in execute permissions as searches', async () => {
    const { manager } = await setup()
    expect(
      (
        await permission(manager, {
          title: 'Run',
          kind: 'execute',
          rawInput: { command: 'grep -rn foo src' },
        })
      ).decision,
    ).toBe('deny')
    expect(
      (
        await permission(manager, {
          title: 'Run',
          kind: 'execute',
          rawInput: { command: 'bun test' },
        })
      ).decision,
    ).toBeUndefined()
  })

  // Payload shapes recorded from real providers (paths shortened).
  it('handles Copilot grep/view permission shapes', async () => {
    const { manager } = await setup({ maxDenialsPerTurn: 10 })

    const grep = await permission(manager, {
      title: "Searching for 'notifyLog'",
      kind: 'read',
      rawInput: {
        pattern: 'notifyLog',
        paths: '/w',
        output_mode: 'content',
        '-n': true,
      },
    })
    expect(grep.decision).toBe('deny')

    const view = await permission(manager, {
      title: 'Viewing /w/src/server/respond.ts',
      kind: 'read',
      rawInput: { path: '/w/src/server/respond.ts', view_range: [1, 220] },
    })
    expect(view.decision).toBeUndefined()

    const fullView = await permission(manager, {
      title: 'Viewing /w/src/server/respond.ts',
      kind: 'read',
      rawInput: { path: '/w/src/server/respond.ts' },
    })
    expect(fullView.decision).toBe('deny')
  })

  it('tracks OpenCode indexer calls (title only on the first update)', async () => {
    const { manager } = await setup()
    expect((await fullRead(manager)).decision).toBe('deny')

    await toolCall(manager, {
      toolCallId: 'oc1',
      title: 'agentic-indexer_search_codebase',
      kind: 'other',
      status: 'pending',
      rawInput: {},
    })
    await toolCall(
      manager,
      {
        toolCallId: 'oc1',
        status: 'in_progress',
        rawInput: { query: 'nothingHere', mode: 'auto' },
      },
      'tool_call_update',
    )
    await toolCall(
      manager,
      {
        toolCallId: 'oc1',
        status: 'completed',
        rawOutput: {
          output: '[no-results] No symbols found matching the query.',
          metadata: { truncated: false },
        },
      },
      'tool_call_update',
    )

    expect((await fullRead(manager)).decision).toBeUndefined()
  })

  it('unlockOn indexerUsed: any indexer call unlocks the turn', async () => {
    const { manager } = await setup({ unlockOn: 'indexerUsed' })
    expect((await fullRead(manager)).decision).toBe('deny')
    await searchFound(manager)
    expect((await fullRead(manager)).decision).toBeUndefined()
  })

  it('fails open after maxDenialsPerTurn and resets on the next prompt', async () => {
    const { manager, host } = await setup({ maxDenialsPerTurn: 1 })

    expect((await fullRead(manager)).decision).toBe('deny')
    expect((await fullRead(manager)).decision).toBeUndefined()
    expect((await fullRead(manager)).decision).toBeUndefined()
    expect(host.notify).toHaveBeenCalledTimes(1)
    expect(host.notify.mock.calls[0]?.[0]).toBe('warn')

    await manager.run('prompt.before', userPrompt('again'))
    expect((await fullRead(manager)).decision).toBe('deny')
  })

  it('warn mode never denies and notifies once per turn', async () => {
    const { manager, host } = await setup({ mode: 'warn' })
    expect((await fullRead(manager)).decision).toBeUndefined()
    expect(
      (await permission(manager, { title: 'grep', kind: 'search' })).decision,
    ).toBeUndefined()
    expect(host.notify).toHaveBeenCalledTimes(1)
  })

  it('is a no-op with the indexer disabled', async () => {
    const config = configWithoutBuiltins()
    config.indexer.enabled = false
    config.hooks.builtin.indexerFirst = {
      ...structuredClone(DEFAULT_CONFIG.hooks.builtin.indexerFirst),
      enabled: true,
    }
    const { host, workspaceRoot } = makeHookHost({ config })
    const manager = new HookManager(workspaceRoot, host, {
      trustStore: new MemoryTrustStore(),
      globalDir: '/nonexistent',
    })
    await manager.load()

    expect((await fullRead(manager)).decision).toBeUndefined()
    const prompt = await manager.run('prompt.before', userPrompt('hi'))
    expect(prompt.input.prompt).toHaveLength(1)
  })

  it('adds the exploration rule to user prompts only', async () => {
    const { manager } = await setup()

    const user = await manager.run('prompt.before', userPrompt('find foo'))
    expect(user.input.prompt).toHaveLength(2)
    expect((user.input.prompt[0] as { text: string }).text).toContain(
      'agentic-indexer',
    )

    const internal = await manager.run('prompt.before', {
      ...userPrompt('summarize'),
      origin: 'internal',
    })
    expect(internal.input.prompt).toHaveLength(1)
  })
})
