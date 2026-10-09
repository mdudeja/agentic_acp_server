import { describe, expect, it, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  AGENTIC_DIR,
  CONFIG_FILENAME,
  loadConfig,
} from '../../src/config/loader'
import { DEFAULT_CONFIG } from '../../src/config/default_config'

const dirs: string[] = []

/** A workspace whose config file contains `config` (as JSON). */
function workspaceWith(config: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'config-loader-'))
  dirs.push(dir)
  mkdirSync(join(dir, AGENTIC_DIR), { recursive: true })
  writeFileSync(join(dir, AGENTIC_DIR, CONFIG_FILENAME), JSON.stringify(config))
  return dir
}

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true })
  }
})

describe('loadConfig', () => {
  it('merges a partial config over the defaults', async () => {
    const config = await loadConfig(workspaceWith({ nes: { enabled: false } }))

    expect(config.nes.enabled).toBe(false)
    expect(config.sessionOps).toEqual(DEFAULT_CONFIG.sessionOps)
  })

  it('falls back to the defaults for a config that fails the schema', async () => {
    const config = await loadConfig(
      workspaceWith({ nes: { enabled: 'sometimes' } }),
    )

    expect(config).toEqual(DEFAULT_CONFIG)
  })

  it('never hands out the shared default object', async () => {
    const config = await loadConfig(workspaceWith({}))
    config.sessionOps.list.push('cli')

    expect(DEFAULT_CONFIG.sessionOps.list).toEqual(['memory', 'acp', 'cli'])
    expect(config).not.toBe(DEFAULT_CONFIG)
  })
})
