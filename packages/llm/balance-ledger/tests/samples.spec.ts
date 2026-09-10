import { describe, expect, it } from 'vitest'
import { assertQuery, samplesFor, withSample } from '../src/samples.ts'
import type { BalanceSample } from '../src/types.ts'

/** One reading at a minute offset from an arbitrary origin. */
function at(minute: number, totalMinor = 10_000): BalanceSample {
  return { readAt: minute * 60_000, totalMinor, grantedMinor: 0, toppedUpMinor: totalMinor }
}

describe('appending a reading', () => {
  it('keeps the series ascending', () => {
    const series = withSample(withSample([], at(0), 10), at(1), 10)
    expect(series.map(sample => sample.readAt)).toEqual([0, 60_000])
  })

  it('drops the oldest reading when the cap is reached, never the newest', () => {
    // Truncating from the front leaves a valid history for the remaining span;
    // dropping the newest would make the current balance unknowable.
    let series: BalanceSample[] = []
    for (const minute of [0, 1, 2, 3]) series = withSample(series, at(minute), 3)
    expect(series.map(sample => sample.readAt)).toEqual([60_000, 120_000, 180_000])
  })

  it('refuses a cap that cannot retain anything', () => {
    expect(() => withSample([], at(0), 0)).toThrow(RangeError)
    expect(() => withSample([], at(0), 1.5)).toThrow(RangeError)
  })
})

describe('selecting a window', () => {
  const series = [at(0, 1_000), at(10, 900), at(20, 800), at(30, 700), at(40, 600)]

  it('includes the newest reading before the window as the baseline', () => {
    // Without it the spend inside the first interval would be invisible.
    const selected = samplesFor(series, { sinceMs: 15 * 60_000, untilMs: 35 * 60_000 })
    expect(selected.map(sample => sample.readAt)).toEqual([10 * 60_000, 20 * 60_000, 30 * 60_000])
  })

  it('excludes readings after the window', () => {
    const selected = samplesFor(series, { sinceMs: 0, untilMs: 25 * 60_000 })
    expect(selected.map(sample => sample.readAt)).toEqual([0, 10 * 60_000, 20 * 60_000])
  })

  it('returns nothing for a window that ends before the first reading', () => {
    const later = [at(10), at(20)]
    expect(samplesFor(later, { sinceMs: 0, untilMs: 5 * 60_000 })).toEqual([])
  })

  it('returns the baseline alone when the window holds no reading of its own', () => {
    // Right after the origin: the only eligible reading is the one at the
    // boundary, which is the baseline and nothing more.
    expect(samplesFor(series, { sinceMs: 0, untilMs: 1 }).map(sample => sample.readAt)).toEqual([0])
  })

  it('returns nothing to compare when the window holds one reading and no baseline', () => {
    expect(samplesFor([at(50)], { sinceMs: 0, untilMs: 60 * 60_000 })).toEqual([at(50)])
  })

  it('rejects an inverted window', () => {
    expect(() => samplesFor(series, { sinceMs: 10, untilMs: 5 })).toThrow(RangeError)
  })

  it('rejects a bound that is not a safe integer', () => {
    expect(() => assertQuery({ sinceMs: 0.5, untilMs: 10 })).toThrow(/safe integer/)
  })
})
