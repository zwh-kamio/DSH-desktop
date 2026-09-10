import { describe, expect, it } from 'vitest'
import type { BalanceHistory, BalanceSample } from '@deepseek-ai/dsh-api-usage-controller/types'
import { buildSpend, intervalsOf, spendSeriesOf } from '../src/client/spend-geometry.ts'
import { localDayOfInstant } from '../src/client/chart-geometry.ts'

/**
 * Readings are built from LOCAL instants so these cases hold in any timezone;
 * a hardcoded UTC instant would only pass where the machine's offset matched.
 */
function readingAt(day: number, hour: number, totalMinor: number): BalanceSample {
  return {
    readAt: new Date(2026, 0, day, hour, 0, 0, 0).getTime(),
    totalMinor,
    grantedMinor: 0,
    toppedUpMinor: totalMinor,
  }
}

describe('classifying intervals', () => {
  it('reads a fall as spend', () => {
    const intervals = intervalsOf([readingAt(5, 9, 10_000), readingAt(5, 10, 9_700)])
    expect(intervals).toHaveLength(1)
    expect(intervals[0]?.spendMinor).toBe(300)
    expect(intervals[0]?.topUpMinor).toBe(0)
  })

  it('reads a rise as a top-up, because usage can only lower a balance', () => {
    const intervals = intervalsOf([readingAt(5, 9, 10_000), readingAt(5, 10, 15_000)])
    expect(intervals[0]?.topUpMinor).toBe(5_000)
    expect(intervals[0]?.spendMinor).toBe(0)
  })

  it('reads an unchanged balance as neither', () => {
    const intervals = intervalsOf([readingAt(5, 9, 10_000), readingAt(5, 10, 10_000)])
    expect(intervals[0]).toMatchObject({ spendMinor: 0, topUpMinor: 0 })
  })

  it('needs two readings before there is an interval at all', () => {
    expect(intervalsOf([readingAt(5, 9, 10_000)])).toEqual([])
    expect(intervalsOf([])).toEqual([])
  })
})

describe('the daily spend series', () => {
  it('sums every interval that ends on the same local day', () => {
    const series = spendSeriesOf('CNY', [
      readingAt(5, 9, 10_000),
      readingAt(5, 10, 9_700),
      readingAt(5, 11, 9_600),
    ])
    expect(series?.days).toEqual([{ day: '2026-01-05', spendMinor: 400, topUpMinor: 0 }])
    expect(series?.spendMinor).toBe(400)
  })

  it('attributes an interval to the day its later reading landed', () => {
    // The change was observed at the second reading; spreading it across the
    // days it spans would be inventing detail the readings do not contain.
    const series = spendSeriesOf('CNY', [
      readingAt(5, 23, 10_000),
      readingAt(6, 1, 9_500),
    ])
    // Only the 6th carries an interval, so only the 6th appears: the 5th holds
    // the baseline, which measures nothing on its own.
    expect(series?.days).toEqual([{ day: '2026-01-06', spendMinor: 500, topUpMinor: 0 }])
  })

  it('fills a day no reading touched with a stated zero', () => {
    const series = spendSeriesOf('CNY', [
      readingAt(5, 9, 10_000),
      readingAt(5, 10, 9_000),
      readingAt(8, 9, 9_000),
      readingAt(8, 10, 8_000),
    ])
    expect(series?.days.map(day => day.day)).toEqual([
      '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08',
    ])
    expect(series?.days.map(day => day.spendMinor)).toEqual([1_000, 0, 0, 1_000])
  })

  it('keeps top-ups out of the spend bars', () => {
    const series = spendSeriesOf('CNY', [
      readingAt(5, 9, 10_000),
      readingAt(5, 10, 9_000),
      readingAt(5, 11, 20_000),
      readingAt(5, 12, 19_500),
    ])
    expect(series?.spendMinor).toBe(1_500)
    expect(series?.topUpMinor).toBe(11_000)
    expect(series?.days[0]?.topUpMinor).toBe(11_000)
  })

  it('has nothing to plot without an interval', () => {
    expect(spendSeriesOf('CNY', [readingAt(5, 9, 10_000)])).toBeUndefined()
    expect(spendSeriesOf('CNY', [])).toBeUndefined()
  })

  it('reports the largest single day for the y scale', () => {
    const series = spendSeriesOf('CNY', [
      readingAt(5, 9, 10_000),
      readingAt(5, 10, 9_000),
      readingAt(6, 9, 9_000),
      readingAt(6, 10, 8_500),
    ])
    expect(series?.max).toBe(1_000)
  })

  it('agrees with the day boundary the token chart uses', () => {
    const sample = readingAt(5, 23, 1_000)
    expect(localDayOfInstant(sample.readAt)).toBe('2026-01-05')
  })
})

describe('every currency', () => {
  it('plots one series per currency that has an interval', () => {
    const history: BalanceHistory = {
      currencies: [
        { currency: 'CNY', samples: [readingAt(5, 9, 10_000), readingAt(5, 10, 9_000)] },
        { currency: 'USD', samples: [readingAt(5, 9, 500)] },
      ],
    }
    const series = buildSpend(history)
    expect(series.map(entry => entry.currency)).toEqual(['CNY'])
  })

  it('has nothing to plot for a history with no readings', () => {
    expect(buildSpend({ currencies: [] })).toEqual([])
  })
})
