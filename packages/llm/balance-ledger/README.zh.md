---
description: "持久的账户余额读数，以及由读数之差得到的消费。"
kind: "package-reference"
---

# @deepseek-ai/dsh-balance-ledger

[English](README.md) | 中文

## Summary

`@deepseek-ai/dsh-balance-ledger` 保存每一次 DeepSeek 账户余额读数。`BalanceLedger` 注册 `ctx.balanceLedger`；每次 `sample()` 经由 `@deepseek-ai/dsh-deepseek-balance` 读取并记录结果，另有一个定时器在进程存活期间按配置的间隔再记录一次。存的是**读数**而不是running合计，因为提供方根本不发布消费数字：消费永远是两次读数之差，因此唯一能回答「这花了多少」的，是**按顺序保存下来的读数**。

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

把它挂载在存储栈与它所采样的读取器旁边。它注入 `storageDomain` 与 `deepseekBalance`，因此没有余额读取器的组合会让账本保持未激活，而不是注册一个只能失败的服务。

```yaml
- name: '@deepseek-ai/dsh-deepseek-balance'
- name: '@deepseek-ai/dsh-balance-ledger'
  config:
    sampleIntervalMs: 1800000
    retentionSamples: 2000
```

`sample(signal?)` 读取并记录，返回该次读数。`history({ sinceMs, untilMs })` 返回 `{ currencies }`，每种有可用基准的币种一条。

| 配置 | 默认 | 含义 |
|---|---|---|
| `sampleIntervalMs` | `1800000` | 自动读数之间的间隔；`0` 表示只由显式读取驱动。 |
| `retentionSamples` | `2000` | 每种币种保留的读数条数。 |

<a id="understand-the-implementation"></a>
## Understand the implementation

**读取与记录是同一个操作。** 没有被保存的读数无法参与任何后续的差值，因此只读不记的调用方会在自己看过的那一刻正好留下一个洞。用量页因此**经由**本账本采样，而不是绕开它。

**历史包含窗口的基准。** `history` 返回 `sinceMs` 当时或之前最新的那条读数，随后是窗口内的每一条读数。正是那条前置读数让窗口内的第一个区间可测量；没有它，`sinceMs` 到窗口内第一条读数之间的消费会不可见。可选读数少于两条的币种会被省略，而不是返回一个无物可减的孤点。

**原样保存水平量。** 两次读数之间的上升绝非用量 —— 用量只会让余额下降 —— 但账本不替读者分类。它保存水平量（包括提供方报告的负值），把「下降是消费、上升是充值」留给读者。在这里把负余额截断为 0 会悄悄改变后续差值所表示的含义。

**采样定时器已 unref。** 它永远不会挂住进程，因此后台读数不会成为一次性 CLI 运行无法退出的原因。

**保留上限丢弃最旧的读数。** 被截断的序列在其剩余跨度上仍是有效的消费历史；丢掉最新的会让当前余额变得不可知。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **只在进程运行时采样。** 这条曲线只有起点没有史前：它从第一条被记录的读数开始，之前什么都没有。没有任何 API 提供历史，因此无法回填。
- **缺口整块记在某一天。** 一个区间记在其后一次读数所在的本地日，因为那是变化被观察到的时刻。因此采样缺口会整块落在恢复采样那天，而不是摊到它所跨过的那些天；采样间隔决定了这个偏差的上界。
- **赠金过期与用量无法区分。** 赠金过期会让余额下降，但并没有产生消费。`grantedMinor` 与 `toppedUpMinor` 的拆分允许部分猜测，但提供方「优先扣减赠金」的规则使二者同时变化，因此上升与赠金失效无法可靠区分。
- **按币种各一条序列，不做换算。** 读数按提供方报告的币种分组，从不换算也不合并；没有汇率接缝。
- **进程重启即重新计时。** 间隔是进程作用域的，因此偶尔才跑一次的 CLI 大约每次运行记录一条读数，而不是每个间隔一条。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

存储域声明为 `per-record`，每种币种一条记录，记录内保存该币种的读数。曾考虑过的替代方案是用单个文档保存全部币种；选择按币种分记录，是因为 `KvTable` 提供 `keys()`/`entries()`，可以在不需要一个「存在哪些币种」的全局槽位的前提下枚举各币种记录。

`withSample` 是该序列唯一的写入者，并且是在它刚读到的内容上追加，这正是读数保持升序的原因。也正因如此，没有运行时不变式去断言这个顺序：它由唯一的写入者建立，而不是两个活对象之间的关系。

</details>
