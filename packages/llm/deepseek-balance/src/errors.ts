/** The failure type every balance read reports through. */

import type { BalanceErrorCode } from './types.ts'

/** A balance read that produced no snapshot. */
export class BalanceError extends Error {
  /**
   * @param message - operator-facing diagnosis.
   * @param code - the discriminant callers switch on.
   * @param options - standard error options; the transport failure rides `cause`.
   */
  constructor(message: string, readonly code: BalanceErrorCode, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'BalanceError'
  }
}
