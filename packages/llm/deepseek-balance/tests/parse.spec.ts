import { describe, expect, it } from 'vitest'
import { BalanceError, parseBalanceResponse, toMinor } from '../src/index.ts'

/** One CNY line, as the documented example shows it. */
const CNY_LINE = {
  currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00',
}

/** The documented example reply. */
const DOCUMENTED = { is_available: true, balance_infos: [CNY_LINE] }

describe('decimal amounts', () => {
  it('converts a decimal string to exact minor units', () => {
    expect(toMinor('110.00')).toBe(11_000)
    expect(toMinor('0.05')).toBe(5)
    expect(toMinor('7')).toBe(700)
    expect(toMinor('0')).toBe(0)
  })

  it('never rounds: the schema refuses more precision than a currency has', () => {
    expect(() => parseBalanceResponse({
      is_available: true,
      balance_infos: [{
        currency: 'CNY', total_balance: '1.005', granted_balance: '0', topped_up_balance: '0',
      }],
    })).toThrow(BalanceError)
  })
})

describe('decoding a balance reply', () => {
  it('reads the documented example', () => {
    expect(parseBalanceResponse(DOCUMENTED)).toEqual({
      available: true,
      lines: [{ currency: 'CNY', totalMinor: 11_000, grantedMinor: 1_000, toppedUpMinor: 10_000 }],
    })
  })

  it('keeps every currency the account is billed in', () => {
    const decoded = parseBalanceResponse({
      is_available: true,
      balance_infos: [
        { currency: 'CNY', total_balance: '1.00', granted_balance: '0.00', topped_up_balance: '1.00' },
        { currency: 'USD', total_balance: '2.50', granted_balance: '0.50', topped_up_balance: '2.00' },
      ],
    })
    expect(decoded.lines.map(line => line.currency)).toEqual(['CNY', 'USD'])
    expect(decoded.lines[1]?.totalMinor).toBe(250)
  })

  it('reports an unfunded account as a value, not as an error', () => {
    const decoded = parseBalanceResponse({
      is_available: false,
      balance_infos: [{ currency: 'CNY', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' }],
    })
    expect(decoded.available).toBe(false)
    expect(decoded.lines[0]?.totalMinor).toBe(0)
  })

  it('refuses a body that is not the documented shape', () => {
    const cases: readonly unknown[] = [
      undefined,
      {},
      { is_available: 'yes', balance_infos: DOCUMENTED.balance_infos },
      { is_available: true, balance_infos: [] },
      { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: 110 }] },
      { is_available: true, balance_infos: [{ currency: '', total_balance: '1.00', granted_balance: '0', topped_up_balance: '0' }] },
    ]
    for (const body of cases) {
      let thrown: unknown
      try { parseBalanceResponse(body) } catch (error: unknown) { thrown = error }
      expect(thrown).toBeInstanceOf(BalanceError)
      expect((thrown as BalanceError).code).toBe('MALFORMED_RESPONSE')
    }
  })

  it('ignores fields the endpoint adds later', () => {
    const decoded = parseBalanceResponse({
      ...DOCUMENTED,
      is_available: true,
      balance_infos: [{ ...CNY_LINE, extra: 'ignored' }],
      new_top_level_field: 1,
    })
    expect(decoded.lines).toHaveLength(1)
  })
})
