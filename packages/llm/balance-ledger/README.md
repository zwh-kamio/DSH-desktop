---
description: "Durable account-balance readings and the spend recovered from their differences."
kind: "package-reference"
---

# @deepseek-ai/dsh-balance-ledger

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-balance-ledger` keeps every reading of the DeepSeek account balance. `BalanceLedger` registers `ctx.balanceLedger`; each `sample()` reads through `@deepseek-ai/dsh-deepseek-balance` and records the result, and a timer records one more on each configured interval for as long as the process lives. Readings are stored, not a running total, because the provider publishes no spend figure: a spend is always the difference between two readings, so the only party that can answer "what did this cost" is the readings, kept in order.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it beside the storage stack and the reader it samples from. It injects `storageDomain` and `deepseekBalance`, so a composition without a balance reader leaves the ledger dormant rather than registering a service that can only fail.

```yaml
- name: '@deepseek-ai/dsh-deepseek-balance'
- name: '@deepseek-ai/dsh-balance-ledger'
  config:
    sampleIntervalMs: 1800000
    retentionSamples: 2000
```

`sample(signal?)` reads and records, returning the reading. `history({ sinceMs, untilMs })` returns `{ currencies }`, one entry per currency with a usable baseline.

| Config | Default | Meaning |
|---|---|---|
| `sampleIntervalMs` | `1800000` | Interval between automatic readings; `0` leaves sampling to explicit reads. |
| `retentionSamples` | `2000` | Readings retained per currency. |

<a id="understand-the-implementation"></a>
## Understand the implementation

**Reading and recording are one operation.** A reading nobody kept cannot take part in any later difference, so a caller that only ever read would produce a curve with a hole exactly where it looked. The Usage page therefore samples through this ledger rather than around it.

**A history includes the window's baseline.** `history` returns the newest reading at or before `sinceMs` followed by every reading inside the window. That leading reading is what makes the first in-window interval measurable; without it the spend between `sinceMs` and the first in-window reading would be invisible. A currency with fewer than two selectable readings is omitted rather than returned as a lone point with nothing to subtract.

**Levels are stored verbatim.** A rise between two readings is never usage — usage only ever lowers a balance — but the ledger does not classify it. It stores the levels, including a negative one if the provider reports one, and leaves "fall is spend, rise is a top-up" to the reader. Clamping a negative balance to zero here would silently change what a later difference means.

**Sampling is unref'd.** The interval never holds the process open, so a background reading cannot be the reason a one-shot CLI run fails to exit.

**The retention cap drops the oldest readings.** A truncated series stays a valid spend history for its remaining span; dropping the newest would make the current balance unknowable.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Sampling only happens while the process runs.** The curve has a horizon, not a beginning: it starts at the first recorded reading and shows nothing before it. No API supplies history, so this cannot be backfilled.
- **A gap is attributed to one day.** An interval is credited to the local day of its later reading, because that is the moment the change was observed. A sampling gap therefore lands whole on the day sampling resumed rather than being spread across the days it spans; the sampling interval bounds how wrong that can be.
- **Granted balance expiry is indistinguishable from usage.** A grant that expires lowers the balance without anything being spent. The `grantedMinor` and `toppedUpMinor` split allows a partial guess, but the provider's rule of spending granted balance first makes the two move together, so a rise and a grant lapse cannot be told apart reliably.
- **One series per currency, no conversion.** Readings are grouped by the currency the provider reported and never converted or combined; there is no exchange-rate seam.
- **A resumed-process deployment samples as often as it restarts.** The interval is process-scoped, so a CLI invoked occasionally records roughly one reading per run rather than one per interval.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The domain is declared `per-record` with one record per currency, each holding that currency's readings. The alternative considered was a single document holding every currency; per-currency was chosen because `KvTable` exposes `keys()`/`entries()`, so per-currency records can be enumerated without a global slot listing the currencies that exist.

`withSample` is the only writer of the series and appends to what it read, which is what keeps readings ascending. That is why no runtime invariant asserts the ordering: it is established by the single writer, not by a relation between two live objects.

</details>
