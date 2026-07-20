# Novel Quality Gates v2

> 状态：草案
>
> 角色：`docs/design/domain/24-novel-intent-catalog.md`、`25-maintenance-hooks.md` 与 `28-authoring-lifecycle.md` 之后的小说质量门禁目录。
>
> 目标：定义 v2 小说层的质量门禁体系，把“写得是否可用、是否符合当前作品目标、是否适合继续进入后续流程”变成可注册、可追踪、可解释、可采纳或阻断的 Domain validator / policy 组合。

---

## 1. 文档定位

本文回答 8 个问题：

1. 小说质量门禁为什么必须独立建模
2. quality gate 与 validator、adoption、confirmation 的关系是什么
3. 哪些质量项属于小说领域，而不是 Foundation
4. 不同创作阶段默认应启用哪些质量门
5. 质量门如何影响 long-run、maintenance 和阅读投影
6. 质量结果如何进入 UI card
7. 质量失败时应该阻断、警告、重试还是进入人工确认
8. 哪些质量维度可以自动判断，哪些只能作为辅助审查

本文不负责：

- 具体 prompt 文案
- 各 validator 的最终算法
- 平台运营策略的商业细则
- UI 具体布局

本文只冻结质量门禁的 Domain contract。

---

## 2. 为什么质量门禁必须独立建模

长篇小说系统不能只回答“有没有生成结果”。

它还必须回答：

- 结果是否违背既有设定
- 人物行为是否可信
- 章节是否完成了当前 brief
- 爽点、hook、节奏是否支撑连载阅读
- 是否误把未公开信息写给了角色
- 是否产生了战力膨胀或规则崩坏
- 是否应该交给作者确认后再进入 authoritative state

如果这些只散落在 executor prompt 里，系统会出现：

- 每个能力各自判断质量
- long-run 中错误持续放大
- adoption review 缺少结构化依据
- UI 只能显示“看起来不错”这种不可操作反馈

因此 quality gate 必须成为小说 Domain 层的一等目录。

---

## 3. 定义

`quality_gate` 是小说层注册在 Foundation validator / policy 机制上的领域质量检查。

它用于判断某个 artifact、draft、outline、maintenance result 或 adoption proposal 是否：

- 可以继续
- 需要警告
- 需要重试
- 需要人工确认
- 需要阻断

它的运行模型是：

```text
artifact / proposal
  -> domain quality gates
  -> structured quality findings
  -> policy decision
  -> proceed / warn / retry / confirm / block
```

---

## 4. 与 Foundation 的关系

Foundation 提供：

- validator registry
- policy registry
- behavior contract
- adoption boundary
- warning / failure card
- trace / audit

Novel Domain 注册：

- 小说质量门类型
- 每个门禁适用的 intent family
- 每个门禁读取的对象范围
- 每个门禁的严重程度策略
- 每个门禁的默认 UI 投影方式

Foundation 不得内置爽点判断、战力膨胀判断、伏笔强度判断、网文留存判断或人物弧光判断。

---

## 5. Quality Gate 最小模型

每个 quality gate 至少包括：

- `gate_name`
- `gate_version`
- `gate_family`
- `description`
- `applies_to_intent_families`
- `applies_to_artifact_types`
- `required_context_policy_ref`
- `validator_refs`
- `default_severity_policy_ref`
- `default_failure_action`
- `ui_card_policy_ref`
- `status`

`gate_name` 使用 namespace：

```text
quality_gate.<name>
```

建议最小 `gate_family`：

- `continuity`
- `character`
- `story_structure`
- `style`
- `web_serial`
- `risk`
- `maintenance`

`default_failure_action` 至少支持：

- `WARN`
- `RETRY`
- `CONFIRM`
- `BLOCK`
- `ADOPTION_REVIEW`
- `CHECKPOINT`

---

## 6. 默认质量门目录

v2 小说层默认至少保留以下质量门。

### 6.1 设定冲突检查

`quality_gate.worldrule_conflict`

目标：

- 检查是否违反已采纳 worldrule
- 检查世界观规则是否被临时剧情突破
- 检查新设定是否与旧设定冲突

默认动作：

