# Turn And Task State Machines v2

> 状态：草案
>
> 角色：`docs/design-v2/01-agent-foundation-contract.md` 的状态机展开文档，并与 `06-planning-and-long-run.md`、`12-multi-agent-composition.md` 共同构成运行时基础。
>
> 目标：定义 v2 Foundation 中与运行时直接相关的核心状态机，包括 turn、clarification、confirmation、long-run task、delegation、artifact adoption，并统一 phase / status / terminal semantics。

---

## 1. 文档定位

本文回答 6 个问题：

1. Foundation 中哪些实体必须有状态机
2. `phase` 和 `status` 到底如何分工
3. 各状态机允许哪些合法迁移
4. 什么是终态，为什么终态不可逆
5. 恢复、取消、覆盖、分支如何在状态机上表达
6. 哪些状态必须被 UI 和日志显式消费

本文不负责：

- 各业务 intent 的具体执行条件
- 具体 JSON schema 字段细节
- budget 或 revision 计算公式

本文只冻结运行时状态语义。

---

## 2. 设计目标

### 2.1 状态机必须是运行语义，不是文案标签

状态不只是给 UI 上色。

它必须决定：

- 系统下一步可以做什么
- 用户下一步可以做什么
- 哪些动作非法
- 哪些恢复路径存在

### 2.2 phase 与 status 必须分离

`phase` 表示流程位置。  
`status` 表示当前执行态或等待态。

两者一旦混用，后面：

- UI 会乱
- 日志会乱
- resume / retry / cancel 会乱

### 2.3 所有终态必须不可逆

已完成、已失败、已取消、已过期，不应被原地改回运行态。

后续变化必须通过：

- 新事件
- 新实体
- 新 turn
- 新 task

表达。

### 2.4 所有恢复都必须有边界

resume、reopen、re-delegate 这类动作不能是“把状态改回去”。

恢复必须经过显式恢复节点。

---

## 3. 状态机适用对象

Foundation 层必须为以下对象定义状态机：

1. turn
2. clarification
3. confirmation
4. long-run task
5. delegation
6. artifact adoption

说明：

- `execution unit` 可以有局部状态机，但不属于本文的顶层公共状态机。
- Domain 对象如 chapter / scene / draft 的业务状态机，不在本文定义。

---

## 4. phase 与 status

### 4.1 `phase`

`phase` 表示：

- 当前运行流程处在哪个阶段
- 系统正在做哪类工作

它偏工作流语义。

### 4.2 `status`

`status` 表示：

- 当前对象是等待中、运行中、完成、错误还是暂停
- 当前是否需要外部动作

它偏可执行态语义。

### 4.3 基本约束

约束如下：

1. 同一个对象可以有 `phase` 和 `status`
2. `phase` 不是 HTTP 状态码
3. `status` 不是 UI 展示文案
4. phase 负责“在哪一步”，status 负责“现在什么态”

### 4.4 Foundation 推荐通用 status

> ADR-0002 已将本 status family 冻结为 8 个 canonical 值，并约定 schema `$id` 为 `foundation/enums/status.json`。

Foundation 推荐至少保留以下抽象 status：

- `READY`
- `WAITING_USER`
- `WAITING_SYSTEM`
- `RUNNING`
- `PAUSED`
- `DONE`
- `ERROR`
- `CANCELLED`

最终各对象不一定全用，但不能绕开这些基本语义。

---

## 5. turn 状态机

turn 是单轮交互的最小闭环。

### 5.1 turn phase

> ADR-0002 已冻结本节 turn phase 集合。

```text
RECEIVED
  -> ROUTED
  -> NEEDS_CLARIFICATION
  -> NEEDS_CONFIRMATION
  -> READY_TO_EXECUTE
  -> EXECUTING
  -> COMPLETED
  -> FAILED
  -> CANCELLED
```

### 5.2 turn status 映射

> ADR-0002 已冻结本节 phase → status 映射。

推荐映射：

| phase | status |
|---|---|
| `RECEIVED` | `WAITING_SYSTEM` |
| `ROUTED` | `READY` |
| `NEEDS_CLARIFICATION` | `WAITING_USER` |
| `NEEDS_CONFIRMATION` | `WAITING_USER` |
| `READY_TO_EXECUTE` | `READY` |
| `EXECUTING` | `RUNNING` |
| `COMPLETED` | `DONE` |
| `FAILED` | `ERROR` |
| `CANCELLED` | `CANCELLED` |

