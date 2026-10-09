import type { ASMPayload } from 'src/openrpc/schemas'
import type {
  ServerNotification,
  ServerResponse,
} from 'src/comms/ICommsInterface'
import type { InMemoryCommsInterface } from './InMemoryCommsInterface'

/**
 * Failure paths must still answer the request. Unlike
 * `commandResponseRoundTrip`, this does not bail out on error-level logs
 * (failures log by design); it waits for the response to `requestId`.
 */
export function request(
  comms: InMemoryCommsInterface,
  method: string,
  params: Record<string, unknown>,
): Promise<{ response: ServerResponse; notifications: ServerNotification[] }> {
  const requestId = `${method}-${Math.random()}`
  const notifications: ServerNotification[] = []

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error(`No response to ${method} within 5s`))
    }, 5000)

    const unsubscribe = comms.onOutgoing((msg) => {
      if (msg.type === 'notification') {
        notifications.push(msg)
        return
      }
      if (msg.id === requestId) {
        clearTimeout(timeout)
        unsubscribe()
        resolve({ response: msg, notifications })
      }
    })

    comms
      .send({
        jsonrpc: '2.0',
        data: { method, params: { requestId, ...params } },
      } as ASMPayload)
      .catch(reject)
  })
}
