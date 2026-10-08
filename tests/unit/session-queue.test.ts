import { describe, expect, it, mock } from 'bun:test'
import {
  ok,
  runTierQueue,
  tierError,
  unavailable,
} from '../../src/sessionops/queue'

describe('sessionops/runTierQueue', () => {
  it('returns the first tier that succeeds', async () => {
    const first = mock(() => Promise.resolve(ok('first')))
    const second = mock(() => Promise.resolve(ok('second')))

    const res = await runTierQueue<string>({
      op: 'list',
      tiers: ['memory', 'acp', 'cli'],
      handlers: { memory: first, acp: second },
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value).toBe('first')
      expect(res.tier).toBe('memory')
    }
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(0)
  })

  it('advances past unavailable tiers', async () => {
    const res = await runTierQueue<string>({
      op: 'list',
      tiers: ['memory', 'acp', 'cli'],
      handlers: {
        memory: async () => unavailable('no memory'),
        acp: async () => unavailable('no acp'),
        cli: async () => ok('cli-win'),
      },
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value).toBe('cli-win')
      expect(res.tier).toBe('cli')
    }
  })

  it('stops on error and surfaces the message (no fallthrough)', async () => {
    const later = mock(() => Promise.resolve(ok('later')))

    const res = await runTierQueue<string>({
      op: 'delete',
      tiers: ['acp', 'cli'],
      handlers: {
        acp: async () => tierError('acp blew up'),
        cli: later,
      },
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('error')
      expect(res.tier).toBe('acp')
      expect(res.message).toContain('acp blew up')
    }
    expect(later).toHaveBeenCalledTimes(0)
  })

  it('treats a thrown error as an error outcome', async () => {
    const res = await runTierQueue<string>({
      op: 'export',
      tiers: ['cli'],
      handlers: {
        cli: async () => {
          throw new Error('kaboom')
        },
      },
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('error')
      expect(res.message).toContain('kaboom')
    }
  })

  it('skips tiers with no handler (unavailable)', async () => {
    const res = await runTierQueue<string>({
      op: 'import',
      tiers: ['memory', 'acp', 'cli'],
      handlers: { cli: async () => ok('cli') },
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.tier).toBe('cli')
    }
  })

  it('reports unavailable when every tier is unavailable', async () => {
    const res = await runTierQueue<string>({
      op: 'list',
      tiers: ['memory', 'acp'],
      handlers: {
        memory: async () => unavailable('nope'),
        acp: async () => unavailable(),
      },
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('unavailable')
    }
  })

  it('honours a reordered/shortened policy (only listed tiers run)', async () => {
    const cli = mock(() => Promise.resolve(ok('cli')))
    const memory = mock(() => Promise.resolve(ok('memory')))

    const res = await runTierQueue<string>({
      op: 'list',
      tiers: ['cli'], // policy shortened to cli-only
      handlers: { memory, cli },
    })

    expect(res.ok).toBe(true)
    expect(memory).toHaveBeenCalledTimes(0)
    expect(cli).toHaveBeenCalledTimes(1)
  })
})
