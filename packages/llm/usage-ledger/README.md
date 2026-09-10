---
description: "Durable cross-session token-usage ledger (per UTC hour and per model route) for the settings Usage page."
kind: "package-reference"
---

# @deepseek-ai/dsh-usage-ledger

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-usage-ledger` is the host-side ledger behind the settings Usage page. `UsageLedger` registers `ctx.usageLedger`; it folds every session the corpus knows into per-UTC-hour token totals, each hour carrying its own model-route breakdown, and answers windowed summaries over the whole corpus. It is deliberately not a session projection — the session-list Remote ships every projection's wire value, and a per-hour, per-route payload would inflate that hot path for every listed session — so it owns the `deepseek_balance`-adjacent `usage_ledger` storage domain instead. Use it when a surface needs "what did this harness spend, split by day and by model" without reading session logs on every open.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin beside the storage stack it writes through. It injects `storageDomain`, `sessionQuery`, and `sessions`.

```yaml
- name: '@deepseek-ai/dsh-storage-domain'
- name: '@deepseek-ai/dsh-usage-ledger'
```

`summary({ sinceMs, untilMs }, signal?)` returns `{ hours, models, accountedSessions, unaccountedSessions }`. Both dimensions are clipped to the window: `hours` holds ascending UTC hour buckets with non-zero totals, each carrying its own non-zero `routes`, and `models` holds the window's per-route totals. A route with no usage inside the window appears nowhere, so a caller charting one series per model needs no filter of its own.

The window is two absolute instants, never a day index or a day count. Rolling UTC hours into local days needs the reader's zone, and the zone is not a fact the host holds, so the caller computes the instants its own days span.

| Config | Default | Meaning |
|---|---|---|
| `retentionDays` | `400` | Days of hour buckets retained behind the newest folded event, per session. |
| `writeEveryEvents` | `200` | Committed events that force a durable write between turn boundaries. |
| `writeIntervalMs` | `5000` | Longest a dirty ledger may stay unwritten. |
| `backfillConcurrency` | `4` | Sessions folded concurrently while backfilling. |

<a id="understand-the-implementation"></a>
## Understand the implementation

**One fold per session, advanced from the committed event stream.** A live session's fold is created on its first event after mount: from its stored record when the record's identity still matches the log, otherwise by folding the whole live log. A gap between the incoming sequence and the fold's watermark discards the accumulator and refolds from the exact live log, because an accumulator that missed events cannot be continued.

**A usage report is replaced, not added, within one attempt.** Usage reports for one attempt are adjacent in the session log, and the final `assistant/message` restates the streaming sample. The fold therefore keeps the last sample's hour, route, and buckets and withdraws them before adding the restatement, so a streaming sample followed by its final message counts once. A matching `llm/retry-started` clears the slot, letting the retried attempt count on its own.

**The stored record carries everything a continuation needs.** `throughSeq` is the highest folded sequence, `route` is the provider/model in force, and `sample` is the attempt still open to restatement. Persisting the sample is what makes a restart exact: a record written between a streaming sample and its final message must withdraw that sample when the message arrives rather than count the attempt twice.

**Why hours.** The fold must replay identically on every machine, so a bucket cannot depend on the reader's zone — but a UTC *day* boundary falls at 08:00 in Beijing, and a day bucket cannot be re-split once written. Hourly buckets keep the fold deterministic and leave the local-day rollup to the reader.

**Identity, not just an id.** A session id names a slot, not a lifecycle, so a record is bound to the header's `createdAt` and `cwd`. A record whose identity no longer matches is ignored, and the session is folded again.

**Derived data, never an authority.** A missing or unrelated record costs a fold; a failed write logs and is retried by the next trigger from the same accumulator.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Only this harness's own requests.** The ledger folds session events, so usage made in the provider's web console, on another machine, or by another tool is invisible here. `@deepseek-ai/dsh-deepseek-balance` is the seam that covers it.
- **Sessions without a ledger are counted, never guessed.** `unaccountedSessions` includes both sessions still being folded and those whose logs could not be read. A caller must surface that gap rather than present the totals as complete.
- **A wide window is a wide payload.** `hours` carries one entry per hour with traffic plus its route breakdown, so an unbounded "all time" window on a long-lived corpus can be large. The window is the caller's to bound.
- **UTC only.** Buckets are UTC hours by design; a caller that wants its own days does the rollup, and one that displays UTC days directly will be off by its offset.
- **Retention is per session and silent.** Hour buckets older than `retentionDays` behind the newest folded event are dropped, so a very long session's early history is simply absent rather than marked.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The record shape changed twice during implementation, both times for correctness rather than taste:

1. A lifetime per-route total cannot answer a windowed question — a route used once months ago would still appear in a chart of the last seven days — so each stored hour owns its own route breakdown.
2. The first design persisted a "safe watermark" that only advanced where no attempt was mid-report. That watermark could never advance past a streaming sample, so almost nothing was ever written. Persisting the open sample and the route in force instead makes the same guarantee without the deadlock, and a mid-attempt restart is now exact rather than merely unlikely to matter.

The ledger was originally specified as a session projection. It is not one because `api/session-controller/src/list.ts` ships every registered projection's wire value for every listed session, and this payload is orders of magnitude larger than the values that hot path carries today.

</details>
