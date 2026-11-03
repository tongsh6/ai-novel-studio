# VS-00L Authoring Run Transcript / Request IR Contract Pack（统一 AgentRun 原生多轮）

> 状态：**Frozen（2026-10-31，B71 CP1；ADR-0033 Accepted 目标方向的替换契约）**。本 pack 只冻结目标契约与迁移映射，不授权产品代码/schema/provider 实现。CP1 已由作者复核通过（2026-10-31）：ADR-0030/0031 已转 Superseded，原则由 ADR-0033 §3 承接，实现迁移进行中（B71 CP2–CP4）。
> 上游：[ADR-0033](../adr/ADR-0033-authoring-run-transcript-request-ir-v3.md)、[Provider 抽象 §26](../foundation/08-provider-abstraction.md#26-ai-novel-studio-原生多轮创作请求体2026-10-30-目标设计2026-10-31-作者选-a方向-accepted)、[00 §2.2–§2.4](../00-vision-and-engineering-roadmap.md)。
> 承接与对账：`VS-00K`、`UA-01`、`VS-00I`、`VS-00H`、`VS-02`、`VS-02A`、`VS-04`、`VS-06`、ADR-0030/0031。
> 执行与验收：[B71 CP1–CP5](../../../tasks/slices/B71-provider-message-fidelity.md)。
> 非目标：不冻结具体 provider 能力等级、模型参数数值、工具全集、schema 列名或预算常数；不冻结 writer 私有循环。

## 1. 要纠正的根问题

现行请求把角色规则、作品状态、会话摘要、能力目录和作者输入压进一个大型 `user` 文档，`normalize_messages/1` 又只保留 `role + string content`。它能支撑单次结构化调用，但无法无损表达项目已经定义的 AgentRun、原生工具调用与观察、校验失败、tentative artifact、作者裁决、恢复与回放，并会在纠错时产生 `user/user` 伪多轮。

本 pack 冻结替代方案：**统一 AgentRun 是唯一运行事实源；Authoring Run Transcript 是 run 内的丰富事实；Request IR 是每次 Provider 请求的内部中间表示；HTTP body 只是 IR 的 provider 投影。**

## 2. 术语与不变量

| 概念 | 定义 | 边界 |
|---|---|---|
| AgentRun | 一次有界创作运行（目标、预算、权限、步骤、工具、作者出口） | 唯一运行事实源；不因 provider 私有 id 改变 |
| Authoring Run Transcript | run 内有序消息、工具调用、观察、校验、候选、作者出口与 checkpoint 的事实序列 | 可重建 IR；不等于任意 prompt 字符串 |
| Request IR | 一次 Provider 请求的内部中间表示（本节 §4） | 内部契约，不直接暴露给作者 |
| Projection | IR → 某 provider HTTP body 的无损（或显式有限）映射 | 不支持能力必须声明有限模式或拒绝 |
| Observation | 真实只读探索结果（含来源 refs/版本/覆盖/省略） | 不得由 APP 伪造为模型选择 |
| Validation Result | 工具参数/权限/结构校验结果，绑定 call_id | 校验通过≠执行批准 |
| Tentative Artifact | 待作者采纳的候选产物 | 模型无 adopt/canon_write/自我批准 |
| Checkpoint | 显式压缩消息（覆盖 turn 范围、来源 refs、版本、省略范围） | 不得不可见截断；作者原文/artifact 字节不改写 |
| Base | APP 主动提供的不可猜测信息（目标、坐标、权限、预算、必要版本与契约材料） | 不声称穷尽知识；知识经只读观察进入 |

**不变量**

| ID | 不变量 | 违反示例 |
|---|---|---|
| I-ART-1 | AgentRun 唯一事实源；IR 可由 run 事实重建；provider 私有 response id/推理签名/缓存元数据不入事实源 | 用 `previous_response_id` 代替项目 trace |
| I-ART-2 | 作者原话独立 `user` 消息，provenance=author，字节不变、可追溯 | 把作者话与规则拼成一段 application 文本 |
| I-ART-3 | `application_base` provenance=application，不冒充作者新指令或模型输出 | 把 Base 渲染成 `user` 角色假装作者要求 |
| I-ART-4 | 观察必须绑定真实查询与 `call_id`，并以 status 如实表达 ok/partial/truncated/unavailable/stale；失败不得渲染为完整事实 | 读取失败仍输出“作品没有该事实” |
| I-ART-5 | 工具校验失败是该 tool_call 的原生失败结果回流；不得追加 `user` 消息冒充纠错历史 | `user: 你刚才漏了…` |
| I-ART-6 | 模型动作集只有只读/计划/创作/提问/报告缺口；不存在 adopt/canon_write/自我批准工具 | 工具名为 `accept_candidate` |
| I-ART-7 | 压缩只经显式 checkpoint；携带覆盖范围、来源 refs、版本、省略范围；作者原文与 artifact 字节可回查 | 静默截断 transcript |
| I-ART-8 | 投影无损；能力不足必须显式 `finite_mode` 或 `reject`，禁止静默丢字段后宣称完整 AgentRun | 丢弃 tool_call 字段仍报 completed |
| I-ART-9 | 最小 Base + 按需求证；`used_refs ⊆ base_refs ∪ 实际 observation_refs`；越界引用不得通过 | writer 使用未被观察的记忆内容 |
| I-ART-10 | 缓存/推理/服务端历史优化不得改变消息顺序、证据保真、作者字节和采纳边界 | 为缓存把作者原话提前到 system |
| I-ART-11 | 普通文本、工具参数、观察内容来源边界清晰；CoT/thinking 不进入作者可见叙事 | 把 reasoning 原文写入 assistant_message |
| I-ART-12 | 历史兼容：旧字段/场景按 §8 映射处理；不删除历史证据或在途任务 | 以“新协议”删除旧失败批次 |

## 3. Authoring Run Transcript 逻辑模型

### 3.1 Run envelope

```text
run_id, work_id, workspace_id, session_id,
goal {text, source_ref, version},
generation/turn_ref,
budget {max_provider_calls, max_tool_calls, remaining},
authority_scope {production_write, allowed_tools, mode},
model_profile / capability_profile,
trace_ref, created_at
```

约束：envelope 字段来自 run 事实；投影只可增补 provider 专用请求参数，不得改变 envelope 语义。

### 3.2 消息类型（Transcript 事实）

| role/provenance | 用途 | 关键字段 |
|---|---|---|
| `system` / product | 产品宪法 + run 角色与输出协议 | `identity_ref`、`constitution_version`、`output_protocol_version` |
| `application_base` / application | 目标、坐标、权限、预算、Base refs | `base_refs[]`、`versions`、`budget`、`authority` |
| `user` / author | 作者原话（每轮独立消息） | `author_turn_ref`、字节原文、`source_ref` |
| `assistant` / model | 作者可见叙事 + tool_call 列表 | `message_id`、`tool_calls[]`、`narrative`（author-visible） |
| `tool` / tool_result | 观察或校验结果 | `call_id`、`result_kind`、`payload`、`source_refs`、`versions`、`coverage`、`omissions` |
| `checkpoint` / application | 显式压缩摘要 | `covers`（turn 范围）、`source_refs`、`versions`、`omissions`、`summary` |
| `author_exit` / application | 作者出口（问题/裁决/追加预算） | `kind`、`question_ref`/`available_actions`、`behavior_ref` |

`result_kind` ∈ `observation` / `validation_result` / `capability_gap_report`；观察 payload 至少含 `status`、`content`、`next_offset`、`authority`、`coverage`、`omissions`。

### 3.3 Tool call 与 observation 绑定

- 每个 `assistant.tool_calls[i]` 有 `call_id`、`name`、`arguments`、`schema_version`、`dispatch_ref`（Orchestrator 决定记录）。
- 每个 `tool` 消息以 `call_id` 关联；禁止无 call 的“观察”消息。
- 工具结果只表示执行结果；工具计划批准、权限与预算仍由 Orchestrator/gate 掌握（ADR-0031 承接）。
- 观察来源与 N-NARR：`source_refs` 必须来自同一次真实查询；`used_refs` 在后续请求中不得超出 Base ∪ 观察。

### 3.4 Base / Observation / used refs 证据绑定

- `base_refs`：APP 主动提供；逐项记录 `source_type`、`ref`、`version`、`policy`（author-visible 或 internal）。
- `observation_refs`：来自真实工具调用，携带 `call_id` 与读取时刻。
- `used_refs`：模型在后续请求/候选中的使用声明，机械校验 ⊆ Base ∪ observation；越界即为证据缺口（I-ART-9）。
- 未读/失败/截断/过期必须进入请求可见状态，不得渲染为“为空”或“完整”。

### 3.5 Tentative artifact 与作者出口

- 创作工具只产出 `tentative artifact`（pending 候选），字段继续满足 I1 因果绑定（title/body/rationale 来自 provider 字节或合法作者消息）。
- 模型不得调用 adopt/confirm/canon_write；作者采纳/拒绝/编辑开启**新的授权边界**与新的 run/投影，旧 `tool_call` 不跨不明授权状态继续执行。
- `ask_author` / 需要裁决或追加预算时结束机器消息链，由 application 持久真实问题与可用动作（TurnResult）；不把作者回答伪装成工具自动返回。

### 3.6 压缩 checkpoint

- 长会话只通过 `checkpoint` 消息压缩：必须记录覆盖的 turn 范围、来源 refs、版本、省略范围与不可见性说明。
- 作者原文与 artifact 字节不因压缩被改写；回查能力保留（trace/replay 可定位被压缩 turn）。

## 4. Request IR v1 结构与版本策略

```text
AuthoringRequestIR v1 = {
  ir_version: "authoring-request-ir/v1",
  run: RunEnvelope,
  system: {
    identity_ref, constitution_version, output_protocol_version,
    run_role, output_schema_ref
  },
  messages: [TranscriptMessage...],   // §3.2 的投影输入
  tools: [ToolSchema...],             // run 角色最小完整目录
  projection: {
    target: :chat_completions | :anthropic_messages | :responses_api,
    capability_profile: CapabilityProfile,
    cache_hints: [...],               // 仅优化，不改变顺序/语义
    reasoning_options: {...},
    usage_streaming: boolean,
    finite_mode: nil | FiniteMode
  },
  refs: { base_refs: [...], observation_refs: [...], used_refs: [...] },
  provider_session: nil | {...}       // provider 私有回放数据，不入事实源
}
```

版本策略：

- `ir_version` 采用 major/minor：major 变更需 ADR 与 projection matrix 更新；minor 只能 additive。
- 字段增删必须同步 §6 投影矩阵、§7 黄金请求与迁移映射；不得只改 IR 不改投影。
- provider 私有字段只允许出现在 `provider_session` / `projection` 或 assistant 消息的 opaque `provider_state`；后者绑定来源 provider/model，只供同源 adapter 回投，不进入作品事实、ProviderOutput/作者事件或 Why 文案。默认及跨 Provider/model 投影不输出这些私有字段。
- `RunEnvelope` 只保存运行身份与目标快照（run_id/work_id/workspace_id/session_id/parent_turn_ref/profile_ref/goal）；运行进程、策略 struct、执行函数与热状态不进入 IR。统一构造边界解析一次，保证 durable JSON 可恢复。
- legacy 输入（旧 giant prompt 组装结果）可在 CP2 迁移期经 `legacy_adapter` 转成 v1 IR；`legacy_adapter` 必须有显式标记并在 CP4 前退役（§8）。

## 5. 消息/工具/观察/校验/候选/作者出口/checkpoint 语义规则

1. **Base 与作者消息分离**：Base 是 application 消息；作者原话每条轮次独立、字节不变；不得渲染为 `system` 或 `user` 合并。
2. **历史与压缩**：历史保留真实 user/assistant/tool 顺序；压缩替换为 checkpoint 消息，不静默删除。
3. **工具目录**：按 run 角色提供最小完整目录；工具 schema 与描述稳定形成缓存前缀的一部分（VS-00I 承接）。
4. **观察回流**：观察/校验失败作为 tool 消息进入下一请求；同一 `call_id` 只允许一个结果消息。
5. **校验失败**：失败结果必须带 `reason_code`/`schema_version`/可执行的修正信息；模型修正仍受 Orchestrator、预算与权限约束。
6. **候选**：tentative artifact 作为 tool 结果/assistant 输出之一进入 IR；pending 状态由 application 投影，模型不得声称已采纳。
7. **作者出口**：`ask_author` 以 author_exit 消息结束本轮机器链；作者回答后开启新投影，旧 run 状态只读。
8. **checkpoint**：仅由压缩策略产生；携带覆盖范围与来源；不得改变作者字节或 artifact 字节。
9. **推理/thinking**：只作 provider 私有回放参数；不进入 author_visible 叙事，不落作者可见 trace 原文。
10. **投影失败**：能力不足时 `finite_mode` 必须声明受限能力（如 no_tools / single_turn / no_streaming），或 `reject` 路由；不得静默降级后记 PASS。

## 6. Provider 投影与能力门槛

### 6.1 Chat Completions（openai-compatible）

| IR 元素 | 投影 |
|---|---|
| system | `messages[0].role=system`（identity + 宪法 + 输出协议） |
| application_base | `messages[i].role=user` + 明确标记为 application data 的文本块（不得冒充作者）→ 若 provider 无结构化 channel，必须在文本 header 标 provenance，且作者原话仍独立 user 消息 |
| user | 独立 `role=user`，字节原文 |
| assistant + tool_calls | `assistant.tool_calls[]`（`id`=call_id, `function.name/arguments`） |
| tool result | `role=tool` + `tool_call_id` |
| checkpoint | `role=user`/`role=assistant` 的显式压缩块，带 covers/refs/omissions（若 provider 无专用位，按声明格式） |
| 推理回放 | DeepSeek 仅按原生要求回放 `reasoning_content`（provider_session） |

### 6.2 Anthropic Messages

| IR 元素 | 投影 |
|---|---|
| system | `system` blocks（可用 cache_control 断点） |
| user/application_base | `content: [{type:"text", ...}]`；application data 必须有 provenance 标记 |
| assistant tool_calls | `content: [{type:"tool_use", id: call_id, name, input}]` |
| tool result | `content: [{type:"tool_result", tool_use_id: call_id, content}]` |
| 缓存断点 | 稳定 system/tools/Base 前缀；易变观察/作者输入置后 |
| thinking/signature | 仅 provider 私有回放数据，不展示、不作事实源 |

### 6.3 Responses API

| IR 元素 | 投影 |
|---|---|
| input | 完整 input items（message/function_call/function_call_output） |
| tools | 原生工具项 |
| reasoning | 推理句柄（provider_session），不得成为 replay 唯一来源 |
| `previous_response_id` | 仅优化；项目 trace/replay 仍由 run 事实重建 |

### 6.4 能力门槛与显式有限模式

完整 AgentRun 必备能力（最小集合）：native multi-turn、tool calls + results、streaming parse、structured output、usage recovery。任一缺失：

- `finite_mode`：显式声明受限（例：`no_tools`、`single_turn`、`no_streaming`、`no_structured_output`），只在被声明的消费者/场景使用；
- 或 `reject`：拒绝路由并给作者可见原因，不得静默丢字段后宣称完整运行。

有限模式必须写入 IR `projection.finite_mode`、trace 与验收报告；不得用有限模式冒充 CP3–CP4 的完整场景。

### 6.5 缓存、推理句柄与服务端历史

- 稳定 system、工具 schema、Base 前缀可缓存；易变观察、作者输入、校验结果置后。
- 缓存/推理/`previous_response_id` 只优化请求，不改变消息顺序、证据保真、作者字节与采纳边界（I-ART-10）。
- 缓存命中率/`cached_tokens` 只作观察指标，不设固定阈值、不作 PASS 判据。

### 6.6 前缀稳定性承接（VS-00I）

- VS-00I L0–L4 分层、工具 schema 稳定、易变内容置后、I-CACHE-1 共享前缀测量保留，重锚到「每个投影的稳定前缀」。
- VS-00I 的“单调用语义”断言（旧 call1/none 口径）在 CP2 后转为历史；新守卫必须按 IR 投影复跑，不静默放宽门禁。

## 7. 六类黄金请求

黄金请求是 IR + 投影的可复跑基线（fixture 化）；每类必须同时断言 IR 结构与 provider body 关键字段，禁止只比较 JSON 形状相似。

| 编号 | 场景 | 输入 transcript 切片 | 期望投影要点 | 关键断言 |
|---|---|---|---|---|
| G1 | 首轮 | system + application_base + 作者原话 | 作者原话独立 user 消息、Base 标 provenance、tools 目录 | 字节保真；无伪 user；工具目录与角色一致 |
| G2 | 观察后 | G1 + assistant tool_call + tool observation(status=ok) | tool 消息按 call_id 关联、observation refs/版本/覆盖进入下一请求 | 观察真实进入；used_refs ⊆ Base∪观察；I-ART-4 |
| G3 | 校验失败后 | G2 + tool validation_result(status=failed, reason_code) | 失败作为原生 tool 结果回流，无追加 user 纠错 | 无 `user/user`；模型修正受预算/gate；I-ART-5 |
| G4 | 候选后 | G3 + assistant tentative artifact tool_call + 作者 pending 投影 | 候选为 tentative，无 adopt 工具；下一请求 Base 含 pending refs | 模型不得声称已采纳；I1 因果绑定；I-ART-6 |
| G5 | 作者边界后 | G4 + 作者真实采纳/拒绝动作 | 新授权边界；旧 tool_call 不跨边界；新 run/投影含采纳结果 refs | 作者动作开启新边界；canon 只在采纳后变化 |
| G6 | 压缩后 | 长会话 + checkpoint(covers/refs/versions/omissions) | checkpoint 是唯一压缩表达；作者原文/artifact 字节可回查 | 无不可见截断；I-ART-7；replay 可重建 |

黄金请求要求：

- 数据来自合成 fixture 或脱敏真实样本；真实模型行为证据另计（CP4），不把 golden 通过当模型语义通过。
- G1–G6 在 CP2 先以 adapter/golden 测试冻结；CP3 首个消费者接入后以真实 run trace 复跑；CP4 在真实 Tauri 场景中复验。

## 8. 与现役契约/ADR 的迁移映射（逐条）

处置枚举：**保留**（语义不变，继续有效）/ **重命名**（概念改名/换载体）/ **转换**（语义保留、实现形态迁移）/ **退役**（旧形态停止使用，历史证据保留）/ **历史兼容**（只读旧数据/旧断言，不再成为目标）。

| 对象 | 现役语义 | 目标处置 | 承接 CP | 复核/证据 |
|---|---|---|---|---|
| ADR-0030 原则 | 最小 Base、统一只读探索、观察/来源分账、有界预算、诚实缺口 | **保留** | CP2–CP4 | ADR-0033 §3；本 pack §2/§3 |
| ADR-0030 实现形态 | 单调用 + giant prompt 表达全部会话结构 | **退役**（CP4 前完成消费者迁移） | CP3–CP4 | 旧 ADR 复核后转 Superseded；历史证据只读 |
| ADR-0031 原则 | 统一裁决、逐步 gate、作者主权、真实来源、tentative/adoption 边界 | **保留** | CP2–CP4 | ADR-0033 §3；B43 保持 |
| ADR-0031 实现形态 | 单调用共享入口承载判断/执行 | **转换** | CP2–CP3 | 同一 Orchestrator/decision producer 投影到多轮 run |
| UA-01 单调用共享入口（B26/B27 联合修订） | 一次调用完成判断+执行，终态表/工具 schema/持久问题 | **转换**：能力目录、终态表、tool schema 语义保留；调用形态改为 run 内多轮 | CP2–CP3 | B26 终态/工具语义对账；B71 CP3 首个消费者 |
| VS-00I 前缀稳定性 | L0–L4 分层、工具恒定、I-CACHE-1 | **保留并重锚**：重锚到每个投影的稳定前缀 | CP2 | §6.5/§6.6；I-CACHE-3 单调用断言转历史 |
| VS-00K 求证式创作 | 最小 Base、Requested Observation、证据使用、AU-15 | **保留**：载体从 prompt 段迁移为 IR messages | CP2–CP4 | §3.4、§7 G2/G3；AU-15 验收保留 |
| VS-00H 系统身份 | 身份唯一真源、唯一注入点、system_identity_ref | **保留并重命名**：进入 IR `system.identity_ref` 投影 | CP2 | §6.1–6.3 |
| VS-02 / VS-02A / VS-04 / VS-06 | ToolRequest/Result 溯源、tentative artifact、adoption、replay | **保留**（引用不变） | CP2–CP4 | 本 pack §3.3/§3.5 |
| B26 判断协议工具/终态 | 单调用判断工具、capability、终态表 | **保留**工具与终态语义；**转换**调用载体 | CP3 | 首个消费者真实验收 |
| B39 CP1–CP4 | 求证式创作实施与验收 | **重锚**至 B71 CP3 首个消费者；历史证据只读 | CP3–CP4 | B39 完成状态不因本 pack 自动改变 |
| B01 来源列 | `origin_turn_ref`/`origin_frame_ref` 来源 | **转换**：映射到 IR provenance/source_refs；旧列迁移由 B01 原任务承接 | CP2 | B01 仍待迁移授权 |
| B43 统一裁决 producer | `MissingPolicy` 门序、统一 decision | **保留**：decision producer 不变；输入 frame 从 IR 派生 | CP2–CP3 | B43 裁决仍待作者终选（A/B/C/D） |
| B45 schema legacy 治理 | 现役/legacy schema、wire 兼容 | **保留**：IR v1 版本策略承接；legacy_adapter 有退役期限 | CP2–CP4 | §4 版本策略 |
| B27/B33 判断与纠错 | 判断协议、纠错 gate、wrong-route | **保留**：纠错改为 tool result 回流，不再 user/user | CP2–CP3 | 纠错语义对账 |
| giant prompt 组装（ContextAssembler / prompt builder） | 固定 packet/段落 + 动态事实 | **转换/退役**：Base 组装保留为 application_base；固定 packet 段落按 B39/AU15 迁移，不新增专用 packet | CP3–CP4 | §2 I-ART-9；B39 承接 |
| `normalize_messages/1` 丢 tool 字段 | 最低公分母字符串消息 | **退役** | CP2 | 投影矩阵取代 |

**旧 ADR 退役执行记录（ADR-0033 §7）**：本 pack 与映射冻结（2026-10-31）→ 作者复核通过（2026-10-31，B71 CP1 汇报后作者确认 A）→ ADR-0030/0031 已转 Superseded → design README、00c、contracts/ADR 索引与 B39/UA-01/VS-00I/VS-00K 已同步迁移注记 → CP2 起按新契约实现。旧实现与证据只读保留，不形成长期双轨。

## 9. 验收与证据分层

| 层 | 证据 | 不代签 |
|---|---|---|
| CP1 | 本 pack、迁移映射、六类黄金请求定义、场景预注册、链接/索引/静态扫描 | 不声称产品验证 |
| CP2 | IR struct/投影、adapter golden G1–G6、能力门槛/有限模式/拒绝路由单测、I-CACHE 重锚 | 局部测试不替代真实页面/模型 |
| CP3 | 首个真实创作 AgentRun：自然输入→只读求证→观察回流→tentative candidate→作者出口；预算/gate/trace/恢复 | 真实 Tauri 页面证据 + 真实请求/DB/trace |
| CP4 | 规划/修订/质量、压缩恢复、真实 Tauri 全链、真实模型行为、缓存/usage、replay/Why、全门禁 | 真实模型行为单列；I10 文学质量不由协议代签 |

真实 Tauri 验收由外部自动化驱动当前 WorkspaceChat；产品代码不新增验收感知逻辑；观察进入下一真实请求与 used refs 不越界必须由请求字节/持久 trace 证明，不能只看 JSON 结构。

## 10. enforcement_gaps（未实现/未验后果）

| 未实现/未验后果 | 承接与关闭证据 |
|---|---|
| IR struct、投影实现、能力门槛代码 | B71 CP2；adapter/golden 与单测 |
| 首个创作 AgentRun 原生多轮与观察回流 | B71 CP3；真实请求/页面/DB/trace |
| 压缩恢复、规划/修订/质量、replay/Why | B71 CP4；真实 Tauri + 实模 |
| ADR-0030/0031 Superseded 与索引/任务重锚 | CP1 复核通过后执行；不提前宣称 |
| giant prompt/`normalize_messages`/固定 packet 实际退役 | CP3–CP4 消费者迁移证据 |
| 三类 provider 的有限模式/拒绝路由反例 | CP2；缺能力 provider 的实测/声明 |

## 11. 版本与兼容策略

- IR v1 冻结后，CP2 实现必须按 major/minor 规则演进；additive 字段需同步 §6/§7/§8。
- legacy 输入（旧 prompt 组装）只允许经 `legacy_adapter` 进入 v1；adapter 必须在 CP4 前退役，不留长期双轨。
- 旧 trace/replay/证据不迁移、不删除；新 run 的 trace 引用 IR/投影摘要，旧数据按历史兼容读取。
- 未决：具体 schema 列名、trace 存储结构、provider capability 探测方式由 CP2 落地时冻结，本 pack 只冻结语义与投影规则。

## 12. 明确不在本 pack 冻结的内容

- 具体数据库 schema/列名、migration 方案、trace 表结构。
- 模型参数默认值、预算常数、缓存阈值。
- 工具全集与每个工具的最终 description 文案（由 run 角色目录在 CP2 冻结）。
- 外部 provider 能力探测协议细节；只冻结“必须显式有限模式或拒绝”的规则。
- 真实页面的具体场景脚本与截图证据（CP1 只做预注册，执行归 CP3/CP4）。

## 13. CP1 文档验收

- [x] ADR-0033 Accepted（作者选 A，2026-10-31）；旧 ADR 状态边界明确。
- [x] 本 pack 冻结术语/不变量/transcript/IR v1/投影矩阵/能力门槛/黄金请求/迁移映射。
- [x] 迁移映射逐条覆盖 ADR-0030/0031、UA-01、VS-00I、VS-00K、VS-00H、VS-02/02A/04/06、B26/B39/B01/B43/B45/B27/B33。
- [x] 场景与证据预注册写入 `artifacts/model-contracts/b71-cp1/scenario-preregistration.json`（真实 Tauri + 证据分层；执行归 CP3/CP4）。
- [x] `docs/design/contracts/README.md`、`tasks/slices/B71-provider-message-fidelity.md`、`tasks/NEXT.md`、`docs/project-ledger.md` 同步。
- [x] 复核通过（2026-10-31，作者确认 A）：ADR-0030/0031 已转 Superseded，索引/00c/契约包/任务同步；实现迁移归 B71 CP2–CP4。

## 14. 稳定层、动态 scope 与可恢复 transcript（2026-11-01，Accepted）

### 14.1 目标投影模型

每次 Provider 请求由三部分构成：

```text
初始稳定 Base
  产品宪法、run 角色、输出协议、工具 schema、作者原话
追加式 transcript
  scope_update（版本化权限/预算/作品 revision/观察与恢复状态，含 source_refs/change_reason）
  user（新的作者 turn，原字节）/ assistant / tool / application_notice / checkpoint / author_exit
Request IR / Provider body（初始 Base + 追加事实的投影）
```

- 消息体本质上是**追加式运行 transcript**：初始 Base 后只追加新事实，旧消息不删、不改、不替换；最新 scope 决定后续执行视图，旧 scope 继续作为证据。
- 稳定层不得随 scope 更新被重写；scope_update 必须独立标识版本、来源与变更原因，不能重写任务规则或历史消息。
- `application_base` 不是每次重新生成的整段文本。当前 `refresh_prompt` 全量替换前缀只属于迁移实现，不是本 pack 接受的终态。
- `judgment_prompt_override` 曾是请求投影，不是 canonical transcript；首个判断消费者已移除该状态通道，canonical transcript 由持久 run 事实恢复。

### 14.2 新增不变量（Proposed）

| ID | 不变量 | 违反示例 |
|---|---|---|
| I-ART-13 | 同一 run 的初始 Base 与既有消息来源、顺序与字节稳定；scope 只能以新的 `scope_update` 消息追加，不得重写稳定层或旧消息 | 为更新预算而重发不同任务规则或替换旧 body |
| I-ART-14 | `scope_update` 必须准确反映当前权限、预算、作品 revision 和操作目录；最新 scope 决定执行视图，旧 scope 仅作证据，旧权限不得复活 | 为保持缓存继续显示已耗尽额度仍可用 |
| I-ART-15 | canonical transcript 可由持久 run 事实恢复并重建 Request IR；`judgment_prompt_override` 不得成为唯一恢复来源 | 进程重启后只能读取上一请求文本 |
| I-ART-16 | 动态更新与恢复不得改变执行授权边界；实际执行仍逐步经 Orchestrator/gate，replay 默认不调模型 | 用 scope 或旧 prompt 直接批准执行 |

### 14.3 G7/G8 黄金请求与实施顺序

- **G7 动态 scope 后**：前次 body 是后次 body 的严格前缀；新增内容仅为 `scope_update`、assistant/tool 或 checkpoint，预算关闭、撤权和作品 revision 更新正确，旧权限不复活。
- **G8 恢复后**：恢复所得 transcript 与恢复前语义等价、消息顺序与 call_id 关联保留、scope 为当前版本，replay 无 Provider 调用。

实施顺序：先修订本 pack 与 B71，再写 G7/G8 红测试，最后修改生产。CP3a 的机制证据只能证明原生回流可用，不能证明整段 Base 刷新是优秀终态；CP4 必须同时提交稳定前缀、动态更新与恢复证据。

### 14.4 CP3c 实现映射与边界（2026-11-01）

- `JudgmentProtocol` 在每次调用及纠错时只追加 assistant/validation/application_notice；`DialoguePlanningService` 只追加真实观察，二者共享同一 `AuthoringTranscript`，没有第二份 prompt 状态。`append_author_turn/3` 保证同一 turn 幂等，新 turn 保留字节并追加。
- 三类 Provider 投影共用 scope 文本和版本信息。工具调用 ID 在进入 transcript 前统一分配；原始参数与 Provider 私有推理引用可以经 checkpoint 恢复，但不成为作者事实或执行授权。
- 单个 explore 产生一个 observation；模型计划包含多个读取时，聚合为一个带真实子观察、refs 和覆盖范围的 observation，不虚构逐步模型调用。
- `AuthoringTranscript.checkpoint/1` / `restore/1` 形成版本化 JSON 边界。durable run 将其写入 LongRunTask checkpoint，进程消失后可离线恢复等价投影；没有 Provider 调用。旧 checkpoint 缺少 transcript 时不伪造历史事实。
- 当前证据只覆盖首个判断消费者的确定性 G7/G8 与离线恢复。**不代签** durable 自动重启执行、全写作 profile、真实模型语义、真实缓存收益或完整 CP4/CP5。

## 15. CP4a 创作与质量迁移方案（2026-11-01，Accepted）

### 15.1 同一 run 的能力切换

目标链路：`judgment_decision(execute)` → 创作 `scope_update` → assistant 原生 tentative-artifact tool_call → 应用校验/物化结果 → 质量 `scope_update` → assistant 原生 quality tool_call → 真实质量结果 → continuation。Provider body 只投影该序列；不得每次以新的 giant prompt 重新开始。

- `CreativeRequest` / `QualityEvaluationRequest` 携带前序 Request IR，而不是另传一份覆盖式 prompt。创作与评审工具定义只能以增加新定义的方式扩展，既有 schema 不改写；scope 决定当前允许的效果。
- canonical transcript 的工具目录是历史事实，不等于当前请求的授权目录。Provider 投影必须以 `tool_names` 选择当前阶段真实允许的工具：创作只开放 tentative-artifact、质量只开放 quality-findings、续行只开放续行契约；单工具阶段以同名 `tool_choice` 强制绑定。目录之外或未知工具名必须显式报错，不能静默重选历史工具。过滤只影响当次 body，不回写或删除 canonical 工具历史。
- 复用历史 transcript 进入续行时，scope 必须同时携带续行角色/输出契约、目标、偏离与观察；不能只过滤工具名而缺少阶段语义，否则模型可能继续上一阶段的 judgment_decision。创作/质量 scope 同样要显式声明角色与材料覆盖。
- 续行响应与后续创作发生在同一 AgentRun step 时，先进入该次执行快照，再由后续创作结果统一持久化；不得用事后 patch 覆盖新 transcript。等待作者等终局保留同一组 step meta，真实 Provider 调用只计一次，不叠加默认规划调用。
- creative/quality adapter 返回业务结果及内部 `request_ir + provider_result`。`TurnExecutionService` 是唯一的应用组装点：校验、生成 tentative artifact、质量结果与 canonical transcript 在此对齐，不能把原始响应直接暴露给作者 UI。
- writer/evaluator 的原生工具调用必须进入 transcript；旧 JSON 文本生成和 `user` 纠错属于迁移期显式有限模式，不是目标。原生校验失败回流 tool result，无工具响应的协议反馈使用 application_notice。
- `TurnExecutionService` 返回 TurnResult、DecisionTrace 和更新后的 canonical transcript，由 AgentRun flow 持久化并供续行/恢复使用。业务 gate、采纳边界、N-NARR 与 I1/I2/I3 不变。

### 15.2 验收

- G4 扩展：观察后 writer 与 evaluator 的请求保留前序 body；原生工具 schema 与调用参数一致，tentative artifact 不产生 canon 写入，质量结果不直接授权修订。
- 校验失败和真实模型错误均保留原始响应与有界反馈；不得以旧 JSON prompt 代替正常路径，不得复制两次 Provider 调用来兼取候选与 transcript。
- 真实 Tauri 创作页面证明 candidate、quality、request body 与持久 transcript 同源。真实模型行为、缓存收益、其它规划 profile 和显式压缩恢复仍归后续窗口/CP4b，不由 CP4a 代签。

## 16. CP4b 统一创作 profile、显式压缩与旧协议退役（2026-11-01，Accepted）

### 16.1 单一 canonical 会话边界

- `AgentRunFlows.AuthoringSession` 是 application 层唯一的会话读写边界：从 `stage_state.judgment_transcript` 派生 Request IR，合并成功结果，并在失败时保留可恢复状态。它不是第二控制环，不决定 gate、预算、计划、候选或采纳。
- `character_design`、`character_evolution`、`plot_outline`、`world_building`、`judgment_plan` 与正文 flow 必须携带同一个 run 和前序 Request IR；不得只接收三元组返回值后丢弃 transcript，也不得复制五套私有 prompt/session 实现。
- `AgentRunServer` 的错误结果允许携带应用状态，先合并 canonical transcript 和真实预算，再保持原有失败/停等语义。不能把失败改成成功，也不能因错误丢失后续恢复所需的模型响应和校验结果。
- `TurnExecutionService` 继续是业务结果与 transcript 的唯一组装点；作者只消费 author-safe TurnResult/UI 投影，内部 run/tool/call/ref 不得转写为作者文案。

### 16.2 显式压缩而非历史丢弃

- 压缩只能由 application 在明确边界调用，携带 `covers`、source_refs、versions、 omissions 和自然语言摘要。不得按消息数、字符数或 provider 私有句柄静默丢弃。
- canonical 消息永久追加保留，`checkpoint` 是独立压缩事件；只有 Provider 投影视图替代其声明覆盖的已完成 assistant/tool 消息。实际压缩使用 `covers.call_ids` 精确选择完整交换，禁止部分选择同一 assistant 的并行调用、重复覆盖、覆盖未知或未完成调用。旧 `turn_range` 仅作历史说明，不授权删除消息。稳定 Base、作者原话、当前 scope 和未覆盖消息保持原序；选中观察的 refs/version 必须与 checkpoint 一致，摘要不能冒充未读或已采纳事实。
- 三种 Provider 投影必须对同一 canonical checkpoint 给出一致语义；恢复后再次投影保持幂等，不重复插入 checkpoint。长会话的原始 artifact 字节、来源和真实版本仍由 canonical trace/refs 支撑，不依赖 provider 服务端历史。

### 16.3 旧协议与 replay/Why

- creative/quality 只有一条原生 Request IR 主链。旧 `generate/evaluate` 的独立 JSON prompt、字符串纠错和重复实现应移除或收敛为同一原生入口的兼容外观；JSON 内容仅可作为显式有限模式的 Provider 响应解析，不再构造另一条请求协议。
- Replay/Why 从持久 DecisionTrace 与 canonical checkpoint 派生 author-safe 解释，不重新调用模型，不返回原始推理、私有 session 或内部工具标识。缺 trace/checkpoint 时必须报告真实不完整状态，不能伪造完整回放。
- CP4b-1 以其它创作 profile、统一失败恢复、显式压缩/恢复和旧协议退役为闭环，附真实 Tauri 创作页与全量门禁；CP4b-2 继续真实模型行为、缓存/usage 和剩余 replay/Why 证据，不能用确定性替身代签真实模型效果，也不缩小 CP4b 原验收范围。

### 16.4 实现落点（CP4b-1）

- `AuthoringSession.request_ir/1` 只从外层运行快照的 `stage_state.judgment_transcript` 派生 IR；不得把外层快照误当成内部 transcript。成功结果沿用 flow pipeline 合并，失败结果由 `AgentRunServer` 先合并 transcript 与实际预算，再执行原有失败语义。
- `AgentRunService.compact_transcript/2` 是显式压缩入口，只在没有执行中任务的安全点调用 `AuthoringSession.compact/2`。durable checkpoint 成功提交后才更新内存并报告成功，失败保留旧状态。`AuthoringTranscript.compact/6` 追加可恢复事件，`RequestIR.Compaction` 统一校验范围/证据并为三类 Provider 派生压缩视图；**显式压缩有两类入口：作者命令与会话安全点按上下文压力的自动维护（2026-11-04 §18 修订，见 §16.16）**，不覆盖原始消息，同一 checkpoint 重放幂等。
- `AuthoringReplay` 从按作品、会话和轮次定位的 DecisionTrace/durable checkpoint 生成作者历史说明。`TraceSummaryView` 只呈现自然语言摘要、省略说明与已有来源显示名；未知工具、审批、使命状态使用通用作者文案，不把 code、call_id、作品/章节 ref、Provider 私有状态或推理原文作为显示兜底。
- creative/quality 的旧 `generate/evaluate` 公开入口共享 `generate_with_session/evaluate_with_session` 的原生 Request IR 执行，不再建立独立 JSON 请求。响应中的 JSON 解析只能服务已标记的有限模式，不能恢复第二套提示协议。

### 16.5 CP4b 边界补全（2026-11-01）

- `Provider.NativeToolExchange` 统一 writer/evaluator 的单工具交换。响应包含多个或未授权工具时整体验证失败，每个原生 call 都保留并获得失败结果；不会挑第一个物化。重试最多一次，末次拒绝也闭合，应用只为仍待处理的成功调用追加业务校验结果。
- `RequestIR` 校验工具调用和结果时序，canonical 可保存待处理响应，请求发出前必须全部闭合。能力门同时作用于生产 `to_provider_prompt/2`；JSON 有限模式必须由请求事先声明，不允许因响应缺少 tool call 而自动降级。具体路由模型的真实能力声明与验证仍为 CP4b 后续证据，不由 IR 内声明代签。
- `AuthoringReplay` 以真实父轮次或已持久步骤查找同作品/会话的 durable checkpoint，并核对 checkpoint 的运行归属；缺失、损坏或错绑使 ReplayReport 与 Why 一致为 `partial`。来源只有引用无显示名时不展示内部 ref，历史摘要不输出私有推理或内部协议标识。
- 失败 flow 沿同一 `AuthoringSession` 返回会话与真实执行计数；工具计数来自实际派发边界，前置任务校验失败为零。失败不能抹去 planner 已消耗预算，也不能用错误文案估算调用次数。
- 判断成功同样需要原生结果：非求证操作返回“协议有效、未授权执行”的 validation；只读求证由真实 observation 闭合。计划若内联读取，判断调用留到应用分流产生聚合观察，其余计划校验调用先闭合。非法多调用逐一返回失败，不能只关闭第一项。
- Provider HTTP 参数的原始 JSON 与解析值同时保留；Chat/Responses 回投保留参数原字节。只能表示对象的投影遇到不可解析原文时必须拒绝或显式有限模式，不可悄悄替换为 `{}`。路由模型先解析为单一配置快照，实际 HTTP body、ProviderRun 记录与超时使用同一结果。

### 16.6 独立计划与使命的同一会话边界

- [`RequestIR.Operation`](../../../apps/novel_agent/lib/novel_agent/provider/request_ir/operation.ex) 是计划、使命、创作与评审共用的纯阶段构造器，将稳定角色/规则/输出契约与动态目标/材料分开。[`AuthoringOperation`](../../../apps/novel_application/lib/novel_application/authoring_operation.ex) 负责从真实 run/snapshot 派生 IR、补当前权限/预算及领域校验结果。已有会话保留全部消息，新阶段必须追加该角色完整规则（不能依赖首阶段恰好是同一角色），并追加 scope 与工具目录；没有会话时仅明确提供的作者原话可独立成为 user，应用目标不冒充作者消息。
- 独立 draft/revise 与 chapter/planning mission 复用 `NativeToolExchange`；每次响应、原始参数、原生校验及实际调用数同源。计划的传输重试与结构纠正共享一次额度，使命保留既有“传输失败直接返回、结构错误最多纠正一次”语义；不得用重新拼接 user 文本的第二协议重试。
- 计划/使命的领域校验成功后，应用追加 passed validation（非执行授权、非采纳），成功与失败 meta 均携带更新的 canonical transcript 与实际 provider_call_count。预检未发请求为零，传输失败同样记真实调用。
- AgentRun 在执行后续 step **之前**将规划结果的会话放入同一快照；step 结果只在缺少更新会话时继承此前会话，禁止旧 planner meta 覆盖新 writer/mission 历史。终局、预算停止与失败亦须保存已发生的计划事实。
- 公开 prompt 构造辅助入口与实际生产调用必须使用同一 IR producer，不保留用于测试的 legacy prompt。原有计划目标、完成前缀、N-NARR、使命来源绑定与作者版优先规则不因迁移改变。
- 尚未迁移的独立创作/评审外观若缺 AgentRun，只可显式标为 `standalone_operation`（不提供 durable run 恢复），使用请求自身的操作会话标识，不把 source_turn_ref 伪装成 work_id。已有真实 run/IR 的生产路径不得走该模式；修订/确认消费者迁移时必须消除此未绑定入口，不能据此签 CP4/CP5 完成。

### 16.7 修订结果校验、同一交换预算与作者动作边界

- 原生协议解析与应用修订范围校验属于同一次工具交换。`NativeToolExchange` 是唯一重试循环；先保存 assistant 原始响应，再校验原生调用集合和输出结构，最后执行应用提供的纯结果校验。任一校验失败都以原 call_id 追加 failed validation 和具体纠正依据，仍失败的末次响应也闭合。总共最多两次实际 Provider 调用，不能在 application 外层再次调用工具形成嵌套重试；调用预算不足时应提前停止，不能执行后再把计数压低。
- 应用校验以内部调用选项传递：`AuthorizedToolExecutor → Toolbox → creative adapter → Real → NativeToolExchange`。应用只接收已归一的 ToolResult，返回 `:ok` 或包含 `reason_code/detail/message` 的失败事实；不得修改创作字节、执行 I/O 或授予采纳权限。回调、进程、函数不进入 ToolRequest.input、Request IR、RunEnvelope 或 checkpoint。agent 仅消费回调契约，不引用 application/domain 模块。
- 阶段输出契约与 companion 范围校验在交换内拒绝；只有所有校验通过的响应才返回应用组装 tentative artifact。ArtifactAssembler 成功/失败由 application 通过统一 AuthoringSession 结果边界闭合仍 pending 的当前调用；协议已经拒绝的调用不得重复闭合。成功、失败、前置拒绝返回同一会话形状与实际调用数，已有历史优先保留，零调用不能伪造模型响应。
- 对话修订继承当前作者输入所创建 run 的判断/观察与权限快照；同一修订中的纠错只追加原生结果，不重复作者 user 消息、不改写旧材料。质量发现卡片修订使用 Channel 已创建的新修订 run，保留源候选、finding refs、目标版本与新作者动作的 provenance，不创建嵌套 run，不继承源 run 权限。
- 工具确认必须单独迁移真实作者动作运行归属、幂等及持久结果链；采纳确认仍由 AdoptionWorkflow 管理。bounded 历史留存与 durable 恢复须分别验收，不能为了证据把实际 bounded 入口改成 durable。该持久化/确认后果仍属于 CP4b，不能由前两类修订接线代签。
- 运行 snapshot 与当前会话持久投影分属不同数据边界：前者提供 canonical 历史/运行态，后者决定当前只读状态、候选可用性和版本。禁止用 snapshot 的同名字段覆盖新读取的持久事实，查询失败也不得回退到旧投影继续派发。内部 `stage_state`/transcript/IR 只随 flow 结果返回运行时，不写入对作者返回或广播的 TurnResult。
- 每次模型实际消费的 scope、应用通知与 checkpoint 都是 canonical 历史的一部分，不能在 workflow 返回前过滤。JSON 数据的稳定表示由共享 producer/projection/restore 边界负责；consumer 不得先做 checkpoint 往返或预处理 fixture 掩盖恢复差异。fresh 内存会话与 JSON 恢复后的三类 Provider 投影须逐字相同，字符串正文、作者空白和已有 raw_arguments 原文保持不变。
- 有限兼容外观只能选择上下文或投影返回形状，不得复制执行、组装、trace 和校验管线。flow 返回本步的状态增量，由运行时合并；不得把执行开始时整份旧 snapshot 再写回覆盖期间更新。Provider 调用上限与实际消耗分开记录：`provider_call_budget` 表示该操作实际允许的上限，实际 Provider/工具次数来自 session 的 `execution_counts`，不得用实际次数回填预算或以预算冒充消耗。旧调用点的预算口径在 CP5 对账中须统一，不能漏项。

### 16.8 私有历史存储、提交与回查身份（CP4b 后续实施契约）

- bounded 与 durable 共用 `agent_runs.authoring_transcript` 私有 nullable JSON 列，保存现有 `authoring-transcript/v1` 完整 canonical checkpoint。未产生会话时为空；已存在的历史不得因不含新 transcript 的状态更新被清空。新写入必须校验完整不可变身份（run/work/workspace/session/parent turn）及旧消息的完整前缀；goal/profile 等可变 scope 不作为不可变身份。该列不进入 Domain AgentRun、公开 JSON Schema、TurnResult、事件或 HTTP DTO。
- durable 执行 checkpoint 升为 v3，只存 `authoring_transcript_ref`（run_id 与 transcript 格式版本），引用同一事务中保存的 run 私有历史，不再复制 canonical。旧 v2 内嵌历史仅允许只读兼容：必须通过身份和格式校验，缺少可验证身份时报告 partial，不能补造来源。新私有字段损坏或新引用错绑时不得回退到旧副本掩盖错误。保留完整原消息提供历史回查；此处不引入第二套按步骤历史台账。
- run、step、非流式事件及 durable checkpoint 使用同一持久化提交操作；问题/答复事务复用该操作。显式压缩对两种 run 都必须先提交再确认，任一写入失败则回滚且内存历史不推进。结果 Interaction/DecisionTrace 与本步运行事实也须处于同一结果提交边界，成功后才广播作者结果；实际 Provider 消耗和收到的历史在失败内存状态中保留，不能因为交付失败退回执行前计数。流式进度通知不冒充已提交的结果。
- 结果事务开始前，Provider/工具执行必须已经结束；事务内只做持久登记、状态投影与事实提交，不等待模型或作者。作者原文登记可能返回既有候选，状态投影和后续广播必须使用该持久化裁决后的结果。成功结果、失败结果、预算/范围停止和问题交付都复用同一 snapshot 构造与事务原则；step 记录不得异步逃出该边界。发布回调只能在事务返回成功后调用，发布失败不撤销已提交事实，也不重新执行模型。事务失败时终止本次交付，保留 live 的真实历史/消耗，仅发安全失败通知，不广播未提交的成功结果。取消晚到的成功或失败响应仍记录实际历史和消耗，但不重新发布候选。
- 按轮次回查首先使用同作品、同会话的已提交 assistant Interaction 中的真实 run 身份，并校验该记录绑定；不得按 parent turn 的“最新 run”推断。无此持久绑定的旧数据只能在唯一且有证据的 parent/step 匹配时回退；多义或错绑必须 partial。`turn_rev_*` 与 source turn 独立定位，不能把修订子运行覆盖到源结果。
- Interaction 的服务端 `content.agent_run_id` 与 TurnResult 中已有的 `agent_run.run_id` 必须一致；存在显式绑定而记录缺失、错作用域或互相冲突时，不走旧数据回退。Why、Provider activity 和会话重载摘要共用这一定位规则；活动列表不得把 child 的 Provider 费用汇总给 source，重载也不能把 TurnResult 中过期摘要当作最新运行事实。历史缺口可以保留已提交结果本身，但不补造运行状态。
- `workspace_id` 与 `work_id` 不得强制相等：现有 Channel 的 workspace 来源于 topic suffix，work 来自独立的作品解析，旧 `workspace:lobby` 也能绑定真实作品。运行查询按真实 work/session 隔离；workspace 必须非空，并与 canonical 保存的运行命名空间一致。Interaction 与 LongRunTask 表的历史 `workspace_id` 字段实际存 work_id，不能把其列名误当成运行的 Channel 命名空间。
- 有历史可回查不等于可恢复执行。bounded 失活后仍不重建运行；durable 离线恢复不启动 Provider，也不继承过期权限。作者 Why 仍仅显示安全摘要/省略说明/来源显示名；原始消息与 Provider 私有状态仅供内部投影与审计。
- 实施分步：先统一私有存储、引用与回查消费者，再收拢普通结果的跨表提交和广播顺序，最后由真实 Tauri 修订场景验证新 run、结果、历史与可见反馈的同源性。任何单步通过不替代后两步，也不签 B71 done。

### 16.9 逐调用执行引用与请求/响应证据

- `provider_call_ref` 是 Gateway 在实际调用前分配的项目执行引用，`provider_run_ref` 指向同一 ProviderRun；不得从 turn、时间、工具名、内容 hash 或重试序号推造。Gateway 在 adapter 执行的日志作用域内绑定这两个已有引用，完成、失败和异常退出后恢复原上下文；嵌套和并发调用不得串线。LLMLog 保存同次 request/response 及这两个引用，未经过执行边界的调用如实保持未绑定。
- 原生响应经 Result 回到 RequestIR 时，assistant 消息以可选内部元数据保存真实 `provider_call_ref/provider_run_ref`；JSON checkpoint/恢复保留这些引用。它们不进入 Provider message body、作者 TurnResult 或私有推理内容，不改变消息/参数原字节。旧历史没有引用时不得补造；已有消息仍不可重写。
- 三种身份分开：项目 `provider_call_ref`、原生工具 id、canonical `call_id`。重复原生 id 可在 IR 内分配唯一 canonical id，原 id 的既有映射仍保留；核验时先按项目执行引用定位同次响应，再按该响应内原生调用顺序/原 id/原始参数核对，不能把 canonical 后缀误当 Provider 原文。一次响应中的多工具调用共享同一执行引用，各自保留独立 canonical 调用身份。
- 现有 `Provider.tool_call` 的 `id` 是可选字段，不能在 verifier 中擅自升级成必填。Provider 未提供 id 时，IR 可为调用/结果图分配内部 call_id，但须以显式空的原 id 映射保留缺失来源；不得把该内部值声称为 Provider 原 id。关联依据为真实 pcall/prun 与同次响应内位置，名称、参数和原始字节仍逐项核对；记录“原生 id 未提供”的数量/状态。旧历史缺少这个来源标记时不得补造其含义。具体 HTTP 协议若要求原生 id，由相应 adapter 的协议契约校验，不用 fixture 形状推断实模能力。
- `slice_verify` 仍只位于 test/support。它在真实 adapter 边界记录同次实际收到的请求和返回结果/错误，使用执行 ctx 的真实引用，明确为确定性 fixture 证据；不能把下一请求里的历史回显当成上一响应。每次调用只产生一条配对记录，直接 complete 无 ctx 时保持未绑定，所有正常/拒绝/失败分支共用同一记录路径。不得借此向生产 runtime 注册验收 provider 或增加场景感知逻辑。
- 传输失败没有模型响应，不新增 assistant/native call。它通过配对日志的错误事实与 ProviderRun 的实际执行引用关联 run；没有响应不能生成原生 id、usage 或成功字段。语义证据必须区分实际模型、实际 HTTP 替身和本地 fixture；时间顺序只可辅助定位，不能替代身份绑定。
- 首个消费者是新修订真实 Tauri 场景的 source/child 对账，并同时服务生产调用诊断和历史审计。必须覆盖同 parent 多 run、重复原生 id、协议纠错首轮与末轮、传输失败、日志作用域恢复、JSON 恢复与投影字节不变；未测或关联不足时报告 missing/ambiguous，不推断通过。
- 实现落点（2026-11-02，不改本节判据）：`NovelApplication.AgentRunHistory` 唯一解析 work/session/turn 的持久 run 身份；`AuthoringReplay`、`ProviderActivityService`、`WorkSessionService` 直接消费。scoped 批量读取在 `NovelPersistence.WorkSessionRepo.assistant_entries/3` 与 `NovelPersistence.AgentRunLog.list_by_ids/1`、`list_steps_by_run_ids/1`；不新增平行存储或 web 直查。

### 16.10 作者动作的原子受理与运行回执

- `author_action_receipts` 保存不可变的动作受理事实和原运行绑定；AgentRun 保存执行状态。不得用 receipt 中一次写入的 `running` 充当后续运行真相，也不新增与 AgentRun 并行的执行状态机。
- 触发新 run 的作者动作必须先原子提交 receipt、初始 run 和启动事件，随后才发布启动消息并执行 planner/Provider。事务由拥有运行的进程执行；不得在一个进程的数据库事务内等待另一个进程写入同一事务。提交失败、重复或冲突的候选运行均不能开始执行，也不能广播已启动。
- 幂等键仍使用既有作品/会话/源轮次/动作/客户端键。新受理记录须同时绑定完整动作语义（payload、target、behavior、candidate 等引用，不含每次重传重分配的 input_id），同键同语义返回原 receipt/run，同键异语义明确冲突。旧记录缺少完整摘要时保留其历史边界，不补造已验证事实。
- 首次受理从当前作品/会话的持久 source Interaction 核验动作、目标、有效期与可用性，不把 socket 缓存或调用方传入的 source 当作授权真源；同次事务核验与提交。新 run 只消费自身 profile 的权限/预算，源 run 仅为来源。确认与拒绝同一确认行为的竞争还须原子消费该行为，不能只靠不同动作键分别去重。
- 回放新 receipt 时，按 receipt 的作用域与 run/source/action 身份读取当前 AgentRun 和已经提交的结果。`source_turn_ref` 始终指向源轮次；`turn_id` 只能指向已存在的子结果，尚无结果时省略，不能用源轮次冒充。缺失或错绑运行返回明确错误，不能回退为固定 running。受理后的 bounded 进程丢失沿用既有 runtime-lost 收口规则，不重放模型；离线历史恢复不等于自动继续执行。
- Channel 回执与前端均消费已有 AgentRun 状态投影及已提交 TurnResult，不根据“收到 run_id”合成 `running/executing/runtime_live=true`。动作来源用于锚定原卡片，子结果用于展示新候选，不能把子结果当作运行的 parent。跨作品/会话的迟到回执不得进入当前视图；修订受理不等于原候选被采纳或放弃。
- 动作回执公开 wire 形状在现有 foundation schema/codegen 中维护，包含 `received/action_status`、稳定 receipt/run/source 引用及可选 `agent_run_state/turn_results`；运行与 TurnResult 仍引用各自现有契约，不复制状态枚举或整套手写 TS 类型。前端沿既有运行态漂移降权、结果校验与 upsert/merge 边界处理；缺运行事实不猜成 live，明确身份冲突不能进入当前视图。公开回执不携带私有受理摘要或 canonical 历史。
- 首个迁移消费者为质量发现卡片修订；非采纳工具确认随后消费同一受理边界，并保留确认时重新裁决与独立作者动作 run。采纳仍归 AdoptionWorkflow。该分步实施不缩小 CP4b 的确认、拒绝零调用、source/child、持久化、Why 与真实页面验收范围。
- bounded 运行没有检查点执行恢复契约，异常退出不得用旧启动参数自动重建 owner；单个运行的失败不能消耗公共监督器的重启额度并连带终止其它运行。明确失活后沿既有持久 runtime-lost 边界关闭原 run，不新建 receipt、不重放 Provider。失活写入失败或运行记录消失必须明确失败，不能吞错误后返回旧 running；durable 的恢复能力仍须单独通过持久 checkpoint/历史/执行证据证明。

### 16.11 确认边界消费的行为快照保真

- `BehaviorState.snapshot/summary` 继续是既有 TurnResult/Interaction 行为快照的唯一生产者，不新增行为状态表或平行台账。新快照在原有兼容 `status` 外保留精确 `lifecycle_status`、`constraints` 与 `resolution`，使 JSON 往返不把 superseded/failed/resolving 等域事实折叠成其它状态或丢失解决引用及细节。
- `status` 仍使用既有 BehaviorStatus 集合和映射，active/history 的现有分流与动作策略不在此改动。精确域生命周期与兼容状态同时出现时必须一致；显式但非法/冲突的字段不能回退到旧 status，更不能默认恢复为 awaiting_author。
- 同时给出的 `resolution` 与兼容 `resolution_ref` 必须一致，显式空 resolution 不能同时声称非空解决引用；已知字段的 atom/string 双键冲突不能任选。身份仅以 trim 判全空，不裁剪合法原字节。
- 旧快照没有精确字段时按其既有、可识别的 status 读取；不补造过去丢失的 resolution 内容或精确终态，不改写旧记录。已有 resolution_ref 只作为原引用保留，不从名称、时间或前缀猜造完整事件。无法识别的边界数据不恢复为可提交的开放行为。
- 该步首先由现有 TurnResultBuilder/AdoptionWorkflow 消费；按 behavior_id 查询当前持久事实、同一行为的确认/拒绝原子竞争、新确认 run 与真实页面仍属后续完整闭环，不因快照往返通过而关闭。


### 16.12 Provider 执行事实的有序提交（2026-11-02）

- 同一 Provider 调用的事件与运行快照由其当前执行路径顺序提交；`ProviderActivityProjector` 不再为每个事件分派互不排序的后台写入任务，也不按 SQL Sandbox 与生产池切换正确性语义。应用只在该事实事务成功后向 stage sink 发布对应进展；失败不发布声称已提交的进展，保留实际模型结果，提供不含原始内容的持久失败诊断，不重发模型请求。
- `ProviderRunLog` 是 run/event/output 的唯一持久提交边界。晚到或重复事件仍按真实 event identity/sequence 收录；重复相同事实幂等，冲突事实拒绝，不能用到达时间或 updated_at 决定覆盖。既有同次调用的身份与归属不可换绑；已经提交的 completed/failed/cancelled 终态及输出不能被早期 running/chunk 快照回滚或清空。正常 initialized/running/cancel_requested 到终态的推进与取消事实必须保留，不把成功、失败、取消视为可互换终态。
- run、事件和输出在单一事务内一致提交，冲突或写入失败不得留下部分事实；无新后台队列、第二运行台账或生产验收开关。既有事件 sequence 是同调用内部顺序事实，不能替代跨调用的 pcall/prun 身份。
- 首个消费者是现有 ProviderActivityService 与 B71 原生 source/child 逐调用核验。必须有乱序终态保护、重复/冲突、身份隔离、发布时即能读到已提交事实及事务失败测试，并由新 Tauri 批次确认真实入口；旧失败批次不回写状态或重签。

### 16.13 当前行为的统一读取（确认迁移实施细化，2026-11-02）

- `Interaction.turn_result.behavior_state` 仍是行为事实来源。当前行为取同一作品、会话内按既有 transcript 顺序最后一份**明确携带**的行为快照；后续不携该字段的普通回复不表示行为已关闭。明确 `active: nil` 表示当前没有开放行为，不向前寻找旧 active。这两种含义来自现有 `TurnResultBuilder` 和 `BehaviorState.snapshot` 的真实生产契约。
- 纯领域投影负责区分字段缺席、明确空状态和活动状态，并复用 §16.11 的既有 codec；持久层负责精确作品/会话查询。模型 Base 的行为摘要、Channel 重连和动作受理使用同一语义，不再分别以“最后 assistant”“最后 turn”推导权限。展示缓存不是受理真源；按 behavior_id 的受理仍须在事务中重新核验。人工构造的其它形状不据此新增一套状态或过滤策略。
- 旧无 session 的上下文读取保留明确的只读兼容边界，不能用作新作者动作的权限回退。新代码不得将会话不匹配、读取失败或历史终态恢复成可提交行为。
- 本步不新增行为状态表，不回写历史 Interaction，不提前声称同一行为的竞争受理、确认新 run、父子运行交接或结果事务已实现。上述后果继续按 §16.10 在统一 AgentRun 中实现并独立验证。
- **实现纪律（2026-11-02 作者明确纠偏）**：新增校验或拦截前先追溯真实 producer、转换、持久化与 consumer，说明异常如何实际产生；源头不会产生的问题不增设拦截。优先修正源头数据结构、状态提交和单一所有权，内部消费已经确定的契约；不能因为人工构造的非法 map 或变异分数而持续叠加防御层。外部验收器保留真实证据身份、字节、时序与采集完整性判据，同时遵守一次解析、内部信任的边界。

### 16.14 非采纳工具确认的运行交接（CP4b 实施方案，2026-11-02）

- 当前真实来源是 `WorkspaceChannel → DialogueGateway.confirm_with_plan → TurnExecutionService` 的同步支路。它复用源 turn、把应用生成的“确认执行”当作者输入、不创建 AgentRun/ProviderRun，且确认后没有行为关闭事实。迁移应删除这条执行支路，确认和拒绝均消费统一作者动作受理；采纳确认继续归 AdoptionWorkflow。
- receipt 仍是不可变受理事实。在既有 receipt 增加可空 `behavior_ref` 与 work/session/behavior 的唯一约束，用同一事实表达“该行为已由哪个作者动作消费”，不新增状态表或执行状态机。原幂等键与完整语义摘要保留；相同动作回放原 receipt/run，相反动作竞争不能各自取得一次执行权。旧记录不回填已消费事实。
- 事务内读取同 work/session 的真实 source Interaction 和最后明确行为快照，使用既有动作契约核验一次。source plan、作者原文与来源从持久事实读取，不从 socket 缓存或按钮文案拼造。新 run 的 scope/budget 来自本次操作，不继承源运行的剩余授权。
- 同次提交 receipt、初始子 run/启动事件、作者决定的子 TurnResult/DecisionTrace 与行为关闭快照。确认行为在作者决定受理时即 resolved（只表示已回答），拒绝为 cancelled；不等待模型成功才关闭，也不把“已确认”当作 re-gate 或创作成功。任何提交失败均不发布成功、不开始 Provider。后续创作结果仍经过已有 AgentRun 结果事务。
- **写入所有权**：源运行仍在线时，由其 AgentRunServer 串行处理交接，在一个事务中完成自身收束与上述子运行受理；事务内不等待另一个进程写库。新子运行在提交后接管自己的执行状态，初始事件不重复生成。原运行 completed 只表示执行已交接，使用明确的 handoff 原因与后继引用，不产生 goal_satisfied 或虚构 artifact。离线源运行不重建旧模型执行；当前恢复入口只恢复历史，缺 owner 时由本次新运行的受理事务读取并收束非终态源记录，已有终态不改写。
- 交接或新 owner 启动中断时，沿既有 receipt/runtime-lost 事实诚实返回结果，不能自动重放已受理的 Provider。重复请求只回查同一 receipt/run。对源运行的交接不覆盖原 canonical 模型消息、调用计数、候选或已提交结果。
- 确认子 run 重新读取当前上下文并经过 Orchestrator；通过后调用已有 TurnExecutionService/AuthoringSession 主链，保留真实预算、pcall/prun、原生 writer/quality 交换及持久历史。新 IR 只引入有来源的作者原消息和本次应用范围/作者动作事实，不回放旧 assistant/tool 执行，不把确认按钮文案伪装成作者原话，也不添加固定作品知识 packet。
- 拒绝子 run 只处理作者决定，Provider/工具/canon 消耗为零。确认被当前 gate 阻止、工具失败和交付失败均有真实子结果与 trace，不只返回一个“已确认”ACK。Frontend 继续消费既有动作回执和运行事实，不猜运行状态。
- 首个验收消费者为当前 WorkspaceChannel 的真实非采纳确认入口：覆盖确认/拒绝、两 Channel 竞争与重传、持久写入失败、离线来源、源子身份、调用与字节、当前上下文 re-gate、恢复/Why 和原生页面；局部测试不关闭整项范围。

## 16.15 传输能力事实的落地细化（2026-11-03，CP4b 实施约束）

- **单一派生边界**：`NovelAgent.Provider.CapabilityProfile` 是能力事实唯一派生点；事实来源是 adapter 的 `capabilities/1` 与 `projection_target/1`（按实际 route/state 派生），provider descriptor 只提供配置/UI 属性；adapter 未声明一律视为不可证，禁止默认置 true。必备清单唯一来自 `RequestIR.required_capabilities/0`，不得复制。
- **身份比对优先**：IR 投影时写入构造 route 身份（provider/model/projection_target）；执行边界先比对身份——一致则信任已携带的能力事实、不再派生、不重复判缺失；仅当 purpose/route_hint 使执行 route 与构造 route 不同（真实变化点）时才按实际 route 重新派生并校验。无法比对身份的请求不进入该门槛。
- **有限模式必须覆盖缺失项**：`finite_mode` 只有其受限集合覆盖每一个 missing 能力时才放行；`standalone_operation` 等不声明覆盖集合的模式不能绕过门槛（§6.4「显式有限模式」的落地语义）。
- **流式工具调用无损**：SSE 响应中的原生 tool_calls 必须按 provider 协议累积（OpenAI `tool_calls[].index`；Anthropic `content_block_start(tool_use)` + `input_json_delta.partial_json`），保留 arguments 原始字节（`raw_arguments`）并复用非流式解析；带工具调用的流不得被误判为空响应。
- **Responses 传输**：wire 目标由 adapter 声明；`wire_api: :responses` 走真实 `POST /responses` 与 items/function_call/function_call_output/usage 解析。Responses SSE 未实现时该 wire 必须如实声明 `streaming: false`，完整 AgentRun（必备能力含 streaming）被显式拒绝路由，不得静默降级。
- **作者安全**：能力拒绝文案只输出中文能力名；内部 capability atom 仅出现在 reason details/诊断，不进入作者文案。

## 16.16 显式压缩的产品触发（2026-11-03，2026-11-04 §18 修订）

- **两类显式入口**：① 作者动作经真实入口触发（`WorkspaceChannel` 的 `agent_command: compact_transcript`）；② 应用在**安全点**（无执行中任务）按可配置上下文压力阈值自动发起**上下文维护**（2026-11-04 作者批准方案 A 后修订，理由与影响见 §18）。自动维护仍属显式压缩，必须满足：产生带 `covers.call_ids`/`source_refs`/`versions`/`omissions`/`summary` 的独立 checkpoint；不删除不改写原始消息（§16.2 不变）；成功后向作者可见面投影一条 author-safe 整理记录（真实数量与范围，不静默无形）；阈值只决定触发时机、不决定丢弃范围，且不得压缩未完成/未闭合交换、保留最近 K 项已完成交换（运行策略参数、不对作者暴露）；同批交换幂等；失败保留旧状态、不产生作者可见错误、下一安全点可重试；作者原话/当前 scope/未覆盖消息保持原序；作者可见面不出现技术用量与 `checkpoint`/`compact` 内部词。
- **命令只表达意图**：public 入口收敛为 `compact_transcript(run_id)`；`covers.call_ids`、source_refs、versions、摘要与省略说明全部由 application 的 `TranscriptCompaction.plan/1` 从 canonical 事实确定性派生（当前全部「未覆盖且已闭合」的完整工具交换），不调用模型；调用方不能传入或伪造压缩内容。
- **持久与回执**：先经既有 durable checkpoint 提交边界持久化，成功后才推进内存并回报；回执只含作者可见的整理项数、摘要、省略说明与来源显示名，不含 call_id/ref 原值/版本/canonical 内容。无剩余交换时返回幂等 `nothing_to_compact`，不是错误。

## 16.17 验收分层与实现记录（2026-11-03）

- 机制层（确定性 adapter/投影/流式/压缩派生/确认交接测试）、页面层（真实 Tauri 外部自动化）、模型行为层（实模）必须分别报告；本节记录实现状态，不代签未执行的层级。
- 非采纳确认交接的验收覆盖：确认/拒绝、两 Channel 竞争与重传、持久写入失败不启动、离线与已终态 source、源子身份、作者字节与应用范围、当前上下文 re-gate、恢复/Why、拒绝零 Provider；证据见 `tasks/slices/B71-provider-message-fidelity.md` 的 CP4b 收口记录与 `artifacts/b71-resume/worker-confirmation-acceptance-report.md`。
- 显式压缩的前端入口存在真实设计缺口（UI 46 §9.7 冻结两槽位、Pencil 原型无对应帧、UI 47 无文案模板且禁作者界面出现 checkpoint 字样），在作者设计授权前不实现，不自行发明 UI。

## 17. 实施状态更新（2026-11-03）

§10 表格的当前状态（CP4b 确定性收口后；实模与页面级证据仍按分层单列）：

| 未实现/未验后果 | 当前状态 |
|---|---|
| IR struct、投影实现、能力门槛代码 | **已实现**（CP2；CP4b 补齐能力事实单一来源/身份比对/finite_mode 覆盖/作者安全拒绝文案） |
| 首个创作 AgentRun 原生多轮与观察回流 | **确定性原生页面已通过**（CP3c/CP4a/callrefs-07/pending 系列）；**实模 CP3b 协议层机制 PASS + G1–G4 真实切片已覆盖**（见下一行），G5 由确定性批次请求字节覆盖、G6 未触发 |
| 压缩恢复、规划/修订/质量、replay/Why | 规划/修订/质量/压缩派生/确认交接**已实现并有确定性验收**；压缩前端入口待设计授权；实模仍待 |
| ADR-0030/0031 Superseded 与索引/任务重锚 | 已完成（CP1 复核后执行） |
| giant prompt/`normalize_messages`/固定 packet 实际退役 | 生产判断/创作/质量链已不使用 giant prompt 构造；`RequestIR.from_legacy` 迁移适配器已删除（§11 要求）；`normalize_messages/1` 保留为 provider wire 形状规范化，不是双轨 |
| 三类 provider 的有限模式/拒绝路由反例 | **已实现**（能力矩阵 + finite_mode 覆盖校验 + Responses 无 SSE 时拒绝路由；单测覆盖） |
| Responses 投影的生产消费者 | **仍开放**：`RequestIR.Projection.ResponsesAPI` 只有 golden 消费者；`wire_api: :responses` 在 adapter 内从 chat 形状转换，IR 投影目标暂由默认 route 决定 |
| Responses 流式 SSE | **仍开放**：该 wire 声明 `streaming: false`，完整 AgentRun 显式拒绝路由 |
| purpose/model 级能力差异 | **过渡态**：构造侧用默认 route 近似、执行边界按身份比对权威校验；下一步由调用方把 purpose/route_hint 传入 `capability_profile/2` |
| 实模 CP3b/CP4b-2（真实模型行为/缓存/usage） | **CP3b 协议层机制 PASS**（2026-11-03 cp4b-live-03-cp3b：L1–L10 全 true、真实模型创作链、usage 9/9、strata 卸载核验；L11 Why 未观察如实记 null）；**G1–G5 切片已覆盖**（G1–G4 来自实模批次 03 的 9 条真实请求字节离线分析：追加式前缀全通过、G1 结构/G2 唯一 call_id 绑定/G3 failed validation 回流/G4 tentative artifact 工具；G5 来自 pending-08 确定性批次 followup 新 turn 请求字节：resolved_adoptions 携带 ACCEPTED/DISCARDED 真实处置数据，按数据形态判定不误报规则文本）；**未代签** G6（压缩未触发）、完整 G1–G6 语义、I10 与作者行为覆盖（B70/B72 另列） |
| 作者行为覆盖（B70/B72 资产接入的实模批次） | **接入已实现 + pilot 已执行**：冻结 cases 选择器 + oracles HO1–HO6 + behavior 驱动（判据加固 B1–B18）；B11 seed 补齐 S1/S3 的 memory/chapter_plans（pending 无 API 构造，S3 差异如实登记）。**pilot #1（01c2，C-F1-003 holdout 零写）clean PASS**（真实模型正确进度事实、零写、state_checks 与 states.yml S1 逐项一致）；**pilot #2（#6，C-F3-002 保存请求）真实模型执行失败**（3 调用 0 工具 0 候选，产品 fail-closed，verdict violation——真实模型能力限制，不重跑/不调判据）；B1 effect echo 档位 A 已合入（append 已 echo，真实批次未触发验证）。**未代签完整 G1–G6/I10；未 done** |
| §16.14 工具确认/拒绝原生页面 | **双路径原生 clean PASS**（2026-11-03：`cp4b-confirmation-01i-confirm` C1–C11 全过、`cp4b-confirmation-02c-reject` C1–C11 全过；含 Why 真打开 delta=0、重复不可触发且 delta=0、恢复可见+restart delta=0、运行态清理实测；此前 01–02b 失败均为驱动/判据缺陷，只读保留不用于 PASS）。作者可见 code 泄漏（displayName）另行修复 |
| G6 压缩后 / CP4b-2 usage·缓存 | **G6 机制层已覆盖**（request_ir G6 测试 + transcript_compaction 端到端：checkpoint covers/refs/omissions 进入投影、作者原话字节不变）。**产品入口已实现（2026-11-04 作者批准方案 A，§18 Accepted）**：后端 `ContextPressure` 只读压力派生 + `plan_maintenance/2` 保留最近 K 项 + `checkpoint_created` author-safe 事件同边界持久化（**自动触发未激活、无生产消费者**）；前端细条视图/组件 + DialogueFlow 渲染 + 7 copy key + Why 入口已接线并过前端门禁；Pencil 两帧 Draft（PNG 待环境导出）。**真实请求未触发**（自动触发待 AX 场景验收），不代签。CP4b-2 真实 usage/缓存观察：实模 03 批次 281,482 input / 6,116 output / 99,591 cached ≈35.4%（只作观察不作判据） |
| 作者可见 displayName 机制（2026-11-04，作者要求「分析后重构机制彻底解决」） | **P0+P1 完成并在真实页面验证**：SSOT `docs/design/schemas/author_visible/display_names.json`（13 domains）+ 双端 codegen（同 source_hash、`--check` 漂移校验、生成期未登记 code 失败）+ `AuthorVisible.Presenter/Registry` 唯一出口 + 前端 branded/literal union + 共享全类别扫描器（无收窄开关、无手写 token 列表双轨）+ AX 通用断言。P1-AX `01k2`/`02e2` clean PASS：真实 AX 全类别扫描 **hits=[]、internal_terms_zh_hits=[]**（12 文件），六中文术语与 `Stub/slice_verify/prose_writing/[stub]/request_ir` 零命中。净删除：5 张前端映射表 + 1 函数 + 4 copy 表 + 6 处手写 token 列表 + 迁移期开关（合计净 −112 行以上）。**未闭环**：低优先 a11y 重复读（`推理 推理`）与 driver 证据文本 `会话 0` 拼接（扫描器已不误报） |
| CP5 收口与全量静态扫描 | **主体完成**：B71 状态行/恢复指引/NEXT、§17 状态表、ADR-0033、§26、三处索引与事实台账已对齐（2026-11-03）；全量静态扫描 20 passed/1 failed（既有 gitleaks 5 项，touched=0、blocking=0）。最终收口随剩余项（§16.14 页面、行为覆盖、压缩前端、CP4b-2）完成后再补一次 |

## 18. 变更记录（Accepted，2026-11-04）：显式压缩的自动维护触发（提案 2026-11-03）

> 状态：**Accepted（2026-11-04，作者批准）**。作者于 2026-11-03 拍板方案 A（无感自动整理 +
> 行内可展开细条）并同意提交评审；2026-11-04 作者回复「按 A 推进」正式批准。本记录已按
> 18.3 新条款替换 §16.4 / §16.16 原文（见上两节），本 pack 的 Frozen 状态与其余条款保持
> 不变。**自动触发的工程启用仍待实现收口**：当前 `ContextPressure`/`plan_maintenance` 已就绪
> 但无生产消费者，前端行内细条已接线；启用自动触发需要完成 AX 场景验收与最终门禁。

### 18.1 提案摘要

将现行「显式压缩只能由作者动作触发、无隐式触发器」修订为：显式压缩可有两类显式入口——
① 作者显式请求；② 应用在**安全点**按可配置的**上下文压力阈值**自动发起**上下文维护**。
自动维护仍是显式压缩（完整 `covers`/证据/省略/摘要的独立 checkpoint 事件），
**不是**按消息数/字符数静默丢弃历史；作者原话、当前 scope 与原始消息永久保留并可回查。

### 18.2 原条款

§16.4（`AgentRunService.compact_transcript/2` 段，原文摘录）：
> `AgentRunService.compact_transcript/2` 是显式压缩入口，只在没有执行中任务的安全点调用
> `AuthoringSession.compact/2`。durable checkpoint 成功提交后才更新内存并报告成功，失败
> 保留旧状态。…**无隐式触发器**，不覆盖原始消息，同一 checkpoint 重放幂等。

§16.16 第 1 条（原文）：
> **触发者是作者**：显式压缩由作者动作经真实入口触发（`WorkspaceChannel` 的
> `agent_command: compact_transcript`），只在无执行中任务的安全点受理；不按消息数/字符数/
> 上下文规模自动触发，不引入隐式压缩触发器。

### 18.3 新条款（替换文本，供评审）

> 显式压缩可由两类显式入口发起：① 作者显式请求；② 应用在**安全点**（无执行中任务）按
> 可配置的上下文压力阈值自动发起**上下文维护**。自动维护必须：
> a) 仍产生带 `covers.call_ids`、`source_refs`、`versions`、`omissions`、`summary` 的独立
>    checkpoint 事件；
> b) 不删除、不改写任何原始消息（§16.2 原文保留条款不变）；
> c) 成功提交后向作者可见面投影一条 author-safe 整理记录（真实数量与范围说明），不得
>    静默无形；
> d) 阈值只决定**触发时机**，不决定丢弃范围，且不得压缩未完成或未闭合交换；应保留最近
>    K 项已完成交换（K 为运行策略参数，不对作者暴露）；
> e) 同一批交换幂等（重放不重复插入 checkpoint 或整理记录）；
> f) 失败保留旧状态、不影响作者继续创作，并可在后续安全点重试；失败不产生作者可见错误；
> g) 作者原话、当前 scope、未覆盖消息保持原序；
> h) 作者可见面不得出现技术用量（token/百分比/窗口）、`checkpoint`/`compact` 等内部词。

