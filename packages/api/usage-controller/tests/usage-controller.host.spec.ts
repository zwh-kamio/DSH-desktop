import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { remoteErrorOf, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import type { UsageLedgerQuery, UsageLedgerSummary } from '@deepseek-ai/dsh-usage-ledger/types'
import UsageController from '../src/index.ts'

const WINDOW = { sinceMs: Date.UTC(2026, 0, 5), untilMs: Date.UTC(2026, 0, 6) }

/** What a recording ledger is asked to answer, and where it reports the ask. */
interface RecordingOptions {
  readonly answer: UsageLedgerSummary
  readonly calls: UsageLedgerQuery[]
}

/**
 * A ledger stand-in that records the window it was asked for.
 *
 * The caller owns the array the stub writes into, so an assertion reads what
 * was asked without the stub having to hand out its own instance.
 */
class RecordingLedger extends Service {
  constructor(ctx: Context, private readonly options: RecordingOptions) {
    super(ctx, 'usageLedger')
  }

  summary(query: UsageLedgerQuery): Promise<UsageLedgerSummary> {
    this.options.calls.push(query)
    return Promise.resolve(this.options.answer)
  }
}

const EMPTY: UsageLedgerSummary = { hours: [], models: [], accountedSessions: 0, unaccountedSessions: 0 }

/** Boot the controller alone, exercising the unmounted-ledger path. */
async function bootAlone(): Promise<UsageController> {
  const ctx = new Context()
  await ctx.plugin(UsageController)
  return ctx.usageController
}

/** Boot the controller over a recording ledger. */
async function bootWithLedger(
  answer: UsageLedgerSummary = EMPTY,
): Promise<{ controller: UsageController; calls: UsageLedgerQuery[] }> {
  const calls: UsageLedgerQuery[] = []
  const ctx = new Context()
  await ctx.plugin(RecordingLedger, { answer, calls })
  await ctx.plugin(UsageController)
  return { controller: ctx.usageController, calls }
}

/** Call a remote method whose failure is the assertion. */
async function failureOf(call: () => Promise<unknown>): Promise<unknown> {
  return await call().catch((error: unknown) => error)
}

describe('the usage Remote namespace a settings page calls', () => {
  it('publishes the usage namespace from its own service key', async () => {
    const controller = await bootAlone()
    const binding = controller.typertRemote
    expect(binding.serviceKey).toBe('usageController')
    expect(binding.namespace).toBe('usage')
    // The exhaustive surface belongs to the balance spec, which also covers the
    // methods added beside this one; here the namespace only has to exist.
    expect(remoteMethods(controller).map(entry => entry.method)).toContain('summary')
  })

  it('reports the actionable diagnostic while no ledger is mounted', async () => {
    const controller = await bootAlone()
    const failure = await failureOf(() => controller.summary(WINDOW, new AbortController().signal))
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'usage/summary-failed',
      message: 'no usage ledger is mounted in this composition',
      details: { reason: 'usage-ledger-unmounted' },
    })
  })

  it('hands the decoded window to the ledger and returns its summary unchanged', async () => {
    const answer: UsageLedgerSummary = {
      hours: [{
        hour: '2026-01-05T10',
        buckets: { uncachedInputTokens: 3, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        routes: [{ provider: 'deepseek-official', model: 'deepseek-v4-flash', buckets: { uncachedInputTokens: 3, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }],
      }],
      models: [{ provider: 'deepseek-official', model: 'deepseek-v4-flash', buckets: { uncachedInputTokens: 3, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }],
      accountedSessions: 2,
      unaccountedSessions: 1,
    }
    const { controller, calls } = await bootWithLedger(answer)
    await expect(controller.summary(WINDOW, new AbortController().signal)).resolves.toEqual(answer)
    expect(calls).toEqual([WINDOW])
  })

  it('rejects a window that cannot describe a range instead of answering with nothing', async () => {
    const { controller } = await bootWithLedger()
    const cases: readonly unknown[] = [
      { sinceMs: 'yesterday', untilMs: WINDOW.untilMs },
      { sinceMs: WINDOW.sinceMs, untilMs: undefined },
      { sinceMs: WINDOW.untilMs, untilMs: WINDOW.sinceMs },
      { sinceMs: WINDOW.sinceMs + 0.5, untilMs: WINDOW.untilMs },
      { sinceMs: WINDOW.sinceMs, untilMs: Number.MAX_SAFE_INTEGER + 2 },
      { sinceMs: WINDOW.sinceMs, untilMs: WINDOW.untilMs, extra: true },
    ]
    for (const request of cases) {
      const failure = await failureOf(
        () => controller.summary(request as never, new AbortController().signal),
      )
      expect(remoteErrorOf(failure)?.code).toBe('usage/bad-window')
    }
  })

  it('names the bounds the caller actually sent when it refuses a window', async () => {
    const { controller } = await bootWithLedger()
    const failure = await failureOf(
      () => controller.summary({ sinceMs: 10, untilMs: 4 }, new AbortController().signal),
    )
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'usage/bad-window',
      details: { sinceMs: 10, untilMs: 4 },
    })
  })

  it('classifies a ledger read failure as a summary failure with its own cause', async () => {
    class FailingLedger extends Service {
      constructor(ctx: Context) {
        super(ctx, 'usageLedger')
      }

      summary(): Promise<UsageLedgerSummary> {
        return Promise.reject(new Error('the corpus listing was interrupted'))
      }
    }
    const ctx = new Context()
    await ctx.plugin(FailingLedger)
    await ctx.plugin(UsageController)
    const failure = await failureOf(
      () => ctx.usageController.summary(WINDOW, new AbortController().signal),
    )
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'usage/summary-failed',
      message: 'the corpus listing was interrupted',
      details: { reason: 'ledger-read-failed' },
    })
  })
})
