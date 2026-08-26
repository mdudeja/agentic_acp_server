import { methods } from '@agentclientprotocol/sdk'
import type {
  AcceptNesNotification,
  CloseNesRequest,
  DidChangeDocumentNotification,
  DidCloseDocumentNotification,
  DidFocusDocumentNotification,
  DidOpenDocumentNotification,
  DidSaveDocumentNotification,
  RejectNesNotification,
  StartNesRequest,
  SuggestNesRequest,
} from '@agentclientprotocol/sdk'
import type { AgenticServer } from 'src/AgenticServer'
import type { AppState } from 'src/state/types'
import { BaseManager } from './BaseManager'
import type { NesEvents } from 'src/data/events'

type TrackedConnection = NonNullable<AppState['connection']>

/**
 * Manages NES (Next Edit Suggestions) sessions with the agent.
 *
 * NES is a distinct feature from chat sessions: per the ACP spec, `nes/start`
 * always begins its own independent session that has no correlation with the
 * chat session. It therefore lives in its own manager rather than
 * `SessionManager` (which is the chat-session manager).
 *
 * All methods are no-ops (and emit `nes.error`) when the agent does not
 * advertise the `nes` capability.
 */
export class NesManager extends BaseManager<NesEvents> {
  private connection: TrackedConnection | null = null

  constructor(private readonly server_instance: AgenticServer) {
    super()
  }

  /**
   * Reads the active connection from state. Called after `client/init`.
   */
  init() {
    const connection = this.server_instance.getState()?.connection
    if (!connection) {
      this.emit(
        'nes.error',
        'No active connection found. Please use `client/init` command first.',
      )
      return
    }
    this.connection = connection
  }

  /**
   * Starts a NES session with the agent.
   *
   * Only available if the agent advertises the `nes` capability.
   */
  async startNes(params: StartNesRequest, requestId?: string) {
    if (!this._checkCapability()) return

    try {
      const resp = await this.connection!.clientContext.request(
        methods.agent.nes.start,
        params,
      )
      this.emit('nes.started', { requestId, data: resp.sessionId })
      return resp
    } catch (error) {
      this.emit('nes.error', `Failed to start NES session: ${error}`)
      return
    }
  }

  /**
   * Requests a NES suggestion for a document.
   *
   * Only available if the agent advertises the `nes` capability.
   */
  async suggestNes(params: SuggestNesRequest, requestId?: string) {
    if (!this._checkCapability()) return

    try {
      const resp = await this.connection!.clientContext.request(
        methods.agent.nes.suggest,
        params,
      )
      this.emit('nes.suggested', { requestId, data: resp })
      return resp
    } catch (error) {
      this.emit('nes.error', `Failed to get NES suggestion: ${error}`)
      return
    }
  }

  /**
   * Closes a NES session.
   *
   * Only available if the agent advertises the `nes` capability.
   */
  async closeNes(sessionId: string, requestId?: string) {
    if (!this._checkCapability()) return

    try {
      await this.connection!.clientContext.request(methods.agent.nes.close, {
        sessionId,
      } satisfies CloseNesRequest)
      this.emit('nes.closed', { requestId, data: sessionId })
      return { success: true }
    } catch (error) {
      this.emit('nes.error', `Failed to close NES session: ${error}`)
      return
    }
  }

  /**
   * Notifies the agent that a NES suggestion was accepted.
   */
  async acceptNes(sessionId: string, id: string, _requestId?: string) {
    if (!this._checkCapability()) return

    try {
      await this.connection!.clientContext.notify(methods.agent.nes.accept, {
        sessionId,
        id,
      } satisfies AcceptNesNotification)
      return { success: true }
    } catch (error) {
      this.emit('nes.error', `Failed to accept NES suggestion: ${error}`)
      return
    }
  }

  /**
   * Notifies the agent that a NES suggestion was rejected.
   */
  async rejectNes(
    sessionId: string,
    id: string,
    reason?: RejectNesNotification['reason'],
    _requestId?: string,
  ) {
    if (!this._checkCapability()) return

    try {
      await this.connection!.clientContext.notify(methods.agent.nes.reject, {
        sessionId,
        id,
        reason,
      } satisfies RejectNesNotification)
      return { success: true }
    } catch (error) {
      this.emit('nes.error', `Failed to reject NES suggestion: ${error}`)
      return
    }
  }

  /**
   * Notifies the agent that a document was opened.
   */
  async didOpenDocument(params: DidOpenDocumentNotification, _requestId?: string) {
    if (!this._checkCapability()) return
    try {
      await this.connection!.clientContext.notify(
        methods.agent.document.didOpen,
        params,
      )
    } catch (error) {
      this.emit('nes.error', `Failed to notify document open: ${error}`)
    }
  }

  /**
   * Notifies the agent that a document was changed.
   */
  async didChangeDocument(
    params: DidChangeDocumentNotification,
    _requestId?: string,
  ) {
    if (!this._checkCapability()) return
    try {
      await this.connection!.clientContext.notify(
        methods.agent.document.didChange,
        params,
      )
    } catch (error) {
      this.emit('nes.error', `Failed to notify document change: ${error}`)
    }
  }

  /**
   * Notifies the agent that a document was closed.
   */
  async didCloseDocument(sessionId: string, uri: string, _requestId?: string) {
    if (!this._checkCapability()) return
    try {
      await this.connection!.clientContext.notify(
        methods.agent.document.didClose,
        { sessionId, uri } satisfies DidCloseDocumentNotification,
      )
    } catch (error) {
      this.emit('nes.error', `Failed to notify document close: ${error}`)
    }
  }

  /**
   * Notifies the agent that a document was saved.
   */
  async didSaveDocument(sessionId: string, uri: string, _requestId?: string) {
    if (!this._checkCapability()) return
    try {
      await this.connection!.clientContext.notify(
        methods.agent.document.didSave,
        { sessionId, uri } satisfies DidSaveDocumentNotification,
      )
    } catch (error) {
      this.emit('nes.error', `Failed to notify document save: ${error}`)
    }
  }

  /**
   * Notifies the agent that a document received focus.
   */
  async didFocusDocument(params: DidFocusDocumentNotification, _requestId?: string) {
    if (!this._checkCapability()) return
    try {
      await this.connection!.clientContext.notify(
        methods.agent.document.didFocus,
        params,
      )
    } catch (error) {
      this.emit('nes.error', `Failed to notify document focus: ${error}`)
    }
  }

  dispose() {
    this.removeAllListeners()
    this.connection = null
  }

  private _checkCapability(): boolean {
    if (!this.server_instance.hasCapability('nes')) {
      this.emit(
        'nes.error',
        'The connected server does not support NES (Next Edit Suggestions).',
      )
      return false
    }

    if (!this.connection) {
      this.emit(
        'nes.error',
        'No active connection found. Please use `client/init` command first.',
      )
      return false
    }

    return true
  }
}
