import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test'
import { PermissionHandler } from '../../src/acp/handlers/PermissionHandler'
import { GlobalPermissionsRule } from '../../src/database/schemas'

describe('Handlers.PermissionHandler', () => {
  let mockServer: any
  let mockCommsInterface: any
  let mockAgent: any

  beforeEach(() => {
    mockCommsInterface = {
      question: mock(async () => '1'),
    }

    // Default agent setup
    mockAgent = {
      permissions_rule: null,
    }

    mockServer = {
      getState: mock(() => ({ agent: mockAgent })),
      getCommsInterface: mock(() => mockCommsInterface),
    }
  })

  test('throws if no agent found in state', async () => {
    mockServer.getState = mock(() => ({ agent: undefined }))
    const handler = new PermissionHandler(mockServer)

    try {
      await handler.requestPermission({} as any)
    } catch (e: any) {
      expect(e.message).toBe('No agent found in state')
    }
  })

  test('auto-grants if rule is allow and allow option exists', async () => {
    mockAgent.permissions_rule = GlobalPermissionsRule.allow
    const handler = new PermissionHandler(mockServer)

    const result = await handler.requestPermission({
      sessionId: 'sess-1',
      options: [{ kind: 'allow_once', optionId: 'opt-allow', name: 'Allow' }],
    } as any)

    expect(result.outcome).toEqual({
      outcome: 'selected',
      optionId: 'opt-allow',
    })
  })

  test('throws if rule is allow but no allow option exists', async () => {
    mockAgent.permissions_rule = GlobalPermissionsRule.allow
    const handler = new PermissionHandler(mockServer)

    try {
      await handler.requestPermission({
        sessionId: 'sess-1',
        options: [{ kind: 'reject_once', optionId: 'opt-deny', name: 'Deny' }],
      } as any)
    } catch (e: any) {
      expect(e.message).toBe(
        'No allow option found in request, but permissions rule is set to allow',
      )
    }
  })

  test('auto-denies if rule is deny and deny option exists', async () => {
    mockAgent.permissions_rule = GlobalPermissionsRule.deny
    const handler = new PermissionHandler(mockServer)

    const result = await handler.requestPermission({
      sessionId: 'sess-1',
      options: [{ kind: 'reject_always', optionId: 'opt-deny', name: 'Deny' }],
    } as any)

    expect(result.outcome).toEqual({
      outcome: 'selected',
      optionId: 'opt-deny',
    })
  })

  test('throws if rule is deny but no deny option exists', async () => {
    mockAgent.permissions_rule = GlobalPermissionsRule.deny
    const handler = new PermissionHandler(mockServer)

    try {
      await handler.requestPermission({
        sessionId: 'sess-1',
        options: [{ kind: 'allow_once', optionId: 'opt-allow', name: 'Allow' }],
      } as any)
    } catch (e: any) {
      expect(e.message).toBe(
        'No deny option found in request, but permissions rule is set to deny',
      )
    }
  })

  test('prompts user if no auto rule and returns selected option', async () => {
    mockAgent.permissions_rule = null // User prompt required
    // Provide an answer of '2'
    mockCommsInterface.question = mock(async () => '2')

    const handler = new PermissionHandler(mockServer)

    // Fire off request, but need to intercept the promise returned
    const promise = handler.requestPermission({
      sessionId: 'sess-1',
      toolCall: { title: 'Test Tool' },
      options: [
        { kind: 'allow_once', optionId: 'opt-allow', name: 'Allow' },
        { kind: 'reject_once', optionId: 'opt-deny', name: 'Deny' },
      ],
    } as any)

    const result = await promise
    expect(result.outcome).toEqual({
      outcome: 'selected',
      optionId: 'opt-deny',
    })
  })

  test('sends structured options and accepts an optionId answer', async () => {
    mockCommsInterface.question = mock(async () => 'opt-deny')
    const handler = new PermissionHandler(mockServer)

    const result = await handler.requestPermission({
      sessionId: 'sess-1',
      toolCall: { title: 'Test Tool', toolCallId: 'tc-1' },
      options: [
        { kind: 'allow_once', optionId: 'opt-allow', name: 'Allow' },
        { kind: 'reject_once', optionId: 'opt-deny', name: 'Deny' },
      ],
    } as any)

    expect(result.outcome).toEqual({ outcome: 'selected', optionId: 'opt-deny' })

    const [questionParams, opts] = mockCommsInterface.question.mock.calls[0]
    expect(questionParams.questionId).toBe('permission_tc-1')
    expect(questionParams.options).toEqual([
      { id: 'opt-allow', label: 'Allow', description: 'allow_once' },
      { id: 'opt-deny', label: 'Deny', description: 'reject_once' },
    ])
    expect(opts.signal).toBeInstanceOf(AbortSignal)
    expect(handler.pendingRequests.size).toBe(0)
  })

  test('an unrecognised answer rejects instead of throwing', async () => {
    mockCommsInterface.question = mock(async () => 'not-a-number')
    const handler = new PermissionHandler(mockServer)

    const result = await handler.requestPermission({
      sessionId: 'sess-1',
      toolCall: { title: 'Test Tool' },
      options: [
        { kind: 'allow_once', optionId: 'opt-allow', name: 'Allow' },
        { kind: 'reject_once', optionId: 'opt-deny', name: 'Deny' },
      ],
    } as any)

    expect(result.outcome).toEqual({ outcome: 'selected', optionId: 'opt-deny' })
  })

  test('an unrecognised answer with no reject option is cancelled', async () => {
    mockCommsInterface.question = mock(async () => '99')
    const handler = new PermissionHandler(mockServer)

    const result = await handler.requestPermission({
      sessionId: 'sess-1',
      toolCall: { title: 'Test Tool' },
      options: [{ kind: 'allow_once', optionId: 'opt-allow', name: 'Allow' }],
    } as any)

    expect(result.outcome).toEqual({ outcome: 'cancelled' })
  })

  test('a failing question rejects the request instead of hanging', async () => {
    mockCommsInterface.question = mock(async () => {
      throw new Error('editor gone')
    })
    const handler = new PermissionHandler(mockServer)

    await expect(
      handler.requestPermission({
        sessionId: 'sess-1',
        toolCall: { title: 'Test Tool' },
        options: [{ kind: 'allow_once', optionId: 'opt-allow', name: 'Allow' }],
      } as any),
    ).rejects.toThrow('editor gone')
    expect(handler.pendingRequests.size).toBe(0)
  })

  /** A question mock that stays pending until its signal is aborted. */
  function pendingQuestion() {
    const signals: AbortSignal[] = []
    mockCommsInterface.question = mock(
      (_params: any, opts: { signal: AbortSignal }) =>
        new Promise<string>((_resolve, reject) => {
          signals.push(opts.signal)
          opts.signal.addEventListener('abort', () =>
            reject(new Error('cancelled')),
          )
        }),
    )
    return signals
  }

  const request = (sessionId: string, toolCallId: string) =>
    ({
      sessionId,
      toolCall: { title: 'Test Tool', toolCallId },
      options: [{ kind: 'allow_once', optionId: 'opt-allow', name: 'Allow' }],
    }) as any

  test('concurrent requests in one session are tracked separately', async () => {
    pendingQuestion()
    const handler = new PermissionHandler(mockServer)

    const first = handler.requestPermission(request('sess-1', 'tc-1'))
    const second = handler.requestPermission(request('sess-1', 'tc-2'))

    expect(handler.pendingRequests.size).toBe(2)

    handler.rejectAllPending('sess-1')

    expect(await first).toEqual({ outcome: { outcome: 'cancelled' } })
    expect(await second).toEqual({ outcome: { outcome: 'cancelled' } })
    expect(handler.pendingRequests.size).toBe(0)
  })

  test('rejectAllPending only cancels the given session and aborts its question', async () => {
    const signals = pendingQuestion()
    const handler = new PermissionHandler(mockServer)

    const mine = handler.requestPermission(request('acp-1', 'tc-1'))
    handler.requestPermission(request('acp-2', 'tc-2'))

    handler.rejectAllPending('acp-1')

    expect(await mine).toEqual({ outcome: { outcome: 'cancelled' } })
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
    expect(handler.pendingRequests.size).toBe(1)

    handler.rejectAllPending()
    expect(signals[1]?.aborted).toBe(true)
    expect(handler.pendingRequests.size).toBe(0)
  })

  test('dispose clears state and cancels pending', async () => {
    const handler = new PermissionHandler(mockServer)
    const rejectSpy = spyOn(handler, 'rejectAllPending')

    handler.dispose()

    expect(rejectSpy).toHaveBeenCalled()
    expect(handler.agent).toBeUndefined()
  })
})
