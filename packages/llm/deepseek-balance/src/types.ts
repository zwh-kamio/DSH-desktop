/**
 * Public vocabulary for the DeepSeek account-balance reader.
 *
 * Amounts are minor units (cents) held as integers, never floating-point major
 * units: the provider sends decimal strings, and differences between two reads
 * are the whole point of this seam — a spent amount must come out exact, and
 * repeated float subtraction does not stay exact.
 *
 * @module @deepseek-ai/dsh-deepseek-balance/types
 */

/** One currency line of an account balance. */
export interface BalanceLine {
  /** Currency code the provider billed in, such as `CNY` or `USD`. */
  readonly currency: string
  /** Total available balance, granted and topped-up together. */
  readonly totalMinor: number
  /** Not-yet-expired granted balance. */
  readonly grantedMinor: number
  /** Topped-up balance. */
  readonly toppedUpMinor: number
}

/** One read of the account balance. */
export interface BalanceSnapshot {
  /** Whether the provider considers the account funded enough for API calls. */
  readonly available: boolean
  /** One entry per currency the account is billed in; never empty. */
  readonly lines: readonly BalanceLine[]
  /** When this read happened, Unix epoch milliseconds. */
  readonly readAt: number
}

/** Why a balance read produced no snapshot. */
export type BalanceErrorCode =
  /** No credential resolved for the configured reference. */
  | 'MISSING_CREDENTIAL'
  /** The endpoint does not serve the balance API (a proxy that implemented only chat). */
  | 'UNSUPPORTED_ENDPOINT'
  /** The provider rejected the credential. */
  | 'UNAUTHORIZED'
  /** Any other non-2xx answer, or a transport failure. */
  | 'HTTP_ERROR'
  /** The response did not match the documented balance shape. */
  | 'MALFORMED_RESPONSE'
  /** The caller cancelled. */
  | 'ABORTED'