- 高置信硬冲突：`BLOCK`
- 低置信疑似冲突：`WARN`
- 影响范围大的新规则：`CONFIRM`

### 6.2 人物逻辑检查

`quality_gate.character_logic`

目标：

- 检查人物行为是否符合已知动机、关系和当前状态
- 检查人物是否知道不该知道的信息
- 检查人物弧光是否突兀跳变

默认动作：

- 认知越界：`BLOCK` 或 `CONFIRM`
- 动机不足：`WARN`
- 大幅角色转向：`CONFIRM`

### 6.3 时间线与状态检查

`quality_gate.timeline_and_state`

目标：

- 检查事件顺序是否矛盾
- 检查地点、伤势、持有物、能力等级等状态是否前后冲突
- 检查 scene / chapter anchor 是否与 narrative order 对齐

默认动作：

- revision conflict：交给 Foundation consistency 层
- semantic conflict：`ADOPTION_REVIEW`
- 高风险状态覆盖：`CONFIRM`

### 6.4 伏笔检查

`quality_gate.foreshadowing`

目标：

- 检查是否重复使用已解决伏笔
- 检查新伏笔是否被登记
- 检查回收是否有足够前置铺垫
- 检查伏笔承诺是否被无效化

默认动作：

- 已解决伏笔误用：`WARN` 或 `BLOCK`
- 新伏笔未登记：触发 maintenance hook
- 重大伏笔回收：`CONFIRM`

### 6.5 信息越界检查

`quality_gate.knowledge_boundary`

目标：

- 检查角色是否说出或行动基于其不应知道的信息
- 检查读者视角揭示是否早于 reveal 计划
- 检查旁白是否破坏悬念边界

默认动作：

- 角色认知越界：`BLOCK`
- 读者 reveal 过早：`CONFIRM`
- 旁白轻微泄露：`WARN`

### 6.6 节奏检查

`quality_gate.pacing`

目标：

- 检查章节是否拖慢主目标推进
- 检查情绪、动作、信息密度是否与当前阶段匹配
- 检查是否连续多章缺少推进或兑现

默认动作：

- 单章轻微偏慢：`WARN`
- 连续节奏疲劳：`ADOPTION_REVIEW`
- long-run 多 unit 偏航：`CHECKPOINT`

### 6.7 爽点成立检查

`quality_gate.payoff_validity`

目标：

- 检查爽点是否有足够压抑、铺垫和兑现
- 检查兑现是否产生后果
- 检查是否只写了口号，没有形成事件级满足

默认动作：

- 章级爽点弱：`WARN`
- 卷级关键爽点不成立：`CONFIRM`
- long-run 中连续弱兑现：`CHECKPOINT`

### 6.8 Hook 强度检查

`quality_gate.web_hook_strength`

目标：

- 检查章节尾是否有继续阅读驱动力
- 检查 hook 是否与下一章可兑现路径匹配
- 检查 hook 是否过度重复或虚假承诺

默认动作：

- 普通章节 hook 弱：`WARN`
- 关键章 hook 弱：`ADOPTION_REVIEW`
- 虚假 hook：`CONFIRM`

### 6.9 战力膨胀检查

`quality_gate.power_scaling`

目标：

- 检查能力、境界、资源和代价是否符合既有规则
- 检查主角成长是否跳过必要路径
- 检查反派或冲突强度是否失衡

默认动作：

- 硬规则冲突：`BLOCK`
- 成长过快：`CONFIRM`
- 小幅强度偏移：`WARN`

### 6.10 网文留存检查

`quality_gate.serialization_retention`

目标：

- 检查黄金三章、付费点、阶段高潮、连续留存点是否服务当前定位
- 检查防疲劳设计是否生效
- 检查章节群是否具备连续追读动机

默认动作：

- 建议性问题：`WARN`
- 关键商业节点偏弱：`ADOPTION_REVIEW`
- 与作者定位冲突：`CONFIRM`

### 6.11 风格与句式检查

`quality_gate.style_fit`

目标（承载 VS-00E `validator.prose_pattern_repetition` / `validator.emotion_expression_balance` 等正文风格类 validator；§7.1 已引用该门）：

