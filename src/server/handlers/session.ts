import { createContentBlocks } from 'src/ingester'
import type { HandlerMap } from 'src/server/context'
import { respondOp, respondResult } from 'src/server/respond'

/** Session lifecycle, prompting and session config. */
export const sessionHandlers = {
  'client/new_session': async (params, ctx) => {
    if (!ctx.agent()) {
      throw new Error(
        'AgentManager or SessionManager not initialized. Cannot create session.',
      )
    }

    const result = await ctx
      .sessions()
      .createNewSession(params.sessionName, params.requestId)
    respondOp(ctx.comms, 'client/new_session', params.requestId, result)
  },

  'client/ask': async (params, ctx) => {
    const sessions = ctx.sessions(
      'Call client/init and client/new_session first.',
    )

    const contentBlocks = await Promise.all(
      (params.contexts ?? []).map((context) => createContentBlocks(context)),
    )
    const blocks = [
      ...contentBlocks.flat(),
      { type: 'text' as const, text: params.prompt },
    ]

    const result = await sessions.prompt(blocks, undefined, params.requestId)
    respondOp(ctx.comms, 'client/ask', params.requestId, result, {})
  },

  'client/load_session': async (params, ctx) => {
    const result = await ctx
      .sessions()
      .loadSession(params.sessionId, params.requestId)
    respondOp(ctx.comms, 'client/load_session', params.requestId, result, {
      sessionId: params.sessionId,
    })
  },

  'client/rename_session': async (params, ctx) => {
    const result = await ctx
      .sessions()
      .renameSession(params.newName, params.sessionId, params.requestId)
    respondOp(ctx.comms, 'client/rename_session', params.requestId, result)
  },

  'client/delete_session': async (params, ctx) => {
    const result = await ctx
      .sessions()
      .deleteSession(params.sessionId, params.requestId, params.source)
    respondResult(ctx.comms, 'client/delete_session', params.requestId, result)
  },

  'client/archive_session': async (params, ctx) => {
    const sessions = ctx.sessions()
    const result = params.archive
      ? await sessions.archiveSession(
          params.sessionId,
          params.requestId,
          params.export,
        )
      : await sessions.unarchiveSession(params.sessionId, params.requestId)
    respondOp(ctx.comms, 'client/archive_session', params.requestId, result)
  },

  'client/fork_session': async (params, ctx) => {
    const result = await ctx
      .sessions()
      .forkSession(params.sessionId, params.newName, params.requestId)
    respondOp(ctx.comms, 'client/fork_session', params.requestId, result)
  },

  'client/resume_session': async (params, ctx) => {
    const result = await ctx
      .sessions()
      .resumeSession(params.sessionId, params.requestId)
    respondOp(ctx.comms, 'client/resume_session', params.requestId, result, {
      sessionId: params.sessionId,
    })
  },

  'client/switch_session_mode': async (params, ctx) => {
    const result = await ctx
      .sessions()
      .switchSessionMode(params.sessionId, params.requestId)
    respondOp(ctx.comms, 'client/switch_session_mode', params.requestId, result)
  },

  'client/switch_model': async (params, ctx) => {
    const result = await ctx
      .sessions()
      .switchSessionModel(params.sessionId, params.requestId)
    respondOp(ctx.comms, 'client/switch_model', params.requestId, result)
  },

  'client/list_config_options': (params, ctx) => {
    const result = ctx.sessions().listConfigOptions(params.sessionId)
    ctx.comms.respond({
      method: 'client/list_config_options',
      id: params.requestId,
      result: result.success
        ? {
            success: true,
            sessionId: result.sessionId,
            configOptions: result.configOptions,
          }
        : { success: false },
      error: result.success ? undefined : { message: result.error },
    })
  },

  'client/set_config_option': async (params, ctx) => {
    const configOptions = await ctx
      .sessions()
      .setSessionConfigOption(
        params.optionId,
        params.value,
        params.sessionId,
        params.requestId,
      )
    ctx.comms.respond({
      method: 'client/set_config_option',
      id: params.requestId,
      result: configOptions
        ? { success: true, configOptions }
        : { success: false },
      error: configOptions
        ? undefined
        : { message: `Config option ${params.optionId} not found` },
    })
  },

  'client/list_sessions': async (params, ctx) => {
    const result = await ctx.sessions().listSessionsQueued(params.source)
    respondResult(ctx.comms, 'client/list_sessions', params.requestId, result)
  },

  'client/export_session': async (params, ctx) => {
    const result = await ctx
      .sessions()
      .exportSession(params.sessionId, params.outputPath, params.source)
    respondResult(ctx.comms, 'client/export_session', params.requestId, result)
  },

  'client/import_session': async (params, ctx) => {
    const result = await ctx
      .sessions()
      .importSession(params.filePath, params.source)
    respondResult(ctx.comms, 'client/import_session', params.requestId, result)
  },

  'client/summarize_session': async (params, ctx) => {
    const result = await ctx.sessions().writeSessionSummary(params.sessionId)
    respondResult(
      ctx.comms,
      'client/summarize_session',
      params.requestId,
      result,
    )
  },

  'client/stats': async (params, ctx) => {
    const result = await ctx.sessions().getStats(params.days)
    respondResult(ctx.comms, 'client/stats', params.requestId, result)
  },
} satisfies Partial<HandlerMap>
