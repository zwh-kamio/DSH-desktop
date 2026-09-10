import { describe, expect, it } from 'vitest'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  applyEvent,
  createAccumulator,
  foldEvents,
  fromRecord,
  hourKeyOf,
  isZeroBuckets,
  toRecord,
  UNKNOWN_ROUTE,
} from '../src/fold.ts'
import type { LedgerIdentity } from '../src/spec.ts'

/** 2026-01-05T10:00:00Z. */
const BASE = Date.UTC(2026, 0, 5, 10, 0, 0)
const HOUR = 3_600_000
const IDENTITY: LedgerIdentity = { createdAt: 1, cwd: '/workspace' }
const PROVIDER = 'deepseek-official'
const FLASH = 'deepseek-v4-flash'
const PRO = 'deepseek-v4-pro'

function header(seq: number, time: number, model: string): SessionEvent {
  return {
    type: 'request/header',
    seq,
    time,
    data: { header: { config: { provider: PROVIDER, model } }, reason: 'initial' },
  }
}

function usageChunk(seq: number, time: number, turn: number, step: number, usage: TokenUsage): SessionEvent {
  return { type: 'assistant/chunk', seq, time, data: { turn, step, chunk: { type: 'usage', usage } } }
}

function finalMessage(seq: number, time: number, turn: number, step: number, usage: TokenUsage): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      turn,
      step,
      usage,
      message: createAssistantMessage({ content: [], source: { provider: PROVIDER, model: FLASH } }),
    },
  }
}

function turnEnd(seq: number, time: number, turn: number): SessionEvent {
  return { type: 'turn/end', seq, time, data: { turn, reason: 'stop' } }
}

/** One provider usage report with only the fields a case cares about. */
function usage(input: number, output: number, cached = 0, written = 0): TokenUsage {
  return { inputTokens: input, outputTokens: output, cacheReadTokens: cached, cacheWriteTokens: written }
}

/** One hour cell as the fold serialized it. */
interface HourCell {
  readonly total: unknown
  readonly routes: readonly { provider: string; model: string; buckets: unknown }[]
}

function bucketsAt(events: readonly SessionEvent[], hour: number): HourCell | undefined {
  return toRecord(foldEvents(events, 400), IDENTITY).byHour[hourKeyOf(BASE + hour * HOUR)]
}

