---
description: "基于官方余额接口的 DeepSeek 账户余额读取器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-deepseek-balance

[English](README.md) | 中文

## Summary

`@deepseek-ai/dsh-deepseek-balance` 读取 DeepSeek 账户余额。`DeepSeekBalance` 注册 `ctx.deepseekBalance`；一次 `read()` 解析配置的凭据、对配置的端点执行一次带鉴权的 `GET /user/balance`，并把应答解码为精确的「分」。它是无状态的：不缓存任何东西也不记录任何东西。当某个界面需要那一个本地日志无法产生的事实 —— 还剩多少，且包含本 Harness 从未产生的消耗 —— 就用它。

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

在凭据接缝可用的地方挂载它。存在 `ctx.credentials` 时经由它读取，不存在时回落到启动环境，因此没有凭据提供方的部署也能凭一个导出的密钥工作。

```yaml
- name: '@deepseek-ai/dsh-deepseek-balance'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY
```

`read(signal?)` 返回 `{ available, lines, readAt }`，其中每条 line 为一种币种携带 `totalMinor`、`grantedMinor` 与 `toppedUpMinor`。

| 配置 | 默认 | 含义 |
|---|---|---|
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 每次读取时解析的凭据引用。 |
| `baseURL` | `$DEEPSEEK_BASE_URL`，否则 `https://api.deepseek.com` | 端点基址；路径前缀会被保留。 |
| `timeoutMs` | `10000` | 单次读取的上限。 |

<a id="understand-the-implementation"></a>
## Understand the implementation

**金额是「分」，以整数保存。** 提供方发送的是十进制字符串（`"110.00"`）。这条接缝存在的意义就是让两次读数可以相减，而对「元」反复做浮点相减并不精确。应答 schema 拒绝超过两位小数，而不是在入口把钱四舍五入。

**拒绝跟随重定向，而不是跟随它。** 请求携带账户密钥，跟随重定向等于把它交给应答的那个主机。该策略按请求声明，并有回归测试断言，因此后续改动无法悄悄去掉它。

**答不了这个问题的端点是一个部署事实，不是传输故障。** 只镜像 chat API 的代理会答 `404`/`405`，这里报 `UNSUPPORTED_ENDPOINT` 并附上这一解释，而不是笼统的 HTTP 错误。`401`/`403` 报 `UNAUTHORIZED`，而结构不符的响应体报 `MALFORMED_RESPONSE` —— 提供方改了字段名必须响亮地失败，而不是报一个 0 余额。

**凭据按每次读取解析。** 轮换后的密钥无需重启即可用于下一次读取；解析失败一律报 `MISSING_CREDENTIAL`，不会发出未鉴权的请求。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **余额是水平量，不是消费。** 该端点报告的是还剩多少；它完全不发布用量或账单数字。把水平量变成用量靠相减，而那属于保存了读数的一方（`@deepseek-ai/dsh-balance-ledger`）。
- **一份凭据一个账户。** 除了引用名，读取器不知道自己解析到的是哪个密钥，因此在多个密钥之间轮换的部署看到的是当前那个密钥所属的账户。
- **没有重试或退避。** 一次调用一个答案；瞬时失败直接上抛。是否稍后再试由上一层的采样器决定。
- **币种集合完全取决于提供方报告。** 这里不校验币种代码也不做换算；没有汇率接缝，而凭空造一个会歪曲提供方从未给出过的金额。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

应答 schema 刻意是非严格的：未知的顶层字段与余额行内的未知字段会被忽略而不是拒绝，这样提供方新增字段不会打断读取器。被拒绝的是本包所读字段的任何变化，因为那些失败必须是响亮的。

`AbortSignal.any` 把调用方的取消与配置的超时组合起来，因此「调用方取消」与「读取超时」是可区分的：取消报 `ABORTED`，超时报 `HTTP_ERROR` 并以传输失败作为 cause。

</details>
