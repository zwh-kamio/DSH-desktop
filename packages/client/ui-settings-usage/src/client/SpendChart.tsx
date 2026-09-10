/**
 * The spend curve: what the account actually paid over the selected range.
 *
 * This is not the token chart's figure. Tokens are what this harness sent;
 * money is what the account was charged, including work this harness never
 * did. The two are shown side by side precisely because they disagree.
 *
 * The curve is drawn from balance differences, so it can only exist where two
 * readings bracket some usage — an empty curve is a statement about sampling,
 * not about spending, and it says so rather than drawing a flat zero.
 */

import type { ReactNode } from 'react'
import { formatMoney } from './format.ts'
import type { SpendState } from './usage-store.ts'
import type { SpendSeries } from './spend-geometry.ts'
import type { UsageSectionProps } from './UsageSection.tsx'
import css from './UsageSection.module.css'

/** Drawing surface; the SVG scales to its container's width. */
const WIDTH = 720
const HEIGHT = 160
const PAD_LEFT = 56
const PAD_RIGHT = 12
const PAD_TOP = 12
const PAD_BOTTOM = 26

/** Props of the spend curve; every fact is derived by the caller. */
export interface SpendChartProps {
  /** The curve's own load state. */
  readonly state: SpendState
  /** Section translate seat. */
  readonly t: UsageSectionProps['t']
}

/** One currency's bars. */
function CurrencyBars({ series, t }: { series: SpendSeries; t: UsageSectionProps['t'] }): ReactNode {
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM
  const baseline = PAD_TOP + plotHeight
  const slot = plotWidth / series.days.length
  // A hair of the slot is left as gap, so adjacent days stay countable.
  const barWidth = Math.max(1, slot * 0.7)
  const heightOf = (value: number): number => series.max === 0 ? 0 : (value / series.max) * plotHeight
  const lastIndex = series.days.length - 1
  const labels = [0, Math.floor(lastIndex / 2), lastIndex]
    .filter((index, position, all) => index >= 0 && all.indexOf(index) === position)

  return (
    <>
      <svg
        className={css.svg}
        viewBox={'0 0 ' + String(WIDTH) + ' ' + String(HEIGHT)}
        role="img"
        aria-label={t('spendTitle') + ' ' + series.currency}
      >
        <line className={css.grid} x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={baseline} y2={baseline} />
        <text className={css.axisText} x={PAD_LEFT - 8} y={PAD_TOP + 4} textAnchor="end">
          {formatMoney(series.max, series.currency)}
        </text>
        <text className={css.axisText} x={PAD_LEFT - 8} y={baseline + 4} textAnchor="end">
          {formatMoney(0, series.currency)}
        </text>
        {series.days.map((entry, index) => {
          const height = heightOf(entry.spendMinor)
          return (
            <rect
              key={entry.day}
              className={css.bar}
              x={PAD_LEFT + slot * index + (slot - barWidth) / 2}
              y={baseline - height}
              width={barWidth}
              height={height}
            />
          )
        })}
        {labels.map(index => (
          <text
            key={index}
            className={css.axisText}
            x={PAD_LEFT + slot * index + slot / 2}
            y={baseline + 18}
            textAnchor="middle"
          >
            {(series.days[index]?.day ?? '').slice(5)}
          </text>
        ))}
      </svg>
      <p className={css.spendTotals}>
        <span>{series.currency}</span>
        <span>{t('spendTotal') + ' ' + formatMoney(series.spendMinor, series.currency)}</span>
        <span>{t('spendTopUps') + ' ' + formatMoney(series.topUpMinor, series.currency)}</span>
      </p>
    </>
  )
}

/**
 * Render the spend curve.
 * @param props - the curve's state and the translate seat.
 * @returns the curve, its totals, or the reason there is nothing to draw.
 */
export function SpendChart({ state, t }: SpendChartProps): ReactNode {
  return (
    <div className={css.spend}>
      {state.status === 'loading' && <p className={css.status}>{t('spendLoading')}</p>}
      {state.status === 'error' && (
        <p className={css.error} role="alert">
          {t('spendFailed') + ': ' + (state.error ?? '')}
        </p>
      )}
      {state.series.length === 0
        ? (state.status === 'ready' && <p className={css.status}>{t('spendEmpty')}</p>)
        : state.series.map(series => (
          <CurrencyBars key={series.currency} series={series} t={t} />
        ))}
      {state.series.length > 0 && <p className={css.asOf}>{t('spendNote')}</p>}
    </div>
  )
}
