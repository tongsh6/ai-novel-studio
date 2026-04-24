# Conversation Behaviors Contract v2

> 状态：草案
>
> 角色：`docs/design-v2/01-agent-foundation-contract.md` 的 Conversation Behaviors 子系统展开文档，并依赖 `docs/design-v2/02-turn-and-task-state-machines.md`。
>
> 目标：定义 v2 中与对话直接相关的核心行为协议，包括 clarification、confirmation、rejection、cancellation、correction，并明确它们的触发条件、结构化对象、生命周期、对 turn/task/artifact 的影响，以及 UI 可见语义。

---

## 1. 文档定位

本文回答 7 个问题：

1. 哪些行为属于 Foundation 的一等对话行为
2. 每种行为在什么条件下触发
3. 每种行为至少需要哪些结构化字段
4. 行为对象和 turn / task 的关系是什么
5. 行为被回答、拒绝、取消、覆盖后如何收尾
6. 哪些行为会阻断执行，哪些不会
7. UI 和上层 Domain 能依赖哪些稳定语义

本文不负责：

- 某个具体业务 prompt 的文案
- 某个小说 intent 的槽位细节
- UI 视觉样式

本文只定义行为 contract。

---

## 2. Foundation 中的一等对话行为

v2 Foundation 正式冻结以下 5 类一等对话行为：

1. clarification
2. confirmation
3. rejection
4. cancellation
5. correction

这些行为不是 prompt 中的一句自然语言，而是：

- 可持久化对象
- 可进入状态机
- 可被 turn 消费
- 可被 UI 投影
- 可被审计和回放

---

## 3. 总体设计目标

### 3.1 行为要和执行分层

这些行为的存在是为了管理执行前提，而不是代替执行本身。

例如：

- clarification 负责补足信息
- confirmation 负责确认风险
- rejection 负责阻断非法或不当请求
- cancellation 负责终止未来动作
- correction 负责修正前一步的理解或结果

### 3.2 行为要能跨 turn 持续

这些行为不能只存在于“当前 assistant_message 里”。

因为用户可能：

- 下一轮才回答
- 跳到别的问题再回来
- 在 long-run 期间修改主意
- 在 adoption 前才发现前一步错了

### 3.3 行为必须可显式收尾

每种行为都必须有：

- open 条件
- close 条件
- close reason

不能靠“用户没再提，所以算结束了”。

### 3.4 行为必须对运行时有实际约束力

行为不是装饰。

它必须影响：

- next_action
- turn phase
- task pause / resume
- artifact 是否可进入 adoption

---

## 4. 行为对象的共性 contract

对话行为分为两类：

- durable behavior：需要跨 turn 持续、关闭时有 resolution
- instant behavior：即时完成，不创建长期等待态

durable behavior 至少共享以下抽象字段：

- `behavior_id`
- `behavior_type`
- `source_turn_ref`
- `source_task_ref`（可空）
- `scope_ref`
- `status`
- `prompt_message`
- `created_at`
- `updated_at`
- `closed_at`（可空）
- `resolution_ref`（可空）

### 4.1 `behavior_type`

durable behavior 至少支持：

- `clarification`
- `confirmation`
- `cancellation`
- `correction`

instant behavior 至少支持：

- `rejection`

instant behavior 可以有 explanation 和 audit，但不强制具备 durable behavior 的 `resolution_ref`。

### 4.2 `source_turn_ref`

表示哪个 turn 触发了这个行为。

### 4.3 `source_task_ref`

如果行为附着在一个 long-run task 或 delegation 上，必须记录来源 task。

### 4.4 `scope_ref`

行为必须有作用域。

例如：

- 某个 turn
- 某个 task
- 某个 artifact adoption
- 某个 object scope

### 4.5 `resolution_ref`

关闭行为时，必须留一个结构化 resolution 记录，而不是只改状态。

---

## 5. clarification Contract

clarification 用于缺失执行所必需的信息。

### 5.1 clarification 的定义

clarification 回答的问题是：

**“在当前前提下，系统还缺什么信息，导致不能安全或正确地继续执行？”**

### 5.2 clarification 的触发条件

至少包括：

- required slots 未满足
- 当前上下文无法稳定推断关键参数
- 多个候选目标冲突且不能安全默认
- 执行范围不明确

### 5.3 clarification 不应触发的情况

至少包括：

- 只缺 optional preferences
- 可以用高置信默认值补足
- 当前 intent 本身不需要执行

### 5.4 clarification 最小字段

至少包括：

- `clarification_id`
- `source_turn_ref`
- `target_intent`
- `required_fields`
- `optional_fields`
- `current_parameters`
- `prompt_message`
- `status`
- `expiry_policy`
- `resolution_ref`

