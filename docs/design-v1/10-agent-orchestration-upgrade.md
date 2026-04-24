# 对话式小说工作台：Agent Orchestration 升级设计 v1.1

> 本文档是在以下既有设计基础上的升级补充：
>
> - [00-full-design-solution-v1.0.md](./00-full-design-solution-v1.0.md)
> - [router-design.md](./router-design.md)
> - [intent-enums.md](./intent-enums.md)
> - [parameter-slots.md](./parameter-slots.md)
> - [validator-rules.md](./validator-rules.md)
> - [executor-prompts.md](./executor-prompts.md)
>
> v1.0 已经明确了 `Router / Context Manager / Executor / Validator / State Store` 五层。
> 本文档要解决的不是“再加几个 intent”，而是补齐一个完整 agent 在单轮交互中应该如何稳定产出结果。

## 1. 为什么需要这个升级

现有文档已经把协议层和创作层拆开了，但还缺一层真正的 **Agent Orchestrator**。

当前缺口主要体现在：

1. `Router` 输出协议已经定义了，但系统还没有统一的 **agent turn output**
2. `missing_fields` 已定义，但没有正式的 **clarification phase**
3. `/chat`、`/route`、`/execute`、`/interactions` 的返回语义没有完全统一
4. 前端有时在消费“route packet”，有时在消费“chat payload”
5. 槽位只分“有/无”，还没有区分“必须阻塞执行”和“可推断/可默认”

这会导致一个典型问题：

- Router 已经识别对了
- Validator 也没有报错
- 但 agent 没有把“下一句该如何对用户说”作为正式产物输出
- 前端只能自己猜该展示什么

所以 v1.1 的目标是：

> 把“结构化路由系统”升级为“有状态的、可澄清的、统一返回 contract 的完整 agent”。

## 2. 设计原则

v1.1 继续继承 v1.0 的核心原则，不推翻以下判断：

1. `Router` 只做识别和提取，不做创作
2. `Executor` 只做执行，不做意图判断
3. `Validator` 只做校验和轻修复，不做创作
4. `Context Manager` 继续按层供给上下文
5. 工作台显式操作和 agent 自然语言交互必须分开

新增的原则只有一条：

> **前端永远只消费统一的 agent interaction result，不直接消费裸 route packet。**

## 3. 升级后的系统分层

v1.0：

`User -> Router -> Executor -> Validator -> Store`

v1.1：

`User -> Agent Orchestrator -> Router -> Validator -> Clarification / Executor -> Validator -> Store -> Agent Turn Result`

其中新增的 `Agent Orchestrator` 负责：

1. 驱动一次完整 interaction 的 phase 变化
2. 决定是进入 clarification 还是 execution
3. 统一生成对前端可渲染的 agent turn result
4. 写入 interaction log
5. 维护“当前是否存在未完成澄清”的状态

它不做：

1. 代替 Router 判断 intent
2. 代替 Executor 创作内容
3. 代替前端决定 UI 呈现细节

## 4. 统一的 Agent Turn Contract

### 4.1 顶层原则

无论当前一轮交互最终结果是：

- 正常执行
- 需要澄清
- 暂时无法归类
- 校验失败

系统都必须返回同一种结构。

前端不应再区分：

- “这是 route 返回”
- “这是 execute 返回”
- “这是 chat 返回”

而应始终只渲染一个 `AgentTurnResult`。

### 4.2 推荐结构

```json
{
  "interaction_id": "interaction_xxx",
  "phase": "NEEDS_CLARIFICATION",
  "status": "WAITING_USER",
  "assistant_message": {
    "role": "assistant",
    "content": "已识别为基于当前剧情生成角色候选的请求。默认可先给你 2 个核心角色备选。若你要更聚焦，可以补充偏江湖型还是偏朝堂型。"
  },
  "route_result": {
    "intent": "CREATE_CHARACTER_CANDIDATES",
    "parameters": {},
    "missing_fields": [],
    "confidence": 0.0,
    "reply": ""
  },
  "execution_result": null,
  "validation": {
    "router": {},
    "executor": null
  },
  "next_action": {
    "type": "ASK_USER",
    "expected_inputs": ["role_type_preference"]
  },
  "ui_hints": {
    "render_mode": "chat",
    "show_retry": false
  },
  "timestamps": {
    "created_at": 0,
    "updated_at": 0
  }
}
```

### 4.3 关键字段说明

#### `phase`

描述当前这轮 interaction 处于哪一阶段。

#### `status`

描述当前是否还需要用户参与，还是已经结束。

#### `assistant_message`

这是唯一给前端展示的主消息。

注意：

- 前端不应该自己从 `route_result.reply` 或 `execution_result.actionResult.content` 中拼消息
- `assistant_message.content` 必须已经是 agent 这一轮真正想对用户说的话

