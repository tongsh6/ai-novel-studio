# B71：AI Novel Studio 原生多轮创作请求体

- 状态：**todo（2026-10-30 目标设计登记；CP0 对照分析完成，CP1 目标契约未开工）**。
- 来源：作者先要求对照 Codex、Claude Code、dsh 的真实多轮请求，随后明确“设计一个优秀、符合项目调性的请求体，不为现状妥协”。本文件已据此替换此前偏向现役最小修补的方案。
- 设计真源：[Provider 抽象 §26](../../docs/design/foundation/08-provider-abstraction.md#26-ai-novel-studio-原生多轮创作请求体2026-10-30-目标设计proposed)。当前为 Proposed；登记不等于 Accepted 或实现。
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
| CP1 | 冻结目标 contract pack、Request IR、消息/工具/观察/校验/候选/checkpoint 语义、provider 投影与能力门槛、六类黄金请求和场景预注册；完成 ADR/现役协议差异及迁移裁决 | 未开工；下一步 |
| CP2 | 实现 canonical transcript/Request IR 与三类 provider 投影；建立真实只读观察和原生校验结果回流，黄金与 adapter 测试通过 | 未开工 |
| CP3 | 以统一 AgentRun 接通首个创作消费者，完成求证→候选→校验→作者出口；接入预算、权限、trace、持久化和恢复，不形成第二控制环 | 未开工 |
| CP4 | 覆盖规划/修订/质量与压缩恢复，完成真实 Tauri 全链、真实模型行为、缓存/usage、replay/Why 和全部门禁；处理现役迁移与旧协议退役 | 未开工 |
| CP5 | 更新 ADR/contract/设计/索引/事实台账和恢复指引；逐项证明完整范围，不能以 adapter/golden 局部证据标 done | 未开工 |

## 6. 验证与恢复指引

- CP1 只运行文档、索引、链接、NEXT/ADR 和差距检查，不声称产品验证。
- CP2 起执行后端完整门禁、I3/I1/I2、架构与统一静态扫描；触及前端时执行完整前端门禁和 Tauri 构建。
- 验收必须分别报告外部真实页面、后端/adapter 局部证据、真实模型行为和未闭环缺口；文学质量仍归 I10，不由协议通过代签。
- 缓存比较按同调用点真实请求和 cached_tokens/TTFT，不把历史命中数当固定阈值，也不为缓存牺牲目标消息语义。
- 外部脱敏样本位于 `artifacts/client-http-bodies/`；项目对照证据位于 `log/llm-calls/stage/2026-10-29.jsonl` 第 8–9 行。它们只证明协议差距，不是目标实现。
- 恢复时先读 Provider §26、本任务及 CP1 产生的目标 contract pack，再核对 ADR-0030/0031、UA-01 和 VS-00I 的处置；不得从上一版保守分析推断单调用或 giant prompt 仍是目标。