### 5.3 合法迁移

```text
RECEIVED -> ROUTED
ROUTED -> NEEDS_CLARIFICATION
ROUTED -> NEEDS_CONFIRMATION
ROUTED -> READY_TO_EXECUTE
ROUTED -> COMPLETED
ROUTED -> FAILED

NEEDS_CLARIFICATION -> COMPLETED
NEEDS_CLARIFICATION -> CANCELLED

NEEDS_CONFIRMATION -> READY_TO_EXECUTE
NEEDS_CONFIRMATION -> CANCELLED

READY_TO_EXECUTE -> EXECUTING
READY_TO_EXECUTE -> CANCELLED
READY_TO_EXECUTE -> FAILED

EXECUTING -> COMPLETED
EXECUTING -> FAILED
EXECUTING -> CANCELLED
```

### 5.4 说明

- `ROUTED -> COMPLETED` 用于无需执行的结果型 turn
- `NEEDS_CLARIFICATION` 和 `NEEDS_CONFIRMATION` 本轮本身可以被视作已完成输出，但 turn phase 仍要显式保留其等待性质
- `CANCELLED` 对 turn 来说是少见但合法终态

### 5.5 turn 终态

turn 的终态：

- `COMPLETED`
- `FAILED`
- `CANCELLED`

turn 终态不可逆。

后续回答 clarification 或 confirmation，必须形成新 turn。

---

## 6. clarification 状态机

clarification 是一个附属于 turn 的行为状态对象。

### 6.1 clarification phase / status

clarification 不需要复杂 phase，核心是 lifecycle status：

```text
OPEN
  -> RESOLVED
  -> SUPERSEDED
  -> ABANDONED
  -> EXPIRED
```

建议 status 语义：

| clarification state | status |
|---|---|
| `OPEN` | `WAITING_USER` |
| `RESOLVED` | `DONE` |
| `SUPERSEDED` | `DONE` |
| `ABANDONED` | `CANCELLED` |
| `EXPIRED` | `ERROR` |

### 6.2 合法迁移

```text
OPEN -> RESOLVED
OPEN -> SUPERSEDED
OPEN -> ABANDONED
OPEN -> EXPIRED
```

clarification 没有 reopen。

### 6.3 关闭原因与终态

clarification 的关闭不是一概而论。

最少需要区分：

- 用户已回答并解决
- 用户发了新意图导致旧 clarification 失效
- 用户主动放弃
- 超时或策略过期

这些关闭原因必须进入 resolution record。

---

## 7. confirmation 状态机

confirmation 用于高风险或高消耗动作的确认门。

### 7.1 confirmation 生命周期

```text
OPEN
  -> CONFIRMED
  -> REJECTED
  -> SUPERSEDED
  -> EXPIRED
```

建议 status 语义：

| confirmation state | status |
|---|---|
| `OPEN` | `WAITING_USER` |
| `CONFIRMED` | `DONE` |
| `REJECTED` | `CANCELLED` |
| `SUPERSEDED` | `DONE` |
| `EXPIRED` | `ERROR` |

### 7.2 合法迁移

```text
OPEN -> CONFIRMED
OPEN -> REJECTED
OPEN -> SUPERSEDED
OPEN -> EXPIRED
```

### 7.3 confirmation 与 turn 的关系

confirmation 对象终结后，真正执行动作必须进入新 turn 或继续父级 task 的下一节点。

不能把 `OPEN -> CONFIRMED` 理解为“动作已经完成”。

---

## 8. long-run task 状态机

long-run task 是跨 turn 运行对象。

### 8.1 task phase

> ADR-0002 已冻结本节 task phase 集合。

```text
PLANNED
  -> ESTIMATED
  -> CONFIRMATION_REQUIRED
  -> CONFIRMED
  -> RUNNING
  -> CHECKPOINT
  -> RESUMING
  -> RUNNING
  -> COMPLETED
  -> CANCELLED
  -> FAILED
  -> BRANCHED
```

### 8.2 task status 映射

> ADR-0002 已冻结本节 task phase → status 映射。

