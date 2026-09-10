/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-balance-ledger`.
 * @module @deepseek-ai/dsh-balance-ledger/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-balance-ledger'

/** Cordis companion plugin name. */
export const name = 'balance-ledger-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the ledger owns one storage domain whose record schema
 * already validates every stored reading at the durable boundary, and it
 * publishes no event stream. Its one apparent ordering property — readings
 * ascending by time — is established by the only writer, which appends to the
 * series it just read, and is not a relation between two live objects that a
 * runtime check could observe.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
