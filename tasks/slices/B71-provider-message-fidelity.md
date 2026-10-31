# B71：AI Novel Studio 原生多轮创作请求体

- 状态：**doing（2026-10-31 CP0 done；作者选 A，ADR-0033 Accepted；CP1 done 并复核通过，ADR-0030/0031 已转 Superseded；CP2 机制完成但不单独标 done，残差并入 CP3a；CP3 拆为 CP3a 确定性接线（todo，已入 NEXT 候选）/ CP3b 实模窗口验收（blocked，等真实 Tauri + 实模窗口））**。
- 来源：作者先要求对照 Codex、Claude Code、dsh 的真实多轮请求，随后明确“设计一个优秀、符合项目调性的请求体，不为现状妥协”。本文件已据此替换此前偏向现役最小修补的方案。
- 设计真源：[Provider 抽象 §26](../../docs/design/foundation/08-provider-abstraction.md#26-ai-novel-studio-原生多轮创作请求体2026-10-30-目标设计2026-10-31-作者选-a方向-accepted)；目标方向与迁移规则已由 [ADR-0033](../../docs/design/adr/ADR-0033-authoring-run-transcript-request-ir-v3.md) Accepted（2026-10-31）；替换契约 [VS-00L](../../docs/design/contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md) 已 Frozen，实现迁移中（CP2 机制完成，CP3a 生产接线未开始）。
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
| CP3a | 确定性接线（2026-10-31 从 CP3 拆出）：以统一 AgentRun 接通首个创作消费者并完成生产接线（IR 消费替换 call-site legacy prompt、观察/校验按 call_id 回流、预算/权限/trace/持久化/恢复），承接 CP2 残差；以确定性 provider 在真实页面驱动证明接线闭环，不签实模语义 | **doing（2026-10-31 CP0 冻结：调用点/分步/风险/验收冻结，见下节）** |
| CP3b | 实模窗口验收（2026-10-31 从 CP3 拆出）：按预注册在真实 Tauri 原生窗口 + 真实模型单槽复跑首个创作 AgentRun 全场景与 G1–G6 真实 run 取证；CP3 只有在 CP3a + CP3b 均完成后才算 done | **blocked（需真实 Tauri + 实模资源窗口与预算；非决策阻塞）** |
| CP4 | 覆盖规划/修订/质量与压缩恢复，完成真实 Tauri 全链、真实模型行为、缓存/usage、replay/Why 和全部门禁；处理现役迁移与旧协议退役 | 未开工 |
| CP5 | 更新 ADR/contract/设计/索引/事实台账和恢复指引；逐项证明完整范围，不能以 adapter/golden 局部证据标 done | 未开工 |

## 6. 验证与恢复指引

- CP1 只运行文档、索引、链接、NEXT/ADR 和差距检查，不声称产品验证。
- CP2 起执行后端完整门禁、I3/I1/I2、架构与统一静态扫描；触及前端时执行完整前端门禁和 Tauri 构建。
- 验收必须分别报告外部真实页面、后端/adapter 局部证据、真实模型行为和未闭环缺口；文学质量仍归 I10，不由协议通过代签。
- 缓存比较按同调用点真实请求和 cached_tokens/TTFT，不把历史命中数当固定阈值，也不为缓存牺牲目标消息语义。
- 外部脱敏样本位于 `artifacts/client-http-bodies/`；项目对照证据位于 `log/llm-calls/stage/2026-10-29.jsonl` 第 8–9 行。它们只证明协议差距，不是目标实现。
- 恢复时先读 Provider §26、本任务及 CP1 产生的目标 contract pack，再核对 ADR-0030/0031、UA-01 和 VS-00I 的处置；不得从上一版保守分析推断单调用或 giant prompt 仍是目标。

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
