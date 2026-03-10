import { AgenticServer } from 'src/AgenticServer'

declare module 'bun' {
  interface Env {
    EDITOR_NAME?: string
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

/** --- Mode detection ---
 * HTTP mode is enabled by:
 *   --http flag:         bun run index.ts --http
 *   APP_MODE env var:   APP_MODE=server bun run index.ts
 * Port (HTTP mode only):
 *   --port=<n> flag:     bun run index.ts --http --port=4000
 *   HTTP_PORT env var:   HTTP_PORT=4000 APP_MODE=server bun run index.ts
 */

const args = process.argv.slice(2)
const isHttpMode =
  args.includes('--http') || process.env['APP_MODE'] === 'server'

const portArg = args.find((a) => a.startsWith('--port='))
const port = portArg
  ? parseInt(portArg.split('=')[1] ?? '3777', 10)
  : parseInt(process.env['HTTP_PORT'] ?? '3777', 10)

const server = new AgenticServer({ mode: isHttpMode ? 'server' : 'rpc', port })

process.on('SIGINT', async () => {
  const logWarning = (await import('./src/utils/logger')).logWarning
  logWarning('Received SIGINT. Shutting down gracefully...')
  server.dispose()
  process.stdin.destroy()
})

await server.init()