- 检查行文是否模板化：连续句首重复、句式重复、段落长度过度均匀、高频身体反应模板、高频 AI 套话、短距离重复短语
- 检查情绪表达是否失衡：关键情绪被直接声明而非戏剧化（show/tell 平衡——仅关键转折/关键选择要求戏剧化，过渡与非关键状态允许概述）
- 检查正文实际读者效果是否偏离 `ReaderEffectBrief` / `ProseExecutionBriefV1`

默认动作：

- 文学类问题以 `WARN` / `ADOPTION_REVIEW` 为主，**默认不硬阻断作者采纳**（ADR-0020 I7）
- 确定性句式/模板命中：`WARN`
- 不得仅凭关键字命中直接判定语义质量失败

---

### 6.12 实现状态对照（machine-checked，截至 2026-06-28）

> 本节状态以 **production lib（`apps/*/lib`）实际代码**为准核对，不以本目录的设计意图为准。
> 本目录 §6 是"应该有哪些门"，本节是"现在真有什么"。两者会漂移，改动质量门实现后请同步本表。
>
> 复核命令（可重跑）：
> ```bash
> grep -rhoE "quality_gate\.[a-z_]+" apps/*/lib | sort | uniq -c        # 哪些门在代码里被引用
> grep -oE "validator\.[a-z_]+" apps/novel_application/lib/novel_application/prose_quality_validators.ex | sort -u
> ```
>
> 三档：
> - 🟢 **确定性已实现 + 真实页面验收**：有非 LLM validator，且被外部自动化真实页面验收覆盖。
> - 🟡 **仅 LLM、未验证**：只在独立 evaluator（`prose_quality_evaluator.ex`）的 prompt 里被列为可用 ref，**从未用真实模型跑过**（CP2/CP3 验收全程 slice_verify，对评审 prompt 默认返回空 findings），准确度未知。
> - 🔴 **仅设计**：production lib 零引用，只存在于本目录。

| # | 质量门 | §7.3 产出期默认 | 确定性 validator | LLM evaluator prompt | 真实模型验证过 | 状态 |
|---|---|:--:|:--:|:--:|:--:|---|
| 6.11 | `style_fit` 风格与句式 | ✅ | ✅ 6 函数→2 ref | ✅ | ✅ slice_verify | 🟢 已实现 + 验收 |
| 6.2 | `character_logic` 人物逻辑 | ✅ | ❌ | ✅ | ❌ | 🟡 仅 LLM、未验证 |
| 6.5 | `knowledge_boundary` 信息越界 | ✅ | ❌ | ✅ | ❌ | 🟡 仅 LLM、未验证 |
| 6.6 | `pacing` 节奏 | ✅ | ✅ 1 函数 | ✅ | ❌ 语义部分 | 🟢 确定性已实现（real-page 验收待补） |
| 6.7 | `payoff_validity` 爽点成立 | ✅ | ❌ | ✅ | ❌ | 🟡 仅 LLM、未验证 |
| 6.8 | `web_hook_strength` Hook 强度 | ✅ | ❌ 语义、不宜确定性 | ✅ | ❌ | 🟡 仅 LLM、未验证 |
| 6.9 | `power_scaling` 战力膨胀 | ✅ | ❌ 需规则模型 | ✅ | ❌ | 🟡 仅 LLM、未验证 |
| 6.1 | `worldrule_conflict` 设定冲突 | （建立期） | ❌ | ❌ | ❌ | 🔴 仅设计 |
| 6.3 | `timeline_and_state` 时间线与状态 | （维护期） | ❌ | ❌ | ❌ | 🔴 仅设计 |
| 6.4 | `foreshadowing` 伏笔 | （规划期） | ❌ | ❌ | ❌ | 🔴 仅设计 |
| 6.10 | `serialization_retention` 网文留存 | （建立/规划期） | ❌ | ❌ | ❌ | 🔴 仅设计 |

分布：🟢 2（`style_fit` 确定性+真实页面验收；`pacing` 确定性已实现、real-page 验收待补） / 🟡 5 / 🔴 4。

