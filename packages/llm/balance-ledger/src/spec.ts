/**
 * The balance-ledger domain declaration: one `currencies` table keyed by
 * currency code, each record that currency's readings.
 *
 * Readings are the authority, not a running spend total: a stored total would
 * have to be corrected whenever a reading is dropped or a top-up lands, while
 * consecutive readings always describe their own interval exactly.
 *
 * @module @deepseek-ai/dsh-balance-ledger/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/**
 * One stored reading. Amounts are signed: a provider is free to report a
 * negative balance, and clamping it to zero here would silently change what a
 * later difference means.
 */
export const balanceSampleSchema = z.object({
  readAt: z.number().int().nonnegative(),
  totalMinor: z.number().int(),
  grantedMinor: z.number().int(),
  toppedUpMinor: z.number().int(),
}).strict()

/** One currency's stored readings, newest last. */
export const currencyLedgerSchema = z.object({
  samples: z.array(balanceSampleSchema),
}).strict()

/** One stored currency ledger. */
export type CurrencyLedger = z.infer<typeof currencyLedgerSchema>

/**
 * The balance-ledger domain spec. A version bump discards stale records on
 * open (ledger semantics — a discarded record costs history, never a wrong
 * difference) while the rest of the domain stays usable.
 */
export const balanceLedgerDomainSpec = defineDomain({
  name: 'deepseek_balance',
  version: 1,
  layout: 'per-record',
  tables: { currencies: domainTable<string, CurrencyLedger>(currencyLedgerSchema) },
})
