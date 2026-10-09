import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk'
import type { AgenticServer } from 'src/AgenticServer'
import { GlobalPermissionsRule, type Agent } from 'src/database/schemas'
import { resolveOptionAnswer } from 'src/utils/helpers'
import { logDebug, logWarning } from 'src/utils/logger'

/**
 * Handler for processing permission requests.
 * Manages permission prompts based on agent-specific permission rules,
 * supporting automatic grants, denials, or interactive user prompts.
 */
export class PermissionHandler {
  agent?: Agent['Select'] | null
  /**
   * Interactive requests awaiting the user, keyed per request (not per
   * session: an agent may have several permission requests in flight for the
   * same session). `controller` cancels the editor question on cancel.
   */
  pendingRequests: Map<
    string,
    {
      params: RequestPermissionRequest
      resolve: (response: RequestPermissionResponse) => void
      controller: AbortController
    }
  > = new Map()
  private requestCounter = 0

  /**
   * Creates a new PermissionHandler instance.
   *
   * @param server_instance - The AgenticServer instance for accessing system resources
   */
  constructor(private readonly server_instance: AgenticServer) {
    this.agent = this.server_instance.getState()?.agent
  }

  /**
   * Processes a permission request based on agent's permission rules.
   * Automatically grants or denies permissions based on the agent's global permission rule,
   * or prompts the user interactively if no automatic rule is set.
   *
   * @param params - RequestPermissionRequest parameters
   * @returns A promise that resolves to RequestPermissionResponse
   * @throws {Error} If no agent is found in state, if appropriate permission options are missing,
   *                 or if an invalid option is selected
   */
  async requestPermission(
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    logDebug('Requesting permission with params:', params)

    this.agent = this.server_instance.getState()?.agent

    if (!this.agent) {
      throw new Error('No agent found in state')
    }

    const autoGrant =
      this.agent.permissions_rule === GlobalPermissionsRule.allow
    const autoDeny = this.agent.permissions_rule === GlobalPermissionsRule.deny

    if (autoGrant) {
      const allowOption = params.options.find(
        (option) =>
          option.kind === 'allow_always' || option.kind === 'allow_once',
      )

      if (!allowOption) {
        throw new Error(
          'No allow option found in request, but permissions rule is set to allow',
        )
      }

      return {
        _meta: params._meta,
        outcome: {
          outcome: 'selected',
          optionId: allowOption.optionId,
        },
      }
    }

    if (autoDeny) {
      const denyOption = params.options.find(
        (option) =>
          option.kind === 'reject_always' || option.kind === 'reject_once',
      )

      if (!denyOption) {
        throw new Error(
          'No deny option found in request, but permissions rule is set to deny',
        )
      }

      return {
        _meta: params._meta,
        outcome: {
          outcome: 'selected',
          optionId: denyOption.optionId,
        },
      }
    }

    const key = `permission_${++this.requestCounter}`
    const controller = new AbortController()

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(key, { params, resolve, controller })

      // A cancel (`rejectAllPending`) resolves first; the later settle from
      // the aborted question is then a no-op.
      this._askUser(params, controller.signal)
        .then(resolve, reject)
        .finally(() => this.pendingRequests.delete(key))
    })
  }

  /**
   * Asks the editor which option to pick. The options are sent structured
   * (`id` = ACP `optionId`) and also listed in the text for editors that only
   * render the question. An unrecognised answer is treated as a rejection
   * rather than an error, so a typo never aborts the agent's turn.
   */
  private async _askUser(
    params: RequestPermissionRequest,
    signal: AbortSignal,
  ): Promise<RequestPermissionResponse> {
    const commsInterface = this.server_instance.getCommsInterface()

    if (!commsInterface) {
      throw new Error('Comms interface not available for prompting')
    }

    const title = `Permission Requested: ${params.toolCall.title}`
    const listed = params.options
      .map((option, index) => `${index + 1}. ${option.name} (${option.kind})`)
      .join('\n')

    const options = params.options.map((option) => ({
      id: option.optionId,
      label: option.name,
      description: option.kind,
    }))

    const answer = await commsInterface.question(
      {
        questionId: params.toolCall.toolCallId
          ? `permission_${params.toolCall.toolCallId}`
          : undefined,
        question: `${title}\n\nOptions:\n${listed}\n\nEnter the number of your choice:`,
        options,
      },
      { signal },
    )

    const optionId = resolveOptionAnswer(answer, options)

    if (optionId) {
      return {
        _meta: params._meta,
        outcome: { outcome: 'selected', optionId },
      }
    }

    logWarning(
      `Unrecognised permission answer "${answer}"; rejecting the request`,
    )

    const rejectOption = params.options.find(
      (option) => option.kind === 'reject_once',
    )

    return rejectOption
      ? {
          _meta: params._meta,
          outcome: { outcome: 'selected', optionId: rejectOption.optionId },
        }
      : { _meta: params._meta, outcome: { outcome: 'cancelled' } }
  }

  /**
   * Cancels pending interactive requests (all, or only those for the given
   * ACP session id): answers the agent with `cancelled` and withdraws the
   * question from the editor.
   */
  rejectAllPending(acpSessionId?: string) {
    for (const [key, pending] of Array.from(this.pendingRequests.entries())) {
      if (acpSessionId && pending.params.sessionId !== acpSessionId) {
        continue
      }

      pending.resolve({ outcome: { outcome: 'cancelled' } })
      pending.controller.abort()
      this.pendingRequests.delete(key)
    }
  }

  dispose() {
    logDebug('Disposing PermissionHandler')
    this.rejectAllPending()
    this.agent = undefined
  }
}
