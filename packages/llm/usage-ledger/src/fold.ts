/**
 * The pure fold behind the usage ledger: one session's committed events to
 * per-UTC-hour token totals, each hour carrying its own per-route breakdown.
 *
 * The fold is a mutable accumulator rather than a value-returning reducer
 * because the ledger is not a session projection: nothing replays it through
 * the registry's checkpoint machinery, so an O(1) in-place update per event is
 * both simpler and cheaper than rebuilding nested maps per event.
 * Serialization ({@link toRecord}) is the only place a detached value is
 * produced.
 *
 * @module @deepseek-ai/dsh-usage-ledger/fold
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only: activates the `llm/retry-started` member of SessionEventMap.
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type { UsageBuckets, UsageModelBucket } from './types.ts'
import type { LedgerIdentity, SessionLedgerRecord } from './spec.ts'

/** Milliseconds in one day, for the retention cutoff. */
const MS_PER_DAY = 86_400_000

/** One mutable bucket set; structurally assignable to the readonly public shape. */
interface MutableBuckets {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** A fresh zeroed bucket set. */
function emptyBuckets(): MutableBuckets {
  return { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

/** The provider/model pair a sample is attributed to. */
export interface UsageRoute {
  /** Registered provider route. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
}

/**
 * Route attributed to a usage report that precedes every `request/header`. The
 * loop always logs a header inside the step before dispatch, so this only
 * appears for a hand-built or truncated log; naming it keeps such tokens
 * visible instead of silently dropping them.
 */
export const UNKNOWN_ROUTE: UsageRoute = { provider: 'unknown', model: 'unknown' }

/** One attempt's most recent usage sample, so a restatement replaces it. */
interface SampleSlot {
  turn: number
  step: number
  hour: string
  route: UsageRoute
  buckets: MutableBuckets
}

/** One hour's mutable cell: totals plus the routes that ran within it. */
interface HourCell {
  total: MutableBuckets
  routes: Map<string, Map<string, MutableBuckets>>
}

/**
 * Mutable fold state for one session. Route maps are keyed provider → model so
 * neither segment needs an escaped composite key.
 */
export interface LedgerAccumulator {
  /** Highest folded raw-log seq; `-1` before the first event. */
  lastSeq: number
  readonly byHour: Map<string, HourCell>
  /** Route in force, from the newest `request/header`. */
  route: UsageRoute | undefined
  /** Usage sample awaiting a possible restatement from the same attempt. */
  sample: SampleSlot | undefined
}

/** Buckets carrying no tokens. */
export function zeroBuckets(): UsageBuckets {
  return emptyBuckets()
}

/** Whether every bucket is zero. */
export function isZeroBuckets(buckets: UsageBuckets): boolean {
  return buckets.uncachedInputTokens === 0
    && buckets.outputTokens === 0
    && buckets.cacheReadTokens === 0
    && buckets.cacheWriteTokens === 0
}

/**
 * The UTC hour key for one instant, as `YYYY-MM-DDTHH`. Lexicographic order
 * is chronological order, so range filters compare keys instead of parsing
 * them.
 * @param ms - Unix epoch milliseconds.
 * @returns the hour key.
 */
export function hourKeyOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 13)
}

/**
 * Empty accumulator at a known log position.
 * @param lastSeq - highest already-folded seq, or `-1` for an empty log.
 * @returns the accumulator.
 */
export function createAccumulator(lastSeq: number): LedgerAccumulator {
  return { lastSeq, byHour: new Map(), route: undefined, sample: undefined }
}

/** Disjoint buckets of one provider usage report. */
function bucketsOf(usage: TokenUsage): MutableBuckets {
  return {
    uncachedInputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
  }
}

/** The usage report one event carries, with the attempt it belongs to. */
function sampleOf(event: SessionEvent): { turn: number; step: number; usage: TokenUsage } | undefined {
  if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
    return { turn: event.data.turn, step: event.data.step, usage: event.data.chunk.usage }
  }
  if (event.type === 'assistant/message' && event.data.usage !== undefined) {
    return { turn: event.data.turn, step: event.data.step, usage: event.data.usage }
  }
  return undefined
}

/** The mutable hour cell for one key, created on first use. */
function hourCell(acc: LedgerAccumulator, hour: string): HourCell {
  const existing = acc.byHour.get(hour)
  if (existing !== undefined) return existing
  const fresh: HourCell = { total: emptyBuckets(), routes: new Map() }
  acc.byHour.set(hour, fresh)
  return fresh
}

/** The mutable route cell for one route inside one hour, created on first use. */
function routeCell(cell: HourCell, route: UsageRoute): MutableBuckets {
  let models = cell.routes.get(route.provider)
  if (models === undefined) {
    models = new Map()
    cell.routes.set(route.provider, models)
  }
  const existing = models.get(route.model)
  if (existing !== undefined) return existing
  const fresh = emptyBuckets()
  models.set(route.model, fresh)
  return fresh
}

/** Apply one sample's buckets to a target cell. */
function shift(target: MutableBuckets, buckets: MutableBuckets, sign: 1 | -1): void {
  target.uncachedInputTokens += sign * buckets.uncachedInputTokens
  target.outputTokens += sign * buckets.outputTokens
  target.cacheReadTokens += sign * buckets.cacheReadTokens
  target.cacheWriteTokens += sign * buckets.cacheWriteTokens
}

/**
 * Add one sample's buckets to the hour total and its route cell.
 * @param acc - accumulator to mutate.
 * @param hour - UTC hour key the sample belongs to.
 * @param route - route the sample was sent to.
 * @param buckets - the sample's counts.
 * @param sign - `1` to add, `-1` to withdraw a superseded sample.
 */
function accumulate(
  acc: LedgerAccumulator,
  hour: string,
  route: UsageRoute,
  buckets: MutableBuckets,
  sign: 1 | -1,
): void {
  const cell = hourCell(acc, hour)
  shift(cell.total, buckets, sign)
  shift(routeCell(cell, route), buckets, sign)
}

/** Drop hour cells older than the retention cutoff so a long-lived session cannot grow without bound. */
function pruneHours(acc: LedgerAccumulator, cutoffHour: string): void {
  // A resumed log may interleave hours, so scanning every key keeps the cut exact.
  for (const hour of [...acc.byHour.keys()]) {
    if (hour < cutoffHour) acc.byHour.delete(hour)
  }
}

/**
 * Fold one committed event into the accumulator.
 *
 * Usage reports for one attempt are adjacent in the log, and a later report
 * for the same attempt restates the earlier one instead of adding to it — so a
 * streaming sample followed by the final message counts once. A matching
 * `llm/retry-started` closes the slot, letting the retried attempt count on
 * its own.
 *
 * @param acc - accumulator to mutate.
 * @param event - the next committed session event.
 * @param retentionDays - days of hour buckets retained behind the event's own instant.
 */
export function applyEvent(acc: LedgerAccumulator, event: SessionEvent, retentionDays: number): void {
  if (event.seq > acc.lastSeq) acc.lastSeq = event.seq

  if (event.type === 'request/header') {
    const { provider, model } = event.data.header.config
    acc.route = { provider, model }
    return
  }

  if (event.type === 'llm/retry-started') {
    const slot = acc.sample
    if (slot !== undefined && slot.turn === event.data.turn && slot.step === event.data.step) acc.sample = undefined
    return
  }

  const sample = sampleOf(event)
  if (sample === undefined) return

  const buckets = bucketsOf(sample.usage)
  const slot = acc.sample
  if (slot !== undefined && slot.turn === sample.turn && slot.step === sample.step) {
    accumulate(acc, slot.hour, slot.route, slot.buckets, -1)
  }

  const hour = hourKeyOf(event.time)
  const route = acc.route ?? UNKNOWN_ROUTE
  accumulate(acc, hour, route, buckets, 1)
  acc.sample = { turn: sample.turn, step: sample.step, hour, route, buckets }
  pruneHours(acc, hourKeyOf(event.time - retentionDays * MS_PER_DAY))
}

/**
 * Fold a whole log in sequence order into a fresh accumulator.
 * @param events - the session's events, ascending by seq.
 * @param retentionDays - days of hour buckets retained behind the newest event.
 * @returns the folded accumulator, positioned at the last event's seq.
 */
export function foldEvents(events: readonly SessionEvent[], retentionDays: number): LedgerAccumulator {
  const acc = createAccumulator(-1)
  for (const event of events) applyEvent(acc, event, retentionDays)
  return acc
}

/** A detached copy of one bucket set. */
function detach(buckets: MutableBuckets): UsageBuckets {
  return {
    uncachedInputTokens: buckets.uncachedInputTokens,
    outputTokens: buckets.outputTokens,
    cacheReadTokens: buckets.cacheReadTokens,
    cacheWriteTokens: buckets.cacheWriteTokens,
  }
}

/** Detached non-zero routes of one hour cell, sorted by provider then model. */
function detachRoutes(cell: HourCell): UsageModelBucket[] {
  const routes: UsageModelBucket[] = []
  for (const provider of [...cell.routes.keys()].sort()) {
    const models = cell.routes.get(provider)
    if (models === undefined) continue
    for (const model of [...models.keys()].sort()) {
      const buckets = models.get(model)
      if (buckets === undefined || isZeroBuckets(buckets)) continue
      routes.push({ provider, model, buckets: detach(buckets) })
    }
  }
  return routes
}

/**
 * Serialize an accumulator into its stored form. Zero-valued hours and routes
 * are omitted, so a route whose samples were all withdrawn never reaches the
 * medium and cannot surface as an empty series.
 * @param acc - accumulator to serialize.
 * @param identity - log identity the record is bound to.
 * @returns the complete stored record.
 */
export function toRecord(acc: LedgerAccumulator, identity: LedgerIdentity): SessionLedgerRecord {
  const route = acc.route === undefined ? {} : { route: { provider: acc.route.provider, model: acc.route.model } }
  const sample = acc.sample === undefined ? {} : {
    sample: {
      turn: acc.sample.turn,
      step: acc.sample.step,
      hour: acc.sample.hour,
      provider: acc.sample.route.provider,
      model: acc.sample.route.model,
      buckets: detach(acc.sample.buckets),
    },
  }
  const byHour: Record<string, { total: UsageBuckets; routes: UsageModelBucket[] }> = {}
  for (const hour of [...acc.byHour.keys()].sort()) {
    const cell = acc.byHour.get(hour)
    if (cell === undefined) continue
    const routes = detachRoutes(cell)
    if (routes.length === 0) continue
    byHour[hour] = { total: detach(cell.total), routes }
  }
  return { identity, throughSeq: acc.lastSeq, ...route, ...sample, byHour }
}

/**
 * Rebuild an accumulator from a stored record, including the attempt sample
 * still open to restatement: a record written between a streaming sample and
 * the final message of the same attempt must withdraw that sample when the
 * message arrives rather than count the attempt twice. The route in force is
 * stored alongside it, so a restored fold attributes the next report exactly
 * as the fold that wrote it would have.
 * @param record - the stored record.
 * @returns an accumulator positioned at the record's watermark.
 */
export function fromRecord(record: SessionLedgerRecord): LedgerAccumulator {
  const acc = createAccumulator(record.throughSeq)
  if (record.route !== undefined) acc.route = { provider: record.route.provider, model: record.route.model }
  if (record.sample !== undefined) {
    const stored = record.sample
    acc.sample = {
      turn: stored.turn,
      step: stored.step,
      hour: stored.hour,
      route: { provider: stored.provider, model: stored.model },
      buckets: { ...stored.buckets },
    }
  }
  for (const [hour, stored] of Object.entries(record.byHour)) {
    const cell = hourCell(acc, hour)
    shift(cell.total, stored.total, 1)
    for (const route of stored.routes) shift(routeCell(cell, route), route.buckets, 1)
  }
  return acc
}
