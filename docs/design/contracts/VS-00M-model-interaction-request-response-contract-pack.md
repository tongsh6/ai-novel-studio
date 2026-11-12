# VS-00M Model Interaction Request / Response Contract Pack

> 状态：**Proposed（2026-11-12）**。作者给出四层闭环与 `reviewed-v1` 示例包；本 pack 将闭环与示例整理为契约草案，**未冻结，不授权产品代码/schema/provider 实现**。
> 示例：[VS-00M-model-interaction-reviewed-v1.example.json](VS-00M-model-interaction-reviewed-v1.example.json)（`design_example_bundle`，README 标注 `proposed_example_not_production_contract`）。
> 来源：作者 2026-11-12 四层闭环与 reviewed-v1；根因记录 [B86](../../../tasks/slices/B86-structured-model-materials-internal-ref-isolation.md)。
> 上游：[VS-00L](VS-00L-authoring-run-transcript-request-ir-contract-pack.md)（Request IR v1，Frozen）、ADR-0033、[VS-00H](VS-00H-system-identity-message-contract-pack.md)、[VS-00I](VS-00I-prompt-prefix-stability-contract-pack.md)、[B81](../../../tasks/slices/B81-session-canonical-authoring-history.md)（会话级 canonical history）。
> 非目标：不冻结 provider 能力等级、模型参数数值、工具全集、effect 词表、预算常数。
> **定位（2026-11-13，作者裁决 C）**：本 pack 的请求/响应四层结构只作为**设计输入与投影视图**，不构成第二事实源；执行计划登记在 [B87（原 B85）Issue #4 R10](../../../tasks/slices/B87-model-interaction-request-projection.md)。本 pack 保留价值集中在 §3.4（风险等级/授权模式/critical/full）与 §3.6（authorized 最小供给 + catalog 按需探索），作为 R10 的设计输入；请求/响应结构复用现有 `authoring-request-ir/v1`，不替代 RequestIR。

## 1. 根问题与目标

现行请求把角色规则、作品投影、章节索引、候选清单、操作目录、来源规则、证据纪律全部拼成自然语言塞进 `messages[].content`，导致：不可版本化、不可校验、不可复用、易膨胀、模型混淆材料与指令。响应侧只保留 `content + tool_calls + usage`，不记录决策分类、证据使用、校验结果与真实性核对。

目标：**四层闭环，每层只做自己的事**。Prompt 不是一个大字符串，而是由结构化上下文渲染出来的视图。

## 2. 四层闭环

```text
L1 AgentRun + Canonical Transcript         唯一运行事实源
        │ build（派生，不复制事实）
        ▼
L2 Application Request / Context Projection  任务语义、有效事实、权限与可用能力
        │ render（确定性投影）
        ▼
L3 Provider Request / Response              原生 messages、tools、模型输出
        │ decode + validate
        ▼
L4 Validation + Application Outcome         协议校验、权限验证、执行事实、作者可见结果
```

| 层 | 输入 | 输出 | 约束 |
|---|---|---|---|
| L1 | run 事实、会话 transcript、作品状态 | run envelope、canonical messages、budget、authority | 唯一事实源；L2 只能派生，不能创造事实 |
| L2 | L1 + 本轮授权 | `application_request` | 事实必须带 `origin`/`work_revision`/`fact_ref`，可回溯 L1 |
| L3 | L2 | `provider_request`（method/url/api/body） | 只有 `body` 发给 provider；不承载业务语义 |
| L4 | provider 原始响应 + L2 | `validation` + `application_outcome` | 模型只产 `decision`/`author_visible` 字节；校验与执行事实由系统生成 |

**不可越层的行为**：L2 不得直接写作品；L3 不得引入 L2 没有的语义；L4 不得用展示层过滤冒充契约（I1 因果绑定）。

## 3. L2 Application Request

reviewed-v1 的 `application_request` 顶层：`protocol / trace / task / authority / context / capabilities / runtime`。字段语义按下述固定；标注「待补」的项见 §7。

### 3.1 protocol

```json
{
  "kind": "model_interaction_request",
  "schema_version": "design-v1",
  "request_ir_version": "authoring-request-ir/v1",
  "source_constitution_version": "b27-task-v2",
  "tool_protocol_version": "b26-tools-v1"
}
```

`request_ir_version` 引用现有 VS-00L Request IR v1，表明 L2 是现有 IR 的请求视图，不是替换；`schema_version` 冻结时换成契约版本。`source_constitution_version` / `tool_protocol_version` 的值来自各自唯一真源（`AuthoringTaskPolicy` / 工具契约）。

### 3.2 trace

```json
{"turn_ref": "...", "run_ref": "...", "work_ref": "...", "session_ref": "...", "stage": "judgment"}
```

映射 AgentRun 的 `run_id/workspace_id/work_id/session_id/parent_turn_ref`。缺 `parent_turn_ref`、`profile_ref`、`run_mode`、`status`、`phase`（待补 §7）。

### 3.3 task

```json
{
  "purpose": "judgment",
  "role": "creative_judger",
  "author_input": {"message_ref": "message_...", "text": "..."},
  "goal": {"source_ref": "message_...", "raw_text": "..."},
  "intent_status": "not_preclassified"
}
```

规则：

- `author_input` 是作者原话事实（字节不变）；`goal` 是本次任务目标，`source_ref` 指向作者消息或系统任务来源。
- `intent_status: not_preclassified` 表示系统不预判作者意图分类；判断器自行判断，不在 L2 加 `intent` 枚举（避免预分类污染）。
- `purpose` 是运行阶段（judgment），不是作者意图；`role` 是模型角色。
- 示例中 `author_input.text` 与 `goal.raw_text` 相同。冻结时二者必须合并或明确分工（一个作为原话事实、一个作为目标引用），不允许双源。

### 3.4 authority

```json
{
  "model_action_authority": "suggest_only",
  "canon_write_authorized": false,
  "creative_artifact_default_status": "TENTATIVE",
  "author_adoption_required_for_canon_mutation": true,
  "object_and_source_refs_must_be_real": true,
  "mode": "risk_based",
  "mode_source": {"scope": "session", "ref": "session:..."},
  "delegation_ref": null,
  "budget": {"provider_calls_remaining": 2, "tool_calls_remaining": 1}
}
```

这是本轮权限事实（L1 `authority_scope` + `budget` + 用户授权模式 的投影）。模型可见，用于约束行为：只能建议、不能自行写 canon、候选默认 TENTATIVE。`mode` 是有效授权模式，`mode_source` 记录生效层级，`delegation_ref` 在 `full` 自动采纳时指向作者委托来源。`allowed_tools` / `authorized` 派生待补（§7）。

#### 3.4.1 风险等级（capability + effect + target 动态）

| 等级 | 判据 | 典型能力 |
|---|---|---|
| `low` | 只读/查询/探索，无副作用 | `chapter_read`、`prose_search`、`capability_lookup` |
| `medium` | 生成 tentative 候选、可回滚修订 | `prose_writing`、`plot_outline`、`revise_adopted_content(format_only)` |
| `high` | 改已采纳正文、改角色主档案、结构重编号、单对象高风险变更 | `revise_adopted_content(whole_chapter)`、`revise_character_profile`、`maintain_chapter_structure` |
| `critical` | 删除、批量（≥3 对象）、不可逆覆盖、跨作品、改 canon 核心（立项/卷结构/主角身份） | 删除章位、批量重写、改作品立项 |

风险由注册表基线 + 规则表计算（纯函数，输入 `capability / effect / target / context`），模型只读，不能自评。同一能力不同 effect 可以不同等级。

#### 3.4.2 授权模式与优先级

| 模式 | 含义 |
|---|---|
| `manual` | 每步手动授权 |
| `risk_based` | 低风险自动放行，中高风险确认 |
| `full` | 除 `critical` 外自动执行，含自动采纳 |
| `smart` | 结合上下文的动态判断，高风险仍有确认兜底 |

优先级：**run > 会话 > 作品 > 全局**；未设置向下继承；生效结果写 `mode` + `mode_source`。模式由作者选择，模型不能设置或修改。

#### 3.4.3 决策矩阵

| 风险 \ 模式 | `manual` | `risk_based` | `full` | `smart` |
|---|---|---|---|---|
| `low` | allow | allow | allow | allow |
| `medium` | require_confirmation | allow + adoption_required | allow + auto_adopt | 判断；adoption_required |
| `high` | require_confirmation | require_confirmation | allow + auto_adopt | 判断 + 确认兜底 |
| `critical` | ask_author | ask_author | ask_author | ask_author |

`allow` 也必须过 `validation`；`auto_adopt` 需要 `delegation_ref` 与审计。

#### 3.4.4 critical：询问作者，同意 / 不同意

`critical` 在**所有模式**下都停下问作者：

```json
{
  "kind": "critical_confirmation",
  "action": "delete_chapter_slot",
  "target": {"chapter_ref": "chapter:...", "title": "..."},
  "impact": {"objects_affected": 1, "references_at_risk": ["..."], "reversible": false},
  "consequence": "……不可撤销。",
  "options": [
    {"value": "approve", "label": "同意，执行并写入作品事实"},
    {"value": "reject", "label": "不同意，保持现状"}
  ]
}
```

同意 = 执行 + 写入 canon（一次决策覆盖执行与采纳）；不同意 = 不执行，拒绝结果回流给模型；记录 `author_decision` 与审计。`critical` 永远不自动采纳。

#### 3.4.5 `full` 自动采纳的约束

`full` 命中时连采纳一起放行，但必须：默认关闭、作者显式选择、`delegation_ref` 记录委托来源、可随时撤销、仍过 `validation`、产物可回滚、`status_message` 明确标注"自动采纳"。`critical` 不受 `full` 影响。

### 3.5 context（有效事实）

```json
{
  "scope": {"work_revision": 1, "scope_revision": 1, "snapshot_status": "current"},
  "base_facts": [],
  "author_reported_problem": {"source_ref": "message_...", "text": "..."},
  "observations": [],
  "evidence_coverage": {"chapter_index": "complete_for_current_work", "chapter_body": "not_read", "outline_to_chapter_binding": "not_verified"},
  "omissions": [{"kind": "character_dossiers", "reason": "not_relevant_to_structure_problem"}]
}
```

`base_facts` 规则：

- 每项带 `fact_ref`（稳定事实标识）、`origin`（`work_projection` / `adoption_projection`）、`work_revision`，可回溯 L1；对象 `ref`（`chapter_ref` / `artifact_ref`）只作为字段值出现。
- `fact_ref` 建议加命名空间（如 `fact:chapter_slot:1`），避免模型把它当对象 ref 复述。
- `has_accepted_prose`、`chapter_status`、`accepted_char_count`、`effective_word_count` 是事实；示例缺 `visible_in_reading`（作者问题正是阅读可见性），待补 §7。
- `link_evidence_status: not_verified` 诚实表达"卷纲档案与错误章位之间的绑定尚未核验"，是正确设计；不得把它改写成确定事实。
- `observations` 为空时必须由 `evidence_coverage` / `omissions` 说明未读与省略；不得让模型把"未读"当"没有"。
- `author_reported_problem` 与 `task.author_input` 在示例中重复同一句；冻结时明确一个是原话事实、一个是问题陈述，或合并。

### 3.6 capabilities（authorized 最小供给 + catalog 按需探索）

```json
{
  "authorized_complete_for_run": true,
  "effect_vocabulary_status": "proposed_normalized_keys",
  "authorized": [
    {
      "name": "maintain_chapter_structure",
      "allowed_effects": ["display_number_only"],
      "risk_class": "medium",
      "preconditions": [{"kind": "chapter_ref_required", "status": "satisfied"}]
    }
  ],
  "exploration": ["prose_search", "chapter_read", "archive_read", "session_adoptions", "memory_recall", "capability_lookup"],
  "provider_toolset_ref": "b26-tools-v1"
}
```

规则（依据 [00 §2.4](../00-vision-and-engineering-roadmap.md)：最小供给、按需求证、证据闭环）：

- `authorized` 是本轮 run 允许模型**建议**的操作与效果，从 L1 run 事实派生（profile + `authority_scope.allowed_tools` + step + 前置条件 + budget）。它不是系统能力全集，也不预装 `catalog` 内容。
- 每个 `authorized` 项带 `risk_class`（§3.4.1）与 `preconditions`；effect 粒度按 §3.4.1 动态细分。
- `authorized_complete_for_run: true` 表示"本轮可建议操作已完整"；未列出的操作模型不得建议，执行 gate 同源拒绝。
- **catalog 不预装**：系统能力全集、effect 词表、限制与未授权原因，通过 `capability_lookup` 只读探索按需取得；查询结果作为 observation 进入后续请求，带 `refs_used` / `coverage` / `omissions`。
- `report_capability_gap` 的 `missing_effect` 必须绑定一次 catalog 观察，或由系统在建议后校验并回流"不存在/未授权"；不允许模型没查就断言"系统没有"。
- `work_archive_read` 属于只读操作，进 `exploration` 或 `authorized` 的只读子集；不与可写操作混在同一列表。
- `provider_toolset_ref` 指向工具真源；L3 展开完整 schema，不内联手写。

> 预装 catalog 等于"全知投喂"，违反 00 §2.4；判断器需要的是"本轮能建议什么"，不是"系统一共有什么"。catalog 的相关性由模型在判断中决定是否查询。

### 3.7 runtime

`provider / model / temperature / reasoning_effort / max_tokens / tool_choice / stream`。是执行参数，**模型不可见**，不进 messages。

### 3.8 与 L1 的绑定（待补）

reviewed-v1 只覆盖了判断场景的最小集。对照 `NovelDomain.AgentRun` 与 VS-00L RunEnvelope，还需：

| L1 字段 | 现状 | 用途 |
|---|---|---|
| `budget {max_steps, max_tool_calls, max_provider_calls, max_replans, max_pending_artifacts, remaining}` | 缺 | 模型知道还能调几次工具/provider |
| `authority_scope {production_write, allowed_tools, mode}` | 只有 `authority` 的部分投影 | 区分目录与授权 |
| `parent_turn_ref` / `profile_ref` / `run_mode` | 缺 | 恢复与 profile 绑定 |
| `status` / `phase` | 缺 | 与 L4 `status` 区分（run 状态 ≠ 响应状态） |
| `goal.version` | `goal` 只有 source_ref/raw_text | 目标版本可追溯 |
| `scope.goal_version` / `plan_version` | 只有 work_revision/scope_revision | stale base 检测 |

## 4. L3 Provider Request

### 4.1 独立顶层

```json
{"method": "POST", "url": "http://127.0.0.1:8000/v1/chat/completions", "api": "openai.chat.completions", "body": {}}
```

`provider_request` 是 L2 的渲染结果，不是 L2 的一部分（reviewed-v1 已独立成顶层）。只有 `body` 发给 provider。

### 4.2 messages 渲染

reviewed-v1 示例：

```text
[system] 判断器规则（自然语言）
[user]   【应用数据 · 非作者原话】{"kind":"application_scope","provenance":"application","work_revision":1,"base_facts":[...]}
[user]   作者原话（独立，无前缀）
```

规则：

- `system` 由 `SystemEnvelope.system_text/1` 渲染（身份原文 + 版本行 + instructions）。reviewed-v1 的 system 只有判断器规则，缺身份与版本行（待补 §7）。
- 应用数据消息 content 是 JSON 序列化，带 `kind` / `provenance`；不拼自然语言段落。
- 作者原话独立 user，字节不变、无前缀（I-ART-2）。
- 历史与 checkpoint 由 canonical transcript 投影（README 原则）；示例省略，但契约必须规定：完整历史按 I-ART-7 显式 checkpoint，不允许只靠摘录伪造。

### 4.3 tools

reviewed-v1 的 7 个工具（`judgment_decision` / `ask_author` / `agent_plan_draft` / `register_author_content` / `propose_creative_directions` / `propose_work_profile_revision` / `report_capability_gap`）schema 完整。规则：

- `tools` 从 `provider_toolset_ref` 展开，不内联手写；`fixed_tool_count` 由工具真源决定。
- `judgment_decision` 的 action 字段互斥、`agent_plan_draft` 同批约束由 L4 校验，不只靠 prompt。
- `report_capability_gap` 的 `alternative_operation_refs` 必须来自当轮 `capabilities.operations`（L4 `alternative_operation_refs_valid`）。

### 4.4 响应原始

`provider_response_example` 保留 `http_status` / `assembled_message` / `usage`。原始响应是 L4 的输入，不直接进入作者可见面。

## 5. L4 Validation + Application Outcome

### 5.1 validation

reviewed-v1 字段：`tool_args_valid`、`tool_name_allowed`、`alternative_operation_refs_valid`、`effect_available`、`model_proposed_execution`、`execution_authorized`、`production_write_performed`、`reason_code`。

说明：`effect_available` 是系统校验"`missing_effect` 不被任何 operation 的 `effect_keys` 覆盖"，正好替代了把 `capability_status` 塞给模型的做法（判断仍由模型做，校验由系统做）。

授权决策字段（§3.4.3 / §3.4.4）：

- `risk_class`：本次动作的实际风险等级（`low / medium / high / critical`）；
- `risk_decision`：`allow / require_confirmation / ask_author / deny`；
- `author_decision`：`approved / rejected / null`（`critical` 或 `manual` 下由作者给出）；
- `auto_adopted`：是否由 `full` 自动采纳；
- `author_delegation_ref`：自动采纳时的作者委托来源；
- `execution_authorized` / `production_write_performed`：最终执行与写入事实。

待补（§7）：

- `refs_exist`：引用的 ref 真实存在；
- `refs_in_scope`：`used_refs ⊆ base_facts ∪ observations`（I-ART-9）；
- `author_visible_clean`：作者可见文本不含内部标识（`chapter:` / `character:` / `call_` / `pcall_` / `fact:` 等）；
- `action_field_conflict`：`judgment_decision` 的 action 专属字段互斥、`plan` 同批约束。

### 5.2 application_outcome

```json
{
  "kind": "model_interaction_outcome",
  "decision_type": "capability_gap",
  "status": "completed_without_execution",
  "author_visible": {"content": "..."},
  "status_message": {"text": "本轮未修改作品。", "source": "system"},
  "truthfulness": {
    "artifact_adopted": false,
    "production_write_performed": false,
    "execution_authorized": false,
    "author_confirmed": false,
    "auto_adopted": false,
    "adoption_required": true
  },
  "evidence_used": ["chapter:...", "as_..."],
  "evidence_limitations": ["..."]
}
```

规则：

- `author_visible.content` 是**唯一作者可见正文**，必须逐字等于 provider 响应中的模型字段（`reason` / `author_reasoning` / `question` / `content`），由 `AgentNarrativeSource` 绑定；系统不改写、不摘要、不拼接、不删除标识（§5.3）。
- `status_message` 是系统事实说明（"本轮未修改作品" / "已生成候选待审阅"），由固定模板生成，`source: system`，不冒充模型原话，不参与 I1；UI 需与 `author_visible` 分开展示。
- `decision_type` 与 L2 `allowed_decision_types` / 工具名映射；`status` 是运行结果分类（`completed_without_execution` 等），与 AgentRun `status/phase` 区分。
- `truthfulness` 复用现有 `TurnResult` 形状（`tool_called` / `tool_status` / `tool_name` / `artifact_adopted` / `production_write_performed` / `execution_blocked` / `decision_type` / `first_blocking_gate` / `reason_codes`）；reviewed-v1 的三字段是子集，需扩展而不是另建。`author_confirmed` / `auto_adopted` / `adoption_required` 由授权决策（§3.4）回填，模型不得自填。
- `evidence_used` 是扁平 refs 列表；`as_*` artifact ref 与 `chapter:*` 混在一起，建议加 `source_kind` 或按类型分组（待补 §7）。
- `evidence_limitations` 需要 `visibility` 标注：进作者可见面就要作者可读措辞，否则只作系统审计。

### 5.3 作者可见字节（已定：单字段）

**决定（2026-11-12，作者）：`author_visible.content` 采用单字段，是唯一作者可见正文，字节必须等于模型响应中的对应字段。**

- 来源字段：`report_capability_gap.author_reasoning`、`judgment_decision.reason`、`ask_author.question`、纯文本回复的 `content` 等；由 `AgentNarrativeSource.from_tool_call_narrative/4` / `from_provider_result/2` 绑定，记录 `source_hash` / `byte_range` / `narrative_hash`。
- 系统不得：改写、摘要、拼接、删除内部标识、前端重写。展示层只允许格式渲染（换行、Markdown、卡片排版、高亮），不改字词。
- 违规处理：`author_visible_clean` 失败（含内部标识）→ 作为该 `call_id` 的原生 tool 失败结果回流，模型重试；不产生候选，不做展示层过滤。
- 系统事实说明（"本轮未修改作品"等）走独立 `status_message`，由模板生成，标注 `source: system`，不参与 I1，不冒充模型原话。
- reviewed-v1 示例的处理：`application_outcome_example.author_visible.content` 与 `provider_response_example` 的 `author_reasoning` 字节不一致，按本决定应改为 `author_reasoning` 原文；示例里那句整理后的文案如需保留，应移到 `status_message`。

**为什么不做双字段（系统展示文案 + 模型原话）**：现有 N-NARR 明确禁止应用摘要、解析后的 map、前端文案作为作者可见过程叙事来源（见 `AgentNarrativeSource` 模块说明）；系统也没有语义整理能力（只有 `Display` 固定映射与 `Presenter` 固定模板）。双字段要么新增 LLM 二次整理（成本、延迟、事实漂移、新来源类型），要么用规则改写（破坏字节一致性），都会让作者看到的话与记录的话不一致。整理能力交给模型：在工具 schema / 描述里要求作者可见字段直接写成作者可读文本，系统只校验与拒绝回流。

## 6. 不变量

沿用 VS-00L I-ART-1～12，新增：

| ID | 不变量 | 违反示例 |
|---|---|---|
| I-MIR-1 | L2 只从 L1 派生；`base_facts` 必须带 `origin`/`work_revision`/`fact_ref` | L2 创造事实或只写 `source: "xxx_v1"` 字符串 |
| I-MIR-2 | 内部 ref 只允许出现在结构化 ref 字段；作者可见文本禁止出现 | `author_reasoning` 里写 `chapter:<uuid>` 或 `fact:...` |
| I-MIR-3 | `author_visible.content` 单字段，字节 = provider 响应中对应模型字段；系统不得改写/摘要/拼接；系统事实说明走 `status_message`，不参与 I1 | 展示层改写模型原话后冒充原话；或把系统文案放进 `author_visible` |
| I-MIR-4 | 系统回填区（validation/truthfulness/evidence_used/outcome）不得由模型填充 | 模型参数里传 `truthfulness` |
| I-MIR-5 | 观察必须绑定 `call_id` 与真实查询；未读/截断/省略如实表达 | 无 call_id 的观察进上下文，或把 `not_read` 当"没有" |
| I-MIR-6 | 覆盖三账一致：计数、列表、省略数可机械对账 | `resolved_count=7` 但只列 1 条且 `omitted_count=0` |
| I-MIR-7 | `target_issue`/`capability_status` 等系统结论不得进入模型可见区（除非标 `visibility` 且作者裁决） | 模型复述"系统已标记能力缺失" |

## 7. 待补项（v1 → v2）

| 项 | 现状 | 待补 | 依据 |
|---|---|---|---|
| AgentRun 执行边界 | `authority` 已有 mode/budget 部分投影，其余缺 | `authorized` 派生、`authority_scope.allowed_tools`、`parent_turn_ref`、`profile_ref`、`run_mode`、`status/phase` | `NovelDomain.AgentRun`、VS-00L §3.1 |
| Canonical transcript | README 声明，示例省略 | `dialogue.messages` + `checkpoint` + `coverage`，或明确"本次不投影历史" | I-ART-7、B81 |
| system identity | system 只有判断器规则 | `SystemEnvelope` 身份原文 + 版本行 + `identity_ref` | VS-00H |
| 阅读可见性事实 | 只有 `in_chapter_index` / `has_accepted_prose` | `visible_in_reading`（当前事实），期望态放 `target_issue.desired_state` 或作者问题 | 作者本轮诉求 |
| authorized 派生 | `@judgment_capabilities` 硬编码，未从 run 事实派生 | 从 run 事实派生 `authorized`；统一 `allowed_tools` 来源；`capability_lookup` 只读探索 | §3.6 |
| effect 词表 | `proposed_normalized_keys` | 冻结 effect 词表真源；风险规则与 authorized 都引用同一词表 | §3.6 |
| 风险规则表 | 等级定义已定（§3.4.1） | 注册表基线 + 可版本化规则表（纯函数 `risk_of(capability, effect, target, context)`） | §3.4.1 |
| 授权模式优先级 | 已定 run > session > work > global | `mode_source` 落 trace；继承/撤销规则；模型不可改模式 | §3.4.2 |
| critical 确认 | 已定：所有模式都询问作者；同意=执行+采纳 | 确认请求结构、拒绝回流、审计字段 | §3.4.4 |
| full 自动采纳 | 已定：可自动采纳 | `delegation_ref`、可撤销、可回滚、`status_message` 明确标注"自动采纳" | §3.4.5 |
| validation 覆盖 | 缺 refs/文本/互斥/风险校验 | `refs_exist` / `refs_in_scope` / `author_visible_clean` / `action_field_conflict` / `risk_decision` / `author_decision` | §5.1 |
| author_visible 字节 | **已定**：单字段，字节 = 模型响应字段（§5.3） | 示例 outcome 文案需改为 `author_reasoning` 原文，或移入 `status_message` | §5.3、I-MIR-3 |
| evidence_used 类型 | 扁平 refs 混 artifact/chapter | `source_kind` 或分组 | §5.2 |
| fact_ref 命名空间 | `chapter_slot:1` 可能被当对象 ref | 加 `fact:` 前缀或独立 field | §3.5 |
| observations | 示例为空 | 真实观察或明确"本轮未调用工具" | I-ART-4 |

## 8. 验收

- L1→L2 派生：`base_facts` 可回溯 run 事实（`origin`/`work_revision`）。
- L2→L3 渲染：字节级快照；作者原话独立、无前缀；system 身份/版本行存在。
- L3→L4 解码：`decision_type`/`status` 映射；`author_visible` 字节来源。
- 负例矩阵：内部标识进作者可见文本、ref 越界、无 call_id 观察、effect 词表外 effect、`alternative_operation_refs` 不在目录、action 字段冲突、模型声称已执行。
- 授权矩阵：`low/medium/high/critical` × `manual/risk_based/full/smart` 的决策与 §3.4.3 一致；`critical` 恒 `ask_author`；`full` 自动采纳必须有 `delegation_ref` 且可回滚。
- 风险函数：同一 `capability/effect/target/context` 重算得到同一等级；模型不能自评风险；模式优先级 run > session > work > global 可回放。
- catalog 按需探索：首轮 prompt 不预装 catalog；真实 run 中模型主动调用 `capability_lookup`，观察带 `refs_used`/`coverage` 进入后续请求；`report_capability_gap` 的断言与观察一致（00 §2.4 验收口径）。
- 真实页面：capability_gap 案例往返 + 一次执行案例；I1/I2/I3 复跑。

## 9. 未决问题

1. **authorized 派生**：从 run 事实派生的函数与 `allowed_tools` 统一来源；工具级先做，effect 级等词表冻结。
2. **effect 词表**：`proposed_normalized_keys` 何时冻结、由谁维护。
3. **transcript 投影**：本次是否投影完整历史（含 checkpoint），还是先只投影当前 turn + 明确声明。
4. **reviewed-v1 示例**：是否作为正式 contract example 保留，还是只作讨论材料。
5. **`smart` 模式**：判断主体是规则还是子代理；误判如何回滚、如何审计。

## 10. 变更记录

- 2026-11-12 初稿：按作者三份结构整理（L1/L2/L3，Context Block、target_issue、判别联合）。
- 2026-11-12 第二稿：按作者三层分离方案重写（业务层 / Provider 适配层 / 响应审计层）。
- 2026-11-12 第三稿：按作者四层闭环与 reviewed-v1 示例包重写；`provider_request` 独立顶层；`base_facts` 证据绑定；`authority` / `validation` / `application_outcome` 对齐现有 TurnResult；新增待补项与 I1 字节问题。
- 2026-11-12 第四稿：作者定稿 `author_visible` 单字段；补 `status_message` 系统说明字段；I-MIR-3 与 §5.3 定稿；移除"双字段"未决项。
- 2026-11-13 第五稿：作者定稿授权体系——风险等级（low/medium/high/critical，按 capability+effect+target 动态细分）、授权模式（manual/risk_based/full/smart，run > session > work > global）、`full` 含自动采纳、`critical` 恒询问作者且同意=执行+采纳；补 §3.4.1–§3.4.5、validation/truthfulness 字段与验收矩阵。
