import { describe, expect, it } from 'vitest'
import type { UsageHourBucket, UsageSummaryView } from '@deepseek-ai/dsh-api-usage-controller/types'
import {
  buildChart, CHART_SLOTS, dayAxis, localDayOf, metricOf, OTHER_SERIES_KEY,
} from '../src/client/chart-geometry.ts'
import type { UsageBuckets } from '@deepseek-ai/dsh-api-usage-controller/types'

/**
 * Fixtures are built from LOCAL instants and converted to the UTC hour keys the
 * Host actually emits, so these cases hold in any timezone. Hardcoding a UTC
 * hour would only pass where the machine's offset happened to match.
 */
function hourKeyOf(local: Date): string {
  return local.toISOString().slice(0, 13)
}

function buckets(overrides: Partial<UsageBuckets> = {}): UsageBuckets {
  return { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, ...overrides }
}

/** One local day, at the given hour, carrying one route's usage. */
function hourAt(
  day: number,
  hourOfDay: number,
  routes: readonly { provider: string; model: string; buckets: UsageBuckets }[],
): UsageHourBucket {
  const local = new Date(2026, 0, day, hourOfDay, 0, 0, 0)
  return {
    hour: hourKeyOf(local),
    buckets: routes.reduce<UsageBuckets>((sum, route) => ({
      uncachedInputTokens: sum.uncachedInputTokens + route.buckets.uncachedInputTokens,
      outputTokens: sum.outputTokens + route.buckets.outputTokens,
      cacheReadTokens: sum.cacheReadTokens + route.buckets.cacheReadTokens,
      cacheWriteTokens: sum.cacheWriteTokens + route.buckets.cacheWriteTokens,
    }), buckets()),
    routes,
  }
}

function summaryOf(hours: readonly UsageHourBucket[]): UsageSummaryView {
  return { hours, models: [], accountedSessions: 1, unaccountedSessions: 0 }
}

/** The per-route totals a fixture carries, largest first. */
function rankedTotals(routes: readonly { buckets: UsageBuckets }[]): number[] {
  return routes.map(route => route.buckets.outputTokens).sort((left, right) => right - left)
}

const FLASH = 'deepseek-v4-flash'
const PRO = 'deepseek-v4-pro'
const OFFICIAL = 'deepseek-official'

describe('chart metrics', () => {
  it('counts cached prompt traffic as input, never as output', () => {
    const sample = buckets({ uncachedInputTokens: 10, cacheReadTokens: 100, cacheWriteTokens: 5, outputTokens: 7 })
    expect(metricOf(sample, 'input')).toBe(115)
    expect(metricOf(sample, 'output')).toBe(7)
    expect(metricOf(sample, 'total')).toBe(122)
  })
})

describe('the local day axis', () => {
  it('rolls a UTC hour into the reader\'s own calendar day', () => {
    const local = new Date(2026, 0, 5, 23, 0, 0, 0)
    expect(localDayOf(hourKeyOf(local))).toBe('2026-01-05')
  })

  it('fills the day after a late-hour bucket, not just the days that had traffic', () => {
    // 02:00 and 03:00, a 23:00 and a 01:00 three days later.
    const hours = [
      hourAt(5, 2, [{ provider: OFFICIAL, model: FLASH, buckets: buckets({ outputTokens: 1 }) }]),
      hourAt(5, 3, [{ provider: OFFICIAL, model: FLASH, buckets: buckets({ outputTokens: 1 }) }]),
      hourAt(5, 23, [{ provider: OFFICIAL, model: FLASH, buckets: buckets({ outputTokens: 1 }) }]),
      hourAt(8, 1, [{ provider: OFFICIAL, model: FLASH, buckets: buckets({ outputTokens: 1 }) }]),
    ]
    expect(dayAxis(hours)).toEqual([
      '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08',
    ])
  })

  it('has no axis when the window carried nothing', () => {
    expect(dayAxis([])).toEqual([])
  })
})

