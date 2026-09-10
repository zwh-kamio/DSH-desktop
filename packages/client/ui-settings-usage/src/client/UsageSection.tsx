/**
 * Usage settings section: what this harness spent, over a range the reader picks.
 *
 * The page renders one Host answer and nothing it computed itself: the totals,
 * the per-model rows, and the count of sessions still missing from them all
 * arrive from the usage/summary Remote, so the browser never disagrees with the
 * ledger about what was folded.
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { UsageBuckets, UsageModelBucket, UsageSummaryView } from '@deepseek-ai/dsh-api-usage-controller/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { BalanceCard } from './BalanceCard.tsx'
import { buildChart } from './chart-geometry.ts'
import type { UsageMetricId } from './chart-geometry.ts'
import { BUCKET_KEYS, cacheHitRate, formatTokens, totalTokens } from './format.ts'
import type { UsageBucketKey } from './format.ts'
import { ModelTokenChart } from './ModelTokenChart.tsx'
import { SpendChart } from './SpendChart.tsx'
import { METRICS, WINDOWS } from './ranges.ts'
import type { SpendState, UsageRangeId, UsageSettingsState } from './usage-store.ts'
import type { UsageKey } from './locales.ts'
import css from './UsageSection.module.css'

/** Registration-side business face for the Usage section. */
export interface UsageSectionInjected {
  hooks: {
    /** Page snapshot bound by the renderer as useUsageSettings. */
    usageSettings: SnapshotStore<UsageSettingsState>
  }
  /** Read the selected range; called once when the section first renders. */
  load: () => Promise<void>
  /** Select the range to read. */
  setRange: (range: UsageRangeId) => void
  /** Select the bucket the chart plots. */
  setMetric: (metric: UsageMetricId) => void
  /** Show or hide one chart series. */
  toggleSeries: (key: string) => void
  /** Read the account balance. */
  loadBalance: () => Promise<void>
}

/** Full component props. */
export type UsageSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.usage'>
  & InjectFace<UsageSectionInjected>

/** Copy key for each bucket's label, in the order the page lists them. */
const BUCKET_LABELS: Record<UsageBucketKey, UsageKey> = {
  uncachedInputTokens: 'uncachedInputTokens',
  cacheReadTokens: 'cacheReadTokens',
  cacheWriteTokens: 'cacheWriteTokens',
  outputTokens: 'outputTokens',
}

/** A zeroed bucket set. */
const ZERO: UsageBuckets = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

/**
 * Sum the hour buckets the Host returned into one bucket set.
 * @param hours - the summary's hour buckets, already clipped to the range.
 * @returns the range totals.
 */
function sumHours(hours: UsageSummaryView['hours']): UsageBuckets {
  return hours.reduce<UsageBuckets>((sum, entry) => ({
    uncachedInputTokens: sum.uncachedInputTokens + entry.buckets.uncachedInputTokens,
    outputTokens: sum.outputTokens + entry.buckets.outputTokens,
    cacheReadTokens: sum.cacheReadTokens + entry.buckets.cacheReadTokens,
    cacheWriteTokens: sum.cacheWriteTokens + entry.buckets.cacheWriteTokens,
  }), ZERO)
}

/** One totals card. */
function Card({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className={css.card}>
      <span className={css.cardLabel}>{label}</span>
      <span className={css.cardValue}>{value}</span>
    </div>
  )
}

