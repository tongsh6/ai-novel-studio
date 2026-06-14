# Maintenance Hooks

> 状态：v3 体系领域层 · 当前权威（领域细节）。归 v3 治理、服从 v3 原则（见 `docs/design/README.md`「整合原则：以 v3 为主体，吸取 v2」）；标题/历史中的 v2 仅为来源标记。
>
> 角色：`docs/design/domain/24-novel-intent-catalog.md` 中维护族的运行展开文档，并依赖 `docs/design/04-execution-orchestrator.md`、`docs/design/07-workbench-ui-contract.md`、`docs/design/domain/22-continuity-model.md`。
>
> v3 定位：本文的 maintenance hook 链路是 `docs/design/08-novel-element-model.md`§5「三态对账」中**实现态提炼**的机制实现——从已采纳正文提炼实现态、产 tentative、经 adoption 进权威层（对应 08 NEM-GAP-06）。
>
> 目标：定义 v2 中小说层默认 maintenance hook 链路，包括触发时机、产物类型、pending adoption 路径、validator 角色、失败与修正处理，以及它们与正文执行、长跑 checkpoint 和连续性权威层的关系。

---

## 1. 文档定位

本文回答 8 个问题：

1. maintenance hook 为什么必须存在
2. 哪些动作会触发 maintenance hook
3. maintenance hook 会产出哪些对象
4. 这些产物先进入哪一层，何时 adoption
5. validator 在维护链路里扮演什么角色
6. maintenance 失败、漂移或冲突时怎么处理
7. long-run 与 checkpoint 如何接 maintenance
8. UI 如何稳定呈现维护结果

本文不负责：

- 具体 prompt 文案
- continuity 对象最终字段细节
- UI 布局

本文只冻结 maintenance 运行 contract。

---

## 2. 为什么 maintenance hook 必须存在

如果系统只会“写正文”，不会“维护状态”，长篇很快就会坏掉。

常见问题：

- 写完一章后没人更新当前状态
- 埋下的伏笔没有入表
- 已回收的伏笔还挂着 active
- 章节摘要缺失，后续续写只能重读正文

因此 maintenance 不是附属功能，而是正文链路的正式后处理层。

---

## 3. maintenance hook 的定义

maintenance hook 是：

**在正文或结构性创作动作完成后，系统自动触发的一组维护动作，用于把文本推进转换成连续性层、摘要层和运行层的结构化结果。**

它不是：

- 直接静默写生产状态
- 替代用户显式确认的后台黑箱

它必须遵循：

```text
trigger
  -> maintenance generation
  -> pending artifacts
  -> validation
  -> adoption / correction / discard
```

---

## 4. 设计目标

### 4.1 自动触发，但不静默定稿

maintenance 应默认自动跑，减少用户手工负担；  
但结果通常先进入 pending adoption，而不是直接成为权威层。

### 4.2 正文和连续性解耦但可追踪

正文是原始 source layer。  
maintenance 产物是从正文提炼出的结构化层。

二者必须：

- 解耦
- 可追溯
- 可修正

### 4.3 maintenance 结果必须可验证

maintenance 产物不能因为是“系统自己维护的”就免检。

它们必须经过：

- schema validation
- continuity validation
- adoption validation

### 4.4 maintenance 必须支持纠错

如果维护结果和事实不符，系统必须支持：

- correction
- supersede
- invalidate

---

## 5. hook 总览

小说层默认的维护 hook 至少包括：

1. `hook.SUMMARIZE_CHAPTER`
2. `hook.UPDATE_STATE_SNAPSHOT`
3. `hook.SCAN_NEW_FORESHADOWING`
4. `hook.SCAN_FORESHADOWING_RESOLUTION`
5. `hook.RECORD_TIMELINE_EVENT`

### 5.1 说明

- `hook.SUMMARIZE_CHAPTER`
  - 生成章节摘要

- `hook.UPDATE_STATE_SNAPSHOT`
  - 更新关键状态切面

- `hook.SCAN_NEW_FORESHADOWING`
  - 发现新埋下的伏笔

