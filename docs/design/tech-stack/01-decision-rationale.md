# 决策推理过程

> 状态：草案
>
> 目的：把"为什么是 Elixir + React/TS + Tauri"这个结论的推理链路完整记录下来，避免决策黑箱。本文不重复 [`02-alternatives.md`](./02-alternatives.md) 的候选剔除细节，只回答**怎么从约束推到结论**。

---

## 1. 决策上下文

技术栈选型从 2026 年 4 月开始讨论。讨论的起点是：

- 现有 v1 代码（Python + SQLite，位于 `novel_workbench/`）已经被清理（只剩 `__pycache__`）
- v2 设计文档（`docs/design/`）已写到 ADR-0015，14 个 ADR 已冻结
- v2 README §8 第 6 条共识：**代码可以从头开始，现有仓库代码不作为迁移目标**

这意味着技术栈选型不受 v1 历史包袱约束，只受 v2 设计 contract 的约束。

---

## 2. 4 个核心约束的来源

### 约束 1：阶段 1 是开箱即用的桌面应用

**来源**：用户访谈明确表达"单机长期使用，不是 alpha throwaway"。

**对应 v2 文档**：[`../00e-architecture.md`](../00e-architecture.md) §8 部署形态建议（"v2 alpha 单作者本机"），但本约束把它从 alpha 阶段升格为**长期形态**。

**含义**：

- 用户预期：下载安装包 → 双击运行 → 写小说
- 不接受：装 Docker、装数据库、装运行时
- 包体积、启动时间、内存底盘是硬要求

### 约束 2：阶段 2 是 B/S 多用户多作者

**来源**：用户访谈明确"两个大的阶段"。

**对应 v2 文档**：[`../00e-architecture.md`](../00e-architecture.md) §8 第三行（"v2 beta：单服务 + PostgreSQL + 多 provider"）。

**含义**：

- 不是阶段 1 重写，是平滑升级
- 后端代码共享 ≥95%
- 前端代码共享 ~100%

### 约束 3：Multi-Agent 在阶段 1 就是核心功能

**来源**：用户回答"Multi-Agent 什么时候上 → 阶段 1 就是核心功能"。

**对应 v2 文档**：[`../00-overview.md`](../00-overview.md) §4.12 + [`../12-multi-agent-composition.md`](../12-multi-agent-composition.md)。

**含义**：

- 不是阶段 2 才上的扩展点
- 不是只有 LongRunner 一个角色，是 Writer / Reviewer / Planner / LongRunner 多角色并行

### 约束 4：Multi-Agent 是 process-isolated

**来源**：用户回答"具体形态 → 真正的 process-isolated 多 Agent"，进一步三个子需求都明确：

1. 后台 24x7：Reviewer / Maintainer 不间断工作
2. 独立取消：取消一个 Agent 不影响其他
3. Crash isolation：一个 Agent 崩溃，其他存活

**对应 v2 文档**：[`../00-overview.md`](../00-overview.md) §4.12 硬骨：

- "Agent identity"
- "父子 Agent 预算继承（authority/budget 一律收缩）"
- "consumed budget 必须回传父 Agent"
- "子 Agent 默认 tentative_write"
- "handoff 必须保留 agent_ref"

这些条件在 prompt orchestration 模式下**根本无法实现**，必须 process-isolated。

---

## 3. 三轮讨论的关键转折点

### 第 1 轮：偏见暴露

**起点**：列出 5 个栈候选 → 推荐 Python + FastAPI。

**问题**：

1. 候选集没有穷举（直接从"AI 圈子常见栈"缩到 4 个）
2. Java、Kotlin、C#、Elixir 被无意识丢掉
3. 论证过程黑箱（用户无法区分"考虑过 Java 觉得不合适"和"根本没想到"）

**转折**：用户问"为什么没考虑 Java"，触发偏见审计。

**修正**：识别为"圈子默认值偏见"——做栈对比时没先穷举候选集再剔除，而是直接进入小范围深度对比。

### 第 2 轮：完整候选 + 透明剔除

**起点**：18 个候选 → 11 个剔除 → 5+1 short-list → 5 trade-off。

**关键发现**：

- Python vs Java 是真正的对决，不是 Python 一家独大
- 评分维度的权重决定胜负（Python 重"实验速度"，Java 重"严格契约"）
- 没有用户偏好信息时，给"等权评分"等于偷换权重

**转折**：用户提供"前后端一起考虑 + 两个阶段（单机长期 + B/S）"权重信号。

**修正**：评估维度从 10 维换成 5+5（5 个新增的两阶段相关维度 + 5 个原维度）。

### 第 3 轮：Multi-Agent 的形态决定一切

**起点**：基于"两阶段 + 桌面应用 + B/S 不预设大规模"推荐 TypeScript 全栈。

**关键转折**：用户回答"Multi-Agent 阶段 1 就是核心功能"。

**进一步**：用户问"prompt orchestration 和真正独立的区别是什么"，触发概念辨析。

**联合杀手条件**：用户三个子问题全部回答 process-isolated 这一边：

- 后台 24x7 ✅
- 独立取消 ✅
- Crash isolation ✅

**最终锁定**：Elixir + OTP 是唯一能在桌面应用 + multi-agent + 阶段平滑切换三角约束下满足所有需求的栈。

---

## 4. 最终方案的杠杆

为什么 Elixir 在这个项目能"以小社区博大局"？因为它**精准命中所有约束**：

### 杠杆 1：OTP 是 §12 multi-agent 的本主场

