/**
 * Usage section store: the range the reader picked and the summary the Host
 * answered with. One snapshot, one load path — the page re-renders from the
 * store and never from a promise it awaited inline.
 */

import type { BalanceSnapshot, UsageSummaryView } from '@deepseek-ai/dsh-api-usage-controller/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { buildSpend } from './spend-geometry.ts'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { UsageMetricId } from './chart-geometry.ts'
import type { UsageOperations } from './operations.ts'
import type { SpendSeries } from './spend-geometry.ts'

/** The ranges the page offers. */
export type UsageRangeId = '7d' | '30d' | 'all'

/** State of the account-balance card, which loads on its own schedule. */
export interface BalanceState {
  /** Load lifecycle of the balance read. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  /** The last snapshot that arrived, kept across a failed re-read. */
  readonly snapshot: BalanceSnapshot | null
  /** The Host's refusal, when the last read failed. */
  readonly error: string | null
}

/** State of the spend curve, which follows the selected range. */
export interface SpendState {
  /** Load lifecycle of the history read. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  /** One series per currency with a measurable interval. */
  readonly series: readonly SpendSeries[]
  /** The Host's refusal, when the last read failed. */
  readonly error: string | null
}

/** State rendered by the Usage section. */
export interface UsageSettingsState {
  /** Load lifecycle of the current range's summary. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  /** The selected range. */
  readonly range: UsageRangeId
  /** The Host's answer for {@link range}, or null before the first success. */
  readonly summary: UsageSummaryView | null
  /** The Host's refusal, when the last load failed. */
  readonly error: string | null
  /** Which bucket the chart plots. */
  readonly metric: UsageMetricId
  /** Series the reader hid by clicking their legend entries. */
  readonly hidden: readonly string[]
  /** The account-balance card's own state. */
  readonly balance: BalanceState
  /** The spend curve, over the same range as the token summary. */
  readonly spend: SpendState
}

/** Days each bounded range spans, inclusive of today. */
const RANGE_DAYS: Record<'7d' | '30d', number> = { '7d': 7, '30d': 30 }

/**
 * The absolute window one range covers, measured from the reader's own
 * midnight.
 *
 * The Host buckets in UTC and cannot know this browser's zone, so the section
 * sends the instants its local days span instead of a day count. That is what
 * lets a reader in UTC+8 see their own days rather than days that start at
 * 08:00.
 *
 * @param range - the selected range.
 * @param now - the current instant, Unix epoch milliseconds.
 * @returns the inclusive window bounds.
 */
export function rangeWindow(range: UsageRangeId, now: number): { sinceMs: number; untilMs: number } {
  if (range === 'all') return { sinceMs: 0, untilMs: now }
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (RANGE_DAYS[range] - 1))
  return { sinceMs: start.getTime(), untilMs: now }
}

/** The Usage section's store and its two operations. */
export interface UsageSettingsStore {
  /** uSES-safe state source shared by the registered section. */
  readonly store: SnapshotStore<UsageSettingsState>
  /** Read the selected range's summary, replacing the snapshot's answer. */
  load(): Promise<void>
  /** Read the account balance once. */
  loadBalance(): Promise<void>
  /** Select a range and read it. */
  setRange(range: UsageRangeId): void
  /** Select the plotted bucket. Purely local: no read is owed. */
  setMetric(metric: UsageMetricId): void
  /** Show or hide one series. Purely local: no read is owed. */
  toggleSeries(key: string): void
}

/**
 * Create the Usage section's store.
 *
 * Overlapping reads are allowed to happen but only the newest may commit: a
 * reader switching ranges twice quickly must not end up rendering the answer
 * to the range they left.
 *
 * @param operations - the Host callbacks built in the plugin body.
 * @param now - clock seam for the range arithmetic; defaults to the wall clock.
 * @returns the store and its operations.
 */
export function createUsageSettingsStore(
  operations: UsageOperations,
  now: () => number = Date.now,
): UsageSettingsStore {
  const store = createSnapshotStore<UsageSettingsState>({
    status: 'idle',
    range: '7d',
    summary: null,
    error: null,
    metric: 'total',
    hidden: [],
    balance: { status: 'idle', snapshot: null, error: null },
    spend: { status: 'idle', series: [], error: null },
  })
  let generation = 0

  const load = async (): Promise<void> => {
    generation += 1
    const mine = generation
    const requested = store.getSnapshot()
    const window = rangeWindow(requested.range, now())
    store.set({
      ...requested,
      status: 'loading',
      error: null,
      spend: { ...requested.spend, status: 'loading', error: null },
    })
    // Both panels answer for the same window, so they are read together and
    // the newer of two overlapping loads owns both of them.
    const [summary, history] = await Promise.all([
      operations.loadSummary(window),
      operations.loadHistory(window),
    ])
    if (mine !== generation) return
    const latest = store.getSnapshot()
    store.set({
      ...latest,
      ...summary.kind === 'loaded'
        ? { status: 'ready' as const, summary: summary.summary, error: null }
        : { status: 'error' as const, error: summary.message },
      spend: history.kind === 'loaded'
        ? { status: 'ready', series: buildSpend(history.history), error: null }
        : { status: 'error', series: [], error: history.message },
    })
  }

  const loadBalance = async (): Promise<void> => {
    const starting = store.getSnapshot()
    store.set({ ...starting, balance: { ...starting.balance, status: 'loading', error: null } })
    const outcome = await operations.loadBalance()
    const latest = store.getSnapshot()
    store.set({
      ...latest,
      balance: outcome.kind === 'loaded'
        ? { status: 'ready', snapshot: outcome.snapshot, error: null }
        // A failed re-read keeps the number the reader already saw rather than
        // blanking a figure that was true a moment ago.
        : { status: 'error', snapshot: latest.balance.snapshot, error: outcome.message },
    })
  }

  return {
    store,
    load,
    loadBalance,
    setRange: (range) => {
      if (store.getSnapshot().range === range) return
      store.set({ ...store.getSnapshot(), range })
      void load()
    },
    setMetric: (metric) => {
      if (store.getSnapshot().metric === metric) return
      store.set({ ...store.getSnapshot(), metric })
    },
    toggleSeries: (key) => {
      const { hidden } = store.getSnapshot()
      store.set({
        ...store.getSnapshot(),
        hidden: hidden.includes(key) ? hidden.filter(entry => entry !== key) : [...hidden, key],
      })
    },
  }
}
