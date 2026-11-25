# B91 · Agent 多轮多步执行、反馈纠错与统一预算

**状态**：**todo（2026-11-25 规划登记；运行时尚未修改或验收）**。优先于 [B90](B90-application-formatting-capability.md)。唯一执行状态源为本文件；[NEXT](../NEXT.md) 只记录排期。登记不将现有两次上限视为合理终态，也不表示该限制已解除。

## 1. 来源与作者效果

作者于 2026-11-25 要求独立处理“两次就耗尽”的限制，并提出应用应具备“n 轮、每轮 n 步”的概念，参考 DSH。本任务采用其轮、模型交互步、传输尝试分层的思想，重构项目已有运行链。

作者给出目标后，Agent 能在有效授权与任务资源内持续完成“判断 → 取材/调用能力 → 接收结果 → 再判断”，可修正的失败有继续机会；目标完成、需要作者、取消、真实不可恢复故障或资源边界才按事实停止。后续输入和运行中补充有清晰归属，作者无需因内部低次数上限反复发送“继续”。

“n 轮、n 步”描述可变长度的执行结构，不是要求每个任务跑满固定次数，也不等于无限运行。简单问题可一步结束，取消/拒绝可在尚无模型步骤时结束。模型正常停止、一轮结束、计划耗尽与作者目标达成分别记录，不能互相冒充。

