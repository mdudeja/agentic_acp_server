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
    agentCapabilities: {
      loadSession: true,
      sessionCapabilities: {
        fork: {},
        resume: {},
      },
    },
  }),
  'session/new': () => ({
    sessionId: `echo-session-${Date.now()}`,
    configOptions: [
      {
        id: 'mode',
        name: 'Mode',
        options: [
          { name: 'Mode 1', value: 'mode1' },
          { name: 'Mode 2', value: 'mode2' },
        ],
      },
      {
        id: 'model',
        name: 'Model',
        options: [
          { name: 'Model 1', value: 'model1' },
          { name: 'Model 2', value: 'model2' },
        ],
      },
    ],
  }),
  'session/load': (params: { sessionId?: string } = {}) => ({
    sessionId: params.sessionId ?? 'echo-session-fallback',
    configOptions: [
      {
        id: 'mode',
        name: 'Mode',
        options: [
          { name: 'Mode 1', value: 'mode1' },
          { name: 'Mode 2', value: 'mode2' },
        ],
      },
      {
        id: 'model',
        name: 'Model',
        options: [
          { name: 'Model 1', value: 'model1' },
          { name: 'Model 2', value: 'model2' },
        ],
      },
    ],
  }),
  'session/fork': (_params: any) => ({
    sessionId: `echo-session-fork-${Date.now()}`,
    configOptions: [
      {
        id: 'mode',
        name: 'Mode',
        options: [
          { name: 'Mode 1', value: 'mode1' },
          { name: 'Mode 2', value: 'mode2' },
        ],
      },
      {
        id: 'model',
        name: 'Model',
        options: [
          { name: 'Model 1', value: 'model1' },
          { name: 'Model 2', value: 'model2' },
        ],
      },
    ],
  }),
  'session/resume': (_params: any) => ({
    configOptions: [
      {
        id: 'mode',
        name: 'Mode',
        options: [
          { name: 'Mode 1', value: 'mode1' },
          { name: 'Mode 2', value: 'mode2' },
        ],
      },
      {
        id: 'model',
        name: 'Model',
        options: [
          { name: 'Model 1', value: 'model1' },
          { name: 'Model 2', value: 'model2' },
        ],
      },
    ],
  }),
  'session/prompt': (_params: { sessionId: string; messageId: string }) => ({
    stopReason: 'end_turn',
  }),
}

const rl = readline.createInterface({ input: process.stdin, terminal: false })

const shutdown = () => {
  rl.close()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return

  try {
    const frame = JSON.parse(trimmed)
    const { id, method, params } = frame
    const stub = STUBS[method as string]
    const result = stub ? stub(params ?? {}) : {}
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        result,
      }) + '\n',
    )
  } catch {
    // Ignore malformed frames
  }
})