/** The per-model table; routes with no usage in range never reach it. */
function ModelTable({ models, t }: { models: readonly UsageModelBucket[]; t: UsageSectionProps['t'] }): ReactNode {
  if (models.length === 0) return <p className={css.status}>{t('noUsage')}</p>
  return (
    <table className={css.table}>
      <thead>
        <tr>
          <th>{t('model')}</th>
          <th>{t('provider')}</th>
          <th className={css.numeric}>{t('tokens')}</th>
        </tr>
      </thead>
      <tbody>
        {models.map(model => (
          <tr key={model.provider + '/' + model.model}>
            <td className={css.model}>{model.model}</td>
            <td>{model.provider}</td>
            <td className={css.numeric}>{formatTokens(totalTokens(model.buckets))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The loaded page body. */
function Ready({
  summary, metric, hidden, toggleSeries, spend, t,
}: {
  summary: UsageSummaryView
  metric: UsageMetricId
  hidden: readonly string[]
  toggleSeries: (key: string) => void
  spend: SpendState
  t: UsageSectionProps['t']
}): ReactNode {
  const totals = sumHours(summary.hours)
  const rate = cacheHitRate(totals)
  return (
    <>
      <div className={css.cards}>
        <Card label={t('totalTokens')} value={formatTokens(totalTokens(totals))} />
        {BUCKET_KEYS.map(key => (
          <Card key={key} label={t(BUCKET_LABELS[key])} value={formatTokens(totals[key])} />
        ))}
        <Card label={t('cacheHitRate')} value={rate === null ? '\u2014' : rate + '%'} />
        <Card label={t('sessions')} value={formatTokens(summary.accountedSessions)} />
        <Card label={t('models')} value={formatTokens(summary.models.length)} />
      </div>
      {summary.unaccountedSessions > 0 && (
        <p className={css.notice} role="status">
          {t('unaccounted', { count: formatTokens(summary.unaccountedSessions) })}
        </p>
      )}
      <h3 className={css.groupTitle}>{t('spendTitle')}</h3>
      <p className={css.intro}>{t('spendIntro')}</p>
      <SpendChart state={spend} t={t} />
      <h3 className={css.groupTitle}>{t('chartTitle')}</h3>
      <ModelTokenChart
        chart={buildChart(summary, metric)}
        hidden={hidden}
        toggleSeries={toggleSeries}
        t={t}
      />
      <h3 className={css.groupTitle}>{t('byModel')}</h3>
      <ModelTable models={summary.models} t={t} />
    </>
  )
}

/**
 * Render the Usage section.
 * @param props - the four derived shares plus this section's injected face.
 * @returns the section body.
 */
export function UsageSection(props: UsageSectionProps): ReactNode {
  const { useUsageSettings, t, load, setRange, setMetric, toggleSeries, loadBalance } = props
  const state = useUsageSettings(snapshot => snapshot)

  // The token summary and the balance are independent reads: a deployment with
  // no balance endpoint must not delay or fail the figures above it.
  useEffect(() => {
    void load()
    void loadBalance()
  }, [load, loadBalance])

  return (
    <div className={css.section}>
      <header className={css.header}>
        <h2 className={css.title}>{t('title')}</h2>
        <p className={css.intro}>{t('intro')}</p>
      </header>
      <div className={css.rangeRow}>
        <span className={css.rangeLabel}>{t('range')}</span>
        {WINDOWS.map(window => (
          <button
            key={window.id}
            type="button"
            aria-pressed={state.range === window.id}
            className={state.range === window.id
              ? [css.rangeButton, css.rangeButtonActive].join(' ')
              : css.rangeButton}
            onClick={() => { setRange(window.id) }}
          >
            {t(window.label)}
          </button>
        ))}
      </div>
      <h3 className={css.groupTitle}>{t('balanceTitle')}</h3>
      <p className={css.intro}>{t('balanceIntro')}</p>
      <BalanceCard state={state.balance} t={t} />
      {state.status === 'loading' && <p className={css.status}>{t('loading')}</p>}
      {state.status === 'error' && (
        <p className={css.error} role="alert">
          {t('loadFailed') + ': ' + (state.error ?? '')}
        </p>
      )}
      {state.status === 'ready' && state.summary !== null && (
        <>
          <div className={css.rangeRow}>
            <span className={css.rangeLabel}>{t('metric')}</span>
            {METRICS.map(entry => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={state.metric === entry.id}
                className={state.metric === entry.id
                  ? [css.rangeButton, css.rangeButtonActive].join(' ')
                  : css.rangeButton}
                onClick={() => { setMetric(entry.id) }}
              >
                {t(entry.label)}
              </button>
            ))}
          </div>
          <Ready
            summary={state.summary}
            metric={state.metric}
            hidden={state.hidden}
            toggleSeries={toggleSeries}
            spend={state.spend}
            t={t}
          />
        </>
      )}
    </div>
  )
}
