/**
 * The account-balance card: what the provider says is left, which is the one
 * figure on this page the local log cannot produce.
 *
 * The card is deliberately quiet about failure. A deployment whose endpoint is
 * a chat-only proxy answers that it does not serve the balance API, and that is
 * not a reason to hide the token figures above it — so a refusal is reported
 * in place, and a failed re-read keeps the number the reader already saw.
 */

import type { ReactNode } from 'react'
import { formatMoney } from './format.ts'
import type { BalanceState } from './usage-store.ts'
import type { UsageSectionProps } from './UsageSection.tsx'
import css from './UsageSection.module.css'

/** Props of the balance card; every fact is derived by the section. */
export interface BalanceCardProps {
  /** The card's own load state. */
  readonly state: BalanceState
  /** Section translate seat. */
  readonly t: UsageSectionProps['t']
}

/**
 * Render the balance card.
 * @param props - the balance state and the translate seat.
 * @returns the card, or its loading or refusal line.
 */
export function BalanceCard({ state, t }: BalanceCardProps): ReactNode {
  // Nothing worth drawing until either a snapshot exists or a read has failed.
  if (state.snapshot === null && state.status !== 'error') {
    return <p className={css.status}>{t('balanceLoading')}</p>
  }
  return (
    <div className={css.balance}>
      {state.status === 'error' && (
        <p className={css.error} role="alert">
          {t('balanceFailed') + ': ' + (state.error ?? '')}
        </p>
      )}
      {state.snapshot !== null && (
        <>
          <div className={css.cards}>
            {state.snapshot.lines.map(line => (
              <div key={line.currency} className={css.card}>
                <span className={css.cardLabel}>{line.currency + ' ' + t('balanceTotal')}</span>
                <span className={css.cardValue}>{formatMoney(line.totalMinor, line.currency)}</span>
              </div>
            ))}
          </div>
          <ul className={css.breakdown}>
            {state.snapshot.lines.map(line => (
              <li key={line.currency}>
                <span>{line.currency}</span>
                <span>{t('balanceGranted') + ' ' + formatMoney(line.grantedMinor, line.currency)}</span>
                <span>{t('balanceToppedUp') + ' ' + formatMoney(line.toppedUpMinor, line.currency)}</span>
              </li>
            ))}
          </ul>
          {!state.snapshot.available && (
            <p className={css.notice} role="status">{t('balanceUnavailable')}</p>
          )}
          <p className={css.asOf}>
            {t('balanceAsOf', { time: new Date(state.snapshot.readAt).toLocaleString() })}
          </p>
        </>
      )}
    </div>
  )
}
