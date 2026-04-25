# 文档导航：按角色找入口

> 状态：草案
>
> 角色：v2 设计文档共 30+ 份，新人不知道从哪读起。本文按角色给 4 条阅读路径，每条都标了时间预算与"读完能回答什么问题"。
>
> 用法：先看 §0 选定身份，按编号顺序读，时间预算是真实测算（按 200 字/分钟阅读 + 看图时间）。

---

## 0. 选你的身份

| 身份 | 路径 | 总时间 | 看完能干什么 |
|---|---|---|---|
| 完全没看过，10 分钟先了解 | §1 | 10 min | 在饭桌上讲清楚这是什么 |
| UI 设计师 / 设计原型 | §2 | ~70 min | 开始画 40-47 与 .pen |
| 后端 / Agent 实现工程师 | §3 | ~160 min | 开始落 Foundation 子系统 |
| 产品 / 作者 / 评估范围 | §4 | ~70 min | 判断 v2 能不能解决你的写作问题 |
| 维护者 / 修改 contract | §5 | ~120 min | 提 ADR / 改 contract 不破规矩 |

不在以上 5 类？看 §1 + §3 头 3 步，再按兴趣跳。

---

## 1. 10 分钟速览路径

| # | 文档 | 时间 | 读完能回答 |
|---|---|---|---|
| 1 | `README.md` §1 + §8 | 4 min | 这个项目想做什么、当前共识是什么 |
| 2 | `00a-system-landscape.md` | 3 min | 项目分几层、每层有什么、做到哪了 |
| 3 | `00b-end-to-end-flow.md` §1-2 | 3 min | 用户输入怎么变成成品 |

读完这 3 份你就能在饭桌上讲清楚 v2 是什么。

---

## 2. UI 设计师路径

> 读完能开始写 `ui-design/40-ui-overview.md` 并向 `pencil` 投放原型。

| # | 文档 | 时间 | 读完能回答 |
|---|---|---|---|
| 1 | `README.md` §5 | 3 min | UI 阶段在整体设计里的位置 |
| 2 | `00a-system-landscape.md` | 3 min | UI 哪些前置已就绪、哪些没 |
| 3 | `00b-end-to-end-flow.md` 全文 | 5 min | 数据流 → UI 应该响应哪些状态 |
| 4 | `39-ui-design-implementation-plan.md` | 10 min | UI 文档写作顺序与验收标准 |
| 5 | `11-ux-contract.md` | 15 min | UI 必须消费的 contract |
| 6 | `adr/0001-turn-result-v2-schema.md` §3 五条读取路径 | 5 min | 每个 UI 元素该从哪个字段读 |
| 7 | `adr/0006-card-action-schema.md` | 10 min | 卡片协议 |
| 8 | `adr/0008-first-batch-intents.md` + `adr/0010-...slot-schema.md` | 10 min | 引导对话流的最小 intent / slot |
| 9 | `03-conversation-behaviors.md` | 10 min | clarification / confirmation / 等待态语义 |
| 10 | `27-reading-projection.md` + `adr/0011-...refresh.md` | 10 min | 阅读模式从哪取数 |

提示：

- 不要先读 04 / 05 / 06 / 07 / 12，那是 Agent 内部，UI 不需要。
- 不要先读 21 / 22 / 23，那是 Domain 对象细节，等画 43-structure-panel 再回头读。
- 看到 ADR Accepted = 不要修改，只投影；看到草案 = 可以反向反馈但不能跳过。

---

## 3. 后端 / Agent 实现工程师路径

> 读完能开始落 Foundation 子系统代码。

### 3.1 主干（必读，~110 min）

| # | 文档 | 时间 | 读完能回答 |
|---|---|---|---|
| 1 | `README.md` §1 / §3 / §7 | 5 min | 设计纪律与执行顺序 |
| 2 | `00-overview.md` | 15 min | Layer 1 / Layer 2 边界，全局术语 |
| 3 | `00a-system-landscape.md` | 3 min | 12 个 Foundation 子系统全貌 |
| 4 | `00b-end-to-end-flow.md` 全文 | 5 min | 主链路 |
| 5 | `01-agent-foundation-contract.md` | 20 min | Foundation 总边界 |
| 6 | `02-turn-and-task-state-machines.md` + `adr/0002-state-enums.md` | 20 min | 状态机权威 |
| 7 | `adr/0001-turn-result-v2-schema.md` | 10 min | 顶层 schema |
| 8 | `04-capability-and-intent-registry.md` + `adr/0008` + `adr/0010` | 20 min | router / executor / validator |
| 9 | `00d-state-machine-atlas.md` | 10 min | adoption / projection / long-run 三套状态机 |

