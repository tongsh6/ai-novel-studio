# Agent Orchestrator Runtime Spec

> 本文档是以下文档的运行时补充：
>
> - [10-agent-orchestration-upgrade.md](./10-agent-orchestration-upgrade.md)
> - [11-agent-turn-result-schema.md](./11-agent-turn-result-schema.md)
> - [12-slot-policy-table.md](./12-slot-policy-table.md)
>
> 目标不是定义新概念，而是把 Orchestrator 在一次真实交互中的行为顺序、状态迁移、日志写入和接口语义定成可实现规格。

## 1. Orchestrator 的职责

Orchestrator 是单轮 agent 交互的唯一编排入口。

它负责：

1. 接收用户输入与当前工作台上下文
2. 调用 Router
3. 应用 slot policy
4. 决定是否 clarification 或 execute
5. 统一生成 `AgentTurnResult`
6. 写入 interaction log

它不负责：

1. 改写 Router Prompt
2. 代替 Executor 创作结果
3. 直接渲染 UI
4. 代替工作台显式动作接口

## 2. 运行时输入

每次进入 Orchestrator 时，必须显式给出以下输入：

```json
{
  "work_id": "work_xxx",
  "user_message": "给我两个核心角色备选",
  "current_interaction_id": null,
  "active_clarification": null,
  "workspace_context": {},
  "request_meta": {
    "source": "chat_panel",
    "client_ts": 1710000000000
  }
}
```

### 2.1 `work_id`

- 必填
- 所有创作型 agent 交互都应绑定某个作品上下文

### 2.2 `user_message`

- 必填
- 原始用户输入
- 不应在进入 Router 前被前端改写成“结构化命令”

### 2.3 `current_interaction_id`

- 可空
- 用于续写当前 interaction
- 通常由系统生成，不由前端自由构造

### 2.4 `active_clarification`

- 可空
- 若当前存在未完成 clarification，这里应带上其状态
- 用于判断当前用户输入是在：
  - 发起一个全新请求
  - 还是回答上一个 clarification

### 2.5 `workspace_context`

- 必填
- 由 `Context Manager` 提供
- 至少包含：
  - 当前作品
  - 当前 active chapter
  - 角色摘要
  - 最近决策
  - 最小路由上下文

## 3. 运行时输出

Orchestrator 的唯一输出就是：

- `AgentTurnResult`

详见：
- [11-agent-turn-result-schema.md](./11-agent-turn-result-schema.md)

不允许：

1. 某些路径返回 route packet
2. 某些路径返回 execute packet
3. 某些路径只返回纯文本

## 4. 决策顺序

一次标准 interaction 的处理顺序如下：

```text
receive input
  -> load workspace context
  -> merge unresolved clarification if exists
  -> call Router
  -> normalize route result
  -> validate router result
  -> apply slot policy
  -> decide clarification vs execute
  -> if execute: call Executor
  -> validate executor result
  -> compose assistant message
  -> compose AgentTurnResult
  -> persist interaction log
  -> return AgentTurnResult
```

## 5. 标准处理流程

## 5.1 Step 1: 接收输入

Orchestrator 收到输入后，先创建本轮交互上下文：

- interaction id
- work id
- source
- timestamp

此时 phase 为：

- `RECEIVED`

## 5.2 Step 2: 读取未完成 clarification

如果当前 work 存在未完成 clarification，Orchestrator 先判断当前用户输入是否是在回答它。

判断优先级：

1. 如果前端显式携带 `clarification_target_interaction_id`，优先按此绑定
2. 否则尝试根据最近未完成 clarification 自动绑定
3. 若无法稳定绑定，则按新请求处理

### 说明

这一步的目的不是“猜用户心思”，而是避免 clarification 上下文丢失。

## 5.3 Step 3: Router

调用 Router，输入：

- 用户原始消息
- 最小路由上下文

输出：

- `route_result`

此时不做执行。

## 5.4 Step 4: Router Validator

使用 Router Validator 做：

1. schema 合法性
2. intent 合法性
3. `missing_fields` 一致性
4. `reply` 越权修复

若校验失败且不可自动修复：

- `phase = FAILED`
- `status = ERROR`
- `next_action.type = RETRY_SYSTEM`

## 5.5 Step 5: Slot Policy Resolution

