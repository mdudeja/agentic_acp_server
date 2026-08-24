import { describe, test, expect, spyOn, beforeEach, afterEach } from 'bun:test'
import { AgenticServer } from '../../src/AgenticServer'
import type { ASMPayload } from 'src/openrpc/schemas'
import { join } from 'path'
import { commandResponseRoundTrip } from 'tests/helpers/commandResponseRoundTrip'
import type { ServerResponse } from 'src/comms/ICommsInterface'
import { InMemoryCommsInterface } from 'tests/helpers/InMemoryCommsInterface'

describe('Commands.EditorResponds', () => {
  let server: AgenticServer

  beforeEach(async () => {
    const init_payload = {
      jsonrpc: '2.0',
      data: {
        method: 'client/init',
        params: {
          requestId: 'test-init-req-id',
          provider: 'echo',
          cwd: join(import.meta.dir, '..', '..'),
        },
      },
    } as ASMPayload

    let comms = new InMemoryCommsInterface()
    server = new AgenticServer({
      mode: process.env.ACP_APP_MODE || 'server',
      port: parseInt(process.env.ACP_HTTP_PORT ?? '3778', 10),
      exitOnDispose: false,
      commsInterface: process.env.ACP_APP_MODE === 'rpc' ? comms : undefined,
      disposeOnCommsInterfaceClose: false,
    })
    await server.init(join(import.meta.dir, '..', '..'))
    await commandResponseRoundTrip(
      init_payload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )
  })

  afterEach(() => {
    server.dispose()
  })

  test('returns an error when there is no pending question for client/answer', async () => {
    const comms = server.getCommsInterface()
    const spyProcessAnswer = spyOn(comms, 'processAnswer')

    const payload = {
      jsonrpc: '2.0',
      data: {
        method: 'client/answer',
        params: {
          requestId: 'test-answer-req-id',
          questionId: 'non-existent-question-id',
          answer: 'This should not be processed',
        },
      },
    } as ASMPayload

    const resp = await commandResponseRoundTrip(
      payload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )
    const lastMessage = resp[resp.length - 1] as ServerResponse

    expect(lastMessage).toBeDefined()
    expect(lastMessage.type).toBe('response')
    expect(lastMessage.method).toBe('client/answer')
    expect(lastMessage.error).toBeDefined()
    expect(lastMessage.error?.code).toBe(-32000)
    expect(lastMessage.error?.message).toContain(
      'No pending question found for questionId non-existent-question-id',
    )
    expect(spyProcessAnswer).not.toHaveBeenCalled()
  })

  test('returns an error when client/answer is malformed', async () => {
    const payload = {
      jsonrpc: '2.0',
      data: {
        method: 'client/answer',
        params: {
          requestId: 'test-answer-req-id',
          // Missing questionId and answer
        },
      },
    } as ASMPayload

    try {
      await commandResponseRoundTrip(
        payload,
        server.getCommsInterface() as InMemoryCommsInterface,
      )
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as any).message).toMatch(/Received error notification/)
    }
  })

  test('correct client/answer resolves pending question', async () => {
    const comms = server.getCommsInterface()
    const spyProcessAnswer = spyOn(comms, 'processAnswer')
    const questionPromise = comms.question({
      questionId: 'question_1',
      question: 'What is 2 + 2?',
    })

    const payload = {
      jsonrpc: '2.0',
      data: {
        method: 'client/answer',
        params: {
          requestId: 'test-answer-req-id',
          questionId: 'question_1',
          answer: '4',
        },
      },
    } as ASMPayload

    // Wait a tick to ensure the question is registered before sending the answer
    await new Promise((resolve) => setTimeout(resolve, 100))

    const resp = await commandResponseRoundTrip(
      payload,
      server.getCommsInterface() as InMemoryCommsInterface,
    )
    const lastMessage = resp[resp.length - 1] as ServerResponse

    expect(lastMessage).toBeDefined()
    expect(lastMessage.type).toBe('response')
    expect(lastMessage.method).toBe('client/answer')
    expect(lastMessage.error).toBeUndefined()
    expect(lastMessage.result).toBeDefined()
    expect(lastMessage.result?.success).toBe(true)
    expect(lastMessage.result?.questionId).toBe('question_1')

    const answer = await questionPromise
    expect(answer).toBe('4')

    expect(spyProcessAnswer).toHaveBeenCalledTimes(1)
  })
})
