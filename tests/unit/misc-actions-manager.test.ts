import { describe, test, expect, spyOn, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MiscActionsManager } from 'src/managers/MiscActionsManager'
import { BaseManager } from 'src/managers/BaseManager'
import { MISC_ACTION_NAMES } from 'src/data/events'
import type { AgenticServer } from 'src/AgenticServer'

type MiscActionName = (typeof MISC_ACTION_NAMES)[number]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createdDirs: string[] = []

/** Create an isolated workspace directory that is cleaned up after each test. */
function makeWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'misc-actions-'))
  createdDirs.push(dir)
  return dir
}

/** Build a partial config object where every misc action defaults to disabled. */
function makeConfig(
  overrides: Partial<Record<MiscActionName, boolean>> = {},
): Record<string, unknown> {
  const config: Record<string, boolean> = {}
  for (const action of MISC_ACTION_NAMES) config[action] = false
  return { ...config, ...overrides }
}

/** Minimal AgenticServer stub exposing only what the manager reads. */
function makeServer(config: unknown): AgenticServer {
  return { getState: () => ({ config }) } as unknown as AgenticServer
}

/** Construct a manager wired to a fresh workspace + config. */
function makeManager(
  config: unknown,
  cwd: string = makeWorkspace(),
): MiscActionsManager {
  return new MiscActionsManager(cwd, makeServer(config))
}

/**
 * Capture `emit` calls fired synchronously from the constructor (before a
 * listener could be attached) by temporarily wrapping BaseManager.emit.
 */
function constructCapturingEmit(factory: () => MiscActionsManager): {
  manager: MiscActionsManager
  events: Array<{ event: string; payload: unknown }>
} {
  const events: Array<{ event: string; payload: unknown }> = []
  const original = BaseManager.prototype.emit
  const spy = spyOn(BaseManager.prototype, 'emit').mockImplementation(function (
    this: unknown,
    event: string,
    payload?: unknown,
  ) {
    events.push({ event, payload })
    return original.call(this, event, payload)
  } as never)

  try {
    const manager = factory()
    return { manager, events }
  } finally {
    spy.mockRestore()
  }
}

/** Record every payload emitted for the given events. */
function collect<E extends string>(
  manager: MiscActionsManager,
  events: E[],
): Record<E, Array<{ data?: string }>> {
  const buckets = {} as Record<E, Array<{ data?: string }>>
  for (const event of events) {
    buckets[event] = []
    manager.on(
      event as never,
      ((payload: never) => {
        buckets[event].push(payload as { data?: string })
      }) as never,
    )
  }
  return buckets
}

async function readIfExists(path: string): Promise<string | null> {
  const file = Bun.file(path)
  return (await file.exists()) ? file.text() : null
}

