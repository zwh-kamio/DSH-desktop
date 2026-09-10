/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-deepseek-balance`.
 * @module @deepseek-ai/dsh-deepseek-balance/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-deepseek-balance'

/** Cordis companion plugin name. */
export const name = 'deepseek-balance-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the reader is stateless. Each call resolves a fresh
 * credential, performs one request, and returns a detached value — it holds no
 * cache, publishes no event, and owns no data another plugin can observe, so
 * there is no relationship between two live objects left to assert. The reply
 * contract is checked where it enters, by the response schema, which is the
 * boundary that can actually be wrong.
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
