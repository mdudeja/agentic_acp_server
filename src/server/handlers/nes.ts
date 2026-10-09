import type { HandlerMap } from 'src/server/context'

/** Next-edit suggestions: session, suggestion and document-sync methods. */
export const nesHandlers = {
  'client/nes_start': async (params, ctx) => {
    const result = await ctx.nes().startNes(
      {
        workspaceUri: params.workspaceUri,
        workspaceFolders: params.workspaceFolders,
        repository: params.repository,
      },
      params.requestId,
    )
    ctx.comms.respond({
      method: 'client/nes_start',
      id: params.requestId,
      result: result
        ? { success: true, sessionId: result.sessionId }
        : { success: false },
    })
  },

  'client/nes_suggest': async (params, ctx) => {
    const result = await ctx.nes().suggestNes(
      {
        sessionId: params.sessionId,
        uri: params.uri,
        version: params.version,
        position: params.position,
        selection: params.selection,
        triggerKind: params.triggerKind,
        context: params.context,
      },
      params.requestId,
    )
    ctx.comms.respond({
      method: 'client/nes_suggest',
      id: params.requestId,
      result: result
        ? { success: true, suggestions: result.suggestions }
        : { success: false },
    })
  },

  'client/nes_close': async (params, ctx) => {
    const result = await ctx.nes().closeNes(params.sessionId, params.requestId)
    ctx.comms.respond({
      method: 'client/nes_close',
      id: params.requestId,
      result: result ?? { success: false },
    })
  },

  'client/nes_accept': async (params, ctx) => {
    const result = await ctx
      .nes()
      .acceptNes(params.sessionId, params.id, params.requestId)
    ctx.comms.respond({
      method: 'client/nes_accept',
      id: params.requestId,
      result: result ?? { success: false },
    })
  },

  'client/nes_reject': async (params, ctx) => {
    const result = await ctx
      .nes()
      .rejectNes(params.sessionId, params.id, params.reason, params.requestId)
    ctx.comms.respond({
      method: 'client/nes_reject',
      id: params.requestId,
      result: result ?? { success: false },
    })
  },

  'client/nes_did_open': async (params, ctx) => {
    await ctx.nes().didOpenDocument(
      {
        sessionId: params.sessionId,
        uri: params.uri,
        languageId: params.languageId,
        version: params.version,
        text: params.text,
      },
      params.requestId,
    )
    ctx.comms.respond({
      method: 'client/nes_did_open',
      id: params.requestId,
      result: { success: true },
    })
  },

  'client/nes_did_change': async (params, ctx) => {
    await ctx.nes().didChangeDocument(
      {
        sessionId: params.sessionId,
        uri: params.uri,
        version: params.version,
        contentChanges: params.contentChanges,
      },
      params.requestId,
    )
    ctx.comms.respond({
      method: 'client/nes_did_change',
      id: params.requestId,
      result: { success: true },
    })
  },

  'client/nes_did_close': async (params, ctx) => {
    await ctx
      .nes()
      .didCloseDocument(params.sessionId, params.uri, params.requestId)
    ctx.comms.respond({
      method: 'client/nes_did_close',
      id: params.requestId,
      result: { success: true },
    })
  },

  'client/nes_did_save': async (params, ctx) => {
    await ctx
      .nes()
      .didSaveDocument(params.sessionId, params.uri, params.requestId)
    ctx.comms.respond({
      method: 'client/nes_did_save',
      id: params.requestId,
      result: { success: true },
    })
  },

  'client/nes_did_focus': async (params, ctx) => {
    await ctx.nes().didFocusDocument(
      {
        sessionId: params.sessionId,
        uri: params.uri,
        version: params.version,
        position: params.position,
        visibleRange: params.visibleRange,
      },
      params.requestId,
    )
    ctx.comms.respond({
      method: 'client/nes_did_focus',
      id: params.requestId,
      result: { success: true },
    })
  },
} satisfies Partial<HandlerMap>
