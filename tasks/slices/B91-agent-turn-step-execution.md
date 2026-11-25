# B91 · Agent 多轮多步执行、反馈纠错与统一预算

**状态**：**doing（2026-11-26 作者确认提前开工；CP0 设计与基线已核定，下一执行点 CP1；运行时尚未修改或验收）**。按 [B87 §36](B87-model-interaction-request-projection.md#36-作者确认提前-b912026-11-26) 优先于 R17 缺证回验及 [B90](B90-application-formatting-capability.md)；唯一执行状态源为本文件，[NEXT](../NEXT.md) 只记录排期。旧失败与原 DoD 保持。

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
- 2026-11-25 历史调度见 [B87 §34](B87-model-interaction-request-projection.md#34-作者重新排任务顺序2026-11-25)：原定先交付 R17，再以 CP0 核 R08 §33 具体依赖；2026-11-26 最新作者调度由 [B87 §36](B87-model-interaction-request-projection.md#36-作者确认提前-b912026-11-26) 及本任务 §10 覆盖，提前开 B91 并在必要运行依赖解除后先补 R17。不能将两次改成任意更大数字、预判更多步骤能通过全部语义、或把 S4 超时直接归为本任务根因。B91 仍是独立 slice，不改变其完整 DoD，不自动成为 B87 全项前置。
- 已查重 [B77](B77-goal-centric-runtime-architecture.md)：其 Goal/EventEnvelope/WorkItem 所有权、Router–Worker、外部事件、lease/Watchdog、跨设备控制面和 R1–R7 属延期的整体目标架构评审。本任务仅在现有运行链内统一循环和资源政策，不恢复 B77 或复制其新架构，也不把其整体接受作为前置；等待/恢复的共同术语按实际责任映射，不重复建账。
- B89 继续 deferred，负责新增授权模式、风险、委托、自动采纳与 Smart。本任务负责在已有授权内怎样持续执行，不扩大既有授权的跨轮有效范围；每次续轮重核现授权、目标版本和资源。额外长期委托与自动采纳仍归 B89，不改变 B50 多 Agent/24×7 的延期决定。
- B90 的排版能力可复用本任务已交付的公共运行机制；两任务 CP0 可独立进行，不互等完整 PASS。B91 在候选中优先于 B90；当前 B87 主线不因本次登记自动暂停。
- 以上为规划登记时的边界；CP0 最新具体映射、默认资源政策和契约变更见 §10。不得把方向认可、文档完成、机制验证、真实模型或产品完成混为同一状态。

## 9. 外部参考与恢复入口

本次只读核对 DSH 官方 `deepseek-ai/deepseek-harness`，参考提交 `4b399c39a6d1479cd84ca591b4d7c88e24d38a96`（2026-11-22）。参考其职责分层，不复制其实体、插件体系或所有默认策略：

- [Session 事件：Turn / Step / Attempt / ToolCall](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/docs/subsystems/session.md)。
- [Agent 循环实现](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/agent-loop/src/agent.ts) 与 [输入/steer API](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/core/agent/README.md)。
- [Goal 续轮驱动](https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/packages/goal/goal-round-driver/README.md)：与普通轮内循环区分，不能据此另造本项目 Goal 实体或宣称无限自主执行。

恢复时先读本任务、NEXT、上述原设计和实际 owner，核最新 HEAD/WIP、目标判据及迁移清单。每批实施前封存 scope，按源码变化和缺失证据安排有限验证；次数配置改变需新证据，不回写旧窗口。登记阶段未运行模型、原生场景或生产改造。

## 10. CP0 开工及实证责任核定（2026-11-26）

作者确认「同意 可以开工」，R17 已验成果冻结并推送至 b59c7f662982e29c3203b510c58c4de6a056b791（clean/upstream 0/0），CP0 scope `artifacts/slice-verify/b91-cp0-20261126/scope.json` 在修改前封存。读取 AGENTS、项目画像、NEXT、原愿景/元原则与 UA-01、ADR-0021/0035、VS-00L、B87 §33/35.5、原 B91 CP；依据作者目标而非现实现裁决。原任务 §8 先 R17 签收的调度由 §36 覆盖；不重签旧场景、不重新发送模型输入。Contract/Invariant/Boundary/Consumer/Proof/Driver/Exploration 仍为 §5，新增实际 owner 映射见 UA-01 §6.1。本阶段新增生产实体/表/API=none，CP1 需要字段时先核当前记录/消费能力，不另建 Agent 框架。

### 10.1 实际依赖（不是把所有失败交给 B91）

| 失败/证据 | 已证运行事实 | 责任及不可推定 |
|---|---|---|
| R17 WR01（CP3 mission-01，原360s回合） | 14 POST/14 GET；Writer #12/#17 缺 companion title 正确拒收，#22合法，经过两次 continuation #19/#21，再进入 Reviewer #25；#25 HTTP200 后74.6s downstream_disconnect，无完整SSE；末态目标章PLANNED、0采纳、run bounded running/executing；本次结束前已有派生摘要。 | 现两次 exchange 硬截断及外层继续是确证的多层循环责任，B91统一；360s是外部验收等待，不证明产品额度耗尽/模型失败。真实 Reviewer 终局缺证仍属 R17，改造后有限补证，不预言必成功。 |
| WR01 计数 | 同一隔离 DB（immutable read，SHA f6186c60a37cd3d0ccaec75ddf10e0a0f512c3f4e6b2d5411314beef550cc141）：grant max_provider_calls=13，consumed provider_calls=8、execution_steps=3、steps=7、tool_calls=1；12 条 run-owned ProviderRun（11 completed,1 running），代理14 POST包含2条无工具辅助调用。 | 三种计数时点/归属不同，不能直接算超额或把2条维护全归 run；必须建立派发前统一准入、物理调用 ref 与终态结算、辅助 owner 对账。未证实际用户越权写。 |
| R08 原三轮R3/T1、N4 | 两次接收拒收后未形成合法作者出口或候选；R3/T1另有真实语义/消歧问题，N4选择整章修订的文学判断本身不固定。 | B91 解决合法继续机会与完整反馈，原语义/对象/授权/说明仍由 R08 回验，不预设增加步数会修好歧义。 |
| R08 B33 S4 | 330s内未取得父终局、已有待采纳及派生维护，未授权采纳；清理后 run running。 | 与 WR01 一样先分 observer/runtime 生命周期；不把未闭环直接归模型，不把派生维护当零副作用。 |

来源：`artifacts/slice-verify/b87-r17-cp3-20261125/independent-live-review-01.json`（f66548ea7b1bc804398ee3f3b9b88c0b98b64d3ac4467ceda02c3e1351ee45fc）、其 mission-01 proxy 原始 HTTP/SSE、实际隔离 DB、`artifacts/slice-verify/b87-r08-final-20261125/final-independent-review-01.json`（c964f61b9c10c79b3a24c76b7b8576975f192f9ab85c8d7550dbc05818b855b1）。未重跑任何模型，不更改旧证据。

### 10.2 CP0 责任层及实施门

目标设计唯一落点：UA-01 §6.1（轮/步/尝试、资源准入、继续及终止）、VS-00L §16.7（交换反馈及废除目标两次常量）。保留旧历史文本。以下迁移清单以实查现源码为准：

| 现 owner / 实查入口 | CP1/CP2 必须收敛的事实 |
|---|---|
| `DialoguePlanningService.run_budget/3`、`routed_profile_budget`、`plan_overhead_budget`；`AgentRunBudget.for_plan/expand/authorized_expand` | 现 profile routing 从最大档＋探索 allowance 算预算，路由后 run_patch 又替换预算；for_plan 用 step_cost（正文2）作为额度，恢复公式仍 2×步数。迁唯一入场 grant/成本估算/授权扩额，先冻结各现入口有效 grant 数值与明确 author scope，消除任意局部2限制但不自动升至100硬帽、不以计划缩短/route 覆盖已用。 |
| `AgentRunServer.patch_plan_map/patch_budget/refresh_policy/sync_execution_steps/add_consumed_budget/observed_provider_calls`、selection recovery | 当前 cursor→execution_steps，部分选择归0；当前 max(结果增量,事件唯一ref数) 是下界式补账。累计准入/结算与 cursor 分离；选择 scope、计划修订、goal/steer 与恢复不清零。所有新物理调用派发前核同一额度。 |
| `ExecutionOrchestrator.gate_context_for_run` / `AgentRun.budget_exhausted?` / `AgentRunPolicy` | 当前任一维度0即整体 exhausted；改为按动作实际资源判定，继续逐调用权限/版本/来源 gate，零调用/零工具路径不被无关资源阻塞。policy 中 max_elapsed_ms/max_retries_per_step/no_progress_threshold 当前仅发现 domain 定义/校验，CP1/CP2 复核 schema/消费者后退役无效字段或收归真实政策，不静默启用。 |
| `NativeToolExchange.run/validate_options/retry_or_finish`、`AuthoringOperation.tool_execution_options`，`CreativeProvider.Real`、`ProseQualityEvaluator`、`AgenticPlanDraftPlanner`、`ChapterMissionService`、PendingArtifactWorkflow/ProseRevisionService | 现 native min(2,value)、应用 clamp 0..2 双顶；改用真实派发前同一准入/反馈、同一已许可工具与应用 validator，失败仍闭合，不建立外层重复调用。 |
| `JudgmentProtocol`、`DialoguePlanningService`、`ExplorationPolicy` | @max_attempts=2；普通2/续页8探索次数，路由 allowance 取 max_steps×2。迁同一资源政策及实际读取进展，保留续页资格、作品/范围/refs；不能只解除 Writer 而判断/探索仍早停。 |
| `Provider.Execution/Gateway/HTTP`、`ProviderActivityProjector`、`ProviderRunLog` | Gateway 真实物理 call_ref/run_ref，HTTP retry:false；普通 record_execution 与现维护 admit_operation 并存，统一真实准入与结算边界，现来源核验/事务保留。只在确有安全重发依据时新传输 attempt，未知效果不重做；canonical 不含预算进程/callback，不伪造作者身份。 |
| `FactInventoryService.do_extract` / `AgentRunFlows.FactInventory`、`ChapterSummaryGenerator/Maintenance`、`TranscriptCompactionSummary` / `AgentRunMaintenance` | 盘点固定一次纠错/瞬态重发与减半 fallback，维护另以 reservations 核额度。纳入实际 owner/统一准入，区分语义纠错、传输尝试、材料分批；维护和独立文本调用不得为当前角色伪造 IR run/author。 |
| `TurnInteractionService`、`AgentRunServer` 的 command/steer/stop/plan/候选 backstop、`AgentRunService.close_lost_bounded`、`AgentRunPersistence/AuthoringCheckpoint`、web/frontend 现状态消费者 | 复用原作者原话及 goal.version；同轮进展/续轮事件关联，外部观察不是终局。现候选预算 backstop 会直接构造 goal_satisfied，必须凭真实目标证据裁决，不以资源耗尽冒充完成。保留 bounded lost 条件终态/durable 恢复与授权、迟到取消/回执；映射 UI/Why/Replay，不能把 cursor 冒充累计。 |

### 10.3 已有默认预算基线及本次数值决策

实际执行 `MIX_ENV=test mix run --no-start` 调用现 public `DialoguePlanningService.run_spec_for_profile`，12个既有 profile 各构造 default、结构化 author_max_steps=1/3 三种输入，共36份实际 spec；Provider 回调设为调用即失败，不启动 AgentRun、不访问用户DB、不发模型。成功原件 `artifacts/slice-verify/b91-cp0-20261126/profile-grants-before.json`（SHA256 `200c310bd0cd40fc204e91ee94c816c691bcd47b4774c1e04906463f598297ea`）、同目录 probe log。下表为默认实际入口值（不是历史任务的理想值、不是路由后实耗），其余作者额度 variants 见原件：

| 入场 profile | max_steps | max_tool_calls | max_provider_calls | max_replans | max_pending_artifacts |
|---|---:|---:|---:|---:|---:|
| profile_routing | 28 | 6 | 33 | 1 | 3 |
| character_design_with_context | 5 | 5 | 8 | 1 | 1 |
| prose_drafting_with_quality | 6 | 3 | 11 | 1 | 1 |
| judgment_plan | 7 | 6 | 17 | 1 | 3 |
| plot_outline / character_evolution / world_building（各自同值） | 5 | 3 | 10 | 1 | 1 |
| prose_revision_from_findings | 6 | 3 | 8 | 1 | 3 |
| tool_confirmation | 4 | 1 | 15 | 0 | 3 |
| readonly_batch_context | 4 | 6 | 7 | 1 | 3 |
| ledger_reconciliation | 4 | 4 | 6 | 1 | 1 |
| fact_inventory | 4 | 2 | 7 | 1 | 60 |

现 `routed_profile_budget` 在目标 profile 基础额外加2步/2 Provider，再经 run_patch 覆盖入场额度；实际 WR01 的 8/3/13 与现 `dialogue_planning_service_test.exs` 的正文路由断言一致。**裁决（UA-01 §6.1）**：以已经准入的同一 root grant 为唯一资源边界，普通输入保留既有28/6/33入场 envelope，路由不把累计额度缩为13；direct 各入口仍按本表，不将普通额度移植给独立操作。目标 profile 的授权、作者显式 step scope、pending/backstop/replan 限制不因此扩大。只迁这组已存在有效预算策略到唯一 owner，保持既有绝对硬帽50/50/100，不默认授满；超限由原明确作者预算动作，硬帽不足则停止。数值不是长期最优性证据；首轮重构先以不新增总资源额度及准确消费为判据，后续根据真实成本/作者体验独立校准。CP1 验证迁移保持原入场 grant 与明确作者限制、取消路由覆盖及估算与授予混用；不得保留两套政策运行。

### 10.4 独立判据与下一执行点

首个 CP1 承重链按真实 WorkspaceChat→AgentRun→Judgment/plan/Writer/Reviewer→NativeToolExchange→ProviderRun→ToolResult/validation→UI 路径实施，先用受控序列独立证明：2次不同可修正错误+第3次合法结果，在同授权同操作内3个逻辑步/3次真实派发/1个有效执行单位且只一次有效工具效果；相同失败无新事实则有据停止；传输重发同一逻辑步但新物理 attempt，未知效果不重派；grant仅剩1时第2次派发前拒收；无工具回答不受工具额度0误阻断；路由、重规划、选择、取消/迟到、维护竞争不绕过账本，既有 scope/版本/采纳不退化。明确每一轮的开始/结束、回执、累计资源和真实副作用，三 wire 保持；在所有消费者迁移后删除失效局部入口/测试而非留双轨。CP2 补真实生命周期与 durable/bounded 反例；CP3 用已有原生 driver 与真实模型有界取证，区分确定性机制与真实语义。不能用扩大轮数或新默认次数刷 WR01。

CP0 的设计、实际入场数值基线、已有消费者和证据归属已落原契约；**下一执行点 CP1，先封存原生反例和实际准入失败序列，随后按同一 owner 纵切**。运行时代码、原生/实模验证尚未发生，B91 仍 doing；CP0 文档门禁及提交只签本阶段设计，不代签任何产品功能。若 CP1 核出额外未覆盖的当前消费者，补同一迁移清单和契约证据，不建新模块或为历史兼容并行。具体依赖解除且不退化后按 B87 §36 回 R17 缺项，不自动要求 B91 无关后果先全部通过。

## 11. CP1 实施 checkpoint（2026-11-26）

基线 65183bcc331348211efd1665bbb48d479b66dac1；修改前 scope `artifacts/slice-verify/b91-cp1-20261126/scope.json`。承接 §10.4 七问和原生/实模门槛，不降低完整 CP1–CP3 DoD。**CP1a 入场 grant 与计划/路由分权**：先撤销路由覆盖根额度及计划自动扩额这两个实际 owner；`AgentRunBudget` 唯一入场数值源，明确作者步数限制与 profile 的候选/replan 界限仍收紧。`DialoguePlanningService` 只发 profile 选择和计划，Server 以当前 run 的预算核 profile 限制而不是写回旧 snapshot 整份预算。计划不具有授予资源的权力；无生产消费者的旧 for_plan/expand 自动授予公式及专属测试退役，显式 author recovery 原入口暂保留（累计执行单位与明确授权扩额归 CP1/CP2 后续同一闭环，不宣称已迁移）。补查确认真实 AuthorActionConfirmation→ToolConfirmationRun.run_attrs 的入场额度为14调用，与 CP0 `run_spec_for_profile(:tool_confirmation)` 的15不同（后者多1来自旧计划开销公式）；两种已有实际入口分别明确入场身份并由同一 owner 持有，不让14变15或反向改变原规格基线。生产代码无新模块/表。初次独立反例在旧源码 21 tests / 5 failures，`root-grant-red.log`，36入场规格断言成立；路由后的根额度/author cap 反例失败，说明不是初始 grant 问题。后续需核 plan patch 不增 grant、真实原生作用边界。CP1b 接现 Execution.with_admission/ProviderRunLog/Server 的真实派发占用与结算，CP1c 同一准入下迁交换、判断、探索的多步反馈。不得先放开局部2而让实际派发无限制；CP1a 不代签调用预算、轮步或 R17 终局。

CP1a 已迁入场策略、真实确认入口（14）与显式构造（15）、路由限制、删除 plan 自动扩额及旧字面预算死分支；`run_patch` 只携带 profile 身份，由 Server 对当前 grant 收紧候选/replan，不再接受整份预算替换；AuthorActionConfirmation 不改变原 grant。专项90/90、全量 mix check 3867/3867、ADR33/33、I-CACHE 通过；随后仅新增 actual Server 七步计划不能自行扩额的独立测试（1/1），生产源码未再变。模块规模、diff-check 通过。冻结单次原生 `b71-authoring-profiles`（原角色创作/Why 单作者输入、原 seed、slice_verify、原驱动预算），验收原场景原判据及独审实际 run grant=28/6/33、profile pending=1、未采纳无权威写，保留实际消耗与原证据。仅为本 checkpoint 的实际消费者证明，不代签 R17/R08、B91 整体或多步反馈。原生执行 `root-native-01` 与后续绑定只认实际结果。

`root-native-01` driver0/runner1、无通过 summary/binding；唯一失败 `pending_character_remains_tentative`。实际 WS 同一 run 先 :agent:3 角色读取（无候选），后 :agent:4 两条 character_seed 均 TENTATIVE；实际 native driver 已按 last 选择 :agent:4，旧 CHARACTER_SPEC 却 first。隔离 DB 确认 run completed、grant 28/6/33、pending上限1（一次候选集）、consumed2 Provider/2 tools/2 execution units，原前后 production counts 完全相同、author_action_receipts=0。不是证实的越权采纳，亦不能直接代签原 runner。只修现验收器与真实驱动末次结果选择对齐，并增加 run/parent/turn 一致性断言；保留全部旧判据和失败原件。现 authoring_run_evidence 的首末、foreign run、真实终态负例继续验证。确定性同场景前向复验一次 root-native-02，不刷实模，不改变生产源码。

CP1a 限定机制验收通过：root-native-02 原生 16/16、driver/runner/binding 均 0；独审 11 条同一 run 状态消息均保持 grant 28/6/33，角色候选上限 1，真实 2 次 Provider、2 次工具、2 个执行单位，2 条 TENTATIVE 候选，author_action_receipts=0，权威数据计数一致。验收器 Node 回归 136/136；独立证据 `artifacts/slice-verify/b91-cp1-20261126/root-grant-independent-review.json`（SHA256 `9e7f7ff832620c6858a33f1f481b076017a762e4e1b677872a9f719fce634482`）。统一工程门禁通过（manifest `artifacts/slice-verify/task-completion-20261125T175920Z-7477/manifest.json`，source fingerprint `97b51a75885e9c4ebe242d6b38bdaeb7390285cf0f67554fb9056e30f755efcf`）；静态扫描 20 项通过、1 项失败（Gitleaks），7 条已登记发现、改动文件命中 0，6 条误报、1 条历史接受风险，保留检测规则及既有处置，不重写历史。该 checkpoint 未调用实模，CP1b 派发准入与事实结算、CP1c 多步反馈及 CP2 轮步/生命周期均未闭环。下一执行点 CP1b；完整 B91、R17、R08 不代签。
