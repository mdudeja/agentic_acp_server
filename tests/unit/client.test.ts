import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { AcpClient } from '../../src/acp/Client'

describe('acp.AcpClient', () => {
  let client: AcpClient
  let mockFsHandler: any
  let mockPermissionHandler: any
  let mockTerminalHandler: any
  let mockSessionUpdateHandler: any
  let mockElicitationHandler: any

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
    mockElicitationHandler = {
      createElicitation: mock(async () => ({ action: 'accept' })),
      completeElicitation: mock(async () => {}),
    }

    client = new AcpClient(
      mockFsHandler,
      mockPermissionHandler,
      mockTerminalHandler,
      mockSessionUpdateHandler,
      mockElicitationHandler,
    )
  })

  test('setAgent and getAgent', () => {
    expect(client.getAgent()).toBeNull()
    const mockAgent: any = { id: 'agent-123' }
    client.setAgent(mockAgent)
    expect(client.getAgent()).toBe(mockAgent)
  })

  test('requestPermission delegates properly', async () => {
    const params: any = {
      sessionId: 'sid1',
      toolCall: { toolCallId: 't1', title: 'Read /foo' },
      options: [],
    }
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

  describe('Elicitation delegates', () => {
    test('createElicitation', async () => {
      const params: any = { message: 'Need input', mode: 'form' }
      await client.createElicitation(params)
      expect(mockElicitationHandler.createElicitation).toHaveBeenCalledWith(
        params,
      )
    })

    test('completeElicitation', async () => {
      const params: any = { elicitationId: 'elic1' }
      await client.completeElicitation(params)
      expect(mockElicitationHandler.completeElicitation).toHaveBeenCalledWith(
        params,
      )
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
      const params: any = { command: 'echo', sessionId: 'sid1' }
      await client.createTerminal(params)
      expect(mockTerminalHandler.createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'echo', args: [] }),
      )
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

  describe('hooks', () => {
    /** A hooks bridge answering each event from `answers`. */
    function withHooks(answers: Record<string, (input: any) => any>) {
      const ran: Array<{ event: string; input: any }> = []
      const hooks = {
        run: mock(async (event: string, input: any) => {
          ran.push({ event, input })
          const answer = answers[event]?.(input) ?? {}
          return { input: { ...input, ...answer.input }, ...answer }
        }),
        localSessionId: (acpId: string) => `local-${acpId}`,
      }
      const hooked = new AcpClient(
        mockFsHandler,
        mockPermissionHandler,
        mockTerminalHandler,
        mockSessionUpdateHandler,
        mockElicitationHandler,
        hooks as any,
      )
      return { client: hooked, ran }
    }

    const permission: any = {
      sessionId: 'acp1',
      toolCall: { toolCallId: 't1', title: 'rm stuff' },
      options: [
        { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
        { optionId: 'no', name: 'Reject', kind: 'reject_once' },
      ],
    }

    test('a permission decision answers without asking the user', async () => {
      const allowed = withHooks({
        'permission.request': () => ({ decision: 'allow' }),
      })
      expect(await allowed.client.requestPermission(permission)).toMatchObject({
        outcome: { outcome: 'selected', optionId: 'yes' },
      })

      const denied = withHooks({
        'permission.request': () => ({ decision: 'deny' }),
      })
      expect(await denied.client.requestPermission(permission)).toMatchObject({
        outcome: { outcome: 'selected', optionId: 'no' },
      })

      expect(mockPermissionHandler.requestPermission).not.toHaveBeenCalled()
      expect(allowed.ran[0]?.input.sessionId).toBe('local-acp1')
    })

    test('no decision falls through to the permission prompt', async () => {
      const { client: hooked } = withHooks({})
      await hooked.requestPermission(permission)
      expect(mockPermissionHandler.requestPermission).toHaveBeenCalled()
    })

    test('fs.beforeWrite can rewrite or refuse a write; fs.afterWrite follows', async () => {
      const rewritten = withHooks({
        'fs.beforeWrite': (input) => ({
          input: { content: input.content.toUpperCase() },
        }),
      })
      await rewritten.client.writeTextFile({
        sessionId: 'acp1',
        path: '/tmp/a.txt',
        content: 'hi',
      } as any)
      expect(mockFsHandler.writeTextFile).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'HI' }),
      )
      expect(rewritten.ran.map((r) => r.event)).toEqual([
        'fs.beforeWrite',
        'fs.afterWrite',
      ])

      mockFsHandler.writeTextFile.mockClear()
      const refused = withHooks({
        'fs.beforeWrite': () => ({
          decision: 'deny',
          reason: 'nope',
          decidedBy: 'guard',
        }),
      })
      await expect(
        refused.client.writeTextFile({
          sessionId: 'acp1',
          path: '/tmp/a.txt',
          content: 'hi',
        } as any),
      ).rejects.toThrow('blocked by hook guard: nope')
      expect(mockFsHandler.writeTextFile).not.toHaveBeenCalled()
    })

    test('fs.beforeRead can refuse a read', async () => {
      const { client: hooked } = withHooks({
        'fs.beforeRead': () => ({ decision: 'deny', decidedBy: 'guard' }),
      })
      await expect(
        hooked.readTextFile({ sessionId: 'acp1', path: '/tmp/.env' } as any),
      ).rejects.toThrow('blocked by hook guard')
      expect(mockFsHandler.readTextFile).not.toHaveBeenCalled()
    })

    test('terminal.beforeCreate can rewrite the command', async () => {
      mockTerminalHandler.createTerminal = mock(async () => ({
        terminalId: 'term1',
      }))
      const { client: hooked, ran } = withHooks({
        'terminal.beforeCreate': () => ({
          input: { command: 'bun', args: ['test'] },
        }),
      })

      await hooked.createTerminal({
        sessionId: 'acp1',
        command: 'npm',
        args: ['test'],
      } as any)
      expect(mockTerminalHandler.createTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'bun', args: ['test'] }),
      )

      mockTerminalHandler.waitForTerminalExit = mock(async () => ({
        exitCode: 1,
      }))
      await hooked.waitForTerminalExit({
        sessionId: 'acp1',
        terminalId: 'term1',
      } as any)
      expect(ran.at(-1)).toMatchObject({
        event: 'terminal.afterExit',
        input: { terminalId: 'term1', command: 'bun test', exitCode: 1 },
      })
    })

    test('an elicitation decision answers it without asking the user', async () => {
      const { client: hooked } = withHooks({
        'elicitation.request': () => ({
          decision: 'allow',
          input: { content: { name: 'Ada' } },
        }),
      })
      expect(
        await hooked.createElicitation({
          mode: 'form',
          message: 'Who?',
          requestedSchema: { type: 'object', properties: {} },
        } as any),
      ).toEqual({ action: 'accept', content: { name: 'Ada' } })
      expect(mockElicitationHandler.createElicitation).not.toHaveBeenCalled()
    })
  })
})
