# API Shape Freeze: `/interactions`

> 本文档冻结 `POST /api/works/{id}/interactions` 的最终 request / response 结构。
>
> 它基于以下文档：
>
> - [11-agent-turn-result-schema.md](./11-agent-turn-result-schema.md)
> - [13-orchestrator-runtime-spec.md](./13-orchestrator-runtime-spec.md)
> - [14-implementation-cutover-plan.md](./14-implementation-cutover-plan.md)
>
> 目标是避免在实现阶段继续出现：
>
> - 前端按一种结构读，后端按另一种结构回
> - `/chat` 和 `/interactions` 语义漂移
> - packet 与 canonical result 混用

## 1. 冻结范围

本次冻结只针对：

- `POST /api/works/{id}/interactions`
- `GET /api/works/{id}/interactions`

不覆盖：

- `/route`
- `/execute`
- `/chat`

这些接口保留为调试或兼容接口，不作为主产品 contract。

## 2. 设计原则

### 2.1 一个主入口

前端所有自然语言创作交互，都必须走：

- `POST /api/works/{id}/interactions`

### 2.2 一个主返回结构

该接口必须始终返回：

- `AgentTurnResult`

不允许：

1. clarification 时返回 route packet
2. completed 时返回 execution packet
3. 某些情况下只返回 `{ reply: "..." }`

### 2.3 snake_case 作为 canonical 命名

最终冻结使用 snake_case。

例如：

- `interaction_id`
- `assistant_message`
- `route_result`
- `execution_result`
- `next_action`

旧命名如：

- `interactionId`
- `routeResult`
- `executionResult`

只能存在于过渡适配层，不进入最终 contract。

## 3. `POST /api/works/{id}/interactions`

## 3.1 Request

### 最小请求

```json
{
  "user_message": "给我两个核心角色备选"
}
```

### 完整请求

```json
{
  "user_message": "给我两个核心角色备选",
  "clarification_target_interaction_id": null,
  "client_context": {
    "source": "chat_panel",
    "client_ts": 1710000000000,
    "ui_mode": "workbench"
  }
}
```

### 字段定义

#### `user_message`

- 类型：`string`
- 必填
- 用户原始输入

#### `clarification_target_interaction_id`

- 类型：`string | null`
- 选填
- 如果前端明确知道当前是在回答哪一轮 clarification，应传此字段

#### `client_context`

- 类型：`object`
- 选填
- 用于日志和调试
- 不参与业务决策

推荐字段：

```json
{
  "source": "chat_panel",
  "client_ts": 1710000000000,
  "ui_mode": "workbench"
}
```

## 3.2 Response

### 唯一返回结构

