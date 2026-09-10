/**
 * Public vocabulary for the cross-session token-usage ledger.
 *
 * The four buckets mirror the `tokenUsage` projection's wire view, so a caller
 * that already reads that projection needs no translation. Counts are
 * DISJOINT: cached input is reported separately from uncached input, and
 * reasoning tokens are already inside {@link UsageBuckets.outputTokens}.
 *
 * @module @deepseek-ai/dsh-usage-ledger/types
 */

/** Disjoint token counts for one dimension value. */
export interface UsageBuckets {
  /** Prompt tokens that missed the provider's cache. */
  readonly uncachedInputTokens: number
  /** Generated tokens; reasoning tokens are included, never counted twice. */
  readonly outputTokens: number
  /** Prompt tokens served from the provider's cache. */
  readonly cacheReadTokens: number
  /** Prompt tokens written to the provider's cache. */
  readonly cacheWriteTokens: number
}

/** One UTC hour's totals, with the routes that ran inside it. */
export interface UsageHourBucket {
  /**
   * The hour as `YYYY-MM-DDTHH` in UTC. Lexicographic order is chronological
   * order, which is what lets a range filter compare strings instead of
   * parsing them. The zone is deliberately UTC: a fold must replay
   * identically on every machine, so the hour cannot depend on the reader's
   * zone — rolling hours up into local days is the reader's business.
   */
  readonly hour: string
  /** Totals for that hour. */
  readonly buckets: UsageBuckets
  /**
   * Route totals within that hour, zero-valued routes omitted.
   *
   * A per-route time series cannot be reconstructed from the window totals in
   * {@link UsageLedgerSummary.models}: a reader charting one line per model
   * needs the route split at the hour it happened, and the reader's own zone
   * decides which hours share a day, so the split has to survive to the client.
   */
  readonly routes: readonly UsageModelBucket[]
}

/** One model route's totals. */
export interface UsageModelBucket {
  /** Registered provider route the samples were sent to. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
  /** Totals for that route. */
  readonly buckets: UsageBuckets
}

/** The half-open-by-instant window a summary aggregates over. */
export interface UsageLedgerQuery {
  /** Inclusive lower bound, Unix epoch milliseconds. */
  readonly sinceMs: number
  /** Inclusive upper bound, Unix epoch milliseconds. */
  readonly untilMs: number
}

/** Aggregated usage across every accounted session. */
export interface UsageLedgerSummary {
  /** Hour buckets with any non-zero count, ascending, clipped to the query. */
  readonly hours: readonly UsageHourBucket[]
  /** Route buckets with any non-zero count in range; zero-usage routes are omitted. */
  readonly models: readonly UsageModelBucket[]
  /** Sessions whose stored ledger contributed to this summary. */
  readonly accountedSessions: number
  /**
   * Sessions present in the corpus whose ledger is absent or unrelated to the
   * stored log — still unfolding, or unreadable. A caller MUST surface this
   * gap rather than present the totals as complete.
   */
  readonly unaccountedSessions: number
}
