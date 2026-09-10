import { describe, expect, it } from 'vitest'
import { summarize } from '../src/aggregate.ts'
import type { SessionLedgerRecord } from '../src/spec.ts'
import type { UsageBuckets } from '../src/types.ts'

/** 2026-01-05T00:00:00Z and the window that covers that whole UTC day. */
const DAY = Date.UTC(2026, 0, 5, 0, 0, 0)
const HOUR = 3_600_000
const WINDOW = { sinceMs: DAY, untilMs: DAY + 23 * HOUR }

function buckets(uncachedInputTokens: number, outputTokens: number): UsageBuckets {
  return { uncachedInputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

/** One stored hour cell: totals plus the routes that ran within it. */
function hour(uncached: number, output: number, routes: readonly { provider: string; model: string; buckets: UsageBuckets }[]) {
  return { total: buckets(uncached, output), routes }
}

function record(byHour: Record<string, ReturnType<typeof hour>>): SessionLedgerRecord {
  return { identity: { createdAt: 1 }, throughSeq: 9, byHour }
}

/** Hour key for one offset from the test day's midnight. */
function at(offsetHours: number): string {
  return new Date(DAY + offsetHours * HOUR).toISOString().slice(0, 13)
}

describe('usage ledger aggregation', () => {
  it('merges the same hour across sessions', () => {
    const summary = summarize([
      record({ [at(1)]: hour(10, 1, [{ provider: 'p', model: 'm', buckets: buckets(10, 1) }]) }),
      record({ [at(1)]: hour(20, 2, [{ provider: 'p', model: 'm', buckets: buckets(20, 2) }]) }),
    ], WINDOW, 0)
    expect(summary.hours).toEqual([{
      hour: at(1),
      buckets: buckets(30, 3),
      routes: [{ provider: 'p', model: 'm', buckets: buckets(30, 3) }],
    }])
    expect(summary.models).toEqual([{ provider: 'p', model: 'm', buckets: buckets(30, 3) }])
    expect(summary.accountedSessions).toBe(2)
  })

  it('clips both dimensions to the requested window', () => {
    const summary = summarize([
      record({
        [at(-5)]: hour(999, 999, [{ provider: 'p', model: 'stale', buckets: buckets(999, 999) }]),
        [at(3)]: hour(10, 1, [{ provider: 'p', model: 'fresh', buckets: buckets(10, 1) }]),
        [at(30)]: hour(888, 888, [{ provider: 'p', model: 'future', buckets: buckets(888, 888) }]),
      }),
    ], WINDOW, 0)
    expect(summary.hours.map(entry => entry.hour)).toEqual([at(3)])
    expect(summary.models.map(entry => entry.model)).toEqual(['fresh'])
  })

  it('omits a route whose only usage falls outside the window', () => {
    const summary = summarize([
      record({ [at(2)]: hour(5, 5, [{ provider: 'p', model: 'm', buckets: buckets(5, 5) }]) }),
    ], { sinceMs: DAY + 20 * HOUR, untilMs: DAY + 23 * HOUR }, 0)
    expect(summary.hours).toEqual([])
    expect(summary.models).toEqual([])
  })

  it('reports sessions with no usable ledger instead of guessing at them', () => {
    const summary = summarize([record({})], WINDOW, 7)
    expect(summary.accountedSessions).toBe(1)
    expect(summary.unaccountedSessions).toBe(7)
  })

  it('returns an empty summary for a corpus with nothing stored', () => {
    expect(summarize([], WINDOW, 0)).toEqual({
      hours: [], models: [], accountedSessions: 0, unaccountedSessions: 0,
    })
  })

  it('sorts hours ascending and routes by provider then model', () => {
    const summary = summarize([
      record({
        [at(9)]: hour(1, 1, [
          { provider: 'z', model: 'a', buckets: buckets(1, 1) },
          { provider: 'a', model: 'b', buckets: buckets(1, 1) },
        ]),
        [at(2)]: hour(1, 1, [{ provider: 'a', model: 'a', buckets: buckets(1, 1) }]),
      }),
    ], WINDOW, 0)
    expect(summary.hours.map(entry => entry.hour)).toEqual([at(2), at(9)])
    expect(summary.models.map(entry => [entry.provider, entry.model])).toEqual([['a', 'a'], ['a', 'b'], ['z', 'a']])
  })

  it('rejects an inverted window rather than answering with nothing', () => {
    expect(() => summarize([], { sinceMs: DAY + HOUR, untilMs: DAY }, 0)).toThrow(RangeError)
  })

  it('rejects a bound that is not a safe integer', () => {
    expect(() => summarize([], { sinceMs: 0.5, untilMs: DAY }, 0)).toThrow(/safe integer/)
    expect(() => summarize([], { sinceMs: 0, untilMs: Number.POSITIVE_INFINITY }, 0)).toThrow(/safe integer/)
  })
})
