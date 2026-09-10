---
description: "面向设置页「用量信息」的用量与余额事实的主机侧 Remote 所有者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-usage-controller

[English](README.md) | 中文

## Summary

`@deepseek-ai/dsh-api-usage-controller` 拥有 `usage` 这个 Typert Remote 命名空间。`UsageController` 注册 `ctx.usageController`，并在其下的各条接缝之上暴露三个方法：`summary` —— 来自 `ctx.usageLedger` 的按窗口 token 合计；`balance` —— 一次会被账本记录的账户余额读取；`balanceHistory` —— 让消费可被推导出来的那些读数。它自己不拥有任何数据：解码线请求，去问拥有该事实的服务，然后返回。

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

把它挂载到任何同时挂载了它所读取服务的主机组合中。无论那些服务是否存在，命名空间都会被注册，因此客户端总能解析出 `ctx.remote.usage` 并收到一个可操作的诊断，而不是「未知方法」。

```yaml
- name: '@deepseek-ai/dsh-api-usage-controller'
```

| 方法 | 请求 | 应答 |
|---|---|---|
| `summary` | `{ sinceMs, untilMs }` | `{ hours, models, accountedSessions, unaccountedSessions }` |
| `balance` | — | `{ available, lines, readAt }` |
| `balanceHistory` | `{ sinceMs, untilMs }` | `{ currencies }` |

<a id="understand-the-implementation"></a>
## Understand the implementation

**窗口在这里被校验，而不是被信任。** 它来自线端，因此格式错误或倒置的窗口是调用方的错误，报 `usage/bad-window` 并带上调用方真实发来的边界值，而不是变成一个看起来像「没有用量」的空答案。

**服务缺失时给出原因。** `usage/summary-failed`、`usage/balance-unavailable`、`usage/balance-failed`、`usage/history-unavailable` 各自携带一个浏览器会据此分支的 `reason`：密钥未授权、端点不提供余额接口、组合没有挂载账本 —— 这三者需要不同的话术。

**已挂载账本时，余额读取经由账本。** 在 `@deepseek-ai/dsh-balance-ledger` 中读取与记录是同一个操作，因此绕开它的读取会在消费曲线上正好于页面看过的那一刻留下一个洞。只挂载无状态读取器的部署同样能得到一张可用的卡片。

**读数原样返回。** 下降是消费、上升是充值，这是调用方做的算术；而每个区间属于哪一天由调用方自己的时区决定 —— 这两者都不是本层持有的事实。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **自身不做分页也不设界。** `summary` 与 `balanceHistory` 返回窗口选中的全部内容；请求无界区间的调用方会得到无界的负载。
- **没有缓存。** 每次调用都会到达服务。页面每次切换范围调用一次；若调用方轮询，就会轮询到账本，而 `balance` 还会轮询到提供方。
- **命名中立、事实特定。** 命名空间按其回答的内容命名，而不是按 DeepSeek 命名，但今天的每个值都来自 DeepSeek 的接缝；接入第二个提供方需要它自己的控制器，而不是在这里加一个分支。
- **账户就是当前凭据所属的那个。** 本层不区分账户，因此轮换密钥的部署一次只能看到一个账户的数字。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

Typert 生成器拒绝这样的 Remote 签名：其返回类型经由本包自己的再导出跨包。类型必须在签名使用它的地方以显式的包导入写出。因此 `index.ts` 直接从 `@deepseek-ai/dsh-deepseek-balance/types` 导入 `BalanceSnapshot`，而 `types.ts` 仍然为浏览器再导出它 —— 浏览器应当只指名一个包，而不是两个。

控制器与 `@deepseek-ai/dsh-usage-ledger` 保持分离，尽管账本本可以自带 `@Remote` 方法：本仓库把面向线端的门面统一放在 `packages/api` 这一层。

</details>