推荐映射：

| task phase | status |
|---|---|
| `PLANNED` | `READY` |
| `ESTIMATED` | `READY` |
| `CONFIRMATION_REQUIRED` | `WAITING_USER` |
| `CONFIRMED` | `READY` |
| `RUNNING` | `RUNNING` |
| `CHECKPOINT` | `PAUSED` |
| `RESUMING` | `WAITING_SYSTEM` |
| `COMPLETED` | `DONE` |
| `CANCELLED` | `CANCELLED` |
| `FAILED` | `ERROR` |
| `BRANCHED` | `DONE` |

### 8.3 合法迁移

```text
PLANNED -> ESTIMATED
ESTIMATED -> CONFIRMATION_REQUIRED
ESTIMATED -> CONFIRMED
ESTIMATED -> CANCELLED
ESTIMATED -> FAILED

CONFIRMATION_REQUIRED -> CONFIRMED
CONFIRMATION_REQUIRED -> CANCELLED
CONFIRMATION_REQUIRED -> CANCELLED  (when confirmation object expires and policy chooses cancellation)
CONFIRMATION_REQUIRED -> FAILED     (when confirmation object expires and policy chooses failure)

CONFIRMED -> RUNNING
CONFIRMED -> CANCELLED
CONFIRMED -> FAILED

RUNNING -> CHECKPOINT
RUNNING -> COMPLETED
RUNNING -> CANCELLED
RUNNING -> FAILED

CHECKPOINT -> RESUMING
CHECKPOINT -> COMPLETED
CHECKPOINT -> CANCELLED
CHECKPOINT -> FAILED
CHECKPOINT -> BRANCHED

RESUMING -> RUNNING
RESUMING -> CHECKPOINT
RESUMING -> FAILED
RESUMING -> CANCELLED
```

### 8.4 task 终态

task 终态：

- `COMPLETED`
- `CANCELLED`
- `FAILED`
- `BRANCHED`

### 8.5 关于 `BRANCHED`

`BRANCHED` 不是失败，也不是完成原路径。

它表达的是：

- 原 task 已结束自己的主路径责任
- 一个或多个新 task 承接了后续分支

---

## 9. delegation 状态机

delegation 是父 Agent 与子 Agent 之间的委派对象。

### 9.1 delegation phase

```text
PLANNED
  -> DISPATCHED
  -> RUNNING
  -> PAUSED
  -> ARTIFACT_RETURNED
  -> AWAITING_PARENT_DECISION
  -> ACCEPTED
  -> REJECTED
  -> CANCELLED
  -> FAILED
```

### 9.2 delegation status 映射

| delegation phase | status |
|---|---|
| `PLANNED` | `READY` |
| `DISPATCHED` | `WAITING_SYSTEM` |
| `RUNNING` | `RUNNING` |
| `PAUSED` | `PAUSED` |
| `ARTIFACT_RETURNED` | `WAITING_SYSTEM` |
| `AWAITING_PARENT_DECISION` | `WAITING_USER` or `WAITING_SYSTEM` |
| `ACCEPTED` | `DONE` |
| `REJECTED` | `DONE` |
| `CANCELLED` | `CANCELLED` |
| `FAILED` | `ERROR` |

### 9.3 合法迁移

```text
PLANNED -> DISPATCHED
DISPATCHED -> RUNNING
RUNNING -> PAUSED
RUNNING -> ARTIFACT_RETURNED
RUNNING -> FAILED
RUNNING -> CANCELLED

PAUSED -> RUNNING
PAUSED -> CANCELLED
PAUSED -> FAILED

ARTIFACT_RETURNED -> AWAITING_PARENT_DECISION
AWAITING_PARENT_DECISION -> ACCEPTED
AWAITING_PARENT_DECISION -> REJECTED
AWAITING_PARENT_DECISION -> CANCELLED
AWAITING_PARENT_DECISION -> FAILED
```

### 9.4 delegation 终态

delegation 终态：

- `ACCEPTED`
- `REJECTED`
- `CANCELLED`
- `FAILED`

---

## 10. artifact adoption 状态机

artifact 与 adoption 必须分开看。

这里定义的是 artifact 在 adoption 维度上的状态。

### 10.1 artifact adoption lifecycle

