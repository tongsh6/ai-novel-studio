# ADR-0010：首批 UI intent 的最小 slot schema

- 状态：Accepted (2026-04-25)
- 日期：2026-04-25
- 涉及范围：Foundation 子系统 4（Capability and Intent Registry）/ 子系统 3（Conversation Behaviors）/ Domain 子系统 24（Novel Intent Catalog）/ Domain 子系统 28（Authoring Lifecycle）/ UI 前冻结清单
- 相关文档：`0008-first-batch-intents.md`、`../04-capability-and-intent-registry.md`、`../03-conversation-behaviors.md`、`../24-novel-intent-catalog.md`、`../28-authoring-lifecycle.md`、`../30-contract-glossary.md`

---

## 背景

ADR-0008 已冻结首批 UI 需要覆盖的 20 条 `intent.<NAME>`，但明确把每条 intent 的 slot schema 留给 W8 / ADR-0010。

如果 slot schema 不冻结，UI 与 Router 会继续在以下位置产生分叉：

1. clarification card 不知道哪些字段是 required、哪些只是 preference。
2. intent registry 的 `slot_schema_ref` 只能指向空洞占位。
3. guided conversation flows 无法区分“必须追问”与“可推断 / 可默认”。
4. long-run / drafting / maintenance 的目标范围可能被 prompt 临时解释，无法形成稳定 contract。

本 ADR 只冻结首批 intent 的**最小 slot schema**，让 UI 与 registry 能稳定消费；它不冻结 capability 映射、prompt、approval policy id 或 UI 入口分组。

---

## 考虑过的方案

### 方案 A：每个 intent 独立定义完整 JSON Schema

优点：类型最严格，未来实现可直接生成表单。

缺点：过早绑定实现细节；20 条 intent 会产生大量重复字段；容易把 prompt 策略、capability 参数、UI 表单字段混进 slot contract。

### 方案 B：只冻结统一 slot envelope，不冻结每个 intent 的具体 slots

优点：最小改动，完全遵循 `04-capability-and-intent-registry.md` §6 的 Foundation 抽象。

缺点：不能关闭 `29-design-integrity-review.md` §7.1 第 8 条；UI 仍不知道首批 intent 各自要问什么。

### 方案 C：统一 slot envelope + 每个首批 intent 的最小 slot 列表

优点：同时关闭 UI 前冻结缺口与过度设计风险；slot 字段遵循 Foundation slot registry，具体 slot 数量保持最小；可被 clarification、intent registry 与 UI 引导流共同消费。

缺点：仍需后续实现层把 slot schema 编译成 JSON Schema / form model / validation rules。

---

## 最终决策

采用**方案 C：统一 slot envelope + 每个首批 intent 的最小 slot 列表**。

本 ADR 冻结三层内容：

1. slot entry 的最小字段 envelope。
2. slot policy 的 requiredness / inferability / defaultability 取值组合。
3. ADR-0008 20 条首批 intent 的最小 slot 表。

---

## 1. 冻结范围

本 ADR 冻结：

1. `slot_schema_ref` 指向的最小 schema 形状。
2. 单个 slot entry 的 canonical 字段。
3. ADR-0008 §3 的 20 条 intent 对应的最小 slot 集合。
4. required slot 与 clarification 触发之间的关系。
5. slot schema 扩展纪律。

本 ADR 显式不冻结：

1. 每条 intent 的 capability 映射。
2. 每条 intent 的 prompt、system instruction 或 context assembly 规则。
3. 每条 intent 的最终 `approval_policy_id`。
4. UI 表单布局、控件类型、按钮文案或入口分组。
5. 完整 JSON Schema 文件内容与运行时代码生成规则。
6. 新增 intent 或新增 intent family。

---

## 2. slot schema envelope

每个首批 intent 的 slot schema 至少包含：

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `schema_id` | 是 | slot schema 的稳定 id，建议格式 `slot_schema.<INTENT_NAME>.v1` |
| `intent_name` | 是 | 对应 ADR-0008 的 `intent.<NAME>` |
| `schema_version` | 是 | schema 版本，首版为 `1` |
| `slots` | 是 | slot entry 列表 |
| `deferred_to_runtime` | 是 | 本 ADR 不冻结、由 registry / capability / UI 运行时补齐的项目列表 |

约束：

1. `intent_name` 必须使用 `30-contract-glossary.md` §7.1 的 `intent.<NAME>` namespace。
2. `schema_id` 不得与 `hook.<NAME>`、`capability.<NAME>`、`quality_gate.<NAME>` 等 namespace 混用。
3. `deferred_to_runtime` 至少包含 `capability_mapping`、`prompt`、`ui_layout`、`approval_policy_id`。

