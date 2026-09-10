---
description: "The settings Usage page: token totals and a per-model chart over the usage Remote, with the account-balance card and spend curve."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-usage

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-client-ui-settings-usage` registers the **Usage** page in the settings dialog. It reads the `usage` Remote namespace — the windowed token totals, the account balance, and the balance readings — and renders four things from them: the account-balance card, a spend curve per currency, one line per model over time, and the per-model table behind it. It computes nothing the host already decided: rolling UTC hours into the reader's own days is the one piece of arithmetic it owns, because the reader's timezone is the one fact the host does not hold.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose it into a web profile beside the settings shell it registers into. It injects `slots`, `locale`, `remote`, and `remote.usage`.

```yaml
- name: '@deepseek-ai/dsh-client-ui-settings-usage'
```

The page offers three ranges — the last 7 days, the last 30 days, and all time — and three metrics for the model chart: total, input, and output.

<a id="understand-the-implementation"></a>
## Understand the implementation

**The window crosses the wire as instants.** The ledger buckets in UTC and cannot know this browser's zone, so the section sends the instants its own local days span rather than a day count. This is what lets a reader in UTC+8 see their own days instead of days that begin at 08:00.

**Zero-usage models are filtered twice, and the second filter is the one that matters.** The host already omits routes with no usage in the window from both the totals and every hour's breakdown. What it cannot omit is a route that has usage but none *under the selected metric*: a model that only ever hit the cache has nothing to plot as output. That series must disappear rather than draw a flat line at zero, and `buildChart` drops it.

**The palette does not cycle.** Beyond the eight slot colours, the tail merges into one "other" line. Repeating a colour would draw two different models as the same series, which is worse than drawing one line fewer.

**Series are ordered largest first**, so the slots go to the routes that actually carry the window and a model leaving the window does not reshuffle the ones that remain.

**Spend is a difference, and the sign is the whole classification.** The provider publishes no spend figure. Usage only ever lowers a balance, so a fall between two readings is spend and a rise can only be a top-up or a refund. Each interval is credited to the local day of its *later* reading, because that is the moment it was observed; a sampling gap therefore lands whole on the day sampling resumed instead of being invented across the days it spans.

**An empty curve says why.** Fewer than two readings bracket no usage, so the curve reports that rather than drawing a floor of zeros that were never measured. A failed balance read keeps the number the reader already saw instead of blanking a figure that was true a moment ago, and a balance or history failure never takes the token figures down with it.

**Money is exact until it is displayed.** Balances stay in minor units throughout; the division into major units happens once, in `formatMoney`, at the presentation edge.

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side read-only presentation of host usage and balance facts, and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Only this harness's own requests are charted.** The token figures fold session events, so work done in the provider's web console or by another tool appears in the balance and the spend curve but not in the token panels. The two disagree by exactly that amount.
- **The spend horizon starts at the first reading.** No API supplies balance history, so the curve can only begin where sampling began; it cannot be backfilled.
- **A sampling gap lands on one day.** Noted in the curve itself. The sampling interval bounds the error, and a deployment that wants sharper resolution lowers it.
- **Granted-balance expiry reads as spend.** A lapsed grant lowers the balance without anything being spent, and the provider's rule of spending granted balance first makes it indistinguishable from usage.
- **An unbounded range is an unbounded request.** "All time" asks the host for every hour bucket and every reading it holds; on a long-lived corpus that is a large payload.
- **No series cap on the table.** The per-model table lists every route the window carries, with no paging.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Both charts are hand-drawn inline SVG. The repository has no chart library and forbids pulling in a component library, so each slot names a `--dsw-chart-series-*` token through a CSS Module class; the theme defines the light and dark values, which is what keeps a colour decision out of the component.

The two charts share `localDayOfInstant` deliberately: the token chart derives its days from hour buckets and the spend curve from reading timestamps, and a reader comparing the panels must not find that they disagree about where a day starts.

Component specs feed the store directly rather than driving the Remote. The store's own spec covers the wire shapes, including that a slow earlier answer cannot overwrite the range the reader moved to.

</details>
