import type {
  ServerResponse,
  ServerNotification,
  ASMPayload,
} from 'src/comms/ICommsInterface'
import type { InMemoryCommsInterface } from './InMemoryCommsInterface'

export function commandResponseRoundTrip(
  payload: ASMPayload,
  comms?: InMemoryCommsInterface,
): Promise<Array<ServerResponse | ServerNotification>> {
  const mode = process.env.ACP_APP_MODE

  if (mode === 'server') {
    return wsRoundTrip(payload)
  }

  if (!comms) {
    throw new Error(
      'commandResponseRoundTrip: an InMemoryCommsInterface is required in rpc mode',
    )
  }

  return localRoundTrip(payload, comms)
}

function wsRoundTrip(
  payload: ASMPayload,
): Promise<Array<ServerResponse | ServerNotification>> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${process.env.ACP_HTTP_PORT}/ws`)
    const messages: Array<ServerResponse | ServerNotification> = []

    ws.onopen = () => {
      ws.send(JSON.stringify(payload))
    }

    ws.onmessage = (event) => {
      if (!event.data) {
        ws.close()
        reject(new Error('Received empty message from WebSocket'))
        return
      }

      try {
        const message = JSON.parse(event.data) as
          | ServerResponse
          | ServerNotification
        messages.push(message)
        if (
          message.type === 'notification' &&
          (message.data as any).level === 'error'
        ) {
          ws.close()
          reject(
            new Error(
              `Received error notification: ${(message.data as any).message}`,
            ),
          )
          return
        }
        if (
          message.type === 'response' &&
          message.method === payload.data.method
        ) {
          ws.close()
          resolve(messages)
        }
      } catch (err) {
        ws.close()
        reject(new Error(`Failed to parse WebSocket message: ${err}`))
        return
      }
    }

    ws.onerror = (err) => reject(err)

    setTimeout(() => {
      ws.close()
      if (messages.length === 0) {
        reject(
          new Error(
            'Did not receive any messages from WebSocket before timeout',
          ),
        )
        return
      }
      resolve(messages)
    }, 5000)
  })
}

function localRoundTrip(
  payload: ASMPayload,
  comms: InMemoryCommsInterface,
): Promise<Array<ServerResponse | ServerNotification>> {
  return new Promise((resolve, reject) => {
    const messages: Array<ServerResponse | ServerNotification> = []

    const unsubscribe = comms.onOutgoing((msg) => {
      messages.push(msg)

      if (
        msg.type === 'notification' &&
        (msg.data as any).level === 'error'
      ) {
        clearTimeout(timeout)
        unsubscribe()
        reject(
          new Error(
            `Received error notification: ${(msg.data as any).message}`,
          ),
        )
        return
      }

      if (msg.type === 'response' && msg.method === payload.data.method) {
        clearTimeout(timeout)
        unsubscribe()
        resolve(messages)
      }
    })

    const timeout = setTimeout(() => {
      unsubscribe()
      if (messages.length === 0) {
        reject(
          new Error('Did not receive any messages from RPC before timeout'),
        )
      } else {
        resolve(messages)
      }
    }, 5000)

    comms.send(payload).catch((err) => {
      clearTimeout(timeout)
      unsubscribe()
      reject(err)
    })
  })
}
