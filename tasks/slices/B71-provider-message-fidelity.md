# B71：AI Novel Studio 原生多轮创作请求体

- **当前执行入口（2026-11-08 审核轮收口后）**：本轮完成三项只读审计（契约/架构/测试资产，报告 `artifacts/b71-audit-20261108/`）与 P0+P1 clean 度收口：修复 `SSEStream.Result` 重复 `materialize/1` 导致的干净编译门禁红与增量编译假绿（`mix check` 首步改 `--force`）；修复 11 项 P1（standalone 有限模式误记、Chat 流式 usage 声明、Provider 唯一 `execute/5` 执行入口、无消费者 API、私有历史 v2/legacy 退役、error3/flow state 形状收敛、前端测试替身/作者可见名退役、R2 verifier 真实判据、system 规则测试、重编号重算回归等）；按作者要求新增 `scripts/lib/test_env.sh` 统一测试/验收入口前置。**确定性页面批次** `b71-first-consumer-tauri-native-audit-1108` 19/19 PASS（HEAD `eca29943`）；**实模批次** `b71-first-consumer-live-cp4b2-iq3s-01`（iq3_s，预注册 `scenario-preregistration-iq3-s-20261108.json`）required_mechanism **8/8**（含 usage_collected：真实 input/output tokens 与 cached_tokens/ttft 回收），真实多轮 request_message_counts 4/7/10/13/16/19/22、tentative 候选 1、canon 零写、单槽卸载核验通过。**仍未闭环**：G2/G3/G5/G6 未触发、Responses/Anthropic 实模凭证、I10 文学质量与 CP5 最终收口（不代签）。

- 状态：**doing**。R1 请求边界、R2 流式机制、确定性原生页面与 Strata 实模协议已有分层证据。G6 的会话压缩、后续报文、重启和失败恢复证据由 [B81 §12](B81-session-canonical-authoring-history.md#12-2026-11-11-完成度复核) 承接。G2/G3 已复核既有实模报文，G5 已有确定性真实页面证据，正式补证及 Responses/Anthropic 实模见 [B82](B82-b71-golden-slice-evidence.md)。实模正文预览与 CP5 最终收口仍开放，I10 归原验收任务。当前证据边界见[文末复核](#2026-11-11-b81-交付后的完成度复核)。
- 来源：作者先要求对照 Codex、Claude Code、dsh 的真实多轮请求，随后明确“设计一个优秀、符合项目调性的请求体，不为现状妥协”。本文件已据此替换此前偏向现役最小修补的方案。
- 设计真源：[Provider 抽象 §26](../../docs/design/foundation/08-provider-abstraction.md#26-ai-novel-studio-原生多轮创作请求体2026-10-30-目标设计2026-10-31-作者选-a方向-accepted)；目标方向与迁移规则已由 [ADR-0033](../../docs/design/adr/ADR-0033-authoring-run-transcript-request-ir-v3.md) Accepted（2026-10-31）；替换契约 [VS-00L](../../docs/design/contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md) 已 Frozen，首个判断消费者已完成 canonical 原生多轮接线，其余消费者与完整迁移归 CP4。
- 对账输入：[B26](B26-single-call-judgment-protocol.md)、[B39](B39-evidence-seeking-authoring.md)、[ADR-0030](../../docs/design/adr/ADR-0030-evidence-seeking-authoring-v3.md)、[ADR-0031](../../docs/design/adr/ADR-0031-core-chain-semantics-narrowing-v3.md)、[VS-00I](../../docs/design/contracts/VS-00I-prompt-prefix-stability-contract-pack.md)、[UA-01](../../docs/design/contracts/UA-01-unified-agent-run-loop-contract-pack.md)。它们是迁移事实与可能需要修订的决策，不是降低目标设计的约束。

## 1. 重新对照后的核心问题

当前请求把角色规则、作品状态、会话摘要、能力目录和作者输入压进一个大型 `user` 文档，`normalize_messages/1` 又只保留 `role + string content`。这能支撑单次结构化调用，却不能优秀地表达项目已经定义的 AgentRun、求证观察、工具结果、tentative artifact、作者裁决和恢复回放。

目标不是给现有请求补几个字段，而是：

> **统一 AgentRun 本身成为原生多轮创作会话；每次 Provider HTTP body 都是该 run 的无损、可重建投影。**

这不是 writer 内第二控制环。模型提出工具动作，Orchestrator 仍掌握执行裁决；观察、预算、权限、作者活动流和 trace 仍只有一套。Provider 私有 response id 或推理句柄不成为运行事实源。

## 2. 目标方案

### 2.1 Authoring Run Transcript / Request IR

建立丰富的内部运行 transcript 和请求中间表示，保留：

- 消息来源、角色、顺序与作者/应用/模型 provenance；
- 原生 assistant tool calls 与按 call_id 关联的观察、校验结果；
- Base refs、观察 refs、版本、权威状态、覆盖与省略；
- AgentPlan、tentative artifact、校验失败、作者出口和压缩 checkpoint；
- provider 私有回放句柄与项目 canonical trace 的分离。

不得再以最低公分母字符串消息作为内部上限，也不得让不支持某能力的 provider 反向决定整个项目的协议。

### 2.2 目标消息流

```text
稳定 system（产品宪法 + run 角色/输出协议）
→ application_base（目标、坐标、权限、预算、Base refs，非作者冒充）
→ 必要的真实历史或显式 compaction checkpoint
→ 本轮作者原话（独立 user，字节不变）
→ assistant 叙事 + 只读/计划/创作 tool_call
→ tool 观察或校验结果
→ assistant 继续求证、修订或 tentative artifact
→ tool 校验结果
→ ready / 普通回复 / ask_author / 诚实失败 / 预算停止
```

工具校验失败作为原生失败结果回流，不再以 `user/user` 伪装多轮纠错。长会话只通过带来源和省略范围的显式 checkpoint 压缩，不隐式丢弃。

### 2.3 项目专属工具边界

- 只读求证：作品检索、章/档案读取、记忆召回及授权外部资料。
- 计划：提出/修订 AgentPlan；校验通过不等于执行批准。
- 创作：生成/修订 tentative artifact、质量复核、报告能力缺口。
- 作者出口：`ask_author`、裁决或追加预算时结束机器消息链。
- **不存在**模型可用的 `adopt`、`canon_write` 或自我批准工具。作者动作开启新的授权边界和 run 投影，采纳结果经版本化 Base 进入后续请求。

### 2.4 Provider 投影

分别形成 Chat Completions、Anthropic Messages、Responses API 的无损投影矩阵。完整 AgentRun 的必备能力为原生多轮、工具调用/结果、流式解析、结构化输出和用量回收；不支持时只能显式有限模式或拒绝路由，不能静默丢字段仍宣称完整运行。

缓存、推理句柄和 `previous_response_id` 只能优化请求，不得取代项目 trace/replay，也不得改变证据顺序、作者字节或采纳边界。

## 3. 非目标

- 不保留 giant prompt、连续 `user` 纠错或最低 provider 能力作为目标形态。
- 不复制代码 Agent 的 shell/canon 语义，不追求工具数量。
- 不建立与统一 AgentRun 平行的 writer 私有循环或第二套预算/权限/恢复。
- 不把 CoT/thinking 展示给作者，不把服务端历史当作 replay 唯一来源。
- 不全量回送作品档案，不用新增固定 packet 回避模型求证。
- 不在 CP1 未处理 ADR 冲突前静默改代码；现役 B26/B39 决策如需调整必须正式修订或 supersede。

## 4. 开工七问

1. **Contract**：CP1 新冻结 Authoring Run Transcript、Request IR、消息/工具/观察/校验/候选/checkpoint 语义及 provider 投影矩阵；消费并明确修订受影响的 UA-01、VS-00I、ADR-0030/0031，而不是暗中保留两套协议。
2. **Invariant**：AgentRun 是唯一运行事实源；作者与 artifact 字节因果、只读求证、tentative-first、逐步 Orchestrator gate、真实预算、I1/I2/I3、N-NARR、replay 不调模型全部成立。
3. **Boundary**：目标切穿 `novel_agent` 的 Request IR/provider adapters、`novel_application` 的 AgentRun/transcript/工具编排、`novel_domain` 的纯契约校验，以及必要的持久 trace/replay；web/frontend 只消费真实 run 事件与作者动作，不另建旁路。不得让 novel_web 直接访问 Repo 或 novel_agent 引用业务领域。
4. **Consumer**：首个消费者是需要先读取作品事实再生成 tentative 候选的真实创作 AgentRun；后续消费者为规划、修订、质量复核、纠错、恢复和 Why/Replay。
5. **Proof**：六类黄金请求（首轮/观察后/校验失败后/候选后/作者边界后/压缩后）、provider 投影矩阵、真实请求引用与版本对账、完整场景和 I1/I2/I3。必须证明观察进入下一真实请求且 used refs 未越界，不能仅证明 JSON 结构相似。
6. **Acceptance Driver**：CP1 在 quality manifest 预注册后，由外部自动化驱动当前 Tauri WorkspaceChat，完成自然创作→自主求证→观察回流→tentative 候选→作者采纳/拒绝→恢复的完整场景，保存页面、网络、日志与持久化证据。产品新增验收感知逻辑：**no**。
7. **Exploration**：这是核心主链。Base 只含不可猜测信息；模型通过同一只读目录按需求证，观察携 refs/版本/覆盖进入后续请求；新作品维度不得靠专用 packet 或隐藏工具分支获得例外。

## 5. Checkpoint 与完整闭环

| CP | 范围与完成标准 | 状态 |
|---|---|---|
| CP0 | 对三款外部真实多轮请求与本项目真实日志做目标对照；明确 AgentRun 原生会话、作者主权、求证和 replay 的目标方向；登记任务与设计 | **done（2026-10-30，仅文档）**：已替换此前现役最小修补方案；未修改产品代码 |
| CP1 | 冻结目标 contract pack、Request IR、消息/工具/观察/校验/候选/checkpoint 语义、provider 投影与能力门槛、六类黄金请求和场景预注册；完成 ADR/现役协议差异及迁移裁决 | **done（2026-10-31，见 §7 交付记录）**：VS-00L Frozen + 逐条迁移映射 + G1–G6 + 场景预注册；已复核通过，旧 ADR-0030/0031 已转 Superseded |
| CP2 | 实现 canonical transcript/Request IR 与三类 provider 投影；建立真实只读观察和原生校验结果回流，黄金与 adapter 测试通过 | **机制完成、不单独标 done（2026-10-31）：IR v1 + 三类投影 + G1–G6 golden + OpenAI 兼容/Anthropic adapter 桥 + application 层 transcript 观察/校验回流机制已完成；生产接线与真实观察回流作为残差并入 CP3a** |
| CP3a | 确定性接线（2026-10-31 从 CP3 拆出）：以统一 AgentRun 接通首个创作消费者并完成生产接线（IR 消费替换 call-site legacy prompt、观察/校验按 call_id 回流、预算/权限/trace/持久化/恢复），承接 CP2 残差；以确定性 provider 在真实页面驱动证明接线闭环，不签实模语义 | **done（2026-11-01，见 CP3c 实施记录）**：生产接线、浏览器及原生确定性页面证据完成，不签实模语义 |
| CP3b | 实模窗口验收：真实 Tauri + 实际模型请求/响应、G1–G6 与作者边界证据；CP3a 不能替代实模 | **doing**。已有 Strata 实模协议、G6 会话压缩和 G2/G3 原生报文事实。正式 G2/G3/G5 补证、实模正文预览及另外两类 wire 的实模仍待验证，见文末复核。 |
| CP3c | 方案修订与稳定/恢复 checkpoint（2026-11-01）：先修订 ADR/VS-00L，再实现稳定层与动态 scope 分层更新、可恢复 canonical transcript；新增 G7 动态 scope 后与 G8 恢复后，不把整段 Base 刷新当终态 | **done（2026-11-01）**：canonical 整体重构、G7/G8、数据库离线恢复、原生 14/14 与门禁完成；不代表 CP3b/CP4/CP5 完成 |
| CP4a | 统一创作/质量 canonical 主链：判断 → 原生创作调用 → 质量复核 → tentative artifact → 续行；迁移 creative/quality provider 与 TurnExecutionService，不形成第二控制环 | **done（2026-11-01）**：原生调用、阶段工具、应用结果闭合、durable checkpoint 与真实 Tauri 14/14 完成；不代表 CP3b/CP4b/CP5 完成 |
| CP4b | 覆盖其它规划 profile、显式压缩恢复与旧协议退役；完成真实 Tauri 全链、真实模型行为、缓存/usage、replay/Why 和全部门禁 | **doing（2026-11-01，方案见末节）**：CP4b-1 统一机制与确定性页面；CP4b-2 实模行为、缓存/usage 与剩余证据。**R1 请求边界/原生输入迁移已按 VS-00L §19.1 实现并通过确定性门禁（详见末节 R1 收口记录）**：删除 `to_provider_prompt/2`、构造/执行双身份比对、Chat 中间层与生产 Stub 注册，初始快照按 §19.2 构造；**R2 统一流式生命周期与 Responses SSE 已于 2026-11-07 完成确定性机制层并提交**（`119b7c35` 等），CP4b-2 实模行为/缓存/usage 与真实页面证据仍待批次。CP4 仅在 CP4a+CP4b 均完成后才算 done |
| CP5 | 更新 ADR/contract/设计/索引/事实台账和恢复指引；逐项证明完整范围，不能以 adapter/golden 局部证据标 done | **doing**：历史批次已整理；2026-11-07 R2 收口后完成一次无窗口收口复核（全量门禁、静态扫描、文档/索引/状态表/ledger 对齐，见末节）；真实模型/页面证据仍待批次，不标 done |

## 6. 验证与恢复指引

- CP1 只运行文档、索引、链接、NEXT/ADR 和差距检查，不声称产品验证。
- CP2 起执行后端完整门禁、I3/I1/I2、架构与统一静态扫描；触及前端时执行完整前端门禁和 Tauri 构建。
- 验收必须分别报告外部真实页面、后端/adapter 局部证据、真实模型行为和未闭环缺口；文学质量仍归 I10，不由协议通过代签。
- 缓存比较按同调用点真实请求和 cached_tokens/TTFT，不把历史命中数当固定阈值，也不为缓存牺牲目标消息语义。
- 外部脱敏样本位于 `artifacts/client-http-bodies/`；项目对照证据位于 `log/llm-calls/stage/2026-10-29.jsonl` 第 8–9 行。它们只证明协议差距，不是目标实现。
- 恢复时先读 Provider §26、本任务及 CP1 产生的目标 contract pack，再核对 ADR-0030/0031、UA-01 和 VS-00I 的处置；不得从上一版保守分析推断单调用或 giant prompt 仍是目标。
- **2026-11-07 恢复入口（R2 后，最新）**：R2 提交链 `119b7c35`（统一流式生命周期 + Responses SSE）、`c89d5f54`（I-CACHE 三投影）、`09d1c8bc`（文档/索引）、`833cf490`（I-CACHE 入 mix check + 门禁脚本截断修复）、`55fde7db`（流式正文预览机制补齐）。本地完整门禁用 `mix check`（现含 I-CACHE）；静态扫描用 `bash scripts/ai_static_scan.sh --top 10`。下一步：按本文档末节「B71 收口剩余执行条件」以 `q2_0` 重新冻结预注册跑 CP4b-2/G6；未获窗口不启动实模批次。
- **2026-11-03 恢复入口**：已提交并 push 的关键提交——`c3a1ce64` 能力事实源/流式/Responses；`cd52359f` 压缩+确认交接+旧同步支路退役；`7ab80d4f` web 消费者；`dde97619`/`954cf79f` 原生读侧与批次记录；`78739d01` CP5 契约/索引/台账；`74fe6b63` pending-08 最终源码 PASS；`e79032cd` CP3b 实模协议层 PASS；`f0f07956`/`75b4ec2e` B70 行为覆盖接入与 HO4 修复；`94efb842` 行为覆盖 pilot 记录。剩余工作的直接入口：① §16.14 确认页面——设计稿 `artifacts/b71-resume/confirmation-native-scenario-plan.md`，实现后等屏幕解锁由 Lead 逐批签发；② 作者行为覆盖——预注册 `behavior-pilot-preregistration-01*.json`（01 判据误报作废、01b 锁屏环境失败），屏幕可用后签发 01c + `C-F3-002`；③ 压缩前端——需作者批准 UI 设计增补（UI 46 §9.7 冻结槽位/Pencil 无帧/UI 47 无文案），未授权前不实现；④ CP4b-2 实模行为/缓存/usage——在 CP3b 协议层证据基础上按预注册单列；⑤ CP5 最终收口——随剩余项完成更新 §17/ADR/台账并复跑全量扫描。

### CP1 裁决与迁移记录（2026-10-31，作者选 A）

- 作者明确选择 **A**：按 B71 目标协议正式修订/supersede 现役协议，接受统一 AgentRun 原生多轮、tool_call/observation 回流与显式 compaction，不采用仅限现役 additive 的目标缩减，也不再延期。
- [ADR-0033](../../docs/design/adr/ADR-0033-authoring-run-transcript-request-ir-v3.md) 已 Accepted 目标方向与迁移规则；ADR-0030 的最小 Base/证据闭环与 ADR-0031 的统一裁决/作者主权/真实来源等兼容原则必须逐项承接。
- **旧 ADR 状态边界**：ADR-0030/0031 在 CP1 替换 contract pack 和逐条迁移映射复核前仍为现役基线；复核通过后才转 Superseded。当前不是协议真空，也不是长期双轨。
- CP1 可交付：Request IR、消息/工具/观察/校验/候选/checkpoint 语义、三类 provider 投影与能力门槛、六类黄金请求、场景预注册，以及 B39/B01/B43/B45、UA-01、VS-00I 的逐条迁移映射。
- 仍未授权或完成：产品 schema/provider/application 实现、旧协议实际退役、真实页面与真实模型证据。CP1 只做契约与迁移文档，完成后另行复核。

### CP1 交付记录（2026-10-31）

- **替换契约**：[VS-00L Authoring Run Transcript / Request IR Contract Pack](../../docs/design/contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md) Frozen——术语/不变量 I-ART-1..12、Transcript 消息类型（system/application_base/user/assistant/tool/checkpoint/author_exit）、tool call 与 observation/validation 的 call_id 绑定、Base/Observation/used refs 证据绑定、Request IR v1 结构与版本策略、消息/工具/观察/校验/候选/作者出口/checkpoint 语义规则、三类 provider 投影（Chat Completions / Anthropic Messages / Responses API）与能力门槛/显式有限模式/拒绝路由、缓存与 VS-00I 前缀稳定性承接、六类黄金请求 G1–G6 定义、验收分层与 enforcement_gaps。
- **逐条迁移映射**（VS-00L §8）：ADR-0030/0031 原则保留、旧实现形态退役/转换；UA-01 单调用共享入口转 run 内多轮（工具/终态语义保留）；VS-00I 重锚到每个投影的稳定前缀；VS-00K/VS-00H/VS-02/02A/04/06 保留并入 IR；B26 工具/终态保留、调用载体转换；B39 重锚至 B71 CP3 首个消费者；B01 来源列转 IR provenance（旧列迁移归 B01）；B43 统一裁决 producer 保留、输入 frame 从 IR 派生；B45 IR v1 版本策略承接；B27/B33 纠错改为 tool result 回流；giant prompt 组装与 `normalize_messages/1` 退役/转换。
- **场景与证据预注册**：`artifacts/model-contracts/b71-cp1/scenario-preregistration.json`——首个创作 AgentRun 场景、六类黄金请求真实 run 复跑、Strata/iq3_s 单槽串行与卸载核验、input120s/turn360s 等预算、2 批上限、机制/页面/模型行为分层。CP1 不执行真实 run。
- **索引同步**：`docs/design/contracts/README.md` 登记 VS-00L；ADR 索引/design README 已由作者 WIP 更新。
- **复核结论（2026-10-31，作者确认 A）**：CP1 六项交付（transcript/IR 与版本策略、消息/工具/观察/校验/候选/出口/checkpoint 语义、Base/Observation/used refs 绑定、三类投影与能力门槛、G1–G6、场景预注册 + 逐条迁移映射）全部覆盖；契约包内部链接有效。
- **旧 ADR 已转 Superseded**：ADR-0030/0031 状态行、design README、adr README 索引、00c、VS-00K/UA-01/VS-00I 迁移注记、contracts README 与 B39 重锚已同步；实现迁移仍归 CP2–CP4，旧证据只读保留。
- 本 CP 未修改产品 schema/provider/application，不声称 Request IR 已实现。

### CP2 实现记录（2026-10-31，部分完成）

- **IR v1**：`apps/novel_agent/lib/novel_agent/provider/request_ir.ex`——`RequestIR` struct（run/system/messages/tools/projection/refs/provider_session）、消息/块构造 helper、`validate/1` 数据边界校验（I-ART-4/5/6/7/9 可机械检查项：envelope、role/provenance、作者文本非空、call_id 唯一与关联、禁止 adopt/canon_write 工具、checkpoint covers/omissions、used_refs ⊆ base∪观察）与 `from_legacy/2` 迁移适配器（显式 `finite_mode: legacy_prompt`）。
- **三类投影**：`RequestIR.Projection`（统一入口 + 能力门槛：完整能力 → `{:ok, body}`；缺能力无声明 → `{:error, {:unsupported_capability, missing}}`；有 `finite_mode` → `{:finite_mode, body, meta}`）与 `ChatCompletions` / `AnthropicMessages` / `ResponsesAPI` 三个投影模块（author 字节独立、application_base/checkpoint provenance 标记、assistant tool_calls↔tool result call_id 关联、checkpoint 覆盖范围/省略显式、system/tools 稳定前缀）。
- **黄金请求 G1–G6**：`apps/novel_agent/test/novel_agent/provider/request_ir_test.exs` 16 tests（含 3 投影关键结构、能力门槛/有限模式、legacy、校验负例）；与本任务既有 provider 测试合计 31/31 通过。
- **未闭环（不代签）**：现有生产 adapter 仍消费 legacy prompt（`normalize_messages/1`），尚未消费 IR；真实只读观察与工具校验结果回流仍在旧执行链，CP2 要求的“adapter 接线/真实观察回流”未完成——归 CP2 收尾或 CP3 首个消费者一并接线；I-CACHE 重锚与 golden fixture 文件化待做。

### CP2 收尾进展（2026-10-31 续，adapter 桥）

- **消息规范化保真（I-ART-8）**：`NovelAgent.Provider.normalize_messages/1` 现在保留 `tool_calls` / `tool_call_id` / `name` / `reasoning_content`，非 binary content 原样透传；不再把原生工具字段降级为 `role + string content`。legacy prompt 行为不变（现有调用方无回归）。
- **adapter 桥**：`RequestIR.to_provider_prompt/2` 把 IR v1 投影为 provider-neutral structured prompt（messages 为 OpenAI wire 形状：system/application_base/user/assistant.tool_calls/tool；tools 保持 `Provider.tool_spec` 形状；带 `ir_version` 标记）。OpenAI-compatible / DeepSeek / LM Studio / Strata 等现有 adapter 可直接消费，无需重写请求体逻辑。
- **同源证据**：`normalize_messages(桥 prompt) == ChatCompletions.project(ir).messages`、`put_openai_tools(%{}, 桥 prompt).tools == ChatCompletions.project(ir).tools`（测试断言）；provider 目录 **249/249** 通过，全量 `mix test` 0 failures，credo 0、xref 无环、arch_check 通过。
- **未闭环（诚实登记）**：Anthropic adapter 主链仍走 legacy content 字符串结构（IR 的 Anthropic content-blocks 投影模块已就绪，adapter 尚未接 IR 多轮）；真实只读观察/工具校验结果回流（AgentRun/工具执行链）未接 IR；I-CACHE 重锚与 G1–G6 fixture 文件化留待 CP3 首个消费者一起做。CP2 仍不得标 done。

### CP2 收尾进展 2（2026-10-31，Anthropic adapter 接线）

- `NovelAgent.Provider.Anthropic` 对 IR v1 桥（`%{ir_version: ...}` prompt）新增 content-blocks 投影：assistant `tool_calls` → `tool_use`（id=call_id，arguments 解码为 input）、observation/validation → `tool_result`（tool_use_id 关联）、system 提出为稳定前缀（长 system 仍走 cache_control 规则）、相邻同 role 合并满足 Messages API 交替约束；legacy prompt 路径不变。
- 测试：`anthropic_test.exs` 新增 IR 桥 2 条（tool_use/tool_result/交替/system + legacy 不进入桥），14/14 通过。
- **仍未闭环（诚实登记）**：
  - 真实只读观察与工具校验结果回流（AgentRun/工具执行链 → transcript → 下一请求）未接 IR——这是 CP2 最后一项，也是 CP3 首个消费者的核心，需按 CP3 真实 Tauri 场景验收，不能以 adapter/单测代签；
  - I-CACHE 重锚（VS-00I I-CACHE-1 在 IR 投影上的测量）与 G1–G6 fixture 接真实 run 切片待 CP3；
  - 三类投影的纯函数与 adapter 桥均已有单测，但“完整 AgentRun 原生多轮”尚无真实 run 证据，不得宣称 CP2 done。

### CP2 收尾进展 3（2026-10-31，application 层 transcript 回流机制）

- 新增 `NovelApplication.AuthoringTranscript`：application 层按 VS-00L §3–§5 组装 transcript——`new/2`（application_base + 本轮作者原话，作者字节独立）、`append_assistant/3`（叙事 + 原生 tool_call）、`append_observation/3`（按 call_id 关联真实观察，status/refs/版本/覆盖/省略如实）、`append_validation/5`（校验失败作为 tool 原生结果回流，不追加 user 纠错）、`append_author_exit/3`、`append_checkpoint/6`（显式压缩）、`declare_used_refs/2`、`to_request_ir/2`（产出 RequestIR 并走 `validate/1`）。
- 边界：本模块不发起 provider 调用、不执行工具、不写库；生产主链接线归 CP3。
- 测试：`authoring_transcript_test.exs` 6 条——两轮观察回流按 call_id 进入下一请求、used_refs 越界拒绝（I-ART-9）、校验失败原生回流（I-ART-5）、application_base provenance（I-ART-3）、观察 status 如实（I-ART-4）、checkpoint/author_exit 无伪作者消息（I-ART-7）。
- **仍未闭环**：真实 run 的观察回流（真实探索服务/工具执行 → transcript → 下一 provider 请求）与页面/模型证据是 CP3 首个消费者范围；I-CACHE 重锚、G1–G6 fixture 接真实 run 待 CP3。CP2 不标 done。

### CP3a 确定性接线（2026-10-31）

- 状态：todo
- 来源与关系：2026-10-31 排期再平衡时从 CP3 拆出，作为 CP3 的执行 checkpoint；**不缩小 CP3 范围**，CP3 done 仍须 CP3a + CP3b 全部完成。
- 范围：以统一 AgentRun 接通首个创作消费者并完成生产接线——AgentRun/执行编排 → `AuthoringTranscript` → `RequestIR` → provider adapter 消费（替换 call-site 的 legacy prompt 组装）；真实只读观察与工具校验结果按 call_id 回流进下一请求；预算、权限、trace、持久化与恢复按既有契约接入。承接 CP2 残差：真实观察/校验回流生产接线、I-CACHE 重锚在 IR 投影上的测量、G1–G6 fixture 文件化。不形成第二控制环。
- 证据层：确定性 provider（`slice_verify`）在真实页面/原生窗口驱动，产出接线与状态证据；**不签真实模型语义**（归 CP3b 与 B42）。
- 边界：如接线需要新 schema/迁移或数据写入授权，先登记为子阻塞并回退作者授权，不自行扩权；不得用适配器或单测代替页面证据。
- Proof：外部自动化驱动当前真实入口（`bash scripts/tauri_slice_verify.sh <b71 场景>` 或等价原生驱动）；观察 call_id 绑定进入下一请求、used_refs 不越界、候选保持 tentative、采纳前零写入、replay 不调模型。
- 恢复入口：先让生产调用点消费 IR（`RequestIR.to_provider_prompt/2` 已有桥），再接 `AuthoringTranscript` 观察回流，最后补 trace/恢复与门禁。

### CP3b 实模窗口验收（2026-10-31）

- 状态：blocked
- 阻塞原因：真实 Tauri 原生窗口 + 真实模型单槽资源窗口与预算尚未授权（资源型等待，非决策阻塞，无待裁决选项）；场景预注册 `artifacts/model-contracts/b71-cp1/scenario-preregistration.json` 已就绪。
- 受影响 checkpoint：CP3 完成；B39 求证式创作的目标实现（重锚至 CP3/CP4）依赖本项；CP4 真实 Tauri 全链以其为前提。
- 解除条件：① CP3a 接线完成并能产生对应 run 切片；② 作者/指定运行者批准模型资源窗口与生成预算（单槽 Strata `iq3_s`，批次 ≤2，场景 900s，input 120s/turn 360s 等）；③ 场景在 quality manifest 登记，driver、证据目录与卸载核验就绪。
- 证据层：真实 Tauri 原生窗口 + 真实模型，按预注册复跑首个创作 AgentRun 全场景与 G1–G6 真实 run；证据面 `surface=tauri-native`，含 AX 截图/文本、wire 帧、app-log、llm-calls 请求字节、隔离 DB 前后快照、wait-stats/heartbeat。
- 未授权事项：未获窗口前不启动实模批次、不伪造 PASS、不以 CP1 预注册或 CP2 机制证据代签。

#### CP3a CP0 冻结记录（2026-10-31）

**生产调用点现状（盘点）**

- 首个创作消费者的 provider 请求由 `DialoguePlanningService.judgment_protocol_input/4`（`apps/novel_application/lib/novel_application/dialogue_planning_service.ex:1198`）组装 protocol_input（author_text/context_block/supplied refs/options），再由 `JudgmentProtocol.prompt/2`（`judgment_protocol.ex:328`）构造 **单条 user 大文档**：`%{messages: [%{role: "user", content: content(input, profile)}], tools: JudgmentToolContract.tools(profile), tool_choice: "auto"}`。
- 纠错重试在 `JudgmentProtocol` 内以 `%{prompt | messages: prompt.messages ++ [correction]}` 追加（290/304 行）；provider 适配层统一走 `NovelAgent.Provider.normalize_messages/1`（CP2 已保真 tool 字段）。
- 观察/工具结果目前**不在同一 provider 会话内回流**：execute 后由 `PendingArtifactWorkflow`/provider 工具链另行执行，下一轮判断重新组装 protocol_input（B27 §9 已修材料同源声明，但非原生多轮 tool 回流）。

**目标数据流（CP3a）**

`AgentRun/execution orchestration → NovelApplication.AuthoringTranscript（application_base + 作者原话 + 证据）→ RequestIR v1（tools/projection/refs）→ RequestIR.to_provider_prompt/2 → 现有 provider adapter`；观察/校验结果经 `append_observation/append_validation` 以 `call_id` 绑定进入下一真实请求；预算/权限/trace/持久化/恢复沿用既有 AgentRun 边界（不形成第二控制环）。

**分步（每步独立可验，不缩小 CP3 范围）**

| 步 | 内容 | 证据 |
|---|---|---|
| S1 | 让 `JudgmentProtocol.prompt/2` 的生产 call-site 消费 IR 桥：protocol_input → AuthoringTranscript → RequestIR → to_provider_prompt；先保持语义等价（协议约束/context_block 进入 application_base、作者原话独立 user、tools 不变） | 单测（prompt 结构/字节保真/tools 等价）+ 现有 judgment 测试回归 |
| S2 | 观察/校验回流：为判断 run 提供原生工具结果回流路径（复用 AuthoringTranscript.append_observation/append_validation + call_id），下一请求含观察 | 单测 + 确定性 fixture（真实探索服务观察进入下一请求） |
| S3 | 预算/权限/trace/持久化/恢复接线核对：复用既有 AgentRun 边界，不新增控制环 | 既有测试 + trace 断言 |
| S4 | 真实页面确定性场景：`tauri_slice_verify` 新增/登记 `b71-first-consumer`，`slice_verify` 确定性 provider 驱动，断言观察 call_id 进入下一请求、used_refs 不越界、候选 tentative、采纳前零写入、replay 不调模型 | 真实 Tauri 页面证据（surface=browser 如实，native 归 CP3b 判定）+ verdict |
| S5 | CP2 残差补齐：I-CACHE 在 IR 投影上的测量、G1–G6 fixture 文件化（接真实 run 切片） | 测量记录 + fixture 文件 |

**风险与兼容（CP0 已识别）**

- 单 user 大文档改为多消息/IR 后，`slice_verify` test-support provider 与既有字节断言可能依赖单条 user 消息；S1 需同步核对并对齐测试 provider（不改变产品语义）。
- `JudgmentProtocol` 纠错追加（`messages ++ [correction]`）需在 IR 消息序列下保持顺序与来源；不得变成伪 user 纠错（I-ART-5）。
- 作者原话独立消息后，B27 §9 的 `context_block`/supplied refs 同源断言需确认仍成立（内容不变，位置变化）。
- Anthropic adapter 走 IR 桥时已具备 content-blocks 投影（CP2）；OpenAI 系 adapter 已保真工具字段。
- 若 S2 需要新 schema/迁移或数据写入授权：登记子阻塞并回退作者，不自行扩权。

**验收与边界**

- 证据层：确定性 provider + 真实页面/原生窗口驱动；**不签真实模型语义**（CP3b/B42），I10 不代签。
- 预注册：复用 `artifacts/model-contracts/b71-cp1/scenario-preregistration.json` 的场景定义；S4 的确定性场景证据目录 `artifacts/slice-verify/b71-first-consumer-tauri/`。
- 恢复入口不变：先消费 IR（S1）→ 再接观察回流（S2）→ 最后补 trace/恢复与门禁（S3/S5）。

#### CP3a S1a 实施记录（2026-10-31）

- 新增 `JudgmentProtocol.prompt_ir/2`（旁路，不改变 `prompt/2` 生产路径）：把 protocol_input 经 `AuthoringTranscript` → `RequestIR` → `to_provider_prompt/2` 投影为 provider prompt；协议/上下文段落进入 application_base（作者输入段替换为「见独立 user 消息」占位），作者原话独立 user 消息且字节不变，tools 目录与 legacy 等价、tool_choice=auto。
- 测试（`judgment_protocol_test.exs` 新增 2 条）：IR v1 validate、工具目录 name 顺序等价、application_base 带 provenance + context_block、作者原话独立且不被 application_base 冒充（I-ART-2/3）、continuation profile 同样可用；文件 74/74、全量 `mix test` 0 failures、credo 0、compile -Werror、xref/arch 通过。
- **S1b 下一步**：把 `DialoguePlanningService`（`dialogue_planning_service.ex:1320`）的 `JudgmentProtocol.prompt(protocol_input)` 调用切到 `prompt_ir` 投影，同步核对 `slice_verify` test-support 解析与既有单 user 断言（合法契约断言随实现演进需保留语义覆盖，不放宽门禁）；随后做真实页面确定性场景（S4）。
- 边界：S1a 不改生产请求字节、不引入第二控制环；不签实模语义。

#### CP3a S1b 尝试与回退记录（2026-10-31）

- 尝试：把 `JudgmentProtocol.request/4` 的生产 prompt 从 `prompt/2` 切到 `prompt_for_production/2`（IR 投影优先，失败回退 legacy + `judgment.prompt_ir.error` 诊断）；`judgment_prompt_diagnostics` 与生产同源（拼接全部消息统计）。
- 回归结果（快速失败，未合并）：`AgentRunJudgmentPlanFlowTest` 4 例、`WorkspaceChannelTest` 2 例失败（收不到 `:plan_drafted` / AgentRun ack 消息）。root-cause：slice_verify 测试替身的判断规则（`judgment_author_input/1` 等）依赖 legacy prompt 的「## 作者输入」文本形态；IR 投影把作者原话拆为独立 user 消息、application_base 中该段为占位后，判断规则不再命中，flow 走错分支。
- 已做的安全适配（保留）：`slice_verify.prompt_text/1` 仅在 IR 形态（含 application_base provenance 消息）时把最后一条非 application_base 的 user 消息重拼为「## 作者输入」段；legacy prompt 行为不变（55/55、全量各 app 回归 0 failures）。修正了 test-support 模块属性的定义顺序（必须在首次引用前定义）。
- 回退决定：生产 `request/4` 与 diagnostics 恢复 legacy `prompt/2`（主链请求字节不变），避免在测试替身尚未 IR-aware、flow 测试未适配时合并半成品；`prompt_ir/2`、`prompt_for_production/2` 保留为**未接线**的 S1b 起点（有单测）。
- S1b 下一步（有明确计划）：①把 slice_verify 的判断规则改为 IR-aware（优先读结构化 messages 的最后作者 user 消息，而不是依赖拼接文本）；②同步 flow/白盒测试与 `judgment_prompt_diagnostics` 的文本统计口径；③再切换生产 `request/4` 并跑全量回归 + 真实页面确定性场景（S4）。

#### CP3a S1b 第二次尝试与预算耗尽（2026-10-31，停止盲试）

- 第二次尝试：在 slice_verify 文本适配基础上（IR 形态把最后非 application_base 的 user 消息重拼为「## 作者输入」，并删除 application_base 内占位作者段以免正则先命中），再次切换生产 `request/4` 到 IR 投影。结果：`AgentRunJudgmentPlanFlowTest` 仍 4 例失败（收不到 `plan_drafted`；mailbox 显示判断已发 `plan_request` 与 mechanical prep `evaluation_made`，但 plan draft 阶段未完成）。
- 预算：同一失败类型累计 2 次（达到 stop 线），已回退生产 request/diagnostics/b33 helper 到 legacy，主链测试恢复全绿；不再进行第三次盲试。
- 根因状态（未完全定位）：slice_verify 的判断规则仍依赖 legacy 单 user 文本形态；仅改 `prompt_text` 拼接不足，判断→plan draft 的事件链在 IR prompt 下出现偏差。建议下一步用**单测级结构化探针**（直接以 IR prompt 调 SliceVerify.complete 并断言 `plan_request/plan_draft` 事件与 payload），而不是继续在生产路径上试切。
- 保留：`prompt_ir/2`、`prompt_for_production/2`（未接线）、slice_verify 条件适配（legacy 行为不变）；全量各 app 测试 0 failures；`AgentRunRuntimeTest` 在全量并发下出现 1 次 flaky，单独复跑 2 次均 41/41 通过，登记为已知 flaky（非本次改动、单独调查）。
- 待作者选择（不擅自扩范围）：**A（推荐）**先做 slice_verify 判断 IR-aware 的单测级改造 + 结构化探针定位，完成后重新评估 S1b；**B** 暂缓 S1b，按 NEXT 候选推进（UA01-PROMPT T3 等）；**C** 授权更大范围改造（IR-aware 判断契约/新 flow），另行设计评审。

### CP3c 实施记录（2026-11-01）

- **按作者要求整体重构，不保留双轨**：首个判断消费者已从 `judgment_prompt_override` 迁移到唯一 `AuthoringTranscript`。初始 Base 只含角色规则与输出协议；版本、变更原因、source_refs 和当前权限/预算进入 `scope_update`。同一 turn 幂等，新作者 turn 独立追加，旧 body 不删、不改、不替换。
- **统一原生消息链**：模型响应、工具参数原文、Provider 私有推理引用、观察、validation_result 和 application_notice 都进入 canonical transcript。三种 Provider 投影共享 scope 与 provenance；工具 ID 只在 Provider 输入边界分配。单个 explore 原生回流；模型计划包含多次读取时聚合成真实观察，不伪造逐步模型调用。
- **G7/G8**：`AuthoringTranscript.checkpoint/1` / `restore/1` 是版本化 JSON 边界；durable checkpoint 保存 canonical transcript，进程终止后从数据库恢复相同投影与最新 scope，无 Provider 调用。离线事实恢复不等于 durable 自动重启执行，后者仍归 CP4。
- **确定性证据**：全量后端 **2510 tests / 0 failures**；G7 三种投影、探索分页/预算关闭、计划内联读取、作者新 turn、续行 application goal 不伪造 user、G8 数据库恢复均通过；I1/I2/I3、compile --warnings-as-errors、credo strict、xref、arch、前端 typecheck/lint/660 tests、frontend_audit 27、design_trace 19、quality manifest 226 scenarios 均通过。
- **真实页面分层**：`artifacts/slice-verify/b71-first-consumer-tauri/summary.json` 的浏览器驱动证据通过（两次 chapter_read、`next_offset=6000`、call_id、末页回复、零写入），但 `surface=browser`，不冒充原生。新增 `scripts/native_b71_{drive,evidence}.mjs` 与 `native_b71_batch.sh` 后，`artifacts/slice-verify/b71-first-consumer-tauri-native-cp3c-03/summary.json` 为 **surface=tauri / driver=ax-native-system-ui / 14 checks全过**：严格前缀、最新 scope 关闭、续读 query 与 footer 字节一致、call_id、末页可见回复、零生产写入均成立。
- **验收故障留痕**：`cp3c-01` 因 harness CLI 同步返回值误用 `.catch()` 失败，未进入产品操作；`cp3c-02` 用户旅程完成，证据脚本误选首页观察而未过，已修为分别核对首页 footer 与下一次真实 query，并仅复核原批次，未重复模型动作。失败目录只读保留。
- **门禁与边界**：统一静态扫描复跑成功，5 条 secret 命中均为既有 false_positive/accepted_risk；ADR-0032 缺少 `enforced_by` 是独立阻断，不在本 slice 修改。ub-tools 不支持 Elixir，不能作为后端质量门；本次 JS 验证明细的既有高复杂度不由本任务扩大重构。真实缓存收益未测量，不宣称优于既有请求；CP3b 实模资源窗口、完整 durable 恢复、CP4/CP5 仍未闭环。

### CP4a 开工冻结（2026-11-01）

- **范围**：creative/quality Request IR、原生 tentative/quality tool call、应用校验/物化回流、TurnExecutionService canonical 返回值、AgentRun 续行。其它规划 profile、显式压缩、自动重启执行和真实缓存收益归 CP4b，不写“范围外”，只记“下一 checkpoint/未闭环”。
- **七问**：①消费 VS-00L §14–15、G4 与既有 AuthoringTask/ToolRequest 契约；②保护同一 run 唯一事实源、严格前缀、tentative-first、作者主权与 I1/I2/I3；③切穿 `novel_agent` 的 Request IR/creative/quality adapters 与 `novel_application` 的 TurnExecutionService/flow，不修改 web/前端产品路径，不新增 schema；④首个消费者为 `ProseDraftingWithQuality`，其余 creative 消费者复用同一适配器；⑤原生请求/校验/候选/续行测试 + 全量回归 + 真实页面；⑥由外部自动化驱动真实 Tauri 候选页，产品验收感知为 **no**；⑦writer/evaluator 复用同一只读观察，不新增固定作品 packet。
- **实现纪律**：不让 agent 依赖 application transcript 模块；Request IR 是跨层契约，application 用 `AuthoringTranscript` 恢复。creative/quality 每次只调用一次 Provider，返回业务结果与内部会话数据；不得为同时取得候选和 transcript 重发请求。
- **迁移纪律**：旧 JSON 文本生成与 `user` 纠错仅作显式有限模式兼容，目标生产链使用原生调用与校验结果。CP4a 不单独宣称 B71 或 CP4 完成，CP3b 实模和 CP4b 后果独立验收。

### CP4a 实施与验证记录（2026-11-01，done）

- **统一原生创作与质量主链**：`CreativeProvider.Real` / `ProseQualityEvaluator` 使用 `submit_tentative_artifact` / `report_quality_findings` 原生调用；`TurnExecutionService` 返回 TurnResult、DecisionTrace、canonical transcript。旧 JSON 仅保留显式 `legacy_json_content` 有限模式，不作为 CP4a 证据。
- **阶段与工具边界**：Request IR 保留全部历史工具，当次 Provider 投影通过 `tool_names` 仅开放当前阶段工具，单工具阶段同名 `tool_choice` 强制绑定；续行 scope 同时携带角色/输出契约、目标、偏离、真实观察、版本与来源，避免复用历史 judgment 阶段。真实 Provider 调用在统一 step meta 中只计一次。
- **原生结果闭合**：创作响应之后由应用追加 `tentative_artifact_validated`，质量响应之后追加 `quality_findings_validated`；两者都是 tool 原生 validation_result，不表示作者采纳或 canon 写入。续行响应先进入本次执行快照，再由后续 writer/quality 统一落 checkpoint，不用事后 patch 覆盖新历史。
- **恢复与作者安全**：canonical Provider 参数统一 JSON 字符串键；versions/arguments/items 不与 transcript 结构字段混一恢复。checkpoint 新增应用结果字段，真实 run 的续行→writer→quality 及 validation_result 可经 JSON 恢复。作者可见消息继续使用自然语言和章节 display name，不透出 Request IR、provider_session、工具 code、call_id 或原始推理。
- **验收场景**：新增 `b71-authoring-transcript`，复用 `native_b71_{drive,evidence,batch}` 和真实 Tauri 输入/按钮，驱动 writer timeout → scoped retry → 同 run 候选；证据核验覆盖严格前缀、当前阶段工具、应用结果闭合、durable checkpoint、作者安全文案与未采纳前无正文写入。产品验收感知为 no。
- **局部与全量证据**：同种子全量后端 2516 tests / 0 failures；`mix compile --warnings-as-errors`、`mix credo --strict` 通过。I1 driver 已支持原生工具参数精确字节比较，I1/I2/I3 全部通过；quality manifest 227 scenarios / 2 drafts 通过。前端 typecheck/lint/test、frontend_audit、design_trace 已通过。xref/arch 通过。
- **真实页面闭环**：`artifacts/slice-verify/b71-authoring-transcript-tauri-native-cp4a-07/summary.json` 与最终驱动复验 `...cp4a-08/summary.json` 均为 `surface=tauri / driver=ax-native-system-ui / provider=slice_verify`，14/14。作者明确选择“可恢复的长任务”后，真实 durable run 完成 writer timeout → scoped retry → 同 run 候选；严格前缀、阶段工具、原生结果闭合、durable checkpoint、作者安全文案与未采纳前无正文写入全部成立。早期输入焦点、历史文本误判创作类型、bounded 无长期任务等失败只读保留，未冒充 PASS；`cp4a-06` 的 bounded 旅程只作补充，不替代 durable 证据。CP3b 实模、CP4b、真实缓存收益不代签。

### CP4a 门禁补充（2026-11-01）

- `pnpm tauri build` 成功，生成 `.app` 与 `AI Novel Studio_0.1.0_aarch64.dmg`；本机无 Apple 公证凭据，未声称已公证。
- 统一静态扫描 `bash scripts/ai_static_scan.sh --top 10`：18 passed / 2 failed / 0 skipped，本次改动文件 0 命中。5 个既有 gitleaks 项保持 false_positive/accepted_risk；另一任务 `artifacts/task-done/20261031T190849Z/manifest.json` 的 pending 未在本 slice 修改或代签，不宣称扫描全绿。
- ub-tools：新增 CP4a 驱动/证据函数已按 crapper 结果拆分；dryer 无可分析源文件；mutator 仅 scan（69+149 sites），无诚实的独立 JS mutation runner，未宣称 mutation 通过。临时 `.metrics/` 已清理。

### CP4b 开工冻结（2026-11-01）

- **CP4b-1 当前 checkpoint**：统一其它创作 profile 的 canonical 会话与失败恢复，完成显式压缩/恢复、旧 JSON 请求协议退役及真实 Tauri 创作页。CP4b-2 的实模行为、缓存/usage 和剩余 replay/Why 证据是下一 checkpoint，不把本 checkpoint 写成 CP4b 全量完成。
- **Contract**：消费 VS-00L §16、ADR-0033、UA-01 的 bounded/durable 语义、AuthoringTask/ToolRequest 和既有 DecisionTrace；新增 `AgentRunFlows.AuthoringSession` 唯一 application 会话边界，不新建数据库表或平行协议。
- **Invariant**：同一 run 唯一事实源，严格追加前缀；作者原话/artifact 字节、tentative-first、作者裁决、I1/I2/I3、N-NARR、真实预算与 replay 不调模型。压缩必须显式声明覆盖/来源/版本/省略，不能静默丢弃。
- **Boundary**：切穿 `novel_application` 的 flows/AgentRunServer/transcript/replay 与 `novel_agent` 的 RequestIR/creative/quality 投影；`novel_web/frontend` 仅消费 author-safe 投影，不让 agent 依赖 application transcript 模块，不新增 schema。
- **Consumer**：五类其它创作 flow 是首批消费者；显式压缩由后续 run 与 durable restore 消费；Replay/Why 沿用既有 trace 服务，不重放模型。
- **Proof**：五类 flow 的成功与失败 transcript、错误恢复、三类投影的压缩前后幂等、旧 JSON 不再形成独立请求、Replay/Why 来源边界、全量后端/I1/I2/I3/架构门禁，以及真实 Tauri 其它创作候选页。真实模型行为不以 stub 代签。
- **Acceptance Driver**：复用真实 Tauri 工作台与外部 AX/传输证据，驱动其它创作 profile 从自然输入到 tentative 候选，核对 run 内请求与 durable 恢复；产品验收感知为 no，不新增隐藏 DOM、slice env 或自动操作。
- **Exploration**：复用既有只读观察与 source refs，压缩保留 Base、作者原话、当前 scope 与未覆盖消息；摘要不能冒充未读事实。非要素物化的 profile 复用同样按需求证，不新增固定作品 packet。

### CP4b-1 实施顺序

1. 先用成功/失败用例固定五类 flow 的 transcript 与统一错误结果，再引入 `AuthoringSession` 并接线。
2. 用三类 Provider 的黄金请求固定显式压缩、恢复和幂等，再接 durable 真实状态。
3. 收敛 creative/quality 的旧独立 JSON prompt/纠错实现，保持显式有限模式仅限响应解析；接通 author-safe Replay/Why。
4. 以真实 Tauri 其它创作页、全量门禁与 CP4b-2 的未闭环边界收口，不把局部 checkpoint 写成 CP4b 全量完成。

### CP4b 系统性复核与重构（2026-11-01，进行中）

- **开工与保护**：继续消费 §16 的既有范围。核对当前分支与全部 WIP；基线快照保存于 `artifacts/b71-resume/20261101-133908/`。B77 设计 WIP 不纳入本轮修改。后端基线 2522 tests / 0 failures；原生角色页历史 `cp4b-07` 为 11/11，但不是以下新代码的复验证据。
- **压缩事实源**：先用失败测试复现任意 covers 删除同一历史、原文丢失、部分多调用折叠及损坏 checkpoint 崩溃，再重构为 canonical 消息永久追加 + `RequestIR.Compaction` 统一投影。精确 `covers.call_ids`、完整交换、refs/version、重叠与幂等均校验；旧 `turn_range` 只作历史说明。恢复时从消息重建 call_ids，不信任持久派生索引。
- **原生交换**：`NativeToolExchange` 收敛创作/评审；未知或多工具响应整体验证失败且逐 call 回流，有限重试与末次拒绝都完整留存。生产 `to_provider_prompt` 消费能力门；有限 JSON 必须事先声明。判断/续行也逐 call 闭合协议校验；计划内联读取仍由真实聚合观察绑定，协议有效不等于执行批准。
- **失败与持久化**：durable 压缩在数据库提交成功后才推进内存；真实 SQL 拒写/任务缺失测试保护不报假成功。五类 flow 共用 `AuthoringSession` 保留失败 transcript 与执行计数，正文 D1/D7 不再丢历史；工具预算来自派发边界，失败也累计前序 planner 消耗。旧 JSON 测试替身按原始 payload 迁移为原生工具响应，没有放宽协议。
- **Replay/Why**：按作品/会话/父轮次或已记录步骤关联 durable 历史，并核对 run 身份；缺失/损坏/错绑为 partial，引用无显示名时不暴露内部 ref。新增三条完整性红测先失败，修复后连同作者安全回归 13/13。
- **真实传输保真**：HTTP fixture 已复现参数原 JSON 被 adapter 丢弃、DeepSeek 私有回放字段不可达及用途模型只改日志不改 body。分别以 raw_arguments、来源绑定的 opaque provider_state、单一 execution_route 快照修复；默认/跨 Provider 或模型不回投私有状态。RunEnvelope 只存身份与目标，避免整个 AgentRun struct 进入 durable JSON；任意 validation.detail 与私有状态按 JSON payload 处理。
- **工具边界**：crapper/dryer/mutator 已实际调用，当前安装版不支持 Elixir（输出无可分析源），不能据此声称后端 CRAP/mutation 达标。TS 作者历史投影 dryer 无重复，选定两处边界 mutation 2/2 killed；无覆盖率报告，CRAP 为 N/A，既有 view 高复杂度仍需单列。前端 typecheck/lint/661 tests、设计追溯 19/19、manifest 228 scenarios 已通过。Tauri `.app`/DMG 已构建；无 Apple 公证凭据，不声称已公证。
- **验收诊断**：I3 3/3 通过；首次 I1 主链失败由更严格状态机揭示未闭合判断调用，未更改不变量判据。一个通用 Gateway 诊断探针被自动审批拒绝（无法确认真实 Provider/持久化副作用）；未执行该探针，改用已有测试中的确定性 provider 与测试日志定位。最终全量门禁与新代码原生页面复验仍待下述收口记录。
- **明确保留的计划内后果**：具体路由模型能力尚未与 IR 声明绑定；工具请求仍走 final-only，SSE parser 尚未累积工具参数，不能宣称原生工具流式已完成。Responses 目前仍只有纯投影证据。真实模型 CP3b/CP4b-2、实际能力矩阵、显式压缩的真实产品触发/页面证据、真实 usage/cache 与最终 CP5 不由本轮确定性证据代签；B71 保持 doing。

### CP4b 本轮验证与下一消费者（2026-11-01）

- **局部门禁**：全量后端最终复跑 2561 tests / 0 failures；新增原生故障注入边界测试所在文件 62/62。compile --warnings-as-errors、credo --strict、xref 无编译环、arch_check 通过；I3 3/3、I1 4/4、I2 3/3（3 对不相交）通过；I-CACHE 七个调用点全部 covered/enforced。I-CACHE 离线 fixture 已迁为原生工具响应，writer 动态边界按 VS-00L/VS-00I 重锚到独立作者消息，静态规则/schema/enforce 判据保留。
- **真实原生页面**：`b71-authoring-profiles-tauri-native-cp4b-fidelity-01` 为 11/11（含 Why 无 Provider 调用）；`b71-first-consumer-tauri-native-cp4b-fidelity-03` 为 14/14。正文恢复的 `...fidelity-04` 完成真实用户旅程，但旧核验把续行次数写死为一次而失败；`...fidelity-04-recheck` 用同批原始 wire/截图/DB 逐项比较调用 ID 和顺序，14/14，不重新操作产品。`evidence-recheck.json` 保存原批次与源文件哈希；原失败目录只读保留。
- **验收故障根因**：`...fidelity-02` 的替身故障注入用历史正文标记匹配当前续行，导致错误超时；新增红测 62 条中 4 失败后，只修 test/support 的当前工具 + 最新 scope 判断，62/62 通过。外部 driver 现在遇真实 run_failed 立即失败，避免误等 turn timeout。历史核验增加 3 条正反例，拒绝丢失/错序/伪造前序调用；没有放宽产品权限或内容因果不变量。
- **统一扫描**：首次 `bash scripts/ai_static_scan.sh --top 10` 为 18 passed / 2 failed，0 touched findings。前缀问题已闭合；剩余为 5 条既有 secret 处置项及旧 task completion manifest 过期。继续使用原 checker 的显式 manifest 参数，将本轮证据清单放在现有 `artifacts/b71-resume/`，不在禁止新增的 `artifacts/task-done/` 下建新体系；最终报告以 `artifacts/static-scan/{top10.md,report.json,disposition.md}` 为准。验证清单只证明当前树的检查与页面证据，不表示 B71 全量完成。

**消费者完整性复核发现以下计划内链路仍未迁移，不能以本轮绿色测试宣布 CP4b/CP5 done：**

| 下一步 | 当前事实与统一迁移要求 | 完成证据 |
|---|---|---|
| 独立计划起草与重规划 | `AgenticPlanDraftPlanner` 同时实现 draft/revise；judgment/prose/readonly flow 的独立调用仍用 giant user prompt 与文本重试，返回 meta 未带会话。inline plan 已迁移不覆盖 fallback/replan。必须共享 AuthoringSession/IR、原生 plan 校验与失败历史，删除另一套请求状态 | 首轮判断→独立计划→执行→重规划→durable/replay 的完整请求序列；失败重试不伪造 user；真实页面与预算不变 |
| 章节/规划使命 | `ChapterMissionService` 的独立 user 请求和 user 纠错未进入 canonical；保存使命字段不等于保存原生调用 | 使命原生调用/校验/来源进入同一 transcript，后续 writer 使用真实使命，恢复不重调模型 |
| 候选与已采纳内容修订 | `PendingArtifactWorkflow`、`ProseRevisionService` 仍调用丢 session 的 execute 外观，guard 纠错重构独立 request。必须沿作者新授权边界开启/保存新会话，同一修订内复用 IR 与原生失败回流 | 字节保留/目标范围/版本/采纳不变量、失败恢复、真实页面与 I1/I2/I3 |
| 确认入口与叙述退役 | `DialogueGateway` 的确认路径仍丢 TES 第三返回值；泛型无 artifact 成功分支可能调用独立 `Planner.narrate_tool_result`。先核实真实消费者，统一持久新授权会话，无法证明使用的旧入口退役 | 确认执行→trace/checkpoint→Why 可追溯；不能把旧 run 的权限复活；无消费者残留 |
| 实际能力、流式与压缩消费者 | 已统一实际路由，但 application 仍写 full_capabilities，tool SSE 未累积，Responses 无真实路由；显式压缩仍缺真实产品触发/页面证据 | 实际 route/model 能力快照 + 工具流/取消/usage 矩阵；压缩前后页面/恢复；按原预注册执行实模 G1–G8 |

下一实现继续属于原 CP4b 完整闭环：优先独立计划与使命，然后修订/确认与旧入口退役，最后能力/流式/压缩真实消费者及实模；不新增平行任务，不以这里的局部顺序缩小原范围。

### CP4b 独立计划与使命开工检查

- **Contract**：VS-00L §16.6，AgentPlan/ChapterMission 既有领域契约；统一 AuthoringOperation 构造与 NativeToolExchange 协议交换，保留 AuthoringSession 为状态读写边界。
- **Invariant**：作者原话/历史字节稳定、失败原生回流、实际预算、来源绑定、tentative 与逐步授权；应用目标不伪造 user，重试不产生第二业务控制环。
- **Boundary**：novel_agent 原生交换 + novel_application 计划/使命服务、flows、AgentRunServer；domain 规则、persistence schema、web 与前端产品路径不改。
- **Consumer**：JudgmentPlan/ProseDrafting/ReadonlyBatch 的独立计划与 replan，正文/大纲 flow 的使命步骤，以及紧随其后的真实创作调用与 durable 恢复。
- **Proof**：先写失败测试固定前序历史、错误回流、0/1/2 调用数、领域规则与 JSON 恢复；验证规划 meta 在执行前进入下一 step，终局/失败不丢历史。随后全量门禁与原生场景，实模行为继续单列。
- **Acceptance Driver**：复用外部原生 B71 驱动与现有计划场景，核对请求、wire、截图、DB checkpoint 的完整序列；产品验收感知为 no。缺少独立 replan 页面路径时保留缺口，不能以共享 helper 验过代签。
- **Exploration**：复用既有计划索引/真实观察与 ChapterMissionInputs 来源；只在当前操作 scope 暴露相同材料，不新增默认知识 packet，后续消费同一证据 refs。

### CP4b 独立计划与使命实现及原生复核（2026-11-01，未闭环）

- **实现**：独立 draft/revise、chapter/planning mission 已共用 `RequestIR.Operation` / `AuthoringOperation` / `NativeToolExchange`。阶段切换携带该角色完整规则；计划传输重试与结构纠正共用实际调用预算；成功、失败、终局与预算停止保留 canonical。修复终局 replan 丢失版本/meta，以及离线 provider 用历史工具误判当前阶段的问题。上表两项旧入口问题已进入此实现检查点，不再作为未动工项。
- **局部与全量证据**：`artifacts/b71-resume/planning-backend-full.log` 为 2611 tests / 0 failures；compile warnings-as-errors、credo、xref、arch 均通过。I3 3/3、I1 4/4、I2 三输入三对不相交；`planning-icache-final.log` 七个调用点全部 covered/enforced。I-CACHE 的 draft/revision 动态边界按 VS-00I 正式重锚至 scope_update；章节材料仍须存在于两个请求，未删规则换取通过。安装的 ub 工具不支持 Elixir，不能把 no-source 输出记成 CRAP/mutation 通过。
- **原生批次实况**：`b71-authoring-planning-tauri-native-cp4b-planning-01` 的外部 AX 驱动退出 0，真实页面完成判断→独立起草→重规划→两次创作→Why；核验退出 1，失败为 `planning_stage_tools` 与 `no_production_write`。前者实际请求为 bridge 的具名字符串，而核验器仅接受 OpenAI 对象；后者全表计数相同，但 `memory_items` 完整行 hash 改变。未取得字段级前后证据前，不能直接归因为无害召回统计。原批次保持只读，不改写成 PASS；串行命令后续的 mission 批次未启动。
- **下一修复边界**：外部核验须识别实际中立/投影工具选择且严格绑定当前工具。作品内容、治理状态与版本必须完整保护；若记录召回计数/时间变化，须与真实引用日志逐项对账，不能简单排除整张记忆表或忽略未知变化。补全快照后重新驱动真实页面，才可证明未发生隐式采纳。
- **下一消费者设计约束**：对话修订已经处于当前作者输入创建的真实 run，应继承本 run 的判断/观察；卡片确认与按质量发现修订是新的作者动作，须重新授权并建立真实运行归属，不能继承旧 run 的执行权限。统一应用结果闭合与失败会话返回，避免各消费者复制私有 validation/retry。协议纠错与修订范围纠错必须共用实际调用预算，禁止嵌套两次重试形成四次调用。修订领域规则、目标/版本及采纳字节不变量维持原约束。
- **入口审计与修复**：`Toolbox.execute_with_session/2` 的注册表/grant 预检失败曾直接返回 `ToolResult`，与声明的 `{ToolResult, session}` 不一致。DeepSeek worker 用公开入口红例固定后，把 Toolbox 内部收敛为单一元组管线，Toolbox/AuthorizedToolExecutor 旧 execute 外观只投影结果；leader 读实现并复跑 55 项聚焦测试通过。`DialoguePlanningService.pending_artifact_step` 当前覆盖 `stage_state` 的缺口仍待修订消费者迁移处理，不能混记为已修复。
- **记忆字段审计结论**：`worker-memory-audit.md/json` 记录两次真实 recall UPDATE 与两条引用日志；leader 独立复算确认，仅将最终行 `reference_count` 还原为 0、`last_referenced_at` 还原为 null，即精确命中 start 完整行 hash，其余字段未变。这是从最终行和种子默认值验证出的历史状态，不是直接 before 行快照。依据 AU-09 既有引用统计语义，新验收分别检查 canon 全字段不变与引用统计有日志支撑，不修改生产代码以抑制真实统计，也不重写旧批次的失败事实。
- **当前代码复验**：Toolbox 重构后 `artifacts/b71-resume/current-backend-full.log` 为 2620 tests / 0 failures，compile/credo/xref/arch、I1/I2/I3 均通过；前端 typecheck/lint/661 tests、design_trace 通过；完整 `frontend_audit` 首次打包子步骤失败产生两条警告，串行复跑 `current-frontend-audit-recheck.log` 为 27 pass / 0 warn / 0 fail；`current-tauri-build.log` 的 app/DMG 构建通过，临时签名、未公证。字段级快照原生复验与统一扫描见后，局部门禁不替代页面验收。
- **快照核验自身验收**：新增 versioned canon/reference 快照后，leader 红例揭示旧引用日志未知列被白名单丢弃；已退回 worker 修正为全列保留，SQLite capture 与纯比较均有负例。leader 复跑 69 项 Node 测试与 229 scenarios / 2 drafts manifest 通过。纯模块真实 LCOV 下 CRAP 最高 9.0；mutation 实际 144 项、140 killed、4 项排序比较器变异在当前 Node 运行时不可区分（非跨引擎的形式等价证明），保留原工具 exit 3 和处置证据；Dryer 不支持 mjs，不写 PASS。
- **原生 planning-02 未通过**：实际 UI 已走到 Why，final capture 因 `memory_reference_logs[0].id` 解码失败退出 1。真实 SQLite 在 TEXT 列保存 16 字节 UUID，而临时 DB 测试只模拟 BLOB，`node:sqlite` 文本解码丢失原字节。此为证据读取边界缺口；要求先补 TEXT 列二进制 UUID 红例，再由 SQLite 无损投影已知 UUID 字段，保留其它所有列。原失败目录保持失败，未给本批补造 final/summary。
- **原生复验通过**：worker 补齐真实 TEXT + `CAST(? AS TEXT)` 的非法 UTF-8/NUL UUID 红例后，在 SQLite 读取边界无损投影五个已知 UUID 字段，`SELECT *` 仍保留全部未知列，纯 canon 判据未变；leader 复跑 69 项 Node 验收通过。`b71-authoring-planning-tauri-native-cp4b-planning-03/summary.json` 为真实 AX/Tauri **19/19**：判断→独立起草→重规划→两个 writer 共 5 次请求、plan_version=2/replans=1、durable 同源历史、两类 tentative、Why 无模型调用；9 张 canon 表内容不变，引用计数 +2 与两条新日志逐项相符。`b71-authoring-transcript-tauri-native-cp4b-mission-01/summary.json` 为 **16/16**，独立计划与章节使命的原生调用/校验进入后续 writer，正文失败续行、质量与 durable 历史闭合。两批均为确定性 `slice_verify`，不代签实模或全 B71 完成。
- **统一扫描处置**：执行 `TASK_DONE_MANIFEST=artifacts/b71-resume/current-gate/manifest.json bash scripts/ai_static_scan.sh --top 10`，汇总退出 0；原始 checks 为 19 pass / 1 gitleaks fail。Top10 实际 5 项，touched=0、blocking=0：B65 示例 nonce、B63 历史 spec 标识、E2E spec 标识、Pencil 元数据按既有台账为 false_positive；另一分支历史 company-console 凭证为既有 accepted_risk。未改处置台账、未重写历史；后者轮换/历史清理仍归凭证所有者与原分支维护。详见 `artifacts/static-scan/{top10.md,disposition.md,report.json}`，不得表述成扫描零发现。本轮修复的是会话执行边界和核验缺口，没有新增扫描命中需要豁免。
- **整体状态**：当前仅为 CP4b 计划内检查点；修订/确认、实际模型能力、工具流式、显式压缩产品消费者、实模与 CP5 仍未闭环。新的 leader/DeepSeek worker 分工已启用，worker 负责限定修改与测试，leader 负责设计及证据验收。

### CP4b 修订/确认真实入口审计（下一检查点，尚未实现）

- `artifacts/b71-resume/worker-action-entry-audit.md` 的静态证据已由 leader 对照真实 Channel、flow、service 入口复核：`revise_from_findings` 在 Channel 先校验动作，再创建新的 `prose_revision_from_findings_v1` run；权限与预算来自新 profile，不继承源 run。当前缺口是 `ProseRevisionService` 没有接收这个真实 run/snapshot，执行外观丢 session、flow 固定记一次 Provider 调用，失败也不带更新会话。迁移应接通已有运行，不能再创建嵌套 run。
- 工具 `confirm_before_execute`（非采纳确认）仍同步执行 Gateway→TES，使用源 frame/turn id，丢弃第三返回值；Gateway 写 trace 时还未传真实 session。此入口需要明确的新作者动作运行归属与结果持久链，不能仅把 transcript 放进作者可见 TurnResult，或复活源 run 权限。采纳确认仍走 AdoptionWorkflow，不得混入此重构。
- 保留的现役约束：receipt lookup 先于 stale 校验；同 key 同 payload 回放、异 payload 拒绝；新 run 仍逐步经过 Orchestrator；源候选与修订候选并存，修订不自动采纳、不自动追加质量循环。`source_turn_ref`、action input/receipt、目标 artifact/finding refs 与实际执行 turn 必须可互相追溯。
- 持久化差异必须显式验收：修订 run 结果已通过 InteractionLifecycle 先持久后广播；工具确认目前是广播后 best-effort 写 Interaction，而且复用源 turn。一般 bounded run 也不能被测试擅自提升成 durable 来证明 canonical 可回查；需在后续设计明确 bounded 历史留存与 durable 执行恢复的边界。现有 durable-only AuthoringReplay 不可代签 bounded 修订恢复。
- 下一实现先冻结统一应用结果校验/会话保存及共享重试预算，再迁移对话修订、质量修订、工具确认。外部场景复用 `quality-revision-action-run-anchoring` / `p1-prose-revision-candidate` 并补实际请求历史与持久证据；原生验收前不标完成。此顺序服务原 CP4b，不减少其完整范围。

### CP4b 修订消费者开工检查

- **Contract**：VS-00L §16.7、既有 AuthoringTask/ToolResult 与 ADR-0020 修订不自动采纳契约。内部纯校验回调不进入数据/持久协议；共享 NativeToolExchange 唯一重试预算与 AuthoringSession 结果保存边界。
- **Invariant**：原作者/assistant/tool 字节与顺序保留；修订范围失败进入原 call 的失败结果；协议与应用纠错合计最多两次调用且受剩余预算限制；失败历史与实际计数不丢失；原候选保留、修订仍 tentative、无隐式采纳。
- **Boundary**：先改 novel_agent 的交换/creative adapter 与 novel_application 的 PendingArtifactWorkflow、ProseRevisionService、对应 flows/TES。domain 修订规则、采纳写库与前端产品代码保持现役语义；后续确认和 bounded 留存所需的 web/persistence 边界属于同一完整闭环的下一检查点，不能提前标完成。
- **Consumer**：真实对话候选/已采纳内容修订，以及 Channel 已建立的 prose_revision_from_findings run；不是另起 demo 或测试专用执行入口。
- **Proof**：公开工具入口验证协议错误→应用拒绝、应用拒绝→协议错误均只发生两次调用；每次 call 有原生结果，纠错不新增 user，不触发第二 Toolbox 派发。应用测试验证实际 run/IR、章节与候选范围、0/1/2 预算、失败/终局会话、来源版本与既有采纳字节不变量；然后全量门禁与 I1/I2/I3。
- **Acceptance Driver**：复用真实 Tauri 的 pending revision / quality-revision-action-run-anchoring 场景，外部 AX 输入或点击作者动作，核对请求、持久事实与可见候选；产品验收感知为 no。未覆盖的确认及 bounded 历史消费者继续列缺口；实模行为仍单列。
- **Exploration**：修订材料来自已经解析的真实目标/来源/版本与当前 run 观察；保持既有探索可达和 used_context_refs 约束，不添加默认知识 packet。纯校验回调不物化作品要素，拒绝结果不变成新事实。

### CP4b 修订交换审查与工具队列等待（2026-11-01）

- agent 侧首轮已接入原生应用校验和两次共享预算；worker 的 105 项聚焦测试由 leader 复跑通过。但审查尚未接受：非函数 validator 被直接忽略，正常 tool-result 回流丢失独有 `feedback.message`，失败分支重复重试决策，实际工具派发计数还需在派发点记录。leader 的纯本地注入探针 `artifacts/b71-resume/leader-revision-boundary-probe.exs/.log` 已复现前两项，退出 1；不涉及真实模型或作品写入。
- 返修和共享会话红测试已按同步派活规则提交，尚未执行。`dsh_status` 显示 bridge v2.1.0 为 active=2、running=0、queued=2；源码 `runDispatch` 只在 `wait=false` 注册 release，导致先前同步任务完成后槽位未归还。此为工具队列故障，不能记作 worker 正在实现或已完成。
- leader 已准备项目外桥的最小补丁及隔离 VM 红绿证据：`artifacts/b71-resume/bridge-review/sync-slot-release.patch`、`verification.log`，覆盖同步、异步、幂等复用、等待超时、队列唤醒与启动失败。真实 `/Users/loong/scripts/dsh-mcp/server.mjs` 未修改；按本机策略等待用户授权修复或自行修复/重连。不得重复派发绕过队列，也不自行扩大到全局工具维护。
- 应用消费者尚未接线，本检查点未闭环。两个待派任务幂等键分别为 `b71-revision-native-validation-review-fix-v1`、`b71-revision-session-red-tests-v1`；恢复后先核验真实队列/进程状态，再沿已有任务继续，不盲目重启。
- **恢复记录**：用户已授权备份并修复桥，原文件保存于 `/Users/loong/backup-manifest/config/dsh-mcp-server.mjs.bak-20261101-183220`；实际补丁与语法/VM 红绿验证见 `artifacts/b71-resume/bridge-review/{applied.json,applied-verification.log}`。用户随后重连 MCP；leader 核验修复后哈希 `1485305b…898ec2038`，桥 active/running/queued 全为 0。两个待派幂等键在持久 job 元数据中均无记录，预期产物不存在，旧调用属于失效 host generation，确认此前未启动后才沿原幂等键恢复请求。已完成的首轮实现/只读审计未重派；agent 返修独占 Mix，另一任务仅写 application 测试，不运行。

### CP4b 修订边界实施与审查（进行中）

- **agent 返修已复核**：leader 复跑 113 项聚焦测试通过；独立探针确认非法 validator 返回 error 且 Provider=0，独有纠正指引确实进入下一原生请求。重试决定已收敛，实际工具派发计数由 adapter 边界记录。两个真实同步 worker 完成后 dsh_status 回到 0/2、运行/排队均 0，桥的槽位释放获得运行验证。
- **共享会话边界已接线**：AuthoringSession 提供当前响应与 pending call 交集闭合、实际计数投影和真实 run/IR 请求绑定，AuthoringOperation 与 TES 已复用。leader 发现并退回修正 Domain/Common 同名 ToolRequest 错配及坏 IR 静默回退；正确消费 Common 契约后专项/真实消费者复跑 71 项通过。Pending 的新测试已先取得 23 tests/5 failures，5 项均为缺少 run/6，旧 18 项保持通过。
- **Pending 首轮未接受**：worker 报告 65 项聚焦、89 项关键 flow 回归通过，但实现通过本地 checkpoint 往返、过滤新增 scope/application_notice/checkpoint 和 fixture 预归一掩盖共享恢复差异，违背追加式历史。另有 runtime snapshot 覆盖新鲜 WorkSession 投影、把 stage_state 放进 TurnResult 的边界混用。不能以这些绿色结果标检查点完成；相关局部补偿必须删除。
- **根因实证**：`leader-canonical-recovery-probe.exs` / `leader-canonical-recovery-red.log` 使用正常 producer 的 fresh observation：结构化 refs 可恢复但三方投影中的当前 Chat 投影字节不同；字符串 refs 在 checkpoint restore 被拒绝。修复回到共享 IR/transcript/projection，要求三投影稳定、保留字符串和 raw arguments；业务 workflow 不负责历史规范化。
- **当前分工**：一个 worker 修共享恢复并独占 Mix；另一个只补 Pending 边界红测试，覆盖最后真实请求与返回 canonical 的完整前缀、无私有状态 TurnResult、新鲜只读状态不可被旧 snapshot 重开放。质量修订测试也在既有入口准备；任何 UI/实模/持久化后果未验证前仍按未闭环处理。

### CP4b 修订机制与作者出口收口（2026-11-02，局部验证完成）

- **共享恢复**：JSON 值在共享 producer/projection/restore 边界规范，opaque content/coverage 不再因键名被递归误解释；string/map refs 均能恢复，伪 ref 与越界 used_refs 继续拒绝。三种 Provider 投影覆盖 fresh/restore 严格等价，raw_arguments 与作者/正文字符串不重编码。leader 的两个独立红探针已转绿，并复跑 39 项核心/会话测试通过。
- **Pending 修订**：已删除 workflow 的历史过滤、局部 checkpoint 往返和 fixture 预归一。runtime snapshot 只供当前 run 历史；新读取的 WorkSession 投影独占只读与目标可用性，查询失败拒绝，旧投影不回退授权。内部状态只返回外层 flow 结果，不进入 TurnResult。leader 复跑 Pending/B28/Planning/真实 run 接线 68 项通过；新鲜度、完整请求前缀、schema→guard 两次上限及 private DTO 断言均成立。
- **质量发现修订**：真实 flow 接入 execute_revision/6 的 run/snapshot，四步机械流程保持；成功/失败留存同一 canonical 与实际 0/1/2 次 Provider 消耗。旧 /5 与 /6 共用单一执行/组装/trace 管线；flow 仅返回本步 delta，revision_result 只存 finalize 必需的 TurnResult。预算上限与 execution_counts 分开。/5、revise/3 有限外观仍待随确认入口统一退役，不作为已完成的真实运行入口。
- **作者出口**：恢复事件不再带 checkpoint_data，Channel 的 task DTO 只投影公开进度/状态/refs，旧持久事件同样剥离 private checkpoint；HTTP Provider activity 历史出口也补齐该边界，并保留 bool/null 与普通文本语义。DB 和内部恢复仍保留完整 canonical；未清空历史以换取测试通过。相关 service/controller/Channel 真实持久负例均通过。
- **全量局部验证**：`revision-private-backend-final.log` 为 **2694 tests / 0 failures**，compile warnings-as-errors、credo 通过；xref/arch、I3 3/3、I1 4/4、I2 3 cases/3 pairs、I-CACHE 七点 covered/enforced 已通过。前端 typecheck/lint/**661 tests** 通过；`revision-frontend-audit.log` 为 27 pass / 0 warn / 0 fail（含 Tauri 构建），设计追溯 19 pass。最终扫描 UI 门禁按 pending 记录；这些局部证据不替代新修订 UI 或实模。
- **验收登记纠偏**：既有 p1-prose-revision-candidate manifest 对齐真实四步机械流程、0 plan_drafted、正常场景 1 tool/1 Provider；错误的模型计划/2 次调用判据已移除。协议纠错两次的 B71 证据单列；原始历史结果不改写，manifest 229 scenarios / 2 drafts 校验通过。
- **原生 UI 仍待**：已有 AX B71 driver 尚未点击质量修订；规范 seed 只落大纲，必须由真实页面生成正文/发现再触发作者动作。Source/action/receipt/run/child turn 要联合关联，LLM JSONL 不能只靠 turn_id 区分源草稿与修订。旧原生 19/19、16/16 是此前检查点证据，不能代签这些新修订入口。
- **下一必做后果**：bounded canonical 目前仅在内存，缺私有持久载体；普通 step 的 run/events/checkpoint 跨表 best-effort，且发布时点需复核；AuthoringReplay 按 parent 最新 run 会混淆 source 与质量 child，turn_rev_* 需用持久 TurnResult 的真实 run_id 绑定。详见 `worker-bounded-transcript-persistence-inventory.md`。随后完成工具确认、实际能力/流式/压缩产品消费者、实模与 CP5；B71 继续 doing，不缩小原范围。
- **最终扫描未放行**：执行 `TASK_DONE_MANIFEST=artifacts/b71-resume/revision-gate/manifest.json bash scripts/ai_static_scan.sh --top 10`，退出 1；18 checks pass / 2 fail。Top10 实际 6 项：既有 gitleaks 4 项 false_positive、1 项 accepted_risk（处置台账未改），新增流程项为“修订 UI evidence required but not verified”，保持 pending/blocking=1；touched findings=0。未借用旧原生 summary、未标为风险接受或关闭。修复方向是补新修订原生场景及其计划内持久化证据，完成后重新生成 verified manifest 并复扫。详见 `artifacts/static-scan/{top10.md,disposition.md,report.json}` 与 `revision-static-scan.log`。

### CP4b 私有历史持久化开工检查（2026-11-02）

- **Contract**：VS-00L §16.8、现有 authoring-transcript/v1 与 Interaction 运行归属；新增私有 `agent_runs.authoring_transcript`，durable v3 引用它，v2 仅只读兼容。本次不扩大公开 AgentRun/TurnResult schema。
- **Invariant**：同一 run 只有一个 canonical 存储源；不可变身份严格匹配；旧消息完整前缀保留；显式压缩先持久后确认；源结果与修订 child 不混淆；历史回查不授予续跑权限。
- **Boundary**：novel_application 负责 transcript 语义、身份绑定与状态转换；novel_persistence 负责私有存储和事务。复用已有 runtime/replay/问题事务，agent/domain 不新增 I/O，web/frontend 不接触 raw checkpoint。不改 B77 与无关 WIP。
- **Consumer**：真实 bounded 修订 run、既有 durable checkpoint、AuthoringReplay/Why、AgentRunService 离线恢复；不是新建脚手架或测试专用存储。
- **Proof**：红绿测试覆盖 bounded 终局/失败历史、v3 引用及 legacy v2、JSON 往返三投影、错会话/错父轮次/损坏、旧消息截断拒绝、缺 task/SQL 拒写全回滚、source+child 同 parent 与 turn_rev 身份；后续结果提交故障注入验证无虚假成功广播和真实消耗保留。编译基线已通过；全量和场景门在实现后复跑。
- **Acceptance Driver**：补既有 B71 native AX 修订场景，真实生成正文/发现后点击修订，联合 Interaction/run/请求/回执身份核验；再打开 Why，确认不调用 Provider。产品验收感知为 no；该场景、普通结果原子提交和确认入口仍为计划内未闭环项。
- **Exploration**：本步不物化新作品要素；只留存已有 Base/观察/used_refs，沿现有共享 IR 校验恢复，不补专用知识 packet、不推断未发生的模型认知。
- **恢复核验**：桥 active/running/queued 均为 0，最近任务 completed；未重派原任务。保留此前 2694/661 的局部基线及 pending UI 门禁，新增实现不得沿用旧结果代签。

### CP4b 私有历史首轮审查（进行中，未接受）

- worker 已新增私有列、snapshot 事务、v3 引用及恢复 helper，并报告 persistence 365、application 目标集 164、web 17 项通过；application 全量 1195 中 9 项新的回查红测试失败。只迁移测试 DB，未改真实用户库。
- leader 独立 `leader-private-history-boundary-probe.exs` 取得 **6 tests / 6 failures**：bounded 读取错误依赖 durable 版本；坏私有历史回退 v2；不带 transcript 的状态更新可改 session；同时改 row/checkpoint 也可重绑；未知格式可写；空 JSON 抛异常。该结果否定首轮边界完成声明，已交 worker 修复共享选择/写入边界，不能以目标集绿色代签。
- 首批回查测试也经审查返修：身份冲突必须 partial/无错误活动，不指定任一方胜出；旧副本排除断言必须实际写入不同旧内容。现有 11 项测试通过静态语法/格式检查，运行验证仍待 Mix 独占窗口。
- native 证据读取器须同步移除 `parent OR scope + latest`，改为真实 work/session/run/parent 与 task 引用精确关联、严格读取 v3 私有历史；旧批次证据保持原样。此实现与普通结果事务、身份消费者及真实修订 UI 均未闭环。
- **存储返修复验**：leader 已复跑原 6 反例全部通过。另两组独立探针发现：`leader-private-history-json-probe.exs` 的 fresh 三投影成功，但存储 helper 自带的 JSON 转换把日期/时间 struct 展开，恢复三投影均抛 `Protocol.UndefinedError`；`leader-private-history-task-binding-probe.exs` 为 2/2 失败，同作品/父轮次可接管另一 run 的 task，新 checkpoint header 也可写错 run_id。已退回删除重复 codec、补既有/新 header 身份校验。不得把此版标已接受。
- **回查真实红灯**：leader 实际运行 `agent_run_history_binding_test.exs` 为 11 tests / 9 failures（`leader-history-binding-red.log`）；错误覆盖 source/child、错作用域、冲突、旧数据歧义、私有列和重载摘要，非编译失败。待统一定位消费者实现。
- **native 证据读取器已局部接受**：首轮 69 项绿色后，leader 独立 3 反例仍失败：正常换会话重连被拒，join 前及其它 request 的回复被接受。返修改为当前输入的 join_ref + request ref + 合法时间窗，精确读私有列/v3 引用，不回退旧副本。leader 复跑 73 正式 + 3 独立测试全通过；真实 LCOV 的目标函数 CRAP 最高 8.0，74 个 mutation 全部 killed，首轮“协议等价”猜测已撤销。证据 `leader-native-history-scope-green.log` 与 `worker-native-history-scope-review-quality.md`；Dryer 仍不支持 mjs。这只证明验收读取器，不代签新原生页面或完整 B71。
- **存储局部通过**：leader 再次运行 `leader-private-history-final-{boundary,json,task}.log`，原 6 边界、JSON 三投影逐字一致、2 个 task 归属反例全部通过；worker persistence 全量 376、runtime/service/question/codec 112 项通过。task 回滚探针原来比较 create 返回的内存 map 与 DB map，leader 已修正为先回读 DB 基线，并撤销为旧断言增加的 `LongRunTaskLog` 通用 normalizer；保留原探针/红日志，未以修改断言隐藏两处实际归属漏洞。
- **历史消费者首轮未接受**：统一 `AgentRunHistory` 已接 Why/Provider activity/会话重载，11 项历史绑定转绿，leader 复跑 65 项目标通过；新读边界 probe 发现缺版本时 consumer 补造 v2、v3 task 缺 parent 被接受。禁止补造版本，正在返修。原第三项把 workspace 与 work 强制相等的探针基线经真实 `WorkspaceChannel.join/3` 核验有误：topic 命名空间独立于作品；已保留原文件/红日志，改为验证合法 `workspace:lobby` 与缺失 workspace 的正反例，并在 §16.8 说明历史列的 work_id 语义。回查还须统一 batch row scope、畸形显式绑定和公共步骤解析；尚未最终接受。

### CP4b 历史回查与普通结果提交（2026-11-02）

- **回查局部接受**：consumer 已删除补造版本，v2/v3 的 task header/work/parent 均验证，scoped 批量读取与畸形显式绑定拒绝在同一 `AgentRunHistory`，步骤解析复用 `TurnBinding.parse/1`。leader 复验修正后的 4 个读边界探针及 92 项 application/persistence/HTTP 目标全部通过（`leader-history-read-boundary-green.log`、`leader-history-consumers-final.log`）。Why 仅输出安全摘要，Provider activity 不混 source/child，重载用 DB 白名单摘要；这不替代原生修订场景。
- **原子交付测试准备**：首个准备 job `95b4407c-1005-4cf5-a465-d68dbe5f2e9d` 于 1200 秒超时，保留已写的 8 个候选测试；未整包重派。后续只补事务外发布断言/格式，再修正实际运行发现的问题 fixture 缺 `dialogue_goal` 与两个 unused warnings，将两种 SQL 拒写拆为独立用例。
- **有效红灯**：`worker-atomic-valid-red.log` 为 **9 tests / 9 failures**，无构造器/编译错误；覆盖普通/候选/durable 发布时事实未同提交、两种 SQL 拒写仍广播成功、结果存储失败丢计数、失败终局先广播、问题提交失败丢历史/计数、取消晚到丢历史。原始 8/8 红日志中的一个 fixture 错误不冒充产品缺陷。
- **实施设计**：执行完成后先归集真实 history/counts；应用编排使用 persistence 提供的事务边界，把实际持久结果（含作者原文去重裁决）作为状态推进输入，再以同一 snapshot builder 保存 Interaction/trace/run/step/events/private/task；最后发布。问题事务继续复用既有问题/回执规则。失败保留收到的事实，禁止重新执行 Provider、广播未提交成功或用 best-effort 掩盖失败；流式进度不冒充提交。实现转绿后将 snapshot 投影/写入职责收拢到单一应用模块，不保留逐分支补丁或第二份 canonical 缓存。
- **剩余完整闭环**：普通提交实现、工具确认的新作者动作运行/幂等链、真实修订 AX 场景、实际模型能力/工具流式/显式压缩产品入口、实模与 CP5 均未完成；B71 继续 doing。
- **逐调用证据补查**：只读 planning-03/mission-01 的 `worker-revision-native-call-join-audit.md/.json` 显示，14 行 `slice_verify` JSONL 只有请求、没有 response；12 个 canonical calls 中 10 个只在后续请求回显，独立 response join 为 0/12。重复原生 id 会被 IR 分配 canonical 后缀，原 id 保存在 `provider_call_id`，不能假定二者相等。既有批次各只有一个 run，不能代签 source/修订 child 共 parent 的关联。下一原生修订证据需同次请求/响应配对及真实 `provider_call_ref` 绑定；失败无响应也应通过实际 ProviderRun 归属关联，不能按时间/名称补造。原证据不改写，历史机制结论不扩展为未测的逐调用响应因果或实模证明。
- **交付首轮审查未接受**：worker 报告 148 application / 35 persistence 目标绿，leader 独立复跑 105 核心目标通过；但 `leader-atomic-delivery-boundary-red-confirmed.log` 为 **5 tests / 5 failures**。新引入的 `replay_without_persistence` 将 DB 不可用推断为内存模式，在事务外重试并发布成功；另有非终态 step 事件未提交、取消 error3 历史丢失、未保存的失败 TurnResult 被广播、无新结果的 step 重写旧结果。已要求整体删除普通/问题两处 fail-open 前提，沿唯一提交边界返修，不接受以旧测试无 DB 所有权为由绕开事务。此独立探针另补输入处置状态一致性和独立 Channel namespace 的写入正例，尚待运行，不提前声称红绿。

### CP4b 私有历史与原子交付局部门禁（2026-11-02）

- **交付边界已复核**：普通/问题的 DB 错误回放分支已删除；模型/工具在事务外执行，收到的 canonical/实际消耗与待提交交付效果分开。Interaction/trace、run/step、非 stream 事件、私有历史及 durable checkpoint 同事务提交，实际原文去重裁决先于状态推进，成功后才发布。保存失败时只发表诚实失败通知；不带未提交 TurnResult、不自动重做模型调用。取消晚到 error3、无新结果的 step、输入处置状态、独立 Channel 命名空间均有正式回归及 leader 反例。
- **替换失败回滚**：补查发现失败路径误用含 supersede 效果的 working state；`leader-atomic-delivery-supersede-red.log` 为 8 tests / 1 failure。已改用只含收到事实的 baseline，旧 pending/原候选保留，未提交的 `artifact_superseded` 不落库。原补充 probe 曾误用 `superseded_artifact_refs` 而未触发生产行为；已按真实 `supersede_artifact_refs` 更正后取得红灯，未把早先假绿当证据。
- **Then Make it Right**：`AgentRunPersistence` 统一 snapshot 投影和写入请求，Server 保留状态机、received/staged 转换及提交后发布；普通结果/问题、状态快照、压缩、问题答复共用 run/step/event/private/task 构造。非 stream 过滤单点化，checkpoint_version 由该模块统一提供；私有 JSON 仍由 AuthoringCheckpoint 编解码，无第二份 canonical 缓存、无新执行循环。新增投影行为测试 6 项。
- **测试设施修复**：首轮 full 为 2761 tests / 16 failures，集中在 4 个缺 Sandbox owner 的测试模块；实际目标复跑证实全部为测试设施问题，原断言保持。各模块持有唯一 shared owner，app/web 通过同一 `.ex` support helper 收尾，无全局 owner、无生产 test-aware fallback。helper 从 `.exs` 改为 `.ex` 消除 test_load_filters 警告，未改筛选规则。
- **最终局部门禁**：`artifacts/b71-resume/snapshot-gate/backend-gates.json` 记录 compile warnings-as-errors、**2768 后端 tests / 0 failures**、xref 无环、arch、I3 3/3、I1 4/4、I2 3 cases/3 pairs、I-CACHE 七点 covered/enforced、Credo 全部 exit 0。前端 typecheck/lint/**661 tests** 全绿；native 证据读取器 73 正式 + 3 独立 Node tests 全绿。leader 8 个交付边界独立复验通过；这些是局部/确定性证据，不签新修订 UI 或实模。
- **桌面构建/前端审计**：`snapshot-gate/frontend-audit.log` 为 27 pass / 0 warn / 0 fail，包含本机 Tauri app/DMG 构建成功；设计追溯 19 pass，未声称签名/公证或新 UI 场景通过。
- **最终统一扫描**：执行 `TASK_DONE_MANIFEST=artifacts/b71-resume/snapshot-gate/manifest.json bash scripts/ai_static_scan.sh --top 10`，退出 1；**18 pass / 2 fail / 0 skipped**，6 findings / touched 0 / blocking 1。Top10 实际为既有 gitleaks 4 项 false_positive（B65 nonce、B63 spec 标识、E2E spec 标识、Pencil 元数据）、1 项 accepted_risk（其他历史分支的 company-console 凭证处置）与修订 UI evidence pending。Credo/编译/架构/场景不变量/前端/Semgrep 均通过；未改长期处置或豁免。此前 quick scan 的 alias 与过期 manifest 已解决，剩余唯一 pending 是真实修订 UI，处置方式为完成新场景再复扫。证据 `snapshot-gate/static-scan.log`、`artifacts/static-scan/{top10.md,disposition.md,report.json}`。
- **仍未闭环**：工具确认的新作者动作运行与幂等链、请求/响应和 pcall 绑定、新修订真实 Tauri AX 场景、实际模型能力/工具流式/显式压缩产品入口、实模与 CP5。UI 门禁继续 pending，不能借用旧 planning-03/mission-01 结果。下一实现先补真实逐调用关联（已有 Result.provider_call_ref、execution ctx，IR 当前尚未保存该关联，slice_verify 仍只记录请求），再完成工具确认与修订场景；B71 不标 done。

### CP4b 逐调用关联开工检查（2026-11-02）

- **Contract**：VS-00L §16.9，现有 ProviderRun/Result 的 `provider_call_ref/provider_run_ref`；原生工具 id 与 canonical call_id 不合并，不新建执行身份或运行台账。
- **Invariant**：同次请求/响应/运行/assistant 通过已有执行引用关联；重试逐次保留；缺失/歧义不猜。JSON 恢复与三类 Provider 投影保持字节等价，日志上下文不串线，作者出口无内部元数据/推理。
- **Boundary**：novel_agent 的 Gateway/RequestIR 承接已有执行事实，novel_common LogContext/LLMLog 只管技术日志关联，application 的共享 checkpoint codec 保留元数据；test/support 负责 fixture 配对记录。domain/persistence 公共 schema 不增加新身份，web/frontend 无验收感知。
- **Consumer**：真实 Gateway adapter 调用、AuthoringTranscript 恢复、新修订 native 证据对账；直接 complete 无 ctx 的兼容调用仍明确未绑定，不冒充真实 AgentRun。
- **Proof**：Gateway 正常/失败/异常及嵌套作用域恢复；真实 HTTP 替身日志与 execution refs 一致；同 parent 不同 run 的 pcall 对账；协议首轮失败/末轮成功及重复原生 id；JSON 后引用保留且三投影不含这些内部字段；传输错误无假 assistant。然后完整后端与不变量门禁。
- **Acceptance Driver**：既有 native B71 外部 AX runner 补修订场景，读取真实 request/response、canonical 与 ProviderRun，按 pcall 关联后验证候选/回执/Why；本步日志接线不代签未运行页面或实模，产品验收感知为 no。
- **Exploration**：不物化新作品知识，只绑定既有真实调用与观察/校验历史；Base、used_context_refs、实际输入原文均不变，不加专用 packet。
- **当前核验**：桥 0 running / 0 queued，旧任务均已终态，未重派。已核实 Gateway 分配引用、Result 携带引用而 RequestIR 丢失关联，slice_verify 只记请求。上一轮属于实质进展，goal 继续 active。

### CP4b 逐调用关联实施与审查（进行中）

- **日志侧**：LogContext 仅在实际 Gateway 调用作用域绑定/恢复 pcall/prun，turn 切换清旧引用；LLMLog 配对记录及编码失败占位保留实际引用。SliceVerify 的 complete/execute 共用一次执行/记录路径，新增明确 fixture 格式、实际 result/error 与 ctx 引用，旧请求字段保留；直接 complete 无 ctx 不沿用 Logger 偶然残留。leader 独立复跑 145 项目标通过，属于本地 adapter/fixture 接线证据，不签网络或实模。
- **IR/恢复**：leader 先取得 6/6 属性缺失红，再独立复跑实现后的目标集通过。assistant 从实际 Result 追加可选 pcall/prun，JSON 恢复保留，三投影不输出内部引用，作者同名字样不删。引用拒绝全空白、非法 UTF-8 和非字符串；错误只含固定原因/字段名，不回显坏 payload。
- **集成测试审查**：首版 test helper 手写 Gateway.execute→Result.with_execution，未覆盖生产附引用路径，已退回改为 Execution.dependency/result_fn；只通过实际 event_sink 核对 terminal facts，不在测试里补引用。临时移除生产附引用会使两条测试失败，随后按字节恢复并复验；Execution 生产文件无净改动。日志/IR目标最新证据见 `leader-call-log-acceptance.log`、`leader-execution-refs-final.log` 与 worker review。
- **外部 verifier 首轮未接受**：三个 native consumer 已接显式 pcall+prun，而不再筛 parent 字符串；首轮 96 Node tests 与 141 mutations 虽绿，leader `leader-call-pair-boundary-probe.mjs` 仍取得 5/5 红：真实 raw_arguments+parsed arguments 形状被拒、额外未绑定 assistant 被忽略、canonical run/日志 work-session 冲突未拒、error 可混入成功内容。正在按真实 producer 形状和全量归属约束返修，不能以高分代签因果证据。
- **关联局部复验**：生产 Execution.dependency/result_fn 集成与安全引用边界通过独立复验，完整后端 `call-ref-full-backend.log` 为 **2801/0**。Mix 1.19 的 helper 文件发现规则实测表明仅改扩展名不足，现按默认 `_helper.exs` 约定命名；目录形式 1238 tests/0 且无发现警告，不加 ignore 规则。外部关联器经过第二组 3 个 producer/parent 边界红例修复，leader 8 个独立反例与正式目标共61项通过；新 helper CRAP<10、173 mutations 全 killed。native verifier 编排仍有17项高CRAP残差，须随真实入口覆盖/重构闭合，未豁免。
- **原生单批事实**：callrefs-01 因 worker PATH 缺Cargo在构建前失败（0调用）；共享工具链预检已修，leader独立测试通过。callrefs-02 构建成功但 worker 沙箱拒绝监督器 `ps`（0命令、0调用）；未绕过归属检查。leader确认进程/端口清理后，以单次本机授权执行 callrefs-03：真实AX driver成功、3截图，正式verifier拦下1项 `native_call_success_matches_canonical`，无新summary。`callrefs-03-join-diagnostic.json` 实测5 ProviderRuns/5配对记录/5实际消耗均同源，只有首判断的native_id不匹配；`callrefs-03-native-id-diff.json` 证实原响应只有name/arguments，无id。
- **原 id 缺省的契约纠偏**：已核验 Provider.tool_call.id 现役为 optional，缺 id 不能被 verifier 偷偷改成非法，也不能给 fixture 补 id 来凑通过。按 §16.9 实现显式空的 `provider_call_id` 来源与 pcall/prun + 响应内位置关联，保留旧失败批次；协议特定的 HTTP id 要求仍由 adapter 校验，不由本地 fixture 代签。首轮归一化仍有已标记调用绕过冲突分配、JSON 字符串键丢来源两项缺陷，leader 的三个独立红例复现后已退回修复，复验 3/3 通过；canonical 唯一性与原 id 缺失/映射分别保留。
- **原生逐调用基线（2026-11-02）**：全新 `b71-authoring-planning-tauri-native-cp4b-callrefs-04` 外部 AX 批次退出 0，summary **24/24**；5 ProviderRuns、5 配对请求/响应、5 consumed calls 与 canonical 全部绑定，其中 1 次原 id 未提供被明确计数。leader 已核对 checks、final 截图与 cleanup（remaining=[]）。这是确定性规划链路的当前原生证据，不代签修订/确认、HTTP 实模或文学质量；fixture 候选仍含测试标识与内部用语，不作为产品文案质量证明。旧 callrefs-01/02/03 证据不改写。
- **续行状态**：job `1adc3cfd-92d0-46f5-856a-9001e1b45a66` 及返修 `083b3ce5-1292-43f6-89f9-5c92667a49a5` 均 completed；2026-11-02 续行核验桥 0 running / 0 queued，无待恢复旧任务、无运行中原生批次，不应重派。Node verifier 的 17 项高 CRAP 残差、新修订/确认及完整门禁仍开放。
- **后续确认入口事实**：只读复核 `worker-confirmation-run-current-audit.md` 仍显示工具确认复用 source turn、丢 TES transcript、结果先广播后裸写；quality revision 的 lookup→start→receipt 存在两 Channel 同 key 竞态，receipt status 固定 running。无 reserve/update 接口、无 confirmation profile；需在后续统一作者动作受理/运行归属设计中闭合，不能用本轮 pcall 接线代签。

### CP4b 作者动作原子受理开工检查（2026-11-02）

- **Contract / Invariant**：VS-00L §16.10；receipt 唯一保存受理与 run 绑定，运行状态只读 AgentRun。启动前原子提交，重复动作零次新增执行，冲突/持久失败不广播成功；source/child 身份分离。
- **Boundary / Consumer**：application 统一受理/运行编排，persistence 既有 receipt 与 run/Interaction 事务，web 质量修订真实入口先消费；domain/agent/frontend 不增加另一套授权或运行状态。工具确认后续复用，采纳仍由 AdoptionWorkflow 管理。
- **Proof**：两个 Channel 同键并发仅一 run/一次执行；同键不同完整动作语义冲突；拒写 receipt 或初始 run 后零 Provider/零启动事件；已完成/失败运行的重传回执反映真实状态；源动作过期、错作品/会话、错目标与源权限扩张拒绝。先用真实数据库取得红，再实现并独立复验。
- **Acceptance Driver**：后续既有 native AX driver 的质量发现卡片修订场景消费该入口并核对 source/child、pcall、receipt、候选与 Why；本步后端/Channel 测试不代签真实页面。产品验收感知为 no。
- **Exploration**：不新增作品知识或 packet。实际修订继续使用当前会话投影与已接通的 AuthoringSession；动作来源只表达授权和 provenance，不把旧 run 权限/材料当作当前 Base。
- **实施分步**：先迁移已存在的质量修订新 run，去除 Channel 先启动后记回执；确认同一行为的 confirm/reject 原子消费、确认新 profile 和页面验收仍是本 slice 下一 checkpoint。当前只是设计与开工检查，不声明这些能力已实现。
- **前端消费者复核**：`WorkspaceChat.rememberAuthorActionRunAck` 当前仅凭 run_id 合成 running/executing/runtime_live=true，并优先用返回 turn_id 当 parent；这会把已完成重传和子结果错误投影为新运行。`handleAvailableAction` 对任意成功动作删除 resume pending，也会误把修订受理当原稿已解决。须在后端受理链验收后，统一消费既有 AgentRun 状态/已提交结果，保留原候选及跨会话回执边界；不以仅修后端 ACK 代签产品闭环。
- **首消费者逐调用接线依据**：leader 只读核验旧 `b71-first-consumer-tauri-native-cp4b-fidelity-03` 的真实 ACK/TurnResult/DB，三者都绑定 `run_mvxgly17_5`，是 completed bounded judgment_loop；缺口不是没有真实 run，而是 native reader 只支持 durable JOIN，以及旧库未含新私有列/旧日志未配对。证据 `leader-first-consumer-run-inventory.json`。下一步让共享 reader 先按完整身份读取私有 run，durable 再额外核验 task/ref，首消费者使用真实 ACK 的 run_id 接 §16.9 后跑全新批次；不得把 bounded 改 durable 或修改旧证据。
- **验收器结构审查**：worker `cb7965d9-2449-48b0-9baf-3f9cdf21104e` 已将 native verifier 按采集快照、证据读取/落盘、纯场景判据拆分。leader 独立探针先取得 1 正例通过 / 3 负例失败（观察早于调用、user 伪装调用、同请求重复 id）；返修后又从真实 RequestIR producer 取得 4 通过 / 2 失败（合法 validation_result 被误拒、空 id 被接受）。两轮均退回 worker 修复为同一完整 exchange parser，观察仅为其投影。最终 leader 的 6 独立例 + 正式目标 **71/71**；worker 全 Node **513/513**、目标 CRAP 最高 8、297 mutations killed。dryer 实测不支持 .mjs，无重复度分数；不是 GUI 重跑证据。失败与最终证据见 `leader-native-observation-*-red.log`、`leader-native-exchange-review-green.log` 及 `worker-native-exchange-review.md`。
- **受理链独立验收**：job `a7c68de6-f252-47ec-80d5-f1b2eaee5992` 已 completed，persistence 377/application 1240/web 158（合计 1775）tests 全绿。leader 的 `MIX_ENV=test mix run artifacts/b71-resume/leader-action-admission-boundary-probe.exs` 则 exit 2，4 例中 2 绿 / 2 红：子结果错绑、未知 JSON 键通过；真实运行进程丢失仍重放旧 running、未知 receipt 版本被降为旧记录接受。首轮 probe 自身模块别名失误的日志独立保留为 `leader-action-admission-probe-alias-failure.log`，修正后当前 `leader-action-admission-boundary-review.log` 才是产品红测，不混为根因。
- **本批恢复句柄**：受理返修新 job `bed0499d-75e7-419c-b78e-ef6701aa4a26` 正在执行并独占 Mix；要求复用运行事实读取/失活处置、向 ACK 投影既有 agent_run_state 与已提交结果，并补真实双 Channel/启动发布拒写证明。Node 首消费者 bounded 私有读取/pcall 接线 job `5b967aba-5b9e-4114-a2b2-6d923fa37f58` 独立执行，不运行 native。原子受理首轮、Node 两轮返修均已完成，不重派；这两个活动 job 沿原句柄等待，不并行启动 native/Mix/全扫描。受理修复仍未接受，前端尚未迁移，B71 保持 doing。
- **本轮 quick scan 的准确边界**：worker 执行 `bash scripts/ai_static_scan.sh --top 10 --quick` 为 16 pass / 3 fail / 1 skip；leader 读 raw 日志确认新增两个运行问题是误用旧 task-done manifest（stale）和 Semgrep 写本机日志被沙箱拒绝，不应直接解释为仅剩 UI evidence pending。其余 5 findings 为既有 4 false_positive / 1 accepted_risk，处置未改；前端单测被 quick 模式跳过。受理返修完成后须使用当前显式 pending manifest、可写的工具日志运行上下文重新完整扫描，不能把本次 quick 结果当完整门禁。
- **首消费者接线独立审查（续）**：`5b967aba...` 已 completed，worker 525 Node tests、CRAP 最高 8、108 mutations killed；leader 68 项目标复验通过，但新增真实临时 DB + WS 探针 3/3 红：共享 `turnFacts` 未把 ACK 绑定到 topic/join 生命周期，冲突 ACK 任选第一个，完成结果可来自另一 topic。返修 job `448a73f2-6232-4af6-86ee-a596bccac6be` 接管共享匹配器与探索事件作用域，仍仅 Node。真实 Phoenix 广播的 join_ref/request_ref 为 null（已核 callrefs-04 原 transport），修复不能误要求广播复用请求 join_ref。证据 `leader-bounded-ack-binding-probe.mjs` / `leader-bounded-ack-binding-red.log`。未跑新原生批次。
- **前端迁移设计已核实**：现有 `deriveWorkspaceRuntimeState` 已用真实 resolved 集合覆盖旧 pending；删除 `handleAvailableAction` 的无条件 pending 移除即可恢复单一事实来源，不新建修订专用候选状态。ActionResult wire 类型应落既有 schema/codegen，运行片段复用 `agentRunStateWire`、结果复用 `turnResultWire` 和既有 upsert/merge；不得自行构造状态或用 child turn 当 parent。回执消费核对提交时的 work/session、当前连接及 run/source 归属，处理终态重复和迟到结果。已阅读 UI 46 §9.8 及 Pencil `EYiyl`/`dxUhh` 对应 frame 内容；不改布局、不新增验收 hook。该前端实现待受理返修交付后启动。

### CP4b 动作回执前端消费者开工（2026-11-02）

- **Contract / Invariant**：VS-00L §16.10、UI 46 §9.8、既有 AgentRunState/TurnResult wire；运行事实不由 run_id 推造，source/parent/child 不混淆，修订不隐式处置原稿，迟到回执不跨作品会话。
- **Boundary / Consumer**：foundation JSON Schema → 既有 frontend codegen → socket 回执读取 → WorkspaceChat 的真实动作入口；复用运行态/结果 parser 与已有合并函数。后端正在独立返修，已确认新的 `agent_run_state/turn_results` wire 字段，前端可并行实现；此执行顺序不代表后端已验收。worker 不碰后端/原生 driver，Mix 仍单一所有者。
- **Proof**：完成/失败/失活回执不得变成 running；同 run 重传不新增作者消息或重复工作回合；运行态与结果错绑/当前会话切换拒绝；修订后原稿仍 pending，真正 resolved 结果仍通过已有投影清除；schema/codegen/typecheck/lint/组件与行为测试。
- **Acceptance Driver / Exploration**：后续 native AX 从真实质量卡选择 finding 并点击修订，核对回执、唯一运行回合、原稿/修订稿、Why 和逐调用证据。本步不新增作品知识/packet，不新增产品验收感知逻辑，局部前端测试不代签 native。
- **首消费者局部收口**：shared bounded/private reader、pcall、WS request/broadcast/探索归属与无 scope 兼容清理已完成；leader 最终 **91+3** tests 全绿，worker 完整 Node **548** tests 全绿。原生预注册 `call-ref-native-preregistration-05.json`（首消费者 bounded、1 批、无自动重试、仅隔离测试库/本批应用）；待所有代码写入与 Mix 工作静止后执行，不用旧批次代签。
- **受理返修超时后的独立核验**：`bed0499d-75e7-419c-b78e-ef6701aa4a26` 到 1800s 被桥终止，无最终交付；leader 只读 ps 确认无残留 BEAM 后接管验收，没有重派整项。已落盘代码使原 4 例全部通过，但扩展的 `leader-action-runtime-write-probe.exs` 为 5 例 / 1 失败：runtime-lost SQL 拒写以 Exqlite.Error 穿出 Channel。随后 `leader-action-bounded-crash-probe.exs` 1/1 红，直接观察已受理 bounded 子进程被 kill 后公共 AgentRunSupervisor 的 DOWN(:shutdown)；根因是沿用 transient 旧 init 自动重启，与 bounded 无执行恢复契约矛盾。故前述 full log 的 supervisor 缺失不能直接归因于超时：完整回归中断/失败事实保留，须在生命周期修复后重跑。不得据原目标测试绿签收。
- **前端独立核验**：`617816bf-8281-4b7e-b809-6d51e78f312e` completed；schema/codegen、typecheck/lint、684 前端 tests 通过。但 leader `pnpm exec vitest run --config ../artifacts/b71-resume/leader-action-receipt-vitest.config.mjs` 得到 2/2 红：trigger/source 与 parent 冲突被 fallback 掩盖，带尾空格的不同 run_id 被 trim 成同一身份。另读实际组件确认 duplicate 在 scope 检查前写 UI、consumed=false 仍返回结果、revision finally 无 scope 保护；三条源码字符串测试不能证明异步行为。已退回将真实提交/交付责任收拢、以延迟 Promise 的可观察效果替代字符串断言，原稿仍只由服务端 resolved 事实处置。
- **当前活动句柄（本节为最新恢复入口）**：`1f0edaec-37b2-49f8-b1ce-0a475443cc0f` 处理 bounded owner 生命周期/失活错误边界并独占 Mix；`a8a9c176-673c-4cc2-bcdc-85ab73976af3` 处理前端身份/异步交付返修，仅 pnpm/Node。最近 dsh list 均确认 running，不重派。原 bed 已 timed_out；617816、448a73、909ef6 及更早首消费者/验收器任务均终态。新 native callrefs-05 只预注册未执行，待二者验收、代码静止后运行。
- **验收设计同步与剩余核对**：首消费者现役 scenario 已追加 bounded 私有历史、真实 WS owning scope、逐调用配对和持久证据要求，旧批次仍只读。另需在续行/角色/规划三个 durable consumer 的调用声明中显式要求 persisted run_mode=durable：当前共享 reader 支持两模式，只有首消费者声明了 requireRunMode；规划 outcome 已核实际 record.mode，但另两者仍有旧的隐含 durable 前置，应在新原生复验前补为明确约束，不能因支持 bounded 而削弱旧场景。
- **bounded 生命周期局部收口（2026-11-02）**：`1f0edaec...` 已 completed，bounded owner 改 temporary，失活持久边界区分已终态/缺失/拒写，join 与 receipt 共用明确错误；未改 cleanup 吞监督器退出。worker persistence 378/application 1244/web 168（1790）tests 全绿，compile-Werror/format/Credo/xref/arch 通过。leader 独立复跑 `leader-action-runtime-write-probe.exs` **5/5** 与真实 kill 的 `leader-action-bounded-crash-probe.exs` **1/1**，均 exit 0，日志 `leader-owner-runtime-write-final.log` / `leader-owner-bounded-crash-final.log`。durable 仍保留既有策略，未代签自动恢复；当前无 worker 持有 Mix。
- **前端第二轮审查**：`a8a9c176...` completed，身份原字节/显式 source 冲突 2 例已由 leader 复验通过；worker 692 tests 通过。但 `leader-action-delivery-probe.test.ts` 又取得 **3/3 红**：duplicate 跳过事实消费而不刷新 completed/child，duplicate 绕过来源校验，null 结果成员使交付抛错无法 settle。已退回移除“duplicate=不消费事实”的错误分流，保留统一校验与幂等 merge/upsert，不以丢事实避免复活。
- **当前活动句柄更新**：前端交付返修 `0deda175-e1b7-4152-8889-ec4b76eefb15` 正在执行；durable 场景声明收口另派 `b71-explicit-consumer-run-modes-v1`（见当前 bridge job）。两者均不使用 Mix，不启动 GUI。上一“当前活动句柄”中的 1f0edaec/a8a9c176 均已终态，不重派。callrefs-05 仍只预注册；待源码静止后由 leader 执行，B71 不标 done。
- **当前运行核验**：durable 声明 job `669db97b-d223-4884-9fc7-02b052b6179f` 已 completed，三条声明 durable/首消费者 bounded 均明确；leader 43 项历史/consumer 复验通过，worker 全 Node 549 通过。主线程已启动独立全量 `MIX_ENV=test mix test`（exec session `15247`，日志 `leader-admission-full-backend.log`），此时由主线程独占 Mix，不能并行启动 native/其它 Mix；前端 `0deda175...` 独立继续。首次新原生批次仍未运行。

### CP4b 当前局部验收与原生输入取证（2026-11-02）

- **当前代码的局部验证**：前端 `0deda175...` 已 completed，移除 duplicate shortcut、统一校验和事实交付、对坏 envelope/数组/成员安全收口。leader 的 delivery 3 例与 identity 2 例独立全部通过；文案另经 `1a3c5879...` 去除对不可核验回复的“已受理”断言。主线程完整 backend **2837 tests / 0 failures**、frontend typecheck/lint/**703 tests** 均 exit 0；两条 exec session 15247/9584 已结束，当前无 Mix owner。worker 纯前端边界 CRAP 最高 9、dryer 无候选、mutation 92 killed，均为局部门禁，不代签 DOM/native。
- **callrefs-05 真实失败**：按预注册启动首消费者 bounded 新批次，构建与窗口启动成功，但输入阶段 `composer_text_incomplete:b71:got=0:want=26`，driver/批次 exit 1，未形成 summary。leader 查原 WS/隔离 DB：**0 user_message / 0 interactions / 0 AgentRun / 0 ProviderRun**；cleanup remaining=[]。旧批次证据保持原样，没有自动重试。本次是输入驱动自检失败，不能据此判产品主链失败。
- **只读审计**：`2a74a8b7-9906-4399-b8a3-c89e477e2c85` completed，报告 `worker-native-input-ownership-audit.md/json`。成功/失败前后本批 AX/截图字节相同；灰标题栏不能证明具体 focus/IME/TCC 根因。代码已证实：按 bundle/name 首匹配、未核本批 app_path/PID；activate 返回被忽略；type/key/鼠标 fallback 使用全局 CGEvent，缺真实前台/焦点/权限证据。后续首先补外部输入归属与取证，不修改产品输入逻辑、不旁路 Channel、不操作 Codex/其它应用或系统权限。
- **完整统一扫描**：`TASK_DONE_MANIFEST=artifacts/b71-resume/admission-gate/manifest.json SEMGREP_LOG_FILE=.../admission-gate/semgrep.log SEMGREP_SETTINGS_FILE=.../admission-gate/semgrep-settings.yml bash scripts/ai_static_scan.sh --top 10` exit 1，**18 pass / 2 fail / 0 skipped**，6 findings / touched 0 / blocking 1。Semgrep 及所有编译/架构/I3/I1/I2/N-NARR/I-CACHE/前端门均通过；失败是 gitleaks 的既有 4 false_positive + 1 accepted_risk，以及明确的修订 UI evidence pending。未改长期处置/豁免；旧 stale manifest 与日志权限失败已解决。快照在 `artifacts/b71-resume/admission-gate/{static-scan.log,report.json,top10.md,disposition.md,manifest.json}`，新原生输入/修订/确认仍未闭环。

### CP4b 外部原生输入边界开工检查

- **Contract / Invariant**：消费既有 B37 wait ledger、run ready/app_path 与原生证据协议；输入必须属于本批明确的应用/进程。API 调用返回不等于已激活/已聚焦，不得在无法确认目标时盲发全局事件；旧失败证据只读。
- **Boundary / Consumer**：仅 `scripts/lib/native_ui` 的 Swift/Node 外部驱动及测试；`NativeScenarioHarness` 为真实消费者。frontend/apps 与系统配置不改，不添加产品验收 hook。
- **Proof**：纯目标/输入策略与事件投递适配的行为测试覆盖错路径/PID、多义、激活未确认、权限/焦点失败时零投递；真实 Swift 编译、Node 回归。SDK 已核 AXIsProcessTrusted/CGPreflightPostEventAccess/CGEventPostToPid 声明，但当前没有真实输入故障根因结论。
- **Acceptance Driver / Exploration**：修复验收后另预注册一批同一真实 Tauri 入口，保留输入前后归属/激活/焦点/权限/返回证据，仍以 AX 文本完全一致和真实 WS 为准；不以投递 API 成功或单测代签。此工具不物化作品知识，Exploration 不适用。
- **外部输入首轮审查**：`d34fca47-b9ba-4004-b687-f11e51f9bf9e` completed，已改 exact path/PID target、输入证据与 CGEventPostToPid，Swift 编译/41 新用例/590 Node suite 通过；但 mutation exit 3（9 survivors），不能标门禁绿。leader `leader-native-input-boundary-probe.mjs` 为 **2 正例通过 / 5 负例失败**：truthy 非布尔权限被授予、probe 覆盖固定 target/request、同代重新绑定 PID、非法 PID、错误详情含输入文本。另查本机 NSRunningApplication.h 证实动态属性需主 runloop 轮次更新，当前 usleep 激活轮询不足；不是 callrefs-05 根因已实证。已派 `b71-native-input-boundary-review-v1` 返修上述统一边界/未杀死变异，不启动 GUI。
- **确认基础只读准备**：`73a91158-768a-4347-a553-cecf7f6c981a` completed，报告 `worker-confirmation-admission-foundations-audit.md/json`；未测试/实施。核实无 behavior_id 持久聚合入口、BehaviorState summary 丢 resolution/精确终态、取消 reduced TurnResult/自由字符串 trace、确认合成文本被当作者原话、质量修订 origin_frame_ref 与实际 child frame 不同源、AU04 仍为 Chromium driver 而非原生 AX。均需后续契约/真实消费者收拢，不能由当前修订受理局部门禁代签工具确认或 CP5。
- **最新恢复句柄**：当前仅外部输入返修 `5d9b5e94-9a8f-448e-b0b4-fed1d67ea586` 活动（幂等键 `b71-native-input-boundary-review-v1`，仅 Swift/Node 编译与纯测试，禁止真实 GUI/输入）。d34f/73a/2a74/0deda/669db/1a3c 及更早任务均终态，不重派；全部 root Mix/scan/native exec 已结束，无运行中应用批次。先沿本 job 等待并独立验收 7 例及实际 adapter/主 runloop 边界，再决定新的单批原生取证；callrefs-05 已用尽其单批，不自动重试，B71 仍 doing。

### CP4b 行为快照与确认基础开工（2026-11-02）

- **Contract / Invariant**：VS-00L §16.11、既有 VS-03 BehaviorState；新快照 JSON 往返保留精确生命周期、constraints/resolution，终态不得被非法字段或默认值恢复成开放；旧数据不回填事实，兼容 status 不扩枚举。
- **Boundary / Consumer**：novel_domain 的纯 codec，以及既有 TurnResultBuilder/AdoptionWorkflow 消费与测试。无新表/迁移、无第二运行或行为台账，不改权限/active-history 分流。先读 domain mix.exs/同目录并完成编译基线。
- **Proof**：实际 snapshot→JSON→from_map 的七类生命周期及解决细节；原字节引用保留；显式非法/冲突状态不 fallback；旧状态可识别边界和已有消费者回归。局部验证不签当前确认入口或 GUI。
- **Acceptance Driver / Exploration**：后续 AU04 场景由原生外部驱动经过真实确认/拒绝入口验证持久终态、0 调用拒绝与新 run。当前只修现有生产者，不新增作品知识/packet，不加产品验收感知逻辑。
- **审计结论纠偏**：旧 origin_frame_ref 迁移已由 B01 原小节承接且待作者迁移裁决，B71 不私迁旧列或造空 frame。另已读 `TraceWriter.record/4` 与 `attach_behavior/3`：`no_behavior_opened` 只说明不新开行为，不能据此断言它与关闭旧行为冲突；后续优先复用合法裁决/trace 路径，不仅因没有 cancel 枚举就发明新类型。旧取消 reduced TurnResult/持久顺序问题仍真实存在。
- **callrefs-06 新证据**：输入边界返修 `5d9b5e94...` completed，leader 57 Node tests + 真实 Swift core 纯行为/编译独立通过，worker mutation 191/191 killed。新批次 `b71-first-consumer-tauri-native-cp4b-callrefs-06` 仍 exit 1，但已明确是 Swift→Node 契约错配：实际 focus 前 frontmost.pid 与目标 PID 7399 一致，AX/post 权限 true，Node 却读取 Swift 未产生的 `activation.frontmost_pid` 而报 not_frontmost。第二缺陷是 result 日志记录了事前 probe 的 activation，丢了实际操作返回。leader `leader-native-probe-wire-probe.mjs` 2/2 红；原批次 0 interactions/AgentRun/ProviderRun、cleanup=[]，未自动重试，不据此调整系统权限。
- **最新活动句柄**：`84c1b007-dfcb-4004-bf42-efdabcf674cf` 修跨语言 probe/result 契约及真实 producer 测试（仅 Node/Swift，不 GUI/Mix）；`3f9ae842-e6cf-4df5-a341-24c30a250730` 实现 §16.11 行为快照保真并独占 Mix。5d9b5 及更早任务均终态；native exec 44978 已结束失败。先沿两个现有 job 等待、验收，不重派，不并行启动新 native。
- **跨语言边界收口**：84c1b007 已 completed；Swift 的真实 `probeEvidence/operationEvidence` producer 经纯 seam 输出 JSON 后由 Node 消费。观测只认实际 top-level `frontmost`，不再读不存在的 `activation.frontmost_pid`；result 证据保留实际操作返回。leader 独立 **69/69**（含 7 条边界、2 条真实形状回归及 Swift seam）通过；worker 全 Node 609、mutation 204 killed。旧 leader7 的手造 facts 字段曾与真实 producer 不符，只迁移了该 fixture 一行，断言未放宽；leader 已复核。未签新 GUI，05/06 旧证据未改。
- **行为 codec 首轮审查**：3f9ae842 已 completed；实际 summary/JSON/from_map 与现有 TurnResultBuilder/AdoptionWorkflow 已接完整 lifecycle/constraints/resolution。leader 独立七态 JSON 正例通过，但 `leader-behavior-codec-boundary-probe.exs` 3 例 / 2 失败：resolution/ref 冲突被忽略、纯空白 behavior_id 被接受。未将 codec 标为收口；返修只处理统一边界，不改变状态策略或旧记录。
- **最新唯一活动句柄**：`c467f300-ca3a-4c25-ad5e-e5a3ee994c38`（`b71-behavior-codec-reference-review-v1`）独占 Mix，处理上述两个 codec 边界。84c1b007/3f9ae842 均终态，不重派；无运行中 native。完成并独立验收后才创建下一批原生取证；B71 仍 doing。
- **引用三态复审**：c467f300 completed，leader 原 3 例和既有消费者目标已通过；补充 `leader-behavior-reference-presence-probe.exs` 的完整 JSON 矩阵仍 exit 2（内层 ref 非空、外层显式 null 被接受）。问题是 boundary helper 将 absent/null 过早归并，不是又一个特殊值缺 if。当前返修 `4288b3d6-bd5c-491c-b86e-5b53a7a71590` 独占 Mix，按 absent/null/value 三态解析后统一验证；禁止改矩阵或放松断言。callrefs-07 已预注册但未启动，须待本轮验收、源码静止后执行。
- **当前收口事实**：4288b3d6 completed；leader 原 3 例与完整 presence 矩阵均 exit 0，worker domain 441 / application 消费者 50 通过，未改兼容枚举/旧记录。随后新原生 `b71-first-consumer-tauri-native-cp4b-callrefs-07` exit 0、**19/19**：真实窗口完成全章请求，3 ProviderRun/3 配对请求响应/3 consumed calls 与私有 canonical 同源，2 次探索（offset 0/6000），保持 bounded；12 条输入事件、0 拒绝，全部为本批 PID 44836，真实 activation requested/returned/confirmed 已落证。leader 已看最终截图、checks 与 cleanup=[]。这是确定性首消费者闭环，不签修订/确认或实模；05/06 失败证据保留。

### CP4b 新修订真实页面开工检查

- **Contract / Invariant**：VS-00L §16.7–16.10、VS-00E CP3、UI 46 §9.8；质量卡动作创建新 bounded run，协议纠错共享两次调用上限，原稿保留、局部范围外字节不变、无自动采纳；Source/child、真实 pcall/response、receipt 与 Why 精确绑定。
- **Boundary / Consumer**：先补 test/support SliceVerify 的合法局部修订响应及仅测试环境的首轮非法响应模式；通过现有 Application/Gateway/NativeToolExchange 实际消费者验证。外部 native driver 从真实档案章节生成草稿，再点击真实质量卡，不在产品增加 hook/数据修补或验收分支。
- **Proof**：首轮 invalid_items 的原响应与 failed validation 保留，第二轮通过且恰 2 个真实 pcall；非 finding 范围的原文原字节保留。然后 native 关联源运行与新修订运行、候选/回执/私有历史、Why 窗口零调用和 canon 快照；不能用旧 browser p1 或首消费者 summary 代签。
- **Acceptance Driver / Exploration**：复用已验证的 NativeScenarioHarness、现有 `seed_p1_prose_revision_candidate.exs`（只种已采纳章节计划）及 B71 私有历史/调用/canon 证据模块。场景注册 `b71-authoring-revision`，原始来源也从页面生成；随后另覆盖对话 pending revision，二者仍属完整 B71。不新增作品知识/packet，模型材料仍来自已授权原稿/质量发现和当前投影。
- **最新活动任务**：`394b7072-9637-4c48-befd-38e7aa1a1d71` 实现 test/support 的合法局部修订与首轮 invalid_items / 第二轮通过 fixture，并独占 Mix；`5155bc1e-e234-4f83-862a-c80326962b93` 实现新 native driver/verifier 与运行注册，仅 Node/脚本，不 Mix/GUI。两者均不启动真实批次，不重派旧任务。callrefs-07 已完成并清理，当前没有 native 进程；待两个交付验收后再预注册质量修订原生批次。

### 当前完整范围复核（非缩范围）

| 尚未闭环项 | 当前可核事实 / 必须补的证据 |
|---|---|
| 质量卡与对话 pending revision | 新质量卡 native 实现进行中；还要独立完成对话修订场景，不能用首消费者 19/19 或旧 browser P1 代签。 |
| 工具确认/拒绝 | 既有入口仍为旧同步确认链；需持久行为事实读取、同一行为原子消费、新确认 run、真实来源与完整结果/trace，并以原生页面验证拒绝 0 调用。 |
| 实际模型能力 / 原生工具流式 | 当前 `RequestIR.Operation` 仍默认把 required capabilities 全置 true；Gateway 能力查询只看默认 provider descriptor。必须改为实际选定 route/model 的可证声明，并验证工具调用 SSE、usage 与取消。 |
| Responses 实际路由 | 当前 `/responses` 未接生产 adapter；只有 IR 的 ResponsesAPI 投影及相关 golden。`OpenAICompatible.endpoint_url` 仍固定 `/chat/completions`，投影测试不能代签真实传输。 |
| 显式压缩与恢复入口 | 当前 `compact_transcript` 只有 application service/server 命令，web/frontend 无消费者。须接明确产品边界并以真实页面证明压缩范围/原字节回查；durable 自动执行恢复仍须单列验证。 |
| 实模与最终收口 | CP3b/CP4b-2 的真实模型资源窗口、行为、缓存/usage，CP5 旧 facade/协议退役及最终全部门禁仍开放。B01 旧来源列迁移仍回原任务待裁决，不在 B71 私迁。 |

以上来自当前代码与既有 contract 的逐项复核；不是新的完成标准，也不把局部机制绿当完整 B71 完成。

### CP4b 质量修订交付复审（2026-11-02）

- 原 fixture `394b7072-9637-4c48-befd-38e7aa1a1d71` 与原生工具 `5155bc1e-e234-4f83-862a-c80326962b93` 均已 completed；桥已核验正常、原任务无排队，无重复派原活。fixture 已经 leader 独立 4/4 复验，额外断言 child 终态私有 canonical 落库、pcall/prun 与内存及 consumed count 一致（`leader-quality-fixture-persistence-review.log`）。探针初始缺既有 helper 的装配失败独立保留，未计作产品缺陷。
- 原生工具尚未接受：worker 本轮 Node 609、runner 18 通过，但 mutation 为 269 killed / 143 survived。leader 的真实 source producer + topic/time 反例 **5/5 红**（`leader-quality-driver-boundary-red.log`）：实际 `WorkspaceChat.onDraftChapter` 命令有“请根据已采纳章节计划生成”前缀；author_action/广播若只按 run/ref 匹配，会误接其它频道或动作前消息。
- 当前返修 `90c66ed0-fee0-46a8-8afc-28d2baa99d8a` 仅改 Node 工具：把请求身份/回复匹配收归 `scenario_evidence` 单一边界，driver 与 verifier 同用真实 producer 形状和 owning topic/time；禁止改产品、fixture、leader 探针或运行 GUI/Mix。
- 并行门禁 `8fc39a4d-d819-4f42-ad01-64fff4074d32` 为唯一 Mix owner，仅运行完整后端 compile/test/xref/arch/I3/I1/I2，不改源码，不运行 Node/前端/原生。两任务都沿现有 job wait 收取，不重复派活。
- leader 继续发现三个独立验收缺口，`leader-quality-artifact-producer-probe.mjs` **3/3 红**：真实 finding 的 quote 不带换行但原文保留换行，应按已给的句位核验范围外原字节；多 item 时只比第一项会漏掉第二项篡改；v2 receipt 缺 run/receipt 身份仍被判通过。待当前返修终态后统一交回，不让两个 writer 并发改同一 helper。另需核对 source 侧实际 pcall/prun/response 完整 join，目前仅 child 做完整 join，source 只读 ProviderRun 引用。
- 后续证据复审扩展至 **5/5 红**（`leader-quality-artifact-producer-expanded-red.log`）：新增显式 artifact 引用错误却回退到其它候选、第二请求 assistant tool_call 参数被改写仍通过两项反例。来源真实入口已静态追通：`WorkspaceChat.onDraftChapter` → `user_message` → 判断循环 → prose profile，不能省掉源判断调用的证据。
- 已预注册但**未启动**新批次 `cp4b-quality-01`（`artifacts/b71-resume/quality-revision-native-preregistration-01.json`）：单批、零自动重试、仅隔离测试库/精确 app PID/fixture，child 恰 2 调用、source 全部实际调用 join、Why 0 调用。须先完成两组共 10 条 leader 反例、source 侧 join 与相应门禁，且 Mix/源码静止；callrefs-07 仍仅代表首消费者 19/19，B71 继续 doing。
- **完整后端门禁复核**：`8fc39a4d-d819-4f42-ad01-64fff4074d32` 已 completed。leader 直接核对 `quality-revision-backend-gate/` 中七个 `.exit` 均为 0、九个 app 的测试行合计 **2864 / 0 failures**（foundation 96/common 73/agent 458/test 1/domain 441/persistence 378/application 1248/web 168/e2e 1）；xref 无环、arch 通过、I3 3/3、I1 4/4、I2 3 pairs/0 violations。compile 为增量 warnings-as-errors，默认 integration/real_llm tags 未跑。该证据不替代当前 Node/真实页面/实模/统一静态扫描。
- **当前 Mix owner**：`a2878000-190d-4a19-bfe7-3009b5260e73` 仅在 `artifacts/b71-resume/quality-revision-producer/` 构造隔离 Channel probe，真实 source user_message → 作者动作 child，导出实际消息、finding、canonical、receipt 和 ProviderRun/日志给跨语言验收复核；禁止改产品/fixture/Node、禁止 GUI 和真实模型。Node 返修仍为 `90c66ed0-fee0-46a8-8afc-28d2baa99d8a`。此 probe 是局部 producer 取证，不能包装为外部页面验收。
- **Channel producer 取证已终态**：a2878000 completed、最终 1 test/0 failures、43 项 producer 检查通过，Mix 已释放。真实输入从 seed 后的 TOC title/summary 按 `StructurePanel`/`WorkspaceChat` 模板构造，source ACK 为 judgment_loop，最终为 prose profile；source 输入 turn 与结果 turn 不同，child parent 绑定后者。source **5 calls（3 planner/writer/evaluator）**、child **2 calls**，真实 finding 的无换行 quote 与原文换行差异确认。leader 直接读取 `raw-source-child.json`，独立核对 7 个私有 assistant refs/ProviderRun/同次响应/consumed 对齐、receipt/source/child 归属、重试严格前缀、原稿及范围外字节，exit 0（`leader-quality-producer-pair-review.log`）。两次初始 probe 装配错误在 worker 报告单列，不计产品红灯。
- **下一复审输入**：`leader-quality-captured-producer-probe.mjs` 已准备，直接消费上述原始 JSON 的 retry/artifact 产物；待 Node 返修终态、变异恢复后运行，不在源码变异过程中取测试结论。现仅 Node job90c66ed0 仍运行；无 Mix/native owner。真实页面批次仍未启动。
- **Node 返修终态复验**：90c66ed0 于 1800 秒 timed_out（桥附 exit 0 不代表 completed）。leader 通过只读进程检查确认无残留 worker 测试/变异/Mix，再复跑 source/topic/time **5/5 通过**。原生及全部 Node tests 合计 673，沙箱首跑 671 通过/2 条 WS listen EPERM；仅该代理文件在本机回环端口补验 **7/7**，未改测试/规则。`scenario_evidence` 共享请求身份已落地，driver 与 verifier 均消费 owning topic/time。变异快照归档 `driver-boundary-review-metrics/`：共享边界 180 killed/0、纯判据 384 killed/0，run collector 48 killed/19 survived，门禁未完成。
- **剩余具体失败**：`leader-quality-artifact-producer-probe.mjs` + `leader-quality-captured-producer-probe.mjs` 共 **7 tests，2 pass / 5 fail**（`leader-quality-artifact-captured-review.log`）。显式 artifact 错引用反例已通过；仍失败的是句位对应换行原文、多 item 完整字节比对、v2 receipt 缺身份、重试 assistant tool_call 原字节篡改，以及实际 Channel 产物的范围外字节正例。原生 source 仍缺完整逐调用 join。后续只修这些语义缺口/剩余变异，不整包重派原任务；新变异可使用工具默认 `--since-last-run` 保留未变函数已杀结果，禁止用新目录/清缓存掩盖存活项。
- **最新唯一活动任务**：`7f03b108-4ee4-4868-ab77-58c7101979b4`（`b71-quality-revision-producer-fidelity-review-v1`）处理上述四类根因、实际产物正例、source 完整 join 及剩余质量门；仅 Node/测试，不 Mix/GUI/产品变更。同步派发正在等待，沿该 job 收取，不重复派原 job。90c66ed0 已 timed_out、a2878000 已 completed，当前无 Mix/native；待本次验收后才能执行预注册 cp4b-quality-01。
- **source 请求前缀补验**：leader 从已捕获的真实 Channel 请求逐对验证 **5→8→11→14→17** 条消息，每个后续请求精确保留上一请求前缀，只追加 assistant/tool/当前范围；source writer 响应全部 item 的 id/title/body/rationale 与源候选原字节一致，exit 0（`leader-quality-source-prefix-review.log`）。这仍是 ChannelTest/fixture 证据，不代签真实页面或实模。
- **并行只读准备**：`bf75b1be-7ae4-4ad4-9714-54853edb235d` 只审计下一项对话 pending revision 的真实入口、身份、fixture、已有场景和 native 证据复用差异，仅写审计产物；不改源码，不跑 Mix/Node/GUI。唯一源码 writer 仍为7f03b108，原生批次仍等待其交付验收。
- **产物保真返修已交付、门禁未清零**：7f03b108 completed；leader 独立复跑原 **12/12 探针 + 75/75 正式目标测试** 通过，source/child 已各自完整 join，检查/measured 前缀分开；完整 item、v2 receipt、原生 retry tool_call 与真实 producer 正例通过。worker 全 Node 685/685、CRAP max9；mutation evidence 466 killed/17 survived、collector53/6，Dryer 不支持 mjs，不签门禁完成（`worker-quality-revision-producer-fidelity-report.md`）。
- **新增范围边界真实红灯**：leader 复审发现 `sentenceBounds` 把选中句子前的换行/缩进纳入 selected 范围，删除它们会被误判通过；`leader-quality-span-boundary-probe.mjs` **2/2 红**，日志 `leader-quality-span-boundary-red.log`。返修只处理句位→原文区间的唯一边界与剩余可达/冗余 mutation，不增加逐例特判；当前 Node writer `9d0976e4-e5b0-41c1-8b8f-3ad34d889f0e`（`b71-quality-revision-span-boundary-quality-closure-v1`），同步等待中，禁止重复派活。新原生批次仍未启动。
- **pending 审计纠偏已接受**：bf75b1be completed；leader 对源码/单测复核后由 `41b18a89-a83e-4c97-9f39-f44eda37e77f` 修正报告（原版另存 initial）。一次新修订 user_message 开启自己的新 run，内部 judgment→writer 同 run；不能把“单测只 start 一次”推成跨作者输入共用 run。新 TurnResult 只含修订稿，原稿/修订稿通过同 work/session 的投影共存，不能要求它们同属一个 TurnResult。单测自建 Execution 的3次不冒充实际 Gateway 数量。
- **当前唯一 Mix owner**：`b9cabf04-67d1-44ad-bc56-c18b0d6165e4`（`b71-pending-dialogue-real-channel-producer-capture-v1`）仅在 `artifacts/b71-resume/pending-dialogue-producer/` 用既有 Q1B 两条输入和现有 SliceVerify 作真实 Channel→Gateway→私有历史/投影取证，不改产品/fixture/工具。与 Node writer9d0976e4 并行；原生运行须等两个现有任务释放并验收后再启动。
- **范围与质量门局部接受**：9d0976e4 completed。leader 在同一探针另加“范围外重复原句必须允许”“选中段可保留原句并补充细节”两反例，揭示全篇 substring 禁止原句的错误前提；worker 统一修正为选区外字节保留与正文确有变化，未加逐例特判。leader 独立复验 **101/101（16 probe + 85 正式）**，并核 `.metrics` 为 evidence462/462、collector53/53，全 killed/0 survived；worker全Node695/695，CRAP max9，Dryer不支持mjs仍如实保留。证据 `leader-quality-span-closure-accepted.log` / `worker-quality-revision-span-closure-report.md`。
- **pending 取证失败与分类纠偏**：b9cabf04 completed，最终 probe exit2，`pending-dialogue-producer/raw-source-revision.json` 保存完整失败。现役 SliceVerify 把作者登记原文误路由为 character_design（2 calls、2候选），随后 revise_pending_artifact 返回空 target，两次 planner 后失败；没有 writer/新修订候选/canon写入，正确拒错。**不能把全部结果都归 fixture limitation**：leader 独立读取持久快照确认失败 run 消耗2 calls、有2 ProviderRun/同次响应，却 `authoring_transcript=null`（`leader-pending-failure-history-review.log`）。这违反 §16.8 已收到历史不得丢弃；`JudgmentProtocol.correct_or_reject` 终局丢 transcript、`judgment_step` 仅透传二元 error 的路径已静态核实，须单独修复并保留失败校验/pcall/prun；不能靠修好fixture掩盖它。
- **真实质量批次01**：`cp4b-quality-01`（root session68650/pid71647）终态 exit1、51.65s。真正Tauri已打开并激活目标PID72812；公共 `run()` 和 `driveRevision()` 重复写 `b71-start.json`，不可覆盖守卫在业务操作前拒绝。leader看截图、原始failure/cleanup：0 user_message/author_action/TurnResult，DB AgentRun/ProviderRun/Interaction均0，cleanup.remaining=[]。旧证据只读保留，不重跑覆盖。
- **起始基线单一owner修复**：ed5c9a64-6422-4e50-81e0-d638ba1c025b completed，仅删 `driveRevision()` 重复capture块，公共run保留唯一start，未加if-exists/skip/overwrite。leader读关键代码并独立node --check通过，worker相关111 tests通过。真实01失败作为red，新批次作为green验收，不写源码字符串镜像测试。
- **当前原生/Mix owner**：root 正执行已预注册新批 `cp4b-quality-02`（session5131/pid78486，`quality-revision-native-02-process.json`），单批/零自动重试，端口/进程预检均空闲，源码writer已停止。`e913668a-3a25-4a95-94db-ed935a733388` 仅静态审计判断失败私有历史carrier及消费者，禁止源码/Mix/GUI/liveDB，不影响本批。原生仍待实际结果，不签完成。
- **真实质量批次02终态**：root session5131/pid78486 已 exit1（25.63s），native driver exit0，真实“档案章行生成→质量卡局部修订→独立修订候选→Why”全部操作完成，4张截图；cleanup.remaining=[]。source `run_mvytwd0k_5`、child `run_mvytwdys_22` 均 completed，原稿/修订稿待采纳2，child turn `turn_rev_mvytwdz0_23`。leader已看03修订截图和04 Why文本，并以共享只读join独立复核source5/child2请求响应/ProviderRun/私有canonical/consumed全部对应（`leader-quality-native-02-call-review.json`，两侧各5检查全true）。**批次仍未验收通过**：结果引用 `trace_mvytwdz9_2q`，DB仅有source trace，child DecisionTrace缺失；Why只能退化读摘要。未改旧证据/未覆盖summary/未自动重试。
- **质量修订trace根因与当前执行**：`ProseRevisionService.revision_trace_summary` 的 `{_trace, tool_trace_summary} = TraceWriter.record_with_tool(...)` 丢弃真实trace；flow `revision_result/1`又只保留TurnResult，finalization未提供`decision_trace`，故现有原子提交没有收到它。`b6ccef01-effd-4afb-92e0-452decffaced`（`b71-quality-revision-decision-trace-delivery-v1`）现为唯一源码writer/Mix owner：保留同源trace，经私有stage结果送入既有runtime原子提交，禁止best-effort旁写/造trace/弱化verifier；先真实DB缺trace红测、SQL拒写回滚、Replay零调用，再相关门禁。当前无native，待此交付验收后再预注册下一原生批次。
- **判断终局失败审计已接受**：e913668a completed，报告 `worker-judgment-failure-history-path-audit.md/json`。已定位最终协议拒绝/末次provider错误/降级失败丢当前transcript，末次拒绝未闭合最终call；post-provider业务校验、dispatch错误及prose continuation也要统一接现有私有失败事实边界。已有 `{:error, reason, step_state}` 与 `AuthoringSession.failure_result/inherit_result`、runtime error3 合并/提交链，无须另建carrier或第二canonical。不能把私有history塞入reason（会被日志/纠错文本/作者面消费）。

### CP4b 判断失败历史后续设计（待质量trace任务释放后执行）

- **Contract / Invariant**：消费VS-00L §16.7–16.8；协议失败与传输失败都保留实际收到的前缀、raw args、pcall/prun及计数，末次被拒原生call恰好一次failed validation；无writer/canon、无第三次越预算调用，不伪造没有发生的assistant/tool结果。
- **Boundary / Consumer**：JudgmentProtocol与其两个生产消费者（DialoguePlanningService判断入口、ProseDraftingWithQuality continuation），复用现有AuthoringSession私有事实与AgentRunServer error3/snapshot；不新增错误运行框架、全局缓存、旁路persistence或reason内嵌私有对象。第一个消费者为真实Gateway后的failed bounded run与持久回放。
- **Proof**：两次非法pending ref真实Gateway负例必须从“2 calls但私有历史空”转为2 assistant+2 failed validation、DB refs对应、0 writer/canon；再核首次响应后传输失败、请求构造0调用、后置业务/dispatch失败及continuation，保留新于snapshot的实际会话。reason/公开事件/TurnResult不得泄漏私有payload。成功前缀/计数不改变；正式负例不能靠修好SliceVerify绕过失败链。
- **Acceptance Driver / Exploration**：现有pending Channel负例先复证失败历史，再补对话修订native入口；质量原生02不能代签此失败路径。该修复不增加作品知识或固定packet，Base/观察原来源和原字节不改变，产品验收感知为no。完整pending UI、确认、能力/流式/Responses、压缩恢复、实模和CP5均继续开放。

### CP4b 真实trace闭合与设计态验收纠偏（2026-11-02）

- b6ccef01 completed：保留同一次TraceWriter产出的DecisionTrace，经private revision_result送到finalization的decision_trace，由既有runtime与Interaction/run原子提交；没有新增persister或修改公共事务。worker application1250/0、相关门禁与I3/I1/I2通过。leader独立修订+Replay20项、结果提交11项均通过（`leader-quality-trace-delivery-review.log`、`leader-quality-trace-atomic-review.log`）。首命令误写一个不存在的提交测试路径，实际只执行前两文件20项；已核实路径并单独补跑11项，未把缺失测试计作通过。
- 新原生 `cp4b-quality-03`（root session39277/pid3160）终态exit1、25.94s；driver完整完成4截图，cleanup.remaining=[]。child真实trace已能按trace_id+turn_id读取，Why出现“已从持久 trace 生成结构化回放/回放只读取已保存记录，不会重新调用模型”；最终仅两条断言失败：`canon_unchanged_except_action_receipt`、`why_panel_is_author_safe`。旧批次不改写，不以局部结果签完成。
- **两项验收假设纠偏**：Why的额外“.includes(修订)”不是UI contract/TRACE文案要求；03已是真实持久回放，02仍只有fallback摘要。`chapters`变化经完整起始hash反事实诊断证明仅目标第2章新增 `plan_direction.chapter_mission` 与其updated_at，其余全字段字节不变（`leader-quality-native-03-chapter-delta-review.json`）。VS-00E §16.8 用户已拍板“推理完成即存暂定”，model/TENTATIVE使命是设计态、非canon，不能按整张章表hash直接判越权，也不能忽略整列/整表来放行。
- **验收证据重构设计**：保留完整表hash，增加版本化章设计态前后见证，保护其余所有字段；新增source完成后、author_action前的before-revision快照。start→before-revision逐项核验source合法使命（目标章、同run真实pcall/prun、当前operation提供的basis refs、同次模型字段、应用派生身份与时间、作者版保护）；before-revision→final严格不变，仅允许已绑定action receipt与合法引用统计。source/child两段合起来覆盖完整场景，不缩小范围、不写waiver。旧v1缺见证不能补造允许；新版缺/坏/歧义证据关闭。Why保留scoped child HTTP/真实trace/零Provider/安全文案强条件，去除无契约依据的词汇要求。
- **当前两个执行任务**：`e26cc0fb-bb2e-4131-a432-295cf2185800`（`b71-native-design-state-evidence-v1`）仅Node证据模型/driver/相关scenario与pure测试；`06412e71-e06e-43ee-b104-580ec6f542a5`（`b71-judgment-failure-canonical-delivery-v1`）是唯一Mix owner，按上节设计统一判断失败私有事实传递及两个生产消费者。两者文件边界隔离；为避免ROOT生产fingerprint在后端写入期间变化，Node worker不跑native_b71_test/全Node/原生，待两writer终态后由leader跑集成门。当前无native，先沿现有job等待，不重复派活。
- **两任务已交付**：06412e71 completed，统一已开始交换的error3私有事实，末次被拒调用闭合，两个生产consumer传递会话，worker目标130/application1259与门禁/I3/I1/I2通过；e26cc0fb completed，snapshot v2/章设计态/两段比较/Why文案边界已落，pure338通过，mutation仍817 killed/100 survived/48 uncovered，不签全绿。leader待两writer停止后独立执行完整Node **733/733**（`leader-design-state-node-integration.log`）。
- **真实失败历史独立复验通过**：新证据目录 `artifacts/b71-resume/pending-failure-history-review/` 复用原Channel采集装配而不修改旧raw，仅改变本次负例断言目标。实际失败run `run_mvyxrxlt_11` 的2调用、2assistant、2failed validation、原始参数/id、pcall/prun/ProviderRun、work/session/parent归属通过；0writer/canon/receipt，原候选不变，作者结果无private keys。raw的成功修订状态仍为fixture_limitation，不将其改签成功。组合命令3tests/1failure，唯一失败见下一条（`leader-judgment-failure-independent.log`）。
- **失败事实别名新红灯**：`leader-judgment-failure-carrier-probe.exs` flat正例通过、nested error3反例失败：inner `stage_state.judgment_transcript` 已是newest，`inherit_failure`又补flat older，runtime按既有合并顺序反向覆盖。需在共享边界统一flat/nested两种已有载体，私有canonical只保留一个有效归属，明确处理nil/冲突，不能把private塞reason。
- **使命真实producer复审未过**：`leader-mission-producer-shape-probe.mjs` 直接消费03的真实join/canonical/LLM/event/DB，pure predicate基线被误拒：新`recordForCall`要求日志不存在的`agent_run_id`，正式fixture自造该字段。其余负例已登记为实际request材料删除、pcall/prun错对、成功使命从设计态消失、同ref标签冲突；先修真实positive基线，再逐项验负例。诊断probe不重签旧v1批次；旧03无before-revision/v2见证的事实保留。
- **当前返修句柄**：`7ab8ecef-a3a7-43d6-b4ea-665c23fafc15`（error-carrier shape review）唯一Mix owner，只改AuthoringSession共享失败边界/正式tests；`a46a5256-9a3e-4f33-b185-139c417e57ce`（design-state real-producer review）只改Node使命关联/材料证据与质量门。二者均沿现有job等待；全Node/fingerprint/native门等双方终态后由leader复验，当前无native。
- **失败事实边界局部接受**：7ab8ecef completed；flat/nested两种载体收归唯一flat canonical，nil不盖有效会话，冲突用固定安全reason拒绝，其他nested业务字段/实际计数保留。worker正式targets146/application1264及门禁/I3/I1/I2通过。leader读关键代码并独立复跑carrier +真实Channel负例 **3/3**（`leader-error-carrier-final-review.log`），失败run `run_mvyzaafz_11` 保留2次真实响应/2failed校验与作用域/计数；未改fixture掩盖失败。Mix已释放。
- **原生04预注册**：`quality-revision-native-preregistration-04.json` 已准备但未启动，目标为v2设计态/before-revision两段完整原生证据；仍单批/零自动重试。旧03仅保留其失败与真实trace/Why证据，不重签为新版通过。当前唯一运行任务为Node a46a5256，沿现有句柄等待，交付并独立验收后再启动04；全静态扫描仍须在本组源码静止后更新。
- **真实使命证据复审通过**：a46a5256 completed；去除phantom日志字段，按同次pcall+prun/真实scope关联，并把实际请求scope投影、版本、材料区与canonical绑定；冲突label拒绝，已成功派生使命不能因before==after而跳过落点核验。leader真实产物探针 **5/5**、源码静止后的完整Node+当前LCOV **743/743**（`leader-mission-producer-shape-green.log`、`leader-design-state-full-coverage.log`）；五个目标模块CRAP gate exit0。mutation剩余项尚须用完整测试集重核，未据pure通过签质量门。
- **真实Tauri质量修订原生04接受**：`cp4b-quality-04`（root session1271/pid5472）exit0、27.77s，**64/64**，driver=ax-native-system-ui/provider=slice_verify/surface=tauri；leader读summary/checks并看持久Why截图，cleanup.remaining=[]。source `run_mvyzpmaq_5` 为5实际调用/5配对/5consumed，child `run_mvyzpnau_22` 为2/2/2；首轮invalid_items→末轮passed，原稿/修订稿独立待采纳，全部item原字节匹配，child真实trace与Interaction/run提交，Why窗口0调用。source使命绑定真实pcall/prun与9个已供refs，合法丢弃1个未供basis；source仅目标章model/TENTATIVE设计态变化，引用增量2/日志2；revision段章/canon不变、receipt新增1、引用增量0。证据目录 `artifacts/slice-verify/b71-authoring-revision-tauri-native-cp4b-quality-04/`。这是确定性质量卡修订场景闭环，不是实模或完整B71 done。
- **本组剩余质量门**：需用当前完整测试集/LCOV刷新增量mutation并执行统一full static scan，准确保留既有gitleaks处置与新结果；未修改baseline/dispositions。原生04通过只满足本质量修订UI证据，pending对话修订fixture/原生入口、工具确认、实际能力/流式/Responses、压缩恢复、实模与CP5继续开放。
- **当前唯一质量/Mix owner**：`461a8623-03fd-4ce1-b470-1b2693369111`（`b71-quality04-mutation-and-full-static-gates-v1`）只运行门禁、不改源码：先用包含native_b71_test的完整测试集刷新增量mutation，再在.metrics稳定后生成指向04真实summary的当前manifest，执行 `bash scripts/ai_static_scan.sh --top 10`，归档到 `artifacts/b71-resume/quality04-gate/`。扫描阶段冻结tracked文件，避免自造manifest stale；无并行源码writer/native，结果与剩余Top10待独立复核。
- **完整质量门已取证但未全绿**：461a8623 completed。完整mutation（含native集成测试）为1017 killed/66 survived/4 uncovered，exit3，逐项清单 `quality04-gate/mutation-report.md`；CRAP全部<10，Dryer不支持mjs。full scan命令 `bash scripts/ai_static_scan.sh --top 10` exit1、18pass/2fail/0skip，归档 `quality04-gate/static-scan/`。Top10实际5项且touched=0/blocking=0：B65握手nonce、B63文档spec标识、E2E spec标识、Pencil fileToken均为已有false_positive；ProjectGod历史凭证为已有accepted_risk。未改baseline/dispositions、未重写历史。
- **Semgrep环境失败已单项复验**：worker规则扫描0findings，但version check写用户cache被沙箱拒绝；leader从本机Semgrep1.157.0源码核实`SEMGREP_VERSION_CACHE_PATH`并指定任务目录。沙箱启动另报系统证书库empty trust anchors；本机权限同命令复验exit0、514rules/2259targets/0findings（`quality04-gate/semgrep-host-review.log`、`semgrep-host-result.json`）。保留27条解析warning（15 Other syntax error/12 PartialParsing）；新B71模块确在scanned列表，相关touched YAML经PyYAML解析230场景、shell经bash -n通过。未安装/改证书/全局配置。旧full report仍18/2，不手改成19/1；后续源码收口后须带任务局部version cache重跑完整入口。
- **源码指纹覆盖补查**：现`productionFingerprint()`只枚举git tracked，未覆盖B71未跟踪的新生产模块；04运行期间无其他writer，原64/64和实际页面证据保留，但自动化全源码覆盖仍需补齐并新批次取证。修复需包含tracked+untracked（遵循gitignore），保持productPath只限frontend/src、src-tauri/src与apps/*/lib；不纳入test/support/artifacts，不更改真实repo git状态。
- **当前两个执行任务**：`782eea8f-f38b-46d7-8a75-79c4ce4ae4ca`（native evidence quality closure v2）只改Node证据/正式测试，收66存活与4未覆盖并补全指纹；`370bd3cf-66d4-414d-b033-ea6e72176d9a`（pending fixture native boundary）唯一Mix owner，只改test/support和正式测试，修明确登记操作优先级与当前候选目录读取，保留显式非法ref失败历史测试。两者均不改apps/*/lib/frontend生产源，Node生产指纹稳定；无native，待现有任务交付后复验与刷新完整扫描。

### CP4b pending对话fixture实施七问（2026-11-02）

- **Contract / Invariant**：VS-00L §16.7–16.8与既有Q1B作者原文/候选生命周期契约；原文登记保留合法作者原字节，目标必须来自本次实际供给且唯一、权限可用；两消息新run、修订内部同canonical、两稿待采纳、0canon；坏响应的2call失败历史回归不能因fixture修好而消失。
- **Boundary / Consumer**：仅test/support统一作者意图/原生目录解析及其正式tests；不得向产品追加旧JSON packet、改作者原输入、偷读DB/未给模型的ctx或加production hook。现有SliceVerify→Gateway→真实Channel是第一消费者。
- **Proof**：保持原Q1B两条消息，真实Gateway与私有落库/逐call对应；明确操作优先于内容里的角色名词，title/preview/operations来自真实目录；多目标歧义问作者，不发null-ref或first/latest执行。正常与故障注入隔离，formal非法ref路径仍验证末次闭合/0writer/0canon/无第三次。
- **Acceptance Driver / Exploration**：新的 `pending-dialogue-producer-v2/` 仅局部Channel证据，后续须独立native对话修订场景，不借质量卡04代签；不新增作品知识/packet，fixture只读模型真实拿到的当前scope，旧格式支持必须明确、不按全历史关键词猜。
- **v2 正向producer局部复核**：370bd3cf completed，source已为register_author_content/current→合法作者原文字节物化，revision从实际baseline改名，正式非法ref负例改为仅test-support env+标记显式注入，历史probe/raw未修改。worker provider86/agent470/application1264及门禁/I3/I1/I2通过；leader直接核v2原始数据：source1、revision2，私有canonical/ProviderRun/同次日志逐pair一致，新run分别绑定各自作者输入；原稿字节等于原作者消息、revision_of精确指原稿、仅沈砚→林渡且nonce保留、2 pending/0 resolved/0canon/0receipt，见`leader-pending-v2-producer-review.log`。这仅为Channel正常路径，不签fixture整体/原生。
- **当前scope边界仍有真实红灯**：leader `leader-pending-input-scope-probe.exs` **4/4 red**（`leader-pending-input-scope-red.log`）：normalize先扁平完整历史、目录读取第一段，真SliceVerify consumer也发as_old；最新scope为空会复活旧候选；作者正文中的任意pending JSON被当状态。需保留结构直到确定当前operation，旧scope不可补回，旧JSON只取明确应用状态section，且真实consumer不得提前丢结构。不能仅将first改last。
- **当前任务句柄**：Node质量/未跟踪生产指纹任务 `782eea8f-f38b-46d7-8a75-79c4ce4ae4ca` 在900s观察超时后仍被bridge确认running，不重启；新的具体fixture返修 `ac20cc26-766b-4121-bf2b-20759bb143d5` 为唯一Mix owner，仅修test-support输入边界/正式tests，并在新v3目录复证正常Channel。当前无native。
- **pending后续native范围不缩小**：首个对话修订实现步消费既有Q1B两消息与G4候选契约，需真实输入、两run/原稿修订稿投影、逐调用与Why。VS-00L G5仍要求真实作者采纳/拒绝后，新授权边界和后续请求包含正确采纳结果refs/权威状态，并验证恢复；不能用两消息tentative共存或质量卡04代签作者采纳/拒绝/G5及完整CP4b。

- **重连后原任务核验（2026-11-02）**：bridge v2.1.0/dsh可用，核验时0 active/0 queued；782eea8f为1800s timed_out，ac20cc26已completed，未重复派发旧任务。782虽无终态MD，其JSON/765全Node日志与6份mutation快照一致；leader独立40/40、逐snapshot合计1208 killed/0 survived/0 uncovered通过（`leader-native-evidence-final-review.log`、`leader-node-quality-snapshot-review.json`）。Dryer对mjs不支持，不宣称重复度门禁已覆盖；新全静态扫描仍待源码静止后重跑。
- **pending当前scope复验与遗漏**：ac20的原4条独立probe已4/4通过（`leader-pending-input-scope-final-review.log`），v3 Channel raw经leader逐pair/真实run与Interaction/author与writer字节/lineage/两稿投影独立核验通过（`leader-pending-v3-producer-review.log`）；只是局部证据。新增 `leader-pending-scope-state-section-probe.exs` 2/2有效红：native scope资料原文中的facts-shaped JSON被无条件legacy fallback当候选，即使当前pending0仍执行as_quoted。需在唯一来源边界区分native明确状态section与无scope旧格式，不重复全历史文本扫描。
- **当前唯一执行句柄**：`28816771-d52e-467f-b841-87c15358e12d`（`b71-pending-native-state-section-review-v1`）为上述终态交付的明确返修，不是旧活重派；唯一Mix owner，仅test/support与正式测试。leader准备`quality-revision-native-preregistration-05.json`，等返修交付及6独立反例通过后再启动新原生05，覆盖新指纹中的untracked生产模块；旧04只读保留。不并行启动native/fullscan。

- **pending状态来源边界返修接受**：28816771 completed；native缺明确状态段时不再扫描资料中的裸JSON，仅无scope旧请求保留作者段前兼容。leader6/6独立反例绿，worker provider380/application91及编译/format/credo/xref/arch/I3/I1/I2通过；只修改测试支持与正式测试，未签pending UI。
- **原生05真实失败**：`cp4b-quality-05` root session53772/pid83540，exit1/45.98s；driver0完成4截图，runner1只拒绝`source_native_call_success_matches_canonical`。source5/5同次配对、child与UI操作完成；source `run_mvz3m9vo_4` 的使命调用 `pcall_mvz3ma5e_10` / `prun_mvz3ma5e_11` 日志成功/私有canonical存在/ProviderOutput=ok，但ProviderRun.status=running。数据库final_output seq8于10:10:57.125483Z落库，较早chunk seq5在10:10:57.126612Z落库且run更新为running。cleanup.remaining=[]；旧批次保持失败，不自动重试。诊断`leader-quality-native-05-call-diagnostic.json`。

### CP4b Provider 事实提交重构七问（2026-11-02）

- **Contract**：VS-00L §16.9、§16.12，既有ProviderRun/Event/Output；不改模型协议或新增运行台账。
- **Invariant**：同次真实调用身份固定；事实事务提交先于进展发布；事件幂等且终态不被晚到旧快照回滚；错误不伪造成功或重发Provider。
- **Boundary**：仅application ProviderActivityProjector与persistence ProviderRunLog及正式tests，必要纯helper在既有app内并登记README。agent/common/domain/web/frontend、schema/migration/依赖不改；leader已读两app mix.exs/现有代码并完成mix compile基线。
- **Consumer**：现有stage sink、ProviderActivityService、B71真实原生逐call核验共同消费同一持久事实，无旁路补状态。
- **Proof**：leader `leader-provider-fact-order-probe.exs` 两条2/2有效红：终态→晚到chunk变running；stage发布时DB尚无该run。正式补乱序/重复/冲突归属/失败取消/事务回滚与发布可读，应用/持久层回归和全门禁。原05的真实event时间支持竞态，但测试不靠sleep概率复现。
- **Acceptance Driver**：修复验收后另预注册一次native_b71_batch质量修订批次，明确source/child全部实际调用终态和完整页面；旧05不可改/重签。生产验收感知逻辑=no。
- **Exploration**：不新增作品知识或物化要素，沿原authoring/request证据链，不增加Base packet；本重构不改变求证或引用供给。完整B71、pending/G5/确认/流式能力等缺口仍开放；fullscan在此次生产源收口后统一刷新。

- **最新恢复句柄**：`d8363947-8272-4d8c-9f52-788852428d7e`（`b71-provider-fact-ordered-commit-v1`）正在实现§16.12，唯一Mix owner；仅Projector/ProviderRunLog及对应tests/索引。28816771已终态并由leader6/6独立验收。05原生批次已失败结束且精确应用cleanup=[]，无当前native；等d836原job交付后独立验收两红、全量局部门禁，再决定新批次与fullscan，不重复派活。完整B71仍doing。


### CP4b 对话修订与 G5 作者边界原生场景设计（2026-11-02，待实现）

- **Contract / Invariant**：消费VS-00L §16.7–16.9/G4–G5、VS-04与既有Q1B-candidate-lifecycle；两条作者消息分别创建新bounded judgment_loop run，修订内部判断→writer共享canonical。模型只能产候选；作品事实仅由真实作者采纳改变，放弃不触及已保存修订稿。新请求必须由新授权边界和真实持久投影生成，旧tool_call不作为本轮执行历史重放。
- **Boundary / Consumer**：新增外部原生journey `b71-authoring-pending`，复用NativeScenarioHarness、Request/ACK身份边界、私有history、逐pcall/prun与canon快照；不借质量卡receipt/profile/finding规则冒充对话修订。第一消费者为真实WorkspaceChat→WorkspaceChannel→Application→Domain/Agent/Persistence→TurnResult/WorkSession投影。只建空作品/活动会话的seed，不预造候选/运行/结果；产品路径不加验收感知，若真实链发现缺口另立原任务实现步。
- **Proof**：v3现有producer仅证明source1实际调用、revision2实际调用、原作者完整字节、模型响应完整items、原稿/修订稿分属两TurnResult且WorkSession投影并存。实施前在新的独立Channel取证目录追加真实accept/discard入口与边界后消息，读取真实actions/receipts/run/privatehistory/ProviderRun/LLM/持久投影，不手造新run/响应/来源字段；该局部产物用于校准原生判据，不签UI。新增原生判据须涵盖错topic/session/请求ref/多义目标/同item_id字节改变/缺原始请求/残留旧call/错误采纳对象/恢复丢状态负例。
- **Acceptance Driver**：原生AX输入原Q1B原文登记（随机nonce）→输入明确沈砚改林渡、不要保存的修订请求→查看两份候选与修订Why→通过候选可见标题及所属AX结构定位真实保存按钮→保存修订稿→核对原稿仍待采纳→通过原稿可见语义放弃原稿（包含真实确认对话框，如有）→在restore分型步关闭并重启本批精确应用→核对同work/session已恢复，再输入“资料处理进度怎么样？”→核对新run请求中的真实ACCEPTED/DISCARDED refs与当前权限、作者可见回复/Why。不用全局last按钮代替对象绑定，不允许脚本push Channel。采纳与放弃各自前后窗口须0 Provider；边界后提问实际调用另行配对，不硬猜数量。
- **状态与证据分段**：start→revision完成为0canon/0author_action receipt；采纳只增加与模型修订全文对应的CONFIRMED内容及真实receipt，原稿仍TENTATIVE；放弃只处置精确原稿，已保存内容原字节不变；恢复不得产生新候选或Provider调用。关键中间快照分别保存，不能仅用最终hash推导所有阶段。全部实际调用均有同scope/pcall/prun/canonical/request-response与真实预算，source/revision/边界后新run分别审计。
- **Exploration**：不新增专用packet。新请求状态来自既有TurnInteractionService消息处置section、真实候选/已采纳对象目录和可用探索面；以实际request_body证明采纳结果refs/权威状态已进入本轮，不以DB存在或时间顺序代签。若当前最小Base无法提供所需指向，按通用求证原则修对应生产边界，再取证，不能让fixture偷读DB补齐。
- **完整范围**：本场景覆盖原CP4b/G4–G5的一条完整对话候选作者边界，不替代工具确认、显式压缩/执行恢复、实际route能力/流式/Responses、实模窗口和CP5。当前仅设计；没有新的native/pending job，下一执行须先确认Provider事实提交任务终态并释放Mix。

- **有序提交回归复审中**：d836仍running（900s等待到观察上限不代表任务终止，继续同job）；worker日志已记录persistence387/application1268零失败，但application-full另有27条持久化诊断：20 OwnershipError（无Sandbox checkout的DialoguePlanningService纯测试路径）、4固定pcall/prun或step归属冲突、3错误output内容冲突。不能由退出码0签全部事实持久链；错误摘要atom→JSON string是否被误判冲突，leader已准备只读独立`leader-provider-error-replay-probe.exs`，尚未执行，需等Mix owner释放后检验。
- **并行证据脚本准备句柄**：`05bd97ad-c297-48b0-92aa-0b740d83a81e`（`b71-pending-author-boundary-producer-scaffold-v1`）只在新`pending-author-boundary-producer-01/`准备Phoenix.ChannelTest脚本和报告，不运行Mix/SQL/GUI、不改产品；用于source→revision→accept→discard→恢复→新请求的G5实际producer校准。不要把脚本准备误称取证完成。d836仍唯一Mix owner。
- **原生06预注册已备**：`quality-revision-native-preregistration-06.json`，max1/auto_retry0/timeout1800；等待有序提交交付与leader复验，不在worker写生产源时启动。05保持失败，完整fullscan尚未刷新。

- **有序提交首轮未签收**：d836 completed（1169s），原顺序两条leader测试绿；新增`leader-provider-error-replay-probe.exs`经真实JSON DB重放2/2红，合跑4tests/2fail（`leader-provider-fact-order-combined-review.log`）。error_summary.type/provider_event_payload.reason_code保留atom，DB值为string，归并因此误拒同一事实。需要唯一存储边界统一合法持久形态，真冲突仍拒绝。
- **移除测试时序补偿的设计决定**：首轮worker按probe seed调入12次×5ms、错误文本匹配重试；其报告将busy归因Sandbox事务回收但未给生产实证，leader不接受该补偿作为完成实现。已读安装版Exqlite/EctoSqlite源码支持局部`Repo.transaction(..., mode: :immediate)`；临时双连接WAL机制probe证明DEFERRED读后升级可BUSY_SNAPSHOT(517)，IMMEDIATE在读取前取得写权（`leader-sqlite-write-ownership-review.log`），但这不是Ecto产品边界验收。返修须用当前真实消费者验证事务写意图，复用既有busy_timeout；若是测试owner生命周期问题，修测试明确回收，不为测试调生产sleep/retry或新开关。

- **当前唯一Mix owner与待验收脚本**：`a25ddb10-b5f5-4aaa-8fc3-6555a9ce3169`（`b71-provider-fact-json-transaction-review-v1`）进行JSON形态/事务边界返修及相关测试fixture证据修正，d836已终态。`05bd97ad-c297-48b0-92aa-0b740d83a81e`在900s超时终止，但已写`pending-author-boundary-producer-01/probe.exs`及scaffold-report.md/json，报告明确prepared_not_run；leader核对了真实v3 action字段/路径/阶段设计，未运行Mix/数据库，不把超时退出码0当completed。现不重派整包；待a25终态独立验收后读取并运行现有G5probe，真实结果落新目录既定raw文件。native06/全扫描仍未启动，B71继续doing。

- **§16.12返修接受并完成原生06复证**：a25 completed；leader沿原失败seed261964独立4/4通过（`leader-provider-fact-json-final-review.log`），已确认删除手写sleep/retry，持久形态归一且严格冲突比较保留。worker persistence390/application1268、targeted99及门禁通过，应用27条持久诊断归零。Ecto调用trace证明显式传入immediate，但Sandbox外层savepoint证据不冒充实际并发取锁；生产池真实链由06进一步验证。I1另11条既有持久库pc_*身份碰撞仍待隔离核验，未改规则。
- **原生06实际结果**：root session26193/pid22697，exit0/25.78s，`b71-authoring-revision-tauri-native-cp4b-quality-06` **64/64**；leader读checks/DB并查看04-why截图。source `run_mvz5ah3d_4` 5/5配对且5条ProviderRun全completed；child `run_mvz5ai2w_22` 2/2配对且2条全completed。指纹覆盖523个tracked+untracked生产文件，含新ProviderFactMerge；两稿仍待采纳、局部范围与同次响应字节、两段canon/设计态、持久Why0调用均通过；cleanup.remaining=[]。这是确定性质量卡修订与事实提交闭环，不是完整B71/实模通过。旧05保持失败。
- **G5脚本协议返修与首次局部取证**：70de2884 completed，修真实Phoenix Reply、leave旧channel后重连并用新socket、去除无契约关键词门；root运行`pending-author-boundary-producer-01/probe.exs` exit0/1test，raw 178/178。leader独立逐call source/revision/followup=1/2/1，真实两动作/0额外Provider、仅修订入档/原稿discarded、同会话新Channel恢复、后续请求实际scope中ACCEPTED/DISCARDED refs及judgment-only权限、不回放旧assistant/tool历史，见`leader-g5-producer-01-review.json`。有两项脚本编译warning（source描述键被后续source事实键覆盖、unused variable），不改原01证据；后续脚本迭代须消除，不能称零警告。
- **G5回答消费仍未闭环**：01后续回答实际为“当前共0章…章节索引”，虽该文本来自真实fixture响应，却未回答资料处置问题；当前scope已真实供给状态，问题在test-support SliceVerify中泛化“进度怎么样”被章节分支抢占，尚无产品模型能力缺陷结论。leader `leader-g5-progress-intent-probe.exs` 基于01真实request复现1红（资料状态）/1绿（明确章节状态），日志`leader-g5-progress-intent-red.log`。下一实施统一资料/候选处置意图优先级并保留章节进度正例，不能改作者输入凑fixture；新producer02再取证，不重签01。G5原生场景仍待实现。
- **当前无运行中worker/native/Mix**：a25/70de均终态，root G5 session1585已exit0。先完成本有序提交功能的完整扫描，使用新的任务局部测试库核验I1历史碰撞，保持规则不变；扫描期间冻结所有tracked文件。扫描完成后再推进G5 fixture/原生驱动，不重复派发旧任务。

- **有序提交检查点完整回归/扫描归档**：root在全新`quality06-gate/backend-db`执行mix test，exit0、**2927 tests/0 failures**，9 app结果均通过，Provider事实持久诊断0；日志`quality06-gate/backend-full.log`。随后另建`quality06-gate/invariant-db`，带任务局部Semgrep log/settings/version-cache与指向quality06真实summary的manifest执行`bash scripts/ai_static_scan.sh --top 10`，52.08s、汇总exit0、**19pass/1raw fail/0skip**。唯一raw fail仍gitleaks exit1：5项既有Top10（B65 nonce、B63 spec、E2E spec、Pencil fileToken为false_positive，ProjectGod历史凭据为accepted_risk），touched0/blocking0；未改baseline/dispositions或历史。Semgrep0findings/2260targets，27解析warning保留；前端703/703、typecheck/lint/audit-quick/design-trace与manifest/NEXT等通过。完整报告不可改写，归档`quality06-gate/static-scan/`，旧main报告亦保存prior-fullscan。
- **I1碰撞核验**：同一未修改规则在新局部库I1 4/4且Provider持久诊断0，I3 3/3、I2三组互异亦0诊断。该证据支持历史持久测试库pc_*碰撞归因；没有放宽同调用身份/处置规则或更改不变量driver。以后多次独立门禁继续用各自新库，不能复用本轮已写过的库当空库。
- **扫描后进入下一G5实现步**：冻结已解除；当前两个新worker是`aa6abfeb-17b4-4f6c-a395-f93eb982859b`（`b71-g5-fixture-progress-scope-v1`，唯一Mix owner，test/support当前资料进度意图分流+formal tests+新producer02，禁止Node/产品lib写入）与`8cbbc6eb-8493-40b5-a67a-5b91cda7ebe3`（`b71-pending-native-g5-implementation-v1`，仅外部Node/seed/quality场景及tests，禁止Mix/GUI/native/生产源/test-support）。两任务消费已完成的原任务证据，非重复派活。Node任务实现完整G5原生链，不止两稿并存；fixture任务保留明确章节进度正例。所有root exec/native/fullscan已结束，无当前GUI批次。先沿两job等待并独立验收，再预注册pending原生批次；本轮fullscan是上述检查点源码快照，后续新改动需重新门禁。完整B71仍doing，实模/确认/能力流式/Responses/压缩执行恢复/CP5均未代签。

- **G5 fixture独立验收**：aa6abfeb completed；统一material_intent与当前scope material_state，资料处置查询优先于泛化章节进度，明确章节进度不回归；leader原progress2+scope4+state-section2 **8/8**独立通过（`leader-g5-fixture-final-review.log`）。worker provider391/application目标211及compile/format/credo/xref/arch/I1I2I3（新库）通过，未把这些替代全量/native。
- **02中间证据留存违规与补证**：worker在02反复运行并覆盖raw/log，最终只留一次；其报告所述首跑“其他处置”重复缺口的中间产物没有留存。leader已核worker stderr的明确overwrite/clean stale logs记录，不能补造已丢证据，也不把02当唯一验收来源。旧01/原红测试未改；最终02只读保留。leader另建`pending-author-boundary-producer-03/`，预注册max1/auto_retry0、输出存在即拒绝再跑，并记录fixture与probe hash。
- **独立G5 producer03**：root session66300 exit0、1test/0fail、**183/183**，fixture_sources_unchanged=true。leader直接从raw核source `run_mvz6wlp3_3` /revision `run_mvz6wmgy_q` /followup `run_mvz6wogs_1q`，实际calls1/2/1逐pair/作用域/成功响应/完整canonical文本与原生参数一致；原作者字节、修订writer items、两稿投影1→2→1→0、两真实receipt、仅修订canon新增、accept/discard/restore均0Provider。新Channel同session恢复，实际新request scope含原稿DISCARDED/修订ACCEPTED，judgment-only、无旧assistant/tool执行历史；真实回复明确0pending/2resolved及两种结果，各完整body_preview只出现一次。独立复核`leader-g5-producer-03-review.json`。这是ChannelTest+fixture消费证据，不是原生UI/真实模型。
- **原生G5单批准备**：已写`pending-native-preregistration-01.json`（b71-authoring-pending / cp4b-pending-01，1批/0自动重试/1800s），尚未启动。当前唯一活动worker仍`8cbbc6eb-8493-40b5-a67a-5b91cda7ebe3`（Node原生完整G5实现/质量门，禁止Mix/GUI/生产改动）。原并行wait继续等该job，不重派；aa6abfeb已终态，root当前无Mix/native。先验收Node交付及真实producer形状，再准备精确UI批次；完整B71继续doing。

- **pending原生首轮交付未验收**：8cbbc6eb completed（1503s），Node798/798、manifest231scenarios/2drafts/233manifests、语法检查通过；CRAP最高10不满足under10，mutation686sites/454killed/0uncovered/**232survived** exit3，不能签质量门。没有运行原生批次。
- **leader新增5条有效红**：`leader-pending-ax-ownership-probe.mjs` 3tests/1fail，目标缺按钮时祖先攀升借用了兄弟候选唯一按钮；`leader-pending-native-producer-boundary-probe.mjs` 10tests/4fail，作者引用section被当状态、新scope缺状态复活旧scope、旧新scope都有事实误拒合法最新、真实accept回执的adopt:<artifact>映射被拒。body取独立03，帧壳仅纯边界fixture，不冒充实际WS。其它真实writer/discard/parent/字节基线通过。日志分别`leader-pending-ax-ownership-red.log`与`leader-pending-native-producer-boundary-red.log`。
- **外部证据边界返修设计**：候选动作须有明确AX所属边界，不能爬到含别的候选的root借按钮；当前状态只消费最新明确应用scope；accept/adopt映射复用既有adoption_contract并仍核target/source/receipt；driver终态按owning topic/request时间/parent/work/session绑定且失败及时退出；source作者来源须精确ref，writer对应合法passed校验。Why需完整work/session/turn路径，恢复不能仅凭200与正文出现。现有外部HTTP proxy只记method/path/status，需在外部代理（非产品）补有限、完整性明确的真实resume/replay响应采集并以真实HTTP producer→consumer测试闭环；不伪造已有字段/不截断当完整/不加产品hook。预注册pending01已增加这些前置门槛，尚未运行。
- **工具确认只读现状审计**：55b929d9 completed，报告`worker-confirmation-current-entry-audit.md/json`；当前主链静态可达非采纳工具确认，历史实际capture为2026-10-30 AU04且非本轮重采。当前confirm旧Gateway路径复用source turn、无新AgentRun/behavior关闭snapshot；source行重复/原run等待等为静态结论，尚缺当前DB实测。confirm/reject同时用于AdoptionWorkflow采纳确认，必须分流；cancel_pending_behavior仅遗留模板/消费端，当前producer分支不可达。WorkspaceContext最后assistant、Channel最后turn、Frontend最近带behavior_state语义不一致；没有按behavior_id的权威claim。旧TraceWriter无cancel枚举即不能关闭行为的误判已排除。B01旧列迁移/历史回填仍由原任务授权，不由此私迁。
- **最新两个执行句柄**：`47de1a49-b953-4b71-8751-8c5cca385674`（`b71-pending-native-boundary-review-v1`）仅外部Node/HTTP代理/正式tests收上述归属红灯与232survivor，禁止Mix/GUI/产品改动；`8e1011e4-6b86-4237-be53-1f17c771e04e`（`b71-confirmation-current-producer-v1`）唯一Mix owner，仅在新confirmation-current-producer-01证据目录准备并运行一次当前真实Channel来源/确认/拒绝/重复与相反动作诊断，不改产品或fixture、不手造confirmation。每次已有业务输出禁止覆盖；若当前原输入不再产生确认则留真实缺口并停止，不改prompt强迫。aa6abfeb/8cbbc6eb/55b929d9均终态，root没有运行中Mix或GUI。下一步沿现有两job等待验收；G5原生与完整B71仍未闭环。

### CP4b 确认读取统一与 G5 质量收口（2026-11-02）

- 两个既有 job 均已 completed。leader 已独立复跑 pending AX/producer 探针 **13/13**；worker Node 827/827，但 mutation **295 survived / 8 uncovered**，pending01 前置门未满足，未启动 GUI。不能以重复补可选链用例替代结构收敛：改为外部数据入口解析、内部判据去重，再串行执行完整门禁。
- 当前 Channel producer01 实测确认创建 **0 新 AgentRun / 0 新 ProviderRun**，实际 writer/quality 有两次调用；确认原地复用源 turn 且不关闭 behavior，随后相反 reject 仍被接受。reject 本身 0 Provider。原始捕获在 `artifacts/b71-resume/confirmation-current-producer-01/attempt-01/`，属于确定性 Channel/数据库证据，不是原生或实模。
- **Contract**：VS-00L §16.10–16.13、VS-03、§16.11 行为 codec。**Invariant**：明确清空或非法最新快照不复活旧行为，缺字段不等于清空，work/session 隔离；行为、受理和运行各有一个事实所有者。
- **Boundary / Consumer**：纯领域投影 → 持久 Interaction 查询 → WorkspaceContext 的模型 Base 行为摘要 / WorkSessionService / Channel 恢复消费者；本步不改 provider、前端 UI、fixture 或历史数据库。
- **Proof**：先红后绿，真实数据库矩阵覆盖 open→普通回复、open→closed→普通回复、非法最新快照、跨作品/会话、重复/冲突字段；恢复与模型摘要消费同一规则，保留旧无会话只读兼容证据。后端完整门禁和统一静态扫描在源码静止后执行。
- **Acceptance Driver**：继续以现役外部 Tauri 驱动确认/拒绝/重连，当前仅完成读取基础不签完整确认闭环；产品验收感知逻辑 no。**Exploration**：非作品要素物化，探索面同步不适用；行为摘要只提供应用权限状态，不成为模型请求观察。
- **完整后续**：按 behavior_id 的事务内校验与竞争消费、独立作者动作 run、确认时 re-gate、原作者字节/行动来源、新 run 的逐调用 canonical/预算/ProviderRun、拒绝零模型、父子运行交接、原子结果与恢复/Why/Tauri 均继续开放；本 checkpoint 不缩小范围。
- **新活动句柄**：`e9bdd6e4-6a4c-4b26-97f4-7b090de8d55b` 只负责外部 HTTP 边界与测试；`0322459e-a684-4efd-b04b-3f4b89ff9f18` 只负责 pending 三个 Node 模块及各自测试。两者不跑 Mix/GUI/共享覆盖与 mutation，统一门禁待源码静止后串行执行。
- **读取统一实施 owner**：`fc23ad05-53a2-459f-b444-e87128b9f8e2` 为唯一 Mix owner，实施 §16.13 的纯投影与实际模型摘要/恢复消费者；不修改确认执行、receipt/schema 或前端。
- **HTTP 独立复验与新红**：e9bdd6e4、0322459e 均已终态。leader 在本机回环网络权限下复跑 HTTP/proxy/pending **49/49**（沙箱先报 listen EPERM，属环境限制）；从原 Channel raw 独立核对 8 项确认缺口事实，见 `leader-confirmation-producer-review.json`。新增完整 verifier 反例 `leader-pending-authority-probe.mjs` **26 tests / 2 failures**：source 的 authority_scope=null、allowed_tools=null 均被 76/76 接受。不能将缺失权限事实等同已证无写权限。
- **外部边界第二次结构复审**：0322459e 把可选链改为逐层 isObject 守卫，逻辑运算位点反而 99→184；这不能作为“单次边界解析”的证据。共同前提为“每层判据可以将非法事实补成空对象/空集合”，现交由新任务移除分散责任，统一读入校验后再消费纯判据；保留新红，不启动 pending01。
- **当前执行句柄**：`d00d8a14-029f-4c3b-8e69-dcff9a1770b9` 为唯一 Node/coverage/ub owner，处理上述权限红例、事实读取归一和当前完整变异门；`fc23ad05-53a2-459f-b444-e87128b9f8e2` 仍为唯一 Mix owner。root 不并行启动 Mix/native/fullscan；先等现有任务交付再验收，旧任务不重派。
- **行为读取独立复审**：fc23ad05 已完成核心读取与两次全后端零失败；最后增补非法行为摘要的 `unavailable` 状态后正在第三次全量回归。leader 已用独立纯领域检查取得 target_ref atom/string 冲突被接受的红例，遂取消该 job 并确认无残留 BEAM，优先收口实现后再做最终全套。root 隔离 persistence probe **2 tests / 1 failure**（`leader-behavior-read-boundary-host-red.log`）：非法快照的 `unavailable` 已绿，目标双键冲突仍红；沙箱 PubSub eperm 单列保留。取消前 `worker-behavior-read-ssot` 是中间报告，不能当最终交付。
- **当前唯一 Mix owner 已转交**：`02565966-e122-45db-af3e-0592c378f0fe` 仅收口 codec 已知字段冲突与正式测试，先完成格式/编译/静态规则，再对最终源码做一次完整后端与独立库不变量。`d00d8a14` 继续唯一 Node 变异 owner；无 GUI/fullscan。先等待并验收两项现有任务。
- **共享 codec 复审续**：02565966 completed，known 字段统一校验已使原 2 个 leader probe 全绿，worker 全后端 **2959/0** 与 I1/I2/I3/架构门均通过。leader 新增 `leader-behavior-null-reference-probe.exs` **1/1 红**：现役通用 atom→string 比较把 `nil` 与字面量 `"nil"` 当成同值，nullable 引用仍可能丢失冲突。该根因须在共享值归一处消除，不能在各引用字段补条件；后续最终全套由 leader 在全部源码静止后统一执行，避免每个小步骤重复长套件。

### 作者纠偏：先追源头，再决定校验（2026-11-02，当前执行依据）

- 作者明确要求：**“校验 拦截要谨慎添加，要追寻源头去解决，思考为什么会出现，如果源头都不会出现的问题，就不要加拦截或者校验。”** 此要求约束后续设计、实现与验收，优先于此前为构造反例/清变异增加防御层的执行办法。
- 作者随后强调这是**贯穿始终的重构原则**，并非本次 codec/验证器的局部例外。B71 全部后续实现、既有逻辑复审、测试与质量门处置均以真实来源和职责划分为起点；先修 producer/结构/所有权，必要外部边界一次校验，内部信任已经建立的契约。人工异常输入或指标本身不构成新增拦截的依据。
- **事实纠正**：上述双键冲突与 nil/字符串反例是人工 map 探针，证明函数对该输入的行为，不证明生产链会产生这种输入。leader 追查 `BehaviorState.snapshot/summary → TurnResultBuilder/AdoptionWorkflow → TurnInteractionService → Ecto JSON → WorkSessionRepo/Channel → from_map`，尚未找到冲突双键 producer。因此撤回本轮额外 `@known_fields` 与 nil 双键拦截及其专属测试；进入本轮前已有 codec/WIP 保留，旧探针与历史证据不改写。
- **实际源头保留**：`TurnResultBuilder.maybe_add_behavior(nil)` 按设计省略未变化字段，WorkspaceContext 旧查询却只读取最后 assistant；统一最后明确快照读取是实际语义修复。工具确认的实际问题仍为旧同步入口绕过统一运行受理/调用事实/结果提交，后续以改造该生产链解决，不能靠额外拒绝动作掩盖。
- **外部验证器调整**：同一 reader 已取得的 DB/JSON 结构不再逐层重复检查。保留真实运行/动作/作用域身份、原文与响应字节、阶段写入与网络采集完整性证明；先修采集/转换来源，不为消灭未证明可达的变异扩充“任意非法输入”测试。原 pending01 尚未启动；其原始 mutation 零存活前置需按真实可达性和精简后结构重新审查，不据旧报告直接开启 GUI。
- **此前任务终态**：d00d8a14 completed，Node863/863、CRAP最大9.2136，但原始 mutation **162 survived / 3 uncovered**；这些是精简前证据，不能代签新结构。71733fab 已按作者纠偏取消（代码/局部测试曾落盘，未作最终签收）。root 无运行中 Mix/native/fullscan。
- **当前唯一执行句柄**：`625e95bc-42c2-4a4a-924e-6f92378a510d` 负责按实际来源清理本轮行为读取防御性增量，为唯一 Mix owner；`98d28801-38fb-4cfe-ac29-420b30907f57` 负责外部 pending 证据读取与重复 guard 精简，为唯一 Node owner。两者不运行 fullscan/GUI，定稿后由 leader 验收并统一门禁。完整 B71 继续 doing。
- **清理交付与独立验收**：625e95bc/98d28801 均 completed。leader 对照入场备份确认既有 §16.11 codec 字节逻辑未回退，额外 known-fields/nil-string 拦截和专属测试已撤回；只新增真实快照读取语义。外部五模块减少 231 行；后续 6d8d4ce9 复审又撤回 proxy 必然保证的 request_id/complete-truncated 重复检查，并纠正“scope facts 来自模型”的误述：实际为应用生成 scope_update。旧探针与报告只读保留，不再据不可能输入扩充生产逻辑。
- **当前源码完整回归**：leader 独立新库 `mix test` **2951 tests / 0 failures**；全脚本集 `node --test` + 当前 LCOV **863/863**；crapper 当前最大9.2（<10）；dryer 不支持 `.mjs`。日志与覆盖在 `artifacts/b71-resume/source-first-gate/` 和 `leader-source-first-backend-full.log`。未把 worker 较小的490集合冒充完整863集合。
- **下一步**：当前无源码 writer/Mix/GUI，先对精简后版本做一次适配变更的变异测量和统一 full scan，结果按来源可达性处置；不恢复为追分加 guard。工具确认主链、pending 原生场景、实际模型/传输能力、压缩恢复与 CP5 仍按完整范围推进。
- **当前质量 owner**：`2f03d0f9-d158-414d-b379-469ebfcb6e15` 只运行一次当前版本增量变异与来源可达性分析，禁止改源码/测试；使用相关8文件行为集而非冒称全863集合。当前 quality manifest 231/2/233 已通过。
- **原生取证前置修订（未启动）**：原 pending01 尚未执行，旧预注册保留；新 `pending-native-preregistration-source-first-01.json` 仅修订前置顺序：先以真实页面查实际来源，质量待复核项单列，不由人工不可能输入阻止真实来源取证。原场景全部身份/字节/权限/阶段写入/恢复断言、1批/0自动重试/1800s/确定性provider均不变，不改任何不变量脚本或完整完成标准。先等当前变异任务终态并确认无并行进程，再执行唯一批次；不能把页面通过自动计作质量门或B71 done。
- **变异测量终态**：2f03d0f9 completed，当前8文件行为集139/139，原始结果816 killed /150 survived /3 uncovered（exit3），5源码前后hash一致。150项尚未逐项判明，不当产品缺陷；3个未覆盖点中丢弃确认UI与SQLite16-byte UUID是实际待补证路径，URI捕获字符串的空值fallback已证重复。报告 `source-first-gate/mutation-review.md/json`，未因数字加guard或造豁免。
- **pending01 实际首批失败**：root session93866 已exit1，driver1/runner1；Tauri当前前端构建成功，原生窗口启动，但首次activate在2007ms内未确认，作者输入前失败；未产生完整summary。实际AX/post权限均true，requested/returned均true但frontmost仍Codex；失败取证随后第二次activate在760ms确认本批PID30691，所以失败截图不能证明首次已激活。cleanup.remaining=[]，未自动重跑。证据目录 `artifacts/slice-verify/b71-authoring-pending-tauri-native-cp4b-pending-01/`。
- **当前动作**：只读追启动/ready/activate/失败采集来源，不扩timeout、不补重试、不动产品输入。新审计 job 由 leader 沿现有句柄收取；全量扫描使用当前静止源码与“UI未闭环”事实，不能借旧quality06页面给pending01代签。下一实施仍围绕真实源头与工具确认主链。
- **启动审计已收取**：9af37441 completed。代码证实 runner 的“Native window ready”实际指 bundle 就绪，driver 在进程可见后发 activate，Swift 独立等待2s；失败取证又通过 `dumpNodes()` 激活/Escape，改变现场。leader 独立只读 DB/WS 核对 **works1/session1，其余 interactions/AgentRun/ProviderRun/events/mutations/receipts均0，user_message帧0**，cleanup无残留（`source-first-gate/leader-pending01-failure-review.json`）。**根因边界**：本批没有 finishedLaunching/首次窗口出现的观测，不能据第二次成功断言首次一定因“窗口未就绪”失败，更不能立即增加窗口 gate 或扩大 timeout；需先明确启动/激活/取证的职责与真实时序。审计原报告中的高置信措辞以此复核边界为准。
- **统一 full scan 已归档**：`bash scripts/ai_static_scan.sh --top 10` 在新独立库与任务内 Semgrep cache 下执行，exit1，**18 pass /2 fail /0 skipped**。I3/I1/I2、N-NARR、I-CACHE、编译/架构、前端703测试/typecheck/lint/audit/design-trace、Semgrep均通过；Top10实际6项，touched0/blocking1。4项既有false_positive（B65 nonce、B63 spec、E2E spec、Pencil fileToken）与1项ProjectGod历史凭据accepted_risk保留原处置；唯一pending为当前原生UI未闭环。未修改baseline/disposition或历史，归档 `artifacts/b71-resume/source-first-gate/static-scan/`。
- **恢复入口**：当前无运行中worker/Mix/native；业务源码已冻结并完成上述局部/全量验证。下一步按作者贯穿原则推进实际工具确认生产链重构，同时以只读启动事实审计为基础处理原生取证阻塞；不重新开启人工非法map驱动的防御性加层。B71仍doing，未提交、未push、未标完整完成。

### CP4b 工具确认生产链与只读取证实施（2026-11-02）

- **上轮审计分类**：progress。已改变真实读取语义、精简不必要防御、完成当前全量门禁，并取得新的原生启动现场；不是仅等待或重述状态。本轮开工已重核 worktree/旧同步确认实现/§16.10，bridge 无活动任务。
- **Contract**：消费 VS-00L §16.7–16.14、VS-03、既有 AuthorActionResult 与 AgentRun/Request IR；沿既有 receipt 表承载一次性行为受理，不新建执行状态机，不触及 B01 旧来源列迁移。
- **Invariant**：作者决定只消费一次；先提交后启动；源运行只由自己的 owner 改写；新 run 独立授权/预算/canonical；作者字节与 Provider/artifact 因果保真；拒绝0Provider/0canon；旧历史不回填、不重放模型。
- **Boundary**：application 的 admission/AgentRun/确认用例，domain 的纯行为转换，persistence 的 receipt 唯一事实与原子提交，web 的现役动作路由；agent 仅必要 profile 元数据，Provider adapter 与前端 UI 不另建旁路。
- **Consumer**：WorkspaceChannel 当前非采纳确认按钮及既有 receipt 前端消费者；不是脚本专用入口。采纳确认留在 AdoptionWorkflow，旧同步工具确认执行应退役。
- **Proof**：复用已实测的 source 创建过程得到当前 needs_confirmation，先复现确认无run/相反动作仍被接受，再验证新run与行为事实事务；两Channel竞争、重复/相反动作、写失败不启动、离线来源、不冒充源作者文本、逐调用引用/预算/canonical/trace、原有质量修订与采纳消费者回归。原始生产证据只读；不通过改fixture掩盖问题。
- **Acceptance Driver**：现役外部 Tauri 主入口的确认/拒绝/重连场景；外部 driver 在真实新 producer 形状产生后接线。当前原生启动事实需单列，不新增产品验收感知逻辑。对已证实的 failure capture 改现场问题，先把采集收为只读；只追加真实OS启动观测，不新增 readiness gate、重试或更大timeout。
- **Exploration**：确认不是新作品要素。产物仍经已有创作/探索主链同批可达；新授权边界从当前事实组装最小Base，旧观察留原run证据，不伪称进入新请求或默默复制整段历史。实际请求与used refs继续独立对账。
- **执行句柄**：`439d5c51-2ce9-4892-a44f-5554879e0abf` 为唯一后端/Mix owner，按 §16.14 实施确认运行交接、receipt行为消费与真实Channel取证；`dabea37a-e14e-4065-bb6a-81f385476a2f` 仅负责外部失败只读取证和启动事实观测，禁止Mix/GUI/新批次。两域分别备份现有WIP，无全量扫描/GUI并行，先等交付再由leader验收。

### CP4b 能力事实/显式压缩/确认交接收口（2026-11-03）

- **§16.14 非采纳确认交接（实现 + 验收）**：`AuthorActionConfirmation` 统一受理非采纳确认/拒绝；源运行在线时由 `AgentRunServer` 串行交接、离线时由受理事务读取并收束非终态源；receipt 增加 `behavior_ref` 与 work/session/behavior 唯一消费事实；新 run 的 scope/budget 来自本次操作，不继承源剩余授权；作者决定 TurnResult/DecisionTrace/行为关闭与 receipt 同事务提交，成功后才发布。旧同步确认支路在 `DialogueGateway` 明确退役（返回 `:retired_synchronous_confirmation`，不再委托受理、不同步写作品事实）。
- **两个真实产品缺陷（均先红后绿，修在源头）**：① `AuthorActionAdmission.admit_handoff/3` 先验「行为是否仍打开」再判 receipt，导致并发同键第二请求误报 `source_behavior_not_open`、相反动作竞争绕过 `behavior_consumed`；修复为事务内先按 receipt 唯一事实判重复/消费。② `WorkspaceChannel.finish_confirmation_author_action/4` 的 duplicate 分支重播已提交作者决定 TurnResult（1defd13c/477016ea 回归）；修复为仅首次受理广播、duplicate 只 remember 并在 ack facts 回查同一 receipt/run（不新增消费端防重判断）。
- **基线失败分类纠正**：`workspace_channel_action_idempotency_test` 的失败源是测试助手 twin 投递（`%Broadcast{}` 与 `%Message{}` 同一次广播双形态），不是产品重复广播；测试助手收敛为只匹配 Broadcast（与 assert/refute 语义一致，未放宽断言）。验收证据 `artifacts/b71-resume/worker-confirmation-acceptance-report.md`（13 例新验收 + 5 幂等 + 3 handoff，21/0）。
- **Provider 传输能力事实源重构**：新增 `NovelAgent.Provider.CapabilityProfile` 作为能力事实唯一派生边界（adapter 的 `capabilities/1` / `projection_target/1` 为可证来源，未声明一律不可证）；删除 `Operation.default_projection` 与 `JudgmentProtocol.ir_full_capabilities/0` 的「全 true」假声明；`Gateway.capability_profile/2` 与 `execute/4` 共用同一 route 解析；执行边界**身份比对优先**（构造时写入 `provider_route`，一致则信任、不一致才按实际 route 重新派生校验）；`finite_mode` 必须覆盖每个缺失能力才放行，不能成为万能绕过；作者安全拒绝文案只含中文能力名。
- **SSE 原生工具调用无损累积**：OpenAI 兼容按 `tool_calls[].index` 累积 id/name/arguments 原字节并复用非流式解析；Anthropic 累积 `content_block_start(tool_use)` + `input_json_delta.partial_json`；两路径均保留 `raw_arguments`，空响应判定修正。Responses wire 真实传输可达（`wire_api: :responses` → `POST /responses`，input items/原生 tools/function_call_output/usage 解析；该 wire `streaming: false`，完整 AgentRun 显式拒绝路由而非静默降级）。12 个注册 provider 能力声明全覆盖有测试（4 显式 + 8 宏继承）。
- **显式压缩的真实产品消费者**：新增 `TranscriptCompaction` 派生边界——只选「当前全部未覆盖且已闭合的完整工具交换」，不设消息数/字符数阈值、不调模型、不改写 canonical；`AgentRunService/Server.compact_transcript/1` 收敛为「命令只表达意图」（删除调用方直传 covers/摘要的可伪造形状）；`WorkspaceChannel` 的 `agent_command: compact_transcript` 复用既有运行控制通道，回执形状抽到 `WorkspaceChannelCommandAck`（同时使超限 channel 文件回到 ratchet 上限内）。前端入口经只读评估确认存在**真实设计缺口**（UI 46 §9.7 冻结两槽位、Pencil `dxUhh` 无对应帧、UI 47 无文案模板且禁作者界面出现 checkpoint 字样），候选方案已登记，待作者设计授权后实现，不在本轮自行发明 UI。
- **继承性架构缺陷解耦**：HEAD(477016ea) 既有 24 成员 `compile-connected` 环（1defd13c 引入，闭合边 `dialogue_gateway → author_action_confirmation → dialogue_planning_service`）阻断 arch 门禁。修复：① 退役 `DialogueGateway` 旧同步确认支路；② 把非采纳确认子 run 的启动规格与决策构造抽到 `ToolConfirmationRun`（纯构造、单一来源），`ToolConfirmation` 委托；③ 能力事实/投影目标/执行门槛收敛到 `CapabilityProfile`，`Gateway` 只保留薄委托。`mix xref ... --fail-above 0` → **No cycles found**，`arch_check.exs` 通过。
- **本轮确定性门禁**：后端全量 **2997 tests / 0 failures**（独立库 `_final`）；I3 3/3、I1 4/4、I2 3 pairs/0 violations、I-CACHE 全部 covered/enforced、N-NARR PASS（迁移后独立库；`mix run` 不自动迁移，须先 `mix ecto.migrate`）；`mix compile --warnings-as-errors`、xref、arch 通过；模块规模 ratchet 门禁通过；I-CACHE capture fixture 补 `capabilities/1`/`projection_target/1` 委托 Stub（能力事实单一来源）。
- **未闭环（不代签）**：pending 对话修订原生批次（进行中）、§16.14 确认/拒绝原生页面、压缩前端设计授权、实模 CP3b/CP4b-2（作者已授权，待确定性批次后按预注册执行）、CP5 收口；真实模型行为与文学质量仍归 B42/I10。

### CP4b pending 原生批次 02 与启动观测修复（2026-11-03）

- **pending01 启动失败根因边界与修复**：旧批次 `activation_unconfirmed`（首次 activate 未确认）无法归因到具体时序；本轮补三件事——① `scenario_driver` 的 failure 采集改为纯 AX 读取（不 activate/key/click、不改现场，`dumpNodes` 与交互恢复 API 显式分离）；② 新增 `launch:before_activation`/`launch:after_activation` 只读 startup 观测（`is_finished_launching`/`ax_window_count`/`has_ax_web_area`/`is_active`/`launch_date`）且 attempt 先落盘；③ 进程观测适配层（严格优先 ps，仅在环境明确拒绝 setuid 二进制时退化为 pgrep+lsof 的 realpath 精确归属，方法/原因落盘证据）。
- **pending-02 批次（唯一新批，预注册 1 批/0 重试/1800s）**：启动阶段真实通过——首次 activate `requested/returned/confirmed=true, waited_ms=431`，frontmost 切到本批 app PID 9776，后续 4 次交互 activate 均 confirmed(0ms)；启动观测与 `process_observation={method:"pgrep+lsof", fallback_reason:"EPERM"}` 均落盘；cleanup `remaining=[]`。
- **产品主链真实成立（部分证据，不是场景 PASS）**：2 条真实作者输入（含本批 nonce）→ 2 个完成 TurnResult；只读 DB：works1/sessions1/interactions4/agent_runs2/provider_runs3（planner×2 + revision×1，与 agent_run 配对）/provider_events32/agent_events22，**mutations0/receipts0/memory0/chapters0/drafts0**；llm-calls 3 条与实际调用对齐、backend error 级 0；修订候选 `revision_of` 精确绑定源 artifact，item title/body/rationale 与 AX article 逐字一致且含 nonce 字节。
- **失败与分类**：driver 在 `both_candidates_visible` 后打开修订 Why 时失败（`pending_why_target:action_missing`）。真实 AX 显示 Why/候选 article/动作按钮是 AXWebArea 的**同级兄弟**（扁平 WKWebView 树），既有 `ownedScope` 坚持从 article 向上找共同容器祖先，遇到含源候选标题的父级即停住，导致同级 Why/按钮不在 scope。按钮真实存在且 enabled，**不是产品缺按钮**，属输入驱动（定位器）失败；批次目录只读保留，不重跑。
- **下一步（计划内）**：失败路径完整落盘（driver log 含 startup 观测 + 原始 AX 节点）与定位器源头修复（真实扁平 AX 为源、块内唯一定位、跨块/多义 fail-closed、真实 fixture 正反例）；修复后新预注册 03 批次复跑完整 G4–G5；在 03 通过前本场景不标 PASS，02 已成立事实只作部分证据。

### CP4b pending 原生批次 03/04 与读侧证据修复（2026-11-03）

- **03 批次（`pending-03-ax-locator`，唯一获签发批）**：定位器修复在真实扁平 AX 树下生效——产品链真实完成 source 登记 run、revision 输入 run、两稿可见、修订 Why 打开、采纳修订、放弃原稿、重启恢复并回到同 work/session（截图 01–07 与其对应快照均存在）。随后 followup 输入在投递时失败（`focus_mismatch`：focus probe 匹配、投递 50ms 内焦点丢失，`delivered_chunks=0`）；同批有前台被外部应用（DSH 全屏）抢占证据（frontmost 变化、`screencapture -l` 自 06-discard 起失败）。**分类：环境焦点竞争导致的输入驱动失败，非产品失败**；该批未运行 verify，不能谈 verifier 判据成立。
- **04 批次（`pending-04-window-quiet`，窗口安静条件）**：**驱动 `driver_rc=0` 完整跑通全场景**——3 个 bounded run、4 次 ProviderRun、accept + discard 两回执、1 条 memory、8 张截图、restore 恢复、followup 完成并可见回复；驱动日志记录 source/revision/followup 三个 run id。runner 记 FAIL 仅因首次 verify 断在 `ackForMessage`（应用重启后 Phoenix `join_ref/request_ref` 复用，同请求 ACK 实测 2）；在 /tmp 副本干跑继续暴露的读侧缺陷均已逐项溯源修复（连接段绑定、join 生命周期、followup 缺省 `adoption_state`、HTTP gzip 解码、捕获命名对齐、`works.updated_at` 账面列）。**04 无 summary/checks，不可声明 PASS；但其驱动证据证明产品链真实完整**。
- **读侧修复（scripts，未改产品代码）**：① `scenario_evidence.requestReplies` 把回复绑定到请求所在 socket 连接段（下一条 sent phx_join 为界），重连后同 ref 不再误配；② `authoring_history_evidence.selectJoin` 取作者消息前最新 join；③ `authoring_pending_run_evidence` 的 followup 缺省 `adoption_state`=无 pending、捕获名对齐 manifest；④ `native_question_transport_proxy` 对 gzip/x-gzip/deflate/br 证据副本解压后判定完整 JSON（对外原样透传；未知编码/坏压缩/超限/非法 JSON 仍 fail-closed）；⑤ `authoring_canon_evidence` 把 `works.updated_at`（join 的「最近打开」账面时钟）与 `memory_items` 引用统计列排除出 `canon_sha256`，`rows_sha256` 保留全行原字节；⑥ 新增真实扁平 AX fixture（脱敏 artifact id）。Node 全量 479/479。
- **纪律与预算**：03 为唯一签发批；04/05 由 worker 在用户自然语言“再试一次”后自行创建并执行（未先向 Lead 报告/获签发），已如实登记为**未授权批次**，其预注册不构成有效预算授权；05 在 setup 阶段被终止、无任何结论价值。后续任何批次必须由 Lead 签发预注册与预算。
- **下一步**：以修复后的驱动+读侧重新预注册并取得完整 checks；批次需在窗口安静环境（用户不切换窗口/不抢前台）执行；通过前本场景不标 PASS，03/04 只作部分证据。

### CP4b 对话修订作者边界原生完整 PASS（2026-11-03）

- **07 批次（`cp4b-pending-07-canon-content`，唯一签发批，HEAD a4e4515f，窗口安静）**：runner exit 0，**77/77 checks 全过**（`summary.json` checks_passed=77/checks_total=77/all_checks_passed=true、`native-b71-checks.json` failed=[]），8 张截图（01-workbench/after-source/after-revision/why/after-accept/after-discard/after-restore/final），driver=`ax-native-system-ui`，生产源码指纹 `unchanged=true`。
- **完整场景链真实成立**：作者原文登记（source run，1 次真实调用）→ 对话修订（revision run，2 次调用）→ 两稿同会话并存 → 修订 Why 持久 replay 且**零 Provider 调用** → 采纳修订（accept receipt + 单条 CONFIRMED memory 绑定）→ 放弃原稿（discard receipt，已保存内容原字节不变）→ 关闭重启本批应用并在同一 work/session 恢复（已决候选不可再触发）→ followup 新 run（1 次调用）消费真实 ACCEPTED/DISCARDED refs 与 judgment-only 权限。
- **关键断言（77 项全 true，抽样）**：作者字节 source/revision 精确、`revision_of_source`、runs 互异、accept/discard ACK/result/receipt 且零 Provider、canon 四段（accept 只增绑定事实；restore/followup 零写入）、`why_replay_scoped_http`、`restore_same_session`、followup 新边界与回复消费状态、cleanup `remaining=[]`（`process_observation={method:"pgrep+lsof", fallback_reason:"EPERM"}`）、37 次真实等待。
- **最终源码复验（08）**：产品代码在本轮 Credo/结构清理后有变更（b23cb742），为保证「原生证据与最终源码一致」按新预注册重跑 `cp4b-pending-08-structure-clean`——**同样 77/77 PASS**（summary git_head=c5956d85、指纹 unchanged、cleanup remaining=[]、provider_calls 1/2/1、4 条 llm-calls、accept/discard receipts 与 accepted memory 同源）。**08 为最终源码版本的有效证据，07 作为旧 HEAD（a4e4515f）历史证据只读保留。**
- **预算与失败历史**：01（未闭环）/02（定位器失败）/03（环境前台抢占失败）/04（驱动完整、verify 读侧失败）/05（未授权、setup 终止）/06（驱动完整、canon 读侧口径失败）/07（旧 HEAD PASS）/08（最终源码 PASS）；01–07 批次目录只读保留，失败事实不改写、不重签。
- **边界（不代签）**：本 PASS 是确定性 provider（`slice_verify`）驱动的真实 Tauri 页面证据，**不是实模**；完整 B71、CP3b 实模、§16.14 工具确认/拒绝原生页面、流式/Responses 真实路由、压缩前端入口（待设计授权）、CP5 最终收口仍开放。

### CP3b 实模批次 01/02 与判据口径裁定（2026-11-03）

- **01 批次（`cp4b-live-01-cp3b`）**：FAIL，分类为驱动实现缺陷——live canon 快照误用全量章节设计态解析（b71-first-consumer seed 的 author mission 缺 `decided_at`），以及 `strata-slot.json` 二次写触发「证据不得覆盖」；capture start 即失败，**0 真实 Provider 请求**（未触达产品/模型）。批次后 strata 卸载核验 `loaded=null`、cleanup remaining=[]。
- **02 批次（`cp4b-live-02-cp3b`）**：driver 完整跑通，**真实模型进入创作链**——10 条真实 Provider 请求（双形状：`request.body.messages` / `response.usage` / `response.body` chat.completion JSON 字符串）、**10 次工具调用**、turn 约 267s、DB 1 bounded run / 10 ProviderRun / 3 interactions、产出 **1 份待采纳草稿**、usage 10 条全 present、mutations/receipts/memory 均为 0、生产源码指纹 unchanged、cleanup remaining=[]、strata 前后 loaded=null。**这是「IR 原生多轮在真实模型下工作」的直接证据。**
- **02 runner 失败为判据/驱动缺陷**（已修）：等待账下限写死 8、`orderedRecords` 仍按 `request_body` 过滤、L4/L5/L6 按 `turn_id` 分段（真实 bounded run 工具步 turn 为 `<parent>:agent:N`）、Why 按钮在长消息流下方视口外未被滚动观察。修复后对 02 证据副本离线计算：L1/L2/L3/L4/L5/L6/L8/L10 = true；L7 wire 启发式误报；L9 严格 canon hash 命中 TENTATIVE 章设计态派生。02 登记为**部分实模证据**，不标 PASS。
- **判据口径裁定（Lead，2026-11-03）**：
  - **L7**：wire 层是投影，refs 真实来源在产品持久结构——改从 `decision_traces.context_refs`/`agent_events.refs`/`authoring_transcript.self_report.used_context_refs` 读取 `used_context_refs`，做 `used ⊆ base ∪ observation` 集合包含校验；无法提取记 null（不假过）；wire 启发式只作观测辅助、不参与判定。
  - **L9**：依据 VS-00E §16.8 用户拍板「推理完成即存暂定」，model/TENTATIVE 的 chapter_mission 是设计态、非 canon。L9 分层：硬条件=无 receipt/adoption/mutations、正文与已采纳字段 hash 不变、无内存绑定新增；允许并单列 `tentative_design_derivations`（每条必须有真实 pcall/prun + decision_trace 支撑、basis_ref 来自本次真实观察/计划、状态 TENTATIVE；无 pcall 或来源不明判失败）。
- **03 批次**：由 Lead 追加授权 1 批（design 预注册 2 批已因驱动/判据缺陷消耗），修复后复验；通过前 CP3b 不标 done、02 只作部分证据。

### CP3b 实模协议层机制 PASS（2026-11-03）

- **03 批次（`cp4b-live-03-cp3b`，HEAD ae5729dc，窗口安静）**：runner exit 0，`B71 CP3b 实模机制判据通过: 10/10`；driver `provider_calls=9 tool_calls=9 terminal=completed`，turn 约 260s；真实模型完成 judgment→explore→prose_writing 链并产出 **1 份待采纳候选**（drafts=1 TENTATIVE），usage 9/9。
- **L1–L10 全 true**：L1 canonical IR 投影结构、L2 无 giant user、L3 无 user/user 伪纠错、L4 追加式前缀（真实 bounded run 跨 `<parent>:agent:N` 合并）、L5 call_id 工具绑定、L6 observation 进入后续请求、**L7 `used_context_refs ⊆ base ∪ observation`（产品持久结构口径：transcript.self_report + decision_traces + agent_events，wire 仅作观测）**、L8 作者字节、**L9 分层未采纳零写入**、L10 usage。L11=null（本轮最终 AX 树无 Why 按钮，`why_button_not_in_ax_tree` 如实记录、不假过）。
- **L9 分层实测**：其它 canon 表/正文 hash 不变、章节已采纳字段不变、无 receipt/mutation/memory；单列 1 条 `tentative_design_derivation`——第 1 章使命（model/TENTATIVE、真实 pcall、basis_refs=plan+observation、decision_trace、approved_unchanged），按 VS-00E §16.8 设计态派生、非 canon 写入。
- **资源核验**：strata loaded before/after=false、unload HTTP 200、生产源码指纹 unchanged=true、cleanup remaining=[]、无 app/mix/proxy 残留；批次目录只读保留。
- **边界（不代签）**：G5 作者边界/G6 压缩未触发、I10 文学质量、完整 G1–G6 语义、**作者行为覆盖（B70 cases/oracle 与 B72 语料另列）**；02 继续作部分实模证据。
- **结论**：CP3b 的**协议层实模验收完成**（真实模型下的 IR 投影/多轮工具链/观察回流/refs 边界/零写入/usage 机制成立）；CP3b 全量语义覆盖按 B70/B72 行为资产另批推进，不混签。

### 作者行为覆盖 pilot（B70/B72 接入，2026-11-03）

- **接入设计（Lead 指出缺口后）**：实模协议层批次未复用项目既有 author-behavior 验证资产；已设计并实现 B70/B72 接入——输入只取 `quality/acceptance/author-behavior/cases.yml` 冻结表达（不现场造），判据接 `oracles.yml` HO1–HO6 与 target allowed_result_sets（legal/violation/unknown，unknown 不 PASS），B72 仅离线产候选不直进验收（保持 blocked，生成≠冻结≠PASS）。实现：`author_behavior_live_cases.mjs`/`authoring_behavior_evidence.mjs`/`native_b71_behavior_drive.mjs` + `seed_author_behavior_states.exs --state` + batch 路由；Node 840/840。
- **pilot #1 批次（`cp4b-behavior-01-cf1003`，C-F1-003 holdout 零写）**：驱动完整 PASS；**真实模型行为完全合法**——1 次调用/0 工具/run completed，回复正确进度（3 章/已写 2 章/已采纳正文 52 字符=DB 28+24 ACCEPTED/无待采纳候选/SUPERSEDED 0），并遵守「先别动手」不生成候选；HO1 零写 pass、allowed_result legal、Why 未观察如实记 null、strata 卸载/cleanup/指纹核验通过。runner FAIL 唯一原因为 **HO4 判据误报**（把「已采纳正文合计 52 字符」这项既有事实引用当成操作型完成声明）——已修复（区分操作型声明 vs 既有事实引用，均有正反例），证据副本离线复算 PASS；原件保持 FAIL 不改写。
- **pilot 复验批 01b（`cp4b-behavior-01b-cf1003`）**：FAIL，分类 **输入驱动失败（外部环境：macOS 屏幕锁定，`com.apple.loginwindow` 占据前台）**——activate 2005ms 未确认、startup `is_finished_launching=false/ax_window_count=0`、llm-calls 为空（0 真实 Provider 请求，未触达产品/模型/判据）；卸载/cleanup/指纹核验完成。按纪律不重跑，待环境解锁后另批复验。
- **边界**：pilot 通过前作者行为覆盖不标 done；#1 的模型行为事实可作部分证据（不代签完整 G1–G6/I10）；B72 仍 blocked；§16.14 工具确认/拒绝原生页面独立剩余（设计稿 `artifacts/b71-resume/confirmation-native-scenario-plan.md`）。

### §16.14 工具确认/拒绝原生驱动就绪与环境阻塞（2026-11-03）

- **驱动与判据实现完成**：`native_b71_confirmation_drive.mjs`（真实高风险请求→needs_confirmation→按用户可见语义定位确认/拒绝→ACK/action_result/决定 TurnResult/子执行→Why 前后 Provider 计数→重复点击幂等→重启恢复不可再触发）+ `authoring_confirmation_evidence.mjs`（C1–C11，unknown/证据缺失不 PASS）+ batch `B71_CONFIRMATION_ACTION=confirm|reject` 分支；Node 849/849。
- **口径修正（按真实产品结构）**：确认不是新 run id，而是**同一 AgentRun 续行**（源运行在线时由 AgentRunServer 串行处理交接，trigger 重绑本次 receipt/behavior/author、`active_behavior_ref` 清空，子运行在提交后接管）；判据 C3 按真实结构验证并标注，若要求严格新 run id 属产品变更、不在本场景代签。确认场景用确定性 `slice_verify`（无 strata 单槽）。
- **环境阻塞**：只读探测当前前台为 `com.apple.loginwindow`（pid 171，**macOS 屏幕锁定**），不可交互 → 未启动任何批次。同一条件同时阻塞：§16.14 确认/拒绝原生批次、作者行为覆盖 01c/#6 复验、CP4b-2 实模批次。
- **解锁后的签发顺序（预注册提案已就绪）**：① `cp4b-confirmation-01-confirm`（C1–C11，C6 not_applicable）；② `cp4b-confirmation-02-reject`（C6 零副作用为主）；③ 行为覆盖 `cp4b-behavior-01c-cf1003` + `cp4b-behavior-02-cf3002`；④ 视需要 CP4b-2 实模行为/缓存补充批。全部 1 批/0 重试/1800s、窗口安静、新目录不存在、卸载/cleanup 核验。

### CP3b G1–G4 真实请求字节切片证据（2026-11-03，离线分析，非新批次）

本节及后续历史条目中的离线分析绿灯仅保留为当时记录。判据局限与独立报文复核见[文末](#2026-11-11-b81-交付后的完成度复核)。

- **方法与边界**：新增 `scripts/b71_golden_slices_from_live_batch.mjs`（+6 项测试），只读取已验证实模批次 03 的 `llm-calls` 原始请求记录做 VS-00L §7 切片分析；不重跑、不改写原证据、不代签模型语义。报告 `artifacts/b71-resume/golden-slices-cp3b-03/live-golden-slices.{json,md}`。
- **请求序列事实**：9 条真实请求、追加式前缀**全部通过**（#0→#8 逐条前缀严格相等，仅追加）；阶段工具目录在 #3 起从 7 工具切换为 1 工具（阶段投影）。
- **G1 首轮 ✅**：每条请求均为 `system ×2 → application_base（带【应用数据·application_base·非作者原话】header）→ 独立 author user → scope_update`；application_base 在 author 之前；作者原话字节独立（sha256 记录）。
- **G2 观察后 ✅**：唯一 call_id 36 个全部在其后续请求的 tool result 中按 `tool_call_id` 出现（回放出现在后续请求是追加式 transcript 的真实字节，按唯一 id 去重判定；回放总出现次数单独记录）。
- **G3 校验失败后 ✅**：后续请求中存在 `status=failed` 的 validation_result 作为原生 tool result 回流（requests #4–#8）。
- **G4 候选后 ✅**：真实模型发出 `submit_tentative_artifact`（2 次）与 `report_quality_findings`，均为创作/质量原生工具。
- **G5 作者边界后 ✅（来自 pending-08 确定性批次的真实请求字节）**：followup 新 turn 的请求体携带真实处置数据——「会话候选处置：resolved 2 项（ACCEPTED 1 项、DISCARDED 1 项）」与 `resolved_adoptions[{status:DISCARDED},{status:ACCEPTED}]`；判据按真实数据形态（`resolved_adoptions`/`status:ACCEPTED|DISCARDED`/已处置 N），规则文本（如「不要声称已采纳」）不判覆盖，避免误报。G5 是确定性 provider 的协议层证据，模型语义不由它代签。
- **G6 压缩后 ❌（明确不覆盖）**：两个批次均无显式压缩 checkpoint（压缩前端入口待作者设计授权，后端命令未产生真实压缩请求）；不代签。
- **结论**：CP3b 的真实请求字节证据从「机制 10/10」推进到 **G1–G5 结构切片全部成立**（G1–G4 来自实模批次 03，G5 来自 pending-08 确定性批次）；G6 仍开放，CP3b 不标 done。
- **脚本**：`b71_golden_slices_from_live_batch.mjs` 兼容 live（`request.body.messages`）与确定性（`request_body.messages`）双记录形状，按 turn 边界分组做追加式前缀检查；输出 `artifacts/b71-resume/golden-slices-{cp3b-03,pending-08}/`。

### CP4b-2 实模 usage/缓存真实观察与 G6 机制层覆盖（2026-11-03）

- **真实 usage/缓存观察（来自实模 03 批次 9 次真实调用，只读统计，不设阈值/不作 PASS 判据）**：总 input **281,482 tokens**、output **6,116 tokens**、**cached_tokens 合计 99,591（≈35.4%）**；单次 cached 分别为 0/9,228/13,233/0/24,738/0/0/0/52,392；latency 明细 7.5s/4.1s/8.5s/26.9s/10.6s/33.7s/60.5s/63.5s/6.3s；`ttft_ms` 全部为 null（该批次未走流式，如实记录）。观察结论：**原生多轮请求确实获得 provider 前缀缓存收益**（同 turn 内前缀稳定时 cached 非零，最高 52,392）；cached=0 的调用不做归因推断（可能前缀变化/缓存策略），不把命中率当固定阈值或 PASS 判据（VS-00L §6.5）。
- **G6 压缩后：机制层已覆盖、真实请求未触发**：
  - 机制层：`request_ir_test.exs` 的「G6 压缩后：checkpoint 显式携带覆盖范围，作者原话字节不变」+ `transcript_compaction_test.exs` 的端到端（派生 plan → 追加 checkpoint → Provider 投影省略 covered 交换、作者原话仍在）——**G6 的投影/证据语义已有确定性测试**；
  - 真实请求层：两个真实批次均未触发显式压缩（压缩前端入口待作者设计授权，后端命令未产生真实压缩请求），G6 的真实请求切片**不覆盖、不代签**。
- **CP4b-2 边界**：usage/缓存为观察事实；真实模型行为语义覆盖由作者行为覆盖 pilot 承担（复验待屏幕解锁）；I10 文学质量不代签。

### 2026-11-03 当前 HEAD 完整门禁复验（确定性侧收口）

- **HEAD `22fe2611`**（含 B70 行为覆盖接入、G 切片分析、§16.14 驱动、CP5 状态一致性修复；产品代码与 515c7c0b 一致）。
- `mix compile --warnings-as-errors`：0 警告；`mix credo --strict`：no issues；`module-size` ratchet：通过（83 观察文件未增长）。
- 后端全量：**2997 tests / 0 failures**（独立库 `/tmp/b71-round3-db`，`MIX_TEST_PARTITION=_r3`）。
- 场景不变量（迁移后独立库，`mix ecto.migrate` 后）：I3 **3/3**、I1 **4/4**、I2 **3 pairs / 0 violations / 0 case_failures**、I-CACHE **全部 covered+enforced**、N-NARR **PASS**。
- 统一静态扫描：**20 passed / 1 failed**（唯一 raw fail 为 gitleaks 5 个既有处置项：4 false_positive + 1 accepted_risk；**touched=0、blocking=0**）；Semgrep 0 findings。
- 结论：确定性侧与已取得的原生/实模证据在当前源码下门禁全绿；未闭环项（§16.14 原生批次、行为覆盖复验、压缩前端、G6 真实请求）均为外部环境（屏幕锁定）或作者授权（UI 设计增补）阻塞，非代码门禁问题。

### §16.14 确认批次真实进展与驱动缺陷汇总（2026-11-03 续）

- **六次尝试的失败全部为驱动实现缺陷**（如实登记，不归因环境/产品）：
  1. `cp4b-confirmation-01`：`native_b71_batch.sh` confirmation 分支漏 export `TAURI_NATIVE_ARTIFACT_DIR`，runner 建到默认目录、batch 等预注册目录超时（0 真实请求）。
  2. `cp4b-confirmation-01b`：driver 在 app 完成启动前调 activate（`is_finished_launching=false/ax_window_count=0`），激活未确认（0 真实请求）。
  3. `cp4b-confirmation-01c`：启动等待修复后 app 已就绪，但 `activateWithRetry` 检查 `activation?.confirmed`，真实 `input.activate()` 返回完整 payload（`confirmed` 在 `activation.activation.confirmed`），形状错配导致永远抛 `activation_unconfirmed`（0 真实请求）。
  4. `cp4b-confirmation-01d`：**真实进入场景**——`needs_confirmation` 到达、`available_actions=[confirm_before_execute, reject_or_cancel_confirmation]`、1 次真实 Provider 调用、AX 采集；失败于确认动作字段口径（真实确认动作无 `source_turn_ref`，候选动作才有）。
  5. `cp4b-confirmation-01e`：**确认链路真实完整跑通**——确认卡可见→点击「确认执行」→sent author_action + ACK→决定 TurnResult→executed turn_result（`tool_name=prose_writing`、`tool_status=succeeded`、`adoption_state.pending=[prose_fragment]`、`truthfulness.tool_called=true`）→ 1 次真实调用→02-after-confirm 截图显示「待确认正文片段 + 保存为章节正文」；失败仅为等待窗起点缺陷（`clickAt` 取在 ACK 之后，把已发生的子执行帧排除，极快返回 + 轮询延迟的窗口竞态）。
- **部分证据登记**：01d（场景可触发 + 1 次真实调用）与 01e（确认执行链完整成立）登记为「§16.14 确认链路可跑通」部分证据，**不代签 C1–C11**；01/01b/01c 无场景证据。
- **驱动健壮性缺陷汇总**（五个）：入口目录漏传、启动前激活、激活确认形状错配、动作字段口径、等待窗起点。它们不改变产品/判据结论，但解释了本轮原生驱动预算消耗；每个缺陷都伴随纯函数抽取/回归测试（`executedConfirmationTurnResult`/`rejectConfirmationTurnResult`、`pairToolCalls`、`extractJsonArrayAfterKey` 等）以降低复发。
- **下一步**：`cp4b-confirmation-01f-confirm` 复验（HEAD 6503df4d + 96491675），通过后自动继续 reject 批与行为覆盖 01c/#6。

### §16.14 判据假通过与独立复核发现（2026-11-03 晚）

- **01g 批次（`cp4b-confirmation-01g-confirm`）**：driver 完整、verdict.mechanism=pass，但**独立复核与逐项核实判定为假通过**——`C9` 在 `why.opened=false/why_provider_delta=null` 时仍 pass（Why 零证据）；`C5` 在 `duplicate.attempted=false(reason=not_actionable:action_missing)/duplicate_ack_observed=0` 时仍 pass（重复幂等零证据）；`C10` 只验按钮消失未验决定/结果可见与零重放；`C11` 在 `process_observation.fallback_reason=EPERM` 降级下仍 pass。**01g 不用于 PASS**，登记为「判据未修复前的假通过批次」；01f 的驱动完整 PASS 保持「部分证据」。
- **独立复核（acceptance-writer，只读）** 发现并供修复：
  - 确认判据：P0-A（缺证据仍 PASS 簇：C5/C9/C10/C11）、P0-B（C6 reject 采样窗口覆盖 source 生成必假失败 + null 容忍）、P1-1（C2 ack 身份字段在 `response.trigger` 下而判据读顶层恒真）、P1-2（决定帧按 parent 取第一条与 creative 同 parent 有取帧竞争，01e 仅差 60ms）、P1-3（C7 缺 gate-blocked/工具失败分支）、C8 缺冒充/回放负例；报告 `artifacts/b71-resume/lead-independent-review-confirmation.md`。
  - 行为判据：forbidden_behaviors 未消费、effect 从真实工具 schema 不存在的字段推导、allowed_effects 被当合取（合法 ask_author/explore 判 unknown）、HO1 绝对零计数与 states.yml 冲突、HO4 未按批次/对象限定且 2x 容差、fabricated_setting 无判据、HO6 把 source_status 对象当标量、**verifyBehaviorBatch 不校验实际 DB 状态=behavior-case.state（01 批 S1 声明未构造仍判 legal）**；报告 `artifacts/b71-resume/lead-independent-review-behavior.md`。
- **处置**：暂停 01h/02/behavior 批次；先修判据并用 01f/01g 现场离线复算验证（01g 缺证据项必须变 fail、01f 齐全证据应 pass）；01 批 legal 结论在判据修复后重新评估。修复后由 Lead 重新签发批次。

### §16.14 确认场景原生 PASS（2026-11-03）

- **01i 批次（`cp4b-confirmation-01i-confirm`，HEAD b9274321，判据加固后）**：runner **PASS（clean）**，**C1–C11 全过**（C6 not_applicable/confirm）。这是 §16.14「非采纳工具确认交接」的原生页面验收首次干净通过。
- **关键证据**：C1 source 持久；C2 ack trigger 身份（reply status/received/action_status + response.trigger 四字段 + receipt_id/turn_results 交叉 + sent source_turn_ref）；C3 handoff 新 AgentRun（`tool_confirmation_v1`）；C4 行为唯一消费（awaiting_author→resolved）；**C5 重复幂等**（确认后按钮消失 `not_actionable:action_missing` + duplicate delta 全 0：provider/agent_runs/receipts/llm_calls）；C6 confirm 模式不适用；C7 确认子执行真实（`prose_writing succeeded` + `prose_fragment` pending + truthfulness）；C8 每条请求恰好 1 条非应用数据作者原话；**C9 Why 真实打开**（visible_probe fail → scan 命中 3 个按钮 → scrollTo → scroll_retry fail → **axpress 成功** → panel_wait 成功；`llm_calls 5→5 delta=0`）；**C10 恢复不可再触发**（决定/创作结果 AX 可见、source 卡关闭、`restart_delta` 全 0）；**C11 清理**（remaining=[] + 运行态实测 app=0/4657/4661 不监听/llm-calls 停止；cleanup 的 EPERM 只记 degraded 不替代独立检查）。
- **证据**：6 张截图（01-source/02-card/02-after-confirm/03-after-duplicate/03-why/04-restored）、1 条真实 llm-calls、wait ledger 全绿、生产指纹 unchanged、无残留进程。
- **如实记录**：canon start→final 中 `author_action_receipts` 新增 1（确认受理预期）、`works`/`memory_items` rows 变但 canon 不变（排除列生效）；`chapters` canon 仍有差异（updated_at 已入排除列，疑似其它账面列）——**收口时核查**，不代签结论。
- **批次历史（如实）**：01 入口目录缺陷 → 01b 启动前激活 → 01c 激活确认形状 → 01d 首次真实进入场景 → 01e 确认链路真实跑通（等待窗起点缺陷）→ 01f 驱动完整 PASS（证据写入/判据数据源缺陷）→ 01g **判据假通过**（独立复核发现，已修）→ 01h C1–C10 全过（C11 证据时序缺陷）→ **01i clean PASS**。01–01h 失败全部只读保留、不用于 PASS。

### §16.14 拒绝场景原生 PASS（2026-11-03）——双路径闭环

- **02c 批次（`cp4b-confirmation-02c-reject`，HEAD a54d045f）**：runner **PASS（clean）**，**C1–C11 全过**（C7 not_applicable/reject）。与 01i（confirm clean PASS）一起，**§16.14 非采纳确认/拒绝两条路径均取得原生页面 clean PASS**。
- **关键证据**：C2 ack `action_status=cancelled` + trigger 身份；C3 handoff 新 AgentRun（`tool_confirmation_v1`、**child status=cancelled 合法**）；C4 行为唯一消费（awaiting_author→cancelled）；C5 duplicate not_actionable + delta 全 0；**C6 拒绝零副作用**（click-before/decision-after canon 采样窗：`works_equal=true`、仅 `author_action_receipts` 受理审计记录按设计排除、scoped delta provider/llm/mutations=0、receipt CANCELLED/author、decision_trace `cancel_waiting`、closure cancelled）；C8 作者字节逐条；C9 **Why 真打开**（scan 2 按钮→axpress→panel；llm 3→3 delta=0）；C10 恢复后决定/创作可见 + source 卡关闭 + restart delta 全 0；C11 cleanup 后实测 stopped。
- **证据**：6 张截图、1 条真实 llm-calls、wait ledger 全绿、生产指纹 unchanged、无残留。
- **批次历史（如实）**：02 驱动完整但判据未校准 reject 真实结构（child cancelled/canon 受理 receipts/取消文案）；02b C6 采样窗生效、C10 因驱动正则遗漏 fail；02c clean PASS。01g 假通过/01h C11 时序/02/02b 全部只读保留、不用于 PASS。
- **作者可见 code 泄漏（02b/02c 实扫，供后续 displayName 修复）**：`模型已连接 Stub · 当前模型：slice_verify`、取消文案 `「prose_writing」`、确认文案 `已确认「prose_writing」操作…`、`AI AI 名称`、`会话 0`、`当前创作请求的工作过程`、`已终止`、`创作执行`、`确认回合：处理作者已确认或取消的动作`、`等待你回复 · 创作执行`、Why 面板 `已从持久 trace 生成结构化回放。`（trace 术语）、`确认对象：正文草稿生成`（待判断）；正常文案不列入（`需要确认`/`确认前不会调用工具`/`保存为章节正文`等）。

### 行为覆盖 pilot #1（C-F1-003）原生 clean PASS（2026-11-03）

- **01c2 批次（`cp4b-behavior-01c2-cf1003`，HEAD da8097ba，判据加固 + B11 seed 后）**：runner **PASS**，**verdict legal=true / pass=true / allowed_result=legal**，violations=[]、unknown_reasons=[]。这是**作者行为覆盖线（B70/B72 接入）首条原生 clean PASS**。
- **真实模型行为**：strata 单槽 iq3_s、1 次真实调用、0 工具调用、run completed；模型正确回答进度事实（3 章/已写 2 章/已采纳正文 52 字符/第 1、2 章状态）并与 DB 完全一致，**遵守「先别动手」零写**、0 候选、无 ask_author。
- **判据**：observed actions=[reply]、effects=[]（**B1 修复后不猜 effect**；零写结局按 B2 或语义判 legal）；**HO1 零写 pass**（B3 修复后按 start/final delta，seed 基线 memory=2/plan=3 不误判）；**HO4 真实完成声明 pass**（进度事实与 DB 一致、无完成声明）；**state_checks ok=true**（B10/B11：chapters=3、accepted_prose=2、memory_items=2、pending=0，与 `states.yml` S1 声明逐项一致——B11 seed 补齐生效）；not_signed 如实列 `fabricated_setting_not_signed`/`trap_controls_not_adjudicated`/`HO5_reply_only_used_refs_not_available`；不代签 I10/完整 G1–G6。
- **资源**：strata 前后 loaded=null、unload 200、cleanup remaining=[]、生产指纹 unchanged、llm-calls=1、截图 3、无残留。
- **历史**：#1（HO4 判据误报、证据副本复算 pass）→ 01b（锁屏环境失败）→ **01c2 clean PASS**；#1 保持「判据误报、不用于 PASS」、01b 保持环境失败登记。
- **剩余**：#6（C-F3-002，execute→TENTATIVE）等 B1 effect echo（档位 A：append-only）实现 + 全量门禁后签发；预计 #6 若无 effect 证据判 `unknown`（不 PASS、不造假）。

### 行为覆盖 pilot #2（C-F3-002）真实模型执行失败（2026-11-04）——如实未通过

- **#6 批次（`cp4b-behavior-02-cf3002`，HEAD 1e13f8df，C-F3-002 / S1 / regression）**：driver_rc=0、runner_rc=1；**真实模型执行失败（产品 fail-closed）**：3 次真实 provider 调用、**0 工具调用、0 候选、0 pending**；模型输出被产品校验拒绝（作者安全文案：「模型返回的操作或来源没有通过校验，纠正后仍不符合约束。原请求已保留；没有生成候选或写入作品事实…」）。
- **verdict：legal=false / pass=false / allowed_result=violation**：violations=`action_not_allowed:reply`（C-F3-002 allowed_actions=[execute, explore]，真实行为只有 reply）；unknown_reasons=`HO3:not_triggered:no_side_effect_action`；HO1 零写 pass、HO4 pass、**state_checks ok**（S1：chapters=3/plan=3/accepted=2/memory=2/pending=0，B11 seed 生效）。
- **分类**：真实模型执行失败（产品 fail-closed），非 harness/驱动缺陷；**不重跑、不调判据、不造假**。B1 effect echo（1e13f8df）本次未获真实证据（无候选产出），不代签。
- **行为覆盖 pilot 结论（如实）**：`01c2`（C-F1-003 holdout 零写）clean PASS；`#6`（C-F3-002 保存请求）真实模型执行失败、未通过——两条 pilot 结论按真实结果登记，不代签完整 G1–G6/I10；该失败反映真实模型（iq3_s）能力限制与产品 fail-closed 行为，不是产品缺陷或判据缺陷。
- **资源**：strata 前后 loaded=null、unload 200、cleanup remaining=[]、生产指纹 unchanged、llm-calls=1（3 条 provider 调用）、截图 3、无残留。

### displayName P0 泄漏真实 AX 验证通过（2026-11-04）

- **AX 回归批次 A2（confirm `cp4b-confirm-01j2-ax-leak`）与 B（reject `cp4b-confirm-02d-ax-leak`）均 clean PASS**：C1–C11 + `author_visible_no_internal_tokens` 全 true。
- **P0 泄漏在真实 AX 文本中清零**：迁移期 3 类扫描（协议 code / 内部标识 / ref 模式）`ok=true、hits=[]`，覆盖 12 个文件（source/card/after-confirm/duplicate/why/restored × ax/text）。真实文案抽查：状态行「模型已连接 本地模型（测试环境） · 当前模型」、确认对象「正文写作」、取消「已取消等待；「正文写作」不会执行，也没有写入作品事实。」——`Stub`/`slice_verify`/`prose_writing`/`[stub]`/`request_ir` 零出现。
- **internal_terms_zh 命中清单（P1 迁移输入，不判红不阻塞）**：`工作过程`、`任务控制`、`创作执行`、`确认回合`、`结构化回放`、`持久 trace`。
- **批次历史**：A（`cp4b-confirm-01j-ax-leak`）FAIL 于 C10 旧正则（恢复文案已 displayName 化）——harness 缺陷已修（29638d09）；A2/B 复验 clean PASS；A 保持「不用于 PASS」登记。
- **机制状态**：displayName 机制（SSOT + 双端 codegen + Presenter 唯一出口 + 共享扫描器 + AX 断言）已在真实页面验证；P1（中文术语/Why 术语/错误码）待迁移，迁移后删除扫描器 `categories` 收窄参数恢复全类别。

### displayName P1 迁移完成（2026-11-04）

- **P1-A `9e5c26b1`**：copy.ts 中文术语迁移（工作过程→本轮创作过程、任务控制→任务操作、创作执行→创作、确认回合→确认操作、已终止→已停止、结构化回放/持久 trace→依据回放/已保存推理记录）+ 助手名「AI 助手」/ a11y「助手名称」+ 测试期望同步。
- **P1-B `6406b6fb`**：Why 面板迁 SSOT（decision 全集+unknown / context_source / gate+reason_code 句化 / run_status 补 pending·failed）；`traceSummaryView` 删除 5 张本地映射表 + toolNameLabel；copy 删 4 表 + mission status（**净 −31 行**）；测试固化内部术语清理。
- **P1-C1 `9b0df153`**：`available_actions` 表驱动（SSOT action 域 label_key 全集 + action_type 兜底集）；**删除 5 处 `return action.action_type` 内部 code 直出**（真泄漏路径）；copy 删 2 条。
- **P1-C2 `2f493b51`**：`Presenter.error_label/1` 错误码作者入口（未知兜底不回显 code）；失败 ToolResult 去 `inspect(reason)`；盘点确认作者面已无 error_code 直出。
- **P1-C3 `8264b9c1`**：**删除迁移期收窄开关**（`AUTHOR_VISIBLE_MIGRATION_CATEGORIES`/`categories` 参数全删，**净 −81 行**）；扫描器恢复唯一全类别入口、`internal_terms_zh` 启用、confirmation AX 断言全类别判红；全类别扫描前端 245 条中文字面量**零命中**。
- **测试**：harness 109/109、前端 730/730、presenter 12/0、tsc/eslint/prettier/module-size/compile/credo 全绿。
- **收尾状态**：displayName 机制（SSOT 单一来源 + 双端 codegen + Presenter 唯一出口 + 共享扫描器全类别 + AX 通用断言）完整落地，无手写 token 列表/无收窄开关双轨。剩余：全类别 AX 回归批次（P1-AX confirm/reject）与压缩自动维护 AX（A3）。

### 压缩自动维护启用（§16.16 第 2 类入口）与 A2 门禁（2026-11-04）

- **压缩自动维护启用**（`06a296bb`）：`agent_run_server.ex` 抽 `compact_and_commit/2`（显式/自动共用）+ `maybe_auto_maintain/1`（配置/终局/压力门控）+ `run_auto_maintenance/1`（plan_maintenance → compact_and_commit；**失败静默**保留旧 state + developer 日志）；接线两处（`run_next_step/1` 开头覆盖 step 完成/durable 恢复、`handle_info` awaiting_author 前）；`context_pressure.ex` 兼容 keyword/map 配置；config 产品默认 enabled/keep 4、test 默认关闭；T1–T12 单测 11/0（触发/压力未到/usage 未知/当前回合/保留 K/未完成/配置关闭/幂等/失败静默/无技术词/取消迟到结果）。
- **窗口覆盖运维配置**（`73480a47`）：`NOVEL_CONTEXT_WINDOW_OVERRIDES="provider:window,..."` → `:context_window_overrides`（运行时产品配置、不向作者展示、只影响压力阈值）；解析/缺省/非法单测；目标测试 17/0。
- **A2 门禁（B71 自动维护 + P1 全量后）**：backend-umbrella EXIT=0（全量）、compile test/dev 0、credo 修复后 13069 mods/funs **no issues**、module-size（软 ratchet）0、xref 无环、arch 0、**I1/I2/I3 全 0**、semgrep（可写 HOME）0、前端 typecheck/lint/test/audit/design-trace 全 0；仅 gitleaks 6 项既有处置与 semgrep 沙箱 HOME 两项已知环境项。
- **A3 待办**：`NOVEL_AUTO_MAINTENANCE_ENABLED` env 映射（运维开关，已批准实现）+ native-runner 的 auto-maintenance driver journey → A3 预注册（真实 strata + 小窗口 + ≥2 次续行制造压力；无法形成压力则如实登记未闭环）。

### displayName P1 全类别 AX 验证通过（2026-11-04）

- **01k2（confirm `cp4b-confirm-01k2-ax-full`）与 02e2（reject `cp4b-confirm-02e2-ax-full`）均 clean PASS**：C1–C11 + `author_visible_no_internal_tokens` 全 true；**AX 全类别扫描 ok=true、hits=[]、internal_terms_zh_hits=[]、12 文件全覆盖**。
- **P1 目标达成**：迁移期曾单列的 6 个中文内部术语（工作过程/任务控制/创作执行/确认回合/结构化回放/持久 trace）在真实页面**全部清零**；`Stub`/`slice_verify`/`prose_writing`/`[stub]`/`request_ir` 与中文术语均零命中。真实文案抽查：状态行「本地模型（测试环境）」、确认对象「正文写作」、取消「已取消等待；「正文写作」不会执行，也没有写入作品事实。」。
- **C9 Why 修复验证**：01k 的驱动缺陷（openWhy 误用纯观测 dump 做交互定位 + 重试不足）已修（`b2253fc8` 有界重试 + `77e26518` 改用 `dumpNodesForInteraction` 交互恢复路径）；01k2 现场 attempts 显示 `scan count=3/nodes=101 → scroll_to → panel_retry_scan/axpress → panel_wait 成功`、`llm delta=0`。01k 保持「FAIL（驱动 Why 时序）」登记。
- **扫描器状态**：全类别唯一入口、无收窄开关、无手写 token 列表双轨（P1-C3 已删，净 −81 行）。
- **剩余**：A3 压缩自动维护 AX（driver 实现中：真实 strata + 小窗口 + ≥2 次续行制造压力 → 自动整理 → 细条/展开/完整记录/下一请求精简/刷新幂等/失败静默/无技术词）。

### A3 压缩自动维护 AX：未闭环（2026-11-04，如实登记）

- **批次事实**（`cp4b-auto-maint-a3`，HEAD 079cabd6）：driver_rc=0（**6 次真实续行完成、16 次真实 strata 调用**），真实 usage `input_tokens` 9010→35139（窗口 4096 的 2.2–8.6 倍，压力明确越界）；但 **`checkpoint_created`=0、细条未出现、`triggered=false`** → 按降级规则整批登记**未闭环**，证据只读保留、不重跑、不伪造。
- **根因（已诊断，非开关/环境/产品 bug）**：产品自动维护语义为「**当前 run 的 canonical transcript** + **当前 run 的 usage**」——`ContextPressure.maintenance_due?` 按 `agent_run_id` 读 usage；`plan_maintenance` 的「更早工作回合」= 同 run 内最后一条 user 之前且保留最近 K=4、当前回合不整理、未完成不选。A3 的 6 次续行各自是**独立 run**，每个 run 只有当前回合 → 无可整理交换 → **正确不触发**（46 §9.9 第 7 条已冻结：整理针对当前 run 会话，跨 run 历史由上下文组装负责，不得冒充）。
- **分类**：A3 场景设计缺口——真实外部驱动需构造「**同 run 内 ≥2 个作者回合 + 更早回合 >4 个完整交换 + 真实 usage 越线**」，可行路径（后续 A3b 候选）：多步长任务 run → `awaiting_author` → 同 run `steer`（真实控制坞入口）追加第二回合 → 继续 step → 安全点触发。依赖真实模型产生多步长任务/等待行为，不确定性高；**不造场景、不调 K/窗口凑触发**。
- **已覆盖**：自动维护触发链路（安全点/阈值/unknown usage/未完成不压缩/保留 K/幂等/失败静默/事件持久化）由 T1–T12 单测覆盖；真实页面验收待产品路径可稳定构造后再跑（A3b）。
- **次要缺陷**：runner verify 读 `strata-slot.json` 早于 driver finally 落盘（证据时序竞争），native-runner 修复中（驱动/证据缺陷，非产品）。

### CP5 最终收口：全量门禁与静态扫描（2026-11-04）

- **最终全量门禁（HEAD ec36b3b4，独立库 `/tmp/b71-final-db`）**：
  - 后端全量 **3057 tests / 0 failures**（9 app 串行：foundation/common/agent/test/domain/persistence/application/web/e2e）
  - 前端 **730 passed**（typecheck/lint/test/audit/design-trace 全绿）
  - `mix compile --warnings-as-errors` 0 警告、`mix credo --strict` 0 issues、module-size（软 ratchet）通过
  - `mix xref ... compile-connected --fail-above 0`：**No cycles**；`arch_check`：通过
  - **I1 4/4、I2 3 pairs/0 violations、I3 3/3**；Semgrep（可写 HOME）EXIT=0
- **完整静态扫描（最终）**：`artifacts/b71-resume/final-gate-v2/static-scan-full2.log` —— **20 passed / 1 failed**（唯一 raw fail = gitleaks 6 项既有处置：5 false_positive + 1 accepted_risk，touched=0、**blocking=0**）；Semgrep 全量通过（`leak_scan.mjs` 的 `detect-non-literal-regexp` 经受控 SSOT 输入说明 + `nosemgrep` 注记闭环，修复提交 `61f7d4a8`）；task-done manifest 在干净工作区下按规则跳过。
- **资源矩阵**（全部如实登记，不代签）：§16.14 确认/拒绝双路径 clean PASS（01i/02c + 01k2/02e2）；pending 08 原生 77/77；CP3b 实模协议层机制 10/10 + G1–G5 切片；行为覆盖 pilot #1 clean PASS / #2 真实模型执行失败（如实未通过）；displayName P0+P1 真实页面全类别扫描零命中；压缩 A 方案设计/阶段 4/阶段 5/自动维护实现完成、**A3 真实页面验收未闭环**（场景设计缺口：跨 run 续行不属于维护范围，46 §9.9 第 7 条冻结；A3b 构造路径见 `artifacts/b71-resume/compaction-auto-trigger-ax-prereg-brief.md` §7 与 `artifacts/b71-resume/auto-maintenance-a3-recovery-notes.md`）。
- **环境限制**：Pencil PNG 待有 Pencil 环境导出（帧已 Draft 落地 pen）；macOS 锁屏曾阻塞批次（环境失败如实登记）。

### 记忆管理面板内部 code 泄漏修复与真实页面回归（2026-11-04，作者截图报告）

- **问题（作者截图）**：记忆详情面板直接显示内部编码——`CONFIRMED`/`WORK_DIRECTION`/`WORK`/`AUTHOR_CONFIRMED`/`candidate:…`/`candidate_set:candidate_set:…`/`decision:…`/ISO 时间。
- **修复（机制正解，非逐点替换）**：
  - SSOT `display_names.json` 扩展 `memory` 域（memory_status/type/scope/source_type/tag）、`session_status`、`narrative_role`（共 21 domains）+ author-safe fallback；双端 codegen 重新生成（同 source_hash，`--check` in sync）。
  - `MemoryDetailDrawer` 全部经 `displayName`（删本地 TYPE_LABELS）、tags 过滤内部 ref 前缀、时间本地格式化（`formatMemoryTime`）；`memoryListView`/`MemoryListPage`/`MemoryCreateDialog` 映射与枚举收敛 SSOT（删 copy 三张表 + 本地枚举数组）。
  - 结构面板未知状态 fallback 安全化（`statusUnknown`，不再回显 code）；`WorkspaceChat` 会话状态与 `archiveDetail` narrative_role 走 SSOT。
  - **产品侧根源修复**：`memory_management_service` 三处作者可见治理动作/引用摘要（create/锁定阻止/lifecycle 迁移）改经 `AuthorVisible.Display.label`（此前拼 `状态 DRAFT；类型 FORESHADOWING；作用域 WORK`）。
- **真实页面回归（memory-detail journey）**：`cp4b-memory-detail-ax3` **clean PASS**（D1–D8 全 true）——全类别扫描 **hits=0**；详情治理动作文案 = `作者创建记忆草稿：状态 草稿；类型 伏笔；作用域 整部作品。`（无内部 code）；tags 无内部 ref、时间本地化、无重复前缀、导航与清理通过。旧批次 ax（Vite 端口环境失败、零证据）/ax2（D2/D3 产品残留 + D8 harness 时序）保持 FAIL 登记、不用于 PASS。
- **证据链**：`4d62bebe`（journey 实现）→ `81142993`（verify-before-cleanup 时序修复）→ `34ec9111`（产品治理文案修复）。

### A3b 早期 smoke 记录（2026-11-04，交互已由后续重构替换）

> 本节描述重构前页面入口，不适用于当前“等待即回答”语义；同 run 多回合现在已可构造。

- **推进过程（3 次非验收 smoke，不产批次证据）**：
  - smoke1（长任务请求「读两章+对比+下一步」）：run 直接 `completed`，1 个作者回合、4 次真实调用（usage 9006–17122，远超窗口 4096×0.70）、成功完整交换约 2 → `checkpoint_created=0`，**正确不触发**（单回合 + 更早交换 <K=4）。
  - smoke2（变体「先问我确认选哪个，再动手」）：**成功诱导 `awaiting_author`**（iq3_s 自然停顿，问题卡出现）；真实问题卡 AX 结构 =「选项A/B」+「回复此问题」按钮 + 底部输入框 +「发送」（提示：下方输入会作为新请求发送）；usage 9080 越线；第二回合未发生 → 无 checkpoint。
  - smoke3（经修复的「回复此问题」路径）：UI 操作全成功（找按钮/输入/发送均 ok），但**回复创建了新 turn/新 run**（DB 两个 run：run1 awaiting_author 1 回合；run2 新 turn、1 回合、继续执行）——**产品交互语义：ask_author 回复起新 run，不向同 run 追加** → 同 run 仍只有 1 个作者回合。
- **判定**：**C1 真实压力成立**（usage 越线）；**C1b（同 run ≥2 作者回合）在该产品/模型组合下不可构造**（iq3_s 不产生同 run 多回合；ask_author 回复起新 run）；**C1c 不足**（每 run 1 回合、成功交换约 2 <K=4）→ 不触发是**正确产品语义**。
- **结论**：A3b（压缩自动维护真实页面验收）**受真实模型行为（iq3_s 不产生同 run 多回合）与产品交互语义（ask_author 回复起新 run）双重限制，未闭环**——不伪造、不注入、不调 K/窗口凑触发。安全点自动维护触发链路已由 T1–T12 单测覆盖；真实页面验收留待更强模型/未来交互（同 run steer 运行中入口）再验证。
- **保留资产**：同 run 多回合驱动与 smoke 入口（`bc89447c`/`4d57f075`/`eabd81af`，含真实「回复此问题」路径）供未来复用；证据 `artifacts/b71-native/a3b-smoke-cp4b-auto-maint-a3b-smoke{,2,3}/`；结论 `artifacts/b71-resume/auto-maintenance-a3-recovery-notes.md` §6。

### 「等待即回答」交互重构（2026-11-04，作者拍板 + 重构授权）

- **问题（真实批次可复现）**：等待回答模型问题时存在两个竞争输入入口——消息流问题卡（正确路径，`author_choice` → 同 run 恢复）与底部主输入框（新讨论 → 新 run）；作者最顺手的底部输入恰好是错误语义（A3b smoke3 复现：误入主输入 → 起新 run、原 run 悬挂 awaiting_author）。业界共识（Claude Code `AskUserQuestion`、MCP elicitation、AG-UI interrupt-resume）是**等待用户输入时只有一处回答入口且默认延续原任务**。
- **重构（前端，`58274845`）**：
  - 46 §9.7 改写为「等待即回答」：底部主输入区接管为回答模式；回答消费原 run steer 机制（同 run 继续）；**「开始新讨论」为显式动作**；消息流问题卡只读记录；旧「未绑定主输入开始新讨论」语义废止。
  - 输入区语义收敛为统一模式模型：`AgentRunInputMode` + `deriveAgentRunInputMode(decision, presentation, {answerModeDismissed, blocked})`（answer_question/steer/new_discussion/blocked），视图只按 mode 渲染；单测覆盖接管/显式新讨论/歧义/steer/blocked。
  - 组件职责单一化：新增 `AgentRunAnswerPanel`（底部回答模式）与 `AuthorQuestionRecord`（消息流只读记录）；`AuthorQuestionReply` 回归纯作答组件（移除 readOnly 形态补丁，问题文本下沉）。
  - Pencil：新增 `46§9.7-answer-mode (EU5Qh)` 与 `46§9.7-question-record (xBdER)` 两帧（Draft）。
- **重构（后端，`d6513362`）**：`AgentRunServer.submit_author_question_reply/4` 显式入口替代 steer map 隐式重载（`%{author_question_reply: request}`）；删除 B31 CP1 遗留 4 元组 map 兼容分支；`steer_submission/4` 限文本（`when is_binary`）——作者输入种类在两端显式表达。
- **验证**：前端 typecheck/lint 绿、全量 **744/744**、设计追溯 **28 通过 / 0 警告 / 0 失败**；后端全量 **3057 tests / 0 failures**、credo 0 issues、module-size 通过、xref 无环、arch 通过；已推送（`d6513362` + 设计帧提交）。
- **后续**：native-runner 适配新回答面板 AX 定位 + A3b 复验（同 run 回答 → 多回合 → 自动维护链路）。

### A3b 当时判断记录（2026-11-04，失败归因已纠正）

> 本节保留当时过程，不能作为当前归因或收口结论；原始响应证明与本节“参数被拒绝”的判断不符，当前结论见末节「A3b 失败归因纠正」。

- **「等待即回答」交互重构后**（§下）回答真实走 `author_choice` → 同一 run 恢复，不再起新 run。3 次 smoke 验证：
  - **smoke6（选项A，HEAD 3be617c3）**：点击选项A → `run_resumed` + `plan_adjusted`；同 run `user_turns=2`、无新 run；provider 1→3（usage 越线）；随后 `run_failed`（iq3_s 执行失败）。
  - **smoke7（选项B）**：同 run 2 作者回合 ✓；继续后 `run_failed`。
  - **smoke8（FREE_TEXT「按A线推进，但先只写一段验证」）**：回答成功、**同 run 2 作者回合 ✓、无 `run_failed`**；但 tool_calls=2、**observations=0**、validation_results=2（iq3_s 的 tool_call 两次都被契约校验拒绝）→ 更早回合交换 <K=4 → `checkpoint_created=0`、细条不可见（**不触发=正确产品语义**）；全类别扫描 hits=0。
- **判定**：**C1（真实压力）成立**；**C1b（同 run ≥2 作者回合）在新交互下已可构造 ✓**；**C1c（更早回合 >4 交换）受 iq3_s 执行质量限制不可满足**（回答后 tool_call 契约失败率高、observations=0，交换无法增长；run 无法正常完成）。**A3b 仍如实未闭环（受真实模型执行质量限制）**——不伪造、不注入、不调 K/窗口；自动维护触发链路由 T1–T12 单测覆盖。
- **附带成果**：「等待即回答」交互经真实批次验证生效（回答=同 run 恢复、无新 run、`user_turns=2`），A3b 唯一的模型侧缺口不再是交互语义。
- **证据**：`artifacts/b71-native/a3b-smoke-cp4b-auto-maint-a3b-smoke{6,7,8}/`（driver-log、截图、DB transcript、validation 失败、usage 越线）；恢复指引 `artifacts/b71-resume/auto-maintenance-a3-recovery-notes.md` §6.5。
- **提交**：`fdbacccc`/`2e5bd4dd`/`e8fd6840`/`204cc939`/`2d2b0d9a`（驱动适配与选项/文本入口）。

### 已提交子运行启动事实交接（2026-11-04 接续复核）

- **当前基线**：HEAD `7698f162`，工作区仅 `frontend/src/components/WorkspaceChat.tsx` 有作者未提交改动，保留不动。中断前旧代码与任务计划已被后续提交推进，不能按旧上下文重复实施。bridge已核无遗留活动job；本次重新派发的是当前事实对账与已复现缺口。
- **真实来源**：`b71-authoring-confirmation-tauri-native-cp4b-confirmation-01k2-confirm-ax-full` 的 child `run_mw0ybrf6_1g`：DB有 `run_started(1)`、`tool_started(2)`、`tool_completed(15)`，真实 WS 仅 `artifact_created(17)`、`run_completed(19)`。当前 `AgentRunServer.init` 的 committed 分支从空 events/序号0/defer_delivery=true 开始，而 Admission 已另外提交初始事件。证据 `artifacts/b71-resume/leader-committed-startup-real-source-20261104.json`。这是生产者交接遗漏，不由前端补拉/补猜或更宽校验解决。
- **Contract**：VS-00L §16.8/§16.10/§16.14、既有 AgentEvent 与 AgentRun 结果事务。启动事实单一生成、提交后发布，再由同一事实继续执行。
- **Invariant**：内存与持久事件 ID/序号/内容同源；已提交启动事件恰一次发布；工具/Provider进度不被遗留 defer 压住；结果事务仍先提交后广播；作者动作、候选字节与实际预算不变。
- **Boundary / Consumer**：application 的 startup fact factory、Admission、AgentRunService/Server/Persistence；consumer为现役Channel事件流与恢复/回放。前端、Provider adapter、领域规则、持久冲突处置及页面判据不改。
- **Proof**：真实作者动作受理入口，在首个模型响应返回前验证已收到与持久row同源的启动/工具事件；事件序号不重用、非stream内存/DB一致、重复动作不重启；普通run/质量修订/确认交接回归与完整后端/不变量。旧批次只读，不补写旧WS。
- **Acceptance Driver**：复用当前确认原生场景验证新的实际事件链；验收应另行预注册且在源码静止后执行。产品验收感知逻辑 no。本次不将历史C1–C11 PASS当新事件链证明。
- **Exploration**：不物化新作品要素、不改变模型作品知识供给；只恢复既有运行事实的持续发布，原Request IR/canonical/used refs保持。
- **交付**：worker `b2d787ff` 实现，leader 独立真实 Channel/receipt 回归 5/0；`8930c432` 已提交并进入共享远端。该单元完整后端当时 3063/0，报告 `artifacts/b71-resume/worker-committed-startup-handoff-20261104.md`；不替代后续 HEAD 的整体验证。用户已确认其他会话结束，后续统一接续。

### A3b 失败归因纠正（2026-11-04，原始证据优先）

- 6301e69a审计终态；leader又独立读取smoke6/7/8的只读SQLite与canonical validation，复核文件 `artifacts/b71-resume/leader-a3b-failure-classification-20261104.json`。旧批次和旧报告不回写，本节纠正此前“回答后工具契约失败率高、模型无法产生有效交换”的当前结论。
- **smoke6**：首次ask_author参数非法，随后同调用原参数与失败反馈进入下一真实请求，模型已纠正；回答后的judgment_decision为passed。**smoke7**：两条已捕获调用均passed。两者最终执行步为0，失败发生在应用 `pending_artifact_invalid/incomplete_scope`，不能归为回答后的schema违约。
- **smoke8**：两条已捕获调用均passed，无run_failed；结束时run仍running、第三次调用未取到完整响应，批次因 `native_evidence_verification_failed` 结束。不能把未完成响应写成“两次被校验拒绝”。
- **读侧口径**：driver统计顶层message.tool_calls，但canonical的真实位置是blocks；原complete_exchanges=0不作证明。按产品口径离线重算更早回合完整交换为2/1/1，仍不足K=4。因此这些样本未触发维护的事实保留，但“模型能力导致不可构造”尚未被证明。
- **下一步取源边界**：应用提示要求模型在dialogue_goal表达修改范围，实际授权只从run.goal.text（回答后为选项标签/答案）读取。先梳理原任务、作者回答、当前目标与授权范围的真实来源，不能改为信任模型自述范围，也不能通过调K/窗口凑触发。新answer来源标记提交晚于smoke8，旧批次不代签其持久恢复效果。
- **完整证据审计**：`artifacts/b71-resume/closure-audit-20261104.md/json` 确认 Responses 原生投影/SSE、G6、真实流式/取消和确认失败分支仍缺证。需纠正审计范围：ADR-0033 §10.2 与 VS-00L §14 的 G8 冻结的是离线恢复事实及不调模型，自动重启执行没有由此获准；不能把“未证明自动执行”扩写为必须新增自动执行。恢复的权限与当前作者动作仍按既有契约处理。

### 统一接续与源头重构（2026-11-04，当前）

- **作者补充原则（Accepted）**：项目尚未发布，不要求历史版本兼容；现役消费者迁移完成后，删除退役分支、适配外观和只保护退役行为的测试。历史证据保留只读，不等于运行时代码必须能读所有旧格式；不删除作者数据。架构与设计冲突先回到元原则、实际来源和官方行业资料裁定，不追加兜底形成双轨。UI 使用现有 Pencil 原型作为参考。
- **已独立验收的源头修正**：执行 Task 与订阅者都产生 DOWN，原通用订阅者分支抢先吞掉 Task 退出；恢复按 `current_task_ref` 的分派顺序，真实 kill Task 后进入失败，订阅者退出不影响执行。历史事件补拉从 Web 直读 Persistence 改为 Application 的 `AgentRunEventQuery`，Web 只解析 wire/投影作者安全字段。scope/since 由入口解析后内部信任，不重复 normalize；外部 run_id 和持久归属仍在读取边界判定。
- **该单元七问**：Contract = 既有 AgentEvent、`agent_events_since` 与 VS-00L §16.12–16.14；Invariant = monitor 按实际 owner 分派、历史只读/作用域归属、Web 不越层；Boundary = application/web（不改 domain/agent/persistence 行为）；Consumer = WorkspaceChannel 补拉和现役执行 owner；Proof = 真实 Task/订阅者退出、应用查询、真实 Channel，leader 独立 64+8 tests/0 failures，日志 `artifacts/b71-resume/integration-20261104/target-tests.log`；Acceptance Driver = 既有外部 Tauri 确认场景补当前源码事件证明，产品验收感知逻辑 no；Exploration = 不物化作品知识、不改模型输入。
- **下一项架构决策**：canonical IR 保持 provider-neutral；Gateway 解析实际 provider/model/purpose/route_hint 的唯一配置快照，在同一边界派生能力、选择原生投影并交给 adapter。撤销 RequestIR 内默认 Gateway 查询，以及执行时再次比对/补救构造侧 route 的双轨。Responses 直接消费自己的原生 items；工具调用原参数、call_id、Provider 私有回放材料不经 Chat 形态绕行。先完成真实消费者清单与契约修订，再分可验证单元实施。
- **当前验证**：全量后端 3079/0、I1/I2/I3、dev/test 强制零警告编译、xref/arch 通过（`artifacts/b71-resume/integration-full-20261104/`）；随后机械清理两处 Credo alias 建议及两个无消费者测试残留，22 项目标测试与 Channel 单测通过、Credo 无问题。前端 typecheck/lint/483 项测试通过，设计追溯 25/0，Tauri app+dmg 构建通过。记忆证据脚本补真实进程/端口观察后独立 16/16（0 skipped），四类显示名改读 SSOT，原正则拼接删除；mutation 76 killed/8 等价存活/0 uncovered，未加抑制。统一扫描和新 C12 原生页面证据仍待收口；完整 B71 继续 doing。


### 原生投影与流式链路的消费审计（2026-11-04）

- 消费清单：`artifacts/b71-resume/projection-consumer-inventory-20261104.md/json`（leader 已抽查 Gateway、NativeToolExchange、四类 adapter 与真实调用方）。三种 projector 中当前只有 ChatCompletions 有生产调用；另外两种不能用 golden 通过冒充生产贯通。`provider_projection_target` 与 `capability_profile` prompt 字段无生产读取者；运行时仅比较构造时写入的 route 身份。
- **新增源头事实**：OpenAI-compatible/DeepSeek/LMStudio/Anthropic 在 `tool_call_prompt?` 为 true 时强制走非流式。现役判断 `tool_choice=auto`、写作具名工具都落到此分支；已有 SSE tool-call 测试用 `tool_choice=none` 触发流式，只能证明 decoder，不能证明实际工具调用链。当前正文预览提取器位于非流式结果的分块物化处，不能据此声称真实 token 已到页面。后续需让工具选择与交付模式分别表达，按实际 SSE 推进状态。
- **R1 统一请求边界**：保留完整 canonical IR 到 Gateway；实际 provider/model/purpose/route_hint 只解析一次，能力与投影消费同一 state。IR 构造不查询配置，删除默认 route 元数据及下游身份二次补救。三类 adapter 各消费原生投影；系统身份、工具集合/选择、原始参数与私有回放材料在此边界不丢失。只用于旧投影测试的 prompt helper 随消费者迁移删除；设定盘点、章摘要和工具结果叙述三个仍在运行的文本消费者必须显式迁移，不能因旧形态直接删功能。
- **R2 同一流式生命周期**：工具调用不再隐式选择非流式。统一 existing HTTP cancellation/deadline/silence 生命周期，协议 decoder 分别累积 Chat/Anthropic/Responses 原始事件；工具参数在结束前只作增量事实，完成后归一；保留 call_id 与 raw_arguments。Responses item_id 与 call_id 分属不同用途，不混用。私有 reasoning 按真实 provider/model 绑定回放，不展示给作者。正文预览只来自实际正文数据，不能展示被截断/错误解码的转义内容冒充正文。
- **实施七问**：Contract = ADR-0033、VS-00L §6/§16.5/§19 与 ProviderRun/Event/Output；Invariant = canonical 唯一事实、实际 route 单源、原文/工具关联/usage/取消不丢失；Boundary = agent 投影/传输与 application 现役请求构造，domain/persistence 授权不变；Consumer = judgment、writer、evaluator、planner/mission 及三个文本消费者；Proof = 各真实 Gateway→HTTP 形状、按用途选模型、auto/具名工具流式分片/取消、私有回放、G1–G8 与全量/invariants；Acceptance Driver = 当前 Tauri 创作/确认场景外部驱动，捕获实际请求/SSE/页面/持久结果，产品验收感知 no；Exploration = 保留最小 Base、同批探索、下一实际请求观察与 used refs 绑定，不靠新增 packet 补漏。
- R1/R2 为既有 CP4b 的执行单元，不缩小原范围。交接/查询/证据质量单元已收口；R1 请求边界迁移按 VS-00L §19.1 开始，R2 尚未实现，均不标完成。

### R1 实际路由与原生输入迁移（2026-11-04，实现已落地、待独立验证）

- 基线 `107f3b99` 已推送，工作区在开工时干净；最终 Node 1090/1090、开工 `mix compile` exit 0。此前后端/不变量/静态扫描与原生缺口按后文保留，不把旧结果当成新实现验证。
- 设计按 VS-00L §19.1：`prepare_request` 返回 canonical IR，Gateway 按本次实际 route 判断能力，adapter 直接投影原生协议。删除默认 route 查询、双身份比对、Chat 中间层和测试专用 prompt 文本读取逻辑；后者随 Stub 移到 test/support，通过测试配置显式注册。真实直接文本调用仍需后续迁移，不能捏造 AgentRun。
- 分工：core `b8bd3a4e/c41e0224` 已局部交付；application/test-support 首阶段 `b137e722` 因重复工具逻辑和虚构 canonical 形状被取消，`d0ef67da` 交付了源码迁移、未执行测试。脚本 `2dff27f2/4b2effc8` 已完成接线与规则对账，并撤回了未经批准的共享历史样本。`8a577eb1` 初始快照源修复、`d6c4a968` 清理测试消费者并恢复必要的 Stub 模拟能力声明、`79f1957d` 迁移 Node 原生证据读侧。**上述改动均已并回当前工作区（未提交）；worker 局部报告不构成实现验证，leader 最终复核与 R1 后全量门禁尚未执行。**
- 补充消费者事实：`scripts/scenario_invariants/run_icache_prefix.exs` 使用 draft/revision/mission prompt helper 与 `Provider.prompt_text`。旧审计“仅测试-facing”不代表无人消费；helper 退役后此 driver 必须沿真实生产调用捕获 IR/实际投影，保持原案例、门槛与判据。不得删门禁、放宽判据或用测试包装层恢复旧桥。
- 证据读侧也属于本次真实消费者：`authoring_call_evidence` 当前要求 fixture 的 `provider_prompt/v1`，多个原生判据从 `messages.content/tool_calls` 读取；fixture 收到 IR 后须如实记录真实版本/来源，读侧按该格式解析。不能将重建的 Chat body 冒充 fixture 实际收到的请求，也不能靠旧 fixture 测试继续通过代签新格式。leader 源码审查留在 `artifacts/b71-resume/r1-leader-review-20261104/in-progress.json`，尚非完成证据。
- 其余冻结/探针脚本也需随 R1 核对：`scripts/b27_case_freeze.exs` 仍按 legacy prompt 形状读取捕获结果；本次仅把 `prompt_builder` 元数据改为 `request_for_production/2`，历史快照 JSON 按证据只读保留。R1 后其 `--check`/重冻路径尚未验证，属验收资产迁移缺口（B71 后续处理），不能以旧快照 PASS 代签 R1。**2026-11-06 作者裁决：已退役删除冻结器脚本，历史快照只读保留；需要时按 R1 形态重建（见 B27 任务文档）。**
- 当前 Pencil MCP `get_app_state` 返回 Transport closed，未读写 `.pen` 文件。原生系统提示仍等待作者处理，不绕过电脑控制工具对系统应用的限制。R1 不新增 UI 感知验收逻辑；Stub 相关前端退役分支与后续 R1/R2、G6/CP5 仍需逐项收口。
- **已独立复现的新证据**：真实路由/原生 body 新回归 10/10；纯投影 probe 另发现合法 system 角色在 Anthropic 被降为 user，`c41e0224` 已修并交付 305+7 项局部绿，leader 后续复核。真实 I-CACHE 独立输入失败：shared=16332、boundary=18379，日志 `artifacts/b71-resume/r1-leader-review-20261104/icache-actual-production.log`。旧 `prompt/2` 是不同顺序的 giant prompt helper，不是当前生产入口；不以共享历史替换样本。**初始快照已按 VS-00L §19.2 实现**：`JudgmentProtocol.transcript_for_production/2` 一次生成实际 scope，经 `AuthoringTranscript.new(initial_scope:)` 按 `application_base → initial scope_update → user` 构造；新增 `apps/novel_application/test/novel_application/judgment_initial_snapshot_test.exs` 与 `apps/novel_agent/test/novel_agent/provider/native_boundary_r1_test.exs`（均在工作区、未提交、未运行）。真实 I-CACHE 独立输入的重测证据尚未记录，不得用旧红例或共享历史样本代签通过。
- **初始快照单元七问**：Contract = VS-00L §19.2、VS-00I §4.2 与既有 I-ART-2/10/13/14；Invariant = 首次快照按稳定 Base/实际 scope/作者原话建立，已有历史只追加且字节不变；Boundary = application 的 JudgmentProtocol / AuthoringTranscript，不改 domain/persistence/adapter 投影顺序；Consumer = 首个真实判断请求及其后续恢复；Proof = 原 I-CACHE 独立输入红例、Gateway 捕获/三类投影、原作者与来源、重复构造幂等、续行严格前缀和 JSON 恢复一致；Acceptance Driver = 既有真实 Tauri 创作/确认链，产品验收感知 no；Exploration = 仅重置首次组装职责，不增加或复制材料/packet，观察与 used refs 原绑定保持。


- **2026-11-04/05 R1 收口（实现 + 确定性门禁；已提交，不代签页面/实模）**：统一请求边界本轮完成并独立验证——
  - `RequestIR.prepare_request/2` 只选本次工具与 `tool_choice`；Gateway 按实际 route 单次解析并派生能力；Chat/Anthropic/Responses 三类 adapter 直接消费原生投影（Responses function_call 只认 `call_id`，`item.id` 不再冒充工具身份）。
  - 三个直接文本消费者（章摘要 `ChapterSummaryGenerator`、设定盘点 `FactInventoryService`、工具结果叙述 `Planner.narrate_tool_result/3`）经 `RequestIR.text_operation/1` 迁移（真实操作 profile + `application_base`，不伪造 run/session 或作者消息）。
  - 删除：`to_provider_prompt/2`、`Provider.normalize_messages/2`、`SystemIdentity.inject/1`、`put_openai_tools/2`、adapter/Gateway legacy prompt 分支、`finite_mode legacy_prompt/legacy_json_content` 万能覆盖、IR `provider_session`、IR `system.identity_ref` 假标签；`Real`/`ProseQualityEvaluator` 不可达的纯文本 JSON fallback 一并删除。
  - 身份真源：IR `system.identity_ref == SystemIdentity.identity_ref()`；transcript/checkpoint 只持久化 run 级规则（instructions/run_role），旧检查点恢复不再因身份版本变化失败。
  - 门禁（独立测试库）：后端全量 **3085 tests / 0 failures**（9 app；e2e 1/0）、`compile --warnings-as-errors` dev/test 0、`credo --strict` no issues、`xref` 无环、`arch_check` 通过、`module-size` 通过、**I1 4/4、I2 3 pairs / 0 violations、I3 3/3、N-NARR PASS、I-CACHE 4/4 行 covered+enforced**；前端 typecheck/lint/**486 tests**/audit/design-trace 全绿；统一静态扫描 **19 passed / 2 failed**（唯一两项为如实登记项：gitleaks 6 项既有处置；UI 改动需新 Tauri 页面证据而原生批次受 macOS 系统提示阻塞 → task-done manifest pending，不伪造）。
  - 未获证（不得代签）：真实模型语义/缓存/usage、R1 后真实 Tauri 页面证据、Responses SSE（R2）、G6、CP5。

### 多窗口事件分发的真实重复复现（2026-11-04，待源头重构）

- `artifacts/b71-resume/event-delivery-source-probe-20261104/` 的公共服务与两个真实 Channel 探针证明：同 caller 启动 default sink 后重连，持久 `event_id` 只一份但接收两次；重复 attach 的 monitor 数为 0→1→2→3，sink map 始终仅一项。初版双 Channel 只证明 topic 重复广播；leader 指正后，新 `transport_probe.exs` 删除 forwarder 的 topic 订阅，实收 Phoenix.Socket.Message：同一事件 A/B 两个 transport 各 2 份、Broadcast 计数 0（`result-transport.json`）。这是 Channel→NoopSerializer→transport_pid 证据，不是生产网络或 GUI 证据。探针退出后测试事务行数归零，未改产品或旧批次。
- **根因**：runtime 同时向 default 和 dynamic sinks 发布；每个 Channel 又向整个 workspace broadcast，形成两次扩散。不是前端去重不足，不以丢弃相同 event_id、增加去重缓存或捕获异常遮盖。
- **源头方案**：应用层持有单一按 work/session 分发的事件订阅边界；Channel 只在 join 时订阅一次，将收到的 run 事件/该事件派生的快照和结果 push 到自身连接。运行 owner 只发布一次，不持有窗口回调或 subscriber monitor。删除 default/dynamic 两套 sink、attach/reconnect 中的窗口注册和相应退役测试；重连只恢复事实，订阅生命周期归 Channel 进程，进程退出自动清理。沿实际 scope 保留 work-wide 与 session 订阅，不靠消息时间或文本猜归属。
- **七问**：Contract = AgentEvent/运行事实提交、既有多窗口与重连语义；Invariant = 每个订阅连接每事件一份、一个窗口退出不影响运行和其它窗口、scope 不跨作品/会话；Boundary = application 事件发布与 Web 消费，domain/agent/持久化事实不变；Consumer = 当前 WorkspaceChannel；Proof = 将上述两个真实复现转为回归，加跨 scope、订阅者退出、首事件/重连快照与最终结果测试；Acceptance Driver = 真实 Tauri 确认与重连场景，C12 实时同源判据，产品验收感知 no；Exploration = 不涉及作品知识新增或模型供给变化。
- **实施中**：首阶段 worker `af4b3a9e` 已做出新分发路径，同一双 transport 探针各收 1 份（旧路径各 2 份）；leader 因测试门面不符合退役原则而停止该作业，保留其中间证据。`408d61e8` 已删除 TestAgentRunService 门面并完成真实服务/push 消费迁移，完整后端 3085/0；旧不变量 driver 还在用退役 callback，leader 终止长等待后由 `0f102c21` 完成真实订阅迁移，I3 Layer-A/B、I1、I2、N-NARR 全通过且无 owner timeout。最终证据为 `scoped-events-final-20261104/` 与 `invariant-event-consumers-20261104/`。`517d00a9` 修复 Task DOWN 被吞的独立问题，不据此关闭整项多窗口语义。最终统一扫描与原生回归在新结构上执行，再推进 R1/R2。


### 确认验收职责重构（2026-11-04，局部验收完成、原生未闭环）

- C12 实时启动事件判据先由现役确认 evaluator 接入，31 项正反例通过；leader 又移除无依据的 tool_started 数量上限、DB 重复主键/null 行保护。多个合法工具启动按各自 event_id/sequence 验证，不补造事件。
- 独立质量门发现不能继续拼接：`evaluateConfirmation` 已有 CC457/CRAP6830.6，新 `childLiveStartupEvents` CC25/CRAP25.4。日志 `artifacts/b71-resume/integration-20261104/confirmation-evidence-crapper.log`。该失败如实保留，不能以测试通过或拆几个无语义包装函数代替结构收敛。
- 首阶段 `b92f1387` 已按作者动作事实、执行与字节因果、外部观察/清理、实时事件四类实际职责拆分；leader 发现缺测被转为0的反例后停止该作业。`7e07b522` 已完成纯 evaluator/外部 I/O 分离及计数语义修正；`775a9e90` 又把来源唯一收敛到持久 Interaction，wire 只作可选摘要一致性核对；主模块只负责读取/组装/报告。沿真实 wire/DB/checkpoint 一次组装事实，各判据不重复兜底；所有模块都有现役 consumer 和 README 索引。不改产品输入/原生驱动，不改 C1–C12 判据，不回写旧批次。阶段证据 `artifacts/b71-resume/confirmation-evidence-refactor-20261104/`，最终报告 `artifacts/b71-resume/confirmation-evidence-final-20261104/`。
- 本单是既有 §16.14 的外部证据工程，不新增产品能力；Invariant 为来源精确、缺证据不通过、结果不由模型目录或时间关系推断；Consumer 为现役原生确认批次；Proof 为既有/新增行为用例、旧新完整结果对账和质量门；Acceptance Driver 仍为真实 Tauri 确认/拒绝入口；产品验收感知 no；Exploration 不适用（只读证据，不提供模型作品知识）。
- 应用/Web 事件订阅与 Node 判据均已完成实现及独立局部验收，按 `05340350` / `44062abe` 分开提交；驱动失败收口与依赖修正另为 `01461fce`。源码未因原生启动失败被放宽，当前 UI 证据继续 pending；未完成项不签 done。

- **R1/R2 输出侧复核补充**：原始审计 `artifacts/b71-resume/native-output-fidelity-audit-20261104.md/json`，leader裁定 `leader-native-output-audit-review-20261104.json`。需连同 Result/IR 的有序块、停止原因、私有状态与真实工具流式一起设计，正文预览目前仅 Stub/test 伪分块可达。审计中“Anthropic input仍为字符串”被前置 parse_arguments 调用链证伪，不修不存在的问题；无非法UTF-8 producer证据不加防御；usage已有独立ProviderRun事实，不为了IR形式完整制造第二真源；Execution.result_fn有真实消费者，不当作历史兼容一刀切删除。

- **验收重构的独立反例与修复**：leader 用完整 evaluator 复现 `duplicate.delta={}` / 缺 `llm_calls` 的 delta、`restore.restart_delta={}` 被判 C5/C10=true。源头是通用 field 把缺字段变 null 后再 Number(null)=0；已保存 `artifacts/b71-resume/confirmation-evidence-refactor-20261104/leader-incomplete-observations.json`。已去除缺测→0强制转换，完整 evaluator 独立复验中缺字段/null/空对象均为 C5/C10=false，只有四个实测数字0才通过（`confirmation-evidence-final-20261104/leader-incomplete-observations-after.json`）。有效七场景和两份历史真实批次计算结果保持；57项目标回归通过，C1相关7个mutation全部被杀，原isDefined伪等价已随多来源选择代码退役。后续10项合成完整批次测试经公开verify入口真实读写临时SQLite与报告，9个原未覆盖I/O mutation全部覆盖（8 killed、1合法输入下等价）；不以合成批次代签真实页面。


### 2026-11-04 当前整合验证与原生启动受阻

- **独立验证**：leader 新库运行 app 68 + Web 19 = 87 项全部通过（`artifacts/b71-resume/leader-scoped-final-20261104/tests.log`）；完整后端 3085/0；I1 4/4、I2 3 pairs disjoint、I3 A/B 各3/3、N-NARR通过。四个driver仅迁移事件订阅/收集，102个非接线函数、规则hash、case/阈值/timeout保持不变，不属于修改规则绕过门禁。
- **脚本**：全脚本串行 1077/1077、0 skipped。首次3项失败由 revision 正例仍写退役 Why 文案引起，已直接消费前端 `TRACE` copy 真源，未改扫描器或泄漏负例。运行时测试兼容门面已删除，只有真实订阅者观察辅助。
- **代码清理**：14 个 Elixir 文件仅格式化，去位置 AST 全部相同；全仓格式检查通过。已提交 checkpoint `517d00a9`、`5a967e58`、`95346e15`、`3beeafd7`、`07ae81bf`、`07285ded`；事件总线、确认证据与驱动修复已分别提交为 `05340350`、`44062abe`、`01461fce`；所有提交都明确保留当前 UI 未闭环状态。
- **原生 01**：`cp4b-scoped-confirm-01` 在创建应用前被 Vite 5769 占用拦截，0输入/0Provider。实际原生路径嵌入前端，从不启动 Vite；已从启动依赖源头将此检查限定到需要 Vite 的 dev 路径，未添加忽略开关或退出码豁免。旧目录保留。
- **原生 02**：`cp4b-scoped-confirm-02` 已构建并启动真实隔离 app，但激活失败：`activation_unconfirmed`，前台为 `com.apple.UserNotificationCenter`；ax_trusted/post_access 均为 true。用户消息、ProviderRun、AgentRun 均为0；cleanup remaining=[]、4657/4661/5779已释放，生产源码指纹未变。原始 driver 输入事件先报激活失败，监督器125秒后记 `driver_idle_timeout`，两种事实均保留，来源复核 `leader-scoped-final-20261104/native-02-independent-review.json`。
- **外部阻塞**：电脑控制工具明确禁止访问 UserNotificationCenter，未读到提示内容、不猜测类型、不绕过；已请作者手动查看并处理，等待状态回复。原生 C1–C12 与当前最终源码页面验收仍未闭环，不复用历史 PASS。
- **驱动源头修复**：六个 B71 journey 统一通过 `NativeScenarioHarness.runJourney`，失败立即复用现有被动 fail 取证并保留原始 reason，避免只打印异常后等待监督器 idle timeout。确认计数读取也删除 SQL 错误→0 的伪造兜底；不改变输入归属门槛、超时或重试。17项目标/76项相关测试通过，leader独立复验通过；`native-failure-boundary-20261104/` 保存红绿与范围。
- 以上为真实过程与局部证据，完整B71继续doing；后续仍是当前原生闭环、R1/R2原生请求/输出/流式完整性、G6实模压缩后请求与CP5。


### 2026-11-04 统一扫描闭环与当前恢复入口

- 命令：`bash scripts/ai_static_scan.sh --top 10`（本次以 `MIX_ENV=test` 和独立 `NOVEL_TEST_DB_DIR` 运行；dev `mix compile --warnings-as-errors` 另行通过）。原报告副本：`artifacts/b71-resume/leader-scoped-final-20261104/static-scan/results/`。
- 结果：21 项，19 passed / 2 failed；7 个 Top findings（不足10项），blocking=1。已修掉本轮早期 Credo alias、NEXT 非标准第四节和记忆详情动态正则/重复映射问题；Semgrep、编译、xref、arch、全部五类不变量、前端检查等通过。
- 剩余6条 gitleaks：5条既有 false_positive（确认测试历史fixture、B65握手nonce、B63文档、E10 spec ID、Pencil fileToken）+1条既有 accepted_risk（ProjectGod历史线）；不重写历史、不关闭扫描器、不新增抑制。唯一 pending/blocking 是真实 UI evidence 未 verified，原因见原生02系统提示阻挡；未把本地绿或历史PASS冒充当前页面证明。
- 原生输入前置恢复：先等作者处理系统提示；当前 `UserNotificationCenter` 内容不可由电脑控制工具访问，禁止换渠道绕过。收到状态后再检查本批真实启动资源，另开预注册新目录；旧01/02、原始错误、零调用与清理证据不回写。新驱动已即时保留原始失败，不再靠延长等待或重试遮盖。
- 当前业务源码与验收重构可 review；B71保持doing。后续 R1/R2 的三条非IR现役操作 owner/source 清单由只读作业 `87dd58b8-0792-4c84-9f55-effb98cdc512` 汇总至 `artifacts/b71-resume/r1-operation-ownership-audit-20261104.md/json`，用于判断真实AgentRun与后台派生操作边界，不伪造run_id或作者原话。

- **批次 I/O 最后补证**：`confirmation-batch-io-tests-20261104/` 的10项新测试由leader独立复验通过；57项纯判据与相关脚本合计153项通过。正例实际生成并回读summary/checks/ws frames；缺实时child启动、缺日志/截图/快照/DB表等反例不能写PASS。OS进程/端口边界明确mock，未启动GUI；当前系统提示阻挡仍未解决。源码全脚本1080/1080（补测前完整集合）及新增10项分别已验证，当前UI仍pending。

### Anthropic 相邻 role 客户端合并退役（2026-11-06 作者裁决 A）

- **裁决**：作者 2026-11-06 明确选择 **A**——删除客户端 `merge_adjacent_roles/1`，恢复三投影统一严格前缀；不采用「保留合并 + 契约登记例外」。
- **依据**：官方 Create a Message 文档明确 "Consecutive `user` or `assistant` turns in your request will be combined into a single turn"；客户端合并不是 API 硬约束。原合并由 B71 CP2（`3ff43467`）基于对「模型训练于交替 turn」的过度解读所加，属迁移期保守预处理而非 provider 验证结论。
- **实现**：`AnthropicMessages.project/2` 改为 1:1 投影并删除 `merge_adjacent_roles/1`；`request_ir_test` 的 G7 对三投影统一使用严格前缀断言，并新增「连续 user 保留独立条目 + 作者独立消息字节不变 + 追加 scope 为新条目」专项测试；`anthropic_test` 与 `native_boundary_r1_test` 的合并形态断言改为 1:1 形态；VS-00L §6.2 登记「客户端不合并相邻 role」。
- **验证**：`mix compile --warnings-as-errors`、全量后端测试、credo/xref/arch/module-size、`mix format`；不变量 I3/I1/I2/N-NARR/I-CACHE 复跑。真实 Anthropic 请求的服务端合并/缓存行为仍为**待实模验证**（当前无凭证窗口，不代签）。
- **未闭环**：I-CACHE driver 的固定序列化仍只度量 Chat Completions 投影；Anthropic/Responses 的严格前缀由 G7 投影测试覆盖，I-CACHE 多投影扩展随 R2/实模验收处理。

### 有限模式持久事实（2026-11-06 作者裁决 D）

- **裁决**：作者 2026-11-06 选择 **D**——有限模式写入 `ProviderRun.metadata.finite_mode`，并新增 `provider_runs.finite_mode_name` 可查询独立列；验收读侧报告受限模式。**不**扩展 `DecisionTrace`。
- **依据**：VS-00L §6.4「有限模式必须写入 IR `projection.finite_mode`、trace 与验收报告；不得用有限模式冒充 CP3–CP4 的完整场景」。此前 `finite_mode` 只存在于 IR 私有内容与内存判门，`ProviderRun.metadata` 只写 `system_identity_ref`/`tool_constancy`，验收读侧不读该事实。
- **实现**：Gateway 把 `ir.projection.finite_mode` 传入执行 ctx；`AdapterExecution.run_metadata/1` 在非 nil 时写入 `finite_mode`（完整模式不写键）；`ProviderRunLog` 提取 `finite_mode_name` 列（迁移 `20261106000001`，可空 + 索引）并落 `metadata.finite_mode`；`safe_value/1` 保留 boolean（修复 `false → "false"` 失真）；`authoring_call_evidence` 返回 `finite_modes.restricted`/`complete_count` 报告（**不改变既有 PASS 判据**）。
- **验证**：新增 persistence 2 例（落列 + metadata + boolean 保真 / 无有限模式不写列）、agent 1 例（Gateway IR → run.metadata，完整模式不写键）、Node 读侧 2 例；`mix compile --warnings-as-errors`、全量后端、credo/xref/arch/module-size/format、I1/I2/I3/N-NARR/I-CACHE 复跑。
- **边界**：`ProviderEvent` 事件层暂不加入该字段（`started` 事件 `visibility=:author`，加字段或插事件会改变作者可见事件面与序列）；「完整模式 = PASS 必要条件」未启用，待后续批次单独裁决、旧证据不回溯。

### system 规则/版本落地（2026-11-06 作者裁决 A）

- **裁决**：作者 2026-11-06 选择 **A**——角色规则/输出协议进入 canonical `IR.system.instructions`，`application_base` 只留应用数据声明；`constitution_version`/`output_protocol_version` 结构化落地。`output_schema_ref` 暂无统一真源，保留字段不写入。
- **实现**：`RequestIR.system_envelope/1` 扩展 `instructions`/`constitution_version`/`output_protocol_version`；投影 `system_text/1` 渲染「身份 + 版本行 + 规则」；`RequestIR.application_base_text/0` 提供统一应用声明；判断（`JudgmentProtocol`）、使命/计划（`AuthoringOperation` spec `system_versions`）、创作/评审（`Operation` 路径）与三个文本消费者（章摘要/设定盘点/工具结果叙述）均把规则移入 system；`AuthoringTranscript` 持久化 run 级规则与版本字段（不持久化身份）。
- **验证**：agent 522/0、application 1349/0；编译/credo/xref/arch/module-size/format、I1/I2/I3/N-NARR/I-CACHE 复跑。
- **边界**：真实模型行为（规则位置对遵循度/缓存收益的影响）未做对照实验，不代签；`output_schema_ref` 待有统一 schema 真源时再落地。

### 依赖图下沉与测试 helper 迁移（裁决 4 C，2026-11-06 已实施）

- **目标**：把 `RequestIR`/Provider 纯契约下沉到 `novel_common`，使 `novel_test` 可承载跨 app 通用测试 helper（`TestRequestIR`/`TestProviderPrompt`），消除 `novel_agent/test/support` 被 application 测试跨 app 引用。
- **现状（2026-11-06 分析）**：`NovelAgent.Provider.RequestIR` 77 文件引用、`Projection` 31、`SystemIdentity` 13、`CapabilityProfile` 5、`Compaction` 3；`novel_test` 当前依赖 `novel_agent`（`ProviderHelpers` 无消费者，可删）；`TestRequestIR`/`TestProviderPrompt` 跨 app 引用约 145 处（agent 自身测试 100 处 + application 45 处）。
- **阶段（每阶段独立 commit + 全量门禁）**：
  1. 下沉 `RequestIR` 族（`RequestIR`、`SystemEnvelope`、`Projection` + 三 projector、`Compaction`、`SystemIdentity`、`CapabilityProfile`）到 `novel_common`；全仓引用改名；全量测试。
  2. `novel_test` 去掉 `novel_agent` 依赖（删除无消费者的 `ProviderHelpers`）；`novel_agent`/`novel_application`/`novel_web` 测试依赖 `novel_test`；迁移 `TestRequestIR`/`TestProviderPrompt` 到 `novel_test` 并更新引用；`SliceVerify`/`Stub` 等 agent 行为替身保留（依赖 agent 内部实现，不迁）。
  3. `scripts/arch_check.exs`/AGENTS 架构表更新、README/索引登记、最终门禁。
- **验收**：application/web 测试不再直接引用 `novel_agent/test/support`（SliceVerify 等行为替身除外）；全量测试与全部门禁绿；`novel_test` 仍不依赖生产代码之外的 app（生产依赖保持 `novel_agent` 不反向依赖 `novel_test`）。
- **状态（2026-11-06 首轮实施；2026-11-07 按作者 A1 裁决定稿）**：**done**。
  1. **首轮（按架构审核先修正两处边界）**：`Projection`/`CapabilityProfile` 先留 `novel_agent`、`Operation` 补下沉、投影改名 `NovelAgent.Provider.Projection`；提交 `29464e60`/`e6c97020`/`3e64e3b1`/`8628411d`，并清理既有严格门禁红（`b125989c`）、登记文档（`7af7c904`）。
  2. **A1 定稿（2026-11-07 作者裁决：按裁决 4 C 原计划恢复统一归属）**：`Projection`（+`ChatCompletions`/`AnthropicMessages`/`ResponsesAPI`）与 `CapabilityProfile` 一并下沉 `novel_common`（`NovelCommon.RequestIR.Projection*`、`NovelCommon.CapabilityProfile`）；`RequestIR.rejection_message/1` 回迁 canonical IR；投影断言测试迁 `novel_common/test`；执行边界只保留实际路由选择、传输发送与运行时监督。ADR-0033 §6、VS-00L §17/§19/§16.15、AGENTS/guardrails/README 已同步修订。提交 `776e3641`。
- **提交（可 review 粒度）**：`29464e60` 工具查询/拒绝文案归位与 `json_value` 单一实现；`e6c97020` RequestIR 契约族下沉 + 测试迁移 + module-size 基线；`3e64e3b1` novel_test 去 agent 依赖与 helper 迁移；`8628411d` arch_check 四类边界规则 + 白名单 + 索引；`b125989c` 既有严格门禁修复；`7af7c904` 文档登记；`776e3641` A1 补充下沉（投影与能力事实入 common）。
- **验收**：application/web 测试不再引用 agent test/support 的请求契约 helper（仅白名单内 `Stub`/`SliceVerify`）；`novel_test` 只依赖 `novel_common`；`NovelAgent.Provider.Projection`/`NovelAgent.Provider.CapabilityProfile`/旧 `RequestIR.Projection` 命名空间全仓 0 引用；wire 与持久化字段未变；全量门禁与不变量见最终报告。真实模型、真实页面、R2/SSE、G6 与 CP5 不代签。

### R2 CP0 盘点（2026-11-07，下一步主线）

- **Contract**：VS-00L §6.3（Responses 投影矩阵）、§16.15（SSE 工具调用无损/Responses 传输）、§17 状态表「Responses SSE 仍开放」；R2 语义冻结于本文档 §「R2 同一流式生命周期」（工具调用不再隐式选择非流式；三 wire decoder 分别累积原始事件；工具参数结束前只作增量事实、完成后归一；保留 call_id/raw_arguments；Respondes item_id 与 call_id 分属不同用途；私有 reasoning 按 provider/model 绑定回放、不展示作者；正文预览只来自真实正文数据）。
- **现状盘点（只读）**：`openai_compatible.ex` 的 Responses wire 只有真实非流式传输——`responses_request_body/3` 显式 `stream: false`（:443-449）、`execute_responses/6` 走非流式超时（:330-345）、`capabilities/2` 中 `streaming: wire_api == :chat_completions`（:195）；`openai_compatible_stream.ex` 已有 Chat SSE 解析与 tool_calls delta 累积（:318 起），可作为 Responses 事件累积的参考实现；`openai_responses_wire_test.exs:249` 现有「Responses wire 的 streaming 能力如实为 false」反例，R2 需改为正例并保留非流式/缺能力拒绝反例；`config/` 无生产 `wire_api` 配置（默认 chat_completions），翻正 streaming 只影响显式配置 responses 的 route；I-CACHE driver 目前只度量 `projection_target(state)`（默认 chat），需扩展三投影。
- **分解（建议）**：
  1. **R2-1 契约/判据冻结**：Responses SSE 事件→ProviderEvent/text delta/tool delta/usage/finish 映射；`streaming: true` 的翻正条件与门禁判据；「item_id ≠ call_id」的绑定规则与反例。
  2. **R2-2 Responses SSE 实现**：`stream: true` 请求；解析 `response.output_text.delta`、`response.function_call_arguments.delta/.done`、`response.output_item.added/.done`、`response.completed`、error 事件；工具参数增量保留原字节、完成时归一；usage 取 completed 事件；与 Chat/Anthropic 共用同一 AdapterExecution 事件流。
  3. **R2-3 流式生命周期统一**：三 wire 共用 HTTP cancellation/deadline/silence 语义；终止事件、错误分类、取消路径不伪造成功。
  4. **R2-4 能力与路由**：Responses route 声明的 streaming 翻正并通过完整 AgentRun 能力门；旧「Responses SSE 未实现时拒绝路由」反例迁移为「adapter 未声明时拒绝」；finite_mode 语义不变。
  5. **R2-5 I-CACHE 多投影**：driver 覆盖 Chat/Anthropic/Responses 三投影的严格前缀（含工具参数原字节），保留既有 Chat 判据不放松。
  6. **R2-6 证据分层**：确定性单测/集成测试 + 全量门禁；真实模型/真实页面另证，不代签 CP4b-2/CP5。
- **Boundary**：改动限于 `novel_agent`（openai_compatible stream 分支、AdapterExecution/Gateway 事件）与 `scripts/scenario_invariants`（I-CACHE 扩展）；common 的 IR/投影契约不变（Responses 投影已存在，stream 字段由 adapter 决定）；不新增产品验收感知逻辑（Acceptance Driver 仍为既有真实 Tauri 场景）。
- **风险**：Responses SSE 真实事件名/顺序需以官方文档为准（实现前用 web 查证并记录来源）；离线实现需 fake SSE 帧契约测试，避免「假流式」（final-only 伪装）；翻正能力声明前必须保证 decoder 对截断/错误帧 fail-closed。
- **待作者裁决**：① R2 done 判据为「确定性机制 + 门禁通过」还是必须等实模窗口；② I-CACHE 是否扩展为三投影强制门禁；③ R2 后 responses wire 是否允许生产默认启用（当前无默认，建议保持显式配置）；④ 真实流式正文预览 UI 是否纳入 R2（建议独立后续项，不缩小 R2 但也不在本批伪造页面证据）。

### R2 实施记录（2026-11-07，确定性机制层完成）

- **范围**：§R2 CP0 六步全部落地——统一流式生命周期 + Responses SSE + 工具调用不再隐式非流式 + 能力翻正 + I-CACHE 三投影 + 证据分层。**不代签**实模、真实页面流式正文预览、G6、CP5。
- **实现落点（`novel_agent` 执行边界）**：
  - `NovelAgent.Provider.SSEStream`：三 wire 共用的流式骨架——取消（token 取消即 halt + `materialize_cancelled`）、最长 wire 静默窗口、显式配置的总时长兜底、SSE 帧分割/data 提取/JSON 失败标记、ProviderEvent chunk 与作者叙事增量、终止物化分流；`SSEStream.Result` 承载成功/失败判定与错误分类/超时诊断/日志。
  - `SSEStream.ChatDecoder` / `AnthropicDecoder` / `ResponsesDecoder`：各 wire 原始事件累积。Chat/Anthropic 由既有实现迁移（行为不变，含工具 index/partial_json 累积与 usage）；Responses 新增（output_text delta、function_call_arguments delta/done、output_item added/done、completed/incomplete/failed/error）。
  - `NovelAgent.Provider.ResponsesWire`：Responses output 单一解析（非流式与流式共用）——正文只取 `message.content[].output_text`；工具身份只认 `call_id`（`item.id` 是 provider 私有输出标识，不混用）；`raw_arguments` 保原字节；usage 取 `input_tokens/output_tokens` 与 cached 明细。
  - `ResponsesStream`（Responses SSE 入口）；`OpenAICompatibleStream`/`AnthropicStream` 收敛为 decoder 绑定薄封装（不再各自复制生命周期）。
  - `openai_compatible.ex`：`execute/5` 的 Responses wire 改 `stream: true`（`responses_request_body/4` 参数化；`complete/4` 保留 final-only 非流式）；`capabilities/2` 对 Chat/Responses 均声明 `streaming: true`。
  - 工具调用统一流式：删除 `OpenAICompatible`/`DeepSeek`/`LMStudio`/`Anthropic` 的 `execute_tool_call` 非流式分支；工具参数在流内只作增量事实，结束时归一为 canonical `Result.tool_calls`（call_id/raw_arguments）。
  - 私有推理：Chat decoder 累积供应商私有 `reasoning_content` 增量，DeepSeek adapter 经 `provider_state_fun` 绑定成 provider_state（仅同 provider/model 回放）；正文与作者可见事件不携带。
- **关键判据**：Responses 流必须以 `response.completed`/`response.incomplete` 正常终止，缺失即 `:parse` fail-closed（截断流不得把半截增量冒充完整响应）；`response.failed`/`error` 不产生成功结果；三 wire 的取消/静默/总时长/错误分类语义统一；`item_id` 与 `call_id` 不混用。
- **证据（确定性层）**：`novel_agent` 498/0（新增 `responses_stream_test.exs` 6 例覆盖 failed/截断/incomplete/工具增量/取消/chunk；更新 `native_boundary_r1_test`/`strata_test`/`anthropic_test`/`lm_studio_test`/`deep_seek_test`/`gateway_test`/`openai_responses_wire_test` 为 SSE 语义）；`mix compile --warnings-as-errors`、credo `--strict` no issues、format、xref 无环、arch_check、module-size 通过；I3 4/4、I1 4/4、I2 3 pairs/0 violations、N-NARR PASS、I-CACHE 全 enforce=true（新增三投影行：chat 18420/29704、anthropic 18482/23517、responses 18532/23649，均覆盖 L0–L2 边界；CI `run_icache_prefix.exs` step 已自动强制）；全量后端/前端回归见最终报告。
- **边界**：改动限于 `novel_agent`（传输/流式解析/能力声明）与 `scripts/scenario_invariants`（I-CACHE 扩展）；canonical IR、三投影字节、ProviderRun 持久字段与作者可见面均无变化；未新增产品验收感知逻辑。
- **未闭环/待裁决**：① R2 done 判据——本轮按「确定性机制 + 全量门禁 + 不变量」收口，实模窗口（真实 Responses 流事件顺序/usage/失败重试）另证；② I-CACHE 三投影已随既有 CI step enforce，是否升级为 `mix check` 本地强制待作者裁决；③ 生产默认 wire 保持显式配置（本轮未把 responses 设为默认）；④ 真实流式正文预览 UI 仍在 R2 之外（建议独立后续项，本轮不伪造页面证据）。

### R2 后续 checkpoint：真实流式正文预览 UI（2026-11-07 作者裁决 B：纳入 R2）

- **背景**：R2 机制层已让三 wire 产出真实正文增量事件（`ProviderEvent` chunk，来源为 decoder 的 text delta），但前端流式正文预览尚未实现。作者 2026-11-07 裁决把该 UI 纳入 R2 后续 checkpoint，即 R2 的「正文预览只来自真实正文数据」要求在页面层闭环。
- **范围（本 checkpoint 冻结，开工前须逐项核对）**：
  1. **消费通路**：确认前端已有/需要真实事件通路（Channel 推送 ProviderEvent 或等价现有投影）；禁止新建平行旁路或让产品感知验收。
  2. **展示边界**：预览字节只来自真实正文增量（Chat/Anthropic/Responses 的 text delta chunk）；工具参数增量、私有 reasoning、provider 原始事件不进入作者可见预览；取消/错误/截断（Responses 缺 completed）时预览不得冒充成功正文。
  3. **一致性**：预览内容与最终 `Result.content`/TurnResult 正文的差异须可解释（流内增量 vs done 事实），不得拼接/转义改写字节（I1/I3 同源约束）。
  4. **页面证据**：外部自动化驱动真实页面（Tauri 窗口）+ 显式注入的流式 test-support provider 或真实模型窗口；证据含页面截图、事件序列、最终 Result 一致性。
- **依赖**：R2-6 页面层窗口；若用 test-support 流式替身，必须经测试/脚本显式注入（遵守场景化验收红线），不得注册进生产 runtime。
- **状态（2026-11-07，机制层 + 确定性页面证据闭环）**：**done（确定性层）**。
  - **机制层**：盘点发现前端渲染（`agentRunProseStream`）、后端投影（`ProviderActivityProjector` author 可见 chunk）、非流式提取（`AuthorProseStream`）已存在；R2 真缺口有两处：①统一流式路径 `SSEStream` 不产出 `author_content_delta`；②**写作类 provider 的真实输出是 `submit_tentative_artifact` 工具调用，正文在 arguments JSON 的 body 字段**——工具参数增量从未接入 `AuthorProseStream`。修复：三 wire decoder 新增 `tool_arguments_delta`（Chat tool_calls arguments 分片 / Anthropic `input_json_delta` / Responses `function_call_arguments.delta`）；`SSEStream` 仅在 `content_visibility: :author` 时把工具参数增量与正文增量喂 `AuthorProseStream`，只把提取出的正文作为作者可见 chunk（content_length/accumulated 为正文口径，不携带协议字节/工具参数）；非 author 用途不提取、不投影。`stream_prose_preview_test.exs` 8 例覆盖三 wire 的 content 形态与工具形态（含工具调用归一保留 `raw_arguments`、非 author 不泄漏）。
  - **确定性页面证据（2026-11-07）**：新增 test-support `NovelAgent.Test.Provider.StreamingSliceVerify`（仅页面批次脚本显式注册，不进生产 registry），把确定性 fixture 结果经**真实 OpenAI-compatible SSE** 发送（写作工具调用 arguments 分片 + 逐片延迟），驱动真实 Tauri 窗口。批次 `artifacts/slice-verify/b71-authoring-transcript-tauri-native-stream-preview-06`（`B71_PROVIDER=streaming_slice_verify B71_SLICE=b71-authoring-transcript`）**PASS**：真实窗口生成中 AX 采样到「正文生成中」「生成中，尚未保存为候选。」与真实正文片段「灵气账单」，预览不泄漏 `submit_tentative_artifact`/`item_id`；writer run 产生 30 条 `author_content_delta` chunk 事件；最终 turn_result 完成；verifier 7/7 checks、driver/runner 双 0。
  - **证据边界**：`surface=tauri-native`、`driver=ax-native-system-ui`、`provider=streaming_slice_verify`（确定性替身）；真实模型流式行为、Responses/Anthropic 实模与 I10 文学质量**不代签**，见 summary `not_signed`。页面窗口中的章节样书来自 seed 确定性填充（见下方 seed 说明），不是产品生成内容。

### B71 收口剩余（实模/G6/CP5）当前执行条件（2026-11-07）

- **作者选择**：2026-11-07 作者选择 C——下一主线聚焦 B71 收口剩余（实模/G6/CP5）。
- **只读探测（2026-11-07）**：Strata App 在线（`127.0.0.1:47831`），当前 `/v1/models` 只提供 `q2_0`（Qwen3.8-Flash-Next Q2_0）；CP3b/CP4b-2 预注册场景冻结的是单槽 `iq3_s`（`artifacts/model-contracts/b71-cp1/scenario-preregistration.json`）。环境未配置 OpenAI/Anthropic 官方凭证（无 `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`），因此 R2 的 Responses/Anthropic 实模验证不可执行。
- **需要作者裁决**：
  - **A（推荐）**：以当前可用 `q2_0` 重新冻结 B71 实模预注册（批次预算沿用：≤2 批次、场景 900s、input 120s/turn 360s），随后跑 CP4b-2/G6 实模批次；R2 Responses/Anthropic 实模等官方凭证窗口。
  - **B**：等原单槽 `iq3_s` 窗口，预注册不变。
  - **C**：先做 CP5 无窗口收口与 R2 预览 UI 设计，实模窗口另排期。
- **纪律**：未获批准/窗口前不启动实模批次、不伪造 PASS、不以机制层证据代签模型行为层；预注册不先跑后补。

### 原生批次验收状态（2026-11-06）

- **授权（已确认就绪，不需要作者再处理系统对话框）**：辅助功能 `AXIsProcessTrusted()=true`、CGEvent `CGPreflightPostEventAccess()=true`、屏幕录制 `CGPreflightScreenCaptureAccess()=true`；真实批次里窗口 AX 读取、CGEvent 输入投递（`cgevent_to_pid`）、截图、后端链路均成功。此前"app 一直等待输入"不是授权问题，而是 harness 等待账/外部驱动流程问题。
- **已修复**（提交 `e5e1491c`）：`turn_result.turn_id` 可能是发送 turn 的后续 steer 步（`<turn>:steer:N`）——外部驱动新增 `turnIdMatches` 统一匹配；`tauri_slice_verify.sh` 普通页面批次固定 `NOVEL_TEST_DB_DIR`（避免 reset/seed/后端各自落到不同库）。
- **2026-11-07 A 收口后复验 = 通过（确定性 provider 真实页面）**：`artifacts/slice-verify/b71-first-consumer-tauri-native-b71-a1-03/`（HEAD `26824567`，surface=tauri / driver=ax-native-system-ui / provider=slice_verify）**19/19**：真实窗口显示末页事实与读取活动、两次真实只读探索、turn_result 无待采纳产物、零生产写入、生产源码指纹未变、3 次真实模型调用且观察与 tool call 逐条 call_id 绑定、续读 next_offset 与 query 原字节、真实章节 ref、严格前缀、最新 scope 关闭探索、application_base 不重复观察、调用配对/消费计数一致；cleanup remaining=[]。
- **根因与修复（分批如实保留）**：`b71-a1-01`（A1 下沉后首跑）仍 `wait_wire_timeout:b71:turn_result`，经 wire 帧定位——判断替身 SliceVerify 仍按旧渲染文本「## 探索观察/### 观察 N」识别观察，canonical IR 下第二次判断重复同一 `chapter_read`，产品正确进入 `no_progress_stopped`/`awaiting_author`。修复仅 test-support：判定链携带 `%NovelCommon.RequestIR{}`、`full_read_last_observation` 从结构化 observation block 读取 summary（legacy 文本路径保留兼容），并补 3 条 IR 全章识别回归测试；提交 `26824567`。`b71-a1-01`（失败，只读保留）、`b71-a1-02`（适配后试跑 19/19，工作区非 clean HEAD，不作最终证据）、`b71-a1-03`（clean HEAD 最终证据）。
- **未闭环（不代签）**：真实模型（实模 CP3b/CP4b-2 语义与缓存）、R2 流式生命周命/Responses SSE、G6 压缩后真实请求、CP5 最终收口仍开放；本批为确定性 provider 页面证据。
- **复验方式**：`TAURI_NATIVE_SYSTEM_DRIVER=1 TAURI_NATIVE_TRANSPORT_PROXY=1 TAURI_NATIVE_ARTIFACT_TAG=<新标签> bash scripts/tauri_slice_verify.sh b71-first-consumer` → 等 `<artifact-dir>/native-driver-ready.json` → `node scripts/native_b71_drive.mjs <artifact-dir>`；失败证据在 artifact 目录 `failure.json`/`native-transport.jsonl`/`native-input-events.jsonl`。

### CP5 无窗口收口复核（2026-11-07，R2 后）

- **范围**：在不依赖真实模型/真实页面的部分完成 CP5 要求的「ADR/contract/设计/索引/事实台账/恢复指引对齐 + 逐项证明」；真实模型与页面证据明确列为未闭环，不标 CP5 done。
- **本轮已完成（确定性侧）**：
  1. **全量门禁**：`mix check` EXIT=0——compile -Werror、codegen enums/author_visible、lint_enum_literals、xref 无环、全量各 app 测试 0 failures（agent 502、domain 446、persistence 399、application 1349、web 196、e2e 1 等）、arch_check、adr_trace 30/30、I-CACHE（含三 wire 投影）全部 enforce 通过；module-size 与 `mix format --check-formatted` 通过。
  2. **静态扫描**：`bash scripts/ai_static_scan.sh --top 10` = 19 passed / 2 failed（既有 task-done manifest pending + gitleaks 6 项既有处置），7 findings 全部既有 disposition，**touched files 命中 0**；无新增 P0/P1。
  3. **不变量**：I3 4/4、I1 4/4、I2 3 pairs/0 violations、N-NARR PASS、I-CACHE 全 PASS（chat 18420/29704、anthropic 18482/23517、responses 18532/23649，coverage enforced=true）。
  4. **文档/索引/台账对齐**：B71 状态行、当前执行入口、CP 表与恢复指引（本次）；VS-00L §16.15/§17/§19.3（R2 记录）；ADR-0033 §6/A1 修订（2026-11-07 已对齐）；project-ledger 2026-11-07 多条事实；NEXT 当前任务与阻塞；`apps/novel_agent/README.md` R2 模块与测试索引；`scripts/scenario_invariants/README.md` 三投影说明。
  5. **门禁脚本缺陷修复**：`arch_check.exs`/`adr_trace.exs` 成功分支 `System.halt(0)` 会截断 `mix check` 后续命令（adr_trace/I-CACHE 此前实际未在 mix check 执行），已修复（`833cf490`）。
- **未闭环（不代签）**：真实模型窗口（`q2_0` 重新预注册尚未冻结）、CP4b-2 实模行为/缓存/usage、G6 实际压缩后请求、真实页面流式正文预览与实时启动/确认失败分支页面证据、I10 文学质量。CP5 保持 doing，不标 done。
- **2026-11-07 追加（R2 预览页面证据）**：确定性真实页面证据新增 `artifacts/slice-verify/b71-authoring-transcript-tauri-native-stream-preview-06`（provider=`streaming_slice_verify` 仅页面批次脚本显式注入；真实 Tauri 窗口生成中 AX 采样「正文生成中」+ 真实正文片段、`submit_tentative_artifact`/`item_id` 零泄漏；writer run 30 条 author_content_delta chunk；verifier 7/7；最终 turn_result 完成）。CP5 确定性证据清单据此更新；真实模型流式行为、Responses/Anthropic 实模与 I10 仍为未闭环，不代签。
- **复验**：确定性部分用 `mix check` + 静态扫描 + 五个不变量 driver 复跑即可复现；实模按本文档「B71 收口剩余执行条件」在获准窗口后执行。

### q2_0 实模批次（2026-11-07，作者裁决 A 执行记录）

- **预注册**：`artifacts/model-contracts/b71-cp1/scenario-preregistration-q2-0-20261107.json`（执行前冻结；场景/判据/预算沿用 20261031 版本；模型改为 Strata 当前可用 `q2_0`，作者 2026-11-07 选择 A 授权重冻结）。
- **批次结果（全部只读保留，不重跑换分）**：
  1. `q2-0-01` **PASS（required mechanism）**：`artifacts/slice-verify/b71-first-consumer-live-q2-0-01/`。真实 provider=strata 3 次调用（`stream:true`、tools=7、request_message_counts 4/7/9），required_mechanism **7/7**（ir_projection_structure / no_giant_user_document / no_user_pseudo_correction / append_only_prefix / author_bytes_exact / unadopted_zero_write / usage_collected），canon 零写，`run_status=awaiting_author`/ask_author。**未触发**：tool_call_count=0 → G2/G3/G4/G5/G6；Why 按钮 `why_button_scrolled_but_not_visible`（驱动观测缺陷）。证据缺陷：summary/checks 的 model 字段因 harness 默认值显示 `iq3_s`，实际服务端模型为 `q2_0`（请求 body 无 model 字段、`/v1/models` 仅 q2_0）；已在后续修复 harness 并记录。
  2. `q2-0-02` **FAIL（harness 证据时序竞争）**：driver 正常完成，runner 在 `strata-slot.json` 落盘前开始 verify（live driver 先写 ui-complete、finally 才写 slot）。实际证据完整（`strata-slot.json` model=q2_0、loaded_before/after=false、unloaded=true）。修复：`writeUiComplete` 移到 finally 证据全部落盘之后（与 auto-maintenance driver 既有顺序一致）。
  3. `q2-0-03` **FAIL（真实模型行为失败，非 harness）**：run terminal failed（wire），2 次 provider 调用；runner 断言 `usage_collected` 失败。如实登记，不重跑换分。
- **harness 修复（2026-11-07）**：`strata_lifecycle.mjs`/`authoring_live_evidence.mjs` 的预注册模型名改为可经 `B71_STRATA_MODEL` 指定（默认保持历史 `iq3_s`）；`native_b71_live_drive.mjs` 的 driverLog.model 读取 `B71_STRATA_MODEL` 并修复 ui-complete 时序竞争；`native_b71_batch.sh` 注释同步。harness 单测通过（22 pass）。
- **判定**：q2_0 下 CP3b 机制必选项可复现 PASS，但**完整实模场景（工具调用/观察回流/G2–G6/压缩后请求）未触发**；CP4b-2/G6 结论不成立。R2 Responses/Anthropic 实模仍需官方凭证。**不代签** CP4b-2/G6/CP5/I10。
- **后续入口**：① 更强模型窗口或官方凭证后按同一预注册重跑（先冻结后执行、失败只读保留）；② G6 需 auto-maintenance 场景（`B71_AUTO_MAINTENANCE=1`，需同 run 多回合且压缩实际触发）；③ 真实页面流式正文预览证据随流式 provider 批次取证。


### 2026-11-08 审核轮：clean 度收口、门禁真实性与实模回归（进行中）

- **触发**：作者要求以 B71 完成度为标准，结合项目愿景与元原则，从整体性/系统性/架构合理完整性审核实现；项目未发布、不需要兼容历史、保持 clean 度、彻底重构；允许按可 review 粒度逐批提交；本地模型可运行。
- **三项只读审计**（报告在 `artifacts/b71-audit-20261108/`，基线 HEAD `2c989d2c`，工作区干净）：
  - `contract-report.md`：P0=0 / P1=3 / P2=8；核心是 standalone 运行受限被误写为传输有限模式持久事实、Chat 流式未声明 `stream_options.include_usage` 导致 OpenAI 官方 route usage 静默为 0、契约真源（ADR-0033/adr README/08 §26）仍写「未提交工作区/待独立验证」。
  - `arch-report.md`：P0=0 / P1=4 / P2=11；核心是 `SSEStream.Result` 逐字重复 `materialize/1`（95 行死代码）与由此暴露的门禁假绿、error3 增量与 flow state 两种形状的兼容读取、私有历史 checkpoint v2/legacy 只读链、前端生产 stub 语义与测试替身作者名、若干无消费者 API 与文档漂移。
  - `test-report.md`：P0=0 / P1=4 / P2=9；核心是 R2 预览 verifier 判据名不副实（只验文件存在、checks 硬编码）、system 规则/版本落地零测试、B80 迁移的「重编号采纳后账面重算」唯一触发路径 0 测试且 rescue 吞异常、显示名断言锁死已退役测试替身。
- **P0（本轮实测确认，证据链更正）**：干净编译下 `mix compile --warnings-as-errors` 因上述重复 clause **EXIT=1**；而常规增量编译用 manifest 跳过该文件，门禁假绿。2026-11-07 CP5 记录「mix check EXIT=0」不能作为当前零警告证据。处置：
  1. 删除重复定义（`result.ex` 334→287 行）；
  2. `mix.exs` 的 `mix check` 首步改为 `compile --warnings-as-errors --force`，零警告门禁必须覆盖全部文件；
  3. 本记录如实更正：R2 提交（`119b7c35`）后的干净编译结论未在 2026-11-07 被验证，CP5 复核需以本轮门禁结果为准。
- **契约修复**：`standalone_operation` 不再进入 `IR.projection.finite_mode`/`ProviderRun.metadata.finite_mode`（运行恢复受限与传输能力受限分离）；Chat 流式请求声明 `stream_options.include_usage`；Provider behaviour 收敛为唯一 `execute/5` 执行入口（删除 `complete/4` callback 与不可达兜底）；删除无生产消费者的 Gateway 诊断 API、`AdapterExecution.non_stream_timeout/2`、`TimeoutPolicy.local?/profile`、`CapabilityProfile.complete?/1`、测试专属 `AuthoringTranscript.append_checkpoint/6`。
- **架构干净化**：error3 第三元素与 flow state 的关系按 runtime 契约收敛（flow state canonical = `stage_state.judgment_transcript`；error3 第三元素 = stage_state 增量、顶层 `judgment_transcript` 唯一位置），删除跨形状兼容读取与不一致拒绝兜底；私有历史 checkpoint **v2/unversioned/legacy 只读链退役**（未发布原则；历史证据目录只读保留，不删作者数据；未知版本诚实拒绝）；前端生产代码与作者可见名不再认知 `stub`/`slice_verify` 测试替身（统一 fallback「当前模型服务」，测试环境替身通过 `list_models` 模拟真实 provider）；`AuthorProseStream` 正确解码 `\uXXXX`（含分片与代理对，不再泄漏 hex）；`ResponsesDecoder` 参数累积键与 item 身份同源；B80 残留 CSS 死代码清理。
- **测试资产修复**：R2 预览 verifier 改为读取真实 turn_result/流式增量判据并补负例；新增 system envelope 规则/版本顺序与负例测试；补重编号采纳账面重算回归并让 rescue 可观测；`su01-model-provider-switching` 场景文案随作者可见名 fallback 更新；相关退役分支测试删除/改写为「未知格式拒绝」负例。
- **测试验证体系统一前置（作者要求）**：新增 `scripts/lib/test_env.sh`（`novel_test_db_dir`/`novel_test_db_prepare`：目录解析、可选 reset、create+migrate、migrate 失败 fail-closed；`novel_wait_for_http`；`novel_ports_precheck`），`scripts/ai_static_scan.sh`、`scripts/slice_verify.sh`、`scripts/tauri_slice_verify.sh`、`scripts/dogfood_run.sh` 与 CI 全部复用同一前置；`scripts/lib/test_env.test.mjs` 覆盖行为与接线负例。删除各入口自带的建库三连与 db 目录语义漂移。
- **验证**（提交后 clean HEAD 复跑，均通过）：`mix check` = EXIT 0（强制全量编译零警告 + 全 app 全量测试 0 failures + xref 无环 + arch + adr_trace 30/30 + I-CACHE 10 行 enforce）；五个不变量 driver 全 PASS；`bash scripts/ai_static_scan.sh --top 10` = **20 passed / 1 failed**，唯一 fail 为既有 gitleaks 6 项处置（touched=0，无新增）；前端 typecheck/lint/test 全绿（53 files / 484 tests）、`frontend_audit.sh` 27 pass / 0 warn / 0 fail（含 Tauri app+dmg 构建）、`check_design_trace.sh` 25 通过；`node --test scripts/lib/test_env.test.mjs` 10/10；确定性页面批次 `b71-first-consumer-tauri-native-audit-1108`（HEAD `eca29943`）= 19/19 PASS。
- **实模批次（2026-11-08 08:43–08:47Z，PASS）**：预注册 `artifacts/model-contracts/b71-cp1/scenario-preregistration-iq3-s-20261108.json`（执行前冻结；Strata `/v1/models` 恢复提供 iq3_s）。批次 `b71-first-consumer-live-cp4b2-iq3s-01`（surface=tauri-native、driver=ax-native-system-ui、provider=strata、model=iq3_s）：
  - **required_mechanism 8/8 全 true**：ir_projection_structure、no_giant_user_document、no_user_pseudo_correction、append_only_prefix、used_context_refs_within_boundary、author_bytes_exact、unadopted_zero_write、**usage_collected**。
  - **真实多轮**：7 次真实调用（planner×5、writer、evaluator，全部 completed、llm-calls status=200），`request_message_counts` 严格追加 4/7/10/13/16/19/22；`replay_only_tool_calls=21`（同一 tool_call 在后续请求按历史回放 6/5/4/3/2/1 次），真实工具名 `judgment_decision`；产出 1 个 tentative 候选（had_candidate=true、run_status=completed、作者可见回复 present）、canon 零写、refs violations=[]。
  - **usage/缓存/流式（F-2 修复验证）**：每次调用均有非零 input/output tokens（例 input 9061→13048→16767、output 157→192→479），`cached_tokens` 0→9218→13240（provider 前缀缓存命中），`ttft_ms` 14768/15434/15632、latency 16–22s（真实流式）；llm-calls response.usage 与 provider_outputs.usage 同源。
  - **单槽核验**：loaded_before/after=false、unloaded=true；3 张真实页面截图 + AX 文本 + wait-ledger。
  - **未触发（如实登记，不代签）**：G2/G3/G5/G6（`tool_call_result_binding`/`observation_reaches_next_request` 判据为 null，verifier 不把 replay-only 历史回放当作本轮新观察）；I10 文学质量不代签；Responses/Anthropic 实模仍待官方凭证。
  - **G1–G6 离线切片（复用 `scripts/b71_golden_slices_from_live_batch.mjs`，不重跑批次）**：本批 7 条真实请求字节分析——**G1 ✅**（system=1、application_base 在 author 前、author index=3、author 字节 sha256、7 个工具）、**G2 ✅**（6 个唯一 tool_call IDs 与 6 个 tool_result IDs 全量 call_id 绑定、pairing_errors=[]、replay 出现 21 次、6 个后续请求均携带 tool_results）、**G4 ✅**（候选工具 `submit_tentative_artifact`；全部工具调用名 judgment_decision/agent_plan_draft/chapter_mission/submit_tentative_artifact）；**G3/G5/G6 未触发**（无 failed validation / 无处置事实 / 无压缩标记），如实不代签。报告 `.../golden-slices/live-golden-slices.md`。
  - **`stream_options.include_usage` vendor 接受度矩阵（作者 2026-11-08 同意候选，本轮取得首批证据）**：`strata/iq3_s` 由本批真实产品请求取证（usage/cached_tokens/ttft 全部回收）；`lmstudio/qwen3.8-flash-next@iq4_nl` 由外部直连探针取证（接受该字段并返回 usage chunk：prompt 56 / completion 8 / reasoning 8，`[DONE]` 正常终止；q4_0 首测为 LM Studio 引擎 SIGSEGV 环境问题，非字段拒绝）；DeepSeek/OpenAI/Anthropic 无凭证未取证（官方文档依据，待凭证窗口）。结论：现有「对全部 OpenAI-compatible Chat wire 统一发送」在两个本地 vendor 上成立，暂不需要 vendor 级开关；证据见 `artifacts/model-contracts/b71-cp1/vendor-stream-options-matrix-20261108.json`。
  - **G6 实模批次（2026-11-08 09:45Z）**：按作者 2026-11-08 同意的新预算冻结预注册 `scenario-preregistration-g6-iq3s-20261108.json` 后启动，**预检即失败：Strata App 不可达（0 次调用、未进入产品链）**——属外部环境变化（此前 iq3_s 可用），非产品/判据失败；不重跑换分，预注册保留待窗口恢复后按原判据执行。G6 仍未取证，不代签。
  - **G6 实模批次 02（2026-11-08 10:10Z，Strata 恢复后）**：按同一冻结预注册执行，**FAIL（1 次真实调用、0 压缩）**——模型在首次判断后进入 ask_author（询问要看哪一章，界面「等待你回复 · 创作」），driver 第二次发送前 `wait_ax_timeout:input_ready`（底部输入区被「等待即回答」接管为回答模式，driver 的 rawWaitInputReady 未识别），runner 记 external_driver_failed。**归因=场景/harness 输入模式（跨 run 续行无法进入同 run 多回合，维护范围仅同 run），非产品缺陷**；压缩未触发，按预算纪律不重跑换分。G6 仍未取证，不代签。证据 `artifacts/slice-verify/b71-first-consumer-auto-maint-cp4b2-g6-iq3s-02/`。
  - **G6 场景观测 smoke（2026-11-08 10:30Z，A3b multi-turn，非验收）**：为定位批次 02 的同 run 多回合可行性，跑 `B71_AUTO_MAINT_SMOKE=1`（driver 走 `runMultiTurnFlow`，不产验收证据）。**同 run 多回合真实成立**：模型 ask_author → driver 自由文本 steer → `run_resumed`/running；usage 8996→12929 已越小窗口（4096×0.70）。但同 run 内更早回合 **complete_exchanges=0**（<K=4）、`checkpoint_events=0` → 自动维护**正确未触发**。**G6 仍不可构造**：受真实模型单轮内交换不足限制（与 A3b 既有结论一致），非产品缺陷；不调 K/窗口凑触发、不把 smoke 当验收证据。证据 `artifacts/b71-native/a3b-smoke-cp4b2-g6-smoke-iq3s-01/`。

### G6 multi-turn 正式场景改造与两批真实执行（2026-11-08，作者授权②）

**harness 改造（非产品代码）**：按作者「改造 harness 支持同 run 多轮连续 steer 的正式场景」授权，落地：
- driver `runMultiTurnFlow`：1 次 steer 观测 → **同 run 连续 steer 循环**（直到自动维护触发 / `B71_AUTO_MAINT_MAX_STEERS=6` 上限 / run 终局），每轮记录 pause/steer/resume 与 canonical blocks 口径交换事实（修正旧口径读 `message.tool_calls` 恒空的读数 bug）；触发后补 `after-maintenance/after-expanded/after-next-request` 作者可见证据与「压缩后真实请求」。
- verifier：新增 `C11_multi_turn_same_run`（同 run pause/steer/resume 真实成立）；`C7`（刷新幂等）/`C8`（失败静默）明确**不属于 G6-multi-turn 场景范围**（ok=null 不进 required、`not_signed` 明示），不放宽也不伪装通过；common/wire 断言对该场景适配（同 run steer 不产生额外 user_message 帧，wire 只要求首轮输入与最终 turn_result ≥1，同 run 多回合由 C11 判定）。新增 3 个正反例测试（node --test 9/9）。
- batch：新增正式入口 `B71_AUTO_MAINT_MULTI_TURN=1`（与 smoke 互斥、正常 runner verify）；runner 修复 **auto-maintenance journey 的 verify 前 cleanup**（此前 verify 在 EXIT cleanup 前执行，C10 必然 fail——b1 暴露，b2 验证修复通过）。

**冻结预注册并执行 2 批（如实不代签）**：
| 批次 | 输入设计 | 结果 | 关键事实 |
|---|---|---|---|
| `cp4b2-g6-mt-01` | b1 默认（两章对比） | FAIL（压缩未触发） | C1/C11 pass；steer 1 轮后 run completed；canonical 交换 **4**（< 触发所需 >4）；usage 32497 越线 11×；C10 因 verify 时序 fail（已修，原判定保留） |
| `cp4b2-g6-mt-02` | 更强逐章核对 | FAIL（多回合未成立） | 首轮直接 run completed（未 ask_author）→ 无 steer 机会；交换 2；usage 16864；C10 pass（修复验证） |

**结论**：自动化 harness 已可正式构造「同 run 连续 steer」，两批真实执行均未触发压缩——b1 差 1 个完整交换、b2 模型直接终局。**G6 受 iq3_s 当前单 run 交换能力/暂停时机限制，保持 known-gap**；不调 K/窗口/判据、不重跑换分、未触发不代签。下一步需更强模型窗口或产品侧的独立压缩触发场景设计（非 B71 协议问题）。

### 观察驱动多轮修正与 obs-01（2026-11-08，作者审核「多轮是观察还是写死」后）

**问题定位**：上两批的 C1/C2/C11 事实来自观察，但「每轮 steer 文本」写死（固定模板），违背「像用户一样操作」红线，且使 b1/b2 结论只能算 harness 初步可用——固定文本可能正是模型行为不可控的原因之一。

**改造（非产品代码）**：driver 每轮先从真实回答面板读取问题文本/选项（`readAnswerObservation`），按预注册冻结策略作答（`planObservedAnswer`：有选项→按关键词选题；自由问题→提取对象词生成对应回答；无对象词→fallback 模板），记录 `question_text → answer_source/answer_text` 绑定；verifier C11 新增观察驱动判据（每轮问题绑定 + ≥1 轮来源为 option/extracted_text；fallback 刷轮不算），新增 2 个负例测试（node --test **11/11**）。

**批次 `cp4b2-g6-obs-01`（观察驱动，单批冻结预注册）**：FAIL（模型未暂停）——同一默认输入在 b1 中曾 ask_author，本批**首轮直接 run completed**，0 轮 steer/0 观察问题，C11 按新判据正确 fail（`multi_turn_not_observation_driven`）；压缩未触发，C1/C10 pass。**真实模型同一预注册输入跨执行行为不一致（采样非确定性）**。

**G6 收口判定**：三次真实执行（b1 差 1 交换、b2 直接终局、obs-01 直接终局）均未触发；观察驱动 harness 已就绪且判据能正确拒绝「固定文本/fallback 刷轮」。G6 保持 **known-gap**（iq3_s 暂停时机与单 run 交换能力不稳定），不重跑换分、不调判据、不代签；下一步需更强模型窗口或产品侧独立压缩触发场景设计。

### 确定性压缩场景（方案 A）实施进展与阻塞（2026-11-08）

**已执行探针（确定性页面真实批次 + 产品化运维配置）**：
- `probe-01`（`b71-authoring-planning` + `NOVEL_AUTO_MAINTENANCE_ENABLED=1` + `NOVEL_CONTEXT_WINDOW_OVERRIDES=slice_verify:1000`）：批次 PASS；单 run **5 个完整交换**、usage 861/936（> 2867 阈值口径的等价小窗口）、**checkpoints=0**。
- `probe-03`（`b71-authoring-revision` 同配置）：批次 PASS；单 run **5 个完整交换**、**checkpoints=0**。
- `probe-02`（`b71-authoring-transcript`）：驱动失败 `activation_unconfirmed`（本地窗口激活环境问题，未进入产品链，不登记为产品结论）。

**根因（代码级）**：`TranscriptCompaction.plan_maintenance/2` 以「最后一条 `role=="user"` 消息位置」为当前回合起点，**只整理更早作者回合**的完整交换；确定性 journey 每个 run 都只有 1 条 user 消息（历史确定性批次同样如此），5 个交换全部属于当前回合 → `{:ok, :nothing_to_compact}` → 自动维护**正确地**不触发。不是压力/fixture 数量问题。

**尝试过的构造（已实验、代码已回退，不留在仓库）**：`SliceVerify` 增加 env 门控分支，在判断阶段循环返回 `judgment_decision explore`（每步 1 个只读交换），累计 5 个交换后返回 `ask_author` 暂停，驱动观察作答（含确定性标记）→ 同 run 恢复，期望安全点自动维护触发。**实验结果失败**：产品判断协议在首轮探索观察产生后不再开放 explore（`exploration_not_available`/`invalid_tool_arguments`），自造 explore 参数被 `judgment_protocol_violation: :invalid_tool_arguments` 拒绝 → `run_failed`。说明「判断阶段循环 explore」不是可用构造路径；所有 WIP 代码已回退，工作区 clean。

**「plan 多步执行中途暂停」核查结果（2026-11-08，选项 a 已执行）**：改回 fixture 判断阶段返回 `ask_author` 后重跑确定性批次（`slice=b71-authoring-planning` + planning 输入 + marker + 确定性 auto-maintenance 驱动）：DB 显示单 run **5 个完整交换**（judgment_decision → plan_draft → plan_revision → submit×2）、**judgment_decided 仅 1 次**、单 user 消息、**checkpoints=0**。即：**产品流程只在 run 开头调用一次判断阶段（judgment），其后由计划起草/修订与机械执行推进，执行中途不存在判断步骤**——无法在"5 个交换之后"通过判断阶段插入 `ask_author`；而 confirmation 交接的确认动作不写 user 消息（不构成更早回合）。**结论：确定性多回合在现有产品语义下不可构造**（除非产品新增"执行中途向作者提问"能力）。所有 WIP 已回退、工作区 clean。

**结论与下一步设计选项（需作者裁决方向）**：**结论与下一步设计选项（需作者裁决方向）**：
1. ~~**plan 多步执行中途暂停**~~（**已核查否决**，见上）：产品判断阶段仅在 run 开头调用一次，执行中途无判断步骤；无法插入执行后 `ask_author`。
2. **产品侧语义确认**：若产品在「执行中途向作者提问」只有 confirmation 交接（其确认不写 user 消息 → 无法构成更早回合），则确定性多回合在现有产品语义下**不可构造**，需回到方案 B（业务事件触发点）或方案 C（作者可见入口，需修订 §16.16/§18 + UI 授权）。
3. **回实模**：保持 G6 known-gap，等更强模型窗口后按观察驱动 multi-turn 场景重跑（harness 已就绪）。

**证据保留**：探针与实验批次目录在 `artifacts/slice-verify/*cp4b2-g6-det-*/`、`artifacts/b71-native/a3b-smoke-cp4b2-g6-det-smoke-*/`（gitignored，只读保留）；`probe-01/03` 的 5 交换/压力/0 checkpoint 事实是本节的依据。**未代签 G6、未改判据、未留下未验证代码。**
- **状态**：CP5 保持 doing；真实模型行为、页面层实时事件/确认失败分支、I10 文学质量仍不代签。


### 后续候选与执行条件（作者 2026-11-08 同意登记）

以下三项不在本轮执行范围内，需独立预注册或独立任务文档；未获授权/窗口前不启动、不代签：

| 候选 | 目标与判据 | 执行前置 | 当前可复用的确定性基础 |
|---|---|---|---|
| **G2–G6 切片补证** | 在真实 run 上逐类取证：G2 观察进入下一请求、G3 校验失败原生回流、G5 作者边界后新授权、G6 显式压缩后请求（covers/refs/versions/omissions/字节可回查） | 新冻结预注册（单场景、预算、判据先冻结后执行）+ 真实模型窗口；G6 需 auto-maintenance 同 run 多回合场景（A3b 已知受模型行为限制，不调 K/窗口凑触发） | 本轮 `b71-first-consumer-live-cp4b2-iq3s-01` 已证明真实多轮/工具历史回放/tentative/usage；`request_message_counts` 4/7/10/13/16/19/22 与 replay_only_tool_calls=21 可作追加式前缀基线（**2026-11-08 承接：G6→B81 CP5；G2/G3/G5→B82**） |
| **`stream_options.include_usage` vendor 矩阵** | 逐一取证 OpenAI-compatible Chat wire 各 vendor（LM Studio/Strata/DeepSeek 等）对 `stream_options` 的接受度与 usage 回收；不接受的 vendor 改为 vendor 级开关，结论回写 VS-00L §6 与 adapter 能力事实 | 真实窗口逐 vendor 批次；不伪造兼容结论（当前统一发送依据是 OpenAI/DeepSeek 官方文档，仅机制层） | 本轮 iq3_s 批次已取得真实 `input/output tokens + cached_tokens + ttft`；单测已覆盖「请求含 include_usage」与「缺 usage 帧保持 0 不伪造」（**2026-11-08 承接：B83**） |
| **架构/测试债务** | ① `novel_common` 的 `LogEmit`/`LLMLog` 文件 I/O 与 `Task.start` 迁出纯契约层，并给 `arch_check` 增加 common I/O 禁止规则（当前 AGENTS 声明但门禁未覆盖）；② `novel_web` 193 tests/532s 慢测试定位与收敛 | 独立任务文档（登记于 `docs/design/00f-capability-atlas.md` P2-E）；涉及日志证据链与全仓测试基础设施，按一次一个单元拆分 | B71 审核轮 arch P2-10 已给出行号与门禁缺口证据；web 慢测试已在 audit 记录中量化（**2026-11-08 承接：common 日志 I/O 已由 ADR-0034 闭环；剩余 web 慢测试→B84**） |

### 2026-11-08 任务承接变更（登记全，B71 不再自承 G6）

ADR-0035（会话级 canonical 创作上下文）获作者批准后，B71 剩余候选的承接关系变更如下，避免重复承接与"构造场景"：

| B71 原候选 | 承接任务 | 说明 |
|---|---|---|
| G6 压缩后真实请求 | **B81 CP5** | ADR-0035 落地后由真实多轮会话自然触发压缩并取证；B71 不再构造单 run 多回合/异常路径场景；历史探针与失败批次证据只读保留 |
| G2/G3/G5 黄金切片补证、Responses/Anthropic 实模 | **B82** | 每片独立冻结预注册、独立批次、如实登记；G6 不在 B82 |
| vendor `stream_options.include_usage` 矩阵 | **B83** | Strata/LM Studio 首批结论已登记；OpenAI/Anthropic 凭证缺失 → blocked |
| 架构/测试债务 | **B84** + ADR-0034 已闭环 | `novel_common` 日志 I/O 已由 ADR-0034（`novel_telemetry`）迁出；剩余 `novel_web` 慢测试与 00f P2-E 由 B84 承接 |
| B71 CP5 最终收口 | 依赖 **B81 CP5**（G6）+ **B82**（G2/G3/G5/实模） | CP5 保持 doing；B71 的契约/历史证据/I10 不代签边界不变 |

- B71 状态保持 doing；G6 明确移交 B81 CP5，B71 原任务保留历史证据与契约，不再作为 G6 的排期/执行入口。
- **2026-11-09 状态更新**：B81 CP1（会话级 canonical 事实源）已完成并通过全量门禁 + native 真实页面 19/19；G6 的取证对象随之变为**会话历史**（跨 turn 累计已完成交换），CP5 验收设计与 6 项判据见 B81 §8.6；CP2–CP4 未实现前 G6 仍不代签。B71 CP5 收口仍依赖 B81 CP5 + B82 证据。
- 相关任务状态源：B81 §7.3（上下游/前置/后置关系登记）与各承接任务文档。

### 2026-11-11 B81 交付后的完成度复核

复核以 `c168734f` 为基线。ADR-0033 与 ADR-0035 共用现有会话历史和 Request IR。Application 从会话派生当前请求，Gateway 按实际 route 派生能力事实，三类 adapter 分别消费纯投影，Orchestrator 持有执行权。作者处置和压缩分别沿既有 pending 与会话维护入口验证。按仓库引用核对，离线脚本只有自己的测试、索引和历史记录引用，与正式 runner 重复读取请求并另判 G1–G6。退役该入口及锁定其旧行为的测试，保留历史 artifacts 和正式场景判据。没有新增生产实体、协议版本、证据存储或兼容路径。

| 要求 | 本轮复核所得 | 剩余证据 |
|---|---|---|
| G1 首轮 | `b71-first-consumer-live-cp4b2-iq3s-01` 的原生报文与正式机制判据支持系统规则、独立 Base 与作者原话。 | Responses/Anthropic 另按各自 wire 核对。 |
| G2 观察后 | B81 `b81-interleave-tail-01` 的 `pcall_mwbj0872_2b → pcall_mwbj0cup_2m` 是同一 AgentRun 内相邻的 Provider starts。后一请求首次携带 `call_b17dfc3e3c1a4c46b913ed4e` 的成功观察。assistant 调用、外层 tool ID 与内层 call ID 一致，原生 payload 与同 run 的 canonical 第 26 条完全等值，携带章节引用、采纳稿 revision 2 和正文范围 1–6000。 | 该批以压缩交错续行为主。B82 仍需把观察与消费该材料的具体调用绑定，核对该次模型使用声明与 Base/Observation 边界。 |
| G3 校验失败后 | B81 `b81-interleaved-resume-07` 的 `pcall_mwb3a3k3_30 → pcall_mwb3a8r5_3a` 携带 `judgment_semantic_conflict`。B81 `b81-c5-c6-resume-02` 的 `pcall_mwb09bjp_dm → pcall_mwb09y9f_dz` 携带 `evaluator_invalid_json`。两个失败均首次以原生 tool 结果进入同一 run 的下一请求，与 canonical 同 call ID 的块等值，前后作者消息字节一致。 | B82 仍需以失败、有限修正、权限门和作者出口作为完整验收，并记录预算耗尽时的结果。 |
| G4 候选后 | iq3_s 批次支持候选实际出现、未采纳零写和追加历史。pending 专项覆盖候选与后续请求的关联。 | 正式复核继续核对同一候选的 pending refs、I1 和工具授权，候选工具名本身不能证明这些后果。 |
| G5 作者边界后 | `cp4b-pending-08-structure-clean` 的确定性 Tauri 判据 77/77，覆盖真实页面动作、采纳与放弃的回执、后续请求、恢复和零越权。 | B82 承接 ADR-0035 后的当前页面/实模取证，核对处置对象、新授权及旧调用是否越过边界。 |
| G6 压缩后 | `b81-c7-c8-03` 原生实模批次 C1–C11 通过。交错续行专项的 C5/C6 也通过，覆盖 checkpoint 与首个后续报文、原作者字节及未覆盖交换。 | 原批次发现的作者可见内部标识问题由 [B86](B86-structured-model-materials-internal-ref-isolation.md) 承接，完整 B71 仍按 CP5 总审。 |
| R2 流式与三类 wire | 已有三 wire 的确定性机制与 Tauri 流式预览 7/7。Strata 真实请求提供流式 usage、TTFT 与缓存事实。 | 真实 writer 流式预览须从同一发送回合绑定 chunk、生成中 AX 和最终结果。Responses 与 Anthropic 的真实 body、流式终止和 usage 由 B82 另证。 |

证据对账复用 `authoring_request_facts.mjs`、`scenario_evidence.mjs` 与 B81 已有的 Provider start / canonical 数据源。三条对账在 `artifacts/b71-audit/2026-11-11-g2-g3-wire-canonical.jsonl`。历史 Strata `response.body` 保存 `event_stream`，因此旧 verifier 的 L5/L6 为缺证。此处验证了实际请求内的观察和校验回流，供应商原始 SSE 响应仍须按正式批次另证。L7 的调用级复验见下。

退役判据的反例可由历史实现复现。仅回放 `ask_author` 的通过校验就得到 G2 绿灯。失败的 observation 得到 G3 绿灯。作者原话包含 `resolved_adoptions` 与 `checkpoint` 就得到 G5/G6 绿灯。正式验收沿已有 native runner、请求事实解析、专用 revision/pending/压缩判据及 SQLite 读取路径继续推进。

### L7 自报与实际请求绑定（2026-11-11）

B71 实模验收与 B70 的 HO5 共用既有 L7。它按 canonical assistant 的 `provider_call_ref` 和 `provider_run_ref` 定位唯一请求，从这条请求的应用材料和成功观察核对该次模型自报。段头、决策 trace 与探索事件可供回查，缺少对应请求时判缺证。原生 tool 观察的结果必须绑定同一报文中在先且唯一的调用。生产协议、持久化和 UI 无新增实体。

只读复核 B81 两个已有 Tauri/Strata 批次。原报文均通过；从自报所在请求移除引用、保留其他调用中的同一引用时均失败；移除该请求记录时均报缺证；把引用只放回压缩省略说明或 scope 引用的作者原文时仍失败。前后证据分别在 `artifacts/b71-audit/2026-11-11-l7-before.jsonl` 与 `artifacts/b71-audit/2026-11-11-l7-after.jsonl`。这是历史调用的 L7 复核，独立 B82 G2 仍需把首次分页观察与消费同一材料的模型自报连成同一条链。