| §12 硬骨 | OTP 原生支持 |
|---|---|
| Agent identity | Process registry (`Registry`, `:global`) |
| 父子关系 | Supervision tree (`Supervisor`) |
| 消息协议 | Process mailbox + `GenServer.call/cast` |
| Crash isolation | Process linking/monitoring + Supervisor restart |
| Budget 计量 | Reduction-based scheduling + ETS |
| 跨节点（阶段 2） | Distributed Erlang 原生 |

TS / Python / Java / C# 做这些是"模拟 Actor 模型"，Elixir 是"Actor 模型本身就是基因"。

### 杠杆 2：单机 ↔ 多节点是同一架构

Distributed Erlang 让"单机 OTP" 和 "多节点 OTP cluster" 在业务代码层面是**同一个东西**：

- `send(pid, msg)` 在单机和跨节点是同样的代码
- `Phoenix.PubSub.broadcast/3` 在单节点和跨节点是同样的 API
- supervision tree 在单节点和多节点是同样的语义

这让阶段 1 → 阶段 2 切换的成本压到最低。

### 杠杆 3：Mix Release 是单二进制部署

- `mix release` 产出 ~30MB 单二进制（含 Erlang VM + 所有 deps）
- Tauri 2 sidecar 直接调用这个二进制
- 阶段 2 移除 Tauri 壳，同二进制 `--port 8080` 即可上线

### 杠杆 4：Phoenix 不是 LiveView，是 API server

- Phoenix Channels 提供 WebSocket（适合流式 + Multi-Agent 进度推送）
- 前端独立 React/TS SPA
- 没有 LiveView 的"server-rendered + 状态在服务端"限制

---

## 5. 推荐 confidence 与会动摇推荐的条件

**当前 confidence**：90%+

**会让推荐重新评估的 3 个外部条件**：

| 条件 | 触发条件 | 重新评估方向 |
|---|---|---|
| **团队限制** | 团队完全无法吃 Elixir 学习曲线（6-12 周到 productive 不可接受） | 退到 C# + Orleans（决赛对手，详见 [`02-alternatives.md`](./02-alternatives.md) §5） |
| **LLM 实验需求** | 产品差异化必须依赖 Python 独有工具（DSPy/Outlines/Marvin 深度集成） | 后端切 Python + FastAPI + asyncio Process Pool；接受 multi-agent 表达力下降 |
| **需求变化** | 不再做 multi-agent / 放弃桌面应用形态 | 重启决策，约束变了结论必变 |

如果以上 3 条都不出现，技术栈基线**不应该**因为讨论或团队偏好而修改。

---

## 6. 三个非约束信号

讨论中出现过的、**不应该影响推荐**的信号：

### 信号 1："AI 项目默认 Python"

**审计结果**：圈子文化默认值，不是项目论据。Python 在 LLM 实验工具上有优势，但本项目的核心约束是 multi-agent + 桌面应用，Python 在这两条上不是最优。

### 信号 2："JVM 启动慢，避开 Java 阵营"

**审计结果**：部分正确但不构成排除 Kotlin。最终 Kotlin 被排除是因为 OTP 在 multi-agent 上压倒性优势，不是 JVM 启动慢。

### 信号 3："Elixir 招人难"

**审计结果**：是真问题，但属于**风险**，不是**否决条件**。详见 [`13-risks.md`](./13-risks.md) §3。

---

## 7. 反偏见审计

为防止本次决策仍带未识别的偏见，列出所有"我可能没充分考虑过的"角度：

| 角度 | 是否充分考虑 |
|---|---|
| Akka.NET / Akka Scala（actor model on JVM） | ✅ 详见 [`02-alternatives.md`](./02-alternatives.md) §5 第二轮决赛 |
| Pony / Erlang 直接用 | ✅ Pony 太小众，Erlang 比 Elixir 语法老旧 |
| Rust + ractor / actix-actors | ✅ actix 已废弃，ractor 不成熟，schema 演化期开发速度问题 |
| Java Loom + StructuredTaskScope | ✅ virtual thread ≠ Actor，没有 process isolation |
| Go + goroutine | ✅ CSP ≠ Actor，没有 supervision tree |
| C# + Orleans | ✅ 详见 [`02-alternatives.md`](./02-alternatives.md) §5 决赛对比，单机部署偏重输给 Elixir |
| TypeScript + XState v5 | ✅ 单进程内模拟 Actor，不是真隔离 |
| Tauri vs Electron | ✅ 详见 [`05-desktop.md`](./05-desktop.md) §2 |
| Phoenix vs Plug | ✅ Phoenix 提供 Channels（WebSocket），Plug 太底层 |
| pglite / ElectricSQL（嵌入式 PG） | ⚠️ 暂未深度评估，可能在 [`06-database.md`](./06-database.md) 后续展开 |
| Compose Multiplatform Web | ✅ 还在快速迭代，不适合做单机长期形态 |

如果发现新的、值得评估的角度，应作为 ADR 在 `../adr/` 立项后再修改本目录。

---

## 8. 决策时间线

| 日期 | 事件 |
|---|---|
| 2026-04-26 | 第 1 轮讨论：Python + FastAPI 推荐，候选集不完整，被偏见审计触发 |
| 2026-04-26 | 第 2 轮讨论：18 候选透明剔除，5+1 short-list，权重未确定 |
| 2026-04-26 | 第 3 轮讨论：Multi-Agent 形态确认 process-isolated，Elixir 锁定 |
| 2026-04-26 | 本目录建立，决策推理文档化 |

后续重大变更应在此处追加。
