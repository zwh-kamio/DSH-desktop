/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-settings-usage`.
 * @module @deepseek-ai/dsh-client-ui-settings-usage/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-settings-usage'

/** Cordis companion plugin name. */
export const name = 'client-ui-settings-usage-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the section reads one Remote summary on demand and
 * publishes it through its own store, so it owns no cross-plugin mutable data
 * and emits no cordis events. The one relation worth stating — a rendered
 * series set matching the range it was requested for — is produced on the Host
 * and asserted by this package's component specs against the store directly.
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
