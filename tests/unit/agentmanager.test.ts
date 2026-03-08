import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import type { Subprocess } from 'bun'
import { unlinkSync } from 'node:fs'
import { AgentManager } from 'src/managers/AgentManager'
import { Providers } from 'src/data/providers'
import { AgenticServer } from 'main'
import { AgenticDB } from 'src/database/AgenticDB'
import { MockCommsInterface } from '../helpers/MockCommsInterface'
import { MockAgentProcess } from '../helpers/MockAgentProcess'

// ---------------------------------------------------------------------------
// Shared test DB — seeded before any test runs, torn down after all tests
// ---------------------------------------------------------------------------

const TEST_DB = `/tmp/agentic-test-agentmanager-${Date.now()}.db`

beforeAll(() => {
  // Seed the AgenticDB singleton with a throwaway SQLite file.
  // AgentManager calls AgenticDB.getInstance() with no args, which returns
  // this singleton. getDB() runs migrations automatically.
  AgenticDB.getInstance(TEST_DB).getDB()
})

afterAll(() => {
  try {
    unlinkSync(TEST_DB)
    unlinkSync(`${TEST_DB}-shm`)
    unlinkSync(`${TEST_DB}-wal`)
  } catch {
    // best-effort cleanup
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeServer() {
  const comms = new MockCommsInterface()
  const server = new AgenticServer({ mode: 'rpc', commsInterface: comms })
  return { server, comms }
}

const INIT_RESULT = {
  protocolVersion: 1,
  agentCapabilities: { loadSession: false },
  authMethods: [],
} as const

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentManager', () => {
  it('emits agent.connected after init → spawn → connect', async () => {
    const { server } = makeServer()
    const mock = new MockAgentProcess(INIT_RESULT)

    const am = new AgentManager(
      Providers.copilot,
      '/tmp/agentic-test-cwd',
      server,
      () => mock as unknown as Subprocess,
    )

    // Collect the agent.connected payload
    let connectedPayload: unknown
    const connectedPromise = new Promise<void>((resolve) => {
      am.once('agent.connected', (payload) => {
        connectedPayload = payload
        resolve()
      })
    })

    await am.init()
    am.spawn()
    await am.connect()

    // agent.connected is emitted synchronously from within connect(), so by
    // the time connect() resolves the promise is already resolved.
    await connectedPromise

    expect(connectedPayload).toBeDefined()
    const payload = connectedPayload as {
      data: { id: string; provider_name: string }
    }
    expect(typeof payload.data.id).toBe('string')
    expect(payload.data.provider_name).toBe(Providers.copilot)
  })

  it('connect() returns initResponse with protocolVersion from mock', async () => {
    const { server } = makeServer()
    const mock = new MockAgentProcess(INIT_RESULT)

    const am = new AgentManager(
      Providers.copilot,
      '/tmp/agentic-test-cwd-2',
      server,
      () => mock as unknown as Subprocess,
    )

    await am.init()
    am.spawn()
    const result = await am.connect()

    expect(result).toBeDefined()
    expect(result!.initResponse.protocolVersion).toBe(
      INIT_RESULT.protocolVersion,
    )
  })
})
