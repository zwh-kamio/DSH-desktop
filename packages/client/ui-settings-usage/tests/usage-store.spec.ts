import { describe, expect, it } from 'vitest'
import type { UsageSummaryView } from '@deepseek-ai/dsh-api-usage-controller/types'
import { createUsageSettingsStore, rangeWindow } from '../src/client/usage-store.ts'
import type { UsageOperations, UsageSummaryOutcome, UsageWindow } from '../src/client/operations.ts'

/** 2026-01-05 at 15:30 in the machine's own zone. */
const NOW = new Date(2026, 0, 5, 15, 30, 0, 0).getTime()

const EMPTY: UsageSummaryView = { hours: [], models: [], accountedSessions: 0, unaccountedSessions: 0 }

/**
 * Host callbacks with the balance read stubbed out.
 *
 * These cases are about the token summary, so the balance read is scripted once
 * here rather than restated in every literal.
 * @param loadSummary - the summary read under test.
 * @param loadBalance - the balance read, when a case scripts one.
 * @returns the complete operations face.
 */
function hostOperations(
  loadSummary: UsageOperations['loadSummary'],
  loadBalance: UsageOperations['loadBalance'] = () => Promise.resolve({ kind: 'refused', message: 'not scripted' }),
  loadHistory: UsageOperations['loadHistory'] = () => Promise.resolve({ kind: 'refused', message: 'not scripted' }),
): UsageOperations {
  return { loadSummary, loadBalance, loadHistory }
}

/** One resolvable read, so a test can hold an answer open across a range switch. */
function pending() {
  let settle: (outcome: UsageSummaryOutcome) => void = () => {}
  const promise = new Promise<UsageSummaryOutcome>((resolve) => { settle = resolve })
  return { promise, settle }
}

describe('the usage range window', () => {
  it('starts at the reader\'s own midnight, not the host\'s UTC day', () => {
    const window = rangeWindow('7d', NOW)
    const start = new Date(window.sinceMs)
    expect(start.getHours()).toBe(0)
    expect(start.getMinutes()).toBe(0)
    expect(start.getDate()).toBe(30)
    expect(start.getMonth()).toBe(11)
    expect(window.untilMs).toBe(NOW)
  })

  it('spans the inclusive number of days the label promises', () => {
    const window = rangeWindow('30d', NOW)
    const days = Math.round((NOW - window.sinceMs) / 60_000) / 1_440
    expect(days).toBeGreaterThan(29)
    expect(days).toBeLessThan(30)
  })

  it('opens the whole range for all time', () => {
    expect(rangeWindow('all', NOW)).toEqual({ sinceMs: 0, untilMs: NOW })
  })
})

describe('the balance read', () => {
  it('publishes the snapshot the Host returned', async () => {
    const snapshot = {
      available: true,
      readAt: 1_767_600_000_000,
      lines: [{ currency: 'CNY', totalMinor: 11_000, grantedMinor: 0, toppedUpMinor: 11_000 }],
    }
    const operations = hostOperations(
      () => Promise.resolve({ kind: 'loaded', summary: EMPTY }),
      () => Promise.resolve({ kind: 'loaded', snapshot }),
    )
    const store = createUsageSettingsStore(operations, () => NOW)
    await store.loadBalance()
    expect(store.store.getSnapshot().balance).toEqual({ status: 'ready', snapshot, error: null })
  })

  it('keeps the last snapshot when a later read fails', async () => {
    const snapshot = {
      available: true,
      readAt: 1_767_600_000_000,
      lines: [{ currency: 'CNY', totalMinor: 11_000, grantedMinor: 0, toppedUpMinor: 11_000 }],
    }
    let fail = false
    const operations = hostOperations(
      () => Promise.resolve({ kind: 'loaded', summary: EMPTY }),
      () => fail
        ? Promise.resolve({ kind: 'refused', message: 'offline' })
        : Promise.resolve({ kind: 'loaded', snapshot }),
    )
    const store = createUsageSettingsStore(operations, () => NOW)
    await store.loadBalance()
    fail = true
    await store.loadBalance()
    expect(store.store.getSnapshot().balance).toEqual({ status: 'error', snapshot, error: 'offline' })
  })

  it('leaves the token summary alone', async () => {
    const operations = hostOperations(
      () => Promise.resolve({ kind: 'loaded', summary: EMPTY }),
      () => Promise.resolve({ kind: 'refused', message: 'no endpoint' }),
    )
    const store = createUsageSettingsStore(operations, () => NOW)
    await store.load()
    await store.loadBalance()
    expect(store.store.getSnapshot()).toMatchObject({ status: 'ready', summary: EMPTY })
  })
})