示例：

```json
{
  "schema_id": "slot_schema.CREATE_WORK_SEED.v1",
  "intent_name": "intent.CREATE_WORK_SEED",
  "schema_version": 1,
  "slots": [
    {
      "slot_name": "genre",
      "slot_type": "enum_or_text",
      "description": "作品类型或类型组合",
      "requiredness": "required_to_execute",
      "inferability": "not_inferable",
      "defaultability": "no_default",
      "allowed_values_ref": null,
      "validation_rules_ref": null,
      "scope_dependency": "work"
    }
  ],
  "deferred_to_runtime": [
    "capability_mapping",
    "prompt",
    "ui_layout",
    "approval_policy_id"
  ]
}
```

---

## 3. slot entry 最小字段

每个 slot entry 至少包含：

| 字段 | 取值 / 格式 | 来源 |
| --- | --- | --- |
| `slot_name` | `snake_case` | 04 §6.1 |
| `slot_type` | 见 §4 | 04 §6.1 |
| `description` | 人可读说明 | 04 §6.1 |
| `requiredness` | `required_to_execute` / `optional_preference` | 04 §6.2 |
| `inferability` | `not_inferable` / `inferable_with_high_confidence` | 04 §6.3 |
| `defaultability` | `no_default` / `defaultable` | 04 §6.4 |
| `allowed_values_ref` | string 或 null | 04 §6.1 |
| `validation_rules_ref` | string 或 null | 04 §6.1 |
| `scope_dependency` | 见 §5 | 04 §6.1 |

字段语义：

1. `requiredness=required_to_execute` 表示缺失时必须阻止执行，除非同一 slot 同时满足 `inferability=inferable_with_high_confidence` 或 `defaultability=defaultable`。
2. `requiredness=optional_preference` 不得单独触发 clarification。
3. `inferability=inferable_with_high_confidence` 表示 Router 可从当前上下文稳定补足，但必须在 trace / current parameters 中保留推断来源。
4. `defaultability=defaultable` 表示 registry 可给默认值；默认值本身不在本 ADR 冻结。
5. `allowed_values_ref` 与 `validation_rules_ref` 是引用位置，本 ADR 不冻结具体枚举全集或校验表达式。

---

## 4. `slot_type` 最小集合

首批 slot schema 至少支持以下类型：

| slot_type | 用途 |
| --- | --- |
| `text` | 自由文本，如方向、边界、修改要求 |
| `enum_or_text` | 可选枚举但允许自由补充，如类型、风格、偏好范围 |
| `object_ref` | 指向 work / volume / chapter / scene / draft / style_sample 等对象 |
| `object_ref_list` | 多对象引用列表 |
| `scope_ref` | 表示维护或生成范围，如 work / volume / chapter / scene |
| `anchor_ref` | 指向章节、场景或文本锚点 |
| `range_ref` | 表示连续创作范围、章节范围或场景范围 |
| `integer` | 数量、目标字数、checkpoint 间隔等 |
| `boolean` | 开关型偏好 |

本 ADR 不冻结 UI 控件类型；`slot_type` 是 registry / validation 语义，不是前端组件名。

---

## 5. `scope_dependency` 最小集合

`scope_dependency` 描述 slot 所依赖的业务范围，至少支持：

| scope_dependency | 含义 |
| --- | --- |
| `work` | 作品级 |
| `volume` | 分卷级 |
| `arc` | arc 规划级 |
| `chapter` | 章节级 |
| `scene` | 场景级 |
| `draft` | 正文草稿级 |
| `style` | 风格样本 / 偏好级 |
| `continuity` | 连续性对象级 |
| `reading_projection` | 阅读投影级 |
| `runtime` | 运行控制级，如 checkpoint / continuation range |

`scope_dependency` 不是对象模型新增项，只是 slot 对既有 Domain 对象范围的引用分类。

---

## 6. clarification 触发规则

遵 `03-conversation-behaviors.md` §5：

1. 缺失 `required_to_execute` 且不可高置信推断、不可默认的 slot，必须触发 clarification。
2. 只缺 `optional_preference` 不应触发 clarification。
3. 可以高置信推断或用默认值补足的 slot，不应触发 clarification，但应进入 `current_parameters`。
4. 多个候选目标冲突且不能安全默认时，即使 slot 名义上可推断，也必须触发 clarification。
5. clarification 的 `required_fields` / `optional_fields` 应直接引用 `slot_name`。

补充说明：`required_to_execute` 只表示执行前必须获得稳定参数，不表示 UI 必须把该 slot 渲染成作者填写的表单字段。对于立项、新卷 / 新章规划等作者可能尚未想清楚答案的场景，UI 可以通过候选方向、对比方案、编辑建议或自然语言追问来收集 slot answer；最终仍必须把用户选择合并回本 ADR 定义的 slot 名称。

