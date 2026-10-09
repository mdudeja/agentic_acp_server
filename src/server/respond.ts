import type {
  ICommsInterface,
  LogNotificationParams,
  RespondParams,
} from 'src/comms/ICommsInterface'
import type { SessionOpResult } from 'src/managers/SessionManager'
import { logError } from 'src/utils/logger'

export type LogLevel = LogNotificationParams['data']['level']

/** Sends an `agentic/log` notification to the editor. */
export function notifyLog(
  comms: ICommsInterface,
  level: LogLevel,
  message: string,
) {
  comms.notify({ method: 'agentic/log', data: { level, message } })
}

/**
 * Answers a request from a `SessionOpResult`. On success the response
 * carries `success: true` plus `fields` when given, otherwise the result's
 * own data (e.g. `sessionId`). On failure it carries the error message.
 */
export function respondOp(
  comms: ICommsInterface,
  method: RespondParams['method'],
  requestId: string | undefined,
  result: SessionOpResult<object>,
  fields?: object,
) {
  if (!result.success) {
    comms.respond({
      method,
      id: requestId,
      result: { success: false },
      error: { message: result.error },
    })
    return
  }

  comms.respond({
    method,
    id: requestId,
    result: fields ? { success: true, ...fields } : result,
  })
}

/** Answers a request from an op that already returns `{ result, error }`. */
export function respondResult(
  comms: ICommsInterface,
  method: RespondParams['method'],
  requestId: string | undefined,
  outcome: Pick<RespondParams, 'result' | 'error'>,
) {
  comms.respond({
    method,
    id: requestId,
    result: outcome.result,
    error: outcome.error,
  })
}

/**
 * Answers a request whose handling threw, so the editor never waits on a
 * response that will not come. Needs the method and `requestId` to be
 * readable from the payload (even if it failed schema validation).
 */
export function respondWithError(
  comms: ICommsInterface,
  raw: unknown,
  error: unknown,
) {
  const data = (
    raw as
      | { data?: { method?: unknown; params?: { requestId?: unknown } } }
      | undefined
  )?.data

  if (
    typeof data?.method !== 'string' ||
    typeof data.params?.requestId !== 'string' ||
    data.method === 'client/dispose'
  ) {
    return
  }

  try {
    comms.respond({
      method: data.method as RespondParams['method'],
      id: data.params.requestId,
      result: { success: false },
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    })
  } catch (respondError) {
    logError('Failed to send error response', respondError)
  }
}
