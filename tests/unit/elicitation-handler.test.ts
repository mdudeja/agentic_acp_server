import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { ElicitationHandler } from '../../src/acp/handlers/ElicitationHandler'

describe('Handlers.ElicitationHandler', () => {
  let mockServer: any
  let mockCommsInterface: any

  beforeEach(() => {
    mockCommsInterface = {
      question: mock(async () => 'yes'),
    }

    mockServer = {
      getCommsInterface: mock(() => mockCommsInterface),
    }
  })

  test('accepts a URL-based elicitation when the user replies "yes"', async () => {
    mockCommsInterface.question = mock(async () => 'yes')
    const handler = new ElicitationHandler(mockServer)

    const result = await handler.createElicitation({
      mode: 'url',
      sessionId: 'sess-1',
      elicitationId: 'url-1',
      url: 'https://example.com/approve',
      message: 'Please approve',
    } as any)

    expect(result).toEqual({ action: 'accept' })
  })

  test('declines a URL-based elicitation when the user does not say "yes"', async () => {
    mockCommsInterface.question = mock(async () => 'no')
    const handler = new ElicitationHandler(mockServer)

    const result = await handler.createElicitation({
      mode: 'url',
      sessionId: 'sess-1',
      elicitationId: 'url-2',
      url: 'https://example.com/approve',
      message: 'Please approve',
    } as any)

    expect(result).toEqual({ action: 'decline' })
  })

  test('accepts a form elicitation and parses field:value pairs', async () => {
    mockCommsInterface.question = mock(async () => 'name: Alice\nrole: engineer')
    const handler = new ElicitationHandler(mockServer)

    const result = await handler.createElicitation({
      mode: 'form',
      sessionId: 'sess-1',
      message: 'Tell me about yourself',
      requestedSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', title: 'Name' },
          role: { type: 'string', title: 'Role' },
        },
      },
    } as any)

    expect(result).toEqual({
      action: 'accept',
      content: { name: 'Alice', role: 'engineer' },
    })
  })

  test('declines a form elicitation when the user says "cancel"', async () => {
    mockCommsInterface.question = mock(async () => 'cancel')
    const handler = new ElicitationHandler(mockServer)

    const result = await handler.createElicitation({
      mode: 'form',
      sessionId: 'sess-1',
      message: 'Please provide info',
      requestedSchema: { type: 'object', properties: {} },
    } as any)

    expect(result).toEqual({ action: 'decline' })
  })

  test('declines unknown/custom elicitation modes gracefully', async () => {
    const handler = new ElicitationHandler(mockServer)

    const result = await handler.createElicitation({
      mode: 'custom_mode',
      message: 'Custom request',
    } as any)

    expect(result).toEqual({ action: 'decline' })
  })

  test('completeElicitation logs without throwing', async () => {
    const handler = new ElicitationHandler(mockServer)
    await expect(
      handler.completeElicitation({ elicitationId: 'elic-1' } as any),
    ).resolves.toBeUndefined()
  })
})
