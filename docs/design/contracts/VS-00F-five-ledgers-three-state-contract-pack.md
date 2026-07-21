# VS-00F 五本账与三态对账 Contract Pack

> 状态：**Proposed（2026-07-21，待用户 review 冻结）**
>
> 授权来源：`08-novel-element-model.md` §10（本文冻结其明列的未冻结项 2/3："五本账的对象 schema 与状态机"、"三态对账的触发时机与产物形态"）与 §11.2（提炼数据可用后立项独立 contract pack——前置 VS-00C CP2 章摘要四栏、CP4 章计划结构化均已闭环）。
>
> 上游：`08`（要素模型骨架，E31-E37 / 三态 / 消费面）、`domain/25-maintenance-hooks.md`（提炼钩子与 artifact 信封）、`domain/34-novel-element-field-priority.md`（字段分层原则）、`domain/22-continuity-model.md`（E31/E32 既有账）、`VS-00C`（写作上下文投影与预算信封）、`VS-02A`（tentative artifact）、`VS-04` / ADR-0010（采纳边界）。
>
> 领域拉动实证（2026-07-21 M2 达标跑，101,421 字/75 章）：要角随扩章批漂移（凌渊 ch23 后消失、凌云 ch24-45 昙花一现、沈逸 ch61+ 接管主线）、题材承诺静默漂移（都市赛博修仙→星际歌剧）、正文前指未来章号（信息边界失守）——07-19 复盘"第 30 章开始漂移"预言的完整兑现。缺陷账 Q5 见 `tasks/NEXT.md` 2026-07-21 条目。

---

## 1. 范围与非目标

本 pack 冻结：

1. 五本账（E33 弧光 / E34 冲突 / E35 信息 / E36 情绪曲线 / E37 承诺）的**对象模型与状态机**；
2. **三态对账机制**：触发时机、产物形态、作者裁决路径；
3. 账本的**四个消费面接入口径**（提炼 / 探索 / 写作上下文 / 面板）与不变量。

非目标（不在本 pack）：

- 提炼 prompt 模板与质量（落地 CP 各自负责，走 MBC 探针）；
- 结构面板 UI 设计（`docs/design/ui/` 后续章节）；
- E31 连续性账 / E32 伏笔账的重构（既有对象保留，仅在对账机制中作为同伴账本被引用）；
- 卷级蓝图（NEM-GAP-07，随开新卷动作另立）。

---

## 2. 对象模型：LedgerEntry 统一信封 + 分账 payload

### 2.1 设计选择：一等信封，不建五张表

五本账共用一个 `LedgerEntry` 信封（同 `25` §8 artifact 信封思路）：采纳边界、探索面、面板、trace 只需理解一种对象；分账差异全部收进 `payload`。新增第六种账不改基础设施。

```text
LedgerEntry
  entry_id            全局唯一（NovelFoundation.ID）
  work_ref            所属作品
  ledger              arc | conflict | information | emotion_curve | promise
  subject_kind        character | plotline | fact | chapter | promise
  subject_ref         主体引用（character_id / 冲突线 id / 事实 id / chapter_id / promise id）
  subject_label       主体人读名（面板与 AI 上下文用，冗余但稳定）
  design_ref          设计态锚点（章计划字段 / 卷蓝图 / 大纲条目 / 采纳记录），可 null（实现态先行、设计态待补时）
  status              分账状态机（§2.2-2.6）
  payload             分账明细（§2.2-2.6，JSON，schema 由 codegen SSOT 冻结）
  evidence_refs       [章/场/摘要/采纳记录引用]——账面断言的出处，非空（I-L1）
  last_event_chapter  最近一次账面变动对应的章（漂移检测的时间轴锚点）
  revision            乐观并发
  updated_at / created_at
```

### 2.2 E33 弧光账（ledger=arc, subject=character）

