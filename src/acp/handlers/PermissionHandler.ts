import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk'
import type { AgenticServer } from 'src/AgenticServer'
import { GlobalPermissionsRule, type Agent } from 'src/database/schemas'
import { logDebug } from 'src/utils/logger'

/**
 * Handler for processing permission requests.
 * Manages permission prompts based on agent-specific permission rules,
 * supporting automatic grants, denials, or interactive user prompts.
 */
export class PermissionHandler {
  agent?: Agent['Select']
  pendingRequests: Map<
    string,
    {
      params: RequestPermissionRequest
      resolve: (response: RequestPermissionResponse) => void
      reject: (error: Error) => void
    }
  > = new Map()

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

    return new Promise(async (resolve, reject) => {
      const title = `Permission Requested: ${params.toolCall.title}`
      this.pendingRequests.set(params.sessionId, { params, resolve, reject })

      const options = params.options
        .map((option, index) => `${index + 1}. ${option.name} (${option.kind})`)
        .join('\n')

      const prompt = `${title}\n\nOptions:\n${options}\n\nEnter the number of your choice:`

      const commsInterface = this.server_instance.getCommsInterface()

      if (!commsInterface) {
        throw new Error('Comms interface not available for prompting')
      }

      const answer = await commsInterface.question({
        question: prompt,
      })

      const selectedIndex = parseInt(answer.trim(), 10) - 1

      if (selectedIndex < 0 || selectedIndex >= params.options.length) {
        throw new Error('Invalid option selected')
      }

      const selectedOption = params.options[selectedIndex]

      return {
        _meta: params._meta,
        outcome: {
          outcome: 'selected',
          optionId: selectedOption!.optionId,
        },
      }
    })
  }

  rejectAllPending(sessionId?: string) {
    for (const [key, { resolve }] of this.pendingRequests.entries()) {
      if (!sessionId || key === sessionId) {
        resolve({
          outcome: {
            outcome: 'cancelled',
          },
        })
      }
    }
    this.pendingRequests.clear()
  }

  dispose() {
    logDebug('Disposing PermissionHandler')
    this.rejectAllPending()
    this.agent = undefined
  }
}
