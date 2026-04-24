# Orchestrator Cutover Plan

> 本文档是以下设计文档的实施迁移计划：
>
> - [10-agent-orchestration-upgrade.md](./10-agent-orchestration-upgrade.md)
> - [11-agent-turn-result-schema.md](./11-agent-turn-result-schema.md)
> - [12-slot-policy-table.md](./12-slot-policy-table.md)
> - [13-orchestrator-runtime-spec.md](./13-orchestrator-runtime-spec.md)
>
> 它不定义新架构，而是定义：
>
> - 如何从当前实现切到新编排模型
> - 切换顺序是什么
> - 每阶段验收标准是什么
> - 哪些边界必须保持稳定

## 1. 迁移目标

当前系统已经有：

1. Router
2. Validator
3. Context Manager
4. Executor
5. Interaction log

但还没有：

1. 统一的 `AgentTurnResult`
2. 真正的 Orchestrator 层
3. clarification state
4. 基于 slot policy 的执行决策
5. 前后端统一消费 contract

本次 cutover 的目标不是“修几个问题”，而是完成以下收口：

> 前端主入口只认 `AgentTurnResult`，后端主编排只认 `Orchestrator`，slot 决策不再散落在路由结果和前端兜底逻辑里。

## 2. 当前实现现状

## 2.1 已具备能力

目前代码已经具备这些基础：

- 有 Router 输出协议
- 有 Router Validator
- 有 Executor Registry
- 有 interaction log 基础表
- 前端已通过 `/interactions` 发起主对话

这意味着不需要推倒重来。

## 2.2 当前主要问题

### 问题 A：`/interactions` 不是 canonical agent contract

当前 `/interactions` 返回的是内部 packet，而不是 `AgentTurnResult`。

结果是：

- 前端读不到统一的 `assistant_message`
- 只能自己兜底 `"收到。"`

### 问题 B：clarification 只是状态，不是正式交互对象

当前系统能判断：

- `NEEDS_CLARIFICATION`

但没有：

- clarification state
- clarification message contract
- clarification merge runtime

### 问题 C：slot 决策没有进入编排层

虽然已经有 default fill 和 validator，但还没有一张正式的 slot policy 参与运行时决策。

### 问题 D：前端仍带有旧聊天语义残留

前端已经不再走旧 `/chat` 主路径，但渲染逻辑仍然默认：

- 请求回来后一定有顶层 `reply`

这本质上是 contract 不统一。

## 3. 迁移原则

### 3.1 只允许一个主入口

前端主交互入口必须统一到：

- `POST /api/works/{id}/interactions`

### 3.2 只允许一个主返回结构

前端主渲染必须统一到：

- `AgentTurnResult`

### 3.3 `/route` 与 `/execute` 保留但降级

它们只作为：

- 调试接口
- 测试接口
- 验证接口

不再作为产品主链路。

### 3.4 工作台显式动作不混入聊天编排

继续保留：

- 创建作品
- 切换章节
- 生成细纲
- 生成草稿
- 切换阅读态

这些仍是显式 workbench action。

## 4. 迁移分期

## Phase 1：引入 Orchestrator 外壳，不改 Router / Executor

### 目标

新增一个明确的 `Orchestrator` 服务对象，把现有：

- `route_user_request`
- `execute_router_result`
- `process_interaction`

统一收口到一个编排入口。

### 本阶段要做

1. 新增 `orchestrator.py`
2. 新增 `orchestrate_turn(work_id, text, ...) -> AgentTurnResult`
3. 让 `/interactions` 改为调用 Orchestrator，而不是直接返回旧 packet
4. 暂时复用现有 Router / Validator / Executor

### 本阶段不做

1. 不重写 Router
2. 不重写 Executor
3. 不引入 clarification persistence
4. 不改按钮类工作台动作

### 验收标准

1. `/interactions` 永远返回 `AgentTurnResult`
2. 前端不再读取顶层 `reply`
3. “收到。” 这类前端兜底文本从主链路消失

## Phase 2：接入 Slot Policy Runtime

### 目标

把 [12-slot-policy-table.md](./12-slot-policy-table.md) 变成运行时决策配置。

### 本阶段要做

1. 把当前 4 个 intent 的 slot policy 配置化
2. 在 Orchestrator 中实现：
   - infer
   - default
   - clarification decision
3. 输出 `slot_resolution`

### 本阶段不做

1. 不做复杂多轮 clarification
2. 不做自动学习型策略

### 验收标准

1. “给我两个核心角色备选” 直接执行
2. “总结一下现在情况” 直接执行
3. 真正缺少必须字段时，才进入 clarification

## Phase 3：Clarification State 落地

### 目标

把 clarification 从“临时状态”升级为“可持续的交互对象”。

### 本阶段要做

1. 新增 clarification state persistence
2. interaction log 增加 clarification 关联信息
3. Orchestrator 支持 merge clarification answer
4. 定义 clarification close reason

### 本阶段不做

1. 不做复杂多 clarification 并发
2. 不做跨作品 clarification 复用

### 验收标准