> adoption 7 态的 canonical 权威为 `30-contract-glossary.md` §3.2 + ADR-0001；ADR-0002 仅冻结其到 Foundation status 的消费映射，不重定义 adoption 语义。

```text
TENTATIVE
  -> ACCEPTED
  -> EDITED_ACCEPTED
  -> DISCARDED
  -> SUPERSEDED
  -> INVALIDATED
  -> ARCHIVED
```

### 10.2 status 语义

| artifact state | status |
|---|---|
| `TENTATIVE` | `PAUSED` |
| `ACCEPTED` | `DONE` |
| `EDITED_ACCEPTED` | `DONE` |
| `DISCARDED` | `CANCELLED` |
| `SUPERSEDED` | `DONE` |
| `INVALIDATED` | `ERROR` |
| `ARCHIVED` | `DONE` |

说明：

- `TENTATIVE` 本身不是错误，只是尚未进入 authoritative state；ADR-0002 将其收敛为 `PAUSED`，可采纳性由 `next_action=ADOPT_ARTIFACTS` 或 adoption card 表达，不再用 `READY` 表达
- `INVALIDATED` 表示其前提或适用范围失效

### 10.3 合法迁移

```text
TENTATIVE -> ACCEPTED
TENTATIVE -> EDITED_ACCEPTED
TENTATIVE -> DISCARDED
TENTATIVE -> SUPERSEDED
TENTATIVE -> INVALIDATED

ACCEPTED -> ARCHIVED
EDITED_ACCEPTED -> ARCHIVED
DISCARDED -> ARCHIVED
SUPERSEDED -> ARCHIVED
INVALIDATED -> ARCHIVED
```

### 10.4 不允许的迁移

至少包括：

- `ACCEPTED -> TENTATIVE`
- `DISCARDED -> TENTATIVE`
- `INVALIDATED -> ACCEPTED`（除非创建新 artifact 或新 adoption attempt）

---

## 11. phase / status 与 next action 的关系

`next_action` 不是状态，但必须和状态机相容。

### 11.1 基本映射原则

> ADR-0002 已冻结 canonical `next_action` 集合与兼容表。`CANCEL_TASK` 是 task context 的 canonical `next_action`；`EXECUTE_DIRECTLY` 不是 canonical `next_action`，执行许可由 phase + policy 决定。

例如：

- `NEEDS_CLARIFICATION` 通常对应 `ASK_USER`
- `NEEDS_CONFIRMATION` 通常对应 `CONFIRM_BEFORE_EXECUTE`
- `CHECKPOINT` 通常对应 `RESUME_TASK`、`ADOPT_ARTIFACTS`、`CANCEL_TASK`
- `FAILED` 通常对应 `RETRY_SYSTEM` 或 `NO_FURTHER_ACTION`

### 11.2 不允许矛盾组合

例如：

- `phase = COMPLETED` 却给历史/非 canonical `next_action = EXECUTE_DIRECTLY`
- `phase = RUNNING` 却给 `next_action = ASK_USER`

这些都应视为 contract 违例。ADR-0002 进一步规定：允许列是完整 allowlist，未列入允许集合的 `phase × next_action` 组合默认禁止。

---

## 12. 终态与后续动作

终态不可逆，但终态之后仍可有新动作。

### 12.1 turn 终态后的动作

例如：

- 新 turn 回答 clarification
- 新 turn 继续 task
- 新 turn 发起 correction

### 12.2 task 终态后的动作

例如：

- 从 `CHECKPOINT` 分支生成新 task
- 从 `COMPLETED` task 的 artifact 再做 adoption
- 从 `FAILED` task 派生修复 task

### 12.3 artifact 终态后的动作

例如：

- `DISCARDED` 后保留审计
- `SUPERSEDED` 后保留来源关系
- `INVALIDATED` 后创建新 artifact 重做

---

## 13. 中断与恢复语义

### 13.1 中断不是终态

中断通常表现为：

- `CHECKPOINT`
- `PAUSED`
- `WAITING_USER`
- `WAITING_SYSTEM`

### 13.2 恢复必须显式经过中间状态

例如：

```text
CHECKPOINT -> RESUMING -> RUNNING
PAUSED -> RUNNING
```

### 13.3 恢复不能原地改终态

