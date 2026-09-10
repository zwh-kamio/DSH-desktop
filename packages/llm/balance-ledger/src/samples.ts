/**
 * Pure series bookkeeping for stored readings: bounded append, and the window
 * selection that hands a caller its own baseline.
 *
 * @module @deepseek-ai/dsh-balance-ledger/samples
 */

import type { BalanceSample, BalanceHistoryQuery } from './types.ts'

/**
 * Append one reading to a bounded series, newest last.
 *
 * The cap drops the OLDEST readings, never the newest: a truncated series
 * stays a valid spend history for its remaining span, whereas dropping from
 * the front of time would make every later difference span a hole.
 *
 * @param samples - the series so far, ascending by time.
 * @param sample - the reading to append.
 * @param cap - maximum readings retained.
 * @returns a new ascending series of at most `cap` readings.
 * @throws RangeError when the cap is not a positive integer.
 */
export function withSample(
  samples: readonly BalanceSample[],
  sample: BalanceSample,
  cap: number,
): BalanceSample[] {
  if (!Number.isSafeInteger(cap) || cap < 1) {
    throw new RangeError('balance ledger: retentionSamples must be a positive integer, got ' + String(cap))
  }
  const appended = [...samples, sample]
  return appended.length <= cap ? appended : appended.slice(appended.length - cap)
}

/**
 * Reject a window that cannot describe a range.
 * @param query - the window to check.
 * @throws RangeError when a bound is not a finite integer or the window is inverted.
 */
export function assertQuery(query: BalanceHistoryQuery): void {
  for (const [name, value] of [['sinceMs', query.sinceMs], ['untilMs', query.untilMs]] as const) {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError('balance ledger: ' + name + ' must be a safe integer, got ' + String(value))
    }
  }
  if (query.sinceMs > query.untilMs) {
    throw new RangeError(
      'balance ledger: sinceMs ' + String(query.sinceMs) + ' is after untilMs ' + String(query.untilMs),
    )
  }
}

/**
 * Select the readings a window needs, including its baseline.
 *
 * The result is the newest reading at or before `sinceMs` (when there is one)
 * followed by every reading inside the window. That leading reading is what
 * makes the first in-window interval measurable: a spend is a difference, and
 * the interval that begins at `sinceMs` began at whatever was last read before
 * it.
 *
 * Readings after `untilMs` are excluded so the answer cannot describe a
 * moment the caller did not ask about.
 *
 * @param samples - the whole series, ascending by time.
 * @param query - the window to cover.
 * @returns the baseline and in-window readings, ascending.
 * @throws RangeError when the window is not a valid range.
 */
export function samplesFor(
  samples: readonly BalanceSample[],
  query: BalanceHistoryQuery,
): BalanceSample[] {
  assertQuery(query)
  const out: BalanceSample[] = []
  let baseline: BalanceSample | undefined
  for (const sample of samples) {
    if (sample.readAt <= query.sinceMs) {
      baseline = sample
      continue
    }
    if (sample.readAt > query.untilMs) break
    out.push(sample)
  }
  return baseline === undefined ? out : [baseline, ...out]
}
