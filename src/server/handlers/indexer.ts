import type { HandlerMap } from 'src/server/context'

export const indexerHandlers = {
  'client/index': async (params, ctx) => {
    const result = await ctx.indexer().runCommand('index', params.requestId)
    ctx.comms.respond({
      method: 'client/index',
      id: params.requestId,
      result: { success: result.success },
      error: result.success ? undefined : { message: result.error },
    })
  },
} satisfies Partial<HandlerMap>