afterEach(() => {
  while (createdDirs.length > 0) {
    rmSync(createdDirs.pop()!, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MiscActionsManager', () => {
  describe('constructor', () => {
    test('emits action.error when cwd is empty', () => {
      const { events } = constructCapturingEmit(
        () => new MiscActionsManager('', makeServer(makeConfig())),
      )

      const errors = events.filter((e) => e.event === 'action.error')
      expect(errors).toHaveLength(1)
      expect(errors[0]!.payload).toMatch(/Workspace root not found/)
    })

    test('emits action.error when cwd is only whitespace', () => {
      const { events } = constructCapturingEmit(
        () => new MiscActionsManager('   ', makeServer(makeConfig())),
      )

      expect(events.some((e) => e.event === 'action.error')).toBe(true)
    })

    test('does not emit action.error for a valid cwd', () => {
      const { events } = constructCapturingEmit(
        () => new MiscActionsManager(makeWorkspace(), makeServer(makeConfig())),
      )

      expect(events).toHaveLength(0)
    })
  })

  describe('init', () => {
    test('emits action.error and does nothing when config is missing', async () => {
      const manager = makeManager(undefined)
      const errors: unknown[] = []
      manager.on('action.error', (payload) => errors.push(payload))

      await manager.init()

      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatch(/App config not found/)
    })

    test('queues only enabled actions and emits action.queued for each', async () => {
      const manager = makeManager(
        makeConfig({ addToGitignore: true, addToDockerignore: true }),
      )
      const queued = collect(manager, ['action.queued'] as const)[
        'action.queued'
      ]

      await manager.init()

      expect(queued.map((q) => q.data)).toEqual([
        'Queued addToGitignore action',
        'Queued addToDockerignore action',
      ])
    })

    test('does not queue disabled actions', async () => {
      const manager = makeManager(makeConfig())
      const events = collect(manager, [
        'action.queued',
        'action.started',
        'action.completed',
      ] as const)

      await manager.init()

      expect(events['action.queued']).toHaveLength(0)
      expect(events['action.started']).toHaveLength(0)
      expect(events['action.completed']).toHaveLength(0)
    })

    test('processes queued actions in MISC_ACTION_NAMES order', async () => {
      const manager = makeManager(
        makeConfig({
          addToGitignore: true,
          addToNpmignore: true,
          addToDockerignore: true,
        }),
      )
      const events = collect(manager, [
        'action.started',
        'action.completed',
      ] as const)

      await manager.init()

      const expected = MISC_ACTION_NAMES.map((a) => a)
      expect(events['action.started'].map((e) => e.data)).toEqual(
        expected.map((a) => `Started ${a} action`),
      )
      expect(events['action.completed'].map((e) => e.data)).toEqual(
        expected.map((a) => `Completed ${a} action`),
      )
    })

    test('ignores config keys that are not known misc actions', async () => {
      const cwd = makeWorkspace()
      const manager = makeManager(
        { ...makeConfig({ addToGitignore: true }), someUnknownAction: true },
        cwd,
      )

      await manager.init()

      expect(await Bun.file(join(cwd, '.gitignore')).exists()).toBe(true)
      expect(await Bun.file(join(cwd, '.npmignore')).exists()).toBe(false)
      expect(await Bun.file(join(cwd, '.dockerignore')).exists()).toBe(false)
    })
  })

  describe('addToFile (via enabled actions)', () => {
    test('creates .gitignore with the .agentic/ entry when absent', async () => {
      const cwd = makeWorkspace()
      const manager = makeManager(makeConfig({ addToGitignore: true }), cwd)

      await manager.init()

      expect(await readIfExists(join(cwd, '.gitignore'))).toBe(
        '# All agentic stuff\n.agentic/\n',
      )
    })

    test('appends the .agentic/ entry while preserving existing content', async () => {
      const cwd = makeWorkspace()
      writeFileSync(join(cwd, '.gitignore'), 'node_modules\n')
      const manager = makeManager(makeConfig({ addToGitignore: true }), cwd)

      await manager.init()

      const content = (await readIfExists(join(cwd, '.gitignore')))!
      expect(content).toContain('node_modules')
      expect(content).toContain('# All agentic stuff')
      expect(content).toContain('.agentic/')
      expect(content.endsWith('\n')).toBe(true)
    })

    test('does not modify a file that already contains .agentic/', async () => {
      const cwd = makeWorkspace()
      const original = '# All agentic stuff\n.agentic/\n'
      writeFileSync(join(cwd, '.gitignore'), original)
      const manager = makeManager(makeConfig({ addToGitignore: true }), cwd)

      await manager.init()

      expect(await readIfExists(join(cwd, '.gitignore'))).toBe(original)
    })

    test('writes .npmignore and .dockerignore for their respective actions', async () => {
      const cwd = makeWorkspace()
      const manager = makeManager(
        makeConfig({ addToNpmignore: true, addToDockerignore: true }),
        cwd,
      )

      await manager.init()

      expect(await readIfExists(join(cwd, '.npmignore'))).toContain('.agentic/')
      expect(await readIfExists(join(cwd, '.dockerignore'))).toContain(
        '.agentic/',
      )
      // The gitignore action was not enabled.
      expect(await Bun.file(join(cwd, '.gitignore')).exists()).toBe(false)
    })

    test('creates every ignore file when all actions are enabled', async () => {
      const cwd = makeWorkspace()
      const manager = makeManager(
        makeConfig({
          addToGitignore: true,
          addToNpmignore: true,
          addToDockerignore: true,
        }),
        cwd,
      )

      await manager.init()

      for (const file of ['.gitignore', '.npmignore', '.dockerignore']) {
        expect(await readIfExists(join(cwd, file))).toContain('.agentic/')
      }
    })

    test('is idempotent across repeated init calls (no duplicated entry)', async () => {
      const cwd = makeWorkspace()
      const manager = makeManager(makeConfig({ addToGitignore: true }), cwd)

      await manager.init()
      await manager.init()

      const content = (await readIfExists(join(cwd, '.gitignore')))!
      const occurrences = content.split('.agentic/').length - 1
      expect(occurrences).toBe(1)
    })
  })
})
