# ADR-0033：Authoring Run Transcript 与 Request IR——统一 AgentRun 的原生多轮创作会话

- 状态：**Accepted（2026-10-31，作者在 B71 CP1 选择 A：按目标协议正式修订/supersede 现役协议）。实施进展（2026-11-03）：CP2 IR/投影/能力门槛、CP3a/CP3c 首个判断消费者与原生成、CP4a 创作/质量迁移、CP4b 规划/使命/修订/质量/确认交接/私有历史/逐调用引用/能力事实单一来源/显式压缩派生已完成确定性实现与验收；CP3b 实模与压缩前端设计授权、CP5 最终收口仍未闭环，真实模型行为不代签。**2026-11-06 B71 裁决 4 C：Request IR 契约族（数据/校验/构造）下沉 `novel_common`，wire 投影与能力事实保留 `novel_agent` 执行边界（§6 实施位置修订，原则不变；已提交并通过确定性门禁）。**
- 实施进展（2026-11-04 R1）：能力事实改为 Gateway 按本次实际路由单次解析并派生——删除构造侧 `target`/`capability_profile`、执行侧双身份比对、`to_provider_prompt/2` 与生产 Stub 注册；三类 adapter 直接消费原生投影；初始快照按 VS-00L §19.2 构造。**实现位于未提交工作区，待独立验证**。CP3b 实模、压缩前端设计授权、G6/Responses SSE 与 CP5 仍开放。
- 实施状态真源：`tasks/slices/B71-provider-message-fidelity.md`；契约状态更新见 [VS-00L §17](../contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md#17-实施状态更新2026-11-03)。
- 日期：2026-10-31
- 来源文档：
  - `../foundation/08-provider-abstraction.md` §26
  - `../00-vision-and-engineering-roadmap.md` §2.2–§2.4
  - `../contracts/UA-01-unified-agent-run-loop-contract-pack.md`
  - `../contracts/VS-00K-evidence-seeking-authoring-contract-pack.md`
  - `../contracts/VS-00I-prompt-prefix-stability-contract-pack.md`
  - `tasks/slices/B71-provider-message-fidelity.md`
- 影响范围：AgentRun / Request IR / Provider Adapters / Exploration / ToolResult / Tentative Artifact / Trace / Replay / Acceptance
- 相关不变量：作者字节与 artifact 因果、tentative-first、逐步 Orchestrator gate、真实预算与来源、N-NARR、replay 默认不调模型、I1/I2/I3
- 首个证明 slice：`tasks/slices/B71-provider-message-fidelity.md`
- 取代：无（CP1 完成替换契约与迁移映射后，按本 ADR §7 正式取代 ADR-0030/0031）
- 取代者：无

## 1. 背景

当前大量 Provider 请求把角色规则、作品状态、会话摘要、能力目录和作者输入压入一个大型 `user` 文档，适配层又把消息降为 `role + string content`。这能支持单次结构化判断，却不能无损表达项目已经定义的 AgentRun、原生工具调用与观察、校验失败、tentative artifact、作者裁决、恢复和回放。

如果继续以最低 provider 能力作为内部协议上限，会使统一 AgentRun 的事实被字符串 prompt 截断，并在纠错时形成 `user/user` 的伪多轮历史。与此同时，若另建 writer 私有 provider-native 工具循环，又会形成第二套预算、权限、恢复和作者活动流。

作者在 B71 选择 A：不为现役 giant prompt 或最低 provider 能力降低目标，按统一 AgentRun 的原生多轮会话正式修订/supersede 现役协议。

## 2. 决策范围

本 ADR 冻结目标方向与迁移纪律：

1. **AgentRun 是唯一运行事实源。** 每次 Provider HTTP body 都是该 run 的可重建投影；Provider 私有 response id、推理句柄、加密签名和缓存元数据不得成为项目运行事实源。
2. **内部使用丰富的 Authoring Run Transcript / Request IR。** 保留消息来源、角色、顺序、原生 assistant tool calls、call_id 关联的观察与校验结果、Base/观察 refs、版本、权威状态、覆盖与省略、AgentPlan、tentative artifact、作者出口和压缩 checkpoint。
3. **原生多轮而非伪 user 纠错。** 工具观察与校验失败作为对应 tool_call 的原生结果回流，不再追加 user 消息冒充完整运行历史。
4. **最小 Base + 按需求证。** Base 只含不可猜测的作者意图、写作坐标、目标、权限、预算、必要版本与契约底座；其余作品知识通过同一只读探索目录进入后续真实请求，并保留来源、版本、覆盖与省略。
5. **作者主权进入协议结构。** 模型工具只能读取、计划、提问、报告缺口或生成/修订 tentative artifact；不存在模型可用的 `adopt`、`canon_write` 或自我批准工具。作者回答/采纳/拒绝开启新的授权边界与请求投影。
6. **Provider 只做投影。** CP1 必须形成 Chat Completions、Anthropic Messages、Responses API 的投影与能力门槛；不支持必备能力时只能显式有限模式或拒绝路由，不得静默丢字段后仍宣称完整 AgentRun。
7. **显式压缩与回放。** 长会话只经带来源、版本、覆盖和省略范围的 checkpoint 压缩；作者原文和 artifact 字节不改写。replay 默认从项目 trace 重建，不重调模型。

## 3. 必须承接的现役原则

替换旧协议不是删除既有产品原则。CP1 的替换契约和迁移映射必须逐项保留并重新证明：

### 从 ADR-0030 承接

- 最小可信底座与固定 packet 克制。
- 统一 AgentRun 的只读探索，不建立第二控制环。
- Base 与真实请求观察分账；观察进入后续请求，used refs 不越出 Base ∪ 实际观察。
- 有界预算、取消、恢复、诚实缺口、作者追加或停止。
- 机制/真实模型、浏览器/native、来源合法/语义正确分开验收。

### 从 ADR-0031 承接

- Planner 建议权与 Orchestrator 执行裁决分离，逐步 re-gate。
- 所有回合统一裁决，包括 reply-only；裁决与运行进度分工。
- tentative/adoption/confirmation/write 边界与真实作者动作。
- N-NARR、真实入口来源、输出分层校验、历史兼容与 UI 可用动作来源。

任何冲突只能显式修订，不得以“新协议”名义删除上述作者主权、证据或审计约束。

## 4. 非目标

- 不保留 giant prompt、连续 user 纠错或最低 provider 能力作为目标形态。
- 不建立 writer 私有循环、第二套预算/权限/恢复或第二套 trace。
- 不复制代码 Agent 的 shell/canon 语义，不追求工具数量。
- 不全量回送作品档案，不以新增固定 packet 代替模型求证。
- 不向作者展示 CoT/thinking，不把 Provider 服务端历史当作唯一 replay 来源。
- 不在 CP1 前修改 schema/provider/application 或宣称 Request IR 已实现。
- 不因本 ADR 接受而删除旧实现、历史证据或在途任务记录。

## 5. 考虑过的方案

### A：按目标协议正式修订/supersede（采用）

- 优点：内部运行事实与 Provider 投影同源；原生求证、校验、候选和恢复可完整表达；不形成第二控制环。
- 代价：需要新 contract pack、三类 provider 投影、现役 ADR 迁移和真实页面/实模验证。
- 结论：采用，符合作者“优秀且不为现状妥协”的目标。

### B：只在现役单调用内 additive 实验

- 优点：改动较小，不立即处理 ADR 冲突。
- 缺点：无法表达统一 AgentRun 的完整多轮事实，容易形成长期双协议；不能宣称目标完成。
- 结论：不采用为目标路线，可作为迁移期局部验证手段。

### C：延期

- 优点：无即时迁移成本。
- 缺点：字符串截断和伪多轮继续扩大，后续迁移更困难。
- 结论：不采用。

## 6. Contract 与边界影响

CP1 必须冻结：

- Authoring Run Transcript、Request IR 及其版本策略。
- 消息、工具调用、观察、校验结果、tentative artifact、作者出口与 checkpoint 语义。
- Base/Observation/used refs 的来源与证据绑定。
- 三类 Provider 投影、能力门槛和显式有限模式。
- 六类黄金请求：首轮、观察后、校验失败后、候选后、作者边界后、压缩后。
- 真实 Tauri 场景与证据预注册。

`novel_common` 承载跨 app 的 Request IR 纯契约族（数据结构、边界校验、阶段构造、工具目录视图、压缩视图与产品身份事实）；`novel_agent` 负责 Provider wire 投影、能力事实与实际路由执行；`novel_application` 负责 AgentRun/transcript 与编排，`novel_domain` 只做纯契约与校验；持久 trace/replay 复用现有边界。`novel_web`/frontend 只消费真实 run 事件与作者动作，不新增旁路或直接 Repo 访问。

> 2026-11-06 实施位置修订（B71 裁决 4 C，原则不变）：原文「`novel_agent` 负责 Request IR/provider 投影」是迁移期实施位置；B71 落地后证明 Request IR 需被 application 构造、agent 消费、多 app 测试构造，属跨 app 纯契约，按 [VS-00L §4/§19](../contracts/VS-00L-authoring-run-transcript-request-ir-contract-pack.md) 的「IR 是运行事实的 provider-neutral 投影输入；实际路由选择、能力事实与 wire 投影归同一执行边界」拆分为 common 契约族 + agent 执行边界。wire 投影字节与持久化事实不变。

## 7. 迁移与旧 ADR 退役条件

1. **当前阶段**：ADR-0030/0031 在迁移期继续作为现役实现基线；本 ADR 只冻结目标与迁移规则。不得把当前状态描述为旧协议已经 Superseded。
2. **CP1 必须交付替换 contract pack 和逐条迁移映射**：明确每个旧 contract/字段/场景是保留、重命名、转换、退役还是历史兼容，并列明 B39/B01/B43/B45、UA-01、VS-00I 的承接。
3. **CP1 复核通过后**：ADR-0030/0031 正式转为 Superseded，替代者为本 ADR；同步 design README、00c、contracts/ADR 索引和相关任务。不得长期保留两套并行权威。
4. **迁移证据不删除**：B26/B27/B39 等既有真实运行和失败证据保持只读；在途任务按新映射重锚，不以旧 Accepted 阻止目标迁移，也不以新 Accepted 代签实现。
5. **实现迁移**：先完成 Request IR 与投影，再接首个真实创作 AgentRun；旧协议的实际退役以消费者迁移和回归证据为准，不能只改文档状态。

## 8. 垂直切面证明

首个真实消费者是“先读取作品事实，再生成 tentative 候选”的创作 AgentRun。必须证明：

- 自然作者输入触发同一只读探索，观察携 refs/版本/覆盖进入下一真实请求。
- 工具校验失败作为原生结果回流，模型修正仍受预算和 Orchestrator 约束。
- 候选保持 tentative，只有真实作者采纳改变 canon。
- 作者出口、压缩、恢复与 replay 可重建，replay 不调模型。
- 六类黄金请求、provider 投影矩阵、I1/I2/I3、N-NARR、真实 Tauri 与真实模型行为分别留证。

局部 adapter/golden 测试只能作为局部证据，不能替代 CP3–CP4 的完整场景。

## 9. 后续工作

- B71 CP1：冻结 contract pack、迁移映射和场景预注册，随后按 §7 处理旧 ADR 状态。
- B71 CP2：实现 canonical transcript/Request IR 与 provider 投影。
- B71 CP3：接通首个真实创作 AgentRun 及预算、权限、trace、恢复。
- B71 CP4：覆盖规划/修订/质量、压缩恢复、真实 Tauri 与真实模型。
- B71 CP5：完成旧协议退役、全部门禁、文档索引与事实台账。

## enforced_by

下列路径只证明当前 AgentRun、只读探索和证据规则的既有基础，不证明 Request IR 或原生多轮目标已经实现：

- `apps/novel_domain/lib/novel_domain/agent_run.ex`
- `apps/novel_application/lib/novel_application/agent_run_server.ex`
- `apps/novel_application/lib/novel_application/exploration_service.ex`
- `apps/novel_application/test/novel_application/exploration_service_test.exs`
- `scripts/lib/quality/evidence_chain.mjs`
- `scripts/lib/quality/evidence_chain.test.mjs`

## enforcement_gaps

| 未实现 / 未验后果 | 承接与关闭证据 |
|---|---|
| 替换 contract pack、Request IR、消息/工具/观察/校验/候选/checkpoint 语义与迁移映射 | B71 CP1；冻结文档与逐条 ADR/消费者映射 |
| ADR-0030/0031 正式 Superseded 及相关索引/任务重锚 | B71 CP1 复核通过后；不得提前宣称已退役 |
| 三类 Provider 投影与能力门槛 | B71 CP2；golden/adapter 矩阵及缺能力拒绝/有限模式反例 |
| 首个真实创作 AgentRun 的原生求证、校验失败回流与 tentative 候选 | B71 CP3；真实请求、页面、DB、预算和逐步 gate 证据 |
| 作者采纳/拒绝、压缩恢复、规划/修订/质量及 replay | B71 CP4；真实 Tauri、恢复与 no-provider replay |
| 真实模型行为、完整门禁与旧协议实际退役 | B71 CP4–CP5；独立实模证据、I1/I2/I3 和消费者回归 |

## 10. 2026-11-01 请求投影修订：稳定层、动态 scope 与可恢复 transcript（Proposed）

作者复核 CP3a 实现后指出：Codex、dsh、Claude Code 同样考虑用户主权与证据一致性，整段刷新 Base 本身不构成项目优势，必须先修订方案再改实现。本修订不改变 §2 的 Accepted 主方向，但明确禁止把“每次重新生成整段 Base”误当成目标架构。

### 10.1 稳定层与动态 scope

- **稳定层在同一 run 内不得重写**：产品宪法、run 角色、输出协议、工具 schema、作者原话及既有 assistant/tool 消息必须保持来源、顺序与字节稳定。
- **动态 scope 以追加消息更新**：作品 revision、操作目录、权限、预算、观察状态和恢复状态可以变化，但只能追加带版本、来源与变更原因的 `scope_update` 消息，不得借更新 scope 重写任务规则或历史消息。最新 scope 是后续执行的事实视图，旧 scope 仍保留为证据。
- **执行授权仍在 Orchestrator/gate**：scope 只负责模型可见的事实，不授予执行权；动态更新不得造成旧权限复活，也不得为了缓存保留过期预算或操作目录。
- **消息体采用追加式 transcript**：初始 Base 后只追加 scope_update、assistant、tool、checkpoint 等新事实，不整段替换或重写既有 body。`refresh_prompt` 以 fresh messages 全量替换旧前缀的当前实现属于迁移形态，必须改成追加式投影。

### 10.2 Canonical transcript 与恢复

- `judgment_prompt_override` 已从首个判断消费者的生产链移除，不再充当 canonical transcript 或恢复来源。`AuthoringTranscript` 统一持有 run envelope、稳定 Base、作者 turn、scope、assistant/tool 与私有回放元数据；Provider body 只是它的投影。
- durable checkpoint 保存带版本的 canonical transcript；恢复时保留真实 assistant/tool 顺序与 call_id 关联，最新 scope 决定是否继续开放权限。不得用旧 prompt 冒充恢复，也不得为恢复重调模型。离线恢复事实与自动重启执行是不同边界，后者不在本修订中冒充完成。
- 无工具调用的协议纠错使用带 application provenance 的 `application_notice`，不冒充作者新输入；工具调用失败仍使用 `validation_result`。模型计划产生的多次真实读取聚合为一个有来源的观察，不伪造逐步 Provider 调用。
- 长会话仍只经显式 checkpoint 压缩，checkpoint 必须保留覆盖范围、来源 refs、版本与省略范围。

### 10.3 新增验收证据

在 G1–G6 之外增加：

- **G7 动态 scope 后**：前次 body 是后次 body 的严格前缀；新增内容仅为 `scope_update`、assistant/tool 或 checkpoint，预算关闭、撤权和作品 revision 更新正确，旧权限不复活。
- **G8 恢复后**：从持久 run 事实重建的 Request IR 与恢复前 transcript 语义等价、消息顺序与 call_id 关联保留、scope 为当前版本，replay 不调 Provider。
- 缓存命中、语义漂移与恢复一致性分别留证；缓存指标不设固定阈值，但不得用未测量的“缓存收益”宣称方案优越。

实施顺序改为：先按本修订更新 VS-00L 与 B71 验收口径，再写 G7/G8 红测试，最后修改生产实现。未经这些证据，不得把整段 Base 刷新视为 CP4 可接受终态。

### 10.4 真实多轮样本的吸收映射

- Codex 样本中的连续工具调用/输出与 compaction 证明追加式 input 的价值；本项目吸收严格前缀与显式检查点，但 checkpoint 必须保留可审计 refs、版本与省略范围，不以加密内容替代证据。
- Claude Code 样本中的稳定 system/tools、交替 `tool_use/tool_result` 和 `cache_control` 证明稳定前缀与类型化消息可并存；本项目保留稳定层与 provider 原生缓存断点。
- dsh 样本中的 `assistant → tool` 连续消息、`reasoning_content` 与 `stream_options.include_usage` 证明原生工具结果、推理回放与用量可并存；本项目只把推理句柄当 provider 私有回放数据，不把其当项目事实源。

三者共同支持“追加而非重写”的请求模型；项目新增的仅是 `scope_update` 的版本化事实、tentative/canon 分层和作者采纳边界，不另造与这些成熟机制冲突的上下文形式。
