# Slot Policy Table

> 本文档是 [parameter-slots.md](./parameter-slots.md) 与 [10-agent-orchestration-upgrade.md](./10-agent-orchestration-upgrade.md) 的实现级补充。
>
> 目标不是重复列字段，而是给每个槽位补上：
>
> - 缺失时是否阻塞执行
> - 是否可推断
> - 是否可默认
> - clarification 时该如何处理

## 1. 为什么需要这张表

只有 `missing_fields` 还不够。

如果系统只知道“字段缺了”，却不知道这个字段属于：

- 必须补齐
- 可以推断
- 可以默认
- 只是偏好项

那么 agent 就会频繁出现两种问题：

1. 该继续执行的时候却卡在 clarification
2. 该问用户的时候却擅自往下执行

所以 v1.1 需要把每个槽位的策略显式化。

## 2. 四种槽位级别

### 2.1 `required_to_execute`

缺失时必须阻塞执行，并进入 clarification。

### 2.2 `inferable_with_high_confidence`

如果用户原话能稳定映射，应先尝试推断；推断成功后不阻塞。

### 2.3 `defaultable`

若上下文足够明确，可使用系统默认值，不应阻塞执行。

### 2.4 `optional_preference`

有会更好，没有也应允许执行，不应阻塞。

## 3. 处理顺序

每次 Router 输出之后，Orchestrator 应按以下顺序处理槽位：

1. 先做 `inferable_with_high_confidence`
2. 再做 `defaultable`
3. 再移除已解决的 `missing_fields`
4. 如果剩余缺失项中仍有 `required_to_execute`，进入 clarification
5. 其余 `optional_preference` 直接留空并继续执行

## 4. 当前 intent 的槽位策略

## 4.1 `CREATE_CHARACTER_CANDIDATES`

| field | level | 说明 | 缺失处理 |
|---|---|---|---|
| `work_name` | `required_to_execute` | 必须知道当前作品或项目上下文 | 无作品上下文时阻塞 |
| `plot_scope` | `defaultable` | 当前剧情范围大多可默认 | 默认 `current_plot` |
| `generation_target` | `defaultable` | v1 当前固定为角色候选 | 默认 `new_character_candidates` |
| `candidate_count` | `inferable_with_high_confidence` | 可从“一个/两个/三位/几位”提取 | 提取失败时默认 `3` |
| `role_type` | `inferable_with_high_confidence` | 可从“核心角色/反派/配角/女主/男主”提取 | 若无明确线索可留空，不阻塞 |
| `selection_flow` | `optional_preference` | 是否需要“先给候选再选定”的流程 | 缺失不阻塞 |
| `constraints` | `optional_preference` | 风格、题材、边界约束 | 缺失不阻塞 |

### 推荐规则

用户说：

- “给我两个核心角色备选”

应推断：

- `candidate_count = 2`
- `role_type = core_roles`

不应阻塞在：

- `selection_flow`

## 4.2 `REFINE_EXISTING_CHARACTER`

| field | level | 说明 | 缺失处理 |
|---|---|---|---|
| `work_name` | `required_to_execute` | 需要作品上下文来定位角色 | 无上下文阻塞 |
| `character_name` | `required_to_execute` | 必须知道要细化哪个角色 | 缺失时 clarification |
| `refine_dimensions` | `required_to_execute` | 至少要知道细化方向 | 缺失时 clarification |
| `current_basis` | `defaultable` | 可默认基于当前角色卡或最近版本 | 默认 `current_character_state` |
| `constraints` | `optional_preference` | 附加风格和边界要求 | 缺失不阻塞 |

### 推荐规则

如果用户说：

- “把秦婉改得更狠一点”

可推断：

- `character_name = 秦婉`
- `refine_dimensions = ["temperament", "behavioral_edge"]`

如果用户只说：

- “把角色再细一点”

则应 clarification，因为：

- 不知道是哪一个角色
- 也不知道细化维度

## 4.3 `ADVANCE_PLOT`