- payload：`arc_design`（设计的变化步序，来自人设/章计划，可为粗粒度文本步列表）、`current_step`、`last_seen_chapter`、`presence_note`（近期戏份走向一句话）。
- status 状态机：`on_track → stalled →（对账裁决）drifted | resumed`；终态 `completed | retired`（角色弧完成/作者明确退场）。
- 漂移信号（对账规则，机器可判部分）：`last_seen_chapter` 落后当前章超过阈值（默认 8 章）且非 `completed/retired` → `stalled` 候选。M2 靶：凌渊 ch23 后消失即命中。

### 2.3 E34 冲突账（ledger=conflict, subject=plotline）

- payload：`line_kind`（main | subplot）、`stakes`（当前赌注一句话）、`progression`（设计的推进节点列表 + 当前节点）、`last_advanced_chapter`。
- status：`active → dormant →（裁决）revived | absorbed | abandoned`；终态 `resolved`。
- 漂移信号：主线 `last_advanced_chapter` 停滞超阈值；或出现无 design_ref 的新主导冲突线（M2 靶：沈逸线 ch61 无设计接管）。

### 2.4 E35 信息账（ledger=information, subject=fact）

- payload：`fact`（一句话事实/秘密）、`reader_knows`（bool + 揭示章）、`character_knowledge`（[{character_ref, knows_at_chapter}]，最小化：只记关键角色）、`planned_reveal`（设计的揭示点，可 null）。
- status：`hidden → partially_revealed → revealed`；异常态 `leaked`（实现态早于设计揭示点，对账产出）。
- 漂移信号：正文出现计划信息的直述（M2 靶：正文前指"第60章将要出现的…"即 planned 信息泄进实现态）。

### 2.5 E36 情绪曲线账（ledger=emotion_curve, subject=chapter）

- payload：`intended`（章计划 E20 情绪定位）、`realized`（章摘要情绪栏提炼）、`delta_note`（偏差一句话，可 null）。
- status：`matched | deviated | unplanned`（无设计态）。每章一条，账面即实际张弛轨迹序列。

### 2.6 E37 承诺账（ledger=promise, subject=promise)

- payload：`promise_kind`（genre | explicit）、`content`（承诺内容："赛博修仙升级爽感" / 角色台词承诺）、`made_at_ref`（作品元信息 / 章 evidence）、`due_hint`（兑现窗口提示，可 null）。
- status：`open → progressing → fulfilled`；异常态 `broken`（对账判定被违背）、`released`（作者明确放弃）。
- 漂移信号：genre 承诺的实现态偏移（M2 靶：题材漂成星际歌剧 = genre promise `broken` 候选）。

### 2.7 权威层与 tentative 层

`LedgerEntry` 是**权威层对象**（作者采纳后的账面事实）。所有机器提炼/对账产物先落 tentative（§3），经 VS-04 采纳边界进入权威层；权威账面只能由采纳动作变更（I-L2）。

---

## 3. 三态对账机制

### 3.1 触发时机（两级节拍）

| 级 | 触发 | 范围 | 产物 |
|---|---|---|---|
| 轻量增量 | 每次正文采纳后（`25` §6.1 默认触发族，新增 `hook.UPDATE_LEDGERS`） | 仅受本章影响的账目（按章摘要四栏 + 章计划映射推导） | `ledger_update_artifact`（待采纳账面更新） |
| 全量对账 | 每 10-20 章（与 `08` 4.4 连续性检查节拍对齐）或作者显式发起 | 全账面 vs 设计态 + 漂移规则扫描（§2 各账漂移信号） | `reconciliation_report_artifact`（对账报告） |

两级都不阻塞采纳主链（异步于 turn；失败登记不静默重试风暴）。

### 3.2 对账报告与处置枚举

`reconciliation_report_artifact` 内容：偏离清单，每项含 `ledger / entry_ref / signal（触发的漂移规则）/ severity（info|warn|critical）/ evidence_refs / proposed_disposition`。

处置枚举（作者裁决，逐项）：

- `revise_design`——改设计迁就正文（如：接受沈逸接管主线，补冲突线设计态）
- `revise_prose`——标记待修订正文（挂修订入口，不自动改）
- `accept_drift`——知情接受，账面记录裁决（不再重复报警）
- `dismiss`——误报，规则反馈（进对账规则的 feedback 循环）

