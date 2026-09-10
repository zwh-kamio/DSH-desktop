/**
 * One line per model over the selected range, drawn as inline SVG.
 *
 * The component holds no state and computes nothing: the geometry arrives from
 * chart-geometry, and the two things a reader controls — which bucket is
 * plotted, and which series are visible — live in the section's store. It owns
 * no palette either; each slot names a theme token through a CSS Module class,
 * so light and dark choose their own legibility.
 */

import { Fragment } from 'react'
import type { ReactNode } from 'react'
import type { UsageChart, UsageSeries } from './chart-geometry.ts'
import { formatTokens } from './format.ts'
import type { UsageKey } from './locales.ts'
import css from './ModelTokenChart.module.css'

/** Drawing surface; the SVG scales to its container's width. */
const WIDTH = 720
const HEIGHT = 200
const PAD_LEFT = 56
const PAD_RIGHT = 12
const PAD_TOP = 12
const PAD_BOTTOM = 26

/** Stroke class per palette slot; index -1 is the merged tail. */
const STROKE = [
  css.stroke0, css.stroke1, css.stroke2, css.stroke3,
  css.stroke4, css.stroke5, css.stroke6, css.stroke7,
] as const

/** Legend swatch class per palette slot. */
const SWATCH = [
  css.swatch0, css.swatch1, css.swatch2, css.swatch3,
  css.swatch4, css.swatch5, css.swatch6, css.swatch7,
] as const

/**
 * The stroke class one series draws with.
 *
 * The CSS Module lookup is index-typed, so an unknown class reads as absent
 * rather than as an empty string; `className` accepts the absence directly,
 * which keeps a typo from silently drawing an invisible line.
 */
function strokeOf(series: UsageSeries): string | undefined {
  if (series.slot < 0) return css.strokeOther
  return STROKE[series.slot] ?? css.strokeOther
}

/** The swatch class one series' legend entry wears; see {@link strokeOf}. */
function swatchOf(series: UsageSeries): string | undefined {
  if (series.slot < 0) return css.swatchOther
  return SWATCH[series.slot] ?? css.swatchOther
}

/** The model id an entry names, or the merged tail's own label. */
function labelOf(series: UsageSeries, t: (key: UsageKey) => string): string {
  return series.model === '' ? t('otherSeries') : series.model
}

/** A short day label: month and day, which is all a chart axis has room for. */
function shortDay(day: string): string {
  return day.slice(5)
}

/** Chart props; every fact is derived by the caller. */
export interface ModelTokenChartProps {
  /** Folded geometry for the selected range and metric. */
  readonly chart: UsageChart
  /** Series keys the reader hid. */
  readonly hidden: readonly string[]
  /** Show or hide one series. */
  readonly toggleSeries: (key: string) => void
  /** Section translate seat. */
  readonly t: (key: UsageKey) => string
}

/**
 * Render the per-model chart.
 * @param props - folded geometry, the hidden set, and the legend toggle.
 * @returns the chart, or a placeholder when no series has usage in range.
 */
export function ModelTokenChart({ chart, hidden, toggleSeries, t }: ModelTokenChartProps): ReactNode {
  if (chart.series.length === 0) return <p className={css.empty}>{t('noUsage')}</p>

  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM
  const baseline = PAD_TOP + plotHeight
  const step = chart.days.length > 1 ? plotWidth / (chart.days.length - 1) : 0
  const x = (index: number): number => PAD_LEFT + step * index
  const y = (value: number): number => baseline - (chart.max === 0 ? 0 : (value / chart.max) * plotHeight)

  const ticks = [0, 0.5, 1].map(fraction => ({ fraction, value: chart.max * fraction }))
  const lastIndex = chart.days.length - 1
  const labels = [0, Math.floor(lastIndex / 2), lastIndex]
    .filter((index, position, all) => index >= 0 && all.indexOf(index) === position)
    .map(index => ({ index, day: chart.days[index] ?? '' }))

  return (
    <div className={css.root}>
      <svg className={css.svg} viewBox={'0 0 ' + String(WIDTH) + ' ' + String(HEIGHT)} role="img" aria-label={t('chartTitle')}>
        {ticks.map(tick => (
          <Fragment key={tick.fraction}>
            <line className={css.grid} x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y(tick.value)} y2={y(tick.value)} />
            <text className={css.axisText} x={PAD_LEFT - 8} y={y(tick.value) + 4} textAnchor="end">
              {formatTokens(Math.round(tick.value))}
            </text>
          </Fragment>
        ))}
        {labels.map(label => (
          <text key={label.index} className={css.axisText} x={x(label.index)} y={baseline + 18} textAnchor="middle">
            {shortDay(label.day)}
          </text>
        ))}
        {chart.series.filter(series => !hidden.includes(series.key)).map(series => (
          <polyline
            key={series.key}
            className={strokeOf(series)}
            fill="none"
            points={series.values.map((value, index) => String(x(index)) + ',' + String(y(value))).join(' ')}
          />
        ))}
      </svg>
      <ul className={css.legend}>
        {chart.series.map(series => (
          <li key={series.key}>
            <button
              type="button"
              className={css.legendButton}
              aria-pressed={!hidden.includes(series.key)}
              onClick={() => { toggleSeries(series.key) }}
            >
              <span className={[
                css.swatch,
                swatchOf(series),
                hidden.includes(series.key) ? css.swatchHidden : '',
              ].filter(part => part !== '').join(' ')} />
              <span className={css.legendLabel}>{labelOf(series, t)}</span>
              <span className={css.legendValue}>{formatTokens(series.total)}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className={css.hint}>{t('chartHint')}</p>
    </div>
  )
}
