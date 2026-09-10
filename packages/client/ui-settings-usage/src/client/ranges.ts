/**
 * The ranges the Usage page offers, in presentation order.
 *
 * The label is a copy key rather than text: the registrant owns no strings of
 * its own, and the section translates each key at render time.
 */

import type { UsageMetricId } from './chart-geometry.ts'
import type { UsageRangeId } from './usage-store.ts'
import type { UsageKey } from './locales.ts'

/** One selectable range. */
export interface UsageWindowOption {
  /** Range identity the store records. */
  readonly id: UsageRangeId
  /** Copy key for the button's label. */
  readonly label: UsageKey
}

/** Offered ranges, widest last. */
export const WINDOWS: readonly UsageWindowOption[] = [
  { id: '7d', label: 'range7d' },
  { id: '30d', label: 'range30d' },
  { id: 'all', label: 'rangeAll' },
]

/** One selectable metric. */
export interface UsageMetricOption {
  /** Metric identity the store records. */
  readonly id: UsageMetricId
  /** Copy key for the button's label. */
  readonly label: UsageKey
}

/**
 * Offered metrics, widest first.
 *
 * Cached prompt traffic dwarfs everything else in a long conversation, so a
 * total-only chart is mostly a picture of the cache. "Output" is what a reader
 * asking "how much did I generate" wants, and it is offered beside the total
 * rather than buried.
 */
export const METRICS: readonly UsageMetricOption[] = [
  { id: 'total', label: 'metricTotal' },
  { id: 'input', label: 'metricInput' },
  { id: 'output', label: 'metricOutput' },
]
