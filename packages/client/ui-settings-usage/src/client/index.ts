/**
 * Usage settings section plugin, browser half. It registers one
 * `settings.section` page over the `usage` Remote namespace, and owns no
 * behavior beyond reading that namespace into its store.
 * Export discipline: packages/client/AGENTS.md.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.remote merge for the usage namespace into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { UsageSection } from './UsageSection.tsx'
import type { UsageSectionInjected } from './UsageSection.tsx'
import { createUsageOperations } from './operations.ts'
import { createUsageSettingsStore } from './usage-store.ts'
import { en, zh, type UsageKey } from './locales.ts'

export type { UsageSectionInjected, UsageSectionProps } from './UsageSection.tsx'
export type { UsageKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Usage page copy. */
    'settings.usage': UsageKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.usage'

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on the slot through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'remote', 'remote.usage']

/**
 * Register the Usage section once the `settings.section` declaration is on the
 * ledger, over one store shared by every render of it.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-usage: copy dictionaries')

  // Bound once here, where the Remote namespace is declared in this plugin's
  // own `inject`; the section receives callbacks and never a context.
  const operations = createUsageOperations(ctx)
  const controller = createUsageSettingsStore(operations)
  const injected = (): UsageSectionInjected => ({
    hooks: { usageSettings: controller.store },
    load: () => controller.load(),
    setRange: (range) => { controller.setRange(range) },
    setMetric: (metric) => { controller.setMetric(metric) },
    toggleSeries: (key) => { controller.toggleSeries(key) },
    loadBalance: () => controller.loadBalance(),
  })

  // Ordered after Models and Agent presets: usage is what a reader checks once
  // the configuration that produces it is settled.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'usage',
    order: 30,
    label: () => ctx.locale.bind(NS)('nav'),
    locale: NS,
    inject: injected,
  }, UsageSection))
}
