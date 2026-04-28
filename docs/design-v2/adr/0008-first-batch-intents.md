# ADR-0008：首批 UI intent 集合

- 状态：Accepted (2026-04-25)
- 日期：2026-04-25
- 涉及范围：Domain 子系统 24（Novel Intent Catalog）/ 子系统 28（Authoring Lifecycle）/ 子系统 32（Human Approval Policy）/ Foundation 子系统 4（Capability and Intent Registry）/ 子系统 11（UX Contract）
- 相关文档：
  - `../24-novel-intent-catalog.md` §3 / §5–§17 / §24
  - `../28-authoring-lifecycle.md` §3 / §4–§8
  - `../30-contract-glossary.md` §7.1
  - `../32-human-approval-policy.md` §5
  - `../29-design-integrity-review.md` §7.1
  - `0001-turn-result-v2-schema.md`
  - `0002-state-enums.md`
  - `0003-authority-budget-escalation.md`
- 取代：无
- 取代者：无

---

## 背景

`24-novel-intent-catalog.md` 已冻结 13 个 intent family（§24 第 1 条），但每个 family 内部"代表性 intent"在文档里只是举例，没有冻结其中哪些条目是 **UI 首批必须暴露**的。

`28-authoring-lifecycle.md` 已冻结 5 个生命周期阶段（§3：建立 / 规划 / 产出 / 维护 / 阅读与修订），且每阶段已列出主 intent family（§4.3 / §5.3 / §6.3 / §7.3 / §8.3），但同样没有把"UI 入口"收口到具体 intent 列表。

W7 工单要求：在 W4（ADR-0006）冻结 card/action envelope 后，给 UI 设计阶段一份**最小可消费的首批 intent 清单**，覆盖 5 阶段全部主 family，每条 intent 标注 namespace、family、`risk_class`、确认需求、long-run 适配，使 UI 设计与 capability registry 注册有共同起点。

本 ADR 只冻结**集合本身**与每条 intent 的**元数据列**，不冻结 slot schema（W8）。

---

## 考虑过的方案

### 方案 A：把 24-novel-intent-catalog.md §5–§17 列出的所有"代表性 intent"全部纳入首批

优点：覆盖最完整，UI 不会缺入口。

缺点：单家族内的细分 intent（例如 `REFINE_WORLDBUILDING` / `REFINE_WORLDRULE` / `ADD_FACTION` / `ADD_LOCATION` / `ADD_SYSTEM_ASSET`）在 UI 首批阶段会让对话面板入口爆炸；超出 W7 计划"≤ 20 条"上限；与 §29 §7.1 第 7 条"先锚最小集合"原则冲突。

### 方案 B：每个生命周期阶段挑出 2–5 条代表性 intent，合计 ≤ 20 条，覆盖 5 阶段主 family

优点：与 28 §3 五阶段对齐，每阶段都有可被 UI 投影的入口；保留每个主 family 至少 1 条；总条数受控；后续可由扩展 ADR 增补。

缺点：需要在多 intent 同 family 时做主观取舍（例如 GENERATE_CHAPTER_OUTLINE vs SET_CHAPTER_BRIEF）。

### 方案 C：只挑 long-run 主战场 intent（正文族 + 场景族 + 长跑族）作为首批

优点：UI 一开始就解决最高频路径。

缺点：完全绕过建立期与阅读期；与 28 §3 五阶段全覆盖目标冲突；建立期没有 UI 入口将让"立项引导"流程无法启动（参见 README §5.1 `45-guided-conversation-flows.md` 立项引导）。

---

## 最终决策

选择 **方案 B：5 阶段全覆盖、单阶段 2–5 条、合计 ≤ 20 条**。

本 ADR 冻结：

1. 首批 intent 集合（共 20 条）。
2. 每条 intent 的 namespace（遵 30 §7.1 `intent.<NAME>` 格式）。
3. 每条 intent 的 family 归属（遵 24 §3 13 family 命名）。
4. 每条 intent 的生命周期阶段归属（遵 28 §3 五阶段命名）。
5. 每条 intent 的 `risk_class` 建议值（遵 32 §5 `LOW` / `MEDIUM` / `HIGH` / `CRITICAL`）。
6. 每条 intent 的"是否默认需要 confirmation"建议值。
7. 每条 intent 的 long-run 适配标注（`native` / `optional` / `not_recommended`）。
8. 集合扩展纪律。

