---
description: "面向设置页「用量信息」的跨会话 token 用量账本（按 UTC 小时与按模型路由）。"
kind: "package-reference"
---

# @deepseek-ai/dsh-usage-ledger

[English](README.md) | 中文

## Summary

`@deepseek-ai/dsh-usage-ledger` 是设置页「用量信息」背后的主机侧账本。`UsageLedger` 注册 `ctx.usageLedger`，把语料中已知的每个会话折叠成按 UTC 小时的 token 合计，且每个小时自带该小时内的模型路由拆分，并对整个语料回答按窗口的汇总。它**刻意不做成 session projection** —— 会话列表 Remote 会为每个被列出的会话发送每一个已注册投影的 wire 值，而按小时、按路由的负载会把那条热路径撑大 —— 因此它拥有自己的 `usage_ledger` 存储域。当某个界面需要「本 Harness 花了多少，按天并按模型拆开」而又不想每次打开都读会话日志时，就用它。

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

把它挂载在它所写入的存储栈旁边。它注入 `storageDomain`、`sessionQuery` 与 `sessions`。

```yaml
- name: '@deepseek-ai/dsh-storage-domain'
- name: '@deepseek-ai/dsh-usage-ledger'
```

`summary({ sinceMs, untilMs }, signal?)` 返回 `{ hours, models, accountedSessions, unaccountedSessions }`。两个维度都按窗口裁剪：`hours` 是按时间升序的 UTC 小时桶，只含非零合计，且每桶自带非零的 `routes`；`models` 是该窗口内的按路由合计。窗口内没有用量的路由不会出现在任何地方，因此调用方按模型画线时不需要自己过滤。

窗口是**两个绝对时刻**，不是天序号也不是天数。把 UTC 小时归并成本地日需要读者的时区，而时区不是主机持有的事实，因此由调用方计算自己那些天所覆盖的时刻区间。

| 配置 | 默认 | 含义 |
|---|---|---|
| `retentionDays` | `400` | 每个会话在新折叠事件之前保留的小时桶天数。 |
| `writeEveryEvents` | `200` | 两次回合边界之间强制落盘的已提交事件数。 |
| `writeIntervalMs` | `5000` | 脏账本最长不落盘的时间。 |
| `backfillConcurrency` | `4` | 回填时并发折叠的会话数。 |

<a id="understand-the-implementation"></a>
## Understand the implementation

**每个会话一份折叠，由已提交事件流推进。** 活跃会话的折叠在其挂载后的第一个事件上创建：记录身份仍与日志匹配时从存储记录继续，否则折叠整个活跃日志。若到来的序列与折叠水位之间出现缺口，则丢弃累加器并从确切的活跃日志重新折叠 —— 漏掉过事件的累加器无法继续。

**同一次尝试内的用量报告是替换而不是累加。** 会话日志中同一次尝试的用量报告是相邻的，最终的 `assistant/message` 会重述流式样本。因此折叠保留上一样本的小时、路由与桶，在加入重述值之前先撤回它们，使「流式样本 + 最终消息」只计一次。匹配的 `llm/retry-started` 会清空该槽位，让重试的那次尝试单独计数。

**存储记录携带继续折叠所需的全部信息。** `throughSeq` 是已折叠的最高序列号，`route` 是当时生效的提供方/模型，`sample` 是仍可能被重述的那次尝试。持久化该样本正是重启精确的原因：若记录写在「流式样本」与「最终消息」之间，最终消息到来时必须撤回那个样本，而不是把这次尝试算两遍。

**为什么是小时。** 折叠必须在任何机器上重放出相同结果，因此桶不能依赖读者的时区 —— 但 UTC 的**日**界在北京时间 08:00，而且日桶一旦写下就无法再切分。小时桶让折叠保持确定性，把本地日的归并留给读者。

**身份，而不只是 id。** 会话 id 命名的是一个槽位而非一次生命周期，因此记录绑定到 header 的 `createdAt` 与 `cwd`。身份不再匹配的记录会被忽略，该会话重新折叠。

**派生数据，从不是权威。** 记录缺失或无关只代价一次折叠；写入失败会记录日志，并由下一次触发从同一个累加器重试。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **只统计本 Harness 自己发出的请求。** 账本折叠的是会话事件，因此提供方控制台、其他机器或其他工具产生的用量在这里不可见。`@deepseek-ai/dsh-deepseek-balance` 是覆盖这部分的那条接缝。
- **没有账本的会话只被计数，绝不被猜测。** `unaccountedSessions` 同时包含「仍在折叠」与「日志读不出来」的会话。调用方必须把这个缺口展示出来，而不是把合计当作完整的。
- **窗口越宽负载越大。** `hours` 为每个有用量的小时携带一条记录及其路由拆分，因此在长寿命语料上做无界的「全部」窗口可能很大。窗口由调用方负责设界。
- **只有 UTC。** 桶按设计就是 UTC 小时；想要自己的「天」的调用方自己做归并，直接展示 UTC 日的调用方会有一个时区偏移的偏差。
- **保留期是每会话且静默的。** 比最新折叠事件早于 `retentionDays` 的小时桶会被丢弃，因此超长会话的早期历史是直接消失，而不是被标记出来。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

记录结构在实现过程中改过两次，两次都是为了正确性而非口味：

1. 「按路由的生命周期总量」回答不了带窗口的问题 —— 半年前用过一次的路由会出现在「最近 7 天」的图里 —— 因此每个存储的小时自带该小时的路由拆分。
2. 最初的设计持久化一个「安全水位」，只在没有尝试处于报告中途时推进。该水位永远无法越过一个流式样本，导致几乎什么都写不进去。改为持久化「未闭合的样本」与「当时生效的路由」后，既保住了同样的保证，又消除了这个死锁，而且中途重启现在是精确的，而不仅仅是「不太可能出问题」。

账本最初被设计为 session projection。它不是，因为 `api/session-controller/src/list.ts` 会为每个被列出的会话发送每一个已注册投影的 wire 值，而本负载比那条热路径今天携带的值大好几个数量级。

</details>
