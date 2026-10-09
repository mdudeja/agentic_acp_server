import {
  describe,
  test,
  expect,
  spyOn,
  beforeEach,
  afterEach,
  mock,
} from 'bun:test'
import { SessionUpdateHandler } from '../../src/acp/handlers/SessionUpdateHandler'
import * as logger from '../../src/utils/logger'

describe('Handlers.SessionUpdateHandler', () => {
  let handler: SessionUpdateHandler
  let mockServer: any
  let mockCommsInterface: any

  beforeEach(() => {
    mockCommsInterface = {
      notify: mock(() => {}),
    }
    mockServer = {
      getCommsInterface: mock(() => mockCommsInterface),
    }
    handler = new SessionUpdateHandler(mockServer)
  })

  afterEach(() => {
    mock.restore()
  })

  test('registers and deregisters listeners using on/off', async () => {
    let callCount = 0
    const listener = async (sid: string, _update: any) => {
      callCount++
      expect(sid).toBe('session-1')
    }

    // Register
    handler.on('user_message_chunk', listener)

    // Fire event (should hit listener)
    await handler.handleUpdate('session-1', {
      sessionUpdate: 'user_message_chunk',
    } as any)
    expect(callCount).toBe(1)

    // Deregister
    handler.off('user_message_chunk', listener)

    // Fire event again (should NOT hit listener)
    await handler.handleUpdate('session-1', {
      sessionUpdate: 'user_message_chunk',
    } as any)
    expect(callCount).toBe(1)
  })

  test('handleUpdate does nothing if no listeners exist', async () => {
    const val = await handler.handleUpdate('session-99', {
      sessionUpdate: 'mode',
    } as any)
    expect(val).not.toBeDefined()
  })

  test('handleUpdate catches listener errors and logs/notifies them', async () => {
    const errorListener = async () => {
      throw new Error('Listener completely exploded')
    }

    const logSpy = spyOn(logger, 'logError').mockImplementation(() => {})

    handler.on('user_message_chunk', errorListener)

    // Should not throw outward
    await handler.handleUpdate('session-error', {
      sessionUpdate: 'user_message_chunk',
    } as any)

    expect(logSpy).toHaveBeenCalled()
    expect(mockCommsInterface.notify).toHaveBeenCalled()

    const notifyArg = mockCommsInterface.notify.mock.calls[0][0]
    expect(notifyArg.method).toBe('agentic/log')
    expect(notifyArg.data.level).toBe('error')
    expect(notifyArg.data.message).toContain('Listener completely exploded')

    logSpy.mockRestore()
  })

  describe('whenDrained', () => {
    const chunk = {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'hi' },
    } as any

    /** Resolves to whether `promise` settled within a macrotask. */
    const settled = async (promise: Promise<void>) => {
      let done = false
      promise.then(() => {
        done = true
      })
      await Bun.sleep(0)
      return done
    }

    test('resolves immediately when nothing is in flight', async () => {
      expect(await settled(handler.whenDrained())).toBe(true)
    })

    test('waits for updates received before the call to be handled', async () => {
      const seen: string[] = []
      handler.on('agent_message_chunk', async (_id, update: any) => {
        seen.push(update.content.text)
      })

      handler.noteReceived()
      const drained = handler.whenDrained()
      expect(await settled(drained)).toBe(false)

      await handler.handleUpdate('acp-1', chunk)

      expect(await settled(drained)).toBe(true)
      expect(seen).toEqual(['hi'])
    })

    test('an update whose listener throws still counts as handled', async () => {
      spyOn(logger, 'logError').mockImplementation(() => {})
      handler.on('agent_message_chunk', async () => {
        throw new Error('listener failed')
      })

      handler.noteReceived()
      const drained = handler.whenDrained()
      await handler.handleUpdate('acp-1', chunk)

      expect(await settled(drained)).toBe(true)
    })

    test('gives up after the timeout if an update never arrives', async () => {
      handler.noteReceived()
      const start = Date.now()

      await handler.whenDrained(20)

      expect(Date.now() - start).toBeGreaterThanOrEqual(15)
    })
  })
})