读到这里你能写 turn loop 主框架了。

### 3.2 长跑 / 一致性 / 多 agent（~50 min）

| # | 文档 | 时间 | 适用场景 |
|---|---|---|---|
| 10 | `06-planning-and-long-run.md` | 15 min | 当你要实现 long-run task |
| 11 | `07-consistency-and-concurrency.md` | 15 min | 当你要处理 revision / 并发 |
| 12 | `12-multi-agent-composition.md` | 15 min | 当你要做子 agent / parent-child 预算 |
| 13 | `08-provider-abstraction.md` | 5 min | 接 LLM provider 时 |

### 3.3 上下文与记忆（按需）

| 文档 | 适用场景 |
|---|---|
| `05-memory-retention-and-retrieval.md` | 实现冷热记忆、summary、retrieval |
| `26-context-assembly-policy.md` | 给 Router/Executor/LongRunner/Reader 拼上下文 |
| `09-observability-and-audit.md` | 加 trace / log / replay |
| `10-security-and-budget.md` | 加预算门禁 / 写入权限 |

跳过建议：第一版可以先不做 `12-multi-agent`，等单 agent 跑通再加。

---

## 4. 产品 / 作者 / 评估路径

> 读完能判断"v2 能不能解决我的连载写作问题"。

| # | 文档 | 时间 | 读完能回答 |
|---|---|---|---|
| 1 | `00-overview.md` §1 §2 | 10 min | 项目定位、解决什么问题 |
| 2 | `00b-end-to-end-flow.md` §1 §2 | 5 min | 用户视角的主流程 |
| 3 | `28-authoring-lifecycle.md` | 15 min | 立项→连载→修订全生命周期 |
| 4 | `24-novel-intent-catalog.md` | 15 min | 系统支持的小说创作动作清单 |
| 5 | `31-novel-quality-gates.md` | 10 min | 系统会拦截哪些质量问题 |
| 6 | `32-human-approval-policy.md` | 10 min | 哪些动作必须作者亲自确认 |
| 7 | `27-reading-projection.md` §1 §3 | 5 min | 阅读模式怎么呈现作品 |

跳过建议：

- 所有 0X / 1X Foundation 文档（除非你想理解技术边界）
- 所有 ADR（除非你想理解为什么某条决策是这样）

---

## 5. 维护者 / 改 contract 路径

> 读完能正确提一份 ADR，不破坏现有冻结约束。

| # | 文档 | 时间 |
|---|---|---|
| 1 | `README.md` §6 ADR 与决策纪律 | 3 min |
| 2 | `adr/README.md` + `adr/0000-index.md` | 5 min |
| 3 | `30-contract-glossary.md` 全文 | 20 min |
| 4 | `29-design-integrity-review.md` §7 冻结清单 | 10 min |
| 5 | 任意一份 Accepted ADR（推荐 0001 或 0002）做范文 | 15 min |
| 6 | 你要改的子系统对应的 Foundation/Domain 文档 | 30-60 min |

提交规则速记：

1. 同一语义只能有一个 canonical 名（30 §1）
2. 改 Foundation/Domain 硬骨必须先写 ADR（README §6）
3. ADR-0001 / 0002 的字段名是机器可校验的，不要改名只能改语义
4. UI 不能反向驱动 Foundation（README §2）

---

## 6. 通用反模式（任何角色都别这么读）

- ❌ 从 `00-overview.md` 一字一句往下读：太长，迷路。
- ❌ 先读 ADR：ADR 是结论，没有上下文看不懂。
- ❌ 跳过 `30-contract-glossary.md` 直接看实现：术语漂移会让你白做。
- ❌ 把 39 当 UI 设计文档：39 是计划不是 contract。
- ❌ 把 29 §7 当 TODO 自己开干：先看每条是否已有 ADR 闭合（多数已闭合）。

---

## 7. 配套阅读

- `00a-system-landscape.md`：分层全景图
- `00b-end-to-end-flow.md`：主链路
- `00d-state-machine-atlas.md`：3 套关键状态机
- `examples/end-to-end-trace-001.md`：用具体 prompt 走完全链路
