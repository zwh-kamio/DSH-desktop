import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { BalanceError } from '@deepseek-ai/dsh-deepseek-balance'
import type { BalanceSnapshot } from '@deepseek-ai/dsh-deepseek-balance/types'
import BalanceLedger from '../src/index.ts'
import type { Config } from '../src/index.ts'

/** A test-local stand-in for the storage facility the ledger opens domains on. */
class MemoryStorage extends Service {
  private readonly units = new Map<string, Map<string, unknown>>()

  constructor(ctx: Context) {
    super(ctx, 'storageDomain')
  }

  async open(spec: { name: string; tables: Record<string, unknown> }): Promise<unknown> {
    const unit = this.units.get(spec.name) ?? new Map<string, unknown>()
    this.units.set(spec.name, unit)
    const tables = new Map<string, Map<string, unknown>>()
    for (const name of Object.keys(spec.tables)) tables.set(name, unit)
    return {
      name: spec.name,
      table: (name: string) => {
        const store = tables.get(name) ?? new Map<string, unknown>()
        return {
          get: (key: string) => store.get(key),
          keys: () => store.keys(),
          entries: () => store.entries(),
          size: store.size,
          put: (key: string, value: unknown) => { store.set(key, value); return Promise.resolve() },
          delete: (key: string) => Promise.resolve(store.delete(key)),
          update: (key: string, fn: (current: unknown) => unknown) => {
            const next = fn(store.get(key))
            store.set(key, next)
            return Promise.resolve(next)
          },
        }
      },
      close: () => Promise.resolve(),
    }
  }
}

/** A reader answering one scripted line, or failing. */
class ScriptedReader extends Service {
  readonly reads: (AbortSignal | undefined)[] = []

  constructor(ctx: Context, private readonly value: 'ok' | 'fail') {
    super(ctx, 'deepseekBalance')
  }

  read(signal?: AbortSignal): Promise<BalanceSnapshot> {
    this.reads.push(signal)
    if (this.value === 'fail') {
      return Promise.reject(new BalanceError('the endpoint answered 500', 'HTTP_ERROR'))
    }
    return Promise.resolve({
      available: true,
      readAt: Date.now(),
      lines: [{ currency: 'CNY', totalMinor: 11_000, grantedMinor: 1_000, toppedUpMinor: 10_000 }],
    })
  }
}

/** Boot the ledger over a scripted reader. */
async function boot(value: 'ok' | 'fail' = 'ok', config: Partial<Config> = {}): Promise<{
  ctx: Context
  ledger: BalanceLedger
  reader: ScriptedReader
}> {
  const ctx = new Context()
  await ctx.plugin(MemoryStorage)
  await ctx.plugin(ScriptedReader, value)
  await ctx.plugin(BalanceLedger, { sampleIntervalMs: 0, retentionSamples: 10, ...config } as Config)
  return { ctx, ledger: ctx.balanceLedger, reader: (ctx as unknown as { deepseekBalance: ScriptedReader }).deepseekBalance }
}

describe('recording a reading', () => {
  it('records every currency the provider reported', async () => {
    const { ledger } = await boot()
    const snapshot = await ledger.sample()
    const history = ledger.history({ sinceMs: 0, untilMs: Date.now() + 1 })
    expect(snapshot.lines).toHaveLength(1)
    // One reading is a baseline with nothing to compare against, so the window
    // legitimately reports nothing yet.
    expect(history.currencies).toEqual([])
  })

  it('never records a failed read', async () => {
    const { ledger } = await boot('fail')
    await expect(ledger.sample()).rejects.toBeInstanceOf(BalanceError)
    expect(ledger.history({ sinceMs: 0, untilMs: Date.now() + 1 }).currencies).toEqual([])
  })

  it('hands back a window with its baseline, so an interval can be measured', async () => {
    const { ledger } = await boot()
    await ledger.sample()
    await new Promise(resolve => setTimeout(resolve, 5))
    await ledger.sample()
    const history = ledger.history({ sinceMs: 0, untilMs: Date.now() + 1 })
    expect(history.currencies.map(entry => entry.currency)).toEqual(['CNY'])
    expect(history.currencies[0]?.samples.length).toBe(2)
  })

  it('rejects an inverted window', async () => {
    const { ledger } = await boot()
    expect(() => ledger.history({ sinceMs: 10, untilMs: 5 })).toThrow(RangeError)
  })

  it('passes the caller\'s cancellation to the reader', async () => {
    const { ledger, reader } = await boot()
    const controller = new AbortController()
    await ledger.sample(controller.signal)
    expect(reader.reads[0]).toBe(controller.signal)
  })
})

describe('opening the domain', () => {
  it('declares and opens the domain the composition stores it by', async () => {
    const { balanceLedgerDomainSpec } = await import('../src/spec.ts')
    const ctx = new Context()
    await ctx.plugin(MemoryStorage)
    await ctx.plugin(ScriptedReader, 'ok')
    const opened = await ctx.storageDomain.open(balanceLedgerDomainSpec)
    expect((opened as { name: string }).name).toBe('deepseek_balance')
    expect(Object.keys(balanceLedgerDomainSpec.tables)).toEqual(['currencies'])
  })
})
