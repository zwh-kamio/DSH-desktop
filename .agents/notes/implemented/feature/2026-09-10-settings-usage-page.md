# Agent Note: The settings Usage page

Status: implemented

English | [中文](2026-09-10-settings-usage-page.zh.md)

## Problem

The provider publishes two account facts and no cost figure. `GET /user/balance` reports what is left; each completion response reports the tokens it used. Neither answers "what did this cost, over time, split by model" — and each response's usage is a one-shot value that is never retrievable again.

The harness already logged every token it spent: `assistant/message` events carry provider usage, and `dsh-token-meter` folds them into a per-session `tokenUsage` projection. Nothing read that across sessions, so a user could see one conversation's cache-hit rate but not last week's spend. The platform console shows a spend chart, but it is a login-gated single-page application whose data arrives over private XHR; consuming it would mean putting a user's console session into the agent runtime, which the credential rules forbid.

## Decision

A settings section, **Usage**, reads one new Remote namespace and renders four panels: the account balance, a spend curve, one token line per model, and the per-model table behind it.

**Three host packages and one wire owner.** `@deepseek-ai/dsh-usage-ledger` folds committed session events into a durable per-session ledger. `@deepseek-ai/dsh-deepseek-balance` performs the account-level read. `@deepseek-ai/dsh-balance-ledger` keeps the readings that make a spend derivable. `@deepseek-ai/dsh-api-usage-controller` owns the `usage` Remote namespace and owns no data of its own. The browser package `@deepseek-ai/dsh-client-ui-settings-usage` registers the section and computes nothing the host already decided.

**The usage ledger is not a session projection.** It stores one record per session in its own `usage_ledger` domain. A projection would have had to publish a wire value, and `api/session-controller/src/list.ts` ships every registered projection's wire value for every listed session; a per-hour, per-route payload is orders of magnitude larger than the values that path carries today.

**Buckets are UTC hours, and both dimensions are time-scoped.** Each stored hour owns its own route breakdown. A lifetime per-route total cannot answer a windowed question — a route used once months ago would still appear in a chart of the last seven days. The window crosses the wire as two absolute instants, because rolling hours into local days needs the reader's zone, and the zone is not a fact the host holds.

**The stored record carries everything a continuation needs**: the folded-through sequence, the route in force, and the attempt still open to restatement. Persisting the sample is what makes a restart between a streaming usage sample and its final message exact rather than merely unlikely to matter.

**Spend is a difference, and the sign is the whole classification.** Usage only ever lowers a balance, so a fall between two readings is spend and a rise can only be a top-up or a refund. The ledger stores levels verbatim and leaves that classification to the browser, which also owns the local-day attribution: an interval is credited to the day of its later reading, because that is the moment it was observed.

**Reading the balance records it.** The Remote routes `balance` through the ledger, so the reads the page performs are themselves the samples the curve is built from. A read that bypassed the ledger would leave a hole exactly where the user looked.

## Alternatives considered

**A session projection for the usage ledger.** Idiomatic, and it would have reused the projection cache's checkpoints for free. It lost on payload: the session-list Remote would have carried a per-hour, per-route value for every listed session. Making the listing filter keys was the other half of this alternative, and it lost because the allowlist would have to enumerate every wire projection any future feature registers.

**Deriving spend from a configured price table instead of readings.** Exact per-session and per-model cost, and it needs no sampling. It lost because the price page is documentation rather than an API: the table is model × peak/off-peak × three buckets, it changes without notice, and a wrong table silently reports wrong money. Readings cannot be wrong about the total, only about when it happened.

**A single global ledger document.** Simpler than one record per session. It lost because every event would rewrite the whole document, and one currency's series is not the natural write unit for a fold that advances per session.

**Assuming a UTC day boundary.** Cheaper than sending instants — the client could ask for "the last 7 days" as a count. It lost because a UTC day starts at 08:00 in Beijing, and a day bucket cannot be re-split once written, so the mistake would be permanent in stored data.

**Cycling the chart palette past eight series.** It would draw every model. It lost because a repeated colour reads as the same series, which is worse than merging the tail into one "other" line.

## Consequences

Token figures cover only this harness's own requests, while the balance and the spend curve cover the whole account — the two panels disagree by exactly the usage this harness never made, and the page says so rather than reconciling them. The spend curve has a horizon rather than a beginning: no API supplies balance history, so it can only start where sampling started. A sampling gap lands whole on the day sampling resumed. Granted-balance expiry is indistinguishable from usage, because the provider spends granted balance first, which moves both halves of the split together.

The ledger's first design persisted a "safe watermark" that only advanced where no attempt was mid-report. That watermark could never advance past a streaming sample, so almost nothing was ever written — caught by a unit test rather than in production, and replaced by persisting the open sample and the route in force.

The Typert generator refuses a Remote signature whose return type crosses a package through the package's own re-export; the type must be named at an explicit package import where the signature uses it. Each new package also needs its `/types` subpath alias written by hand, because the alias generator emits only the package root and `/invariant`.

## Testing

Unit specs cover the fold's attempt replacement and retention, the window clipping and zero-route omission on both the ledger and the controller, the decoder's refusal of a malformed balance body, the sampler's refusal to record a failed read, the balance-difference classification in both signs, and the chart's zero-usage filter under a metric that ignores a model's only traffic. The section's specs feed the store directly and assert what a reader sees for one answer.