describe('the per-model chart', () => {
  it('plots one point per day for each route', () => {
    const chart = buildChart(summaryOf([
      hourAt(5, 2, [{ provider: OFFICIAL, model: FLASH, buckets: buckets({ outputTokens: 10 }) }]),
      hourAt(6, 2, [{ provider: OFFICIAL, model: FLASH, buckets: buckets({ outputTokens: 30 }) }]),
    ]), 'output')
    expect(chart.days).toEqual(['2026-01-05', '2026-01-06'])
    expect(chart.series).toHaveLength(1)
    expect(chart.series[0]?.model).toBe(FLASH)
    expect(chart.series[0]?.values).toEqual([10, 30])
    expect(chart.max).toBe(30)
  })

  it('sums every hour of a day into that day\'s point', () => {
    const chart = buildChart(summaryOf([
      hourAt(5, 2, [{ provider: OFFICIAL, model: FLASH, buckets: buckets({ outputTokens: 10 }) }]),
      hourAt(5, 9, [{ provider: OFFICIAL, model: FLASH, buckets: buckets({ outputTokens: 5 }) }]),
    ]), 'output')
    expect(chart.series[0]?.values).toEqual([15])
  })

  it('drops a model with no usage in the window entirely', () => {
    const chart = buildChart(summaryOf([
      hourAt(5, 2, [{ provider: OFFICIAL, model: FLASH, buckets: buckets({ outputTokens: 10 }) }]),
      // Present in the fold, absent from the window's hours: it must not draw a
      // flat line at zero, nor take a palette slot.
      hourAt(5, 4, [{ provider: OFFICIAL, model: PRO, buckets: buckets() }]),
    ]), 'output')
    expect(chart.series.map(series => series.model)).toEqual([FLASH])
  })

  it('drops a model whose only usage is in a bucket the metric ignores', () => {
    // Cache reads are invisible under the output metric, so a cache-only model
    // has nothing to plot there and must not appear.
    const chart = buildChart(summaryOf([
      hourAt(5, 2, [
        { provider: OFFICIAL, model: FLASH, buckets: buckets({ outputTokens: 4 }) },
        { provider: OFFICIAL, model: PRO, buckets: buckets({ cacheReadTokens: 1000 }) },
      ]),
    ]), 'output')
    expect(chart.series.map(series => series.model)).toEqual([FLASH])
    const asTotal = buildChart(summaryOf([
      hourAt(5, 2, [
        { provider: OFFICIAL, model: FLASH, buckets: buckets({ outputTokens: 4 }) },
        { provider: OFFICIAL, model: PRO, buckets: buckets({ cacheReadTokens: 1000 }) },
      ]),
    ]), 'total')
    expect(asTotal.series.map(series => series.model)).toEqual([PRO, FLASH])
  })

  it('orders series largest first and gives each a palette slot', () => {
    const chart = buildChart(summaryOf([
      hourAt(5, 2, [
        { provider: OFFICIAL, model: FLASH, buckets: buckets({ outputTokens: 10 }) },
        { provider: OFFICIAL, model: PRO, buckets: buckets({ outputTokens: 90 }) },
      ]),
    ]), 'output')
    expect(chart.series.map(series => [series.model, series.slot])).toEqual([[PRO, 0], [FLASH, 1]])
  })

  it('keeps distinct providers apart even when they share a model id', () => {
    const chart = buildChart(summaryOf([
      hourAt(5, 2, [
        { provider: OFFICIAL, model: FLASH, buckets: buckets({ outputTokens: 10 }) },
        { provider: 'llm-pi-ai', model: FLASH, buckets: buckets({ outputTokens: 20 }) },
      ]),
    ]), 'output')
    expect(chart.series.map(series => series.key)).toEqual(['llm-pi-ai/' + FLASH, OFFICIAL + '/' + FLASH])
  })

  it('merges the tail beyond the palette into one other line instead of repeating colours', () => {
    const routes = Array.from({ length: CHART_SLOTS + 2 }, (_, index) => ({
      provider: OFFICIAL,
      model: 'model-' + String(index),
      buckets: buckets({ outputTokens: 100 - index }),
    }))
    const chart = buildChart(summaryOf([hourAt(5, 2, routes)]), 'output')
    expect(chart.series).toHaveLength(CHART_SLOTS + 1)
    const other = chart.series[chart.series.length - 1]
    expect(other?.key).toBe(OTHER_SERIES_KEY)
    expect(other?.slot).toBe(-1)
    // Ten models, eight slots: the two smallest are the ones merged.
    expect(rankedTotals(routes).slice(CHART_SLOTS)).toEqual([92, 91])
    expect(other?.total).toBe(92 + 91)
  })

  it('has nothing to draw for an empty window', () => {
    expect(buildChart(summaryOf([]), 'total')).toEqual({ days: [], series: [], max: 0 })
  })
})
