# AgentTurnResult Schema

> 本文档是 [10-agent-orchestration-upgrade.md](./10-agent-orchestration-upgrade.md) 的实现级补充。
>
> 目标是定义一个单一、稳定、可供前后端共享的 **canonical interaction result**。
>
> 任何一次 agent 交互，无论最终进入：
>
> - clarification
> - execution
> - completion
> - failure
>
> 都必须返回同一种顶层结构。

## 1. 设计目标

`AgentTurnResult` 要解决 4 个问题：

1. 前端不再自行猜测该读 `reply`、`route_result.reply` 还是 `execution_result.action_result.content`
2. `/chat`、`/interactions`、未来的流式接口都能共用同一种响应语义
3. interaction log 可以原样保存 turn 级结果
4. clarification 不再是“中断执行”，而是 agent 的正常输出

## 2. 顶层结构

```json
{
  "interaction_id": "interaction_xxx",
  "phase": "COMPLETED",
  "status": "DONE",
  "assistant_message": {
    "role": "assistant",
    "content": "## 当前作品状态总结\n..."
  },
  "route_result": {
    "intent": "SUMMARIZE_CURRENT_STATE",
    "parameters": {},
    "missing_fields": [],
    "confidence": 0.94,
    "reply": "已识别为总结当前作品状态的请求。"
  },
  "execution_result": {
    "handled": true,
    "status": "COMPLETED",
    "action_result": {},
    "metadata": {}
  },
  "validation": {
    "router": {},
    "executor": {}
  },
  "next_action": {
    "type": "SHOW_RESULT",
    "expected_inputs": []
  },
  "ui_hints": {
    "render_mode": "chat",
    "show_retry": false,
    "show_structured_card": true
  },
  "timestamps": {
    "created_at": 0,
    "updated_at": 0
  }
}
```

## 3. 字段规范

### 3.1 `interaction_id`

- 类型：`string`
- 必填
- 用于：
  - interaction log 主键
  - clarification 续轮关联
  - 前端消息去重

### 3.2 `phase`

- 类型：`string`
- 必填
- 枚举值：
  - `RECEIVED`
  - `ROUTED`
  - `NEEDS_CLARIFICATION`
  - `READY_TO_EXECUTE`
  - `EXECUTING`
  - `COMPLETED`
  - `FAILED`

说明：

- `phase` 反映当前这轮 agent 所处阶段
- 是工作流语义，不等于 HTTP 状态码

### 3.3 `status`

- 类型：`string`
- 必填
- 枚举值建议：
  - `WAITING_USER`
  - `READY`
  - `RUNNING`
  - `DONE`
  - `ERROR`

说明：

- `phase` 强调系统步骤
- `status` 强调当前是否还需要外部动作

推荐映射：

| phase | status |
|---|---|
| `ROUTED` | `READY` |
| `NEEDS_CLARIFICATION` | `WAITING_USER` |
| `READY_TO_EXECUTE` | `READY` |
| `EXECUTING` | `RUNNING` |
| `COMPLETED` | `DONE` |
| `FAILED` | `ERROR` |

### 3.4 `assistant_message`

- 类型：`object`
- 必填

结构：

```json
{
  "role": "assistant",
  "content": "..."
}
```

约束：

- `role` 固定为 `assistant`
- `content` 必须是前端主渲染文本
- 前端只渲染这个字段，不再自己拼消息

### 3.5 `route_result`

- 类型：`object`
- 必填
- 结构沿用现有 Router 输出协议：

```json
{
  "intent": "CREATE_CHARACTER_CANDIDATES",
  "parameters": {},
  "missing_fields": [],
  "confidence": 0.0,
  "reply": ""
}
```

说明：

- 这是协议层产物
- 保留给日志、调试、回放、分析使用
- 不直接作为前端主消息

### 3.6 `execution_result`

- 类型：`object | null`
- 必填

未进入执行时必须为 `null`。

已执行时结构：

```json
{
  "handled": true,
  "status": "COMPLETED",
  "action_result": {},
  "metadata": {}
}
```

说明：

- 字段命名建议统一成 snake_case
- 如果当前代码内部仍使用 `actionResult`，属于实现适配层问题，不应污染 canonical schema

### 3.7 `validation`

- 类型：`object`
- 必填

结构：

```json
{
  "router": {
    "is_valid": true,
    "error_codes": [],
    "warnings": [],
    "suggested_action": "proceed"
  },
  "executor": null
}
```

说明：

- `router` 总是存在
- `executor` 只有在真正执行后才非空

### 3.8 `next_action`

- 类型：`object`
- 必填

结构：

```json
{
  "type": "ASK_USER",
  "expected_inputs": ["role_type_preference"]
}
```

`type` 推荐枚举：

- `ASK_USER`
- `EXECUTE_DIRECTLY`
- `SHOW_RESULT`
- `RETRY_SYSTEM`
- `NO_FURTHER_ACTION`

### 3.9 `ui_hints`

- 类型：`object`
- 必填

说明：

- 这是给前端的低耦合渲染提示
- 不能塞业务决定

推荐字段：