- `hook.SCAN_FORESHADOWING_RESOLUTION`
  - 检测旧伏笔是否被回收

- `hook.RECORD_TIMELINE_EVENT`
  - 提炼关键事件进入时间线

---

## 6. 触发边界

maintenance 不应对所有动作都一视同仁。

### 6.1 默认触发动作

至少包括：

- `DRAFT_SCENE`
- `REVISE_SCENE`
- `DRAFT_CHAPTER`
- `REVISE_DRAFT`

### 6.2 条件触发动作

在特定 policy 下，也可包括：

- `GENERATE_CHAPTER_OUTLINE`
- `REVISE_CHAPTER_OUTLINE`

但这类通常不直接触发完整连续性维护链。

### 6.3 不应默认触发的动作

例如：

- 纯阅读
- 纯解释 / 总结当前状态
- 风格偏好修改

---

## 7. Trigger Contract

每次 maintenance hook 触发都必须有明确 trigger record。

### 7.1 trigger 最小字段

至少包括：

- `trigger_id`
- `source_intent`
- `source_turn_ref`
- `source_task_ref`（可空）
- `source_artifact_refs`
- `anchor_type`
- `anchor_ref`
- `triggered_at`

### 7.2 trigger 的作用

它至少要能回答：

- 是哪次创作动作触发了维护
- 针对哪一章 / 哪一场
- 基于哪些正文或结构源

---

## 8. maintenance artifact 类型

maintenance hook 默认产出的不是直接对象写入，而是 maintenance artifacts。

### 8.1 主要类型

至少包括：

- `chapter_summary_artifact`
- `state_snapshot_artifact`
- `foreshadowing_artifact`
- `timeline_event_artifact`
- `continuity_warning_artifact`

### 8.2 artifact 最小字段

至少包括：

- `artifact_id`
- `artifact_type`
- `source_trigger_ref`
- `source_artifact_refs`
- `target_object_type`
- `status`
- `content_ref`
- `revision_base`
- `requires_adoption`
- `created_at`

### 8.3 为什么先产 artifact

因为维护结果本质上仍是“提议”：

- 可能漏了
- 可能提错了
- 可能和当前权威层冲突

因此先进入 artifact 层更安全。

---

## 9. Pending Adoption Layer

maintenance 产物默认应进入 pending adoption layer。

### 9.1 默认路径

```text
source text / structure
  -> maintenance hook
  -> maintenance artifacts
  -> validation
  -> pending adoption
  -> accepted continuity objects
```

### 9.2 为什么不能默认直写

因为 maintenance 很容易出现：

- 误判伏笔
- 状态抽取过度简化
- timeline 事件粒度不对

### 9.3 哪些结果可自动通过

只有在 policy 明确允许且风险低时，少量 maintenance 结果可以自动进入权威层。

默认仍以 adoption 为主。

---

## 10. Maintenance Validator

maintenance validator 是专用校验层。

### 10.1 职责

至少负责：

- schema 合法性
- target object 合法性
- source traceability
- 基本连续性合理性
- 与当前权威层冲突检查

### 10.2 不负责的内容

不负责：

- 重新写正文
- 替作者拍板世界观方向

### 10.3 validator 的输出

至少包括：

- `is_valid`
- `warnings`
- `conflict_refs`
- `recommended_action`

### 10.4 recommended_action

至少支持：

- proceed_to_adoption
- require_review
- block_and_correct
- invalidate_artifact

---

## 11. 默认 hook 链路

### 11.1 章节正文完成后的默认链路

建议默认：

```text
DRAFT_CHAPTER / REVISE_DRAFT
  -> hook.SUMMARIZE_CHAPTER
  -> hook.UPDATE_STATE_SNAPSHOT
  -> hook.SCAN_NEW_FORESHADOWING
  -> hook.SCAN_FORESHADOWING_RESOLUTION
  -> hook.RECORD_TIMELINE_EVENT
```

### 11.2 场景正文完成后的默认链路

建议默认：

```text
DRAFT_SCENE / REVISE_SCENE
  -> provisional state snapshot updates
  -> provisional foreshadowing scan
  -> optional provisional timeline events
```

