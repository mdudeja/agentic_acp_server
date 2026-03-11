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

  test('question registers pending question and mock answers it', async () => {
    await comms.init()

    expect(comms.hasPendingQuestions()).toBe(false)

    // Fire off question
    const answerPromise = comms.question({ question: 'Hello?' })

    // At this point, hasPendingQuestions is momentarily true until readline mock resolves
    // Since mockRlInterface.question is async, it resolves on the next tick
    const answer = await answerPromise

    expect(answer).toBe('mocked answer')
    expect(mockRlInterface.question).toHaveBeenCalledWith('Hello?')
    expect(comms.hasPendingQuestions()).toBe(false)

    // question also triggers a client/answer response
    expect(stdoutSpy).toHaveBeenCalled()
    const writtenLines = stdoutSpy.mock.calls.map((c: any) => c[0])
    const hasAnswerObj = writtenLines.some((line: string) => {
      try {
        const parsed = JSON.parse(line)
        return (
          parsed.method === 'client/answer' && parsed.result?.success === true
        )
      } catch {
        return false
      }
    })

    expect(hasAnswerObj).toBe(true)
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
