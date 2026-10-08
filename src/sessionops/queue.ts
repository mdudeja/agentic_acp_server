import type { SessionOp, SessionOpTier } from 'src/config/schemas'

/**
 * Outcome a single tier can report for a session operation.
 *
 * - `ok`          — the tier served the operation.
 * - `unavailable` — the tier cannot serve this operation at all (capability
 *                   absent, no ACP method for it, no provider CLI, unknown
 *                   session). The queue advances to the next tier.
 * - `error`       — the tier could serve it but the attempt failed. The queue
 *                   stops and surfaces the error; it does NOT fall through,
 *                   to avoid masking real failures and duplicating side
 *                   effects (e.g. a partial delete).
 */
export type TierOutcome<T> =
  | { status: 'ok'; value: T }
  | { status: 'unavailable'; reason?: string }
  | { status: 'error'; message: string }

export type TierHandler<T> = () => Promise<TierOutcome<T>>

/**
 * Explicit tier selection for a session operation, or `'auto'` to use the
 * tier policy configured in `config.sessionOps[op]`.
 */
export type SessionOpSource = SessionOpTier | 'auto'

export type TierQueueResult<T> =
  | { ok: true; value: T; tier: SessionOpTier }
  | {
      ok: false
      reason: 'unavailable' | 'error'
      tier?: SessionOpTier
      message: string
    }

export interface RunTierQueueArgs<T> {
  /** The operation being served, used in diagnostics. */
  op: SessionOp
  /** Ordered tiers to try, from `config.sessionOps[op]`. */
  tiers: SessionOpTier[]
  /** Handler per tier. A missing handler is treated as `unavailable`. */
  handlers: Partial<Record<SessionOpTier, TierHandler<T>>>
}

/** Build an `ok` outcome. */
export function ok<T>(value: T): TierOutcome<T> {
  return { status: 'ok', value }
}

/** Build an `unavailable` outcome (advances to the next tier). */
export function unavailable<T = never>(reason?: string): TierOutcome<T> {
  return { status: 'unavailable', reason }
}

/** Build an `error` outcome (stops the queue). */
export function tierError<T = never>(message: string): TierOutcome<T> {
  return { status: 'error', message }
}

/**
 * Runs an ordered fallback queue for a session operation.
 *
 * Advances to the next tier only while the current one reports `unavailable`.
 * The first tier that reports `ok` wins; the first that reports `error` (or
 * throws) stops the queue and is returned. If every tier is unavailable, the
 * last unavailability reason is returned.
 */
export async function runTierQueue<T>({
  op,
  tiers,
  handlers,
}: RunTierQueueArgs<T>): Promise<TierQueueResult<T>> {
  let lastUnavailable = `No tier available for '${op}'`

  for (const tier of tiers) {
    const handler = handlers[tier]

    if (!handler) {
      lastUnavailable = `Tier '${tier}' is not implemented for '${op}'`
      continue
    }

    let outcome: TierOutcome<T>
    try {
      outcome = await handler()
    } catch (error) {
      return {
        ok: false,
        reason: 'error',
        tier,
        message: error instanceof Error ? error.message : String(error),
      }
    }

    if (outcome.status === 'ok') {
      return { ok: true, value: outcome.value, tier }
    }

    if (outcome.status === 'error') {
      return { ok: false, reason: 'error', tier, message: outcome.message }
    }

    lastUnavailable =
      outcome.reason ?? `Tier '${tier}' is unavailable for '${op}'`
  }

  return { ok: false, reason: 'unavailable', message: lastUnavailable }
}