#### `route_result`

保留协议层结果，供日志、调试、回放、分析使用。

#### `execution_result`

只有在实际进入执行阶段后才非空。

#### `next_action`

告诉前端这轮之后系统期待什么。

可选值例如：

- `ASK_USER`
- `EXECUTE_DIRECTLY`
- `SHOW_RESULT`
- `RETRY_SYSTEM`
- `NO_FURTHER_ACTION`

## 5. Agent Phase State Machine

### 5.1 推荐 phase

```text
RECEIVED
  -> ROUTED
  -> NEEDS_CLARIFICATION
  -> READY_TO_EXECUTE
  -> EXECUTING
  -> COMPLETED
  -> FAILED
```

### 5.2 各阶段定义

#### `RECEIVED`

系统收到用户输入，但尚未完成 Router。

#### `ROUTED`

已经完成 Router 和 Router Validator，但还未决定是否执行。

适用情形：

- intent = `OTHER`
- 或系统判断这是一条无需执行的状态性确认

#### `NEEDS_CLARIFICATION`

这是正常相位，不是错误。

含义是：

- Router 已识别出主意图
- 但当前信息不足以安全执行
- Agent 需要主动向用户发起澄清

#### `READY_TO_EXECUTE`

参数已经满足执行条件，可以调用 Executor。

#### `EXECUTING`

Executor 正在运行中。

#### `COMPLETED`

执行完成，并生成最终结果。

#### `FAILED`

可以由以下原因进入：

- Router 输出非法且修复失败
- Executor 输出不合法
- 上下文缺失
- 基础设施故障

### 5.3 `status` 建议

建议把 `phase` 和 `status` 分开。

例如：

- `phase=NEEDS_CLARIFICATION`, `status=WAITING_USER`
- `phase=COMPLETED`, `status=DONE`
- `phase=FAILED`, `status=ERROR`

这样前端更容易稳定渲染。

## 6. Clarification Policy

### 6.1 核心原则

`missing_fields` 不等于必须阻塞执行。

这是 v1.1 最重要的升级之一。

字段缺失后，系统必须先判断该字段属于哪一类，再决定：

- 自动推断
- 自动默认
- 轻度澄清但允许先执行
- 必须阻塞执行

### 6.2 四类槽位

#### A. `required_to_execute`

缺失时必须进入 clarification。

例如：

- `REFINE_EXISTING_CHARACTER.character_name`
- `ADVANCE_PLOT.advance_goal`

#### B. `inferable_with_high_confidence`

可根据用户原话直接推断。

例如：

- “给我两个核心角色备选”
  - `candidate_count = 2`
  - `role_type = core_roles`

#### C. `defaultable`

可以使用系统默认值，不应阻塞执行。

例如：

- `plot_scope = current_plot`
- `summary_scope = current_work`

#### D. `optional_preference`

有会更好，没有也不应阻塞执行。

例如：

- `selection_flow`
- 角色偏好语气
- 输出风格附加限制

### 6.3 Clarification 触发条件

只有当缺失字段中仍存在 `required_to_execute`，才进入 `NEEDS_CLARIFICATION`。

否则：

- 先补推断值
- 再补默认值
- 其余 optional 直接留空
- 进入执行

### 6.4 Clarification 输出规范

当进入 `NEEDS_CLARIFICATION` 时，agent 不能只返回“已识别为 XXX 请求”。

必须输出一个真正可继续对话的澄清消息：

1. 说明当前已识别的主任务
2. 说明缺的是什么
3. 说明哪些已被系统默认/推断
4. 给用户一个最小回应路径

示例：

> 已识别为生成角色候选的请求。  
> 我可以先按“2 个核心角色候选”继续执行。  
> 如果你想更聚焦，可以补充偏江湖型还是偏朝堂型；不补我也可以直接给出第一版。

## 7. Slot Policy 升级建议

结合 [parameter-slots.md](./parameter-slots.md)，建议补充一列“执行阻塞级别”。

例如：

| intent | field | level | policy |
|---|---|---|---|
| CREATE_CHARACTER_CANDIDATES | work_name | required_to_execute | 无作品上下文时阻塞 |
| CREATE_CHARACTER_CANDIDATES | plot_scope | defaultable | 默认 `current_plot` |
| CREATE_CHARACTER_CANDIDATES | candidate_count | inferable_with_high_confidence | 从“两个/三个/几位”提取 |
| CREATE_CHARACTER_CANDIDATES | role_type | inferable_with_high_confidence | 从“核心角色/反派/配角”提取 |
| CREATE_CHARACTER_CANDIDATES | selection_flow | optional_preference | 不阻塞 |
| ADVANCE_PLOT | current_plot_scope | defaultable | 默认 `current_plot` |
| ADVANCE_PLOT | advance_goal | required_to_execute | 缺失时澄清 |
| ADVANCE_PLOT | target_position | optional_preference | 可缺省 |

