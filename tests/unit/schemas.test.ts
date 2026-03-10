import { describe, test, expect } from 'bun:test'
import { Check } from 'typebox/value'
import {
  ASMPayloadSchema,
  InitParamsSchema,
  NewSessionParamsSchema,
  LoadSessionParamsSchema,
  RenameSessionParamsSchema,
  DeleteSessionParamsSchema,
  AskParamsSchema,
  AnswerParamsSchema,
  DisposeParamsSchema,
  ListSessionsParamsSchema,
} from 'src/openrpc/schemas'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const validInitPayload = () => ({
  jsonrpc: '2.0' as const,
  data: {
    method: 'client/init' as const,
    params: { provider: 'copilot', cwd: '/home/user/project' },
  },
})

// ---------------------------------------------------------------------------
// ASMPayloadSchema — top-level envelope validation
// ---------------------------------------------------------------------------

describe('ASMPayloadSchema', () => {
  test('accepts a valid client/init payload', () => {
    expect(Check(ASMPayloadSchema, validInitPayload())).toBe(true)
  })

  test('rejects missing jsonrpc field', () => {
    const { data } = validInitPayload()
    expect(Check(ASMPayloadSchema, { data })).toBe(false)
  })

  test('rejects jsonrpc !== "2.0"', () => {
    expect(
      Check(ASMPayloadSchema, {
        jsonrpc: '1.0',
        data: validInitPayload().data,
      }),
    ).toBe(false)
  })

  test('rejects missing data field', () => {
    expect(Check(ASMPayloadSchema, { jsonrpc: '2.0' })).toBe(false)
  })

  test('rejects unknown method', () => {
    expect(
      Check(ASMPayloadSchema, {
        jsonrpc: '2.0',
        data: { method: 'client/unknown', params: {} },
      }),
    ).toBe(false)
  })

  test('accepts client/list_sessions with only optional requestId omitted', () => {
    expect(
      Check(ASMPayloadSchema, {
        jsonrpc: '2.0',
        data: { method: 'client/list_sessions', params: {} },
      }),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// InitParamsSchema
// ---------------------------------------------------------------------------

describe('InitParamsSchema', () => {
  test('accepts valid params with known provider', () => {
    expect(Check(InitParamsSchema, { provider: 'copilot', cwd: '/tmp' })).toBe(
      true,
    )
  })

  test('accepts all known providers', () => {
    for (const p of ['copilot', 'opencode', 'gemini']) {
      expect(Check(InitParamsSchema, { provider: p, cwd: '/tmp' })).toBe(true)
    }
  })

  test('rejects unknown provider', () => {
    expect(Check(InitParamsSchema, { provider: 'unknown', cwd: '/tmp' })).toBe(
      false,
    )
  })

  test('rejects missing cwd', () => {
    expect(Check(InitParamsSchema, { provider: 'copilot' })).toBe(false)
  })

  test('accepts optional requestId', () => {
    expect(
      Check(InitParamsSchema, {
        provider: 'copilot',
        cwd: '/tmp',
        requestId: 'req-1',
      }),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// NewSessionParamsSchema
// ---------------------------------------------------------------------------

describe('NewSessionParamsSchema', () => {
  test('accepts empty params object', () => {
    expect(Check(NewSessionParamsSchema, {})).toBe(true)
  })

  test('accepts optional sessionName', () => {
    expect(Check(NewSessionParamsSchema, { sessionName: 'My Session' })).toBe(
      true,
    )
  })

  test('rejects sessionName that is a number', () => {
    expect(Check(NewSessionParamsSchema, { sessionName: 42 })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// LoadSessionParamsSchema
// ---------------------------------------------------------------------------

describe('LoadSessionParamsSchema', () => {
  test('accepts valid sessionId', () => {
    expect(Check(LoadSessionParamsSchema, { sessionId: 'abc-123' })).toBe(true)
  })

  test('rejects missing sessionId', () => {
    expect(Check(LoadSessionParamsSchema, {})).toBe(false)
  })

  test('rejects numeric sessionId', () => {
    expect(Check(LoadSessionParamsSchema, { sessionId: 99 })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// RenameSessionParamsSchema
// ---------------------------------------------------------------------------

describe('RenameSessionParamsSchema', () => {
  test('accepts valid sessionId + newName', () => {
    expect(
      Check(RenameSessionParamsSchema, { sessionId: 's1', newName: 'New' }),
    ).toBe(true)
  })

  test('rejects missing newName', () => {
    expect(Check(RenameSessionParamsSchema, { sessionId: 's1' })).toBe(false)
  })

  test('rejects missing sessionId', () => {
    expect(Check(RenameSessionParamsSchema, { newName: 'New' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// DeleteSessionParamsSchema
// ---------------------------------------------------------------------------

describe('DeleteSessionParamsSchema', () => {
  test('accepts valid sessionId', () => {
    expect(Check(DeleteSessionParamsSchema, { sessionId: 's1' })).toBe(true)
  })

  test('rejects missing sessionId', () => {
    expect(Check(DeleteSessionParamsSchema, {})).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AskParamsSchema
// ---------------------------------------------------------------------------

describe('AskParamsSchema', () => {
  test('accepts minimal prompt', () => {
    expect(Check(AskParamsSchema, { prompt: 'hello' })).toBe(true)
  })

  test('rejects missing prompt', () => {
    expect(Check(AskParamsSchema, {})).toBe(false)
  })

  test('accepts contexts array with a valid entry', () => {
    expect(
      Check(AskParamsSchema, {
        prompt: 'hi',
        contexts: [{ type: 'file', text: 'content' }],
      }),
    ).toBe(true)
  })

  test('rejects contexts array with invalid type', () => {
    expect(
      Check(AskParamsSchema, {
        prompt: 'hi',
        contexts: [{ type: 'invalid_type', text: 'content' }],
      }),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AnswerParamsSchema
// ---------------------------------------------------------------------------

describe('AnswerParamsSchema', () => {
  test('accepts valid questionId + answer', () => {
    expect(Check(AnswerParamsSchema, { questionId: 'q1', answer: 'yes' })).toBe(
      true,
    )
  })

  test('rejects missing questionId', () => {
    expect(Check(AnswerParamsSchema, { answer: 'yes' })).toBe(false)
  })

  test('rejects missing answer', () => {
    expect(Check(AnswerParamsSchema, { questionId: 'q1' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// DisposeParamsSchema
// ---------------------------------------------------------------------------

describe('DisposeParamsSchema', () => {
  test('accepts empty object (all fields optional)', () => {
    expect(Check(DisposeParamsSchema, {})).toBe(true)
  })

  test('accepts all optional fields', () => {
    expect(
      Check(DisposeParamsSchema, {
        reason: 'quit',
        agentId: 'a1',
        requestId: 'r1',
      }),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ListSessionsParamsSchema
// ---------------------------------------------------------------------------

describe('ListSessionsParamsSchema', () => {
  test('accepts empty object', () => {
    expect(Check(ListSessionsParamsSchema, {})).toBe(true)
  })

  test('accepts optional requestId', () => {
    expect(Check(ListSessionsParamsSchema, { requestId: 'r1' })).toBe(true)
  })
})