**确定性实现细节**（`apps/novel_application/lib/novel_application/prose_quality_validators.ex`）：

| 归属门 | validator_ref | 检查 | 触发阈值 | 默认 action |
|---|---|---|---|---|
| `style_fit` | `emotion_expression_balance` | 直接情绪声明（show/tell 失衡） | ≥2 处 | `warn` |
| `style_fit` | `prose_pattern_repetition` | 身体反应模板 | ≥3 处 | `warn` |
| `style_fit` | `prose_pattern_repetition` | AI 套话（随着/仿佛/一阵/微微/缓缓/一丝） | ≥4 处 | `warn` |
| `style_fit` | `prose_pattern_repetition` | 连续句首雷同（≥3 句句首 2 字相同） | ≥3 句 | `warn` |
| `style_fit` | `prose_pattern_repetition` | 行结构过度均匀（同首字+同逗号数） | ≥3 行 | `warn` |
| `style_fit` | `prose_pattern_repetition` | 结构元标签混入正文（场景N/第N场/标题：） | ≥1 处 | `warn` |
| `pacing` | `dialogue_density` | 长段落零对白（叙述密度偏高、节奏偏慢） | 句数 ≥8 且无对白引号 | `warn` |

> `dialogue_density` 是 §6.6 节奏门的确定性兜底：只抓"整段无对白"这一确定性信号（保守阈值，避免误伤短促动作 beat 与纯叙述过场）；节奏的语义判断（是否拖慢主目标、连续疲劳）仍由独立 evaluator 负责。建议性 WARN、作者可越过。

**已知缺口与债务**：

1. **产出期门已全部至少有评估钩子（2026-06-28）**：§7.3 产出期 7 门——`style_fit`（🟢 确定性+验收）、`pacing`（🟢 确定性 `dialogue_density`，验收待补）、`character_logic` / `knowledge_boundary` / `payoff_validity` / `web_hook_strength` / `power_scaling`（🟡 独立 evaluator rubric）。其中 `web_hook_strength`（需"章尾驱动力"语境）与 `power_scaling`（需既有功法/境界规则模型）**本质语义、确定性化不成立**（强行关键字会误报，违反 §6.6/§6.11 与 prose-ai-taste-findings），故只落 LLM evaluator，待 I10 真实模型验证。
2. **🟡 五门有效性未证**：`character_logic / knowledge_boundary / payoff_validity / web_hook_strength / power_scaling` 只靠独立 evaluator 的 LLM 自评，且从未用真实模型验证——属 ADR-0020 **I10（真实文学收益须人工盲评）**未闭环范围，不得用脚本冒充。
3. **非产出期四门无运行钩子（🔴）**：`worldrule_conflict`（建立期）/`timeline_and_state`（维护期）/`foreshadowing`（规划期）/`serialization_retention`（建立/规划期）属其它阶段，当前质量评估只在产出期跑，这四门需各自阶段的运行钩子 + 读模型（世界规则注册表 / 跨章连续性 / 伏笔生命周期 / 章节群留存结构），是独立 slice 的基建活，不应塞进 prose 产出期评估硬凑。
4. **术语未对账**：独立 evaluator 的 prompt 还引用了一组**不在本目录 11 门**的 VS-00E 场级 validator（`scene_change / emotional_transition / character_agency / causal_progression / setup_turn_consequence / brief_alignment / dialogue_intent_fit`，对照 `ProseExecutionBriefV1` 评"正文 vs 执行简述对齐"）。这组与 11 门目录是两套并存术语，需要在后续 slice 里归一。
5. **`pacing` 确定性兜底（`dialogue_density`）指标本身选错了代理信号（2026-07-20 登记，未开工）**：
   现状（`prose_quality_validators.ex`）——整段正文句子数 ≥8 且全程零对白标记（「」『』""）→ 判"叙述密度偏高、节奏偏慢"。这不是段落长度，但同属一类错误：**用表面词法特征（句数、有无引号）代理一个语义/结构属性（节奏），而两者并不等价**：
   - 假阳性：动作/追逐/灾难类场景全程无对白也可以是全书最快的节奏（短句、高动词密度、强因果推进）——当前实现会把这种场景误判为"偏慢"。
   - 假阴性：两个角色闲聊、没有任何情节推进，只要句子间穿插对白引号就完全不触发——恰恰是这类"有对白但没事发生"的场景才是真正拖慢主线的节奏问题。
   - 零章级结构感知：高潮章后刻意安排的"喘息章"是正确的节奏设计（对白少、叙述多），当前实现会把正确的craft 选择当成缺陷标记。
   - 真正决定"节奏"的是语义/结构维度：本章是否推进主目标、情绪/动作/信息密度是否匹配当前所处阶段、是否连续多章缺少推进或兑现（本节 §6.6 目标原文），这些词法统计量测不出来。
   - 可行方向（未设计，只记方向）：本项目已有"声称的节奏意图"与"实际执行结果"两份结构化数据可比对，不必只靠自由浮动的 LLM 判断——`ChapterPlanDirection`（章级计划）已含 `emotion`/`plot_progress`/`opening_hook`/`ending_hook` 等字段声明本章"该是什么节奏"；`ChapterSummary` 四栏（`plot/characters/foreshadowing/mood`，见 `chapter_summary.ex`）记录本章"实际发生了什么"。把"声称的推进/情绪"与"摘要记录的实际推进/情绪"做比对（含跨章连续对比，捕捉"连续 N 章推进稀薄"），比要求 LLM 凭空评"这章节奏怎么样"更有据可查、更不易被同一个模型的自我评分蒙混——但这仍是语义比对，不能完全确定性化，且尚未验证比对本身的准确度（同样落在 I10 范围）。
   - `dialogue_density` 现有实现**不撤**（它本来就只自称是"确定性兜底捕捉一个信号"，不是节奏检查本身，见本节原有注释），但不应被误当成"节奏已经测得对"——真正的节奏判断仍待建。

