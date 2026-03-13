import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { logDebug, logWarning } from 'src/utils/logger'
import type { AgenticConfig } from './schemas'
import { deepMerge } from 'src/utils/helpers'
import { DEFAULT_LANGUAGE_CONFIG } from './defaultlanguageConfig'

export const AGENTIC_DIR = process.env.AGENTIC_DIR || '.agentic'
export const CONFIG_FILENAME = process.env.CONFIG_FILENAME || 'config.json'

export const DEFAULT_CONFIG: AgenticConfig = {
  indexer: {
    enabled: false,
    languages: DEFAULT_LANGUAGE_CONFIG,
  },
  hooks: {
    projectInit: { enabled: true, runProviderInit: true },
    sessionCleanup: { enabled: false },
  },
  sessions: {
    memoryPath: '.agentic/sessions/',
  },
  gitignore: true,
}

/**
 * Load `.agentic/config.json` from the given working directory.
 * Creates the file with defaults if it doesn't exist, and fills in any missing fields with defaults if it does exist but is incomplete.
 */
export async function loadConfig(
  workspace_root: string,
): Promise<AgenticConfig> {
  const configPath = join(workspace_root, AGENTIC_DIR, CONFIG_FILENAME)

  if (!existsSync(configPath)) {
    logDebug(
      `[config] No config found at ${configPath}, creating with defaults.`,
    )
    await initAgenticDir(workspace_root)
    return DEFAULT_CONFIG
  }

  try {
    const raw = await readFile(configPath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AgenticConfig>
    return deepMerge(DEFAULT_CONFIG, parsed)
  } catch (err) {
    logWarning(
      `[config] Failed to parse ${configPath}: ${String(err)}. Using defaults.`,
    )
    return DEFAULT_CONFIG
  }
}

/**
 * Initialise the `.agentic/` directory structure for a workspace.
 */
export async function initAgenticDir(cwd: string): Promise<void> {
  const agenticDir = join(cwd, AGENTIC_DIR)
  const indexDir = join(agenticDir, 'index')
  const sessionsDir = join(agenticDir, 'sessions')
  const configPath = join(agenticDir, CONFIG_FILENAME)

  if (!existsSync(agenticDir)) {
    await mkdir(agenticDir, { recursive: true })
  }

  if (!existsSync(indexDir)) {
    await mkdir(indexDir, { recursive: true })
  }

  if (!existsSync(sessionsDir)) {
    await mkdir(sessionsDir, { recursive: true })
  }

  if (!existsSync(configPath)) {
    await writeFile(
      configPath,
      JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n',
      'utf-8',
    )
  }
}
