/**
 * Host Remote owner for the `usage` namespace: the token-usage summaries the
 * settings Usage page reads.
 *
 * The namespace is registered whatever the composition mounts, and a missing
 * ledger answers with an actionable diagnostic rather than leaving the client
 * with an unresolved namespace. The controller owns no data of its own — it
 * decodes a wire window, asks `ctx.usageLedger`, and returns.
 *
 * @module @deepseek-ai/dsh-api-usage-controller
 */

import { Context } from '@deepseek-ai/cordis'
import { BalanceError } from '@deepseek-ai/dsh-deepseek-balance'
// Type-only: activates the `ctx.deepseekBalance` Context declaration.
import type {} from '@deepseek-ai/dsh-deepseek-balance'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: activates the `ctx.usageLedger` Context declaration.
import type {} from '@deepseek-ai/dsh-usage-ledger'
// The balance type is imported from its owning package rather than through this
// package's re-export: a Remote signature must name a cross-package type at an
// explicit package import, and the generator refuses an indirect one.
import type { BalanceSnapshot } from '@deepseek-ai/dsh-deepseek-balance/types'
// Explicit package import: a Remote signature may not reach a cross-package
// type through this package's own re-export.
import type { BalanceHistory } from '@deepseek-ai/dsh-balance-ledger/types'
import { usageWindowSchema } from './types.ts'
import type { UsageSummaryRequest, UsageSummaryView, UsageWindow } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `usage` Remote namespace. */
    usageController: UsageController
  }
}

/**
 * Host service backing the generated `ctx.remote.usage` namespace.
 *
 * The window is validated here rather than trusted, because it arrives from the
 * wire; the ledger below re-checks it for its own direct callers. A malformed
 * or inverted window is a caller error and reports as one instead of becoming
 * an empty summary that looks like "no usage".
 */
export class UsageController extends TypertRemoteService {
  /**
   * @param ctx - Host context where the ledger may be mounted.
   */
  constructor(ctx: Context) {
    super(ctx, 'usageController', { namespace: 'usage' })
  }

  /**
   * Summarize token usage over one window, summed across every accounted
   * session and split by UTC hour and by model route.
   *
   * Routes with no usage inside the window are absent from the reply rather
   * than present at zero, so a caller rendering one series per route needs no
   * filter of its own. Sessions whose ledger is still missing are counted in
   * `unaccountedSessions`; a caller MUST surface that gap rather than present
   * the totals as complete.
   *
   * @param request - the window to aggregate, in Unix epoch milliseconds.
   * @param signal - caller cancellation supplied by the Remote carrier.
   * @returns the merged summary.
   * @throws RemoteError with `usage/bad-window` when the window cannot describe a range.
   * @throws RemoteError with `usage/summary-failed` when no ledger is mounted or the read fails.
   */
  @Remote('summary')
  async summary(request: UsageSummaryRequest, signal: AbortSignal): Promise<UsageSummaryView> {
    const decoded = usageWindowSchema.safeParse(request)
    if (!decoded.success) {
      const { sinceMs, untilMs } = readBounds(request)
      throw new RemoteError('usage/bad-window', decoded.error.message, { sinceMs, untilMs })
    }
    const { sinceMs, untilMs } = decoded.data
    if (!Number.isSafeInteger(sinceMs) || !Number.isSafeInteger(untilMs) || sinceMs > untilMs) {
      throw new RemoteError(
        'usage/bad-window',
        `usage summary window must be two safe integers with sinceMs <= untilMs, got ${sinceMs}..${untilMs}`,
        { sinceMs, untilMs },
      )
    }

    const ledger = this.ctx.get('usageLedger')
    if (ledger === undefined) {
      throw new RemoteError('usage/summary-failed', 'no usage ledger is mounted in this composition', {
        reason: 'usage-ledger-unmounted',
      })
    }
    try {
      return await ledger.summary({ sinceMs, untilMs }, signal)
    } catch (error: unknown) {
      throw new RemoteError(
        'usage/summary-failed',
        error instanceof Error ? error.message : String(error),
        { reason: 'ledger-read-failed' },
        { cause: error },
      )
    }
  }

