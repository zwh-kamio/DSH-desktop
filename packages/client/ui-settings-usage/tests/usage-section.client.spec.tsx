// @vitest-environment jsdom
/** Section behavior over a scripted store: what a reader sees for one Host answer. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { UsageSummaryView } from '@deepseek-ai/dsh-api-usage-controller/types'
import { UsageSection } from '../src/client/UsageSection.tsx'
import type { UsageSectionProps } from '../src/client/UsageSection.tsx'
import { createUsageSettingsStore } from '../src/client/usage-store.ts'
import type { UsageOperations, UsageSummaryOutcome } from '../src/client/operations.ts'
import { en } from '../src/client/locales.ts'
import { formatMoney } from '../src/client/format.ts'

afterEach(cleanup)

const NOW = new Date(2026, 0, 5, 15, 30, 0, 0).getTime()

/** The runtime's own {name} substitution, so a test reads the shown text. */
function translate(key: keyof typeof en, params?: Record<string, unknown>): string {
  const template = en[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

/** A store already holding one answer, so the section renders it on the first paint. */
function loadedStore(summary: UsageSummaryView) {
  const operations: UsageOperations = {
    loadSummary: () => Promise.resolve({ kind: 'loaded', summary } as UsageSummaryOutcome),
    loadBalance: () => Promise.resolve({ kind: 'refused', message: 'not scripted' }),
    loadHistory: () => Promise.resolve({ kind: 'refused', message: 'not scripted' }),
  }
  const store = createUsageSettingsStore(operations, () => NOW)
  store.store.set({
    status: 'ready',
    range: '7d',
    summary,
    error: null,
    metric: 'total',
    hidden: [],
    balance: { status: 'idle', snapshot: null, error: null },
    spend: { status: 'idle', series: [], error: null },
  })
  return store
}

const BUCKETS = { uncachedInputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 0, outputTokens: 50 }

const SUMMARY: UsageSummaryView = {
  // The window rollup and the per-hour split describe the same traffic: the
  // table reads the first, the chart reads the second.
  hours: [{
    hour: '2026-01-05T10',
    buckets: BUCKETS,
    routes: [
      { provider: 'deepseek-official', model: 'deepseek-v4-flash', buckets: BUCKETS },
      { provider: 'deepseek-official', model: 'deepseek-v4-pro', buckets: BUCKETS },
    ],
  }],
  models: [
    { provider: 'deepseek-official', model: 'deepseek-v4-flash', buckets: BUCKETS },
    { provider: 'deepseek-official', model: 'deepseek-v4-pro', buckets: BUCKETS },
  ],
  accountedSessions: 3,
  unaccountedSessions: 0,
}

/**
 * Render the section over one store.
 *
 * The mount-time read is stubbed out by default: these cases feed the store
 * directly and assert what a reader sees for one answer, so a real load would
 * only replace that answer with the loading state.
 */
function renderSection(store: ReturnType<typeof loadedStore>, overrides: Partial<UsageSectionProps> = {}) {
  const props = {
    close: () => {},
    t: translate,
    useUsageSettings: bindSnapshotSelector(store.store),
    load: () => Promise.resolve(),
    setRange: (range: Parameters<typeof store.setRange>[0]) => { store.setRange(range) },
    setMetric: () => {},
    toggleSeries: () => {},
    loadBalance: () => Promise.resolve(),
    ...overrides,
  } as unknown as UsageSectionProps
  return render(<UsageSection {...props} />)
}

describe('the Usage settings section', () => {
  it('shows the range totals the Host answered with, cached traffic included', () => {
    renderSection(loadedStore(SUMMARY))
    // Scoped to the card: the chart legend and the table repeat the same number.
    expect(screen.getByText(en.totalTokens).parentElement?.textContent).toContain('1,050')
    expect(screen.getAllByText('1,050').length).toBeGreaterThan(0)
    expect(screen.getAllByText('900').length).toBeGreaterThan(0)
    expect(screen.getByText('90%')).toBeTruthy()
  })

  it('lists exactly the routes the Host reported, and nothing else', () => {
    renderSection(loadedStore(SUMMARY))
    expect(screen.getAllByText('deepseek-v4-flash').length).toBeGreaterThan(0)
    expect(screen.getAllByText('deepseek-v4-pro').length).toBeGreaterThan(0)
    expect(screen.queryByText('deepseek-v4-flash-vision-exp')).toBeNull()
  })

  it('shows an em dash rather than 0% when the range sent no prompt traffic', () => {
    const outputOnly: UsageSummaryView = {
      hours: [{
        hour: '2026-01-05T10',
        buckets: { ...BUCKETS, uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 7 },
        routes: [{ provider: 'deepseek-official', model: 'deepseek-v4-flash', buckets: { ...BUCKETS, uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 7 } }],
      }],
      models: [{ provider: 'deepseek-official', model: 'deepseek-v4-flash', buckets: { ...BUCKETS, uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 7 } }],
      accountedSessions: 1,
      unaccountedSessions: 0,
    }
    renderSection(loadedStore(outputOnly))
    expect(screen.getByText('\u2014')).toBeTruthy()
  })

  it('surfaces sessions the totals leave out instead of presenting them as complete', () => {
    renderSection(loadedStore({ ...SUMMARY, unaccountedSessions: 4 }))
    expect(screen.getByRole('status').textContent).toContain('4')
  })

  it('says so when the range recorded nothing, rather than drawing an empty table', () => {
    renderSection(loadedStore({ hours: [], models: [], accountedSessions: 0, unaccountedSessions: 0 }))
    // The chart and the table each report the empty window in their own way.
    expect(screen.getAllByText(en.noUsage).length).toBeGreaterThan(0)
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('reports a refused read with the Host\'s own diagnostic', () => {
    const store = createUsageSettingsStore(
      {
        loadSummary: () => Promise.resolve({ kind: 'refused', message: 'no usage ledger is mounted' }),
        loadBalance: () => Promise.resolve({ kind: 'refused', message: 'not scripted' }),
        loadHistory: () => Promise.resolve({ kind: 'refused', message: 'not scripted' }),
      },
      () => NOW,
    )
    store.store.set({
      status: 'error',
      range: '7d',
      summary: null,
      error: 'no usage ledger is mounted',
      metric: 'total',
      hidden: [],
      balance: { status: 'idle', snapshot: null, error: null },
      spend: { status: 'idle', series: [], error: null },
    })
    renderSection(store)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(en.loadFailed)
    expect(alert.textContent).toContain('no usage ledger is mounted')
  })

  it('draws one line per plotted series, and none for a hidden one', () => {
    const visible = renderSection(loadedStore(SUMMARY))
    expect(visible.container.querySelectorAll('polyline')).toHaveLength(2)
    cleanup()

    const store = loadedStore(SUMMARY)
    store.store.set({ ...store.store.getSnapshot(), hidden: ['deepseek-official/deepseek-v4-pro'] })
    const partlyHidden = renderSection(store)
    expect(partlyHidden.container.querySelectorAll('polyline')).toHaveLength(1)
  })

  it('toggles the series whose legend entry the reader clicks', () => {
    const toggleSeries = vi.fn()
    renderSection(loadedStore(SUMMARY), { toggleSeries } as Partial<UsageSectionProps>)
    // The table cell carries the same text, so the legend entry is addressed by
    // its role rather than by text.
    const entry = screen.getByRole('button', { name: /deepseek-v4-pro/ })
    fireEvent.click(entry)
    expect(toggleSeries).toHaveBeenCalledWith('deepseek-official/deepseek-v4-pro')
  })

  it('marks a hidden series in its legend entry', () => {
    const store = loadedStore(SUMMARY)
    store.store.set({ ...store.store.getSnapshot(), hidden: ['deepseek-official/deepseek-v4-pro'] })
    renderSection(store)
    expect(screen.getByRole('button', { name: /deepseek-v4-pro/ }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: /deepseek-v4-flash/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('reads once when the section first renders', () => {
    const load = vi.fn(() => Promise.resolve())
    renderSection(loadedStore(SUMMARY), { load } as Partial<UsageSectionProps>)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('draws one bar per day of spend and reports the range totals', () => {
    const store = loadedStore(SUMMARY)
    store.store.set({
      ...store.store.getSnapshot(),
      spend: {
        status: 'ready',
        series: [{
          currency: 'CNY',
          days: [
            { day: '2026-01-05', spendMinor: 1_000, topUpMinor: 0 },
            { day: '2026-01-06', spendMinor: 0, topUpMinor: 0 },
            { day: '2026-01-07', spendMinor: 2_500, topUpMinor: 5_000 },
          ],
          spendMinor: 3_500,
          topUpMinor: 5_000,
          max: 2_500,
        }],
        error: null,
      },
    })
    const { container } = renderSection(store)
    expect(container.querySelectorAll('rect')).toHaveLength(3)
    expect(screen.getByText(en.spendTotal + ' ' + formatMoney(3_500, 'CNY'))).toBeTruthy()
    expect(screen.getByText(en.spendTopUps + ' ' + formatMoney(5_000, 'CNY'))).toBeTruthy()
  })

  it('says the curve needs more readings rather than drawing a flat zero', () => {
    const store = loadedStore(SUMMARY)
    store.store.set({ ...store.store.getSnapshot(), spend: { status: 'ready', series: [], error: null } })
    renderSection(store)
    expect(screen.getByText(en.spendEmpty)).toBeTruthy()
  })

  it('reports a refused history read without taking the token figures down', () => {
    const store = loadedStore(SUMMARY)
    store.store.set({
      ...store.store.getSnapshot(),
      spend: { status: 'error', series: [], error: 'no balance ledger is mounted' },
    })
    renderSection(store)
    const alerts = screen.getAllByRole('alert').map(node => node.textContent ?? '')
    expect(alerts.some(text => text.includes(en.spendFailed))).toBe(true)
    expect(screen.getByText(en.totalTokens)).toBeTruthy()
  })

  it('reads the balance separately from the token summary', () => {
    const loadBalance = vi.fn(() => Promise.resolve())
    renderSection(loadedStore(SUMMARY), { loadBalance } as Partial<UsageSectionProps>)
    expect(loadBalance).toHaveBeenCalledTimes(1)
  })

  it('shows the account balance the provider reported, per currency', () => {
    const store = loadedStore(SUMMARY)
    store.store.set({
      ...store.store.getSnapshot(),
      balance: {
        status: 'ready',
        snapshot: {
          available: true,
          readAt: Date.UTC(2026, 0, 5, 10),
          lines: [
            { currency: 'CNY', totalMinor: 11_000, grantedMinor: 1_000, toppedUpMinor: 10_000 },
            { currency: 'USD', totalMinor: 250, grantedMinor: 50, toppedUpMinor: 200 },
          ],
        },
        error: null,
      },
    })
    renderSection(store)
    expect(screen.getByText('CNY ' + en.balanceTotal)).toBeTruthy()
    expect(screen.getByText('USD ' + en.balanceTotal)).toBeTruthy()
    expect(screen.getByText(en.balanceGranted + ' ' + formatMoney(1_000, 'CNY'))).toBeTruthy()
  })

  it('warns when the provider reports the account is out of balance', () => {
    const store = loadedStore(SUMMARY)
    store.store.set({
      ...store.store.getSnapshot(),
      balance: {
        status: 'ready',
        snapshot: {
          available: false,
          readAt: 0,
          lines: [{ currency: 'CNY', totalMinor: 0, grantedMinor: 0, toppedUpMinor: 0 }],
        },
        error: null,
      },
    })
    renderSection(store)
    expect(screen.getByText(en.balanceUnavailable)).toBeTruthy()
  })

  it('reports a refused balance read without taking the token figures down', () => {
    const store = loadedStore(SUMMARY)
    store.store.set({
      ...store.store.getSnapshot(),
      balance: { status: 'error', snapshot: null, error: 'does not serve the balance API' },
    })
    renderSection(store)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain(en.balanceFailed)
    expect(alert.textContent).toContain('does not serve the balance API')
    // The token page is still fully rendered above it.
    expect(screen.getByText(en.totalTokens)).toBeTruthy()
  })

  it('keeps the last balance on screen when a later read fails', () => {
    const store = loadedStore(SUMMARY)
    store.store.set({
      ...store.store.getSnapshot(),
      balance: {
        status: 'error',
        snapshot: {
          available: true,
          readAt: 0,
          lines: [{ currency: 'CNY', totalMinor: 11_000, grantedMinor: 0, toppedUpMinor: 11_000 }],
        },
        error: 'offline',
      },
    })
    renderSection(store)
    expect(screen.getByText('CNY ' + en.balanceTotal)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('offline')
  })

  it('asks for the range the reader picks', () => {
    const store = loadedStore(SUMMARY)
    const setRange = vi.fn()
    renderSection(store, { setRange } as Partial<UsageSectionProps>)
    fireEvent.click(screen.getByText(en.range30d))
    expect(setRange).toHaveBeenCalledWith('30d')
  })

  it('marks the selected range for assistive technology', () => {
    renderSection(loadedStore(SUMMARY))
    expect(screen.getByText(en.range7d).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(en.range30d).getAttribute('aria-pressed')).toBe('false')
  })
})
