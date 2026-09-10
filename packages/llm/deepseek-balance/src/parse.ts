/**
 * Decoding for the documented `GET /user/balance` reply.
 *
 * This is a wire boundary, so the schema is checked rather than trusted: a
 * provider that changes a field name or starts sending a number instead of a
 * decimal string must fail loudly here, not silently report a zero balance.
 *
 * @module @deepseek-ai/dsh-deepseek-balance/parse
 */

import { z } from 'zod'
import { BalanceError } from './errors.ts'
import type { BalanceLine } from './types.ts'

/** Minor units in one major unit for every currency the endpoint reports. */
const MINOR_PER_MAJOR = 100

/**
 * A decimal amount as the endpoint sends it. At most two fraction digits, in
 * keeping with a currency: accepting more would mean rounding money on the way
 * in, and a rounded balance makes every later difference wrong.
 */
const amountSchema = z.string().regex(/^\d+(?:\.\d{1,2})?$/u, 'expected a decimal amount with at most two fraction digits')

/** The documented reply shape. Unknown extra fields are ignored, not rejected. */
export const balanceResponseSchema = z.object({
  is_available: z.boolean(),
  balance_infos: z.array(z.object({
    currency: z.string().min(1),
    total_balance: amountSchema,
    granted_balance: amountSchema,
    topped_up_balance: amountSchema,
  })).min(1),
})

/** The decoded reply, before the read timestamp is attached. */
export interface DecodedBalance {
  /** Whether the provider considers the account funded. */
  readonly available: boolean
  /** One entry per reported currency. */
  readonly lines: readonly BalanceLine[]
}

/**
 * Convert one decimal amount string to exact minor units.
 * @param value - a decimal string already validated by {@link balanceResponseSchema}.
 * @returns the amount in minor units.
 */
export function toMinor(value: string): number {
  const [whole = '0', fraction = ''] = value.split('.')
  return Number(whole) * MINOR_PER_MAJOR + Number(fraction.padEnd(2, '0'))
}

/**
 * Decode one balance reply.
 * @param raw - the parsed JSON body.
 * @returns the account's availability and per-currency lines.
 * @throws BalanceError with `MALFORMED_RESPONSE` when the body is not the documented shape.
 */
export function parseBalanceResponse(raw: unknown): DecodedBalance {
  const parsed = balanceResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new BalanceError(
      `DeepSeek balance response did not match the documented shape: ${parsed.error.message}`,
      'MALFORMED_RESPONSE',
    )
  }
  return {
    available: parsed.data.is_available,
    lines: parsed.data.balance_infos.map(info => ({
      currency: info.currency,
      totalMinor: toMinor(info.total_balance),
      grantedMinor: toMinor(info.granted_balance),
      toppedUpMinor: toMinor(info.topped_up_balance),
    })),
  }
}