### 18.4 理由

**产品与作者要求**（2026-11-03 作者明确指示）：作者原话「从真实作者出发，不让作者产生
认知负担、使用负担」「不做缝合怪」。作者长任务中最怕三件事：a) 上下文爆了导致能力下降/
失败；b) 创作记录丢失；c) 被要求管理技术细节。方案 A 让作者零操作、只保留一行可展开的
事实细条（「较早的 N 项创作过程已整理」），同时用「原始记录仍然保留，不会被删除或改写」
消解恐惧 b。方案 B（自动但主界面零反馈）无法让作者在「模型忘掉早期细节」时归因；
方案 C（提示+一键）每次提示都制造一次决策负担，与作者指示直接冲突。

**业界证据**（产品参考，非契约依据）：
- Claude API 官方压缩能力含阈值压缩、后台压缩、保留最近轮次（`platform.claude.com/docs/zh-CN/build-with-claude/compaction` 及其子页）。
- Claude Code 官方上下文窗口文档与自动压缩行为（`code.claude.com/docs/zh-CN/context-window`）。
- GitHub Copilot 官方上下文管理（自动管理上下文，用户可查看引用）。
- 开发者向的百分比/命令（Cursor、Claude Code `/context`）不适合网文作者，未纳入本设计。

**安全边界**：
- 自动维护不改变 §16.2 的实体承诺：checkpoint 显式、范围/证据/摘要完整、原文不删不改、
  作者可回查；
