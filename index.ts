import { parseArgs } from 'node:util'
import { AgenticServer } from 'src/AgenticServer'
import { logWarning } from './src/utils/logger'

declare module 'bun' {
  interface Env {
    EDITOR_NAME?: string
    AGENTIC_DIR?: string
    CONFIG_FILENAME?: string
    NODE_ENV?: string
    LOG_LEVEL?: string
    LOG_TRAFFIC?: 'true' | 'false'
    APP_MODE?: 'server' | 'rpc'
    HTTP_PORT?: string
    DB_FILE_URL?: string
    DB_MIGRATIONS_DIR?: string
    OPENRPC_SCHEMA_PATH?: string
  }
}

const { values } = parseArgs({
  args: Bun.argv,
  options: {
    server: { type: 'boolean', short: 's' },
    port: { type: 'string', short: 'p' },
    help: { type: 'boolean', short: 'h' },
    root: { type: 'string', short: 'r' },
  },
  strict: true,
  allowPositionals: false,
})

if (values.help) {
  logWarning(`Usage: agentic-acp [options]

Options:
  --server, -s           Run in HTTP server mode (default: RPC mode)
  --port, -p <number>    Port to listen on in HTTP mode (default: 3777)
  --root, -r <path>      Root directory for config and state (default: current working directory)
  --help, -h             Show this help message
`)
  process.exit(0)
}

const root = values.root || process.cwd()
const isHttpMode = values.server || process.env['APP_MODE'] === 'server'
const port = values.port
  ? parseInt(values.port, 10)
  : parseInt(process.env['HTTP_PORT'] ?? '3777', 10)

const server = new AgenticServer({ mode: isHttpMode ? 'server' : 'rpc', port })

process.on('SIGINT', async () => {
  const logWarning = (await import('./src/utils/logger')).logWarning
  logWarning('Received SIGINT. Shutting down gracefully...')
  server.dispose()
  process.stdin.destroy()
})

await server.init(root)