对 Router 的 `parameters` 和 `missing_fields` 应用 slot policy。

处理顺序必须固定：

1. 先推断 `inferable_with_high_confidence`
2. 再补 `defaultable`
3. 再过滤掉已解决的 `missing_fields`
4. 再判断是否还剩 `required_to_execute`

输出：

```json
{
  "resolved_parameters": {},
  "remaining_missing_fields": [],
  "autofilled_fields": [],
  "inferred_fields": []
}
```

## 5.6 Step 6: Clarification Decision

判断规则：

### 情形 A：剩余缺失字段包含 `required_to_execute`

进入：

- `phase = NEEDS_CLARIFICATION`
- `status = WAITING_USER`

然后生成 clarification message。

### 情形 B：只剩 optional 字段

不进入 clarification，继续执行。

### 情形 C：intent = `OTHER`

进入：

- `phase = ROUTED`
- `status = READY`

说明这轮已完成识别，但没有明确执行任务。

## 5.7 Step 7: Executor

当且仅当：

- Router 合法
- slot policy 处理后无阻塞字段
- intent 不是 `OTHER`

才调用 Executor。

此时进入：

- `phase = EXECUTING`
- `status = RUNNING`

Executor 输入：

- `intent`
- `resolved_parameters`
- executor context

## 5.8 Step 8: Executor Validator

对 executor result 做格式与结构校验。

若失败：

- `phase = FAILED`
- `status = ERROR`
- `next_action.type = RETRY_SYSTEM`

若通过：

- `phase = COMPLETED`
- `status = DONE`

## 5.9 Step 9: 生成 Assistant Message

`assistant_message` 必须由 Orchestrator 统一生成。

生成优先级：

1. clarification message
2. execution result 的用户可读内容
3. route-level 状态确认语
4. 系统兜底错误说明

前端不允许自行降级成 `"收到。"`。

## 5.10 Step 10: 组装 `AgentTurnResult`

必须一次性写齐：

- `interaction_id`
- `phase`
- `status`
- `assistant_message`
- `route_result`
- `execution_result`
- `validation`
- `next_action`
- `ui_hints`
- `timestamps`

## 5.11 Step 11: 持久化

在返回前写 interaction log。

要求：

1. clarification 和 completed 都必须写日志
2. 失败也必须写日志
3. log 中要能区分：
   - Router 失败
   - clarification 停顿
   - executor 成功
   - executor 校验失败

## 6. Phase Transition 规范

## 6.1 标准成功路径

```text
RECEIVED
  -> ROUTED
  -> READY_TO_EXECUTE
  -> EXECUTING
  -> COMPLETED
```

## 6.2 clarification 路径

```text
RECEIVED
  -> ROUTED
  -> NEEDS_CLARIFICATION
  -> WAIT USER
  -> RECEIVED
  -> ROUTED
  -> READY_TO_EXECUTE
  -> EXECUTING
  -> COMPLETED
```

## 6.3 `OTHER` 路径

```text
RECEIVED
  -> ROUTED
  -> DONE
```

这里的含义是：

- 系统知道当前没有稳定可执行意图
- 但这不是错误

## 6.4 错误路径

```text
RECEIVED
  -> ROUTED
  -> FAILED
```

或：

```text
RECEIVED
  -> ROUTED
  -> READY_TO_EXECUTE
  -> EXECUTING
  -> FAILED
```

## 7. Clarification Runtime Spec

## 7.1 clarification state

建议引入独立对象：

```json
{
  "clarification_id": "clar_xxx",
  "source_interaction_id": "interaction_xxx",
  "intent": "CREATE_CHARACTER_CANDIDATES",
  "required_fields": ["character_name"],
  "optional_fields": ["role_type"],
  "current_parameters": {},
  "status": "OPEN"
}
```

### 目的

clarification 不应只是一个 message，而应是一个显式状态对象。

这样系统才能：

1. 知道用户下一句是不是在回答上轮问题
2. 支持多轮补齐参数
3. 支持回放与分析

## 7.2 clarification merge 规则

如果当前存在 `OPEN` clarification：

1. 先把用户新输入作为对 clarification 的潜在补充
2. 再与原参数合并
3. 再重新跑 Router 或专门的 clarification parser
4. 重新做 slot policy resolution

### 重要约束