本 ADR 显式不冻结：

1. 每条 intent 的 slot schema（W8 / ADR-0010）。
2. 每条 intent 的 capability 映射（registry 运行时配置）。
3. 每条 intent 的最终 `approval_policy_id`（32 §5 完整 policy 对象由 Domain 配置层定义）。
4. 每条 intent 的 prompt / context assembly 规则（26 后续）。
5. 每条 intent 的 UI 入口分组、按钮文案、引导流（W7 后续 UI 设计阶段）。
6. 用于运行态触发的 `hook.<NAME>` 同名条目（24 §16.2 已划清 `intent.` 与 `hook.` namespace 边界）。
7. 任何超出 24 §5–§17 已列出"代表性 intent"集合之外的新 intent。

---

## 决策内容

### 1. 集合规模与覆盖

首批集合共 **20 条 intent**，按 28 §3 五阶段分布如下：

| 阶段 | intent 数 |
| --- | --- |
| 建立期 | 5 |
| 规划期 | 4 |
| 产出期 | 5 |
| 维护期 | 4 |
| 阅读与修订期 | 2 |

每条 intent 的 namespace 必须以 `intent.` 前缀书写，遵 30 §7.1。

### 2. 元数据列定义

每条 intent 的元数据按以下列固化：

| 列名 | 取值约束 | 来源 |
| --- | --- | --- |
| `namespace` | `intent.<NAME>`，`<NAME>` 为 SNAKE_CASE 大写 | 30 §7.1 |
| `family` | 24 §3 13 family 之一 | 24 §3 |
| `lifecycle_stage` | 28 §3 5 阶段之一 | 28 §3 |
| `risk_class` | `LOW` / `MEDIUM` / `HIGH` / `CRITICAL` | 32 §5 |
| `default_requires_confirmation` | `true` / `false` | 24 §X.5 + 32 §3 |
| `long_run_fit` | `native` / `optional` / `not_recommended` | 24 §X.6 |

`default_requires_confirmation` 是建议默认值，最终由 `approval_policy` 注册时按 32 §5 的 `applies_to_intent_families` + `risk_class` 组合决定；本 ADR 只给基线，不替代 policy 配置。

`long_run_fit` 是建议默认值，最终由 capability registry 与 6 long-run policy 决定；本 ADR 只给基线。

### 3. 首批 intent 清单

#### 3.1 建立期（5 条）

| namespace | family | risk_class | default_requires_confirmation | long_run_fit |
| --- | --- | --- | --- | --- |
| `intent.CREATE_WORK_SEED` | 立项族 | MEDIUM | false | not_recommended |
| `intent.REFINE_WORK_POSITIONING` | 立项族 | MEDIUM | false | not_recommended |
| `intent.DEFINE_WORLDBUILDING` | 世界观族 | HIGH | true | not_recommended |
| `intent.CREATE_MAIN_OUTLINE` | 主线族 | HIGH | true | not_recommended |
| `intent.LOAD_STYLE_SAMPLE` | 风格族 | LOW | false | not_recommended |

来源：24 §5.2 / §6.2 / §7.2 / §14.2；阶段归属来源 28 §4.3。

人物族（24 §13）未进入首批，原因：人物资产需依赖世界观与主线先行建立后才具备充分上下文；首批建立期优先锚定作品根骨架（立项 + 世界观 + 主线 + 风格），人物族（`CREATE_CHARACTER_CANDIDATES` / `REFINE_EXISTING_CHARACTER` / `DEFINE_CHARACTER_ARC` / `UPDATE_CHARACTER_ROLE`）留待扩展批次 ADR 处理；本 ADR §4 扩展纪律允许后续单独 ADR 增补，不需修改本 ADR。

#### 3.2 规划期（4 条）

