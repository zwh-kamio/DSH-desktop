---
description: "DeepSeek account-balance reader over the official user-balance endpoint."
kind: "package-reference"
---

# @deepseek-ai/dsh-deepseek-balance

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-deepseek-balance` reads the DeepSeek account balance. `DeepSeekBalance` registers `ctx.deepseekBalance`; one `read()` resolves the configured credential, performs one authenticated `GET /user/balance` against the configured endpoint, and decodes the reply into exact minor units. It is stateless: it holds no cache and records nothing. Use it when a surface needs the one account fact the local log cannot produce — what is left, including usage this harness never made.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it wherever the credential seam is available. It reads `ctx.credentials` when mounted and falls back to the launch environment when it is not, so a deployment without a credential provider still works from an exported key.

```yaml
- name: '@deepseek-ai/dsh-deepseek-balance'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY
```

`read(signal?)` returns `{ available, lines, readAt }`, where each line carries `totalMinor`, `grantedMinor`, and `toppedUpMinor` for one currency.

| Config | Default | Meaning |
|---|---|---|
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | Credential reference resolved per read. |
| `baseURL` | `$DEEPSEEK_BASE_URL`, then `https://api.deepseek.com` | Endpoint base; a path prefix is preserved. |
| `timeoutMs` | `10000` | Upper bound on one read. |

<a id="understand-the-implementation"></a>
## Understand the implementation

**Amounts are minor units, held as integers.** The provider sends decimal strings (`"110.00"`). This seam exists so that two readings can be subtracted, and repeated floating-point subtraction of major units does not stay exact. The response schema refuses more than two fraction digits rather than rounding money on the way in.

**Redirects are refused, not followed.** The request carries the account key, so a redirect would hand it to whichever host answered. The policy is declared per request and a regression test asserts it, so no later edit can drop it silently.

**An endpoint that cannot answer is a deployment fact, not a transport failure.** A proxy that mirrors only the chat API answers `404`/`405`, which reports as `UNSUPPORTED_ENDPOINT` with that explanation rather than as a generic HTTP error. `401`/`403` reports as `UNAUTHORIZED`, and a body that is not the documented shape as `MALFORMED_RESPONSE` — a provider that renames a field must fail loudly rather than report a zero balance.

**Credentials are resolved per read.** A rotated key reaches the next read without a restart, and every failure to resolve one reports as `MISSING_CREDENTIAL` without issuing an unauthenticated request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The balance is a level, not a spend.** The endpoint reports what is left; it publishes no usage or billing figure at all. Turning levels into usage is subtraction, and that belongs to whoever kept the readings (`@deepseek-ai/dsh-balance-ledger`).
- **One account per credential.** The reader knows nothing about which key it resolved beyond its reference, so a deployment that rotates between keys sees whichever account the current one belongs to.
- **No retry or backoff.** One call, one answer; a transient failure surfaces to the caller. The sampler above it chooses whether to try again later.
- **The currency set is whatever the provider reports.** Nothing here validates a currency code or converts between them; there is no exchange-rate seam, and inventing one would misstate an amount the provider never gave.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The response schema is deliberately non-strict: unknown top-level fields and unknown fields inside a balance line are ignored rather than rejected, so a provider that adds a field does not break the reader. What is rejected is any change to the fields this package reads, because those failures must be loud.

`AbortSignal.any` composes the caller's cancellation with the configured timeout, so a caller that cancels and a read that times out are distinguished: a cancellation reports `ABORTED`, a timeout reports `HTTP_ERROR` carrying the transport failure as its cause.

</details>
