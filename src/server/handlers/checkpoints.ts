import {
  changes,
  fileAt,
  list,
  restore,
  toplevel,
} from 'src/checkpoints/git'
import type { HandlerContext, HandlerMap } from 'src/server/context'

/** Whether the turnCheckpoint builtin is registered and switched on. */
function enabled(ctx: HandlerContext) {
  return (
    ctx
      .hooks()
      .list()
      .find((hook) => hook.name === 'turnCheckpoint' && hook.source === 'builtin')
      ?.enabled ?? false
  )
}

/** The workspace the server was started in. */
function workspaceRoot(ctx: HandlerContext) {
  return ctx.state.getItem('workspaceRoot') ?? process.cwd()
}

/**
 * Checkpoints recorded by the turnCheckpoint hook: listing, diffing against
 * the live tree, and restoring. Paths are relative to `root`, the
 * repository's top level, which every result carries.
 */
export const checkpointHandlers = {
  'client/list_checkpoints': async (params, ctx) => {
    if (!enabled(ctx)) {
      ctx.comms.respond({
        method: 'client/list_checkpoints',
        id: params.requestId,
        result: { success: true, enabled: false, checkpoints: [] },
      })
      return
    }

    const root = workspaceRoot(ctx)
    const checkpoints = await list(root, {
      sessionId: params.sessionId,
      limit: params.limit,
    })
    ctx.comms.respond({
      method: 'client/list_checkpoints',
      id: params.requestId,
      result: {
        success: true,
        enabled: true,
        root: await toplevel(root),
        checkpoints,
      },
    })
  },

  'client/checkpoint_changes': async (params, ctx) => {
    const root = workspaceRoot(ctx)
    const files = await changes(root, params.sha)
    ctx.comms.respond({
      method: 'client/checkpoint_changes',
      id: params.requestId,
      result: { success: true, root: await toplevel(root), files },
    })
  },

  'client/checkpoint_file': async (params, ctx) => {
    const file = await fileAt(workspaceRoot(ctx), params.sha, params.path)
    ctx.comms.respond({
      method: 'client/checkpoint_file',
      id: params.requestId,
      result: { success: true, ...file },
    })
  },

  'client/restore_checkpoint': async (params, ctx) => {
    if (ctx.state.getItem('promptActive')) {
      throw new Error('A turn is in progress; cancel it before restoring.')
    }
    const result = await restore(workspaceRoot(ctx), params.sha, {
      paths: params.paths,
      sessionId: params.sessionId,
    })
    ctx.comms.respond({
      method: 'client/restore_checkpoint',
      id: params.requestId,
      result: { success: true, ...result },
    })
  },
} satisfies Partial<HandlerMap>
