import { Providers } from 'src/data/providers'
import type { HandlerMap } from 'src/server/context'
import { notifyLog } from 'src/server/respond'

/** Provider lifecycle and editor round-trips (answers, terminal output). */
export const agentHandlers = {
  'client/init': async (params, ctx) => {
    await ctx.startProvider(params, 'client/init')
  },

  'client/dispose': async (_params, ctx) => {
    await ctx.dispose()
  },

  'client/list_providers': (params, ctx) => {
    const state = ctx.state.getState()
    const activeProvider = ctx.activeProvider()
    const providers = Object.values(Providers).map((provider) => ({
      provider,
      active: activeProvider === provider,
      agentId: activeProvider === provider ? (state.agent?.id ?? null) : null,
      connected: activeProvider === provider && Boolean(state.connection),
    }))

    ctx.comms.respond({
      method: 'client/list_providers',
      id: params.requestId,
      result: { success: true, providers },
    })
  },

  'client/switch_provider': async (params, ctx) => {
    const state = ctx.state.getState()
    const cwd = params.cwd ?? state.agent?.cwd ?? state.workspaceRoot
    const previousProvider = ctx.activeProvider()

    if (!cwd) {
      ctx.comms.respond({
        method: 'client/switch_provider',
        id: params.requestId,
        result: { success: false },
        error: {
          message:
            'No cwd provided and none known from the active agent/workspace',
        },
      })
      return
    }

    // `startProvider` answers the request itself, success or failure.
    const switched = await ctx.startProvider(
      { requestId: params.requestId, provider: params.provider, cwd },
      'client/switch_provider',
    )

    if (switched) {
      notifyLog(
        ctx.comms,
        'info',
        `Switched provider from ${previousProvider ?? 'none'} to ${params.provider}`,
      )
    }
  },

  'client/answer': (params, ctx) => {
    // In WebSocket mode, answers are intercepted at the comms layer.
    // In RPC mode, the readline question() call resolves directly.
    // Reaching here means the questionId was not found in pendingQuestions.
    ctx.comms.respond({
      method: 'client/answer',
      id: params.requestId,
      error: {
        message: `No pending question found for questionId ${params.questionId}`,
      },
    })
  },

  'client/terminal': (params, ctx) => {
    ctx.agent()?.handleTerminalResponse(params)
  },
} satisfies Partial<HandlerMap>
