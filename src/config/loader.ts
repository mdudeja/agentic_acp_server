import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { logDebug, logWarning } from 'src/utils/logger'
import { AgenticConfigSchema, type AgenticConfig } from './schemas'
import { Check, Errors } from 'typebox/value'
import { deepMerge } from 'src/utils/helpers'
import { DEFAULT_CONFIG } from './default_config'

export const AGENTIC_DIR = process.env.ACP_AGENTIC_DIR || '.agentic'
export const CONFIG_FILENAME =
  process.env.ACP_CONFIG_FILENAME || 'agentic_acp_config.json'

/**
 * Load config file.
 * Creates the file with defaults if it doesn't exist, and fills in any missing fields with defaults if it does exist but is incomplete.
 *
 * The merged result is validated against `AgenticConfigSchema`; an invalid
 * file is reported (with the offending paths) and the defaults are used,
 * as for a file that fails to parse. Every call returns a fresh copy, so
 * callers can never mutate the shared `DEFAULT_CONFIG`.
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
    return structuredClone(DEFAULT_CONFIG)
  }

  let merged: AgenticConfig
  try {
    const raw = await Bun.file(configPath).text()
    const parsed = JSON.parse(raw) as Partial<AgenticConfig>
    merged = deepMerge(structuredClone(DEFAULT_CONFIG), parsed)
  } catch (err) {
    logWarning(
      `[config] Failed to parse ${configPath}: ${String(err)}. Using defaults.`,
    )
    return structuredClone(DEFAULT_CONFIG)
  }

  if (!Check(AgenticConfigSchema, merged)) {
    const errors = [...Errors(AgenticConfigSchema, merged)]
      .map((e) => `  ${e.instancePath || '/'}: ${e.message}`)
      .join('\n')
    logWarning(`[config] Invalid ${configPath}:\n${errors}\nUsing defaults.`)
    return structuredClone(DEFAULT_CONFIG)
  }

  return merged
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
    await Bun.write(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n')
  }
}