describe('usage ledger fold', () => {
  it('attributes each usage report to the UTC hour of its own event', () => {
    const events = [
      header(0, BASE, FLASH),
      usageChunk(1, BASE, 1, 1, usage(10, 2)),
      usageChunk(2, BASE + HOUR, 1, 2, usage(20, 4)),
    ]
    const record = toRecord(foldEvents(events, 400), IDENTITY)
    expect(Object.keys(record.byHour)).toEqual(['2026-01-05T10', '2026-01-05T11'])
    expect(record.byHour['2026-01-05T10']?.total).toEqual({
      uncachedInputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0,
    })
    expect(record.byHour['2026-01-05T11']?.total).toEqual({
      uncachedInputTokens: 20, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0,
    })
  })

  it('replaces a streaming sample with the final message of the same attempt', () => {
    const events = [
      header(0, BASE, FLASH),
      usageChunk(1, BASE, 1, 1, usage(100, 1)),
      finalMessage(2, BASE, 1, 1, usage(120, 30)),
    ]
    const hour = bucketsAt(events, 0)
    expect(hour?.total).toEqual({
      uncachedInputTokens: 120, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0,
    })
    expect(hour?.routes).toHaveLength(1)
  })

  it('accumulates separate attempts instead of replacing across them', () => {
    const events = [
      header(0, BASE, FLASH),
      usageChunk(1, BASE, 1, 1, usage(10, 1)),
      usageChunk(2, BASE, 1, 2, usage(20, 2)),
    ]
    expect(bucketsAt(events, 0)?.total).toEqual({
      uncachedInputTokens: 30, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0,
    })
  })

  it('attributes reports to the model route named by the newest request header', () => {
    const events = [
      header(0, BASE, FLASH),
      usageChunk(1, BASE, 1, 1, usage(10, 1)),
      header(2, BASE, PRO),
      usageChunk(3, BASE, 1, 2, usage(20, 2)),
    ]
    const routes = bucketsAt(events, 0)?.routes ?? []
    expect(routes).toEqual([
      { provider: PROVIDER, model: FLASH, buckets: { uncachedInputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      { provider: PROVIDER, model: PRO, buckets: { uncachedInputTokens: 20, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    ])
  })

  it('keeps a report that precedes every request header visible under an explicit route', () => {
    const events = [usageChunk(0, BASE, 1, 1, usage(5, 1))]
    const routes = bucketsAt(events, 0)?.routes ?? []
    expect(routes).toHaveLength(1)
    expect(routes[0]?.provider).toBe(UNKNOWN_ROUTE.provider)
    expect(routes[0]?.model).toBe(UNKNOWN_ROUTE.model)
  })

  it('carries cache buckets separately from uncached input', () => {
    const events = [header(0, BASE, FLASH), usageChunk(1, BASE, 1, 1, usage(7, 3, 900, 40))]
    expect(bucketsAt(events, 0)?.total).toEqual({
      uncachedInputTokens: 7, outputTokens: 3, cacheReadTokens: 900, cacheWriteTokens: 40,
    })
  })

  it('drops hour buckets older than the retention window, measured from the newest event', () => {
    const old = BASE - 10 * 24 * HOUR
    const events = [
      header(0, old, FLASH),
      usageChunk(1, old, 1, 1, usage(10, 1)),
      header(2, BASE, FLASH),
      usageChunk(3, BASE, 1, 2, usage(20, 2)),
    ]
    const record = toRecord(foldEvents(events, 7), IDENTITY)
    expect(Object.keys(record.byHour)).toEqual([hourKeyOf(BASE)])
  })

  it('omits every zero-valued cell, so a withdrawn route never reaches the medium', () => {
    const acc = createAccumulator(-1)
    applyEvent(acc, header(0, BASE, FLASH), 400)
    applyEvent(acc, usageChunk(1, BASE, 1, 1, usage(10, 1)), 400)
    applyEvent(acc, usageChunk(2, BASE, 1, 1, usage(0, 0)), 400)
    const record = toRecord(acc, IDENTITY)
    expect(record.byHour).toEqual({})
  })

  it('persists the folded-through seq together with the still-open attempt sample', () => {
    const acc = createAccumulator(-1)
    applyEvent(acc, header(0, BASE, FLASH), 400)
    applyEvent(acc, usageChunk(1, BASE, 1, 1, usage(10, 1)), 400)
    const record = toRecord(acc, IDENTITY)
    expect(record.throughSeq).toBe(1)
    expect(record.sample).toEqual({
      turn: 1,
      step: 1,
      hour: '2026-01-05T10',
      provider: PROVIDER,
      model: FLASH,
      buckets: { uncachedInputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })
  })

  it('restarts between a streaming sample and its final message without counting twice', () => {
    const events = [
      header(0, BASE, FLASH),
      usageChunk(1, BASE, 1, 1, usage(100, 1)),
      finalMessage(2, BASE, 1, 1, usage(120, 30)),
    ]
    // The record is written after the streaming sample and before the message,
    // which is exactly the half-observed attempt a crash leaves behind.
    const restored = fromRecord(toRecord(foldEvents(events.slice(0, 2), 400), IDENTITY))
    const last = events[2]
    if (last === undefined) throw new Error('fixture is missing the final message')
    applyEvent(restored, last, 400)
    expect(toRecord(restored, IDENTITY)).toEqual(toRecord(foldEvents(events, 400), IDENTITY))
  })

  it('round-trips a record through the accumulator without losing a bucket', () => {
    const events = [
      header(0, BASE, FLASH),
      usageChunk(1, BASE, 1, 1, usage(10, 1, 100, 5)),
      header(2, BASE + HOUR, PRO),
      usageChunk(3, BASE + HOUR, 1, 2, usage(20, 2)),
      turnEnd(4, BASE + HOUR, 1),
    ]
    const first = toRecord(foldEvents(events, 400), IDENTITY)
    const second = toRecord(fromRecord(first), IDENTITY)
    expect(second).toEqual(first)
  })

  it('refolds a resumed tail identically to a full fold', () => {
    const events = [
      header(0, BASE, FLASH),
      usageChunk(1, BASE, 1, 1, usage(10, 1)),
      turnEnd(2, BASE, 1),
      header(3, BASE + HOUR, PRO),
      usageChunk(4, BASE + HOUR, 2, 1, usage(20, 2)),
    ]
    const whole = toRecord(foldEvents(events, 400), IDENTITY)
    const restored = fromRecord(toRecord(foldEvents(events.slice(0, 3), 400), IDENTITY))
    for (const event of events.slice(3)) applyEvent(restored, event, 400)
    expect(toRecord(restored, IDENTITY)).toEqual(whole)
  })

  it('formats hour keys as UTC so lexicographic order is chronological order', () => {
    expect(hourKeyOf(BASE)).toBe('2026-01-05T10')
    expect(hourKeyOf(BASE - 1)).toBe('2026-01-05T09')
    expect(hourKeyOf(BASE) < hourKeyOf(BASE + HOUR)).toBe(true)
  })

  it('reports zero buckets only when every bucket is zero', () => {
    expect(isZeroBuckets({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(true)
    expect(isZeroBuckets({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 1, cacheWriteTokens: 0 })).toBe(false)
  })
})