| namespace | family | risk_class | default_requires_confirmation | long_run_fit |
| --- | --- | --- | --- | --- |
| `intent.SPLIT_INTO_VOLUMES` | 分卷族 | HIGH | true | optional |
| `intent.GENERATE_VOLUME_OUTLINE` | 分卷族 | MEDIUM | false | optional |
| `intent.GENERATE_CHAPTER_OUTLINE` | 章节族 | MEDIUM | false | optional |
| `intent.GENERATE_SCENE_OUTLINE` | 场景族 | MEDIUM | false | optional |

来源：24 §8.2 / §9.2 / §10.2；阶段归属来源 28 §5.3；分卷族 long-run 适配按 24 §8.6 "可支持轻度 long-run"取 `optional`。

#### 3.3 产出期（5 条）

| namespace | family | risk_class | default_requires_confirmation | long_run_fit |
| --- | --- | --- | --- | --- |
| `intent.DRAFT_SCENE` | 场景族 | MEDIUM | false | native |
| `intent.DRAFT_CHAPTER` | 正文族 | HIGH | true | native |
| `intent.CONTINUE_DRAFTING` | 长跑族 | HIGH | true | native |
| `intent.RUN_UNTIL_CHECKPOINT` | 长跑族 | HIGH | true | native |
| `intent.REVISE_DRAFT` | 改稿族 | MEDIUM | false | optional |

来源：24 §10.2 / §11.2 / §12.2 / §15.2；阶段归属来源 28 §6.3；正文族 / 长跑族 long-run 归属来源 24 §11.6 / §15.6。

#### 3.4 维护期（4 条）

| namespace | family | risk_class | default_requires_confirmation | long_run_fit |
| --- | --- | --- | --- | --- |
| `intent.SUMMARIZE_CHAPTER` | 维护族 | MEDIUM | false | optional |
| `intent.UPDATE_STATE_SNAPSHOT` | 维护族 | MEDIUM | false | optional |
| `intent.SCAN_NEW_FORESHADOWING` | 维护族 | MEDIUM | false | optional |
| `intent.SCAN_FORESHADOWING_RESOLUTION` | 维护族 | HIGH | true | optional |

来源：24 §16.2；阶段归属来源 28 §7.3；维护族 long-run 取 `optional`，遵 24 §16.6 "通常作为 hook 或 task 附带运行"。

`SCAN_FORESHADOWING_RESOLUTION` 单独取 `HIGH` 与 `default_requires_confirmation=true`，遵 32 §4 "回收核心伏笔前确认"（approval 常见形式）。

#### 3.5 阅读与修订期（2 条）

| namespace | family | risk_class | default_requires_confirmation | long_run_fit |
| --- | --- | --- | --- | --- |
| `intent.ENTER_READ_MODE` | 阅读族 | LOW | false | not_recommended |
| `intent.REFRESH_READING_PROJECTION` | 阅读族 | LOW | false | not_recommended |

来源：24 §17.2；阶段归属来源 28 §8.3；long-run 适配取 24 §17.6 "通常不需要"。

阅读期改稿入口（`REVISE_DRAFT` 等）已在产出期登记，不在此重复。

### 4. 集合扩展纪律

1. 新增首批 intent 必须走新 ADR；不得由 UI 设计阶段或 capability registry 配置层临时新增 namespace。
2. 新增 intent 必须落在 24 §3 现有 13 family 之一；引入新 family 必须先改 24，再走 ADR。
3. 新增 intent 的 namespace 必须遵 30 §7.1 `intent.<NAME>` 格式；`hook.` 同名条目走 25 维护 hook 路径，不在本 ADR 范围。
4. 修改本 ADR 已冻结 intent 的 `risk_class` / `default_requires_confirmation` / `long_run_fit` 默认值，必须走新 ADR；运行时 `approval_policy` 可在不改本 ADR 的前提下按业务上下文覆盖默认值（见 §5 与 32 §5）。
5. 删除本 ADR 已冻结 intent 必须走 Superseded ADR；不得静默移除。

### 5. 与 approval_policy 的边界

本 ADR 给出的 `default_requires_confirmation` 与 `risk_class` 是**基线**：