例如不允许：

```text
FAILED -> RUNNING
CANCELLED -> RUNNING
COMPLETED -> RUNNING
```

需要新实体或新事件。

---

## 14. 覆盖、放弃、过期

这三类语义必须分清。

### 14.1 superseded

表示：

- 旧状态被新路径覆盖
- 旧实体仍保留历史意义

适用：

- clarification
- confirmation
- artifact

### 14.2 abandoned

表示：

- 用户或系统主动放弃
- 不再继续该对象的等待或求解

适用于 clarification 等行为状态。

### 14.3 expired

表示：

- 因时间或策略过期
- 不是明确选择，而是失去继续执行资格

适用：

- clarification
- confirmation
- 某些 lease-like runtime handles

---

## 15. 与 consistency 的关系

状态机不负责做一致性判定，但必须给一致性结果留出口。

### 15.1 一致性结果常见映射

- consistency conflict -> `CHECKPOINT`
- adoption blocked -> artifact `INVALIDATED` 或 `TENTATIVE + blocked reason`
- stale task resume -> `CHECKPOINT` 或 `FAILED`

### 15.2 状态机不能吞掉冲突

不能因为想维持“流程顺畅”就让冲突静默跨过去。

---

## 16. 与 UI 的关系

UI 必须直接消费这些状态机，不自行发明平行状态。

### 16.1 UI 必须能投影的状态

至少包括：

- turn 等待 clarification
- turn 等待 confirmation
- task running
- task checkpoint paused
- delegation awaiting parent decision
- artifact tentative / accepted / invalidated

### 16.2 UI 不应自己推断的内容

例如：

- “按钮在转所以应该是 RUNNING”
- “卡片没消失所以应该还是 OPEN”

必须以显式状态为准。

---

## 17. 与日志与审计的关系

每次状态迁移都应能被事件化记录。

### 17.1 最低事件粒度

至少应支持：

- state_changed
- terminal_reached
- resumed
- cancelled
- invalidated
- superseded

### 17.2 记录要求

每条迁移事件至少记录：

- entity type
- entity ref
- from state
- to state
- cause
- actor
- source turn / task
- timestamp

---

## 18. 契约测试要求

### 18.1 合法迁移测试

验证每个状态机的合法迁移能通过。

### 18.2 非法迁移测试

验证：

- 终态不可逆
- 非法跨级跳转被拒绝

### 18.3 phase / status 一致性测试

验证：

- phase 与 status 映射合法
- next_action 不与状态矛盾
- `next_action` 只允许 ADR-0002 冻结的 8 个 canonical 值
- `phase × next_action` 组合符合 ADR-0002 allowlist

### 18.4 恢复路径测试

验证：

- checkpoint -> resume -> running
- paused -> running
- open clarification -> resolved

---

## 19. 本文冻结的硬骨

本文正式冻结以下状态机硬骨：

1. Foundation 至少有 6 套核心状态机：turn / clarification / confirmation / task / delegation / artifact adoption
2. `phase` 与 `status` 必须分离
3. 所有终态不可逆
4. 恢复必须经过显式恢复路径，而不是把终态改回运行态
5. `CHECKPOINT` 是正式状态，不是错误文案
6. `ACCEPTED` 不等于“这个 artifact 没历史了”，其来源与 superseded / invalidated 关系仍要保留
7. `BRANCHED` 是 task 的正式终态之一
8. `NEEDS_CLARIFICATION` 与 `NEEDS_CONFIRMATION` 都是 turn 的正式运行状态
9. turn / task / artifact 状态枚举、status family、`next_action` 集合与兼容表由 ADR-0002 冻结

---

## 20. 本文暂不冻结的内容

以下只定语义，不定最终字段：

1. 所有对象的完整 JSON schema
2. status 枚举是否进一步细分（如需细分必须新 ADR；ADR-0002 已冻结当前 8 态 family）
3. 是否需要为某些对象引入 sub-phase
4. `AWAITING_PARENT_DECISION` 的 UI 命名

---

## 21. 下一步

状态机之后，最自然的下一份文档是：

1. `03-conversation-behaviors.md`

因为 clarification、confirmation、cancellation、correction、rejection 这些行为已经有了状态位置，下一步应把它们的协议与交互语义补齐。