### 11.3 provisional 的意义

scene 级维护结果通常更适合作为 provisional continuity，在章级 checkpoint 或章完成时再进一步聚合。

---

## 12. 聚合与提升

maintenance 结果并不总是一步到位进入最终层级。

### 12.1 scene -> chapter 聚合

典型路径：

- scene-level provisional artifacts
- 在 chapter completion 或 checkpoint 时聚合
- 形成 chapter-level continuity artifacts

### 12.2 章级优先原则

对大多数连载创作来说，chapter 仍是默认的 continuity 结算边界。

### 12.3 允许例外

如果某些 scene 已经是强结算点，也可提前 adoption。

---

## 13. hook 与 long-run 的关系

maintenance hook 必须和 long-run 配合，而不是脱节。

### 13.1 long-run 内的 hook 触发

至少支持两类：

- per-unit hook
- checkpoint hook

### 13.2 per-unit hook

在每个 scene 或 chapter unit 完成后跑。

### 13.3 checkpoint hook

在 checkpoint 时聚合整理：

- summary
- state changes
- unresolved continuity issues

### 13.4 checkpoint 不等于 adoption

checkpoint 时可以生成更多 pending maintenance artifacts，  
但不意味着它们已经 accepted。

---

## 14. 失败与漂移处理

maintenance 结果可能失败，也可能漂移。

### 14.1 失败类型

至少包括：

- `SCHEMA_FAILURE`
- `SOURCE_MISSING`
- `CONTINUITY_CONFLICT`
- `AMBIGUOUS_EXTRACTION`

### 14.2 默认处理

- schema failure -> invalidate artifact or retry
- source missing -> fail hook
- continuity conflict -> require review / correction
- ambiguous extraction -> require review

### 14.3 漂移处理

当 maintenance 结果与已有权威层冲突时，不应静默覆盖。

默认路径：

- warning / correction
- adoption blocked
- supersede / invalidate

---

## 15. correction、supersede、invalidate

maintenance 结果天然容易需要这三条路径。

### 15.1 correction

用于：

- 系统提取方向不准
- 用户明确指出维护结果错了

### 15.2 supersede

用于：

- 新维护结果比旧结果更完整或更准确

### 15.3 invalidate

用于：

- 该 artifact 基于错误正文理解
- 相关 source 已被撤销或改写

---

## 16. adoption 规则

maintenance adoption 默认应逐项处理，而不是全自动吞掉。

### 16.1 默认可见动作

至少包括：

- accept
- edit_then_accept
- discard

### 16.2 batch adoption

可以支持 batch adoption，但前提是：

- 每项仍有独立 validator 结果
- 每项仍可追溯 source

### 16.3 高风险 adoption

以下通常应更谨慎：

- worldrule-like maintenance outputs
- 大范围 state snapshot 变化
- resolved foreshadowing 判定

---

## 17. Maintenance 结果的权威层落点

被接受的 maintenance 产物进入：

- chapter_summary
- state_snapshot
- foreshadowing
- timeline_event

### 17.1 不直接写回 source

例如：

- `chapter_summary` 不应直接变成 `chapter.summary` 唯一真相
- `snapshot` 不应直接覆盖 `character` 档案

### 17.2 结果是新增或 superseding 对象

维护结果更适合表现为：

- 新对象
- 新版本
- superseding 关系

而不是无痕覆盖旧对象。

---

## 18. 与 Memory 的关系

maintenance hook 直接喂给 Memory 的 warm tier。

### 18.1 主要 warm sources

至少包括：

- accepted chapter summaries
- accepted latest snapshots
- active foreshadowings
- accepted timeline events

### 18.2 provisional 与 memory

未被接受的 maintenance artifact 不应默认进入主 retrieval 路径，但可在 debug / review 视图中可见。

### 18.3 long-run resume

恢复时优先依赖 accepted maintenance 结果，而不是 provisional 草稿。

---

## 19. 与 UX 的关系

maintenance hook 的很多结果直接决定工作台卡片流。

### 19.1 常见卡片

至少包括：

- `adoption_card`
- `warning_card`
- `checkpoint_card`
- `result_card`

