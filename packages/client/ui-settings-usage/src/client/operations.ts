/**
 * The Host reads the Usage section performs, as callbacks built in the plugin
 * body. The section receives these instead of a context, so failure codes and
 * Remote namespaces stay in the apply world.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { BalanceHistory, BalanceSnapshot, UsageSummaryView } from '@deepseek-ai/dsh-api-usage-controller/types'

/** What one summary read answered. */
export type UsageSummaryOutcome =
  /** The Host produced a summary for the requested window. */
  | { readonly kind: 'loaded'; readonly summary: UsageSummaryView }
  /** The read was refused, with the Host's own diagnostic. */
  | { readonly kind: 'refused'; readonly message: string }

/** One window, as the section computes it from its own local days. */
export interface UsageWindow {
  /** Inclusive lower bound, Unix epoch milliseconds. */
  readonly sinceMs: number
  /** Inclusive upper bound, Unix epoch milliseconds. */
  readonly untilMs: number
}

/** What one balance read answered. */
export type BalanceOutcome =
  /** The Host read the account balance. */
  | { readonly kind: 'loaded'; readonly snapshot: BalanceSnapshot }
  /**
   * The read was refused. A missing or unsupported balance endpoint is not a
   * page failure: the token figures above stand on their own, so the card
   * reports this quietly instead of taking the page down.
   */
  | { readonly kind: 'refused'; readonly message: string }

/** What one history read answered. */
export type BalanceHistoryOutcome =
  /** The Host returned the readings it kept for the window. */
  | { readonly kind: 'loaded'; readonly history: BalanceHistory }
  /** No ledger is mounted, or the read was refused. */
  | { readonly kind: 'refused'; readonly message: string }

/** The Host operations the Usage page invokes. */
export interface UsageOperations {
  /**
   * Read one window's token summary.
   * @param window - the window to aggregate, in Unix epoch milliseconds.
   * @returns the summary, or the refusal the page renders.
   */
  loadSummary(window: UsageWindow): Promise<UsageSummaryOutcome>
  /**
   * Read the account balance once.
   * @param signal - cancellation for the read.
   * @returns the snapshot, or the refusal the card renders.
   */
  loadBalance(signal?: AbortSignal): Promise<BalanceOutcome>
  /**
   * Read the kept balance readings for one window.
   * @param window - the window to cover, in Unix epoch milliseconds.
   * @returns the readings, or the refusal the curve reports.
   */
  loadHistory(window: UsageWindow): Promise<BalanceHistoryOutcome>
}

/**
 * Build the section's Host callbacks.
 * @param ctx - the section plugin's context, which declares `remote.usage` in its own `inject`.
 * @returns the callbacks the section is injected with.
 */
export function createUsageOperations(ctx: ClientContext): UsageOperations {
  return {
    loadSummary: async (window) => {
      const response = await ctx.remote.usage.summary(window)
      return response.ok
        ? { kind: 'loaded', summary: response.value }
        : { kind: 'refused', message: response.error.message }
    },
    loadBalance: async (signal) => {
      const response = await ctx.remote.usage.balance(signal)
      return response.ok
        ? { kind: 'loaded', snapshot: response.value }
        : { kind: 'refused', message: response.error.message }
    },
    loadHistory: async (window) => {
      const response = await ctx.remote.usage.balanceHistory(window)
      return response.ok
        ? { kind: 'loaded', history: response.value }
        : { kind: 'refused', message: response.error.message }
    },
  }
}
