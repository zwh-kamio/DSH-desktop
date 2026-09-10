/**
 * Pure aggregation from stored per-session ledgers to one windowed summary.
 *
 * The window is expressed in absolute instants and clipped in UTC hours, which
 * is what keeps the zone decision with the reader: a client asks for the
 * instants its own local days span, not for "day 3 of the series".
 *
 * Both the hour totals and each hour's route split survive into the summary.
 * The route split is not derivable from the window's model totals, and a reader
 * charting one line per model needs it at the hour it happened — the hour being
 * the finest bucket the fold keeps, and the reader's zone deciding which hours
 * share a day.
 *
 * @module @deepseek-ai/dsh-usage-ledger/aggregate
 */

import type {
  UsageBuckets,
  UsageHourBucket,
  UsageLedgerQuery,
  UsageLedgerSummary,
  UsageModelBucket,
} from './types.ts'
import type { SessionLedgerRecord } from './spec.ts'
import { hourKeyOf, isZeroBuckets } from './fold.ts'

/** One mutable bucket set while merging. */
interface MutableBuckets {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** One merged hour: its totals plus the routes that ran inside it. */
interface MergedHour {
  readonly total: MutableBuckets
  /** provider → model → buckets, so neither segment needs an escaped key. */
  readonly routes: Map<string, Map<string, MutableBuckets>>
}

/** A fresh zeroed bucket set. */
function empty(): MutableBuckets {
  return { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

/** Add one source's counts into a target. */
function add(target: MutableBuckets, source: UsageBuckets): void {
  target.uncachedInputTokens += source.uncachedInputTokens
  target.outputTokens += source.outputTokens
  target.cacheReadTokens += source.cacheReadTokens
  target.cacheWriteTokens += source.cacheWriteTokens
}

/** A detached copy of one merged bucket set. */
function detach(buckets: MutableBuckets): UsageBuckets {
  return {
    uncachedInputTokens: buckets.uncachedInputTokens,
    outputTokens: buckets.outputTokens,
    cacheReadTokens: buckets.cacheReadTokens,
    cacheWriteTokens: buckets.cacheWriteTokens,
  }
}

/**
 * Reject a window that cannot describe a range. A Remote carrier validates the
 * same fields at the wire boundary; this guard keeps a direct in-process
 * caller from silently receiving an empty summary for an inverted window.
 * @param query - the window to check.
 * @throws RangeError when a bound is not a finite integer or the window is inverted.
 */
function assertQuery(query: UsageLedgerQuery): void {
  for (const [name, value] of [['sinceMs', query.sinceMs], ['untilMs', query.untilMs]] as const) {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`usage ledger: ${name} must be a safe integer, got ${String(value)}`)
    }
  }
  if (query.sinceMs > query.untilMs) {
    throw new RangeError(`usage ledger: sinceMs ${query.sinceMs} is after untilMs ${query.untilMs}`)
  }
}

/**
 * Merge every accounted session's ledger into one windowed summary.
 *
 * Hour and route totals are both clipped to the window, so a route that ran
 * only outside it contributes nothing and therefore does not appear among
 * {@link UsageLedgerSummary.models} or inside any carried hour — the
 * zero-usage filter a chart relies on. Sessions whose ledger is missing are
 * the caller's to report: they are counted, never guessed.
 *
 * @param records - stored ledgers of every accounted session.
 * @param query - the window to aggregate, in Unix epoch milliseconds.
 * @param unaccountedSessions - corpus sessions with no usable ledger.
 * @returns the merged summary.
 * @throws RangeError when the window is not a valid range.
 */
export function summarize(
  records: readonly SessionLedgerRecord[],
  query: UsageLedgerQuery,
  unaccountedSessions: number,
): UsageLedgerSummary {
  assertQuery(query)
  const sinceHour = hourKeyOf(query.sinceMs)
  const untilHour = hourKeyOf(query.untilMs)

  const hours = new Map<string, MergedHour>()
  const models = new Map<string, Map<string, MutableBuckets>>()
  const hourCell = (hour: string): MergedHour => {
    const existing = hours.get(hour)
    if (existing !== undefined) return existing
    const fresh: MergedHour = { total: empty(), routes: new Map() }
    hours.set(hour, fresh)
    return fresh
  }
  const routeCell = (table: Map<string, Map<string, MutableBuckets>>, provider: string, model: string): MutableBuckets => {
    let routes = table.get(provider)
    if (routes === undefined) {
      routes = new Map()
      table.set(provider, routes)
    }
    const existing = routes.get(model)
    if (existing !== undefined) return existing
    const fresh = empty()
    routes.set(model, fresh)
    return fresh
  }

  for (const record of records) {
    for (const [hour, stored] of Object.entries(record.byHour)) {
      // Key comparisons are exact because both sides share the UTC hour form.
      if (hour < sinceHour || hour > untilHour) continue
      const cell = hourCell(hour)
      add(cell.total, stored.total)
      for (const route of stored.routes) {
        add(routeCell(cell.routes, route.provider, route.model), route.buckets)
        add(routeCell(models, route.provider, route.model), route.buckets)
      }
    }
  }

  /** Detached, sorted, non-zero routes of one route table. */
  const routesOf = (table: Map<string, Map<string, MutableBuckets>>): UsageModelBucket[] => {
    const out: UsageModelBucket[] = []
    for (const provider of [...table.keys()].sort()) {
      const entries = table.get(provider)
      if (entries === undefined) continue
      for (const model of [...entries.keys()].sort()) {
        const buckets = entries.get(model)
        if (buckets === undefined || isZeroBuckets(buckets)) continue
        out.push({ provider, model, buckets: detach(buckets) })
      }
    }
    return out
  }

  const hourBuckets: UsageHourBucket[] = []
  for (const hour of [...hours.keys()].sort()) {
    const cell = hours.get(hour)
    if (cell === undefined || isZeroBuckets(cell.total)) continue
    hourBuckets.push({ hour, buckets: detach(cell.total), routes: routesOf(cell.routes) })
  }

  return {
    hours: hourBuckets,
    models: routesOf(models),
    accountedSessions: records.length,
    unaccountedSessions,
  }
}