这张表建议后续并入 `parameter-slots.md`。

## 8. Router / Validator / Orchestrator 三者边界

### Router

继续只输出：

- `intent`
- `parameters`
- `missing_fields`
- `confidence`
- `reply`

### Validator

继续只负责：

- 结构合法性
- 枚举合法性
- `missing_fields` 一致性
- `reply` 越权修复

### Orchestrator

新增负责：

- 把 `missing_fields` 映射成 clarification decision
- 统一生成 `assistant_message`
- 决定是否继续执行
- 写 interaction log

因此：

> “需要澄清吗”不再只是 Validator 结论，而是 Orchestrator 的决策。

## 9. 显式工作台动作与 Agent 自然语言交互的边界

这是另一个必须收紧的地方。

### 9.1 显式工作台动作

例如：

- 创建作品
- 切换章节
- 创建/跳转章节
- 切换阅读态
- 点击“生成细纲”
- 点击“生成草稿”

这些应继续保留为显式 UI/HTTP action。

### 9.2 Agent 自然语言交互

例如：

- 给我两个核心角色备选
- 把当前剧情往前推进
- 总结一下现在局面
- 把这个角色改得更狠一点

这些应走 Orchestrator。

### 9.3 禁止混线

不建议让聊天入口继续承担以下工作：

- 创建作品
- 进入阅读态
- 切换章节
- 直接触发按钮级工作台命令

原因不是“做不到”，而是这会让 agent 和 workbench command bus 再次缠在一起。

## 10. API Contract 升级建议

### 10.1 保留一个 canonical interaction endpoint

推荐把以下接口语义统一：

- `POST /api/works/{id}/interactions`

它应返回 `AgentTurnResult`，而不是裸 packet。

### 10.2 `/route` 与 `/execute`

这两个接口可以保留，但定位应改为：

- 调试接口
- 内部开发接口
- 测试验证接口

而不是前端主路径。

### 10.3 `/chat`

建议逐步废弃，避免与 `/interactions` 重复。

## 11. 前端 Rendering Contract

前端只依赖以下字段：

1. `assistant_message.content`
2. `phase`
3. `status`
4. `next_action`
5. `execution_result.action_result`

前端不应直接依赖：

- `route_result.reply`
- `route_result.missing_fields`
- `execution_result.actionResult.content`

这些都应该作为调试/分析信息存在，而不是主渲染字段。

## 12. Interaction Log 升级建议

当前 interaction log 已经在存：

- 用户输入
- route result
- route validation
- execution result
- execution validation
- status

建议新增：

- `phase`
- `assistant_message_json`
- `next_action_json`
- `resolved_from_interaction_id`
- `clarification_state_json`

这样后续才能：

- 回放 agent 的真实行为
- 分析哪些 intent 高频卡在 clarification
- 分析哪些字段经常被错误设计成阻塞项

## 13. 对当前例子的正确处理方式

用户说：

> 给我两个核心角色备选

在已有作品上下文下，理想流程应为：

1. Router 识别 `CREATE_CHARACTER_CANDIDATES`
2. Orchestrator 推断：
   - `candidate_count = 2`
   - `role_type = core_roles`
3. `selection_flow` 判定为 optional，不阻塞
4. 进入执行
5. Agent 返回 `COMPLETED`
6. `assistant_message.content` 为最终角色候选内容或简短导语

而不应：

- 停在一个裸 `route packet`
- 或因为空顶层 `reply` 被前端兜底成“收到。”

## 14. 迁移建议

建议按以下顺序从 v1.0 迁到 v1.1：

1. 新增 `AgentTurnResult` 协议文档
2. 新增 `Orchestrator` 层，不动 Router / Executor 本身
3. 把 `/interactions` 改成返回 canonical result
4. 调整 slot policy，补 `required/defaultable/inferable/optional`
5. 前端只消费 canonical result
6. 最后再收敛 `/chat`

## 15. 结论

v1.0 解决的是：

> 不要让系统成为一个“会聊天但不稳定”的写作助手。

v1.1 要解决的是：

> 不要让系统成为一个“协议看起来完整，但每轮交互没有统一产物”的半成品 agent。

真正完整的 agent，不是只有 Router、Executor、Validator。

还必须有：

1. 单轮交互的统一返回 contract
2. 可显式建模的 phase state machine
3. 基于槽位分级的 clarification policy
4. 前后端一致消费的 canonical interaction result

只有这四件事定下来，系统才算从“架构原型”升级为“完整 agent 设计”。