```json
{
  "render_mode": "chat",
  "show_retry": false,
  "show_structured_card": true
}
```

### 3.10 `timestamps`

- 类型：`object`
- 必填

结构：

```json
{
  "created_at": 1710000000000,
  "updated_at": 1710000000000
}
```

- 单位：Unix 毫秒

## 4. 不同阶段的返回示例

### 4.1 需要澄清

```json
{
  "interaction_id": "interaction_001",
  "phase": "NEEDS_CLARIFICATION",
  "status": "WAITING_USER",
  "assistant_message": {
    "role": "assistant",
    "content": "已识别为生成角色候选的请求。我可以先按 2 个核心角色备选继续执行；如果你想更聚焦，也可以补充偏江湖型还是偏朝堂型。"
  },
  "route_result": {
    "intent": "CREATE_CHARACTER_CANDIDATES",
    "parameters": {
      "work_name": "两个女人的江湖传说",
      "plot_scope": "current_plot",
      "generation_target": "new_character_candidates",
      "candidate_count": 2,
      "role_type": "",
      "selection_flow": "",
      "constraints": ["genre:穿越/江湖/朝堂/战争"]
    },
    "missing_fields": ["role_type"],
    "confidence": 0.97,
    "reply": "已识别为基于当前剧情生成角色候选的请求。"
  },
  "execution_result": null,
  "validation": {
    "router": {
      "is_valid": true,
      "error_codes": [],
      "warnings": [],
      "suggested_action": "needs_clarification"
    },
    "executor": null
  },
  "next_action": {
    "type": "ASK_USER",
    "expected_inputs": ["role_type"]
  },
  "ui_hints": {
    "render_mode": "chat",
    "show_retry": false,
    "show_structured_card": false
  },
  "timestamps": {
    "created_at": 1710000000000,
    "updated_at": 1710000000000
  }
}
```

### 4.2 直接执行完成

```json
{
  "interaction_id": "interaction_002",
  "phase": "COMPLETED",
  "status": "DONE",
  "assistant_message": {
    "role": "assistant",
    "content": "## 角色候选 1\n..."
  },
  "route_result": {
    "intent": "CREATE_CHARACTER_CANDIDATES",
    "parameters": {
      "work_name": "两个女人的江湖传说",
      "plot_scope": "current_plot",
      "generation_target": "new_character_candidates",
      "candidate_count": 2,
      "role_type": "core_roles",
      "selection_flow": "",
      "constraints": ["genre:穿越/江湖/朝堂/战争"]
    },
    "missing_fields": [],
    "confidence": 0.97,
    "reply": "已识别为基于当前剧情生成角色候选的请求。"
  },
  "execution_result": {
    "handled": true,
    "status": "COMPLETED",
    "action_result": {
      "content": "## 角色候选 1\n..."
    },
    "metadata": {}
  },
  "validation": {
    "router": {
      "is_valid": true,
      "error_codes": [],
      "warnings": [],
      "suggested_action": "proceed"
    },
    "executor": {
      "is_valid": true,
      "error_codes": [],
      "warnings": [],
      "suggested_action": "proceed"
    }
  },
  "next_action": {
    "type": "SHOW_RESULT",
    "expected_inputs": []
  },
  "ui_hints": {
    "render_mode": "chat",
    "show_retry": false,
    "show_structured_card": true
  },
  "timestamps": {
    "created_at": 1710000000000,
    "updated_at": 1710000000200
  }
}
```

## 5. 生成规则

### 5.1 必须由 Orchestrator 统一生成

`AgentTurnResult` 不能由：

- Router 单独生成
- Executor 单独生成
- 前端根据多个字段拼接生成

它必须由 Orchestrator 在单轮结束时统一生成。

### 5.2 `assistant_message.content` 优先级

推荐优先级：

1. clarification message
2. executor 内容摘要或正文结果
3. route-level 状态确认语
4. 系统兜底文本

禁止前端自行兜底 `"收到。"` 作为标准行为。

## 6. 与当前实现的映射关系

当前代码中已有这些对象：

- `routeResult`
- `validationResult`
- `executionResult`
- `executionValidation`
- `status`
- `interactionId`

但它们还不是完整的 `AgentTurnResult`。

缺少的关键层是：

1. `assistant_message`
2. `phase` / `status` 的正式定义
3. `next_action`
4. `ui_hints`
5. snake_case 的 canonical 结构

## 7. 前端消费约束

前端只应依赖：

1. `assistant_message.content`
2. `phase`
3. `status`
4. `next_action`
5. `execution_result.action_result`

前端不应直接依赖：

1. `route_result.reply`
2. `route_result.missing_fields`
3. `execution_result.action_result.content`

这些字段只能作为调试和二级展示信息。

## 8. 结论

只要 `AgentTurnResult` 没有被定义成系统唯一交互 contract，前后端就会不断出现：

- “后端其实有信息，前端却显示不出来”
- “clarification 是正常阶段，UI 却像报错或断流”
- “不同接口返回不同结构，前端到处写特判”

因此：

> `AgentTurnResult` 不是锦上添花，而是完整 agent 系统的基本协议。
