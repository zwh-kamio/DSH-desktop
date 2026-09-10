/**
 * Pure geometry for the spend curve: the readings the Host kept, turned into
 * what was actually spent.
 *
 * The provider publishes a balance, never a spend. So a spend is a difference,
 * and the sign of that difference is the whole classification: usage only ever
 * lowers a balance, so a fall is spend and a rise can only be a top-up or a
 * refund. Reading the sign is not a heuristic — there is nothing else a rise
 * could be.
 *
 * Intervals are attributed to the local day of the LATER reading, because that
 * is the moment the change was observed. A gap therefore lands whole on the day
 * the next reading arrived rather than being invented across the days it spans;
 * the sampling interval bounds how wrong that can be.
 */

import type { BalanceHistory, BalanceSample } from '@deepseek-ai/dsh-api-usage-controller/types'
import { fillDayRange, localDayOfInstant } from './chart-geometry.ts'

/** One interval between two consecutive readings. */
export interface SpendInterval {
  /** When the earlier reading was taken. */
  readonly fromMs: number
  /** When the later reading was taken. */
  readonly toMs: number
  /** Minor units the balance fell by; 0 when it did not fall. */
  readonly spendMinor: number
  /** Minor units the balance rose by; 0 when it did not rise. */
  readonly topUpMinor: number
}

/** One local day of one currency. */
export interface SpendDay {
  /** Local day key. */
  readonly day: string
  /** Minor units spent that day. */
  readonly spendMinor: number
  /** Minor units added that day. */
  readonly topUpMinor: number
}

/** One currency's spend over the window. */
export interface SpendSeries {
  /** Currency code the readings were taken in. */
  readonly currency: string
  /** One entry per local day, ascending, gaps filled with zero. */
  readonly days: readonly SpendDay[]
  /** Total spent over the plotted days. */
  readonly spendMinor: number
  /** Total added over the plotted days. */
  readonly topUpMinor: number
  /** Largest single day's spend, for the y scale. */
  readonly max: number
}

/**
 * Classify every interval in one ascending series.
 *
 * @param samples - readings ascending by time; earlier than two yields nothing.
 * @returns one interval per consecutive pair, in order.
 */
export function intervalsOf(samples: readonly BalanceSample[]): SpendInterval[] {
  const intervals: SpendInterval[] = []
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1]
    const current = samples[index]
    if (previous === undefined || current === undefined) continue
    const delta = previous.totalMinor - current.totalMinor
    intervals.push({
      fromMs: previous.readAt,
      toMs: current.readAt,
      spendMinor: delta > 0 ? delta : 0,
      topUpMinor: delta < 0 ? -delta : 0,
    })
  }
  return intervals
}

/**
 * Fold one currency's readings into a per-local-day spend series.
 *
 * @param currency - the currency the readings were taken in.
 * @param samples - readings ascending by time.
 * @returns the day series, or undefined when there is nothing to plot.
 */
export function spendSeriesOf(currency: string, samples: readonly BalanceSample[]): SpendSeries | undefined {
  const intervals = intervalsOf(samples)
  if (intervals.length === 0) return undefined
  const totals = new Map<string, { spendMinor: number; topUpMinor: number }>()
  for (const interval of intervals) {
    const day = localDayOfInstant(interval.toMs)
    const cell = totals.get(day) ?? { spendMinor: 0, topUpMinor: 0 }
    cell.spendMinor += interval.spendMinor
    cell.topUpMinor += interval.topUpMinor
    totals.set(day, cell)
  }
  const present = [...totals.keys()].sort()
  const first = present[0]
  const last = present[present.length - 1]
  if (first === undefined || last === undefined) return undefined
  const days = fillDayRange(first, last).map(day => ({
    day,
    spendMinor: totals.get(day)?.spendMinor ?? 0,
    topUpMinor: totals.get(day)?.topUpMinor ?? 0,
  }))
  let spendMinor = 0
  let topUpMinor = 0
  let max = 0
  for (const entry of days) {
    spendMinor += entry.spendMinor
    topUpMinor += entry.topUpMinor
    if (entry.spendMinor > max) max = entry.spendMinor
  }
  return { currency, days, spendMinor, topUpMinor, max }
}

/**
 * Fold every currency's readings into spend series.
 *
 * A currency whose series holds fewer than two readings produces nothing: one
 * reading has no interval, and drawing it would be drawing a zero that was
 * never measured.
 *
 * @param history - the readings the Host returned.
 * @returns one series per currency with something to plot, ascending by code.
 */
export function buildSpend(history: BalanceHistory): SpendSeries[] {
  const series: SpendSeries[] = []
  for (const entry of history.currencies) {
    const built = spendSeriesOf(entry.currency, entry.samples)
    if (built !== undefined) series.push(built)
  }
  return series
}