describe('the usage section store', () => {
  it('reads the selected range and publishes the Host answer', async () => {
    const calls: UsageWindow[] = []
    const operations = hostOperations((window) => {
      calls.push(window)
      return Promise.resolve({ kind: 'loaded', summary: EMPTY })
    })
    const store = createUsageSettingsStore(operations, () => NOW)
    await store.load()
    expect(calls).toEqual([rangeWindow('7d', NOW)])
    expect(store.store.getSnapshot()).toMatchObject({ status: 'ready', summary: EMPTY, range: '7d' })
  })

  it('reads the spend history for the same window as the token summary', async () => {
    const windows: { sinceMs: number; untilMs: number }[] = []
    const operations = hostOperations(
      () => Promise.resolve({ kind: 'loaded', summary: EMPTY }),
      undefined,
      (window) => {
        windows.push(window)
        return Promise.resolve({
          kind: 'loaded',
          history: {
            currencies: [{
              currency: 'CNY',
              samples: [
                { readAt: NOW - 60_000, totalMinor: 10_000, grantedMinor: 0, toppedUpMinor: 10_000 },
                { readAt: NOW, totalMinor: 9_000, grantedMinor: 0, toppedUpMinor: 9_000 },
              ],
            }],
          },
        })
      },
    )
    const store = createUsageSettingsStore(operations, () => NOW)
    await store.load()
    expect(windows).toEqual([rangeWindow('7d', NOW)])
    expect(store.store.getSnapshot().spend).toMatchObject({ status: 'ready' })
    expect(store.store.getSnapshot().spend.series[0]?.spendMinor).toBe(1_000)
  })

  it('publishes the Host diagnostic when the read is refused', async () => {
    const operations = hostOperations(
      () => Promise.resolve({ kind: 'refused', message: 'no usage ledger is mounted' }),
    )
    const store = createUsageSettingsStore(operations, () => NOW)
    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({
      status: 'error', error: 'no usage ledger is mounted', summary: null,
    })
  })

  it('reads the new range when the reader switches', async () => {
    const calls: UsageWindow[] = []
    const operations = hostOperations((window) => {
      calls.push(window)
      return Promise.resolve({ kind: 'loaded', summary: EMPTY })
    })
    const store = createUsageSettingsStore(operations, () => NOW)
    await store.load()
    store.setRange('30d')
    await Promise.resolve()
    expect(store.store.getSnapshot().range).toBe('30d')
    expect(calls[1]).toEqual(rangeWindow('30d', NOW))
  })

  it('ignores a range the reader is already on', async () => {
    const calls: UsageWindow[] = []
    const operations = hostOperations((window) => {
      calls.push(window)
      return Promise.resolve({ kind: 'loaded', summary: EMPTY })
    })
    const store = createUsageSettingsStore(operations, () => NOW)
    store.setRange('7d')
    expect(calls).toHaveLength(0)
  })

  it('never lets a slow earlier answer overwrite the range the reader moved to', async () => {
    const answers = [pending(), pending()]
    const calls: UsageWindow[] = []
    const operations = hostOperations((window) => {
      calls.push(window)
      const next = answers[calls.length - 1]
      if (next === undefined) throw new Error('unscripted read')
      return next.promise
    })
    const store = createUsageSettingsStore(operations, () => NOW)
    const first = store.load()
    store.setRange('30d')
    await Promise.resolve()

    const stale: UsageSummaryView = { ...EMPTY, accountedSessions: 99 }
    answers[0]?.settle({ kind: 'loaded', summary: stale })
    await first
    expect(store.store.getSnapshot().status).toBe('loading')

    answers[1]?.settle({ kind: 'loaded', summary: { ...EMPTY, accountedSessions: 1 } })
    await Promise.resolve()
    await Promise.resolve()
    expect(store.store.getSnapshot()).toMatchObject({
      status: 'ready', range: '30d', summary: { accountedSessions: 1 },
    })
  })
})
