import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { BalanceError } from '@deepseek-ai/dsh-deepseek-balance'
import type { BalanceSnapshot } from '@deepseek-ai/dsh-deepseek-balance/types'
import type { BalanceHistory, BalanceHistoryQuery, BalanceSample } from '@deepseek-ai/dsh-balance-ledger/types'
import { remoteErrorOf, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import UsageController from '../src/index.ts'

const SNAPSHOT: BalanceSnapshot = {
  available: true,
  lines: [{ currency: 'CNY', totalMinor: 11_000, grantedMinor: 1_000, toppedUpMinor: 10_000 }],
  readAt: 1_767_600_000_000,
}

const SAMPLE: BalanceSample = { readAt: 1_767_600_000_000, totalMinor: 11_000, grantedMinor: 1_000, toppedUpMinor: 10_000 }

/** The reader stand-in, recording how it was asked. */
class RecordingBalance extends Service {
  readonly signals: (AbortSignal | undefined)[] = []

  constructor(ctx: Context, private readonly outcome: 'snapshot' | 'unauthorized') {
    super(ctx, 'deepseekBalance')
  }

  read(signal?: AbortSignal): Promise<BalanceSnapshot> {
    this.signals.push(signal)
    if (this.outcome === 'unauthorized') {
      return Promise.reject(new BalanceError('DeepSeek rejected the API key (HTTP 401)', 'UNAUTHORIZED'))
    }
    return Promise.resolve(SNAPSHOT)
  }
}

/** The ledger stand-in: samples through the reader, and answers one history. */
class RecordingLedger extends Service {
  readonly windows: BalanceHistoryQuery[] = []

  constructor(ctx: Context, private readonly currency: string | undefined) {
    super(ctx, 'balanceLedger')
  }

  sample(): Promise<BalanceSnapshot> {
    return Promise.resolve(SNAPSHOT)
  }

  history(query: BalanceHistoryQuery): BalanceHistory {
    this.windows.push(query)
    return this.currency === undefined
      ? { currencies: [] }
      : { currencies: [{ currency: this.currency, samples: [SAMPLE] }] }
  }
}

/** Boot the controller over whichever stand-ins a case needs. */
async function boot(options: {
  reader?: 'snapshot' | 'unauthorized'
  ledger?: string | undefined
  withLedger?: boolean
} = {}): Promise<Context> {
  const ctx = new Context()
  if (options.reader !== undefined) await ctx.plugin(RecordingBalance, options.reader)
  if (options.withLedger === true) await ctx.plugin(RecordingLedger, options.ledger)
  await ctx.plugin(UsageController)
  return ctx
}

/** Run one call and return whatever it threw. */
async function failureOf(call: () => unknown): Promise<unknown> {
  try { await call() } catch (error: unknown) { return error }
  return undefined
}

describe('the account balance the usage namespace exposes', () => {
  it('publishes both balance methods from the usage namespace', async () => {
    const ctx = await boot({ reader: 'snapshot' })
    expect(remoteMethods(ctx.usageController)).toEqual([
      { method: 'summary', invocation: { kind: 'direct' } },
      { method: 'remoteBalance', exportName: 'balance', invocation: { kind: 'direct' } },
      { method: 'remoteBalanceHistory', exportName: 'balanceHistory', invocation: { kind: 'direct' } },
    ])
  })

  it('reports the actionable diagnostic while no reader is mounted', async () => {
    const ctx = await boot()
    const failure = await failureOf(() => ctx.usageController.remoteBalance(new AbortController().signal))
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'usage/balance-unavailable',
      message: 'no balance reader is mounted in this composition',
      details: { reason: 'deepseek-balance-unmounted' },
    })
  })

  it('returns the snapshot the reader produced when no ledger is mounted', async () => {
    const ctx = await boot({ reader: 'snapshot' })
    await expect(ctx.usageController.remoteBalance(new AbortController().signal)).resolves.toEqual(SNAPSHOT)
  })

  it('routes the read through the ledger, so the reading is kept', async () => {
    // The curve is built from readings; a read that bypassed the ledger would
    // leave a hole exactly where the page looked.
    const ctx = await boot({ reader: 'snapshot', withLedger: true, ledger: 'CNY' })
    await expect(ctx.usageController.remoteBalance(new AbortController().signal)).resolves.toEqual(SNAPSHOT)
  })

  it('carries the provider-side code when the read fails', async () => {
    const ctx = await boot({ reader: 'unauthorized' })
    const failure = await failureOf(() => ctx.usageController.remoteBalance(new AbortController().signal))
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'usage/balance-failed',
      message: 'DeepSeek rejected the API key (HTTP 401)',
      details: { reason: 'UNAUTHORIZED' },
    })
  })

  it('still reports a failure whose error is not a balance error', async () => {
    class OddBalance extends Service {
      constructor(ctx: Context) { super(ctx, 'deepseekBalance') }
      read(): Promise<BalanceSnapshot> { return Promise.reject('not an error object') }
    }
    const ctx = new Context()
    await ctx.plugin(OddBalance)
    await ctx.plugin(UsageController)
    const failure = await failureOf(() => ctx.usageController.remoteBalance(new AbortController().signal))
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'usage/balance-failed',
      message: 'not an error object',
      details: { reason: 'UNKNOWN' },
    })
  })
})

describe('the balance history the usage namespace exposes', () => {
  const WINDOW = { sinceMs: Date.UTC(2026, 0, 5), untilMs: Date.UTC(2026, 0, 6) }

  it('says why there is no history when no ledger is mounted', async () => {
    const ctx = await boot()
    const failure = await failureOf(() => ctx.usageController.remoteBalanceHistory(WINDOW, new AbortController().signal))
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'usage/history-unavailable',
      details: { reason: 'balance-ledger-unmounted' },
    })
  })

  it('returns the readings the ledger selected', async () => {
    const ctx = await boot({ withLedger: true, ledger: 'CNY' })
    expect(ctx.usageController.remoteBalanceHistory(WINDOW, new AbortController().signal))
      .toEqual({ currencies: [{ currency: 'CNY', samples: [SAMPLE] }] })
  })

  it('refuses a window that cannot describe a range', async () => {
    const ctx = await boot({ withLedger: true, ledger: 'CNY' })
    const cases: readonly unknown[] = [
      { sinceMs: 'yesterday', untilMs: WINDOW.untilMs },
      { sinceMs: WINDOW.untilMs, untilMs: WINDOW.sinceMs },
      { sinceMs: WINDOW.sinceMs + 0.5, untilMs: WINDOW.untilMs },
    ]
    for (const request of cases) {
      const failure = await failureOf(
        () => ctx.usageController.remoteBalanceHistory(request as never, new AbortController().signal),
      )
      expect(remoteErrorOf(failure)?.code).toBe('usage/bad-window')
    }
  })

  it('reports an already-cancelled call instead of reading', async () => {
    const ctx = await boot({ withLedger: true, ledger: 'CNY' })
    const controller = new AbortController()
    controller.abort()
    await expect(
      Promise.resolve().then(() => ctx.usageController.remoteBalanceHistory(WINDOW, controller.signal)),
    ).rejects.toThrow()
  })
})
