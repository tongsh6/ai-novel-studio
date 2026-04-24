# Clarification State Schema

> 本文档定义 agent clarification 的对象模型、生命周期和持久化结构。
>
> 它基于：
>
> - [10-agent-orchestration-upgrade.md](./10-agent-orchestration-upgrade.md)
> - [12-slot-policy-table.md](./12-slot-policy-table.md)
> - [13-orchestrator-runtime-spec.md](./13-orchestrator-runtime-spec.md)
> - [15-api-shape-freeze.md](./15-api-shape-freeze.md)
>
> 目标是把 clarification 从“临时 message”升级为“正式状态对象”。

## 1. 为什么 clarification 必须对象化

如果 clarification 只是：

- 一条 assistant 文本
- 一个 `phase = NEEDS_CLARIFICATION`

系统就无法稳定处理：

1. 用户下一句是不是在回答这次 clarification
2. 多轮补槽位
3. clarification 被放弃或被新请求覆盖
4. interaction log 回放

所以 clarification 必须有自己的 state object。

## 2. ClarificationState 顶层结构

```json
{
  "clarification_id": "clar_xxx",
  "work_id": "work_xxx",
  "source_interaction_id": "interaction_xxx",
  "intent": "REFINE_EXISTING_CHARACTER",
  "status": "OPEN",
  "required_fields": ["character_name", "refine_dimensions"],
  "optional_fields": [],
  "current_parameters": {
    "work_name": "两个女人的江湖传说"
  },
  "prompt_message": {
    "role": "assistant",
    "content": "已识别为细化角色设定的请求。当前还缺少角色名和细化方向。"
  },
  "resolution": null,
  "created_at": 1710000000000,
  "updated_at": 1710000000000,
  "closed_at": null
}
```

## 3. 字段定义

### 3.1 `clarification_id`

- 类型：`string`
- 必填
- clarification 对象主键

### 3.2 `work_id`

- 类型：`string`
- 必填
- 该 clarification 所属作品

### 3.3 `source_interaction_id`

- 类型：`string`
- 必填
- 触发本次 clarification 的源 interaction

### 3.4 `intent`

- 类型：`string`
- 必填
- 该 clarification 对应的目标 intent

### 3.5 `status`

- 类型：`string`
- 必填
- 枚举值：
  - `OPEN`
  - `RESOLVED`
  - `ABANDONED`
  - `SUPERSEDED`

### 3.6 `required_fields`

- 类型：`string[]`
- 必填
- 当前仍需补齐才可执行的字段

### 3.7 `optional_fields`

- 类型：`string[]`
- 必填
- 可追问但不阻塞执行的字段

### 3.8 `current_parameters`

- 类型：`object`
- 必填
- 截至当前轮，已经明确或已推断的参数集合

### 3.9 `prompt_message`

- 类型：`object`
- 必填
- clarification 对用户展示的正式消息

结构：

```json
{
  "role": "assistant",
  "content": "..."
}
```

### 3.10 `resolution`

- 类型：`object | null`
- 必填
- clarification 关闭后，记录其结束原因和结果

示例：

```json
{
  "close_reason": "resolved",
  "resolved_by_interaction_id": "interaction_002"
}
```

### 3.11 时间字段

- `created_at`
- `updated_at`
- `closed_at`

统一使用 Unix 毫秒。

## 4. 生命周期

## 4.1 创建

当 Orchestrator 发现：

- slot policy 处理后
- 仍有 `required_to_execute`

则创建 `ClarificationState`：

- `status = OPEN`

并返回：

- `phase = NEEDS_CLARIFICATION`

## 4.2 更新

用户回答 clarification 时：

1. 尝试将输入与当前 `ClarificationState` 绑定
2. 合并参数
3. 重新执行 Router / slot policy
4. 更新 `current_parameters`
5. 更新 `required_fields`
6. 更新 `updated_at`

## 4.3 关闭

clarification 关闭有三种主路径：

### `RESOLVED`

用户补齐必要字段，系统进入执行。

### `ABANDONED`

用户显式取消，或长期未回应。

### `SUPERSEDED`

用户明确发起了新 intent，旧 clarification 不再继续。

## 5. Clarification Merge 规则

## 5.1 绑定优先级

当收到一条新的用户消息时，Orchestrator 判断其是否属于 clarification answer，优先级如下：

1. 前端显式携带 `clarification_target_interaction_id`
2. 存在单个 `OPEN` clarification
3. 无法稳定绑定时，视为新请求

## 5.2 合并规则

合并时：

