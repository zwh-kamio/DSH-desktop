/**
 * Cross-session token-usage ledger (`ctx.usageLedger`): durable per-UTC-hour and
 * per-route token totals for every session the corpus knows, folded once and
 * then advanced incrementally as sessions commit events.
 *
 * Why a ledger and not a projection: the session-list Remote ships every
 * registered projection's wire value for every listed session, so a per-hour,
 * per-route payload would inflate that hot path. The ledger therefore owns its
 * own storage domain and exposes one query to the host.
 *
 * Why hours and not days: a fold must replay identically on every machine, so
 * the bucket cannot depend on the reader's zone; but a UTC day boundary falls
 * at 08:00 in Beijing, and a day bucket cannot be re-split once written.
 * Hourly buckets keep the cut deterministic and leave the local-day rollup to
 * the reader.
 *
 * The ledger is derived data, never an authority: a missing or unrelated
 * record costs a refold, and a failed write is fail-soft.
 *
 * @module @deepseek-ai/dsh-usage-ledger
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
// Type-only: activates the `ctx.sessionQuery` Context declaration.
import type {} from '@deepseek-ai/dsh-session-query'
import { summarize } from './aggregate.ts'
import { applyEvent, foldEvents, fromRecord, toRecord } from './fold.ts'
import type { LedgerAccumulator } from './fold.ts'
import { usageLedgerDomainSpec } from './spec.ts'
import type { LedgerIdentity, SessionLedgerRecord } from './spec.ts'
import type { UsageLedgerQuery, UsageLedgerSummary } from './types.ts'

export type * from './types.ts'
export { isZeroBuckets, zeroBuckets } from './fold.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    usageLedger: UsageLedger
  }
}

/**
 * Plugin config. Retention and both throttle triggers are deployment choices
 * with no universally correct value, so they are stated explicitly rather than
 * fixed in code; the fold itself has no tunables.
 */
export interface Config {
  /** Days of hour buckets retained behind the newest folded event, per session. */
  retentionDays: number
  /** Committed events per session that force a durable write between turn boundaries. */
  writeEveryEvents: number
  /** Longest time (milliseconds) a dirty ledger may stay unwritten. */
  writeIntervalMs: number
  /** Sessions folded concurrently while backfilling. */
  backfillConcurrency: number
}

export const Config: z<Config> = z.object({
  retentionDays: z.natural().min(1).default(400),
  writeEveryEvents: z.natural().min(1).default(200),
  writeIntervalMs: z.natural().min(1).default(5000),
  backfillConcurrency: z.natural().min(1).default(4),
})

/** Per-session write-behind bookkeeping for a session that has committed events. */
interface LiveState {
  /** Fold state advanced by every committed event. */
  acc: LedgerAccumulator
  /** Committed events since the last durable write. */
  pending: number
  /** Interval trigger armed at the first dirty event after a clean write. */
  timer: ReturnType<typeof setTimeout> | undefined
}

/** The stored identity of one header. */
function identityOf(header: SessionHeader): LedgerIdentity {
  return { createdAt: header.createdAt, ...header.cwd === undefined ? {} : { cwd: header.cwd } }
}

/** Whether a stored record was folded from the same log lifecycle. */
function identityMatches(stored: LedgerIdentity, current: LedgerIdentity): boolean {
  return stored.createdAt === current.createdAt && stored.cwd === current.cwd
}

/**
 * The usage ledger service. Opens the `usage_ledger` domain at init, advances
 * one fold per live session from the committed event stream, and answers
 * windowed summaries over the whole corpus.
 */
export class UsageLedger extends Service {
  static inject = ['storageDomain', 'sessionQuery', 'sessions']

  static Config: z<Config> = Config

  private table?: KvTable<SessionId, SessionLedgerRecord>
  private readonly live = new Map<Session, LiveState>()

  /**
   * @param ctx - Cordis context of the plugin.
   * @param config - validated plugin config.
   */
  constructor(ctx: Context, public config: Config) {
    super(ctx, 'usageLedger')
  }

  /** Open the domain and install the incremental fold. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(usageLedgerDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'usageLedger.domainClose')
    this.table = domain.table('sessions')
    this.ctx.on('session/event', (session, event) => { this.observe(session, event) })
    this.ctx.effect(() => () => {
      for (const state of this.live.values()) {
        if (state.timer !== undefined) clearTimeout(state.timer)
      }
    }, 'usageLedger.timerCleanup')
  }

  /**
   * Aggregate every accounted session's ledger over one window.
   *
   * Sessions with no usable ledger are folded first, so a first call after a
   * fresh install pays one full corpus read and later calls pay only the
   * listing. A session whose log cannot be read stays unaccounted: it is
   * counted in {@link UsageLedgerSummary.unaccountedSessions} and never
   * guessed at.
   *
   * @param query - the window to aggregate, in Unix epoch milliseconds.
   * @param signal - optional cancellation for the corpus listing and folding.
   * @returns the merged summary.
   * @throws RangeError when the window is not a valid range.
   * @throws when the corpus listing is aborted.
   */
  async summary(query: UsageLedgerQuery, signal?: AbortSignal): Promise<UsageLedgerSummary> {
    const corpus = await this.ctx.sessionQuery.listSessions(signal)
    signal?.throwIfAborted()

    const records: SessionLedgerRecord[] = []
    const missing: SessionHeader[] = []
    for (const record of corpus) {
      const ledger = this.recordFor(record.header)
      if (ledger === undefined) missing.push(record.header)
      else records.push(ledger)
    }

    let unaccounted = 0
    if (missing.length > 0) {
      const folded = await this.foldMissing(missing, signal)
      records.push(...folded.records)
      unaccounted = folded.failed
    }
    return summarize(records, query, unaccounted)
  }