### 5.5 clarification 的 effect

clarification 触发后，当前 turn 必须至少满足：

- `phase = NEEDS_CLARIFICATION`
- `status = WAITING_USER`
- `next_action = ASK_USER`

如果挂在 task 上，还必须：

- task 进入 `CHECKPOINT`
- checkpoint reason 包含 `CLARIFICATION_REQUIRED`

### 5.6 clarification 的关闭路径

至少包括：

- `RESOLVED`
- `SUPERSEDED`
- `ABANDONED`
- `EXPIRED`

### 5.7 clarification answer merge

用户回答 clarification 时，系统至少要做：

1. 绑定目标 clarification
2. 在 `current_parameters` 基础上合并增量信息
3. 重新验证 required fields 是否已满足
4. 决定进入执行、继续 clarification、或触发别的行为

clarification answer 不应被当作普通新请求粗暴覆盖，除非系统明确判断它是新 intent。

---

## 6. confirmation Contract

confirmation 用于在信息足够的前提下，对高风险或高成本动作做二次确认。

### 6.1 confirmation 的定义

confirmation 回答的问题是：

**“系统知道该做什么，但做之前是否需要你明确同意？”**

### 6.2 confirmation 的触发条件

至少包括：

- 预算超出默认阈值
- 写入范围较大
- 会影响 authoritative state
- 会启动 long-run
- 需要 authority escalation

### 6.3 confirmation 不应触发的情况

至少包括：

- 只读查询
- 低成本、低副作用动作
- 已在明确 policy 中被允许自动执行的动作

### 6.4 confirmation 最小字段

至少包括：

- `confirmation_id`
- `source_turn_ref`
- `target_action`
- `risk_summary`
- `budget_estimate`
- `affected_scope_summary`
- `prompt_message`
- `status`
- `resolution_ref`

### 6.5 confirmation 的 effect

confirmation 触发后，当前 turn 必须至少满足：

- `phase = NEEDS_CONFIRMATION`
- `status = WAITING_USER`
- `next_action = ASK_USER`

如附着在 task 上：

- task 进入 `CONFIRMATION_REQUIRED`

### 6.6 confirmation 的关闭路径

至少包括：

- `CONFIRMED`
- `REJECTED`
- `SUPERSEDED`
- `EXPIRED`

### 6.7 confirmed 不等于已执行

confirmation 被确认后，只是打开继续执行的门。

真正的执行仍需进入：

- 新 turn 的 `READY_TO_EXECUTE / EXECUTING`
- 或 task 的 `CONFIRMED -> RUNNING`

---

## 7. rejection Contract

rejection 用于明确说明“当前请求不应执行”。

### 7.1 rejection 的定义

rejection 回答的问题是：

**“为什么这个请求在当前条件下不能做，或者不应该做？”**

### 7.2 rejection 的触发条件

至少包括：

- 请求超出 authority
- 请求违反系统安全或 policy
- 请求语义无法成立，且不适合走 clarification
- 请求与当前运行边界冲突

### 7.3 rejection 与 clarification 的区别

- clarification：信息不足，继续问能推进
- rejection：即便信息更完整，当前路径也不应继续

### 7.4 rejection 最小字段

至少包括：

- `rejection_id`
- `source_turn_ref`
- `reason_code`
- `user_facing_explanation`
- `allowed_alternatives`
- `status`

### 7.5 rejection 的 effect

rejection 触发后，当前 turn 通常直接进入：

- `phase = COMPLETED`
- `status = DONE`

或者：

- `phase = FAILED`
- `status = ERROR`

取决于它是业务拒绝还是系统错误拒绝。

默认推荐业务拒绝使用：

- `COMPLETED + next_action = NO_FURTHER_ACTION` 或 `ASK_USER`

### 7.6 rejection 不创建等待态

rejection 本身不是 open-wait-close 的行为对象。  
它通常是即时终结行为。

除非未来需要“可复议 rejection”，否则不建议把 rejection 做成长期开放状态。

---

## 8. cancellation Contract

cancellation 用于终止未来动作，而不是回滚过去动作。

### 8.1 cancellation 的定义

cancellation 回答的问题是：

**“从现在开始，不要继续这个动作、这个 task 或这个 delegation 了。”**

### 8.2 cancellation 的触发对象

至少支持：

- current turn
- clarification / confirmation waiting path
- long-run task
- delegation
- future units in a task

### 8.3 cancellation 最小字段

至少包括：

- `cancellation_id`
- `source_turn_ref`
- `target_entity_type`
- `target_entity_ref`
- `cancellation_scope`
- `effect_summary`
- `status`
- `resolution_ref`

### 8.4 cancellation 的 effect

