import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test'
import { TerminalHandler } from '../../src/acp/handlers/TerminalHandler'
import type { AgenticServer } from '../../src/AgenticServer'

describe('TerminalHandler', () => {
  let mockCommsInterface: any
  let mockServerInstance: AgenticServer
  let terminalHandler: TerminalHandler

  beforeEach(() => {
    mockCommsInterface = {
      notify: mock(() => {}),
      respond: mock(() => {}),
      onRequest: mock(() => {}),
      onNotification: mock(() => {}),
      start: mock(() => {}),
      stop: mock(() => {}),
    } as any

    mockServerInstance = {
      getCommsInterface: () => mockCommsInterface,
    } as any

    terminalHandler = new TerminalHandler(mockServerInstance)
  })

  afterEach(() => {
    terminalHandler.dispose()
  })

  describe('createTerminal', () => {
    it('sends create request and handles response', async () => {
      const createPromise = terminalHandler.createTerminal({
        command: 'echo "hello"',
        cwd: '/tmp',
        env: [{ name: 'TEST', value: '1' }],
        sessionId: 'session_123',
      })

      // Need to wait slightly for the promise to set up pending operation
      await Bun.sleep(1)

      const notifyCalls = mockCommsInterface.notify.mock.calls
      expect(notifyCalls.length).toBe(1)
      const notifyArgs = notifyCalls[0][0]
      expect(notifyArgs.method).toBe('agentic/terminal')
      expect(notifyArgs.data.command).toBe('echo "hello"')

      const requestId = notifyArgs.data.requestId

      // Simulate editor response
      terminalHandler.handleResponse({
        requestId,
        response: {
          request: 'create',
          params: { terminalId: 'term_123' },
        },
      })

      const result = await createPromise
      expect(result.terminalId).toBe('term_123')

      // Check internal state
      const terminals = terminalHandler.getActiveTerminals()
      expect(terminals.length).toBe(1)
      expect(terminals[0]?.command).toBe('echo "hello"')
    })

    it('handles comms interface unavailable', async () => {
      const serverWithoutComms = {
        getCommsInterface: () => null,
      } as any
      const handlerWithoutComms = new TerminalHandler(serverWithoutComms)

      await expect(
        handlerWithoutComms.createTerminal({
          command: 'ls',
          sessionId: 'session_123',
        }),
      ).rejects.toThrow('Comms interface not available')
      handlerWithoutComms.dispose()
    })
  })

  describe('terminalOutput', () => {
    it('throws error if terminal not found', async () => {
      expect(
        terminalHandler.terminalOutput({
          terminalId: 'nonexistent',
          sessionId: 'session_123',
        }),
      ).rejects.toThrow('Terminal not found')
    })

    it('retrieves output passing request through comms', async () => {
      // First create a terminal
      const createPromise = terminalHandler.createTerminal({
        command: 'ls',
        sessionId: 'session_123',
      })
      await Bun.sleep(1)
      const notifyData = mockCommsInterface.notify.mock.calls[0][0].data
      const createReqId = notifyData.requestId
      const actualTermId = notifyData.terminalId
      terminalHandler.handleResponse({
        requestId: createReqId,
        response: { request: 'create', params: { terminalId: actualTermId } },
      })
      const { terminalId } = await createPromise

      mockCommsInterface.notify.mockClear()

      // Now request output
      const outputPromise = terminalHandler.terminalOutput({
        terminalId,
        sessionId: 'session_123',
      })
      await Bun.sleep(1)

      const notifyCalls = mockCommsInterface.notify.mock.calls
      expect(notifyCalls.length).toBe(1)
      const reqId = notifyCalls[0][0].data.requestId

      // Simulate delayed response with output
      terminalHandler.handleResponse({
        requestId: reqId,
        response: {
          request: 'get_output',
          params: {
            stdout: 'hello\n',
            stderr: '',
            truncated: false,
          },
        },
      })

      const outputResult = await outputPromise
      expect(outputResult.output).toBe('hello\n')
      expect(outputResult.truncated).toBe(false)
    })
  })

  describe('editor-assigned ids and output', () => {
    /** Creates a terminal, answering the editor's create with `editorId`. */
    async function createAs(editorId?: string) {
      const createPromise = terminalHandler.createTerminal({
        command: 'ls',
        sessionId: 'session_123',
      })
      await Bun.sleep(1)
      const data = mockCommsInterface.notify.mock.calls.at(-1)[0].data
      terminalHandler.handleResponse({
        requestId: data.requestId,
        response: {
          request: 'create',
          params: { terminalId: editorId ?? data.terminalId },
        },
      })
      return createPromise
    }

    async function outputOf(
      terminalId: string,
      stdout: string,
      stderr: string,
    ) {
      const outputPromise = terminalHandler.terminalOutput({
        terminalId,
        sessionId: 'session_123',
      })
      await Bun.sleep(1)
      const reqId =
        mockCommsInterface.notify.mock.calls.at(-1)[0].data.requestId
      terminalHandler.handleResponse({
        requestId: reqId,
        response: { request: 'get_output', params: { stdout, stderr } },
      })
      return outputPromise
    }

    it('tracks the terminal under the id the editor returned', async () => {
      const { terminalId } = await createAs('nvim-term-7')

      expect(terminalId).toBe('nvim-term-7')
      expect(
        terminalHandler.getActiveTerminals().map((t) => t.terminalId),
      ).toEqual(['nvim-term-7'])
      // Later calls by the editor's id work.
      const result = await outputOf('nvim-term-7', 'ok\n', '')
      expect(result.output).toBe('ok\n')
    })

    it('keeps stdout when stderr is non-empty', async () => {
      const { terminalId } = await createAs()
      const result = await outputOf(terminalId, 'built\n', 'warning\n')
      expect(result.output).toBe('built\nwarning\n')
    })

    it('forgets a terminal whose create failed', async () => {
      const createPromise = terminalHandler.createTerminal({
        command: 'ls',
        sessionId: 'session_123',
      })
      await Bun.sleep(1)
      const data = mockCommsInterface.notify.mock.calls.at(-1)[0].data
      terminalHandler.handleResponse({
        requestId: data.requestId,
        error: { message: 'no terminal for you' },
      } as any)

      await expect(createPromise).rejects.toThrow('no terminal for you')
      expect(terminalHandler.getActiveTerminals()).toEqual([])
    })
  })

  describe('waitForTerminalExit', () => {
    it('throws error if terminal not found', async () => {
      expect(
        terminalHandler.waitForTerminalExit({
          terminalId: 'nonexistent',
          sessionId: 'session_123',
        }),
      ).rejects.toThrow('Terminal not found')
    })

    it('waits and returns exit code when terminal exits', async () => {
      // First create a terminal
      const createPromise = terminalHandler.createTerminal({
        command: 'ls',
        sessionId: 'session_123',
      })
      await Bun.sleep(1)
      const notifyData = mockCommsInterface.notify.mock.calls[0][0].data
      const createReqId = notifyData.requestId
      const actualTermId = notifyData.terminalId
      terminalHandler.handleResponse({
        requestId: createReqId,
        response: { request: 'create', params: { terminalId: actualTermId } },
      })
      const { terminalId } = await createPromise

      mockCommsInterface.notify.mockClear()

      // Wait for exit
      const waitPromise = terminalHandler.waitForTerminalExit({
        terminalId,
        sessionId: 'session_123',
      })
      await Bun.sleep(1)

      const reqId = mockCommsInterface.notify.mock.calls[0][0].data.requestId

      // Simulate exit response
      terminalHandler.handleResponse({
        requestId: reqId,
        response: {
          request: 'wait_exit',
          params: {
            exitStatus: { exitCode: 0 },
          },
        },
      })

      const result = await waitPromise
      expect(result.exitCode).toBe(0)

      // Verify internal state updated
      const termState = terminalHandler.getActiveTerminals()[0]
      expect(termState?.isRunning).toBe(false)
      expect(termState?.exitStatus?.exitCode).toBe(0)
    })
  })

  describe('killTerminal', () => {
    it('sends kill signal and updates state', async () => {
      // First create a terminal
      const createPromise = terminalHandler.createTerminal({
        command: 'ls',
        sessionId: 'session_123',
      })
      await Bun.sleep(1)
      const notifyData = mockCommsInterface.notify.mock.calls[0][0].data
      const createReqId = notifyData.requestId
      const actualTermId = notifyData.terminalId
      terminalHandler.handleResponse({
        requestId: createReqId,
        response: { request: 'create', params: { terminalId: actualTermId } },
      })
      const { terminalId } = await createPromise

      mockCommsInterface.notify.mockClear()

      const killPromise = terminalHandler.killTerminal({
        terminalId,
        sessionId: 'session_123',
      })
      await Bun.sleep(1)

      const notifyArgs = mockCommsInterface.notify.mock.calls[0][0]
      expect(notifyArgs.data.signal).toBe('SIGTERM')

      // Simulate kill response
      terminalHandler.handleResponse({
        requestId: notifyArgs.data.requestId,
        response: {
          request: 'kill',
          params: { success: true },
        },
      })

      await killPromise
      const termState = terminalHandler.getActiveTerminals()[0]
      expect(termState?.isRunning).toBe(false)
    })
  })

  describe('releaseTerminal', () => {
    it('removes terminal from tracking', async () => {
      // First create a terminal
      const createPromise = terminalHandler.createTerminal({
        command: 'ls',
        sessionId: 'session_123',
      })
      await Bun.sleep(1)
      const notifyData = mockCommsInterface.notify.mock.calls[0][0].data
      const createReqId = notifyData.requestId
      const actualTermId = notifyData.terminalId
      terminalHandler.handleResponse({
        requestId: createReqId,
        response: {
          request: 'create',
          params: { terminalId: actualTermId },
        },
      })
      const { terminalId } = await createPromise

      expect(terminalHandler.getActiveTerminals().length).toBe(1)
      mockCommsInterface.notify.mockClear()

      const releasePromise = terminalHandler.releaseTerminal({
        terminalId,
        sessionId: 'session_123',
      })
      await Bun.sleep(1)

      const notifyArgs = mockCommsInterface.notify.mock.calls[0][0]

      // Simulate release response
      terminalHandler.handleResponse({
        requestId: notifyArgs.data.requestId,
        response: {
          request: 'release',
          params: { success: true },
        },
      })

      await releasePromise
      expect(terminalHandler.getActiveTerminals().length).toBe(0)
    })
  })

  describe('handleResponse', () => {
    it('handles error response by rejecting promise', async () => {
      const createPromise = terminalHandler.createTerminal({
        command: 'ls',
        sessionId: 'session_123',
      })
      await Bun.sleep(1)
      const reqId = mockCommsInterface.notify.mock.calls[0][0].data.requestId

      // Complete with error
      terminalHandler.handleResponse({
        requestId: reqId,
        error: { message: 'Failed to spawn process' } as any,
        response: {} as any,
      })

      expect(createPromise).rejects.toThrow('Failed to spawn process')
    })
  })
})