  /** Force every dirty live ledger to disk. */
  async flush(): Promise<void> {
    await Promise.all([...this.live.entries()].map(([session, state]) => this.write(session, state)))
  }

  /** The fold of one header: the live accumulator when there is one, else the stored record. */
  private recordFor(header: SessionHeader): SessionLedgerRecord | undefined {
    const session = this.ctx.sessions.get(header.id)
    if (session !== undefined) {
      const live = this.live.get(session)
      // A live accumulator is always fresher than the row it was seeded from.
      if (live !== undefined) return toRecord(live.acc, identityOf(session.header))
    }
    const stored = this.table?.get(header.id)
    if (stored === undefined) return undefined
    return identityMatches(stored.identity, identityOf(header)) ? stored : undefined
  }

  /**
   * Fold the sessions that have no usable ledger, with bounded concurrency.
   * @param headers - headers to fold.
   * @param signal - optional cancellation between sessions.
   * @returns the folded records and the count left unaccounted.
   */
  private async foldMissing(
    headers: readonly SessionHeader[],
    signal: AbortSignal | undefined,
  ): Promise<{ records: SessionLedgerRecord[]; failed: number }> {
    const table = this.table
    if (table === undefined) return { records: [], failed: headers.length }
    const records: SessionLedgerRecord[] = []
    let cursor = 0
    let failed = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const header = headers[cursor]
        cursor += 1
        if (header === undefined) return
        signal?.throwIfAborted()
        try {
          const log = await this.ctx.sessionQuery.readSession(header.id)
          const record = toRecord(foldEvents(log.events, this.config.retentionDays), identityOf(header))
          await table.put(header.id, record)
          records.push(record)
        } catch (error: unknown) {
          failed += 1
          this.ctx.logger.warn(`usage ledger: folding "${header.id}" failed (left unaccounted): ${String(error)}`)
        }
      }
    }
    const workers = Math.min(this.config.backfillConcurrency, headers.length)
    await Promise.all(Array.from({ length: workers }, worker))
    return { records, failed }
  }

  /** Advance one live session's fold from one committed event. */
  private observe(session: Session, event: SessionEvent): void {
    let state = this.live.get(session)
    if (state !== undefined && event.seq > state.acc.lastSeq + 1) {
      // The accumulator missed intervening events (a dropped write plus a
      // resume). The exact live log is authoritative, so start over from it.
      this.live.delete(session)
      if (state.timer !== undefined) clearTimeout(state.timer)
      state = undefined
    }
    state ??= this.openLive(session)
    if (event.seq <= state.acc.lastSeq) return

    applyEvent(state.acc, event, this.config.retentionDays)
    state.pending += 1
    if (event.type === 'turn/end' || state.pending >= this.config.writeEveryEvents) {
      void this.write(session, state)
      return
    }
    this.arm(session, state)
  }

  /** Seed a live fold from the stored record when it still matches, else from the whole log. */
  private openLive(session: Session): LiveState {
    const stored = this.table?.get(session.id)
    const acc = stored !== undefined && identityMatches(stored.identity, identityOf(session.header))
      ? this.resume(stored, session)
      : foldEvents(session.events, this.config.retentionDays)
    const state: LiveState = { acc, pending: 0, timer: undefined }
    this.live.set(session, state)
    return state
  }

  /**
   * Continue a stored record over the live log. The record carries everything
   * the continuation needs — the folded-through seq, the route in force, and
   * any attempt still open to restatement — so the tail replays without
   * consulting the log for context.
   */
  private resume(stored: SessionLedgerRecord, session: Session): LedgerAccumulator {
    const acc = fromRecord(stored)
    for (const event of session.events) {
      if (event.seq > acc.lastSeq) applyEvent(acc, event, this.config.retentionDays)
    }
    return acc
  }

  /** Arm the interval trigger for one dirty session. */
  private arm(session: Session, state: LiveState): void {
    if (state.timer !== undefined) return
    state.timer = setTimeout(() => {
      state.timer = undefined
      void this.write(session, state)
    }, this.config.writeIntervalMs)
  }

  /**
   * Write one session's ledger. Fail-soft: a lost write costs a longer refold
   * on the next read, and the next trigger retries from the same accumulator.
   */
  private async write(session: Session, state: LiveState): Promise<void> {
    if (state.timer !== undefined) {
      clearTimeout(state.timer)
      state.timer = undefined
    }
    const table = this.table
    if (table === undefined) return
    const record = toRecord(state.acc, identityOf(session.header))
    state.pending = 0
    try {
      await table.put(session.id, record)
    } catch (error: unknown) {
      this.ctx.logger.warn(`usage ledger: write for "${session.id}" failed (ledger stays stale): ${String(error)}`)
    }
  }
}

export default UsageLedger