取决于目标对象：

- turn -> `CANCELLED`
- task -> `CANCELLED`
- delegation -> `CANCELLED`
- open clarification / confirmation -> 对应对象终结

### 8.5 cancellation 不等于 rollback

必须再次强调：

- cancellation 停止未来动作
- 不自动撤销已 accepted 的结果
- 不自动回退已 applied mutation

### 8.6 cancellation 后的残留

系统至少要能保留：

- 已完成 unit 的 tentative artifacts
- cancellation summary
- last checkpoint ref（如有）
- unresolved adoption items

---

## 9. correction Contract

correction 用于修正前一步的理解、参数、结果或状态。

### 9.1 correction 的定义

correction 回答的问题是：

**“前一步不是完全不能做，而是做错了、理解错了、参数错了，或者现在我要修正它。”**

### 9.2 correction 的触发场景

至少包括：

- Router 识别错 intent
- slot merge 错了
- artifact 虽已生成，但方向错了
- authoritative state 需要修正而非简单回滚
- 用户明确说“不是这个意思”“上一章那个设定改掉”

### 9.3 correction 与 rejection 的区别

- rejection：这条路径不应继续
- correction：这条路径可以继续，但要先修正

### 9.4 correction 最小字段

至少包括：

- `correction_id`
- `source_turn_ref`
- `corrected_entity_type`
- `corrected_entity_ref`
- `reason_summary`
- `proposed_resolution_type`
- `status`
- `resolution_ref`

### 9.5 correction 的 effect

correction 可能导致：

- old artifact 被 superseded
- task 进入 checkpoint
- adoption 被阻断
- 生成新的 mutation proposal
- 生成新的 branch

### 9.6 correction 的关闭路径

至少包括：

- `RESOLVED`
- `SUPERSEDED`
- `ABANDONED`
- `EXPIRED`

因为 correction 往往需要进一步处理，不宜做成纯即时行为。

---

## 10. 行为优先级

一个 turn 可能同时满足多个行为触发条件，必须有优先级。

### 10.1 推荐优先级

推荐顺序：

1. rejection
2. cancellation
3. correction
4. clarification
5. confirmation
6. execute

### 10.2 解释

- `rejection` 优先，因为这类情况根本不应继续当前路径
- `cancellation` 优先，因为用户或系统已明确停止
- `correction` 优先于 clarification / confirmation，因为错误前提先要修正
- `clarification` 优先于 confirmation，因为信息都没齐，不该先问“要不要做”

### 10.3 优先级是默认，不是不可变规则

特定 Domain 可以补 heuristic，但不能颠覆核心原则。

例如不能出现：

- required fields 都没齐，却先发 confirmation

---

## 11. 行为与 turn 的关系

### 11.1 一个 turn 可以触发一个主行为

默认一个 turn 只进入一个主行为决策结果。

例如：

- NEEDS_CLARIFICATION
- NEEDS_CONFIRMATION
- COMPLETED with rejection

### 11.2 行为对象可以跨多个 turn

例如：

- turn_001 触发 clarification
- turn_002 回答 clarification
- turn_003 又 supersede 了它

### 11.3 行为对象与 turn 不等价

turn 是交互闭环。  
行为对象是运行时附属状态。

---

## 12. 行为与 task 的关系

### 12.1 行为可以挂在 task 上

特别是：

- clarification
- confirmation
- cancellation
- correction

### 12.2 task 上的行为必须影响 task 状态

例如：

- clarification -> task `CHECKPOINT`
- confirmation -> task `CONFIRMATION_REQUIRED`
- cancellation -> task `CANCELLED`
- correction -> task `CHECKPOINT` 或 `BRANCHED`

### 12.3 task 行为与 turn 行为要互相可追溯

至少能回答：

- 哪个 turn 触发了这个 task behavior
- 这个 task behavior 最终由哪个 turn 关闭

---

## 13. 行为与 artifact 的关系

### 13.1 clarification

通常阻止 artifact 继续生成。

### 13.2 confirmation

通常阻止 artifact 进入高影响写入路径。

### 13.3 rejection

通常不会产生新的 artifact，除非是 explanation artifact。

### 13.4 cancellation

会阻止新 artifact 产生，但不自动删除既有 artifact。

### 13.5 correction

可能导致：

- 旧 artifact `SUPERSEDED`
- 旧 artifact `INVALIDATED`
- 新 artifact 生成

---

## 14. Resolution Contract

所有可关闭行为都必须有 resolution 对象。

### 14.1 resolution 最小字段

至少包括：

- `behavior_ref`
- `close_reason`
- `closed_by_turn_ref`
- `result_summary`
- `delta_refs`
- `closed_at`