1. 原 clarification 的 `current_parameters` 作为基础
2. 新消息经过 Router 或 clarification parser 提取出增量参数
3. 增量参数覆盖同名空值，不应无脑覆盖已确认值
4. 合并后重新跑 slot policy

## 5.3 禁止直接字符串拼接

clarification answer 不能靠：

- `"秦婉，狠一点"` 直接拆成字符串片段然后塞字段

它必须经过统一的结构化提取路径。

## 6. 与 Interaction 的关系

clarification 不是 interaction 的替代物，而是 interaction 的附属状态。

关系如下：

- 一条 interaction 可以创建一个 clarification
- clarification 可能跨多条 interaction 被逐步解决
- clarification 关闭后，原始 interaction 仍然保留

建议关系：

```text
interaction_001
  -> creates clarification clar_001

interaction_002
  -> answers clar_001

clar_001
  -> resolved_by interaction_002
```

## 7. 持久化建议

建议新增独立表：

- `clarification_states`

### 推荐字段

| field | type | note |
|---|---|---|
| `id` | `TEXT` | clarification id |
| `work_id` | `TEXT` | 作品 id |
| `source_interaction_id` | `TEXT` | 发起 clarification 的 interaction |
| `intent` | `TEXT` | 对应 intent |
| `status` | `TEXT` | `OPEN/RESOLVED/ABANDONED/SUPERSEDED` |
| `required_fields_json` | `TEXT` | JSON array |
| `optional_fields_json` | `TEXT` | JSON array |
| `current_parameters_json` | `TEXT` | JSON object |
| `prompt_message_json` | `TEXT` | JSON object |
| `resolution_json` | `TEXT` | JSON object |
| `created_at` | `INTEGER` | Unix ms |
| `updated_at` | `INTEGER` | Unix ms |
| `closed_at` | `INTEGER` | Unix ms nullable |

### 建议索引

1. `(work_id, status)`
2. `(source_interaction_id)`

## 8. 与 `AgentTurnResult` 的关系

`AgentTurnResult` 顶层的：

- `clarification`

字段应直接映射当前 clarification state 的公开子集。

公开给前端的最小结构建议：

```json
{
  "clarification_id": "clar_xxx",
  "source_interaction_id": "interaction_xxx",
  "status": "OPEN",
  "required_fields": ["character_name"],
  "optional_fields": [],
  "current_parameters": {
    "work_name": "两个女人的江湖传说"
  }
}
```

注意：

- 不必把完整数据库字段全暴露给前端
- 但要暴露足够信息，支持继续回答 clarification

## 9. 与 Slot Policy 的关系

ClarificationState 不自己判断字段是否阻塞。

它只记录：

- 当前还缺哪些 `required_fields`
- 当前还有哪些 `optional_fields`
- 当前已收集到哪些参数

这些都必须由 slot policy 计算出来。

因此：

> clarification state 是状态对象，不是决策对象。

## 10. 关闭原因规范

`resolution.close_reason` 推荐冻结为：

- `resolved`
- `abandoned`
- `superseded_by_new_intent`

### 说明

#### `resolved`

槽位已补齐，进入执行。

#### `abandoned`

用户放弃，或长时间无回应。

#### `superseded_by_new_intent`

用户发起了新的明确请求，旧 clarification 被覆盖。

## 11. 关键运行案例

## 11.1 需要 clarification

输入：

- “把角色再细一点”

结果：

- 创建 `clarification_state`
- `required_fields = ["character_name", "refine_dimensions"]`
- 返回 `phase = NEEDS_CLARIFICATION`

## 11.2 clarification 解答

下一轮输入：

- “秦婉，狠一点”

结果：

1. 绑定到现有 clarification
2. 提取：
   - `character_name = 秦婉`
   - `refine_dimensions = ["temperament", "behavioral_edge"]`
3. clarification 关闭为 `RESOLVED`
4. 进入执行

## 11.3 clarification 被覆盖

第一轮：

- “把角色再细一点”

第二轮：

- “算了，先总结一下现在情况”

结果：

- 原 clarification `status = SUPERSEDED`
- 新 interaction 独立走 `SUMMARIZE_CURRENT_STATE`

## 12. 非目标

本阶段 clarification schema 不解决：

1. 多 clarification 并发编排
2. 跨作品 clarification 迁移
3. clarification 优先级排序
4. 自动生成结构化表单 UI

这些可以留到后续阶段。

## 13. 结论

没有 `ClarificationState`，clarification 就只是一句临时消息；
有了 `ClarificationState`，clarification 才能成为：

- 可持续
- 可追踪
- 可回放
- 可合并

的正式 agent 运行时对象。
