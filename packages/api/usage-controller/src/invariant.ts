/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-api-usage-controller`.
 * @module @deepseek-ai/dsh-api-usage-controller/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-api-usage-controller'

/** Cordis companion plugin name. */
export const name = 'api-usage-controller-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the controller is a stateless pass-through that owns
 * no mutable data and publishes no events — it decodes a wire request, reads
 * the ledger service, and returns. The one relation it could be said to hold,
 * a reply matching its request window, is produced by the ledger, whose own
 * package owns that fold.
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