愿景依据：[00 §2.3](../../docs/design/00-vision-and-engineering-roadmap.md#23-产品形态判断驱动的创作伙伴2026-07-15-用户拍板收敛)。运行与历史契约继续由既有 UA-01、[VS-00L](../../docs/design/contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md)、[ADR-0035](../../docs/design/adr/ADR-0035-session-scoped-canonical-authoring-context-v3.md) 持有；本任务不另建 Agent 框架。

## 2. 术语与映射：先分清，再改实体

| 概念 | 本任务采用的语义 | 既有映射与约束 |
|---|---|---|
| Session / 会话 | 连续多轮工作的历史与上下文容器 | 复用 `AuthoringSessionHistory`、session canonical 与现 persistence；不另存第二份对话 |
| 作者输入轮 | 真实作者消息或绑定作者动作及其来源 | 复用 `TurnInteractionService`；内部纠错不能伪造新的作者输入 |
| 运行轮（DSH Turn 参考） | 从实际输入或合法续轮触发，到本轮明确停止的一段模型循环 | 与本项目作者 Turn、`AgentRun` 的精确映射由 CP0 核定；不假定三者一一对应，不预建 Round/TurnRun 表 |
| 模型交互步（DSH Step 参考） | 一次逻辑模型推理及该次响应要求的工具调用/结果；没有工具的最终回答也算一步 | 从既有 canonical、ProviderCall、ToolCall/Observation 关联事实派生；不直接复用作者可见 PlanStep 名义 |
| 计划步骤 / 运行执行步骤 | 分别是作者可见计划单位、经过执行门的实际动作单位 | `AgentPlan.PlanStep` 与 `AgentStep` 已明确不同；一次计划推进或执行步骤可能包含多次模型交互 |
| Attempt / 传输尝试 | 同一个逻辑模型请求的网络发送、重连或重发 | 单独记录实际调用与消耗，不因此新建运行轮或推进计划 cursor；需修正内容的下一次模型判断则是新逻辑步 |
| ToolCall / 工具调用 | 模型提出的具名调用及真实结果 | 每条调用保留真实 call_id、输入、反馈、是否派发及实际效果；同一步可有一批调用，不因数量推断并发或授权 |

`AgentRun` 当前明确不是作者 turn，也不自行授予工具权限；`AgentPlan` 明确 PlanStep 不是 runtime AgentStep 或 ToolCall。因此以上是待在原契约固化的语义与映射，不授权新建同义实体或改坏现有身份。CP0 必须给出序号、归属、计数和事件映射表；确有字段缺口时才说明现有字段不能承担的原因及真实消费者。

### 2.1 输入、续轮与目标

- 后续独立输入与运行中 steer 分开；复用现 `receive_input`、`record_steer`、goal.version 与 interrupt_state。运行中补充何时生效、旧目标后续动作何时失效，要由持久化后的同一事实决定。
- 同一授权目标未完成时，复用现有继续/重规划机制判断下一动作；需要进入后续运行轮时保留原目标、累计资源和触发来源，不能重新开 run 清零绕预算，也不能伪装作者新发了消息。
- DSH 的自动 Goal Round 是额外的续轮策略，不等于普通 Turn 内的工具循环。本项目先核已有 goal、使命、计划和继续入口，只处理当前会话中已有有效授权目标的继续，不引入平行 Goal 对象、外部事件入口或新工作队列。是否需要独立续轮计数及其 owner 在 CP0 明确。
- 本任务不扩大作品/目标范围；新增授权模式、长期委托和自动采纳归 B89，Goal 持续运行架构归 B77，多 Agent/24×7 归 B50。既有作者授权有效的目标内连续工作不等待这些任务整项完成，也不解除其各自暂停决定。

## 3. 当前缺口与存在性审计

登记基线：`develop/dialogue-based-novel-workbench`，HEAD `6598b151bf33bd6b81c8faf3db52c540c969c141`。当前已有会话、运行、计划、步骤、预算、取消、steer、暂停和 durable checkpoint；需要统一其职责与政策。

| 当前事实 / 职责 | 现 owner | 处理方向 |
|---|---|---|
| 专业交换 `@max_provider_calls 2`，配置也被 `min(2, value)` 截断 | `apps/novel_agent/lib/novel_agent/provider/native_tool_exchange.ex` | 取消未经任务依据的一律两次硬顶；保留真实反馈、唯一纠错决定和准确计数 |
| 应用再次将剩余预算压到 0..2 | `apps/novel_application/lib/novel_application/authoring_operation.ex` | 传递同一有效预算，不私自叠加第二套额度 |
| 写作步骤固定估为 2 次 Provider；还有 steps/tools/provider/replans 总预算 | `apps/novel_application/lib/novel_application/agent_run_budget.ex` | 分离成本估算、资源上限与实际消耗，不把估算值当必然结束条件 |
| 判断纠错固定两次 | 现 `JudgmentProtocol` | 同批核其逻辑步/尝试归属，避免 Writer 放开而判断仍早停 |
| 普通探索固定 2 轮，准确分页另有 8 轮 | `ExplorationPolicy`、`ExplorationService` | 核读取资格与消耗控制；资格约束保留，次数策略服从任务依据，不因改步数放宽未读/跨作品访问 |
| 判断 → 观察 → 再判断已存在 | `DialoguePlanningService`、`AgentRunServer`、现 judgment/plan flow | 在原 owner 收敛继续/结束责任，不外包一层新 while/retry |
| 专业接收链已有 schema＋引用资格联合反馈，schema 仍可遮住同响应说明错误 | `CreativeProvider.Real`、现校验器、`CreativeProviderResult.errors` | 完整回流可独立确认的错误；坏形状不猜事实，不新增词表、隐藏模型复审或平行 Gate |
| 预算预检、取消、暂停/继续、幂等和 durable 恢复已有消费者 | `ExecutionOrchestrator`、`AgentRunService/Server`、`AgentRunPersistence` | 复用同一状态/事务链；bounded 不冒充 durable，恢复不重做已完成效果 |

历史两次策略来自一次格式纠错及 B71 避免“内两次×外两次”的统一预算要求；相关记录未提供两次足够或最优的量化依据。保持唯一计数与准确回执，不继续把历史数字当作产品目标。现 [VS-00L §16.7](../../docs/design/contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md#167-修订结果校验同一交换预算与作者动作边界) 明定两次，实施前须修订这一责任层契约及其消费者；本次登记没有悄悄改变 Frozen 契约。

## 4. 继续、停止与预算原则

1. 可纠正的结构/参数/材料错误作为真实反馈进入同一 canonical；模型基于反馈继续下一逻辑步。未知/损坏容器只报告已确定的问题；不能通过修改模型原文制造合法输出。
2. 每次真实调用都入账；协议纠错、应用范围校验、专业角色和可选传输恢复不能各自重置计数或相乘重试。逻辑步、工具派发、网络尝试和实际写入分别可核对。
3. 运行预算以现有唯一 owner 派生和执行；局部限制如仍有必要，须有明确作用层、配置来源、消耗口径和证据。默认值在 CP0 按真实任务成本与可中断性核定，不先把 2 改成另一任意常量。
4. 目标有证据达成时结束；需要作者消歧或新授权时等待；用户取消、确定性程序故障、资源耗尽时停止并保留准确原因。普通可修复工具失败不能无差别地变成整个目标失败。
5. 重复失败的停止判断必须结合相同输入、真实结果与是否有新信息；相同错误码但参数正在改正不等于无进展。使用现有历史与预算，不为判断进展另起一层付费模型或关键词路由器。
6. 网络结果不确定时先核真实副作用；已有结果不重复执行，未确认结果不冒充成功。恢复、续轮、重规划和新 run 均不得继承已失效授权或把旧消耗清零。
7. 一步多工具只在当前调用契约确实允许时使用；保留顺序、依赖、逐调用 Gate 与副作用边界。不借 DSH 的能力放开现单工具专业输出协议或引入并行执行框架。

## 5. 开工七问

| 项 | 本任务的约束 |
|---|---|
| Contract | 原 UA-01、VS-00L、ADR-0035、AgentRun/Plan/Step、RequestIR/ToolResult；先核术语、事件、预算和 Frozen 变更，后实现 |
| Invariant | 原始作者/模型消息与调用身份不重写；真实消耗不漏计；已完成效果不重做；目标/版本/权限/采纳保持 |
| Boundary | application 编排/预算，agent 交换/Provider，common 纯契约，domain 纯规则，现 persistence 事务恢复及 web/frontend 状态消费 |
| Consumer | WorkspaceChat 真实作者请求、补充、继续/取消，经现 Channel/AgentRun 到判断/工具/候选；无新演示入口 |
| Proof | 将模型逻辑步、计划推进、网络尝试、工具派发和实际写入分别核账；机制故障序列与真实模型多步行为分开证明 |
| Acceptance Driver | 复用现外部 Tauri/AX 及共享候选/运行/恢复驱动，覆盖超过两步、持续纠错、steer、取消、预算、恢复；产品验收感知为 no |
| Exploration | 复用真实 Base/Observation/used_context_refs 和读取资格；增加步数不把 partial 或未读材料变成 complete |

## 6. Checkpoint

| CP | 工作 | 结束条件 |
|---|---|---|
| CP0 语义与政策 | 在原设计明确轮/步/尝试/计划/执行/目标对应关系，核所有局部限制、续轮权威和默认预算依据；列全现消费者 | 无同义实体、双计数或循环依赖；设计变更与产品效果一致，可按现 owner 实施 |
| CP1 反馈与执行循环 | 统一判断、探索、专业工具和普通执行的反馈/继续/终止责任，修正硬截断与成本分配 | 第三次及后续合法纠错可发生；失败历史、调用和资源实际可核；无嵌套重试绕限 |
| CP2 生命周期 | 迁移受本次循环/预算改动影响的既有作者后续输入/steer、取消、等待、继续、重规划和适用 durable 恢复消费者；同步必要现 UI/Why，不重开无关历史恢复或多 Agent 债务 | 新目标生效、预算不重置、取消触达真实执行、恢复不重复效果，bounded 边界诚实 |
| CP3 真实闭环 | 固定多轮多步、错误纠正与异常场景，经外部真实 Tauri 和真实模型取证，跑适用完整工程门 | 完整 DoD 成立、消费者同批迁移、无无效兼容入口、可审查提交与证据完整 |

各 CP 降低执行规模，不缩小本 slice 的完整闭环；只有 CP3 与完整 DoD 全部满足才 done。

## 7. 完整 DoD 与独立反例

1. 同一会话连续多轮真实输入保留正确顺序、来源和历史；运行中 steer 与新轮有确定语义。需续轮的同一授权目标沿既有目标/使命继续，停止一轮不冒充任务完成。
2. 一次目标可以完成超过两次必要模型交互。受控真实入口证明连续两次可纠正失败后第三次合法结果能被接收；真实模型另证明必要多步取材/行动/反馈，不用故障替身代签语义成功。
3. 记录每轮各自步骤数，数值可以不同；简单任务及时完成，不为达到 N/M 人为增加推理、计划或工具调用。
4. 首次、纠正和网络重发准确入账；网络 retry 不假增作者轮/计划进度，真正新逻辑模型步不被藏作免费 attempt。多工具结果逐项关联真实调用，非法调用不会被计作执行成功。
5. 总预算和必要局部策略一致，耗尽时准确说明并保留进展；明确继续的额度变化有来源，既有实际消耗与历史不被抹掉。
6. 取消触达 Provider/执行，取消后不派发后续新动作；steer 后旧目标的未执行动作失效或重新过门。取消与返回并发有唯一可解释结果。
7. durable 恢复核作品、会话、目标版本、权限、checkpoint 和真实效果，已完成写入不重做；bounded 入口不虚称可跨进程恢复。
8. 候选、说明、source/coverage、人工确认/采纳、作品隔离、版本、Why/Replay 仍成立；持续工作不扩大授权。
9. 旧失败原件及原预算保留；新模型/页面证据绑定新策略和受验源。适用完整工程门、现消费者迁移与可达文档完整，无平行历史或孤儿实体。

必须覆盖：持续同样无效输出；错误码相同但参数有进展；工具已产生效果而回执断流；取消后迟到结果；讨论被错误继承为执行授权；作者中途改目标；恢复时版本/授权变化；计划完成但目标未达；局部材料假称完整；某一内层循环绕过总账；一轮零步/单步/多步和多轮不同步数。

## 8. 与既有任务的责任及排期

- 从 B87 的 P2 反例承接通用接收反馈、局部两次硬限及相关循环政策；原件见 `artifacts/slice-verify/b87-r08-20261122/feedback-20261124-01/delivery-final-01.json`。P2 排版产品交付归 B90；已完成的 schema＋引用资格联合反馈不重复实现。
- B87 R08 保留意图、对象消歧、授权、材料来源/coverage 与说明真实性；R17–R19 保留既有不变量及实际改动回归。B91 的新运行目标独立验收，不设为 B87 整项前置；若保留判据确被本机制缺陷阻断，按具体场景记实际依赖，不能通过移交把 FAIL 改 PASS。
- 已查重 [B77](B77-goal-centric-runtime-architecture.md)：其 Goal/EventEnvelope/WorkItem 所有权、Router–Worker、外部事件、lease/Watchdog、跨设备控制面和 R1–R7 属延期的整体目标架构评审。本任务仅在现有运行链内统一循环和资源政策，不恢复 B77 或复制其新架构，也不把其整体接受作为前置；等待/恢复的共同术语按实际责任映射，不重复建账。
- B89 继续 deferred，负责新增授权模式、风险、委托、自动采纳与 Smart。本任务负责在已有授权内怎样持续执行，不扩大既有授权的跨轮有效范围；每次续轮重核现授权、目标版本和资源。额外长期委托与自动采纳仍归 B89，不改变 B50 多 Agent/24×7 的延期决定。
- B90 的排版能力可复用本任务已交付的公共运行机制；两任务 CP0 可独立进行，不互等完整 PASS。B91 在候选中优先于 B90；当前 B87 主线不因本次登记自动暂停。
- 本次只登记任务和范围；CP0 还需将具体映射、默认资源政策与必要契约变更写回原设计。不得把方向认可、文档完成、机制验证、真实模型或产品完成混为同一状态。

## 9. 外部参考与恢复入口

本次只读核对 DSH 官方 `deepseek-ai/deepseek-harness`，参考提交 `4b399c39a6d1479cd84ca591b4d7c88e24d38a96`（2026-11-22）。参考其职责分层，不复制其实体、插件体系或所有默认策略：

- [Session 事件：Turn / Step / Attempt / ToolCall](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/subsystems/session.md)。
- [Agent 循环实现](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/agent-loop/src/agent.ts) 与 [输入/steer API](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/agent/README.md)。
- [Goal 续轮驱动](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/goal/goal-round-driver/README.md)：与普通轮内循环区分，不能据此另造本项目 Goal 实体或宣称无限自主执行。

恢复时先读本任务、NEXT、上述原设计和实际 owner，核最新 HEAD/WIP、目标判据及迁移清单。每批实施前封存 scope，按源码变化和缺失证据安排有限验证；次数配置改变需新证据，不回写旧窗口。登记阶段未运行模型、原生场景或生产改造。
