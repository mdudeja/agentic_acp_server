import { describe, it, expect } from 'bun:test'
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
  it('accepts a valid client/init payload', () => {
    expect(Check(ASMPayloadSchema, validInitPayload())).toBe(true)
  })

  it('rejects missing jsonrpc field', () => {
    const { data } = validInitPayload()
    expect(Check(ASMPayloadSchema, { data })).toBe(false)
  })

  it('rejects jsonrpc !== "2.0"', () => {
    expect(
      Check(ASMPayloadSchema, {
        jsonrpc: '1.0',
        data: validInitPayload().data,
      }),
    ).toBe(false)
  })

  it('rejects missing data field', () => {
    expect(Check(ASMPayloadSchema, { jsonrpc: '2.0' })).toBe(false)
  })

  it('rejects unknown method', () => {
    expect(
      Check(ASMPayloadSchema, {
        jsonrpc: '2.0',
        data: { method: 'client/unknown', params: {} },
      }),
    ).toBe(false)
  })

  it('accepts client/list_sessions with only optional requestId omitted', () => {
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
  it('accepts valid params with known provider', () => {
    expect(Check(InitParamsSchema, { provider: 'copilot', cwd: '/tmp' })).toBe(
      true,
    )
  })

  it('accepts all known providers', () => {
    for (const p of ['copilot', 'opencode', 'gemini']) {
      expect(Check(InitParamsSchema, { provider: p, cwd: '/tmp' })).toBe(true)
    }
  })

  it('rejects unknown provider', () => {
    expect(Check(InitParamsSchema, { provider: 'unknown', cwd: '/tmp' })).toBe(
      false,
    )
  })

  it('rejects missing cwd', () => {
    expect(Check(InitParamsSchema, { provider: 'copilot' })).toBe(false)
  })

  it('accepts optional requestId', () => {
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
  it('accepts empty params object', () => {
    expect(Check(NewSessionParamsSchema, {})).toBe(true)
  })

  it('accepts optional sessionName', () => {
    expect(Check(NewSessionParamsSchema, { sessionName: 'My Session' })).toBe(
      true,
    )
  })

  it('rejects sessionName that is a number', () => {
    expect(Check(NewSessionParamsSchema, { sessionName: 42 })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// LoadSessionParamsSchema
// ---------------------------------------------------------------------------

describe('LoadSessionParamsSchema', () => {
  it('accepts valid sessionId', () => {
    expect(Check(LoadSessionParamsSchema, { sessionId: 'abc-123' })).toBe(true)
  })

  it('rejects missing sessionId', () => {
    expect(Check(LoadSessionParamsSchema, {})).toBe(false)
  })

  it('rejects numeric sessionId', () => {
    expect(Check(LoadSessionParamsSchema, { sessionId: 99 })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// RenameSessionParamsSchema
// ---------------------------------------------------------------------------

describe('RenameSessionParamsSchema', () => {
  it('accepts valid sessionId + newName', () => {
    expect(
      Check(RenameSessionParamsSchema, { sessionId: 's1', newName: 'New' }),
    ).toBe(true)
  })

  it('rejects missing newName', () => {
    expect(Check(RenameSessionParamsSchema, { sessionId: 's1' })).toBe(false)
  })

  it('rejects missing sessionId', () => {
    expect(Check(RenameSessionParamsSchema, { newName: 'New' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// DeleteSessionParamsSchema
// ---------------------------------------------------------------------------

describe('DeleteSessionParamsSchema', () => {
  it('accepts valid sessionId', () => {
    expect(Check(DeleteSessionParamsSchema, { sessionId: 's1' })).toBe(true)
  })

  it('rejects missing sessionId', () => {
    expect(Check(DeleteSessionParamsSchema, {})).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// AskParamsSchema
// ---------------------------------------------------------------------------

describe('AskParamsSchema', () => {
  it('accepts minimal prompt', () => {
    expect(Check(AskParamsSchema, { prompt: 'hello' })).toBe(true)
  })

  it('rejects missing prompt', () => {
    expect(Check(AskParamsSchema, {})).toBe(false)
  })

  it('accepts contexts array with a valid entry', () => {
    expect(
      Check(AskParamsSchema, {
        prompt: 'hi',
        contexts: [{ type: 'file', text: 'content' }],
      }),
    ).toBe(true)
  })

  it('rejects contexts array with invalid type', () => {
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
  it('accepts valid questionId + answer', () => {
    expect(Check(AnswerParamsSchema, { questionId: 'q1', answer: 'yes' })).toBe(
      true,
    )
  })

  it('rejects missing questionId', () => {
    expect(Check(AnswerParamsSchema, { answer: 'yes' })).toBe(false)
  })

  it('rejects missing answer', () => {
    expect(Check(AnswerParamsSchema, { questionId: 'q1' })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// DisposeParamsSchema
// ---------------------------------------------------------------------------

describe('DisposeParamsSchema', () => {
  it('accepts empty object (all fields optional)', () => {
    expect(Check(DisposeParamsSchema, {})).toBe(true)
  })

  it('accepts all optional fields', () => {
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
  it('accepts empty object', () => {
    expect(Check(ListSessionsParamsSchema, {})).toBe(true)
  })

  it('accepts optional requestId', () => {
    expect(Check(ListSessionsParamsSchema, { requestId: 'r1' })).toBe(true)
  })
})