---

## 7. 首批 intent slot 表

### 7.1 建立期

| intent | required slots | optional preference slots | 说明 |
| --- | --- | --- | --- |
| `intent.CREATE_WORK_SEED` | `genre`、`core_selling_point`、`target_reader` | `tone_preference`、`reference_works` | 来自 24 §5.5 对类型、卖点、读者的澄清要求 |
| `intent.REFINE_WORK_POSITIONING` | `work_ref`、`positioning_direction` | `target_reader`、`genre` | 对既有作品定位做收束；`work_ref` 通常可从当前 work 高置信推断 |
| `intent.DEFINE_WORLDBUILDING` | `work_ref`、`rule_range`、`target_object_ref` | `constraint_style` | 来自 24 §6.5 的规则范围与目标对象 |
| `intent.CREATE_MAIN_OUTLINE` | `work_ref`、`mainline_target`、`genre_positioning` | `ending_preference`、`conflict_preference` | 来自 24 §7.5 的主线目标与类型定位 |
| `intent.LOAD_STYLE_SAMPLE` | `style_sample_source`、`preference_range` | `style_scope` | 来自 24 §14.5 的偏好范围；样本来源可为文本、文件或引用 |

### 7.2 规划期

| intent | required slots | optional preference slots | 说明 |
| --- | --- | --- | --- |
| `intent.SPLIT_INTO_VOLUMES` | `work_ref`、`split_granularity` | `target_volume_count`、`arc_strategy` | 来自 24 §8.5 的拆分粒度 |
| `intent.GENERATE_VOLUME_OUTLINE` | `work_ref`、`volume_ref` | `arc_refs`、`outline_depth` | volume / arc 关系遵 ADR-0004 |
| `intent.GENERATE_CHAPTER_OUTLINE` | `chapter_ref` | `volume_ref`、`arc_ref`、`outline_depth` | 来自 24 §9.5 的目标章节 |
| `intent.GENERATE_SCENE_OUTLINE` | `scene_ref`、`scene_boundary` | `chapter_ref`、`beat_count` | 来自 24 §10.5 的场景目标与边界 |

### 7.3 产出期

| intent | required slots | optional preference slots | 说明 |
| --- | --- | --- | --- |
| `intent.DRAFT_SCENE` | `scene_ref`、`scene_boundary` | `target_word_count`、`style_ref` | 复用场景族目标与边界 |
| `intent.DRAFT_CHAPTER` | `chapter_ref` | `scene_refs`、`target_word_count`、`style_ref` | 来自 24 §11.5 的目标章节与场景 |
| `intent.CONTINUE_DRAFTING` | `continuation_range` | `checkpoint_interval`、`target_word_count` | 来自 24 §15.5 的当前续写范围 |
| `intent.RUN_UNTIL_CHECKPOINT` | `continuation_range`、`checkpoint_condition` | `max_budget_hint` | long-run 原生 intent，checkpoint 条件必须明确 |
| `intent.REVISE_DRAFT` | `draft_ref`、`revision_direction` | `revision_scope`、`preserve_constraints` | 来自 24 §12.5 的修改对象与方向 |

### 7.4 维护期

| intent | required slots | optional preference slots | 说明 |
| --- | --- | --- | --- |
| `intent.SUMMARIZE_CHAPTER` | `chapter_ref` | `summary_fidelity` | 生成 chapter_summary，锚点默认取章节 |
| `intent.UPDATE_STATE_SNAPSHOT` | `snapshot_scope`、`anchor_ref` | `target_object_ref` | 来自 22 §6 的 snapshot scope 与内容锚点 |
| `intent.SCAN_NEW_FORESHADOWING` | `planted_anchor_ref` | `foreshadowing_type`、`scan_scope` | 来自 22 §8 的伏笔定义与类型 |
| `intent.SCAN_FORESHADOWING_RESOLUTION` | `resolved_anchor_ref` | `foreshadowing_type`、`scan_scope` | 回收核心伏笔仍按 ADR-0008 默认需要 confirmation |

### 7.5 阅读与修订期

| intent | required slots | optional preference slots | 说明 |
| --- | --- | --- | --- |
| `intent.ENTER_READ_MODE` | `work_ref` | `start_anchor_ref`、`projection_mode` | 阅读入口低风险；`work_ref` 通常可从当前 work 推断 |
| `intent.REFRESH_READING_PROJECTION` | `work_ref`、`source_revision_refs` | `projection_scope`、`force_refresh` | projection 来源遵 ADR-0009 与 30 §2.3 |

