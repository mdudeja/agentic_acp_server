import type { HandlerMap } from 'src/server/context'

/** Hook listing, reloading and toggling. */
export const hookHandlers = {
  'client/list_hooks': (params, ctx) => {
    const hooks = ctx.hooks()
    ctx.comms.respond({
      method: 'client/list_hooks',
      id: params.requestId,
      result: {
        success: true,
        enabled: ctx.state.getItem('config')?.hooks.enabled ?? false,
        hooks: hooks.list(),
        pendingTrust: hooks.pendingTrust(),
      },
    })
  },

  'client/reload_hooks': async (params, ctx) => {
    // Asks about untrusted/changed project files now: the editor is
    // attached, since it sent this request.
    const summary = await ctx.hooks().load({
      askTrust: true,
      askSkipped: params.askSkipped,
    })
    ctx.comms.respond({
      method: 'client/reload_hooks',
      id: params.requestId,
      result: { success: true, ...summary },
    })
  },

  'client/set_hook_enabled': (params, ctx) => {
    const found = ctx.hooks().setEnabled(params.name, params.enabled)
    ctx.comms.respond({
      method: 'client/set_hook_enabled',
      id: params.requestId,
      result: { success: found },
      error: found ? undefined : { message: `No hook named ${params.name}` },
    })
  },
} satisfies Partial<HandlerMap>