### 19.2 必须可见的内容

至少包括：

- 来源章节 / 场景
- 维护类型
- 关键提炼结果摘要
- 当前 validator 状态

### 19.3 不应只隐藏在后台

特别是：

- 新伏笔提取
- 伏笔回收判定
- 大状态变更

这些都不应完全静默。

---

## 20. 与 Intent Catalog 的关系

维护 hooks 不是替代维护族 intent。

### 20.1 hook 与 intent 的关系

- hook：自动触发
- intent：显式动作

### 20.2 维护族 intent 的意义

当用户想显式要求：

- 重新总结
- 强制刷新 state snapshot
- 手工触发伏笔扫描

仍应有对应 intent。

### 20.3 默认策略

优先自动触发；必要时可显式重跑。

---

## 21. 与对象模型的关系

maintenance 主要作用于连续性对象，而不是主结构对象本身。

### 21.1 主要产出对象

至少包括：

- chapter_summary
- state_snapshot
- foreshadowing
- timeline_event

### 21.2 间接影响

虽然 maintenance 不直接改 worldbuilding / chapter / scene 主结构，但它可能通过 correction 影响这些对象的后续使用。

---

## 22. 持久化与事件要求

至少要持久化：

- trigger records
- maintenance artifacts
- maintenance validator results
- adoption decisions
- supersede / invalidate links

### 22.1 最小事件集合

至少包括：

- maintenance_triggered
- maintenance_artifact_emitted
- maintenance_validated
- maintenance_adopted
- maintenance_discarded
- maintenance_invalidated
- maintenance_superseded

---

## 23. 契约测试要求

### 23.1 trigger tests

验证：

- draft / revise 完成后正确触发 hook
- 非创作动作默认不触发

### 23.2 artifact tests

验证：

- 每类 maintenance artifact 字段完整
- source traceability 存在

### 23.3 validator tests

验证：

- continuity conflict 能被检出
- ambiguous extraction 能进入 review 路径

### 23.4 adoption tests

验证：

- maintenance artifact 默认先进入 pending
- accepted 后进入权威 continuity 层

### 23.5 long-run integration tests

验证：

- checkpoint hook 能正确聚合
- scene provisional -> chapter-level continuity 的提升路径成立

---

## 24. 本文冻结的硬骨

本文正式冻结以下 maintenance hook 硬骨：

1. maintenance hook 是正文链路的正式后处理层
2. 默认维护 hook 至少包括：章节摘要、状态更新、伏笔扫描、伏笔回收、时间线记录
3. maintenance 结果默认先进入 artifact / pending adoption 层
4. maintenance validator 是独立校验层
5. scene 级维护结果通常先作为 provisional continuity，再在章级聚合
6. maintenance 失败、漂移和冲突必须显式处理，不能静默覆盖权威层
7. hook 不替代显式维护 intent；二者并存

---

## 25. 本文暂不冻结的内容

以下只定边界，不定最终实现：

1. ~~各 maintenance artifact 的最终 schema~~ ✅ 最小公共字段集合（`hook_name` / `revision_base` / `proposed_change` / `requires_adoption` / `adoption_status` / `risk_class` / `auto_adoption_hint`）由本文和 `../contracts/VS-04-adoption-boundary-contract-pack.md` 共同约束；UI 展示使用 `candidate_set` + `available_actions`，不恢复旧 `adoption_card` payload 作为动作来源；各 hook 私有字段仍通过 `proposed_change.payload` 扩展。
2. scene -> chapter 聚合的具体算法
3. ambiguity threshold 的默认值
4. 哪些低风险维护结果可自动 adoption 的最终策略（ADR-0007 已留 `auto_adoption_hint` 字段位置；策略由 W9 工单与 `32-human-approval-policy.md` §13.1 联合冻结）

---

## 26. 下一步

maintenance hooks 之后，最自然的是：

1. `26-context-assembly-policy.md`

因为对象、连续性、风格、intent、maintenance 都有了，下一步就该把 Router / Executor / LongRunner / Reader 各自到底取什么上下文正式定下来。