---

## 8. 首批 slot entry 默认策略

除非具体 intent registry 覆盖，首批 slot 按以下默认策略解释：

| slot 名称模式 | requiredness | inferability | defaultability |
| --- | --- | --- | --- |
| `*_ref` 且可从当前工作上下文唯一确定 | `required_to_execute` | `inferable_with_high_confidence` | `no_default` |
| `*_ref` 且上下文存在多个候选 | `required_to_execute` | `not_inferable` | `no_default` |
| `*_range` / `*_boundary` / `*_direction` / `*_condition` | `required_to_execute` | `not_inferable` | `no_default` |
| `target_word_count` / `checkpoint_interval` / `outline_depth` / `beat_count` | `optional_preference` | `not_inferable` | `defaultable` |
| `style_ref` / `tone_preference` / `reference_works` / `preserve_constraints` | `optional_preference` | `inferable_with_high_confidence`（如当前上下文唯一） | `defaultable` |
| `force_refresh` | `optional_preference` | `not_inferable` | `defaultable` |

运行时可以把推断值和默认值展示给用户确认，但不得把 optional preference 缺失误判为 blocking clarification。

运行时也可以把系统生成的候选值展示给用户选择或修改；候选值在用户确认前只属于 draft slot / current parameters，不得视为已经执行或写入权威状态。

---

## 9. 与 ADR-0008 的关系

ADR-0008 冻结 intent 集合与元数据；本 ADR 冻结这些 intent 的 slot schema。

约束：

1. 本 ADR 不新增 ADR-0008 之外的 intent。
2. 删除或新增首批 intent 必须先 supersede / extend ADR-0008，再同步更新本 ADR。
3. 修改某 intent 的 risk_class、confirmation 默认值或 long-run fit 不属于本 ADR 范围。
4. 新增 slot 不等于新增 intent；但新增 `required_to_execute` slot 会改变 UI clarification 行为，必须走新 ADR 或兼容窗口。

---

## 10. 与 Foundation behavior 的关系

slot schema 是 clarification 与 confirmation 的输入之一：

1. clarification 由 slot 满足性触发。
2. confirmation 由风险、预算、写入范围、long-run、authority escalation 触发，不由 slot 缺失本身触发。
3. 高风险 intent 可以同时先 clarification、后 confirmation：先补足 required slots，再请求用户确认。
4. `default_requires_confirmation` 仍以 ADR-0008 与 32 approval policy 为准。

---

## 11. 影响

### 11.1 对 Foundation 的影响

1. `04-capability-and-intent-registry.md` §5 的 `slot_schema_ref` 有了首批可指向的 schema 粒度。
2. `03-conversation-behaviors.md` §5 的 clarification 触发条件获得 Domain 侧字段来源。
3. 不改变 TurnResult / card / action / next_action schema。

### 11.2 对 Domain 的影响

1. 24 intent catalog 的代表性 intent 获得最小参数边界。
2. maintenance / reading / drafting 相关 intent 不再依赖 prompt 临时解释目标范围。
3. 不新增 Domain object family，不改变既有对象生命周期。

### 11.3 对 UI 的影响

1. guided conversation flows 可稳定展示 required slots 与 optional preferences。
2. clarification card 的 `required_fields` / `optional_fields` 可直接引用 slot 名。
3. UI 仍不得从 slot schema 推断 capability 或 approval policy。

---

## 12. 回写目标

本 ADR Accepted 后已回写：

1. `0000-index.md` §2.1：新增 ADR-0010。
2. `00-overview.md` §7：新增 D2-027，说明首批 intent slot schema 由 ADR-0010 冻结。
3. `29-design-integrity-review.md` §7.1 第 8 条：标记为已冻结。
4. `30-contract-glossary.md` §10：追加本 ADR 冻结的硬骨条目。

---

## 13. 后续工作

1. 将本文 slot schema 编译成后续 `docs/design-v2/schemas/` 下的机器可读 JSON Schema。
2. 在 UI 设计阶段按 `requiredness` / `inferability` / `defaultability` 投影 clarification 与表单引导。
3. 若扩展 ADR-0008 首批 intent 集合，必须同步扩展本 ADR 的 slot 表。

## enforced_by

- `NovelFoundation.Enums.SlotType` — text / enum_or_text / object_ref 等 9 种 slot 类型
- `NovelFoundation.Enums.Requiredness` — required_to_execute / optional_preference
- `NovelFoundation.Enums.Inferability` — not_inferable / inferable_with_high_confidence
- `NovelFoundation.Enums.Defaultability` — no_default / defaultable
- `NovelFoundation.Enums.ScopeDependency` — work / volume / chapter 等 10 种 scope