```json
{
  "interaction_id": "interaction_xxx",
  "phase": "COMPLETED",
  "status": "DONE",
  "assistant_message": {
    "role": "assistant",
    "content": "## 角色候选 1\n..."
  },
  "route_result": {
    "intent": "CREATE_CHARACTER_CANDIDATES",
    "parameters": {},
    "missing_fields": [],
    "confidence": 0.97,
    "reply": "已识别为基于当前剧情生成角色候选的请求。"
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
  "slot_resolution": {
    "inferred_fields": [],
    "autofilled_fields": [],
    "remaining_missing_fields": []
  },
  "clarification": null,
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

## 3.3 顶层字段冻结清单

以下字段必须存在：

1. `interaction_id`
2. `phase`
3. `status`
4. `assistant_message`
5. `route_result`
6. `execution_result`
7. `validation`
8. `slot_resolution`
9. `clarification`
10. `next_action`
11. `ui_hints`
12. `timestamps`

不允许再新增同语义的平行字段，例如：

- `reply`
- `intent`
- `actionResult`

如果需要兼容旧前端，必须在 adapter 层生成，而不是进入 canonical payload。

## 4. `GET /api/works/{id}/interactions`

## 4.1 作用

返回该作品的 interaction 历史。

注意：

- 返回的是 `AgentTurnResult[]`
- 不是数据库原始行
- 不是旧 packet list

## 4.2 Response

```json
{
  "items": [
    {
      "interaction_id": "interaction_001",
      "phase": "COMPLETED",
      "status": "DONE",
      "assistant_message": {
        "role": "assistant",
        "content": "..."
      },
      "route_result": {},
      "execution_result": {},
      "validation": {},
      "slot_resolution": {},
      "clarification": null,
      "next_action": {},
      "ui_hints": {},
      "timestamps": {
        "created_at": 1710000000000,
        "updated_at": 1710000000100
      }
    }
  ]
}
```

字段名冻结为：

- `items`

不要再混用：

- `interactions`
- `rows`
- `data`

## 5. `phase` / `status` 冻结

## 5.1 `phase`

允许值：

- `RECEIVED`
- `ROUTED`
- `NEEDS_CLARIFICATION`
- `READY_TO_EXECUTE`
- `EXECUTING`
- `COMPLETED`
- `FAILED`

## 5.2 `status`

允许值：

- `WAITING_USER`
- `READY`
- `RUNNING`
- `DONE`
- `ERROR`

## 6. `assistant_message` 冻结

```json
{
  "role": "assistant",
  "content": "..."
}
```

约束：

1. 前端主展示只依赖 `assistant_message.content`
2. `route_result.reply` 不作为主展示字段
3. `execution_result.action_result.content` 不作为主展示字段

## 7. `slot_resolution` 冻结

```json
{
  "inferred_fields": ["candidate_count", "role_type"],
  "autofilled_fields": ["plot_scope"],
  "remaining_missing_fields": []
}
```

字段说明：

### `inferred_fields`

- 用户原话中被推断出的字段

### `autofilled_fields`

- 使用系统默认值补齐的字段

### `remaining_missing_fields`

- 经过推断和默认后，仍然缺失的字段

这三个字段必须总是存在。

## 8. `clarification` 冻结

如果当前轮不是 clarification，返回：

```json
null
```

如果当前轮进入 clarification，返回：

```json
{
  "clarification_id": "clar_xxx",
  "source_interaction_id": "interaction_xxx",
  "status": "OPEN",
  "required_fields": ["character_name"],
  "optional_fields": [],
  "current_parameters": {}
}
```

详见：
- [16-clarification-state-schema.md](./16-clarification-state-schema.md)

## 9. `next_action` 冻结

```json
{
  "type": "ASK_USER",
  "expected_inputs": ["character_name"]
}
```

允许值：

- `ASK_USER`
- `EXECUTE_DIRECTLY`
- `SHOW_RESULT`
- `RETRY_SYSTEM`
- `NO_FURTHER_ACTION`

## 10. HTTP 状态码约束

### `POST /interactions`

推荐：

- 成功创建一轮 interaction：`201 Created`

不因为 clarification 而返回 4xx。

clarification 是正常业务结果，不是请求错误。

### `GET /interactions`

- 正常读取：`200 OK`

### 错误情况

仅在以下情况下返回 4xx / 5xx：

1. work 不存在
2. request body 非法
3. 服务不可用

## 11. 兼容策略

## 11.1 `/chat`

若暂时保留：

- 它必须内部调用 Orchestrator
- 再把 `AgentTurnResult` 适配成旧格式

但这个适配不能反向污染 `/interactions`。

## 11.2 旧前端字段兼容

如果旧前端还依赖：

- `reply`
- `routeResult`
- `executionResult`

只能在 compatibility adapter 中映射：

- `reply <- assistant_message.content`
- `routeResult <- route_result`
- `executionResult <- execution_result`

不能把这些字段重新加回 canonical schema。

## 12. 关键验收案例

### 案例 A：直接执行

输入：

```json
{
  "user_message": "总结一下现在情况"
}
```

期望：

- `phase = COMPLETED`
- `assistant_message.content` 非空
- `execution_result` 非空

### 案例 B：需要 clarification

输入：

```json
{
  "user_message": "把角色再细一点"
}
```

期望：

- `phase = NEEDS_CLARIFICATION`
- `status = WAITING_USER`
- `clarification` 非空
- `next_action.type = ASK_USER`

### 案例 C：OTHER

输入：

```json
{
  "user_message": "你觉得人生是什么"
}
```

期望：

- `phase = ROUTED`
- `execution_result = null`
- `assistant_message.content` 是引导性说明

## 13. 结论

`/interactions` 的 shape 不冻结，后续实现就一定会继续出现：

- 前端按 packet 读
- 后端按 turn 回
- clarification 像失败
- completed 像裸文本

所以：

> `/interactions` 的 API shape 是 Orchestrator 时代的第一条硬边界，必须先冻结，再实现。
