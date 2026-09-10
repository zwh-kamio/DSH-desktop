/**
 * Public vocabulary for the balance-sample ledger.
 *
 * The provider exposes a balance, never a spend figure. A spend is therefore
 * always the difference between two readings, which is why this package keeps
 * readings rather than totals: a caller that only ever stored the latest
 * balance could say what is left but never what was used.
 *
 * @module @deepseek-ai/dsh-balance-ledger/types
 */

/** One reading of one currency's balance, in minor units. */
export interface BalanceSample {
  /** When the provider answered, Unix epoch milliseconds. */
  readonly readAt: number
  /** Available balance, granted and topped-up together. */
  readonly totalMinor: number
  /** Granted balance at that moment. */
  readonly grantedMinor: number
  /** Topped-up balance at that moment. */
  readonly toppedUpMinor: number
}

/** One currency's readings, ascending by time. */
export interface CurrencyHistory {
  /** Currency code the provider billed in. */
  readonly currency: string
  /**
   * Readings covering the requested window, plus the newest reading before it.
   *
   * The extra leading reading is the baseline: without it the first interval of
   * the window has nothing to subtract from and the spend inside it would be
   * invisible.
   */
  readonly samples: readonly BalanceSample[]
}

/** Every currency's readings for one query. */
export interface BalanceHistory {
  /** One entry per currency that has a usable baseline, ascending by code. */
  readonly currencies: readonly CurrencyHistory[]
}

/** The window a history query asks for. */
export interface BalanceHistoryQuery {
  /** Inclusive lower bound, Unix epoch milliseconds. */
  readonly sinceMs: number
  /** Inclusive upper bound, Unix epoch milliseconds. */
  readonly untilMs: number
}
