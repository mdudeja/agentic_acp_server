import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { AcpClient } from '../../src/acp/Client'

describe('acp.AcpClient', () => {
  let client: AcpClient
  let mockFsHandler: any
  let mockPermissionHandler: any
  let mockTerminalHandler: any
  let mockSessionUpdateHandler: any

  beforeEach(() => {
    mockFsHandler = {
      readTextFile: mock(async () => ({ content: 'test fs' })),
      writeTextFile: mock(async () => ({})),
    }
    mockPermissionHandler = {
      requestPermission: mock(async () => ({})),
    }
    mockTerminalHandler = {
      createTerminal: mock(async () => ({})),
      terminalOutput: mock(async () => ({})),
      waitForTerminalExit: mock(async () => ({})),
      killTerminal: mock(async () => ({})),
      releaseTerminal: mock(async () => ({})),
    }
    mockSessionUpdateHandler = {
      handleUpdate: mock(async () => {}),
    }

    client = new AcpClient(
      mockFsHandler,
      mockPermissionHandler,
      mockTerminalHandler,
      mockSessionUpdateHandler,
    )
  })

  test('setAgent and getAgent', () => {
    expect(client.getAgent()).toBeNull()
    const mockAgent: any = { id: 'agent-123' }
    client.setAgent(mockAgent)
    expect(client.getAgent()).toBe(mockAgent)
  })

  test('requestPermission delegates properly', async () => {
    const params: any = { type: 'read', path: '/foo' }
    await client.requestPermission(params)
    expect(mockPermissionHandler.requestPermission).toHaveBeenCalledWith(params)
  })

  test('sessionUpdate delegates properly', async () => {
    const params: any = { sessionId: 'sid1', update: { foo: 'bar' } }
    await client.sessionUpdate(params)
    expect(mockSessionUpdateHandler.handleUpdate).toHaveBeenCalledWith('sid1', {
      foo: 'bar',
    })
  })

  describe('File System delegates', () => {
    test('readTextFile', async () => {
      const params: any = { path: '/test' }
      const res = await client.readTextFile(params)
      expect(mockFsHandler.readTextFile).toHaveBeenCalledWith(params)
      expect(res).toEqual({ content: 'test fs' })
    })

    test('writeTextFile', async () => {
      const params: any = { path: '/test', content: 'bar' }
      await client.writeTextFile(params)
      expect(mockFsHandler.writeTextFile).toHaveBeenCalledWith(params)
    })
  })

  describe('Terminal delegates', () => {
    test('createTerminal', async () => {
      const params: any = { command: 'echo' }
      await client.createTerminal(params)
      expect(mockTerminalHandler.createTerminal).toHaveBeenCalledWith(params)
    })

    test('terminalOutput', async () => {
      const params: any = { terminalId: 't1' }
      await client.terminalOutput(params)
      expect(mockTerminalHandler.terminalOutput).toHaveBeenCalledWith(params)
    })

    test('waitForTerminalExit', async () => {
      const params: any = { terminalId: 't1' }
      await client.waitForTerminalExit(params)
      expect(mockTerminalHandler.waitForTerminalExit).toHaveBeenCalledWith(
        params,
      )
    })

    test('killTerminal', async () => {
      const params: any = { terminalId: 't1' }
      await client.killTerminal(params)
      expect(mockTerminalHandler.killTerminal).toHaveBeenCalledWith(params)
    })

    test('releaseTerminal', async () => {
      const params: any = { terminalId: 't1' }
      await client.releaseTerminal(params)
      expect(mockTerminalHandler.releaseTerminal).toHaveBeenCalledWith(params)
    })
  })
})
