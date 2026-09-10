/**
 * Balance-sample ledger (`ctx.balanceLedger`): keeps every reading of the
 * account balance, on a timer and on demand, so a spend can be recovered as the
 * difference between two readings.
 *
 * Why samples rather than a running spend total: the provider publishes no
 * spend figure at all. A balance is a level, and the only arithmetic that turns
 * levels into usage is subtraction — so the parties who can answer "what did
 * this cost" are the readings, kept in order. A rise between two readings is
 * never usage (usage only ever lowers a balance); it is a top-up, which is why
 * this package stores levels verbatim and leaves that classification to the
 * reader.
 *
 * Sampling lives in the host, not the page: a browser that only samples while
 * open would leave the curve full of holes exactly when nobody was looking.
 *
 * @module @deepseek-ai/dsh-balance-ledger
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: activates the `ctx.deepseekBalance` Context declaration.
import type {} from '@deepseek-ai/dsh-deepseek-balance'
import type { BalanceSnapshot } from '@deepseek-ai/dsh-deepseek-balance/types'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { assertQuery, samplesFor, withSample } from './samples.ts'
import { balanceLedgerDomainSpec } from './spec.ts'
import type { CurrencyLedger } from './spec.ts'
import type { BalanceHistory, BalanceHistoryQuery, BalanceSample } from './types.ts'

export { assertQuery, samplesFor, withSample } from './samples.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    balanceLedger: BalanceLedger
  }
}

/**
 * Plugin config. Both values are deployment choices: how often a reading is
 * worth the request, and how much history a deployment is willing to store.
 */
export interface Config {
  /** Interval between automatic readings, in milliseconds; `0` leaves sampling to explicit reads. */
  sampleIntervalMs: number
  /** Readings retained per currency. */
  retentionSamples: number
}

export const Config: z<Config> = z.object({
  sampleIntervalMs: z.natural().min(0).default(1_800_000),
  retentionSamples: z.natural().min(1).default(2_000),
})

/**
 * The balance-sample ledger. Opens the `deepseek_balance` domain at init,
 * records one reading per explicit request, and records one more on each
 * configured interval for as long as the process lives.
 */
export class BalanceLedger extends Service {
  static inject = ['storageDomain', 'deepseekBalance']

  static Config: z<Config> = Config

  private table?: KvTable<string, CurrencyLedger>

  /**
   * @param ctx - Cordis context carrying the storage facility and the reader.
   * @param config - validated plugin config.
   */
  constructor(ctx: Context, public config: Config) {
    super(ctx, 'balanceLedger')
  }

  /** Open the domain and start the sampling timer. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(balanceLedgerDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'balanceLedger.domainClose')
    this.table = domain.table('currencies')
    if (this.config.sampleIntervalMs > 0) {
      // A raw interval the sampler itself unrefs: a background reading must
      // never be the reason a one-shot CLI run fails to exit.
      const timer = setInterval(
        () => { void this.sampleQuietly() },
        this.config.sampleIntervalMs,
      )
      timer.unref()
      this.ctx.effect(() => () => clearInterval(timer), 'balanceLedger.interval')
    }
  }

  /**
   * Read the account balance and record the reading.
   *
   * Recording is part of reading, not a separate step: a reading nobody kept
   * cannot participate in any later difference, so a caller that only ever read
   * would produce a curve with a hole exactly where it looked.
   *
   * @param signal - caller cancellation.
   * @returns the reading that was recorded.
   * @throws BalanceError when the read fails; nothing is recorded in that case.
   */
  async sample(signal?: AbortSignal): Promise<BalanceSnapshot> {
    const snapshot = await this.ctx.deepseekBalance.read(signal)
    await this.record(snapshot)
    return snapshot
  }

  /**
   * Read the readings a window needs, per currency.
   * @param query - the window to cover, in Unix epoch milliseconds.
   * @returns one entry per currency with a usable baseline, ascending by code.
   * @throws RangeError when the window is not a valid range.
   */
  history(query: BalanceHistoryQuery): BalanceHistory {
    assertQuery(query)
    const table = this.table
    if (table === undefined) return { currencies: [] }
    const currencies = []
    for (const [currency, ledger] of table.entries()) {
      const samples = samplesFor(ledger.samples, query)
      // One lone reading is a baseline with nothing to compare against; a
      // series with no baseline cannot measure its own first interval.
      if (samples.length < 2) continue
      currencies.push({ currency, samples })
    }
    currencies.sort((left, right) => left.currency.localeCompare(right.currency))
    return { currencies }
  }

  /** Read and record on the timer, logging rather than throwing into the timer. */
  private async sampleQuietly(): Promise<void> {
    try {
      await this.sample()
    } catch (error: unknown) {
      this.ctx.logger.warn('balance ledger: scheduled reading failed (the curve keeps its earlier points): %s', String(error))
    }
  }

  /** Append one reading to every currency it reported. */
  private async record(snapshot: BalanceSnapshot): Promise<void> {
    const table = this.table
    if (table === undefined) return
    for (const line of snapshot.lines) {
      const sample: BalanceSample = {
        readAt: snapshot.readAt,
        totalMinor: line.totalMinor,
        grantedMinor: line.grantedMinor,
        toppedUpMinor: line.toppedUpMinor,
      }
      const current = table.get(line.currency)?.samples ?? []
      await table.put(line.currency, { samples: withSample(current, sample, this.config.retentionSamples) })
    }
  }
}

export default BalanceLedger