- 「不得静默」由 c) 落实：作者可见面必须出现整理记录（行内细条 + 可展开面板），
  因此「自动」不等于「隐式/不可见」；
- 阈值只决定时机，不能成为「按规模丢弃」的借口（d)）；
- 未完成/未闭合交换不得压缩（d)），与 §16.2「禁止覆盖未完成调用」一致。

### 18.5 影响面

| 维度 | 影响 |
|---|---|
| 触发语义 | 从「仅作者命令」扩展为「作者命令 + 安全点自动维护」；安全点 = step 完成后无执行中任务 / 进入 `awaiting_author` 前 / durable 恢复后 |
| 幂等 | 同一批交换重放不重复插入 checkpoint/整理记录；多次整理在作者可见面合并计数 |
| 失败 | 静默（无作者可见错误）、保留旧状态、不阻塞创作、下一安全点重试 |
| 作者可回查 | 整理记录（author-safe 事件投影）+ 行内细条展开 + 「查看完整记录」→ 既有 Why `authoring_history` |
| 原文 | canonical 原消息永久保留，作者可见消息流不变（§16.2 不变） |
| 压缩策略 | 从「全部未覆盖完整交换」改为「保留最近 K 项 + 整理更早的已完成交换」（K 可配置、作者不可见） |
| 工程 | 需新增：保守模型窗口配置（不向作者展示）、真实 `ProviderRun.usage.input_tokens` 压力信号、安全点触发器、`checkpoint_created` author-safe 事件在 `:compaction` 提交边界持久化、前端行内细条与展开面板、Pencil 帧（已 Draft 落地）、ExUnit/前端门禁与 AX 场景 |
| 验收分层 | 机制层/页面层/模型行为层分别报告（§16.17 不变）；G6 压缩后真实请求证据在实现后补 |

