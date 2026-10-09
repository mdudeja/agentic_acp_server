import type { ASMMethod, ASMPayload } from 'src/comms/ICommsInterface'
import type {
  Handler,
  HandlerContext,
  HandlerMap,
} from 'src/server/context'
import { agentHandlers } from 'src/server/handlers/agent'
import { hookHandlers } from 'src/server/handlers/hooks'
import { indexerHandlers } from 'src/server/handlers/indexer'
import { nesHandlers } from 'src/server/handlers/nes'
import { sessionHandlers } from 'src/server/handlers/session'
import { logWarning } from 'src/utils/logger'

/** Every ASM method → its handler. Typed as `HandlerMap`, so it is exhaustive. */
const handlers: HandlerMap = {
  ...agentHandlers,
  ...sessionHandlers,
  ...hookHandlers,
  ...indexerHandlers,
  ...nesHandlers,
}

/**
 * Routes a validated ASM payload to its handler. Handlers answer the request
 * themselves; a throw is answered as an error by the caller.
 */
export async function dispatch(payload: ASMPayload, ctx: HandlerContext) {
  const { method, params } = payload.data
  // `method` and `params` are correlated by the schema; TS cannot see that
  // through the indexed access, hence the widening cast.
  const handler = handlers[method] as Handler<ASMMethod> | undefined

  if (!handler) {
    logWarning(`Unhandled method: ${method}`)
    return
  }

  await handler(params, ctx)
}