裁决本身是采纳动作（走既有 author_action / adoption 通道），产生账面更新与留痕。**系统在任何处置下都不得静默改写设计态或实现态任何一方**（`08` §9.3）。

### 3.3 提炼数据源（依赖既有闭环，不新增提炼面）

增量提炼的输入 = 章摘要四栏（情节/人物/伏笔/情绪，VS-00C CP2 + parse_sections 结构化入口）+ 章计划 E18-E22（CP4）+ 采纳事件元数据。**CP1 不直接读全文正文**——四栏摘要就是为喂账设计的压缩层（`08` §8.2"一个对象同时喂四本账的最小近似"），不足时先修摘要质量而不是绕过它。

---

## 4. 消费面接入（探索面同步律强制）

| 消费面 | 接入口径 |
|---|---|
| 写作上下文（VS-00C 投影） | 新增账面投影段：按 WritingCoordinate 取"与目标章主体相关的账目"（本章出场角色的弧光条目、活跃冲突线、临近揭示点的信息条目、未兑现承诺 top-N），预算化省略走既有 omission/budget/trace 信封 |
| 探索面（判断循环内部翼） | `archive_read` 新增 `ledgers` 档案面（分账查询）；`08` §8 探索面同步律：账本落地与探索可达**同批收口**，否则账建了 AI 查不到等于没建 |
| 面板/档案 | 作者可见账面视图（后置 CP，front-end 另批） |
| 规划 schema | 卷蓝图/增量规划消费账面（"接着规划"时账面进 planner 上下文——治 M2 扩章批与前文脱节的根） |

---

## 5. 不变量

- **I-L1 证据锚定**：任何账面条目/对账偏离项必须携带非空 `evidence_refs`，且引用真实存在的章/摘要/采纳记录——不可凭空记账（机器可验：随机抽账目回查引用存在性）。
- **I-L2 采纳边界**：权威账面只能经采纳动作变更；提炼/对账产物永远先落 tentative。驱动器断言：对账运行前后权威层无 diff（除经采纳的变更）。
- **I-L3 探索可达**：账本对象落地的同一 CP 内，`archive_read(ledgers)` 必须可查到同一数据（探索面同步律的机器化）。
- **I-L4 漂移可复现**：对账规则对同一账面+同一章窗口的输出确定（规则层不引入模型随机性；模型只参与提炼与叙述，不参与规则判定）。

---

## 6. 现状映射（2026-07-21 代码盘点实底）

| 设计文档说法 | 代码实底 | 对本 pack 的含义 |
|---|---|---|
| E31/E32 既有账（22） | 伏笔/当前状态/关系/规则**全部是 `memory_items` 单表按 `type` 判别**（FORESHADOWING/CURRENT_STATE/RELATIONSHIP/WORLD_RULE…），非一等对象；`timeline_event` **代码中不存在** | 本 pack 不重构它们；`LedgerEntry` 为新一等表（`ledger_entries`），E31/E32 作同伴账在对账报告中被引用。08 §6.1"已覆盖"表述偏乐观，落地以此为准 |
| 章摘要四栏 | `NovelDomain.ChapterSummary`：`@section_order [:plot, :characters, :foreshadowing, :mood]`，`parse_sections/1` 逆变换（缺栏键缺席不伪造）；`ChapterSummaryGenerator` moduledoc 已预留"五本账按维度消费（M3）走本入口" | CP1 提炼输入即 `parse_sections` 的 `:characters` 栏（+`:plot` 栏喂冲突账、`:mood` 喂情绪曲线账、`:foreshadowing` 归 E32 同伴） |
| 采纳钩子（25） | 采纳正文后唯一自动副作用=章摘要维护（`AdoptionWorkflow.maybe_maintain_chapter_summary` → 异步 `BackgroundTaskSupervisor` → 失败降级不阻断 → tentative 生成后**自动 accept**）；角色/记忆写入只随对应类型 artifact 的采纳事务发生 | `hook.UPDATE_LEDGERS` 完全同型接入（异步/容错/降级登记）；自动通过先例见 §3.1 修订 |
| 探索面 | `ExplorationService` `@archive_facets` 现 8 面（profile/characters/foreshadowing/rules/stats/current_state/relationships/preferences)，观察 summary 机械渲染不代笔 | 新增第 9 面 `ledgers`，渲染同样机械 |
| writer 上下文 | `context_text` 五段（目标结构/角色阵容/前章摘要窗/本章前文/作者输入）+ `execution_brief`（VS-00E，经 `tool_input` 独立字段避免污染 stub 三锚点）+ `AssemblyPolicy` 预算（floor 2000/standard 8000/large 200000 chars）+ `OmissionNote` 省略信封 | 账面投影**进 execution_brief 通道**（不进 context_text——沿用"避免 stub 锚点污染"教训）；预算走既有 AssemblyPolicy |
| 对账机制 | 不存在（`ActionIdempotencyLedger`=动作幂等、`AgenticDeviationSignal`=AgentRun 计划偏离、`SchemaDrift`=CI 结构检查，均非作品事实对账） | 绿地；命名避让：对账模块不用 deviation/drift 词根撞 AgentRun 层，用 `LedgerReconciliation` |