1. 系统能识别“用户是在回答上一轮 clarification”
2. clarification 结果能进入下一轮执行
3. clarification 关闭原因可追踪

## Phase 4：前端切到 Canonical Rendering

### 目标

让前端只依赖：

- `assistant_message`
- `phase`
- `status`
- `next_action`

### 本阶段要做

1. 聊天区只渲染 `assistant_message.content`
2. clarification 显示成正常 agent 回合
3. 根据 `phase/status` 显示等待态、完成态、错误态
4. structured result 由 `execution_result.action_result` 驱动

### 本阶段不做

1. 不把 route packet 暴露给普通用户
2. 不让前端再判断 intent 来拼接主消息

### 验收标准

1. 前端不再读 `route_result.reply`
2. 前端不再用 `"收到。"` 做主兜底
3. clarification 与 completed 都表现为正常 agent 消息

## Phase 5：清理旧兼容层

### 目标

删除或降级旧路径，完成真正收口。

### 本阶段要做

1. `/chat` 降级成 `/interactions` 代理或彻底废弃
2. 删除旧 packet-only 主路径
3. 清理内部命名不一致：
   - `actionResult` -> `action_result`
   - `validationResult` -> `validation`
4. interaction log 结构升级

### 验收标准

1. 主链路没有双协议并存
2. 代码里不存在“前端读 packet、后端返回另一种对象”的现象
3. 旧字段名只存在适配层，不存在主模型

## 5. 推荐文件落点

## 5.1 新增文件

建议新增：

- `novel_workbench/orchestrator.py`
- `novel_workbench/orchestration/turn_result.py`
- `novel_workbench/orchestration/slot_policy.py`
- `novel_workbench/orchestration/clarification.py`

## 5.2 需要调整的现有文件

- `novel_workbench/http_api.py`
- `novel_workbench/services/workbench.py`
- `novel_workbench/storage/repositories.py`
- `novel_workbench/storage/schema.sql`
- `web/app.js`

## 6. 推荐切换顺序

实现时建议严格按以下顺序：

1. 先加 Orchestrator
2. 再让 `/interactions` 返回 `AgentTurnResult`
3. 再接 slot policy
4. 再做 clarification persistence
5. 再切前端渲染
6. 最后清旧 `/chat`

### 为什么不能反过来

如果先改前端：

- 后端 contract 还没稳定
- 会出现更多临时适配

如果先做 clarification persistence：

- 但没有统一 turn contract
- clarification 仍然会变成“数据在，交互不稳定”

## 7. 关键验收用例

## 7.1 直接执行型

输入：

- “总结一下现在情况”

期望：

- `phase = COMPLETED`
- 有 `assistant_message`
- 有 `execution_result`

## 7.2 推断型

输入：

- “给我两个核心角色备选”

期望：

- `candidate_count = 2`
- `role_type = core_roles`
- 不进入 clarification

## 7.3 clarification 型

输入：

- “把角色再细一点”

期望：

- `phase = NEEDS_CLARIFICATION`
- `next_action.type = ASK_USER`
- clarification 指向缺少 `character_name` / `refine_dimensions`

## 7.4 OTHER 型

输入：

- “你觉得人生是什么”

期望：

- `phase = ROUTED`
- `status = READY`
- 不进入 Executor

## 7.5 clarification merge 型

第一轮：

- “把角色再细一点”

第二轮：

- “秦婉，狠一点”

期望：

- 第二轮能识别为回答 clarification
- 合并后进入执行

## 8. 回滚边界

每个 phase 都要能独立回滚。

### 可独立回滚的边界

1. Orchestrator 外壳
2. slot policy runtime
3. clarification persistence
4. 前端 canonical rendering

### 不应一次性混做的内容

1. Router Prompt 重写
2. Executor Prompt 重写
3. UI 大改版
4. storage 大重构

这些会增加变量，降低验证能力。

## 9. 风险与防御

### 风险 1：表面统一，实际双协议仍然并存

防御：

- 让前端只依赖 `AgentTurnResult`

### 风险 2：slot policy 写成硬编码 if/else

防御：

- 做成独立配置层

### 风险 3：clarification 实现成 message hack

防御：

- 明确 clarification state object

### 风险 4：`/chat` 长期不清

防御：

- 在 Phase 5 明确降级或废弃

## 10. 完成定义

当以下条件全部满足时，才算完成 cutover：

1. 前端主交互只依赖 `AgentTurnResult`
2. `/interactions` 是唯一主入口
3. clarification 有正式 phase 和 state
4. slot policy 运行时生效
5. `/chat` 不再拥有独立产品语义
6. “给我两个核心角色备选”这类请求能稳定直接执行

## 11. 结论

这次 cutover 的本质不是“修接口字段”，而是：

> 把现有的 Router/Executor 原型，收口为一个真正可运行、可持续演化的 agent 交互系统。

只有切换顺序明确、验收标准明确、回滚边界明确，后续实现才不会再次回到：

- 前端自己拼协议
- 后端自己猜主入口
- clarification 像失败
- 可执行请求却卡住
