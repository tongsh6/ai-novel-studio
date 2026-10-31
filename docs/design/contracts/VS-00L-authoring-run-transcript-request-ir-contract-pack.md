# VS-00L Authoring Run Transcript / Request IR Contract Pack（统一 AgentRun 原生多轮）

> 状态：**Frozen（2026-10-31，B71 CP1；ADR-0033 Accepted 目标方向的替换契约）**。本 pack 只冻结目标契约与迁移映射，不授权产品代码/schema/provider 实现；旧 ADR-0030/0031 在 CP1 复核通过后才转 Superseded（ADR-0033 §7），当前仍为现役实现基线。
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
- provider 私有字段只允许出现在 `provider_session` / `projection`，不得进入 run 事实。
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

**旧 ADR 退役顺序（ADR-0033 §7）**：本 pack 与映射冻结 → 作者/ADR owner 复核 → ADR-0030/0031 转 Superseded → 同步 design README、00c、contracts/ADR 索引与相关任务 → CP2 起按新契约实现。复核前不得宣称旧协议已退役，也不得长期保留两套权威。

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
- [ ] 复核通过后：ADR-0030/0031 转 Superseded（需作者/ADR owner 复核）。