### 6.1 §3.1 修订：增量更新的自动通过通道

代码先例（章摘要维护：tentative 生成后自动 accept，25 §9.3 允许低风险结果自动通过）适用于**增量账面更新**：`ledger_update_artifact` 默认自动通过（可追溯、可纠错、SUPERSEDED 链保留），避免作者每章淹没在记账卡片里。**对账报告的处置（§3.2 四枚举）永远需要作者裁决**——自动通过只覆盖"记账"，不覆盖"裁决偏离"。I-L2 相应精确化：权威账面变更=采纳动作 ∪ 登记在案的自动通过通道（同章摘要口径），静默改写仍然禁止。

---

## 7. CP 分期（依据：M2 缺陷映射杠杆 + 数据依赖）

| CP | 范围 | 关闭什么 | M2 验收靶 |
|---|---|---|---|
| CP0 | 本 pack 冻结 + slice 立项 | NEM-GAP-05/06 的契约缺位 | — |
| CP1 | 弧光账最小闭环：LedgerEntry 信封落域/持久化 + `hook.UPDATE_LEDGERS`（仅 arc）+ 弧光漂移规则 + 作者裁决 + `archive_read(ledgers)` + writer 账面投影段（仅出场角色弧光） | E33；信封与采纳边界一次建成 | 用 M2 75 章书重放提炼：凌渊 `stalled` 被账面暴露、凌云/沈逸无 design_ref 接管被报告 |
| CP2 | 承诺账 + 信息账（genre 承诺 + 关键事实最小集）+ 全量对账报告（首版规则：弧光停滞/无设计接管/genre 偏移/计划信息泄露） | E37 / E35 | 题材漂移产出 `broken` 候选；"第60章前指"类泄露被报告 |
| CP3 | 冲突账 + 情绪曲线账（章计划 E20 vs 摘要情绪栏自动对差） | E34 / E36 | 主线停滞与情绪曲线偏差可查 |
| CP4 | 定期对账节拍机器化（每 10-20 章自动产报告）+ 规划消费账面（增量规划带账）+ 面板视图 | 4.4 节拍 + 扩章脱节根治 | 下次百章级狗粮：漂移类缺陷在 30 章内被报告拦截 |

每 CP 遵守承重竖切面（提炼→对账→裁决→消费闭环 + 外部自动化真实页面验收），最小实现步不缩小 CP 验收范围。

---

## 8. 开放问题（冻结前需用户拍板）

1. **信封 vs 分表**（§2.1）：本文选统一 `LedgerEntry` 信封；若倾向五张独立表（查询更直白、schema 更严格）请指出。
2. **CP1 选弧光账**：依据是 M2 最尖锐缺陷（要角消失/接管）；若你认为承诺账（题材漂移）更痛可对调 CP1/CP2。
3. **弧光停滞阈值默认 8 章**：拍脑袋值，CP1 落地时以 M2 书重放数据校准。
4. **对账报告的作者入口形态**（对话流卡片 vs 档案页），影响 CP2/CP4 前端批次，可后置到对应 CP 再定。
