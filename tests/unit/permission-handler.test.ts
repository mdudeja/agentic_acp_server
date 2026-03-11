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

  test('rejectAllPending cancels pending requests', async () => {
    const handler = new PermissionHandler(mockServer)

    // Add a fake pending request
    let resolvedValue: any
    handler.pendingRequests.set('sess-1', {
      params: {} as any,
      resolve: (val) => {
        resolvedValue = val
      },
      reject: () => {},
    })

    handler.rejectAllPending()

    expect(handler.pendingRequests.size).toBe(0)
    expect(resolvedValue).toEqual({ outcome: { outcome: 'cancelled' } })
  })

  test('dispose clears state and cancels pending', async () => {
    const handler = new PermissionHandler(mockServer)
    const rejectSpy = spyOn(handler, 'rejectAllPending')

    handler.dispose()

    expect(rejectSpy).toHaveBeenCalled()
    expect(handler.agent).toBeUndefined()
  })
})