1. 32 §5 `approval_policy` 对象通过 `applies_to_intent_families` 与 `risk_class` 字段消费本 ADR 给出的列。
2. 实际运行时是否需要 confirmation 由 `approval_policy.required_user_action` 决定，可比基线更严格也可在低风险路径下放宽。
3. 本 ADR 不冻结任何 `approval_policy_id`，也不冻结 `bypass_policy`。

### 6. 与 capability registry 的边界

本 ADR 不定义 capability 映射、slot schema 与 prompt：

1. capability registry 注册时必须以本 ADR 集合为 namespace 真值表；UI 不得绕过 namespace 直接调 capability。
2. slot schema 留给 W8 / ADR-0010；本 ADR 集合的每条 intent 在 W8 阶段必须有对应 slot 表。
3. context assembly 规则留给 26（已在 README §4 D-07）。

### 7. 与 ADR-0006 card/action 的边界

本 ADR 集合直接喂给 ADR-0006 `ui_card.refs.task_ref` 与 `ui_action.target_ref` 体系：

1. UI 卡片由本 ADR namespace 触发的 intent 产生时，`refs` 中必须能定位 namespace（通常通过 `task_ref` 间接关联）。
2. ADR-0006 §5 `action_type` 与本 ADR namespace 不重叠：`action_type` 是 UI 操作语义，namespace 是 Domain 语义入口。
3. 本 ADR 不新增 `action_type`，不新增 `card_type`，不新增 ADR-0002 `next_action`。

---

## 决策原因

1. UI 设计阶段需要一份**已冻结**的入口清单，否则 `45-guided-conversation-flows.md`（README §5.1）无法落到具体 intent；只把 13 family 名称交给 UI 等于让 UI 自己取舍 namespace，违反 README §6 "UI 不能反向驱动 Foundation / Domain 硬骨"。
2. 5 阶段每阶段 2–5 条覆盖既能反映 28 §3 主循环，又能控制总量在 20 条内，符合 W7 计划上限。
3. 元数据列只取 `risk_class` / `confirmation` / `long_run_fit` 三项，是因为这三项是 capability registry 与 approval policy 在 W8 之前唯一稳定可消费的基线；slot / capability / policy 完整对象会引入跨 ADR 依赖。
4. 维护族单独把 `SCAN_FORESHADOWING_RESOLUTION` 升到 `HIGH`，遵 32 §3 "回收核心伏笔前确认"原文，避免 UI 把所有维护 intent 默认 `MEDIUM` 处理后绕过作者。
5. `intent.` 与 `hook.` 严格分离（24 §16.2），本 ADR 集合全部为 `intent.`；同名 hook 由 25 维护 hook 路径与 W9 / ADR-0007 体系处理。

---

## 影响

### 对 Foundation 的影响

- 给 capability and intent registry（README §3 F-04）一组首批必须注册的 namespace。
- 不修改 ADR-0001 / ADR-0002 / ADR-0003 / ADR-0006 任何字段或枚举。

### 对 Domain 的影响

- 24-novel-intent-catalog.md §5–§17 中被本 ADR 选中的 "代表性 intent" 升级为**首批 UI 必须暴露**集合；未被选中的 intent 保留 catalog 地位，留待后续扩展 ADR 处理。
- 28-authoring-lifecycle.md §4.3 / §5.3 / §6.3 / §7.3 / §8.3 的"主 intent family"在 UI 首批阶段有了具体 intent 落点。
- 32-human-approval-policy.md §5 `approval_policy` 对象在配置时获得首批 intent 的 `risk_class` / `default_requires_confirmation` 基线。

### 对 UI 的影响

- 立项引导、规划面板、产出主工作台、维护 adoption 面板、阅读模式各自获得明确 intent 入口集合。
- 卡片与按钮投影必须使用 ADR-0006 envelope，namespace 仅出现在 `refs` / `target_ref` 间接位置，不出现在 `card_type` / `action_type` 中。
- 引导流（README §5.1 `45-guided-conversation-flows.md`）必须以本 ADR 集合为枚举真值表。

---

## 后续工作

### 必须更新的文档

