import { describe, expect, it } from 'vitest'
import type { UsageBuckets } from '@deepseek-ai/dsh-api-usage-controller/types'
import { BUCKET_KEYS, cacheHitRate, emptyBuckets, formatMoney, formatTokens, totalTokens } from '../src/client/format.ts'

function buckets(overrides: Partial<UsageBuckets> = {}): UsageBuckets {
  return { ...emptyBuckets(), ...overrides }
}

describe('usage presentation arithmetic', () => {
  it('lists every bucket key exactly once, in page order', () => {
    expect([...BUCKET_KEYS]).toEqual([
      'uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens',
    ])
  })

  it('totals all four buckets including cached traffic', () => {
    expect(totalTokens(buckets({
      uncachedInputTokens: 10, cacheReadTokens: 1_000, cacheWriteTokens: 5, outputTokens: 200,
    }))).toBe(1_215)
  })

  it('measures the hit rate over prompt traffic only', () => {
    // Output is billed but never cached, so it must not move the rate.
    expect(cacheHitRate(buckets({ uncachedInputTokens: 100, cacheReadTokens: 900, outputTokens: 9_999 }))).toBe(90)
  })

  it('reports no rate at all when nothing was sent', () => {
    // 0/0 is not 0%: a window with no prompt traffic has no rate to show.
    expect(cacheHitRate(buckets({ outputTokens: 50 }))).toBeNull()
  })

  it('rounds the rate to the nearest whole percent', () => {
    expect(cacheHitRate(buckets({ uncachedInputTokens: 3, cacheReadTokens: 1 }))).toBe(25)
    expect(cacheHitRate(buckets({ uncachedInputTokens: 2, cacheReadTokens: 1 }))).toBe(33)
  })

  it('groups large counts for display', () => {
    expect(formatTokens(1_234_567)).toBe(new Intl.NumberFormat().format(1_234_567))
    expect(formatTokens(0)).toBe('0')
  })
})

describe('money presentation', () => {
  it('renders exact minor units in the reader\'s own currency format', () => {
    const expected = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'CNY' }).format(110)
    expect(formatMoney(11_000, 'CNY')).toBe(expected)
  })

  it('keeps a sub-unit amount exact', () => {
    const expected = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(0.05)
    expect(formatMoney(5, 'USD')).toBe(expected)
  })

  it('falls back to the raw code for a currency Intl rejects', () => {
    // The provider names the currency; an unknown code must not lose the amount.
    expect(formatMoney(1_250, 'NOT-A-CURRENCY')).toContain('12.50')
    expect(formatMoney(1_250, 'NOT-A-CURRENCY')).toContain('NOT-A-CURRENCY')
  })
})
