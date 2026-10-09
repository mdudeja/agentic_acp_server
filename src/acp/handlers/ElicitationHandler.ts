import type {
  CompleteElicitationNotification,
  CreateElicitationRequest,
  CreateElicitationResponse,
  ElicitationPropertySchema,
} from '@agentclientprotocol/sdk'
import { CreateElicitationRequest as ElicitationRequestGuard } from '@agentclientprotocol/sdk'
import type { AgenticServer } from 'src/AgenticServer'
import { logDebug, logWarning } from 'src/utils/logger'

/**
 * A single user-provided value for an elicitation form.
 */
type ElicitationContentValue = string | number | boolean | string[]

/**
 * Handler for ACP **elicitation** requests.
 *
 * Elicitation is how an agent asks the client (the editor plugin) for
 * structured user input. There are two modes:
 *
 * - `form` — the agent provides a JSON Schema describing form fields; the
 *   client renders a form and returns the filled-in values.
 * - `url`  — the agent provides a URL for the user to visit; the client tells
 *   the user to open it and returns whether it was accepted.
 *
 * Because the editor plugin's ASM surface is a string-based question/answer
 * flow (via `agentic/question` + `client/answer`), we surface the elicitation
 * as an interactive question to the user and interpret their answer as the
 * form's content.
 *
 * @see https://agentclientprotocol.com/protocol/elicitation
 */
export class ElicitationHandler {
  constructor(private readonly server_instance: AgenticServer) {}

  /**
   * Handles an `elicitation/create` request from the agent.
   *
   * Prompts the user and returns a typed `CreateElicitationResponse`.
   */
  async createElicitation(
    params: CreateElicitationRequest,
  ): Promise<CreateElicitationResponse> {
    logDebug('Handling elicitation request:', params)

    const comms = this.server_instance.getCommsInterface()

    if (ElicitationRequestGuard.isUrl(params)) {
      logWarning(
        `[Elicitation] Agent requests URL-based elicitation: ${params.url}`,
      )
      const answer = await comms.question({
        questionId: `elicitation_url_${Date.now()}`,
        question: `${params.message}\n\nPlease open this URL and then confirm once you've completed it:\n${params.url}\n\nType "yes" to accept, or anything else to decline.`,
      })
      const accepted = answer.trim().toLowerCase() === 'yes'
      return accepted ? { action: 'accept' } : { action: 'decline' }
    }

    if (ElicitationRequestGuard.isForm(params)) {
      const fields = this._describeFields(params.requestedSchema.properties)
      const answer = await comms.question({
        questionId: `elicitation_${Date.now()}`,
        question: `${params.message}\n\nPlease provide the following values (one per line, as "field: value"):\n${fields}\n\nType "cancel" to decline.`,
      })
      if (answer.trim().toLowerCase() === 'cancel') {
        return { action: 'decline' }
      }
      const content = this._parseFormAnswer(
        answer,
        params.requestedSchema.properties,
      )
      return { action: 'accept', content }
    }

    // Unknown / custom elicitation mode — decline gracefully.
    logWarning(
      `[Elicitation] Unsupported elicitation mode for message: ${params.message}`,
    )
    return { action: 'decline' }
  }

  /**
   * Handles an `elicitation/complete` notification from the agent (fires after
   * a URL-based elicitation has completed on the agent's side).
   */
  async completeElicitation(
    params: CompleteElicitationNotification,
  ): Promise<void> {
    logDebug(`Elicitation completed: ${params.elicitationId}`)
  }

  /**
   * Renders the form schema's properties as a human-readable list.
   */
  private _describeFields(
    properties: Record<string, ElicitationPropertySchema> | undefined,
  ): string {
    if (!properties) return '(no fields)'
    return Object.entries(properties)
      .map(([name, prop]) => {
        const title = prop.title ? ` (${prop.title})` : ''
        const desc = prop.description ? ` — ${prop.description}` : ''
        return `  - ${name}${title}: ${prop.type}${desc}`
      })
      .join('\n')
  }

  /**
   * Best-effort parse of the user's textual answer into form content.
   *
   * Lines of the form `field: value` are split into key/value pairs. Anything
   * else is collapsed into a single `answer` field so no user input is lost.
   */
  private _parseFormAnswer(
    answer: string,
    properties: Record<string, ElicitationPropertySchema> | undefined,
  ): Record<string, ElicitationContentValue> {
    const content: Record<string, ElicitationContentValue> = {}
    const lines = answer
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)

    for (const line of lines) {
      const idx = line.indexOf(':')
      if (idx > 0) {
        const key = line.slice(0, idx).trim()
        const value = line.slice(idx + 1).trim()
        if (key) content[key] = this._coerce(value, properties?.[key])
      }
    }

    if (Object.keys(content).length === 0) {
      content['answer'] = answer
    }
    return content
  }

  /**
   * Converts a typed-in value to the JSON type its schema property declares
   * (`number`, `integer`, `boolean`, `array`), so the agent's validation
   * does not reject e.g. `"3"` for a number field. Values that don't parse
   * are kept as strings rather than dropped.
   */
  private _coerce(
    value: string,
    property: ElicitationPropertySchema | undefined,
  ): ElicitationContentValue {
    switch (property?.type) {
      case 'number': {
        const parsed = Number(value)
        return value !== '' && !Number.isNaN(parsed) ? parsed : value
      }
      case 'integer': {
        const parsed = Number(value)
        return value !== '' && Number.isInteger(parsed) ? parsed : value
      }
      case 'boolean':
        if (/^(true|yes|y|1)$/i.test(value)) return true
        if (/^(false|no|n|0)$/i.test(value)) return false
        return value
      case 'array':
        return value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      default:
        return value
    }
  }

  dispose(): void {
    // No resources to clean up in this handler.
  }
}