clarification merge 不能直接跳过 Router。

因为用户的回答可能会：

- 补字段
- 改意图
- 甚至否定上轮任务

## 8. `OTHER` 的运行时语义

`OTHER` 不是“失败”，也不是“空操作”。

它代表：

- 当前输入无法稳定归入现有 intent
- 或当前输入不应触发执行器

此时 Orchestrator 应返回：

- `phase = ROUTED`
- `status = READY`
- `next_action.type = ASK_USER` 或 `NO_FURTHER_ACTION`

assistant message 示例：

> 我还不能稳定判断这轮该执行哪类创作动作。你可以直接说“总结当前状态”“给我两个核心角色备选”或“把当前剧情往前推进”。

## 9. Endpoint 语义

## 9.1 canonical endpoint

推荐前端主入口：

- `POST /api/works/{id}/interactions`

它必须返回：

- `AgentTurnResult`

## 9.2 调试接口

这些接口可以保留：

- `/route`
- `/execute`

但它们是：

- 调试接口
- 测试接口
- 内部开发接口

而不是前端主路径。

## 9.3 `/chat`

若保留，应只是：

- 对 `/interactions` 的兼容代理

而不应再拥有独立语义。

## 10. 持久化规范

建议 interaction log 至少保存以下内容：

```json
{
  "interaction_id": "interaction_xxx",
  "work_id": "work_xxx",
  "user_message": "给我两个核心角色备选",
  "phase": "COMPLETED",
  "status": "DONE",
  "assistant_message_json": {},
  "route_result_json": {},
  "router_validation_json": {},
  "execution_result_json": {},
  "execution_validation_json": {},
  "next_action_json": {},
  "slot_resolution_json": {},
  "clarification_state_json": {},
  "created_at": 1710000000000,
  "updated_at": 1710000000200
}
```

### `slot_resolution_json` 建议结构

```json
{
  "inferred_fields": ["candidate_count", "role_type"],
  "autofilled_fields": ["plot_scope"],
  "remaining_missing_fields": []
}
```

## 11. 失败处理规范

## 11.1 Router 失败

条件：

- 非法 JSON
- schema 缺失
- intent 非法且修复失败

输出：

- `phase = FAILED`
- `status = ERROR`
- `next_action.type = RETRY_SYSTEM`

## 11.2 Executor 失败

条件：

- 无法产出
- 结构不合法
- validator 未通过

输出：

- `phase = FAILED`
- `status = ERROR`
- `next_action.type = RETRY_SYSTEM`

## 11.3 Clarification 超时或放弃

如果 clarification 长时间未被用户回答，或用户明确取消：

- 不应把原 interaction 改写为失败
- 应关闭 clarification state
- 并记录结束原因

建议 clarification 结束原因：

- `resolved`
- `abandoned`
- `superseded_by_new_intent`

## 12. 对当前案例的运行时判定

用户输入：

> 给我两个核心角色备选

在已有作品上下文下，正确运行时行为应为：

1. Router 识别 `CREATE_CHARACTER_CANDIDATES`
2. slot policy 推断：
   - `candidate_count = 2`
   - `role_type = core_roles`
3. `plot_scope` 默认 `current_plot`
4. `selection_flow` 视为 optional，不阻塞
5. 进入 `READY_TO_EXECUTE`
6. 调用 executor
7. `phase = COMPLETED`
8. `assistant_message.content` 为角色候选结果

而不应：

1. 返回一个没有顶层主消息的 packet
2. 让前端自己兜底“收到。”
3. 因 optional 字段卡在 clarification

## 13. 实施顺序建议

如果后续进入实现，推荐顺序：

1. 新增 `Orchestrator` 服务对象
2. 让 `/interactions` 改为返回 `AgentTurnResult`
3. 把 slot policy 配置化
4. 补 clarification state persistence
5. 最后清理旧 `/chat` 兼容路径

## 14. 结论

只要 Orchestrator 的运行时语义不被明确写清，系统就会不断出现：

- 协议层没问题，但交互层像断了
- 后端知道该做什么，前端却不知道该展示什么
- clarification 是正常状态，却被实现成“半失败”

所以：

> `Orchestrator Runtime Spec` 是把设计方案从“模块列表”升级为“可运行 agent”的最后一块关键拼图。
