/**
 * Dumb ndJSON relay — acts as the ACP agent side for E2E integration tests.
 *
 * Reads newline-delimited JSON frames from stdin, and for each frame echoes
 * back `{ jsonrpc, id, result: <fixed stub> }` keyed on the `method` field.
 * No ACP library dependency — just the id-echo pattern the SDK requires.
 */
import * as readline from 'readline'

const STUBS: Record<string, (params: any) => object> = {
  initialize: () => ({
    protocolVersion: 1,
    agentCapabilities: {},
  }),
  'session/new': () => ({
    sessionId: `echo-session-${Date.now()}`,
  }),
  'session/load': (params: { sessionId?: string } = {}) => ({
    sessionId: params.sessionId ?? 'echo-session-fallback',
  }),
}

const rl = readline.createInterface({ input: process.stdin, terminal: false })

rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return

  try {
    const frame = JSON.parse(trimmed)
    const { id, method, params } = frame
    const stub = STUBS[method as string]
    const result = stub ? stub(params ?? {}) : {}
    console.log(JSON.stringify({ jsonrpc: '2.0', id, result }))
  } catch {
    // Ignore malformed frames
  }
})
