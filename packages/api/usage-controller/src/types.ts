/**
 * Wire vocabulary for the `usage` Remote namespace.
 *
 * The window is two absolute instants, never a day index: rolling UTC hours up
 * into local days needs the caller's zone, and a zone is not a fact the host
 * holds. The caller therefore computes the instants its own days span.
 *
 * @module @deepseek-ai/dsh-api-usage-controller/types
 */

import { z } from 'zod'
import type { UsageLedgerSummary } from '@deepseek-ai/dsh-usage-ledger/types'

// The same rule for the balance history: a browser charting it names this
// package, not the Host ledger that stored the readings.
export type {
  BalanceHistory,
  BalanceHistoryQuery,
  BalanceSample,
  CurrencyHistory,
} from '@deepseek-ai/dsh-balance-ledger/types'

// The reply embeds the ledger's bucket vocabulary, so the wire package is
// where a browser names it: a client that renders a summary should not have to
// reach a Host package for the types of the fields it is rendering.
export type {
  UsageBuckets,
  UsageHourBucket,
  UsageModelBucket,
} from '@deepseek-ai/dsh-usage-ledger/types'

// The same rule for the balance reply: a browser rendering it names this
// package, not the Host provider that fetched it.
export type {
  BalanceErrorCode,
  BalanceLine,
  BalanceSnapshot,
} from '@deepseek-ai/dsh-deepseek-balance/types'

/** A window request as received from the wire; both Remotes take the same one. */
export const usageWindowSchema = z.object({
  sinceMs: z.number(),
  untilMs: z.number(),
}).strict()

/** A window decoded from the wire. */
export type UsageWindow = z.infer<typeof usageWindowSchema>

/** @deprecated alias kept for the summary Remote's own signature. */
export type UsageSummaryRequest = UsageWindow

/** What a caller receives: the ledger's own summary, already plain JSON. */
export type UsageSummaryView = UsageLedgerSummary

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The requested window cannot describe a range. */
    'usage/bad-window': {
      /** Lower bound as received. */
      readonly sinceMs: number
      /** Upper bound as received. */
      readonly untilMs: number
    }
    /** A summary could not be produced. */
    'usage/summary-failed': {
      /** Host diagnostic for the refusal. */
      readonly reason: string
    }
    /** The composition mounts no balance reader. */
    'usage/balance-unavailable': {
      /** Host diagnostic for the absence. */
      readonly reason: string
    }
    /** A balance read failed; `reason` is the provider-side code. */
    'usage/balance-failed': {
      /** Provider-side failure discriminant. */
      readonly reason: string
    }
    /** The composition mounts no balance ledger, so there is no history to chart. */
    'usage/history-unavailable': {
      /** Host diagnostic for the absence. */
      readonly reason: string
    }
  }
}
