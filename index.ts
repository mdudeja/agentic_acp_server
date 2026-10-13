import { parseArgs } from 'node:util'
import { AgenticServer } from 'src/AgenticServer'
import { logWarning } from 'src/utils/logger'
import { resolvePath } from 'src/utils/paths'
import { VERSION } from 'src/version'

/** The module bun defines a set of environment variables to configure application settings, including configuration files, environment modes, logging levels, database connections, and hook directories. */
declare module 'bun' {
  interface Env {
    ACP_EDITOR_NAME?: string
    ACP_AGENTIC_DIR?: string
    ACP_CONFIG_FILENAME?: string
    ACP_NODE_ENV?: string
    ACP_LOG_LEVEL?: string
    ACP_LOG_TRAFFIC?: 'true' | 'false'
    ACP_APP_MODE?: 'server' | 'rpc'
    ACP_HTTP_PORT?: string
    ACP_DB_FILE_URL?: string
    ACP_DB_MIGRATIONS_DIR?: string
    ACP_OPENRPC_SCHEMA_PATH?: string
    /** Global hooks directory (default `~/.config/agentic/hooks`). */
    ACP_HOOKS_GLOBAL_DIR?: string
    /** `always`: run project hook files without asking (CI, tests). */
    ACP_TRUST_PROJECT_HOOKS?: 'always'
  }
}

const { values } = parseArgs({
  args: Bun.argv,
  options: {
    server: { type: 'boolean', short: 's' },
    port: { type: 'string', short: 'p' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
    root: { type: 'string', short: 'r' },
  },
  strict: true,
  allowPositionals: true,
})

if (values.help) {
  logWarning(`Usage: agentic-acp-server [options] (v${VERSION})

Options:
  --server, -s           Run in HTTP server mode (default: RPC mode)
  --port, -p <number>    Port to listen on in HTTP mode (default: 3777)
  --root, -r <path>      Root directory for config and state (default: current working directory)
  --version, -v          Print the version and exit
  --help, -h             Show this help message
`)
  process.exit(0)
}

if (values.version) {
  process.stdout.write(`${VERSION}\n`)
  process.exit(0)
}

const root = resolvePath(values.root ?? process.cwd())
const isHttpMode = values.server || process.env.ACP_APP_MODE === 'server'
const port = values.port
  ? parseInt(values.port, 10)
  : parseInt(process.env.ACP_HTTP_PORT ?? '3777', 10)

const server = new AgenticServer({ mode: isHttpMode ? 'server' : 'rpc', port })

// SIGTERM is what editors send when they stop the server (Neovim's
// `jobstop`), SIGHUP when the terminal goes away; all shut down gracefully.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, async () => {
    const logWarning = (await import('./src/utils/logger')).logWarning
    logWarning(`Received ${signal}. Shutting down gracefully...`)
    await server.dispose()
    process.stdin.destroy()
  })
}

await server.init(root)
