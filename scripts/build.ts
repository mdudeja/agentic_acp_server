import { mkdir } from 'node:fs/promises'
import { dirname } from 'path'
import { logDebug } from 'src/utils/logger'
import { resolvePath } from 'src/utils/paths'

/** Builds and prepares a distributable version of the application by generating an executable script and ensuring all necessary directories exist. */
export async function build() {
  const distDir = resolvePath('dist')
  const rootDir = dirname(distDir)

  //   Ensure the dist directory exists
  await mkdir(distDir, { recursive: true })

  //   Create the agentic_indexer file with the shebang and environment variable
  let agenticAcpServerContent = `#!/bin/bash \n`
  agenticAcpServerContent += `bun --env-file ${rootDir}/.env ${rootDir}/index.ts "$@"\n`

  //   Write the agentic_indexer file to the dist directory
  const agenticAcpServerPath = resolvePath(`${distDir}/agentic_acp_server`)
  await Bun.write(agenticAcpServerPath, agenticAcpServerContent)

  //   Make the agentic_indexer file executable
  await Bun.$`chmod +x ${agenticAcpServerPath}`

  logDebug(`Build completed. Executable created at: ${agenticAcpServerPath}`)
}

await build()
