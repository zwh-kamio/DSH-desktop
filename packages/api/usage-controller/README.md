---
description: "Host Remote owner for the usage and balance facts the settings Usage page reads."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-usage-controller

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-usage-controller` owns the `usage` Typert Remote namespace. `UsageController` registers `ctx.usageController` and exposes three methods over the seams beneath it: `summary`, the windowed token totals from `ctx.usageLedger`; `balance`, one account-balance read that the ledger records; and `balanceHistory`, the readings that make a spend derivable. It owns no data of its own — it decodes a wire request, asks the service that owns the fact, and returns.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it in any host composition that also mounts the services it reads. The namespace is registered whether or not they are present, so a client always resolves `ctx.remote.usage` and receives an actionable diagnostic rather than an unknown method.

```yaml
- name: '@deepseek-ai/dsh-api-usage-controller'
```

| Method | Request | Answer |
|---|---|---|
| `summary` | `{ sinceMs, untilMs }` | `{ hours, models, accountedSessions, unaccountedSessions }` |
| `balance` | — | `{ available, lines, readAt }` |
| `balanceHistory` | `{ sinceMs, untilMs }` | `{ currencies }` |

<a id="understand-the-implementation"></a>
## Understand the implementation

**The window is validated here, not trusted.** It arrives from the wire, so a malformed or inverted window is a caller error and reports as `usage/bad-window` with the bounds the caller actually sent, rather than becoming an empty answer that looks like "no usage".

**A missing service answers with a reason.** `usage/summary-failed`, `usage/balance-unavailable`, `usage/balance-failed`, and `usage/history-unavailable` each carry a `reason` the browser switches on: an unauthorized key, an endpoint that does not serve the balance API, and a composition that mounts no ledger need different words.

**Balance reads are routed through the ledger when one is mounted.** Reading and recording are one operation in `@deepseek-ai/dsh-balance-ledger`, so a read that bypassed it would leave a hole in the spend curve exactly where the page looked. A deployment that mounts only the stateless reader still gets a working card.

**Readings are returned raw.** Whether a fall is spend and a rise is a top-up is arithmetic the caller performs, and the caller's own timezone decides which day each interval belongs to — neither is a fact this layer holds.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No pagination or bounding of its own.** `summary` and `balanceHistory` return whatever the window selects; a caller asking for an unbounded range gets an unbounded payload.
- **No caching.** Every call reaches the service. The page calls once per range change; a caller that polls would poll the ledger and, for `balance`, the provider.
- **Provider-neutral naming, provider-specific facts.** The namespace is named for what it answers rather than for DeepSeek, but every value today comes from DeepSeek seams; a second provider would need its own controller rather than another branch here.
- **The account is whatever the current credential belongs to.** Nothing in this layer distinguishes accounts, so a deployment that rotates keys sees one account's figures at a time.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The Typert generator refuses a Remote signature whose return type crosses a package through this package's own re-export: the type must be named at an explicit package import where the signature uses it. `BalanceSummary` therefore imports `BalanceSnapshot` from `@deepseek-ai/dsh-deepseek-balance/types` directly, while `types.ts` still re-exports it for the browser, which should name one package rather than two.

The controller was kept separate from `@deepseek-ai/dsh-usage-ledger` even though the ledger could have carried its own `@Remote` methods, because the `packages/api` tier is where this repository puts the wire-facing facades over domain services.

</details>
