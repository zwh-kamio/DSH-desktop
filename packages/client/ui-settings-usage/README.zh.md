---
description: "设置页「用量信息」：基于 usage Remote 的 token 合计与按模型折线图，外加账户余额卡与消费金额曲线。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-usage

[English](README.md) | 中文

## Summary

`@deepseek-ai/dsh-client-ui-settings-usage` 在设置弹窗中注册**用量**页。它读取 `usage` Remote 命名空间 —— 按窗口的 token 合计、账户余额、余额读数 —— 并据此渲染四样东西：账户余额卡、按币种的消费金额曲线、按模型的时间折线图，以及它下面的按模型明细表。它不重复计算主机已经决定的任何东西：把 UTC 小时归并成读者自己的「天」是它唯一拥有的算术，因为读者的时区正是主机不持有的那个事实。

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

把它组合进它所注册到的设置外壳所在的 web profile。它注入 `slots`、`locale`、`remote` 与 `remote.usage`。

```yaml
- name: '@deepseek-ai/dsh-client-ui-settings-usage'
```

页面提供三个范围 —— 最近 7 天、最近 30 天、全部 —— 以及模型图的三个口径：总量、输入、输出。

<a id="understand-the-implementation"></a>
## Understand the implementation

**窗口以时刻的形式过线。** 账本按 UTC 分桶，无法知道这个浏览器的时区，因此本区块发送的是它自己那些本地日所覆盖的时刻区间，而不是一个天数。这正是让 UTC+8 的读者看到自己的「天」，而不是从 08:00 开始的一天。

**零用量模型被过滤两次，而第二次才是关键的那次。** 主机已经把窗口内没有用量的路由从合计与每个小时的拆分中都去掉了。它去不掉的是「有用量、但在**当前所选口径下没有用量**」的路由：一个只用过缓存命中的模型，在「输出」口径下没有任何东西可画。这条序列必须消失，而不是画一条贴着 0 的平线 —— `buildChart` 负责丢掉它。

**调色板不循环。** 超出八个色位之后，尾部合并成一条「其他模型」。重复颜色会把两个不同模型画成同一条线，那比少画一条线更糟。

**序列按总量降序排列**，因此色位给到真正承担该窗口的路由，而某个模型离开窗口时不会打乱其余模型已有的颜色。

**消费是差值，而符号就是全部的分类依据。** 提供方不发布消费数字。用量只会让余额下降，因此两次读数之间的下降就是消费，而上升只可能是充值或退款。每个区间记在它**后一次**读数所在的本地日，因为那是它被观察到的时刻；因此采样缺口会整块落在恢复采样那天，而不是被摊到它所跨过的那些天。

**空曲线会说明原因。** 少于两条读数就夹不出任何用量，因此曲线如实说明，而不是画一条从未被测量过的 0 底线。余额读取失败会保留读者已经看到的数字，而不是擦掉一个片刻前还是真的数；余额或历史的失败也绝不会连带把 token 数字拉下去。

**钱在展示之前始终精确。** 余额全程以「分」保存；换算成「元」只在展示边缘的 `formatMoney` 里发生一次。

<a id="model-experience"></a>
## Model Experience

无。本包是浏览器侧对主机用量与余额事实的只读呈现，不注册任何面向模型的东西。

#### KV Cache effect

无；本包既不组装也不发送任何提供方请求。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **只绘制本 Harness 自己发出的请求。** token 数字折叠的是会话事件，因此在提供方控制台或其他工具里做的活儿会出现在余额与消费曲线里，却不在 token 面板里。两者的差额恰好就是那部分。
- **消费的起点就是第一条读数。** 没有任何 API 提供余额历史，因此曲线只能从采样的起点开始，无法回填。
- **采样缺口整块记在某一天。** 曲线本身会说明这一点。采样间隔决定误差上界，想要更细分辨率的部署把它调小即可。
- **赠金过期会显示成消费。** 赠金失效会让余额下降但并没有产生消费，而提供方「优先扣减赠金」的规则使它与用量无法区分。
- **无界范围就是无界请求。** 「全部」会向主机索取它持有的每一个小时桶与每一条读数；在长寿命语料上那是一份很大的负载。
- **表格没有条数上限。** 按模型明细表会列出窗口携带的每一条路由，没有分页。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

两张图都是手写的内联 SVG。仓库没有图表库，也禁止引入组件库，因此每个色位通过 CSS Module 类指向一个 `--dsw-chart-series-*` token；浅色与深色的取值由主题定义，这正是把配色决策挡在组件之外的原因。

两张图**刻意共用** `localDayOfInstant`：token 图从小时桶推导日期，消费曲线从读数时间戳推导日期，而对比这两块面板的读者不应发现它们对「一天从哪开始」的判断不一致。

组件 spec 直接喂 store，而不去驱动 Remote。store 自己的 spec 覆盖线格式，包括「较慢的早先应答不得覆盖读者已经切走的范围」。

</details>
