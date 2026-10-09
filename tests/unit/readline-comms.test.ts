import {
  describe,
  test,
  expect,
  spyOn,
  beforeEach,
  afterEach,
  mock,
} from 'bun:test'
import { ReadlineCommsInterface } from '../../src/comms/ReadlineCommsInterface'
import * as readline from 'readline/promises'
import EventEmitter from 'events'

describe('Comms.ReadlineCommsInterface', () => {
  let comms: ReadlineCommsInterface
  let mockRlInterface: any
  let stdoutSpy: any

  beforeEach(() => {
    mockRlInterface = new EventEmitter()
    mockRlInterface.close = mock(() => {
      mockRlInterface.emit('close')
    })
    mockRlInterface.question = mock(async (_q: string) => {
      return 'mocked answer'
    })

    spyOn(readline, 'createInterface').mockReturnValue(mockRlInterface as any)
    stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(() => true)

    comms = new ReadlineCommsInterface()
  })

  afterEach(() => {
    comms.dispose()
    mock.restore()
  })

  test('init creates a readline interface', async () => {
    await comms.init()
    expect(readline.createInterface).toHaveBeenCalled()
  })

  test('throws if sending respond/notify/question before init', async () => {
    expect(() => comms.respond({ method: 'client/init', result: {} })).toThrow(
      'Readline interface not initialized',
    )
    expect(() =>
      comms.notify({
        method: 'agentic/log',
        data: { level: 'info', message: 'test' },
      }),
    ).toThrow('Readline interface not initialized')
    try {
      await comms.question({ question: 'Test?', questionId: '123' })
    } catch (err: any) {
      expect(err.message).toBe('Readline interface not initialized')
    }
  })

  test('onMessage registers callback and processes lines', async () => {
    await comms.init()

    let receivedMessage = ''
    comms.onMessage(async (msg) => {
      receivedMessage = msg
    })

    // Simulate empty line (should be ignored)
    mockRlInterface.emit('line', '   \n')
    expect(receivedMessage).toBe('')

    // Simulate valid line
    mockRlInterface.emit('line', '{"test": true}')

    // Wait for microtasks
    await Promise.resolve()

    expect(receivedMessage).toBe('{"test": true}')
  })

  test('onClose registers callback and processes closes', async () => {
    await comms.init()

    let closed = false
    comms.onClose(() => {
      closed = true
    })

    mockRlInterface.emit('close')

    expect(closed).toBe(true)
  })

  test('respond writes formatted JSON to stdout', async () => {
    await comms.init()

    comms.respond({
      method: 'client/init',
      id: 'req-123',
      result: { ok: true },
    })

    expect(stdoutSpy).toHaveBeenCalled()
    const writtenStr = stdoutSpy.mock.calls[0][0]
    const parsed = JSON.parse(writtenStr)

    expect(parsed.jsonrpc).toBe('2.0')
    expect(parsed.type).toBe('response')
    expect(parsed.method).toBe('client/init')
    expect(parsed.id).toBe('req-123')
    expect(parsed.result).toEqual({ ok: true })
    expect(writtenStr.endsWith('\n')).toBe(true)
  })

  test('respond formats errors correctly', async () => {
    await comms.init()

    comms.respond({
      method: 'client/init',
      id: 'req-123',
      error: new Error('Something failed'),
    })

    const writtenStr = stdoutSpy.mock.calls[0][0]
    const parsed = JSON.parse(writtenStr)

    expect(parsed.error).toEqual({
      code: -32000,
      message: 'Something failed',
    })
  })

  test('notify writes formatted JSON to stdout', async () => {
    await comms.init()

    comms.notify({
      method: 'agentic/log',
      data: { level: 'info', message: 'test' },
    })

    expect(stdoutSpy).toHaveBeenCalled()
    const writtenStr = stdoutSpy.mock.calls[0][0]
    const parsed = JSON.parse(writtenStr)

    expect(parsed.jsonrpc).toBe('2.0')
    expect(parsed.type).toBe('notification')
    expect(parsed.method).toBe('agentic/log')
    expect(parsed.data).toEqual({ level: 'info', message: 'test' })
  })

  /** Parsed JSON lines written to stdout so far. */
  const written = () =>
    stdoutSpy.mock.calls.map((c: any) => JSON.parse(c[0] as string))

  const answerLine = (questionId: string, answer: string) =>
    JSON.stringify({
      jsonrpc: '2.0',
      data: {
        method: 'client/answer',
        params: { requestId: `answer-${questionId}`, questionId, answer },
      },
    })

  test('question notifies the editor and resolves from a client/answer line', async () => {
    await comms.init()
    const dispatched: string[] = []
    comms.onMessage(async (msg) => {
      dispatched.push(msg)
    })

    const answerPromise = comms.question({
      questionId: 'q1',
      question: 'Hello?',
      options: [{ id: 'a', label: 'A' }],
    })

    expect(comms.hasPendingQuestions()).toBe(true)
    expect(written()[0]).toMatchObject({
      type: 'notification',
      method: 'agentic/question',
      data: { questionId: 'q1', question: 'Hello?', options: [{ id: 'a' }] },
    })

    mockRlInterface.emit('line', answerLine('q1', 'a'))

    expect(await answerPromise).toBe('a')
    expect(comms.hasPendingQuestions()).toBe(false)
    expect(dispatched).toEqual([])
    expect(written()[1]).toMatchObject({
      type: 'response',
      method: 'client/answer',
      id: 'answer-q1',
      result: { success: true, questionId: 'q1' },
    })
  })

  test('never writes raw readline prompts to stdout', async () => {
    await comms.init()
    comms.question({ question: 'Hello?' }).catch(() => {})
    expect(mockRlInterface.question).not.toHaveBeenCalled()
    for (const call of stdoutSpy.mock.calls) {
      expect(() => JSON.parse(call[0] as string)).not.toThrow()
    }
  })

  test('a reused questionId gets a unique id instead of clobbering', async () => {
    await comms.init()
    comms.onMessage(async () => {})

    const first = comms.question({ questionId: 'select_mode', question: '1?' })
    // The second question is never answered; dispose rejects it.
    comms.question({ questionId: 'select_mode', question: '2?' }).catch(() => {})

    const [firstId, secondId] = written().map((m: any) => m.data.questionId)
    expect(firstId).toBe('select_mode')
    expect(secondId).not.toBe('select_mode')

    mockRlInterface.emit('line', answerLine('select_mode', 'one'))
    expect(await first).toBe('one')
    expect(comms.hasPendingQuestions()).toBe(true)
  })

  test('answers for unknown questions go to the dispatcher', async () => {
    await comms.init()
    const dispatched: string[] = []
    comms.onMessage(async (msg) => {
      dispatched.push(msg)
    })
    comms.question({ questionId: 'q1', question: 'Hello?' }).catch(() => {})

    const unknown = answerLine('nope', 'x')
    mockRlInterface.emit('line', unknown)

    expect(dispatched).toEqual([unknown])
    expect(comms.hasPendingQuestions()).toBe(true)
  })

  test('messages that merely mention client/answer are not swallowed', async () => {
    await comms.init()
    const dispatched: string[] = []
    comms.onMessage(async (msg) => {
      dispatched.push(msg)
    })
    comms.question({ question: 'Hello?' }).catch(() => {})

    const ask = JSON.stringify({
      jsonrpc: '2.0',
      data: {
        method: 'client/ask',
        params: { requestId: 'r1', prompt: 'what does client/answer do?' },
      },
    })
    mockRlInterface.emit('line', ask)

    expect(dispatched).toEqual([ask])
  })

  test('aborting the signal rejects and forgets the question', async () => {
    await comms.init()
    const controller = new AbortController()
    const answerPromise = comms.question(
      { question: 'Hello?' },
      { signal: controller.signal },
    )

    controller.abort()

    await expect(answerPromise).rejects.toThrow('cancelled')
    expect(comms.hasPendingQuestions()).toBe(false)
  })

  test('dispose rejects pending questions', async () => {
    await comms.init()
    const answerPromise = comms.question({ question: 'Hello?' })

    comms.dispose()

    await expect(answerPromise).rejects.toThrow('Comms interface disposed')
  })

  test('dispose cleans up listeners and reader', async () => {
    await comms.init()

    spyOn(mockRlInterface, 'removeAllListeners')
    spyOn(mockRlInterface, 'close')

    comms.dispose()

    expect(mockRlInterface.removeAllListeners).toHaveBeenCalledWith('line')
    expect(mockRlInterface.close).toHaveBeenCalled()

    // Should throw if used after dispose
    expect(() => comms.respond({ method: 'client/init' })).toThrow()
  })
})