1. `../00-overview.md` §7
   - 新增 D2-023：首批 UI intent 集合已由 ADR-0008 冻结。
2. `../30-contract-glossary.md` §10
   - 新增条目：首批 UI intent 集合 namespace 表的权威指向 ADR-0008。
3. `0000-index.md` §2.1
   - 新增 ADR-0008 行。
4. `../29-design-integrity-review.md` §7.1
   - 第 7 条 "(待 ADR-0008)" 标注 ✅ 已由 ADR-0008 冻结。
5. `../24-novel-intent-catalog.md` §5–§17 / §24
   - 在每个被选中"代表性 intent"旁标注 `(首批，见 ADR-0008)`；§24 硬骨清单可补"首批 UI 集合由 ADR-0008 冻结"备注。
6. `../28-authoring-lifecycle.md` §4.3 / §5.3 / §6.3 / §7.3 / §8.3
   - 在每段"主 intent family"末尾追加"首批 UI intent 见 ADR-0008 §3"指引。

### 必须补的契约测试

1. capability registry 注册时，`intent.` namespace 必须落在本 ADR §3 集合内，否则视为新增需 ADR。
2. UI `ui_action.target_ref` 中出现的 intent 引用必须落在本 ADR §3 集合内，或被新扩展 ADR 显式追加。
3. `approval_policy.applies_to_intent_families` 配置时，对应 family 至少有一条本 ADR 集合内 intent 命中，否则配置视为悬空。
4. 28 §3 五阶段每阶段在本 ADR §3 中至少有 1 条 intent 覆盖。

### 依赖 ADR

- ADR-0001（W1，TurnResult v2）：本 ADR 集合喂入 `TurnResult.ui_cards[]` → ADR-0006 envelope。
- ADR-0002（W2，state enums）：本 ADR 不新增 `next_action`；intent 完成后的 `next_action` 仍由 ADR-0002 决定。
- ADR-0003（W5，authority / budget / escalation）：`risk_class` 与 `default_requires_confirmation` 基线进入 escalation 路径时由 ADR-0003 校验。
- ADR-0006（W4，card/action）：本 ADR namespace 通过 `refs` / `target_ref` 与 ADR-0006 envelope 关联。

### 后续 ADR / 工单

- W8 / ADR-0010：本 ADR 集合每条 intent 的 slot schema 必须由 W8 给出。
- W9 / ADR-0007：维护族 intent 与同名 `hook.` 的边界由 ADR-0007 进一步处理（本 ADR 不涉及 hook namespace）。

---

## 当前评审状态

当前状态为 **Accepted (2026-04-25)**。

Oracle 评审已通过并覆盖：

1. 集合规模 ≤ 20 条且覆盖 28 §3 五阶段全部主 family。
2. 每条 namespace 在 24 §5–§17 "代表性 intent" 内，无新发明 intent。
3. 每条 intent 的 family / lifecycle_stage 与 24 §3 / 28 §3 命名严格一致。
4. 每条 intent 的 `risk_class` / `default_requires_confirmation` / `long_run_fit` 与 24 §X.5 / §X.6 / 32 §3 一致或有显式偏离说明（仅 `SCAN_FORESHADOWING_RESOLUTION` 升级到 `HIGH`，已在 §3.4 标注理由）。
5. 不引入新 `card_type` / `action_type` / `next_action` / `affordance_kind`。
6. 不冻结 slot schema、capability 映射、approval_policy_id、prompt 与 UI 入口分组。
7. namespace 全部遵 30 §7.1 `intent.<NAME>` 格式；不与 `hook.` namespace 重叠。
8. 回写清单覆盖 `00-overview.md` §7 / `30-contract-glossary.md` §10 / `0000-index.md` §2.1 / `29-design-integrity-review.md` §7.1 / `24-novel-intent-catalog.md` 与 `28-authoring-lifecycle.md` 标注。
9. 集合扩展纪律覆盖新增 / 修改默认值 / 删除三种情况，均要求 ADR。

## enforced_by

- `NovelAgent.IntentRegistry` — 已注册 intent 的 slot schema（当前 CREATE_WORK_SEED，其余 19 个待注册）
