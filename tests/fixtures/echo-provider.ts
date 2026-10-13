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
 *
 * A prompt starting with `/<scenario>` runs a scripted UI stub instead (see
 * `echo-scenarios.ts`; send `/help` for the list). The scenarios are
 * advertised as available commands for each new or reopened session.
 * Scenarios can issue agent → client requests, so responses from the client
 * are routed back to their pending request, and `session/cancel` aborts the
 * running scenario.
 */
import * as readline from 'readline'
import {
  availableCommandsUpdate,
  parseScenario,
  ScenarioError,
} from './echo-scenarios.ts'

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

const STUBS: Record<string, (params: any) => Record<string, unknown>> = {
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

/** Agent → client requests awaiting the client's response. */
const pending = new Map<
  string,
  { resolve: (result: any) => void; reject: (error: Error) => void }
>()
let requestCounter = 0

/** Working directory per session, from `session/new|load|resume`. */
const sessionCwds = new Map<string, string>()

/** Methods after which the available commands are advertised. */
const SESSION_OPENERS = new Set([
  'session/new',
  'session/load',
  'session/resume',
  'session/fork',
])

/** Running scenario per session, aborted by `session/cancel`. */
const running = new Map<string, AbortController>()

function request(method: string, params: object): Promise<any> {
  const id = `echo-req-${++requestCounter}`
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    write({ jsonrpc: '2.0', id, method, params })
  })
}

function sessionUpdate(sessionId: string, update: object) {
  write({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId, update },
  })
}

/** Runs a `/<scenario>` prompt and answers the `session/prompt` request. */
async function runScenario(
  id: unknown,
  sessionId: string,
  texts: string[],
): Promise<boolean> {
  const parsed = parseScenario(texts)
  if (!parsed) return false

  const controller = new AbortController()
  running.set(sessionId, controller)

  try {
    const result = await parsed.scenario.run({
      sessionId,
      cwd: sessionCwds.get(sessionId) ?? process.cwd(),
      args: parsed.args,
      signal: controller.signal,
      update: (update) => sessionUpdate(sessionId, update),
      request,
      notify: (method, params) => write({ jsonrpc: '2.0', method, params }),
    })
    write({
      jsonrpc: '2.0',
      id,
      result: { stopReason: result?.stopReason ?? 'end_turn' },
    })
  } catch (error) {
    if (controller.signal.aborted) {
      write({ jsonrpc: '2.0', id, result: { stopReason: 'cancelled' } })
    } else {
      write({
        jsonrpc: '2.0',
        id,
        error: {
          code: error instanceof ScenarioError ? error.code : -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  } finally {
    running.delete(sessionId)
  }
  return true
}

rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return

  try {
    const frame = JSON.parse(trimmed)
    const { id, method, params } = frame

    // A response to one of our own requests.
    if (method === undefined && id !== undefined) {
      const waiter = pending.get(String(id))
      pending.delete(String(id))
      if (frame.error) {
        waiter?.reject(new Error(frame.error.message ?? 'Request failed'))
      } else {
        waiter?.resolve(frame.result)
      }
      return
    }

    // A notification: nothing to answer.
    if (id === undefined) {
      if (method === 'session/cancel') {
        running.get(params?.sessionId)?.abort()
      }
      return
    }

    // `session/prompt` streams assistant chunks (as notifications) before
    // answering, mimicking a real agent's response stream.
    if (method === 'session/prompt') {
      const sessionId = params?.sessionId ?? 'echo-session'
      const texts: string[] = (params?.prompt ?? [])
        .filter((block: { type?: string }) => block.type === 'text')
        .map((block: { text: string }) => block.text)
      // Echo back what was received, so tests can see the prompt as the
      // agent got it (e.g. after `prompt.before` hooks).
      sessionUpdate(sessionId, {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: texts.join('\n') },
      })

      if (parseScenario(texts)) {
        void runScenario(id, sessionId, texts)
        return
      }

      sessionUpdate(sessionId, {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'm1',
        content: { type: 'text', text: PROMPT_TEXT },
      })
      sessionUpdate(sessionId, {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'm1',
        content: { type: 'text', text: ' (end)' },
      })
    }

    const stub = STUBS[method as string]
    const result: Record<string, unknown> = stub ? stub(params ?? {}) : {}
    const sessionId = (result.sessionId ?? params?.sessionId) as
      | string
      | undefined
    if (sessionId && typeof params?.cwd === 'string') {
      sessionCwds.set(sessionId, params.cwd)
    }
    write({
      jsonrpc: '2.0',
      id,
      result,
    })

    // Like real agents, advertise the slash commands right after the session
    // is (re)opened; the server indexes the session as soon as it gets the
    // response, so the update is routed.
    if (sessionId && SESSION_OPENERS.has(method)) {
      sessionUpdate(sessionId, availableCommandsUpdate())
    }
  } catch {
    // Ignore malformed frames
  }
})
