/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-usage-ledger`.
 * @module @deepseek-ai/dsh-usage-ledger/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-usage-ledger'

/** Cordis companion plugin name. */
export const name = 'usage-ledger-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the ledger owns one storage domain whose record
 * schemas already validate every stored value at the durable boundary, and it
 * publishes no event stream of its own. Its one cross-plugin relation — a
 * record belonging to the log it was folded from — is a property of the record
 * and the header, checked where the record is read rather than observable as a
 * relation between two live objects, so there is no owned runtime relationship
 * left to assert.
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