### 18.6 替代方案与不选理由

- **方案 C（上下文健康度提示 + 一键整理）**：保留作者控制权，但每次提示产生一次判断与
  操作负担，且要求作者理解「上下文很长」这一技术判断；与作者「不让作者产生负担」直接
  冲突。仅在作者未来明确要求「手动控制」时整体替换方案 A，不作为叠加选项（叠加即缝合）。
- **方案 B（自动整理但主界面零反馈）**：操作负担同样为零，但作者无法在「模型忘记早期
  细节」时归因，且外部 AX 无法观察整理是否发生；不满足「可回查 + 可验收」。
- **菜单/快捷键入口**：主界面零新增但把发现成本留给作者（问题发生才发现没操作），
  不解决认知负担。

### 18.7 评审与落地状态

- **2026-11-04 已按本提案替换 §16.4/§16.16 原文**（见上两节），Frozen 状态不变；§11 版本
  记录、§17 状态表、B71 任务文档、UI 46 §9.9、UI 47 §7.9 已同步。
- **实现进度（2026-11-04）**：后端基础设施已提交（`ContextPressure` 只读压力派生、`plan_maintenance/2`
  保留最近 K 项、`checkpoint_created` author-safe 事件同边界持久化；**自动触发未激活、无生产消费者**）；
  前端行内细条 + 展开面板 + copy 文案 + Why 入口已接线并过前端门禁；Pencil 两帧已 Draft。
- **剩余**：安全点自动触发启用（需 AX 8 场景验收 + 最终门禁）、Pencil PNG 导出（环境限制待补）、
  G6 压缩后真实请求证据。
- 证据索引：
  - 设计与业界对比：`artifacts/b71-resume/compaction-ux-design-v2.md`（方案 A/B/C、业界证据、
    Pencil/46/47/AX/负担评估与 §4.7 提案原文）。
  - 文档落地：`docs/design/ui/46-state-and-feedback.md` §9.9、`docs/design/ui/47-ui-copy-guidelines.md` §7.9。
  - 原型：`docs/design/ui/novel-studio.pen` 的 `46§9.9-transcript-compaction-inline`（`fjkkm`）与
    `46§9.9-transcript-compaction-expanded`（`AYpEe`），登记于
    `docs/design/ui/traceability/screen-to-doc-map.md`（Draft；PNG 待有 Pencil 环境补导出）。
  - 接口对齐（阶段 5 准备）：`artifacts/b71-resume/compaction-stage5-interface-alignment.md`
    （`checkpoint_created` 事件 → activity 投影 → 前端细条的端到端核对）。
  - 后端现状与作者命令入口：`artifacts/b71-resume/worker-compaction-consumer-report.md`。