  /**
   * Read the DeepSeek account balance once.
   *
   * The balance is account-level, not session-level: it is the one fact here
   * that a reader cannot derive from the local log, because it also covers
   * usage this harness never made (the web console, another machine, another
   * tool). It is a snapshot of a moment, never a total, so a caller that wants
   * a trend has to keep its own samples.
   *
   * @param signal - caller cancellation supplied by the Remote carrier.
   * @returns the account's availability and per-currency balances.
   * @throws RemoteError with `usage/balance-unavailable` when no reader is mounted.
   * @throws RemoteError with `usage/balance-failed` when the read fails; `reason` carries the provider-side code.
   */
  @Remote('balance')
  async remoteBalance(signal: AbortSignal): Promise<BalanceSnapshot> {
    // The ledger records what it reads: a reading nobody kept cannot take part
    // in any later difference, so routing through it is what keeps the spend
    // curve fed by the very reads this page performs.
    const ledger = this.ctx.get('balanceLedger')
    if (ledger !== undefined) return await this.balanceOutcome(() => ledger.sample(signal))
    const reader = this.ctx.get('deepseekBalance')
    if (reader === undefined) {
      throw new RemoteError(
        'usage/balance-unavailable',
        'no balance reader is mounted in this composition',
        { reason: 'deepseek-balance-unmounted' },
      )
    }
    return await this.balanceOutcome(() => reader.read(signal))
  }

  /**
   * Read every recent balance reading, per currency, over one window.
   *
   * Each currency's series includes the newest reading before the window, so a
   * caller can measure the interval that begins at the window's own start
   * instead of silently losing it. Readings are returned raw: whether a fall is
   * spend and a rise is a top-up is arithmetic the caller performs, and the
   * caller's own timezone decides which day each interval belongs to.
   *
   * @param request - the window to cover, in Unix epoch milliseconds.
   * @param signal - caller cancellation supplied by the Remote carrier.
   * @returns one entry per currency with a usable baseline.
   * @throws RemoteError with `usage/history-unavailable` when no ledger is mounted.
   * @throws RemoteError with `usage/bad-window` when the window cannot describe a range.
   */
  @Remote('balanceHistory')
  remoteBalanceHistory(request: UsageWindow, signal: AbortSignal): BalanceHistory {
    const ledger = this.ctx.get('balanceLedger')
    if (ledger === undefined) {
      throw new RemoteError(
        'usage/history-unavailable',
        'no balance ledger is mounted in this composition, so no reading was ever kept',
        { reason: 'balance-ledger-unmounted' },
      )
    }
    const decoded = usageWindowSchema.safeParse(request)
    if (!decoded.success) {
      const { sinceMs, untilMs } = readBounds(request)
      throw new RemoteError('usage/bad-window', decoded.error.message, { sinceMs, untilMs })
    }
    const { sinceMs, untilMs } = decoded.data
    if (!Number.isSafeInteger(sinceMs) || !Number.isSafeInteger(untilMs) || sinceMs > untilMs) {
      throw new RemoteError(
        'usage/bad-window',
        `balance history window must be two safe integers with sinceMs <= untilMs, got ${sinceMs}..${untilMs}`,
        { sinceMs, untilMs },
      )
    }
    signal.throwIfAborted()
    return ledger.history({ sinceMs, untilMs })
  }

  /** Run one balance read, classifying its failure for the wire. */
  private async balanceOutcome(read: () => Promise<BalanceSnapshot>): Promise<BalanceSnapshot> {
    try {
      return await read()
    } catch (error: unknown) {
      throw new RemoteError(
        'usage/balance-failed',
        error instanceof Error ? error.message : String(error),
        { reason: error instanceof BalanceError ? error.code : 'UNKNOWN' },
        { cause: error },
      )
    }
  }
}

/**
 * Read whatever numeric bounds a rejected payload did carry, so the diagnostic
 * names the values the caller actually sent instead of a placeholder.
 * @param request - the rejected wire value.
 * @returns the two bounds, or `NaN` where the value was not a number.
 */
function readBounds(request: unknown): { sinceMs: number; untilMs: number } {
  const bounds = request as { sinceMs?: unknown; untilMs?: unknown } | null
  const read = (value: unknown): number => typeof value === 'number' ? value : Number.NaN
  return { sinceMs: read(bounds?.sinceMs), untilMs: read(bounds?.untilMs) }
}

export default UsageController