| field | level | 说明 | 缺失处理 |
|---|---|---|---|
| `work_name` | `required_to_execute` | 需要作品上下文 | 无上下文阻塞 |
| `current_plot_scope` | `defaultable` | 大多数情况下推进当前情节 | 默认 `current_plot` |
| `advance_goal` | `required_to_execute` | 必须知道想推进什么 | 缺失时 clarification |
| `target_position` | `optional_preference` | 是否要求推进到章末钩子、转折点等 | 缺失不阻塞 |
| `constraints` | `optional_preference` | 风格、节奏、角色边界等 | 缺失不阻塞 |

### 推荐规则

用户说：

- “把当前剧情往前推一点”

可直接推断：

- `current_plot_scope = current_plot`
- `advance_goal = reasonable_next_progression`

不应因为缺少 `target_position` 而阻塞。

用户说：

- “推进剧情”

如果上下文足够明确，也可默认推进当前主线；不必过度 clarification。

## 4.4 `SUMMARIZE_CURRENT_STATE`

| field | level | 说明 | 缺失处理 |
|---|---|---|---|
| `work_name` | `required_to_execute` | 必须知道总结哪个作品 | 无作品上下文阻塞 |
| `summary_scope` | `defaultable` | 通常总结当前作品 | 默认 `current_work` |
| `summary_focus` | `optional_preference` | 是否聚焦角色、剧情、设定、风险点 | 缺失不阻塞 |

### 推荐规则

用户说：

- “总结一下现在情况”

直接执行：

- `summary_scope = current_work`

不应进入 clarification。

## 5. Clarification 决策规则

在处理完推断和默认后，剩余缺失字段按以下逻辑决定：

### 5.1 进入 clarification 的条件

仅当缺失字段中仍存在 `required_to_execute` 时，进入 `NEEDS_CLARIFICATION`。

### 5.2 不进入 clarification 的条件

如果缺失字段只剩：

- `optional_preference`

则应直接执行。

### 5.3 优先执行再可选追问

在部分场景下可以采用“先执行，再补问偏好”策略。

例如：

- 先给出 2 个核心角色备选
- 再问用户是否要偏江湖型、偏朝堂型，还是偏战场型

这比先卡住更符合 agent 体验。

## 6. Clarification Message 模板建议

### 6.1 当剩余缺失项是必须字段

```text
已识别为 {{intent_display_name}} 的请求。
当前还缺少 {{required_fields_display}}，补充后我才能继续执行。
```

### 6.2 当可执行但仍有偏好项可问

```text
已识别为 {{intent_display_name}} 的请求。
我可以先按默认策略继续执行；如果你想更聚焦，也可以补充 {{optional_fields_display}}。
```

第二类消息不应阻塞执行。

## 7. 与 Router 文档的关系

这张表不会替代 Router 的 `missing_fields`。

Router 继续负责：

- 尽量识别缺失项

但最终是否阻塞执行，要由 Orchestrator 结合本表来判断。

所以：

> `missing_fields` 是原始信号，不是最终调度决策。

## 8. 与 Validator 的关系

Validator 继续校验：

- 缺的字段有没有写进 `missing_fields`
- 参数是否和 intent 基本匹配

但 Validator 不负责决定：

- 这个字段该默认还是该澄清

这是 Slot Policy 的职责。

## 9. 对当前案例的结论

用户说：

> 给我两个核心角色备选

正确处理应为：

1. `candidate_count` 从“两个”推断为 `2`
2. `role_type` 从“核心角色”推断为 `core_roles`
3. `selection_flow` 视为 `optional_preference`
4. 直接执行，不进入 clarification

因此，如果系统仍停在：

- `role_type`
- `selection_flow`

说明问题不在 Router 是否识别出 intent，而在 Slot Policy 还没有真正落地。

## 10. 建议后续动作

1. 把本表并入运行时配置，而不是硬编码在代码里
2. 让 Orchestrator 显式读取 slot policy
3. 在 interaction log 中记录：
   - 哪些字段被推断
   - 哪些字段被默认
   - 哪些字段导致 clarification

## 11. 结论

只要槽位策略没有被明确定义，系统就会不断出现：

- 明明可以执行却卡住
- 明明该问用户却直接瞎推

因此：

> `Slot Policy Table` 是从“Router 协议”走向“完整 agent 编排”的关键一环。
