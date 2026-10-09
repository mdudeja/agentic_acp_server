import type {
  ASMMethod,
  ASMPayloadParams,
  ICommsInterface,
} from 'src/comms/ICommsInterface'
import type { Providers } from 'src/data/providers'
import type { HookEventName, HookInput } from 'src/hooks/events'
import type { HookManager } from 'src/hooks/HookManager'
import type { HookRunOutcome } from 'src/hooks/types'
import type { AgentManager } from 'src/managers/AgentManager'
import type { IndexerManager } from 'src/managers/IndexerManager'
import type { NesManager } from 'src/managers/NesManager'
import type { SessionManager } from 'src/managers/SessionManager'
import type { AppStateManager } from 'src/state'

export type RunHooks = <E extends HookEventName>(
  event: E,
  input: HookInput<E>,
) => Promise<HookRunOutcome<E>>

/** What the event-wiring functions (`src/server/wiring/`) need. */
export interface WiringDeps {
  comms: ICommsInterface
  state: AppStateManager
  runHooks: RunHooks
}

/**
 * What ASM request handlers (`src/server/handlers/`) may use of the server.
 * Like `HookHost`, it keeps handlers off `AgenticServer` internals.
 *
 * The manager accessors throw when the manager does not exist yet; the
 * dispatcher turns that into an error response.
 */
export interface HandlerContext {
  comms: ICommsInterface
  state: AppStateManager
  activeProvider(): Providers | null
  /** `hint` replaces the default "Call client/init first." advice. */
  sessions(hint?: string): SessionManager
  nes(): NesManager
  hooks(): HookManager
  indexer(): IndexerManager
  agent(): AgentManager | null
  /** Starts (or reuses) the agent and answers the request itself. */
  startProvider(
    params: ASMPayloadParams['client/init'],
    method: 'client/init' | 'client/switch_provider',
  ): Promise<boolean>
  dispose(): Promise<void>
}

export type Handler<M extends ASMMethod> = (
  params: ASMPayloadParams[M],
  ctx: HandlerContext,
) => Promise<void> | void

/** One handler per ASM method; a method without one is a type error. */
export type HandlerMap = { [M in ASMMethod]: Handler<M> }
