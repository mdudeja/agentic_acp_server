import type {
  ASMPayload,
  ASMPayloadParams,
  PendingQuestion,
  RespondParams,
} from './ICommsInterface'
import { logWarning } from 'src/utils/logger'

/**
 * Tracks questions sent to the editor (`agentic/question`) until the matching
 * `client/answer` arrives. Shared by every comms interface so that id
 * allocation, cancellation and teardown behave the same in RPC and WebSocket
 * modes.
 */
export class PendingQuestions {
  private questions: Map<string, PendingQuestion> = new Map()
  private counter = 0

  get size(): number {
    return this.questions.size
  }

  has(questionId: string): boolean {
    return this.questions.has(questionId)
  }

  /**
   * Registers a question and returns its id plus a promise for the answer.
   *
   * `requestedId` is kept when free; when it is already pending (e.g. two
   * concurrent `select_session_mode` prompts) a numeric suffix is added so
   * neither caller's resolver is overwritten. Aborting `signal` rejects the
   * answer promise and forgets the question.
   */
  register(
    requestedId: string | undefined,
    signal?: AbortSignal,
  ): { questionId: string; answer: Promise<string> } {
    const questionId = this._uniqueId(requestedId)

    const answer = new Promise<string>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error(`Question ${questionId} was cancelled`))
        return
      }

      const onAbort = () => {
        this.questions.delete(questionId)
        reject(new Error(`Question ${questionId} was cancelled`))
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      const settle = () => {
        signal?.removeEventListener('abort', onAbort)
        this.questions.delete(questionId)
      }

      this.questions.set(questionId, {
        resolve: (value: string) => {
          settle()
          resolve(value)
        },
        reject: (error: Error) => {
          settle()
          reject(error)
        },
      })
    })

    return { questionId, answer }
  }

  /** Resolves a pending question. Returns `false` when the id is unknown. */
  resolve(questionId: string, answer: string): boolean {
    const pending = this.questions.get(questionId)

    if (!pending) {
      return false
    }

    if (pending.timeout) {
      clearTimeout(pending.timeout)
    }

    pending.resolve(answer)
    return true
  }

  /**
   * Handles a raw `client/answer` message: resolves the matching question and
   * acknowledges it via `respond`, or responds with an error when the
   * question is unknown so the editor's request never goes unanswered.
   */
  processAnswer(message: string, respond: (params: RespondParams) => void) {
    const answer = parseAnswerPayload(message)

    if (!answer) {
      return
    }

    if (!this.resolve(answer.questionId, answer.answer)) {
      logWarning(
        `Received answer for questionId ${answer.questionId} but no pending question found`,
      )
      respond({
        method: 'client/answer',
        id: answer.requestId,
        error: {
          message: `No pending question found for questionId ${answer.questionId}`,
        },
      })
      return
    }

    respond({
      method: 'client/answer',
      id: answer.requestId,
      result: {
        success: true,
        message: 'Answer received and processed',
        questionId: answer.questionId,
      },
    })
  }

  /** Rejects every pending question (used on dispose so callers don't hang). */
  rejectAll(error: Error) {
    for (const pending of Array.from(this.questions.values())) {
      if (pending.timeout) {
        clearTimeout(pending.timeout)
      }
      pending.reject(error)
    }
    this.questions.clear()
  }

  private _uniqueId(requestedId: string | undefined): string {
    if (requestedId && !this.questions.has(requestedId)) {
      return requestedId
    }

    const base = requestedId ?? 'question'
    let questionId: string
    do {
      questionId = `${base}_${Date.now()}_${++this.counter}`
    } while (this.questions.has(questionId))

    return questionId
  }
}

/**
 * Returns the params of a well-formed `client/answer` payload, or `null` for
 * anything else (other methods, invalid JSON). Used to route answers by
 * parsing rather than by substring matching on the raw message.
 */
export function parseAnswerPayload(
  message: string,
): ASMPayloadParams['client/answer'] | null {
  try {
    const parsed = JSON.parse(message) as ASMPayload

    if (parsed?.data?.method !== 'client/answer') {
      return null
    }

    const params = parsed.data.params as ASMPayloadParams['client/answer']

    if (typeof params?.questionId !== 'string') {
      return null
    }

    return params
  } catch {
    return null
  }
}