### 14.2 `close_reason`

至少允许：

- answered
- confirmed
- rejected
- superseded_by_new_intent
- cancelled_by_user
- abandoned
- expired
- corrected

不同 behavior 可取不同子集。

### 14.3 resolution 必须可回放

后续回看时，至少能知道：

- 为什么开
- 怎么关
- 关闭后影响了什么

---

## 15. 与状态机的关系

本文定义行为协议；状态位置由状态机文档承接。

### 15.1 clarification

对应：

- turn `NEEDS_CLARIFICATION`
- clarification `OPEN -> ...`

### 15.2 confirmation

对应：

- turn `NEEDS_CONFIRMATION`
- task `CONFIRMATION_REQUIRED`
- confirmation `OPEN -> ...`

### 15.3 cancellation

对应：

- target entity 进入 `CANCELLED`

### 15.4 correction

通常对应：

- task `CHECKPOINT`
- artifact `SUPERSEDED / INVALIDATED`

### 15.5 rejection

通常对应：

- turn `COMPLETED` 或 `FAILED`

---

## 16. 与 consistency 的关系

行为经常是由一致性系统触发的。

### 16.1 clarification

当冲突不是“状态错了”，而是“关键信息不清楚”时触发。

### 16.2 confirmation

当 authority 或 budget 需要升级时触发。

### 16.3 correction

当已有结果或前提需要修正时触发。

### 16.4 rejection

当当前路径本质上不允许继续时触发。

---

## 17. 与 UI 的关系

UI 必须消费行为 contract，而不是自己猜系统在问什么。

### 17.1 UI 至少要投影

- clarification card
- confirmation card
- rejection message / card
- cancellation summary
- correction required card

### 17.2 UI 不应自己决定

例如：

- “这个像 clarification，所以给个输入框”
- “这个像 confirmation，所以给两个按钮”

这些必须由 behavior type 和 next_action 驱动。

### 17.3 行为的 UI 基本动作

至少支持：

- answer
- confirm
- reject
- cancel
- revise
- dismiss / abandon（在允许时）

---

## 18. 与 Domain 的接口

Domain 可以定义各 intent 在什么条件下触发哪些行为，但不能改写行为的基础语义。

### 18.1 Domain 可注册项

至少包括：

- required slot policy
- confirmation thresholds
- rejection reason codes
- correction templates
- behavior-specific UI hints

### 18.2 Domain 不得改写项

Domain 不得改写：

- clarification 用于补信息
- confirmation 用于确认高风险动作
- rejection 是阻断而不是等待
- cancellation 不等于 rollback
- correction 是修正而不是重命名 rejection

---

## 19. 持久化与事件要求

至少要持久化：

- behavior objects
- behavior resolutions
- behavior-triggered turn refs
- target task refs

### 19.1 最小事件集合

至少包括：

- behavior_created
- behavior_answered
- behavior_confirmed
- behavior_rejected
- behavior_superseded
- behavior_cancelled
- behavior_abandoned
- behavior_expired
- behavior_resolved

---

## 20. 契约测试要求

### 20.1 behavior trigger tests

验证：

- clarification 只在 required info 缺失时触发
- confirmation 不早于 clarification
- rejection 与 correction 不混淆

### 20.2 lifecycle tests

验证：

- clarification / confirmation / correction 的关闭路径
- cancellation 对 target entity 的影响

### 20.3 turn integration tests

验证：

- 行为触发后 turn 的 phase / status / next_action 正确

### 20.4 task integration tests

验证：

- behavior 触发后 task 正确进入 checkpoint / confirmation_required / cancelled

---

## 21. 本文冻结的硬骨

本文正式冻结以下对话行为硬骨：

1. clarification / confirmation / rejection / cancellation / correction 是 Foundation 的一等行为
2. 这些行为是结构化对象，不是 prompt 话术
3. clarification 只用于补足必需信息
4. confirmation 只用于高风险 / 高成本动作确认
5. rejection 是阻断行为，不是等待行为
6. cancellation 终止未来动作，不自动 rollback
7. correction 用于修正前一步理解、结果或状态
8. 所有可关闭行为都必须有 resolution record
9. behavior 会直接影响 turn / task / artifact 的运行语义

---

## 22. 本文暂不冻结的内容

以下只定边界，不定最终字段：

1. reason code 枚举全集
2. confirmation 阈值默认值
3. correction resolution 的细分类
4. behavior-specific UI hint 的最终 schema

---

## 23. 下一步

行为协议之后，建议继续：

1. `04-capability-and-intent-registry.md`

因为状态机和行为都已经有了，接下来应该把 system“知道自己会什么”和“如何把 intent 映射到 capability”这层注册机制钉死。
