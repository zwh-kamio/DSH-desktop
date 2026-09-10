/**
 * Pure geometry for the per-model token chart: the summary the Host returned,
 * rolled into local calendar days and shaped into one series per model.
 *
 * Everything here is a function of the Host answer and the reader's zone, so
 * the component renders and never computes. The zone matters: the ledger
 * buckets in UTC and the reader thinks in their own days, so this rollup is the
 * one place a UTC hour becomes a date the reader recognises.
 */

import type { UsageBuckets, UsageHourBucket, UsageSummaryView } from '@deepseek-ai/dsh-api-usage-controller/types'

/** Which bucket a series plots. */
export type UsageMetricId = 'total' | 'input' | 'output'

/** Palette slots the theme provides before the tail must merge. */
export const CHART_SLOTS = 8

/** Series key of the merged tail, which owns no palette slot of its own. */
export const OTHER_SERIES_KEY = '\u0000other'

/** One plotted model. */
export interface UsageSeries {
  /** Stable identity: provider and model joined, or {@link OTHER_SERIES_KEY}. */
  readonly key: string
  /** Registered provider route, or empty for the merged tail. */
  readonly provider: string
  /** Model id, or empty for the merged tail. */
  readonly model: string
  /** Palette slot, or -1 for the merged tail. */
  readonly slot: number
  /** One value per day of {@link UsageChart.days}. */
  readonly values: readonly number[]
  /** Sum across the plotted days, for ordering and the legend. */
  readonly total: number
}

/** Everything the chart renders. */
export interface UsageChart {
  /** Local calendar days, ascending, with empty days filled in. */
  readonly days: readonly string[]
  /** Plotted series, largest first; every one has a non-zero total. */
  readonly series: readonly UsageSeries[]
  /** Largest single value any series reaches, for the y scale. */
  readonly max: number
}

/** Two-digit zero pad. */
function pad(value: number): string {
  return value < 10 ? '0' + String(value) : String(value)
}

/** The local calendar day one instant falls in. */
function dayOf(at: Date): string {
  return String(at.getFullYear()) + '-' + pad(at.getMonth() + 1) + '-' + pad(at.getDate())
}

/**
 * The reader's own calendar day one instant falls in.
 *
 * Shared with the spend curve, which derives its days from reading timestamps
 * rather than from hour buckets: both charts must agree on where a local day
 * starts, or the two panels would disagree about the same moment.
 *
 * @param ms - Unix epoch milliseconds.
 * @returns the local day key.
 */
export function localDayOfInstant(ms: number): string {
  return dayOf(new Date(ms))
}

/**
 * The reader's own calendar day an hour bucket falls in.
 * @param hour - a UTC hour key, as the Host reports it.
 * @returns the local day key.
 */
export function localDayOf(hour: string): string {
  return localDayOfInstant(new Date(hour + ':00:00Z').getTime())
}

/**
 * Every local day from one day to another, inclusive, gaps filled.
 * @param first - earliest local day key.
 * @param last - latest local day key.
 * @returns ascending day keys.
 */
export function fillDayRange(first: string, last: string): string[] {
  const days: string[] = []
  const cursor = new Date(first + 'T00:00:00')
  const end = new Date(last + 'T00:00:00')
  while (cursor.getTime() <= end.getTime()) {
    days.push(dayOf(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

/**
 * The value one bucket contributes under one metric.
 * @param buckets - the buckets to measure.
 * @param metric - the selected metric.
 * @returns the token count to plot.
 */
export function metricOf(buckets: UsageBuckets, metric: UsageMetricId): number {
  if (metric === 'output') return buckets.outputTokens
  if (metric === 'input') return buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
  return buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens + buckets.outputTokens
}

/**
 * The day axis: every local day the window touches, gaps filled.
 *
 * An empty day is a real zero — the fold covers the whole log, so a day with no
 * usage had none — and the line must stay continuous across it rather than
 * break. That is why the axis is an unbroken run of days instead of only the
 * days that happened to carry traffic.
 *
 * @param hours - the summary's hour buckets.
 * @returns ascending local day keys.
 */
export function dayAxis(hours: readonly UsageHourBucket[]): string[] {
  const present = new Set<string>()
  for (const hour of hours) present.add(localDayOf(hour.hour))
  const sorted = [...present].sort()
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  if (first === undefined || last === undefined) return []
  return fillDayRange(first, last)
}

/** provider to model to one value per day. */
type RouteTable = Map<string, Map<string, number[]>>

/** Accumulate one summary into per-route daily totals. */
function collect(summary: UsageSummaryView, metric: UsageMetricId, index: ReadonlyMap<string, number>): RouteTable {
  const table: RouteTable = new Map()
  for (const hour of summary.hours) {
    const at = index.get(localDayOf(hour.hour))
    if (at === undefined) continue
    for (const route of hour.routes) {
      let models = table.get(route.provider)
      if (models === undefined) {
        models = new Map()
        table.set(route.provider, models)
      }
      let values = models.get(route.model)
      if (values === undefined) {
        values = new Array<number>(index.size).fill(0)
        models.set(route.model, values)
      }
      values[at] = (values[at] ?? 0) + metricOf(route.buckets, metric)
    }
  }
  return table
}

/** One route's daily values before it is assigned a palette slot. */
type RankedSeries = Omit<UsageSeries, 'slot'>

/** Flatten a route table into series, dropping every all-zero route. */
function toSeries(table: RouteTable, days: number): RankedSeries[] {
  const series: RankedSeries[] = []
  for (const provider of [...table.keys()].sort()) {
    const models = table.get(provider)
    if (models === undefined) continue
    for (const model of [...models.keys()].sort()) {
      const values = models.get(model)
      if (values === undefined) continue
      const total = values.reduce((sum, value) => sum + value, 0)
      // The zero rule: a route with nothing to plot in this window has no
      // series at all, so it can neither draw a flat line nor claim a slot.
      if (total === 0) continue
      series.push({
        key: provider + '/' + model,
        provider,
        model,
        values: values.slice(0, days),
        total,
      })
    }
  }
  return series.sort((left, right) => right.total - left.total || left.key.localeCompare(right.key))
}

/**
 * Fold the summary into the chart the section renders.
 *
 * Series are ordered largest first, so the palette's first slots go to the
 * routes that actually carry the window. More series than palette slots merge
 * their tail into one "other" line rather than cycling colours, which would
 * draw two different models as the same line.
 *
 * @param summary - the Host answer for the selected range.
 * @param metric - which bucket to plot.
 * @returns the day axis, the plotted series, and the y maximum.
 */
export function buildChart(summary: UsageSummaryView, metric: UsageMetricId): UsageChart {
  const days = dayAxis(summary.hours)
  if (days.length === 0) return { days: [], series: [], max: 0 }
  const index = new Map(days.map((day, at) => [day, at]))
  const ranked = toSeries(collect(summary, metric, index), days.length)
  const series: UsageSeries[] = ranked.slice(0, CHART_SLOTS).map((entry, slot) => ({ ...entry, slot }))
  const tail = ranked.slice(CHART_SLOTS)
  if (tail.length > 0) {
    const values = new Array<number>(days.length).fill(0)
    let total = 0
    for (const entry of tail) {
      total += entry.total
      entry.values.forEach((value, at) => { values[at] = (values[at] ?? 0) + value })
    }
    series.push({ key: OTHER_SERIES_KEY, provider: '', model: '', slot: -1, values, total })
  }
  let max = 0
  for (const entry of series) {
    for (const value of entry.values) if (value > max) max = value
  }
  return { days, series, max }
}
