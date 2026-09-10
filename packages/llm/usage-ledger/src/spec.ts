/**
 * The usage-ledger domain declaration: one `sessions` table keyed by
 * {@link SessionId}, each record the complete hour → route totals folded from
 * that session's log. The `per-record` layout stores one document per
 * session, so a ledger refresh rewrites one session's document instead of the
 * whole unit.
 *
 * Both dimensions carry the hour. A model total without a time dimension
 * could not answer a windowed question — a route used once months ago would
 * still appear in a chart of the last seven days — so each stored hour owns
 * its own route breakdown, and the model totals a caller sees are summed over
 * the requested window.
 *
 * This ledger is deliberately NOT a session projection: the session-list
 * Remote carries every registered projection's wire value, and a per-hour,
 * per-route payload would bloat that hot path for every listed session. The
 * ledger is host-only data reached through its service.
 *
 * @module @deepseek-ai/dsh-usage-ledger/spec
 */

import { z } from 'zod'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** A stored token count: non-negative, integral. */
const count = z.number().int().nonnegative()

/** Disjoint stored token buckets. */
export const usageBucketsSchema = z.object({
  uncachedInputTokens: count,
  outputTokens: count,
  cacheReadTokens: count,
  cacheWriteTokens: count,
}).strict()

/** One stored model route's totals. */
export const modelBucketsSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  buckets: usageBucketsSchema,
}).strict()

/** One stored hour: its totals plus the routes that ran within it. */
export const hourLedgerSchema = z.object({
  total: usageBucketsSchema,
  routes: z.array(modelBucketsSchema),
}).strict()

/**
 * The log identity a record is bound to: the immutable header fields that
 * distinguish one session lifecycle from another under the same id. A session
 * id names a slot, not a lifecycle, so a deleted-then-recreated id, or a
 * persistence root swapped under a surviving ledger, would otherwise let an
 * old record's totals count toward an unrelated log.
 */
export const ledgerIdentity = z.object({
  createdAt: z.number().int().nonnegative(),
  cwd: z.string().optional(),
}).strict()

/** The identity fields a record is bound to. */
export type LedgerIdentity = z.infer<typeof ledgerIdentity>

/**
 * The usage sample still open to restatement, with the cell it was added to.
 * Persisting it is what makes a restart exact: a later report for the same
 * attempt must withdraw THIS sample, and a restored fold that forgot it would
 * count the attempt twice. Recording the hour and route alongside lets the
 * withdrawal hit the very cell that received it, even if a request header
 * arrived in between.
 */
export const usageSampleSchema = z.object({
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  hour: z.string().min(13),
  provider: z.string().min(1),
  model: z.string().min(1),
  buckets: usageBucketsSchema,
}).strict()

/** The open-attempt sample as stored. */
export type StoredUsageSample = z.infer<typeof usageSampleSchema>

/** The provider/model pair a fold is currently attributing reports to. */
export const ledgerRoute = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
}).strict()

/**
 * One session's stored ledger. `throughSeq` is the highest raw-log sequence
 * folded in, so an event that is not exactly one past it means the record
 * cannot be continued incrementally and the session must be refolded.
 *
 * `route` is stored rather than re-derived: it decides which route the next
 * usage report belongs to, and a record that had to be paired with a scan of
 * the live log to be usable would be a footgun at every call site. For the
 * same reason the record carries the folded-through seq rather than a
 * resumption hint.
 *
 * Zero-valued hours and routes are omitted on write, so a record never carries
 * a route the session stopped using.
 */
export const sessionLedgerRecord = z.object({
  identity: ledgerIdentity,
  throughSeq: z.number().int().gte(-1),
  route: ledgerRoute.optional(),
  sample: usageSampleSchema.optional(),
  byHour: z.record(z.string(), hourLedgerSchema),
}).strict()

/** One stored per-session ledger. */
export type SessionLedgerRecord = z.infer<typeof sessionLedgerRecord>

/** One stored hour cell. */
export type StoredHourLedger = z.infer<typeof hourLedgerSchema>

/**
 * The usage-ledger domain spec. A version bump discards stale session
 * documents on open (ledger semantics — a discarded ledger costs a refold,
 * never a wrong total) while the rest of the domain stays usable.
 */
export const usageLedgerDomainSpec = defineDomain({
  name: 'usage_ledger',
  version: 1,
  layout: 'per-record',
  tables: { sessions: domainTable<SessionId, SessionLedgerRecord>(sessionLedgerRecord) },
})
