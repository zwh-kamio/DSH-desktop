/**
 * Presentation arithmetic for the Usage section. Kept separate from the
 * component so the rollups and their rounding rules are testable without a
 * render.
 */

import type { UsageBuckets } from '@deepseek-ai/dsh-api-usage-controller/types'

/** The four bucket keys, in the order the page lists them. */
export const BUCKET_KEYS = [
  'uncachedInputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'outputTokens',
] as const satisfies readonly (keyof UsageBuckets)[]

/** One bucket key. */
export type UsageBucketKey = typeof BUCKET_KEYS[number]

/** A zeroed bucket set. */
export function emptyBuckets(): UsageBuckets {
  return { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

/**
 * Sum every bucket of one set.
 * @param buckets - the set to total.
 * @returns the token count across all four buckets.
 */
export function totalTokens(buckets: UsageBuckets): number {
  return buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens + buckets.outputTokens
}

/**
 * Cache hit rate over the prompt side, as a whole percentage.
 *
 * The denominator is the prompt traffic that could have been cached — misses
 * plus hits — and never includes output. A window with no prompt traffic has
 * no rate at all, which is why this returns `null` rather than 0%.
 *
 * @param buckets - the window's totals.
 * @returns the rounded percentage, or `null` when nothing was sent.
 */
export function cacheHitRate(buckets: UsageBuckets): number | null {
  const prompt = buckets.uncachedInputTokens + buckets.cacheReadTokens
  if (prompt === 0) return null
  return Math.round((buckets.cacheReadTokens / prompt) * 100)
}

/**
 * Group a token count for display.
 * @param value - a non-negative token count.
 * @returns the count with the reader's own digit grouping.
 */
export function formatTokens(value: number): string {
  return new Intl.NumberFormat().format(value)
}

/**
 * Render exact minor units as money.
 *
 * The division happens once, at the presentation edge, and only for display:
 * every balance the page holds stays in minor units, which is what keeps a
 * difference between two reads exact.
 *
 * @param minor - the amount in minor units.
 * @param currency - the currency code the provider reported.
 * @returns the amount in the reader's own format.
 */
export function formatMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / 100)
  } catch {
    // The provider names the currency, and Intl rejects a code it does not
    // know; showing the code verbatim beats dropping the amount entirely.
    return currency + ' ' + (minor / 100).toFixed(2)
  }
}