---

## 7. 阶段默认门禁

### 7.1 建立期

默认启用：

- worldrule conflict
- character logic
- serialization retention（弱）
- style fit（若有样本）

重点是防止方向级偏航。

### 7.2 规划期

默认启用：

- story structure
- foreshadowing
- pacing
- payoff validity
- serialization retention

重点是检查卷、章、场是否能支撑长跑。

### 7.3 产出期

默认启用：

- character logic
- knowledge boundary
- pacing
- payoff validity
- hook strength
- power scaling
- style fit

重点是不让正文偏离当前 brief，也不让 long-run 连续积累错误。

### 7.4 维护期

默认启用：

- maintenance schema validity
- source traceability
- continuity conflict
- foreshadowing lifecycle

重点是检查 maintenance artifact 能否进入 adoption review。

### 7.5 阅读与修订期

默认启用：

- reading projection source validity
- accepted source consistency
- revision impact
- style and pacing review

重点是确保 reader 看到的是 accepted / authoritative 内容。

---

## 8. 与 Long-Run 的关系

long-run 运行中质量门不能只在最后跑。

默认策略：

```text
execution unit completed
  -> unit-level quality gates
  -> emit warnings / retry / checkpoint
checkpoint
  -> aggregate quality review
  -> user decision
resume
  -> reread authoritative quality context
```

触发 checkpoint 的典型质量条件：

- 连续多个 unit 命中同类 warning
- 关键 validator hard failure
- 关键情节质量门需要人工确认
- 新产生的质量风险影响后续 plan
- maintenance 发现正文与权威层冲突

---

## 9. Quality Finding 最小模型

> 当前冻结：本节最小字段、`source_type`、`severity`、`action` 与 UI 投影映射由本文、`../07-workbench-ui-contract.md` 与 `../contracts/VS-05-ui-roundtrip-contract-pack.md` 共同约束。

`quality_finding` 是一次 quality gate 运行后产生的结构化结果。

最小字段：

- `quality_finding_id`
- `quality_gate_ref`
- `source_ref`
- `source_type`
- `source_task_ref`
- `source_turn_ref`
- `target_scope_ref`
- `severity`
- `action`
- `summary`
- `evidence_refs`
- `affected_object_refs`
- `can_override`
- `created_at`

`source_type` 至少支持：

