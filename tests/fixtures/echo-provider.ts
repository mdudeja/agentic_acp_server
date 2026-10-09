/**
 * Dumb ndJSON relay — acts as the ACP agent side for E2E integration tests.
 *
 * Reads newline-delimited JSON frames from stdin, and for each frame echoes
 * back `{ jsonrpc, id, result: <fixed stub> }` keyed on the `method` field.
 * No ACP library dependency — just the id-echo pattern the SDK requires.
 * `session/prompt` additionally streams a couple of `session/update`
 * notifications (`agent_message_chunk`) before its result, so the server's
 * turn-capture / summarize flow can be exercised end-to-end. Set
 * `ECHO_PROMPT_TEXT` to control the emitted text.
 */
import * as readline from 'readline'

const configOptions = [
  {
    id: 'mode',
    category: 'mode',
    name: 'Mode',
    type: 'select',
    currentValue: 'mode1',
    options: [
      { name: 'Mode 1', value: 'mode1' },
      { name: 'Mode 2', value: 'mode2' },
    ],
  },
  {
    id: 'model',
    category: 'model',
    name: 'Model',
    type: 'select',
    currentValue: 'model1',
    options: [
      { name: 'Model 1', value: 'model1' },
      { name: 'Model 2', value: 'model2' },
    ],
  },
  {
    id: 'thought_level',
    category: 'thought_level',
    name: 'Thought Level',
    type: 'select',
    currentValue: 'medium',
    options: [
      { name: 'Low', value: 'low' },
      { name: 'Medium', value: 'medium' },
      { name: 'High', value: 'high' },
    ],
  },
]

/** Keeps session ids unique even when created in the same millisecond. */
let sessionCounter = 0

const PROMPT_TEXT = process.env.ECHO_PROMPT_TEXT ?? 'Echo summary chunk'

const STUBS: Record<string, (params: any) => object> = {
  initialize: () => ({
    protocolVersion: 1,
    agentCapabilities: {
      loadSession: true,
      sessionCapabilities: {
        fork: {},
        resume: {},
        list: {},
        delete: {},
      },
    },
  }),
  'session/new': () => ({
    sessionId: `echo-session-${Date.now()}-${++sessionCounter}`,
    configOptions,
  }),
  'session/load': (params: { sessionId?: string } = {}) => ({
    sessionId: params.sessionId ?? 'echo-session-fallback',
    configOptions,
  }),
  'session/fork': (_params: any) => ({
    sessionId: `echo-session-fork-${Date.now()}-${++sessionCounter}`,
    configOptions,
  }),
  'session/resume': (_params: any) => ({
    configOptions,
  }),
  'session/list': () => ({
    sessions: [],
  }),
  'session/delete': () => ({}),
  'session/set_mode': () => ({}),
  'session/set_config_option': () => ({
    configOptions,
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

function write(frame: object) {
  process.stdout.write(JSON.stringify(frame) + '\n')
}

rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return

  try {
    const frame = JSON.parse(trimmed)
    const { id, method, params } = frame

    // `session/prompt` streams assistant chunks (as notifications) before
    // answering, mimicking a real agent's response stream.
    if (method === 'session/prompt') {
      const sessionId = params?.sessionId ?? 'echo-session'
      write({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            messageId: 'm1',
            content: { type: 'text', text: PROMPT_TEXT },
          },
        },
      })
      write({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            messageId: 'm1',
            content: { type: 'text', text: ' (end)' },
          },
        },
      })
    }

    const stub = STUBS[method as string]
    const result = stub ? stub(params ?? {}) : {}
    write({
      jsonrpc: '2.0',
      id,
      result,
    })
  } catch {
    // Ignore malformed frames
  }
})
