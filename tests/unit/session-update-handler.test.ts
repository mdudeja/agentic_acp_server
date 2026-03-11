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
})
