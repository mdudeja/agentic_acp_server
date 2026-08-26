import { describe, expect, it, mock, beforeEach } from 'bun:test'
import { NesManager } from '../../src/managers/NesManager'

describe('NesManager', () => {
  let mockServerInstance: any
  let nesManager: NesManager
  let requestMock: any
  let notifyMock: any

  beforeEach(() => {
    requestMock = mock(async (_method: string, _params: any) => {
      return {}
    })
    notifyMock = mock(async () => {})
    const connection = {
      clientContext: {
        request: requestMock,
        notify: notifyMock,
      },
    }
    mockServerInstance = {
      hasCapability: mock((capability: string) => capability === 'nes'),
      getState: () => ({ connection }),
    }
    nesManager = new NesManager(mockServerInstance)
    nesManager.init()
  })

  it('emits nes.error when the agent does not advertise the nes capability', async () => {
    mockServerInstance.hasCapability = mock(() => false)
    const errorSpy = mock(() => {})
    nesManager.on('nes.error', errorSpy)

    await nesManager.startNes({})

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect((errorSpy.mock.calls[0] as any[])[0]).toMatch(/does not support NES/)
  })

  it('emits nes.error when there is no active connection', async () => {
    mockServerInstance.getState = () => ({ connection: undefined })
    const freshManager = new NesManager(mockServerInstance)
    const errorSpy = mock(() => {})
    freshManager.on('nes.error', errorSpy)

    await freshManager.startNes({})

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect((errorSpy.mock.calls[0] as any[])[0]).toMatch(/No active connection/)
  })

  it('startNes calls nes/start and emits nes.started', async () => {
    requestMock.mockImplementation(async () => ({ sessionId: 'nes-1' }))

    const startedSpy = mock(() => {})
    nesManager.on('nes.started', startedSpy)

    const resp = await nesManager.startNes({ workspaceUri: 'file:///tmp' })

    expect(requestMock).toHaveBeenCalledWith('nes/start', {
      workspaceUri: 'file:///tmp',
    })
    expect(resp?.sessionId).toBe('nes-1')
    expect(startedSpy).toHaveBeenCalledTimes(1)
    expect((startedSpy.mock.calls[0] as any[])[0].data).toBe('nes-1')
  })

  it('suggestNes calls nes/suggest and emits nes.suggested', async () => {
    requestMock.mockImplementation(async () => ({ suggestions: [] }))

    const suggestedSpy = mock(() => {})
    nesManager.on('nes.suggested', suggestedSpy)

    const resp = await nesManager.suggestNes({
      sessionId: 'nes-1',
      uri: 'file:///tmp/a.ts',
      version: 1,
      position: { line: 0, character: 0 },
      triggerKind: 'manual',
    })

    expect(requestMock).toHaveBeenCalledWith('nes/suggest', expect.anything())
    expect(resp?.suggestions).toEqual([])
    expect(suggestedSpy).toHaveBeenCalledTimes(1)
  })

  it('closeNes calls nes/close and emits nes.closed', async () => {
    const closedSpy = mock(() => {})
    nesManager.on('nes.closed', closedSpy)

    const resp = await nesManager.closeNes('nes-1')

    expect(requestMock).toHaveBeenCalledWith('nes/close', { sessionId: 'nes-1' })
    expect(resp?.success).toBe(true)
    expect(closedSpy).toHaveBeenCalledTimes(1)
  })

  it('acceptNes notifies nes/accept', async () => {
    const resp = await nesManager.acceptNes('nes-1', 'sugg-1')

    expect(notifyMock).toHaveBeenCalledWith('nes/accept', {
      sessionId: 'nes-1',
      id: 'sugg-1',
    })
    expect(resp?.success).toBe(true)
  })

  it('rejectNes notifies nes/reject with reason', async () => {
    const resp = await nesManager.rejectNes('nes-1', 'sugg-1', 'rejected')

    expect(notifyMock).toHaveBeenCalledWith('nes/reject', {
      sessionId: 'nes-1',
      id: 'sugg-1',
      reason: 'rejected',
    })
    expect(resp?.success).toBe(true)
  })

  it('didOpenDocument notifies document/didOpen', async () => {
    await nesManager.didOpenDocument({
      sessionId: 'nes-1',
      uri: 'file:///tmp/a.ts',
      languageId: 'typescript',
      version: 1,
      text: 'const x = 1',
    })

    expect(notifyMock).toHaveBeenCalledWith(
      'document/didOpen',
      expect.objectContaining({ sessionId: 'nes-1', uri: 'file:///tmp/a.ts' }),
    )
  })

  it('didChangeDocument notifies document/didChange', async () => {
    await nesManager.didChangeDocument({
      sessionId: 'nes-1',
      uri: 'file:///tmp/a.ts',
      version: 2,
      contentChanges: [{ text: 'const y = 2' }],
    })

    expect(notifyMock).toHaveBeenCalledWith(
      'document/didChange',
      expect.objectContaining({ sessionId: 'nes-1', version: 2 }),
    )
  })

  it('didCloseDocument notifies document/didClose', async () => {
    await nesManager.didCloseDocument('nes-1', 'file:///tmp/a.ts')

    expect(notifyMock).toHaveBeenCalledWith('document/didClose', {
      sessionId: 'nes-1',
      uri: 'file:///tmp/a.ts',
    })
  })

  it('didSaveDocument notifies document/didSave', async () => {
    await nesManager.didSaveDocument('nes-1', 'file:///tmp/a.ts')

    expect(notifyMock).toHaveBeenCalledWith('document/didSave', {
      sessionId: 'nes-1',
      uri: 'file:///tmp/a.ts',
    })
  })

  it('didFocusDocument notifies document/didFocus', async () => {
    await nesManager.didFocusDocument({
      sessionId: 'nes-1',
      uri: 'file:///tmp/a.ts',
      version: 3,
      position: { line: 0, character: 0 },
      visibleRange: {
        start: { line: 0, character: 0 },
        end: { line: 10, character: 0 },
      },
    })

    expect(notifyMock).toHaveBeenCalledWith(
      'document/didFocus',
      expect.objectContaining({ sessionId: 'nes-1' }),
    )
  })
})