- `ARTIFACT`
- `DRAFT`
- `OUTLINE_OBJECT`
- `MAINTENANCE_RESULT`
- `ADOPTION_PROPOSAL`
- `OBJECT_MUTATION_PROPOSAL`
- `DIRECT_VALIDATOR_RUN`

`source_ref` 指向 `source_type` 对应对象；不再使用单独的 `source_artifact_ref` 作为 canonical 字段。

`severity` 至少支持：

- `INFO`
- `WARN`
- `ERROR`
- `CRITICAL`

`action` 至少支持：

- `WARN`
- `RETRY`
- `CONFIRM`
- `BLOCK`
- `ADOPTION_REVIEW`
- `CHECKPOINT`

`quality_finding.action` 不是 runtime `NextAction`，必须经 policy 层映射后再进入运行状态和 UI card。

| quality_finding.action | policy / runtime effect | common card |
|---|---|---|
| `WARN` | proceed with warning | `warning_card` / `adoption_card` |
| `RETRY` | retry policy | `progress_card` / `failure_card` |
| `CONFIRM` | approval `CONFIRM_BEFORE_EXECUTE` -> NextAction `CONFIRM_BEFORE_EXECUTE` | `confirmation_card` |
| `BLOCK` | block adoption or execution until correction / branch | `failure_card` / `warning_card` |
| `ADOPTION_REVIEW` | approval `ADOPTION_REQUIRED` -> NextAction `ADOPT_ARTIFACTS` | `adoption_card` |
| `CHECKPOINT` | task enters `CHECKPOINT` -> NextAction `RESUME_TASK` | `checkpoint_card` |

`quality_finding` 不直接修改 artifact 或 authoritative object，只能作为 policy、adoption、checkpoint、UI card 和 Experience Engine 的输入。

---

## 10. 与 Adoption 的关系

quality gate 不直接把 artifact 变成 accepted。

它只提供 adoption 的依据：

- 通过：可进入 adoption review 或自动继续
- 警告：进入 adoption card 的 risk 列表
- 阻断：不可采纳，除非用户通过 correction / branch 处理
- 需确认：触发 confirmation card

adoption card 至少应能引用：

- quality finding refs
- gate names
- severity
- suggested actions
- affected object refs

---

## 11. 与 Experience Engine 的关系

quality gate 的历史结果是经验沉淀的重要来源。

可用于提炼：

- 高频错误清单
- 作者常改的质量维度
- 特定作品的节奏规律
- 某类 hook / 爽点的有效模式
- 某些 validator 的误报模式

但经验提炼结果不能直接改写 quality gate policy。

它应先成为 experience artifact，再经 adoption 或 policy review 生效。

---

## 12. UI 投影

quality gate 结果通常进入：

- `warning_card`
- `adoption_card`
- `confirmation_card`
- `checkpoint_card`
- `failure_card`

UI 应展示：

- 门禁名称
- 问题摘要
- 影响范围
- 建议动作
- 是否阻断
- 可跳过或必须处理

---

## 13. 本文冻结的硬骨

本文正式冻结以下质量门禁硬骨：

1. quality gate 是小说 Domain 层的一等目录，不属于 Foundation 内置业务逻辑
2. quality gate 通过 validator / policy / adoption / confirmation 组合生效
3. 默认质量门至少覆盖：设定冲突、人物逻辑、时间线状态、伏笔、信息越界、节奏、爽点、hook、战力膨胀、网文留存
4. long-run 必须支持 unit-level 与 checkpoint-level 质量门
5. quality gate 结果不能直接采纳 artifact，只能影响 proceed / warn / retry / confirm / block / adoption review
6. quality gate 历史结果是 Experience Engine 的输入，但不能自动改写长期规则
7. quality gate 结果必须落为 `quality_finding`，作为 adoption、checkpoint、UI card 和经验沉淀的共同引用对象

---

## 14. 下一步

本文之后应细化：

1. 每个 quality gate 的 validator input / output schema
2. 各 intent family 的默认 gate mapping
3. quality finding card 的 Domain 扩展字段
4. 与 `32-human-approval-policy.md` 的高风险确认矩阵联动
