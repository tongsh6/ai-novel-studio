# VS-00F 五本账与三态对账 Contract Pack

> 状态：**Frozen（2026-07-21，用户"开工"授权按 §8 建议默认拍板；逐项可在对应 CP 内凭数据翻案）**
>
> §8 拍板结论：①统一信封（非五表）②CP1 弧光账③停滞阈值 8 章（CP1 以 M2 书重放校准）④裁决 UI 档案页 + correction intent 起步（对话流决策面留 CP2+ 按需修订 ADR-0024）⑤单 ADR（ADR-0026，含自动通过契约化并收编 VS-00C §10 候选 3）。
>
> 授权来源：`08-novel-element-model.md` §10（本文冻结其明列的未冻结项 2/3："五本账的对象 schema 与状态机"、"三态对账的触发时机与产物形态"）、§11.2 与 `VS-00C` §9（"五本账对象化+三态对账"显式 defer 给独立 pack；前置 CP2 四栏摘要/CP4 章计划均已闭环）。关闭缺口：NEM-GAP-05 / NEM-GAP-06。
>
> 上游（先例排查后收全）：`08`（要素骨架/三态/消费面）、`06` §5.0（**continuity ledgers 投影行**——五本账进上下文的既有命名位）与 §10.1/§18（StateTrace）、`domain/25`（hook 家族/维护 artifact 信封/§9.3 自动通过 policy/§10 validator/§14 漂移语义）、`domain/22` §5.1（连续性公共字段词汇）、`domain/34`（字段优先级；§4.13 信息边界字段）、`domain/33`（Experience Engine——误报反馈回路）、`domain/23` §8（feedback_patch，需切割的同词邻居）、`quality/31`（质量门目录——分工表见 §6.2）、`quality/32` §11/§13.1（approval_record/审批风险分级）、`ui/42`/`ui/43`（卡片红线/结构面板模块）、`04a`（checkpoint policy）、`VS-00C` §3.0（**progress_state_packet 槽位**）、`VS-00E` §8（修订机械）、`VS-02A`/`VS-04`（创作 artifact 家族/采纳边界）、ADR-0007/0010/0018/0019/0020/0021/0024/0025、`docs/product/novel-output-milestones.md` §4.4（每 10-20 章连续性检查节拍的产品判据）。
>
> 领域拉动实证（2026-07-21 M2 达标跑，101,421 字/75 章）：要角随扩章批漂移（凌渊 ch23 后消失、凌云 ch24-45 昙花、沈逸 ch61+ 接管主线）、题材承诺静默漂移（都市赛博修仙→星际歌剧）、正文前指未来章号（信息边界失守）——07-19 复盘"第 30 章开始漂移"预言的完整兑现。缺陷账 Q5 见 `tasks/NEXT.md` 2026-07-21 条目。

---

## 1. 范围与非目标

本 pack 冻结：

1. 五本账（E33 弧光 / E34 冲突 / E35 信息 / E36 情绪曲线 / E37 承诺）的**对象模型与状态机**；
2. **三态对账机制**：触发时机、产物形态、作者裁决路径与既有通道的挂接；
3. 账本的**四个消费面接入口径**（提炼 / 探索 / 写作上下文 / 面板）与不变量。

非目标：提炼 prompt 质量（各 CP 走 MBC 探针）；结构面板 UI 视觉设计（归 `ui/43`）；E31/E32 重构（保留为同伴账）；卷级蓝图（NEM-GAP-07 另立）。

**与 ADR-0020 非目标的关系**：ADR-0020 的"不引入情绪曲线 DB 表"限定于 **VS-00E 质量评估层**（不建张力曲线模型做质量判定）；本 pack 的 E36 账是 `08` §4.5 授权的**账本层实现态记录**（intended vs realized 逐章对差），不用于质量门判定，二者不冲突，此处显式注记避免误读。

---

## 2. 对象模型：LedgerEntry 统一信封 + 分账 payload

### 2.1 设计选择：一等信封，不建五张表

五本账共用一个 `LedgerEntry` 信封（同 `25` §8 维护 artifact 信封思路）：采纳边界、探索面、面板、trace 只需理解一种对象；分账差异全部收进 `payload`。新增第六种账不改基础设施。

```text
LedgerEntry
  entry_id            全局唯一（NovelFoundation.ID）
  work_ref            所属作品
  ledger              arc | conflict | information | emotion_curve | promise（分类枚举，lower_snake 对齐 memory_class）
  subject_kind        character | plotline | fact | chapter | promise
  subject_ref         账目主体引用（character_id / 冲突线 id / 事实 id / chapter_id / promise id）
  subject_label       主体人读名（面板与 AI 上下文用，冗余但稳定）
  design_ref          设计态锚点（章计划字段 / 卷蓝图 / 大纲条目 / 采纳记录），可 null（实现态先行）
  status              分账状态机（§2.2-2.6，UPPER_SNAKE 对齐全仓 *_status 约定）
  payload             分账明细（JSON，schema 进 codegen SSOT，见 §7 登记步骤）
  source_refs         [章/摘要/采纳记录引用]——账面断言的出处，非空（I-L1；词汇对齐 22 §5.1 source_ref / 25 §8.2 source_artifact_refs）
  last_event_chapter  最近账面变动对应章（漂移检测时间轴锚点）
  revision            乐观并发
  updated_at / created_at
```

**字段词汇说明**（避免第三套锚点词汇）：`source_refs` 复用 22/25 的 source_* 出处词根；`subject_*` 是**账目主体**（人物/冲突线/事实），语义不同于 22 §5.1 的 `anchor_*`（结构位置锚点：卷/章/场），故不复用 anchor 词根——账目可跨多章，无单一结构锚；`design_ref` 为新词（设计态锚点，先例排查确认无既有对应物）。

**账面的本体论边界（与 memory_items 划界）**：账面是**进度视图**（"设计兑现到第几步"），不是事实本体。事实本体仍在既有层：正文（采纳稿）、章摘要四栏、`memory_items`（CURRENT_STATE/RELATIONSHIP/FORESHADOWING…）、character 主档案。账面**只记进度与状态并引用它们（source_refs），不双写事实**——尤其 E35 信息账不复制 `34` §4.13 已设计给 state_snapshot 的信息边界字段内容，只记"该事实的揭示进度"并引用对应 CURRENT_STATE/摘要条目。

### 2.2 E33 弧光账（ledger=arc, subject=character）

- payload：`arc_design`（变化步序，来自人设/章计划）、`current_step`、`last_seen_chapter`、`presence_note`。
- status：`ON_TRACK → STALLED →（对账裁决）DRIFTED | RESUMED`；终态 `COMPLETED | RETIRED`。
- 漂移信号（确定性规则）：`last_seen_chapter` 落后当前章超阈值（默认 8 章，CP1 以 M2 书重放校准）且非终态 → `STALLED` 候选。M2 靶：凌渊 ch23 后消失。

### 2.3 E34 冲突账（ledger=conflict, subject=plotline）

- payload：`line_kind`（main | subplot）、`stakes`、`progression`（推进节点列表+当前节点；节点词汇对齐 `34` §4.3 main_outline 的推进/转折/高潮/回收节点）、`last_advanced_chapter`。
- status：`ACTIVE → DORMANT →（裁决）REVIVED | ABSORBED | ABANDONED`；终态 `RESOLVED`。
- 漂移信号：主线停滞超阈值；出现无 design_ref 的新主导冲突线（M2 靶：沈逸线 ch61 无设计接管）。

### 2.4 E35 信息账（ledger=information, subject=fact）

- payload：`fact`（一句话）、`reader_knows`（bool+揭示章）、`character_knowledge`（最小化：关键角色 [{character_ref, knows_at_chapter}]）、`planned_reveal`（可 null）。
- status：`HIDDEN → PARTIALLY_REVEALED → REVEALED`；异常态 `LEAKED`（实现态早于设计揭示点）。
- 漂移信号：计划信息直述进正文（M2 靶：正文前指"第60章将要出现的…"）。与 `quality/31` §6.5 knowledge_boundary 门的分工见 §6.2。

> **正账落地修订（2026-08-11，VS00F 刀④ CP1，`tasks/slices/VS00F-information-ledger.md`）**：
> payload 细则冻结为 `schemas/foundation/ledger_information_payload.json`（五本账
> payload 细则首份）。两类条目：伏笔（`foreshadow_<memory_id>`，design_ref=
> `memory_item:<id>`——design_ref 首个真实写入）与章计划信息（`plan_info_<seq>`，
> design_ref=`chapter_plan:<seq>`）。`planned_reveal` 结构化为
> `{kind: chapter|volume|whole_book, seq}`——**预期归伏笔自己，不设全局阈值**
> （用户拍板「有的几章就收，有的贯穿全书」；模型/作者未给即缺席，机器不发明）。
> `reader_knows`/`character_knowledge` 机械层无判定源**刻意不填**（留位不冒充）。
> 回收判定=盘点家族模型提议+作者采纳（CP3），机械匹配与纯人工两案均被用户否决；
> REVEALED 的机械进入路径仅一条：本章正文采纳释放本章计划信息。
> 状态枚举冻结 `schemas/foundation/enums/information_ledger_status.json`。

### 2.5 E36 情绪曲线账（ledger=emotion_curve, subject=chapter）

- payload：`intended`（章计划 E20）、`realized`（章摘要 `:mood` 栏）、`delta_note`（可 null）。
- status：`MATCHED | DEVIATED | UNPLANNED`。每章一条，账面序列即实际张弛轨迹。

### 2.6 E37 承诺账（ledger=promise, subject=promise）

- payload：`promise_kind`（genre | explicit）、`content`、`made_at_ref`、`due_hint`（可 null）。
- status：`OPEN → PROGRESSING → FULFILLED`；异常态 `BROKEN`、`RELEASED`（作者放弃）。
- 漂移信号：genre 承诺实现态偏移（M2 靶：题材漂成星际歌剧 → `BROKEN` 候选）。与 `31` §6.10 serialization_retention 门的分工见 §6.2。

### 2.7 权威层与 tentative 层

`LedgerEntry` 是权威层对象。所有提炼/对账产物先落 tentative，经 `VS-04`/ADR-0010 采纳边界进入权威层；账面条目的采纳状态走 ADR-0019 七态（`foundation/30` canonical），分账 status 是**领域状态机**，与采纳七态正交分层。

---

## 3. 三态对账机制

### 3.1 触发时机（两级节拍）

| 级 | 触发 | 范围 | 产物 |
|---|---|---|---|
| 轻量增量 | 每次正文采纳后——`25` §5 hook 家族扩员 **`hook.UPDATE_LEDGERS`**（UPDATE_ 族命名语义：写状态切面；冻结时同步修订 25 §5） | 仅受本章影响的账目（由章摘要四栏 + 章计划映射推导） | `ledger_update_artifact` |
| 全量对账 | 每 10-20 章（产品判据 `docs/product/novel-output-milestones.md` §4.4；运行节拍挂 `04a` checkpoint_policy 与 `31` §8 checkpoint 聚合语义）或作者显式发起 | 全账面 vs 设计态 + §2 漂移规则扫描 | `reconciliation_report_artifact` |

两个 artifact **登记进 `25` §8.1 维护 artifact 家族**（非 `VS-02A` §2 创作 artifact 家族——后者是 creative capability 工具产物经 ArtifactAssembler，两族不得混淆；冻结时同步修订 25 §8.1），复用 25 §8.2/§25 公共信封字段（`hook_name / source_trigger_ref / source_artifact_refs / proposed_change / requires_adoption / adoption_status / risk_class / auto_adoption_hint`），私有字段走 `proposed_change.payload`。

**与 `continuity_warning_artifact` 的切分**（25 §8.1 既有占位，先例排查确认仅列名未定义）：`continuity_warning` = maintenance **validator 逐项即时冲突**警告（25 §10/§14 语义，事件驱动）；`reconciliation_report` = **周期性批量**的账面 vs 设计态漂移扫描报告。两者不同触发、不同粒度，保留两名；本 pack 冻结时在 25 §8.1 为二者补注语义边界。

**全量对账的运行形态**：新 AgentRun profile **`ledger_reconciliation_v1`**——建立在 `readonly_batch_context_v1`（UA-01/ADR-0023 CP3 已闭环）的只读工具纪律上，区别仅在允许产出恰一个 tentative `reconciliation_report_artifact`；登记进 AgentTaskProfileRegistry；定期化后按 ADR-0021 A20 关联 LongRunTask。两级都异步于 turn 主链、失败降级登记（同章摘要维护先例）。

### 3.2 增量更新的自动通过（首次契约化 25 §9.3 policy）

`ledger_update_artifact` 默认自动通过，依据与边界：

- **形态**：自动通过 = **系统发起的采纳动作**，完整走 `TENTATIVE → ACCEPTED`（ADR-0019 INV-1：进入 ACCEPTED 只能来自 TENTATIVE，留可溯采纳决策），**不是**绕过 TENTATIVE 的直写。
- **门槛**：仅 `risk_class = LOW`（ADR-0007 预留的 `risk_class/auto_adoption_hint` 字段位 + `32` §13.1 风险分级）；账面**状态机转移进入异常/裁决态（DRIFTED/LEAKED/BROKEN…）的更新不属 LOW**，随对账报告走作者裁决。
- **留痕**：权威账面每次变更发 **StateTrace**（`06` §10.1/§18 不变量 9）；业务日志遵循 ADR-0018 `<module>.<step>.<phase>`，module 白名单扩员 `ledger`（`ledger.update.done` / `ledger.reconcile.start|done|error`，携带 turn_id/work_id；冻结时同步修订 ADR-0018 §3 白名单）。
- 本条把 25 §9.3 的一句 policy 首次上升为契约，连同 `VS-00C` §10 未决候选 3（章摘要采纳档位）同批在配套 ADR 冻结（见 §8 问题 5）。

### 3.3 对账报告与处置

`reconciliation_report_artifact` 内容：偏离清单，每项 `ledger / entry_ref / signal / severity（info|warn|critical，与 25 §10.4 validator recommended_action 相邻但不同层：validator 面向单 artifact 采纳前校验，本 severity 面向跨章漂移分级）/ source_refs / proposed_disposition`。

处置枚举（作者逐项裁决）：

- `revise_design`——改设计迁就正文（产设计态修订候选，走既有采纳）
- `revise_prose`——**复用 `VS-00E` §8 修订机械**：sibling-tentative + Orchestrator re-gate，`revision_reason` 挂对账 `entry_ref/signal`（与 quality_finding_refs 并列的第二种修订依据；不新建平行修订引擎，ADR-0020 I1/I4/I5 全守）
- `accept_drift`——知情接受：账面记录裁决（如弧光 DRIFTED→RESUMED with note），同类信号不再重复报警
- `dismiss`——误报：**接入 Experience Engine 既有回路**（`33` §6.3/§11/§12：dismiss → experience_evidence → 聚合成 experience_artifact → review/adoption → 调整对账规则阈值的 policy proposal），**不直接改对账规则**（守 33 §12 与 I-L4）；与 `23` §8 feedback_patch 的 DISMISSED（风格反馈）同词不同层，互不挂接

处置裁决是采纳动作：持久化映射 `32` §11 `approval_record.decision` 既有八枚举 + adoption 主链，**不新造裁决持久化**。裁决的 UI 入口是**决策面**，必须按 ADR-0024 注册纪律入册（现有三卡型无承载物，见 §8 问题 4）；动作唯一来源 `available_actions`（ADR-0007/N-SURF）。系统在任何处置下不得静默改写设计态或实现态（`08` §9.3）。

### 3.4 提炼数据源

增量提炼输入 = 章摘要四栏 `parse_sections`（`:characters`→弧光、`:plot`→冲突、`:mood`→情绪曲线、`:foreshadowing`→E32 同伴账）+ 章计划 E18-E22 + 采纳事件元数据。**CP1 不直接读全文正文**——四栏摘要就是喂账的压缩层（08 §8.2），不足先修摘要质量。

---

## 4. 消费面接入（探索面同步律强制）

| 消费面 | 接入口径 |
|---|---|
| 写作上下文 | **认领 `VS-00C` §3.0 `CreativeDecisionPacket.progress_state_packet` 既有槽**（契约明写"进度态：伏笔账、情绪曲线、承诺账的当前位置"——设计已留、实现未接）；语义对齐 `06` §5.0 `continuity ledgers` 投影行（含其缺失处理：无账本降级为摘要、**不得伪造账本存在**）。按 WritingCoordinate 取相关账目（出场角色弧光/活跃冲突线/临近揭示点/未兑现承诺 top-N），预算与省略走既有 AssemblyPolicy + OmissionNote。物理传输与 execution_brief 同型（tool_input 独立字段，不进 context_text 不碰 stub 三锚点），**不塞进 ProseExecutionBriefV1**（场级 craft 职责，避免 bump 版本） |
| 探索面 | `archive_read` 新增 `ledgers` 第 9 档案面（判断循环内部翼，ADR-0025 框架内扩员），机械渲染口径对齐既有 8 面；探索面同步律（08 §8）：与账本落地同批收口 |
| 面板/档案 | `ui/43` §5 结构面板**第 9 模块**（后置 CP）：遵守 §4 L1-L4 渐进披露、§3/§6 只读+意图边界（修订走 correction intent 回对话流，AU-12 范式） |
| 规划 schema | 卷蓝图/增量规划消费账面（planner 上下文带账——治 M2 扩章批与前文脱节的根，CP4） |

---

## 5. 不变量

- **I-L1 出处锚定**：账面条目/偏离项必须携带非空 `source_refs` 且引用真实存在的对象**，
  或（VS-00G 设计负债规则族）真实执行的缺位查询**——"该建未建"型 finding 的主体是缺位对象，
  无 entry_ref 可挂，source_refs 指向证据侧（统计窗口章/摘要 refs / 空查询口径），仍机器可验。
- **I-L2 采纳边界**：权威账面变更 = 作者采纳动作 ∪ §3.2 定义的系统发起采纳（LOW 风险、TENTATIVE→ACCEPTED 留痕）；静默直写禁止。对账运行本身只读权威层（驱动器断言：运行前后权威层无 diff，除经采纳的变更）。
- **I-L3 探索可达**：账本对象落地的同一 CP 内 `archive_read(ledgers)` 可查同一数据。
- **I-L4 规则确定性**：漂移规则对同一账面+同一章窗口输出确定；模型只参与提炼与叙述，不参与规则判定。规则阈值调整只经 Experience 回路的 policy proposal（33 §12）。
- **设计负债规则族（VS-00G 扩展）**：本框架的对账规则续编 R5-R7（主角未物化/骨架缺位/提前收官）+ R2 收编，对照"应有设计态 vs 设计态缺位"（现有 R1-R4 对照"设计态 vs 实现态"）；同 finding 结构、同处置枚举、同审读渠道，处置"引导物化"为 revise_design 变体，不新增第五枚举。详见 `contracts/VS-00G` §3.2。
- 冻结后按 `00c` §14 回填 atlas：LedgerEntry 进 §4/§6、I-L1~L4 进 §7、CP1 slice 进 §9。

---

## 6. 现状映射与分工

### 6.1 代码实底（2026-07-21 盘点）

| 设计文档说法 | 代码实底 | 含义 |
|---|---|---|
| E31/E32 既有账（22） | 伏笔/状态/关系/规则全在 `memory_items` 单表按 type 判别；`timeline_event` 代码中不存在 | 不重构；`LedgerEntry` 新一等表 `ledger_entries`，E31/E32 作同伴账被对账报告引用 |
| 章摘要四栏 | `ChapterSummary` 四栏 + `parse_sections/1`（generator moduledoc 已预留 M3 消费入口） | §3.4 提炼输入即此 |
| 采纳钩子（25） | 采纳正文后唯一自动副作用=章摘要维护（异步/容错/自动 accept） | `hook.UPDATE_LEDGERS` 同型接入；自动通过契约化见 §3.2 |
| 探索面 | `@archive_facets` 现 8 面，机械渲染 | 加 `ledgers` 第 9 面 |
| writer 上下文 | context_text 五段 + execution_brief（tool_input 独立字段）+ AssemblyPolicy/OmissionNote | 账面投影=progress_state_packet 槽、同通道传输（§4） |
| 对账机制 | 不存在；`ActionIdempotencyLedger`/`AgenticDeviationSignal`/`SchemaDrift` 均非作品事实对账 | 绿地；模块命名 `LedgerReconciliation`，不用裸 Ledger/Drift 词根 |

### 6.2 质量门（31 §6）vs 账本对账分工表（先例排查确认此线从未画过，本 pack 首画）

| 维度重叠 | 质量门（31 §6） | 账本对账（本 pack） |
|---|---|---|
| 弧光（§6.2 character_logic ↔ E33）、信息（§6.5 knowledge_boundary ↔ E35）、伏笔（§6.4 ↔ E32）、情绪节奏（§6.6 ↔ E36）、题材（§6.10 serialization_retention ↔ E37） | **逐产物、采纳前、即时**：对单章草稿做语义诊断，产 quality_finding（可 LLM、作者可越过） | **跨章、周期性、账面级**：对权威账面 vs 设计态做确定性规则对账，产偏离项（I-L4 不用模型判定） |
| 关系 | 门禁拦"这一章写坏了" | 对账拦"这本书走偏了"；门禁的确定性兜底指标不足处（31 §6.12 多为 🟡/🔴 未实现）不由对账补位——两层各自演进，经 Experience 回路互馈 |

---

## 7. CP 分期

| CP | 范围 | M2 验收靶 |
|---|---|---|
| CP0 | 本 pack 冻结 + 配套 ADR（§8 问题 5）+ 同批文档修订：25 §5/§8.1 扩员注记、ADR-0018 module 白名单、ADR-0024 决策面注册（或其修订）、00c 回填、schemas 登记（`foundation/ledger_entry.json` + `enums/ledger.json` + 各 status 枚举，带 x-adr/x-source，入 `schemas/README.md` 索引与 `pnpm codegen:schemas`）、`ui/43` §5 模块清单注记、新 AU 家族立档（AU-13 五本账与对账） | — |
| CP1 | 弧光账最小闭环：LedgerEntry 落域/持久化 + `hook.UPDATE_LEDGERS`（仅 arc）+ 弧光漂移规则 + 增量自动通过 + `archive_read(ledgers)` + progress_state_packet 投影（仅出场角色弧光） | M2 75 章书重放：凌渊 STALLED 被账面暴露、凌云/沈逸无 design_ref 接管被报告 |
| CP2 | 承诺账 + 信息账 + `reconciliation_report_artifact` 首版规则 + 对账裁决决策面（含 revise_prose 挂 VS-00E §8、dismiss 挂 Experience） | 题材漂移产 BROKEN 候选；"第60章前指"泄露被报告 |
| CP3 | 冲突账 + 情绪曲线账（E20 vs `:mood` 栏自动对差） | 主线停滞/情绪偏差可查 |
| CP4 | `ledger_reconciliation_v1` 节拍机器化 + 规划消费账面 + `ui/43` 第 9 模块面板 | 下次百章级狗粮：漂移 30 章内被报告拦截 |

每 CP 遵守承重竖切面；验收家族 AU-13（复用 AU-09 只读档案/work 隔离、AU-05 #11 selection≠adoption、AU-04 #12 确认后重 gate、AU-12 correction intent 口径）。

---

## 8. 开放问题（冻结前需用户拍板）

1. **信封 vs 五张分表**（§2.1）：本文选统一信封；倾向分表请指出。
2. **CP1 选弧光账**：依据 M2 最尖锐缺陷；若认为承诺账（题材漂移）更痛可对调 CP1/CP2。
3. **弧光停滞阈值默认 8 章**：CP1 以 M2 书重放数据校准。
4. **对账裁决 UI 载体（已升级为入册决策，不可后置默认）**：(a) 档案页 + correction intent 范式（43 §3/AU-12，改动最小）；(b) 对话流决策面（需修订 ADR-0024 新增注册行 + 专用驱动字段 + available_actions，现有三卡型无承载物）。建议 CP2 前拍板，倾向 (a) 起步 (b) 后置。
5. **配套 ADR 切分**：一个 ADR 覆盖"账本对象+对账机制+自动通过契约化"（比照 ADR-0020 之于 VS-00E），或拆"账本+对账"与"自动通过通道（并收编 VS-00C §10 候选 3 章摘要采纳档位）"两个。建议单 ADR + 显式小节，避免碎片化。

---

## 9. 先例映射总表（复用 vs 新造，全树排查结论）

| 本 pack 概念 | 判定 | 既有物 / 依据 |
|---|---|---|
| 五本账维度与命名 | **复用** | 08 §4.5 E33-E37 骨架；06 §5.0 `continuity ledgers` 投影行五维列举完全一致 |
| 三态对账机制骨架 | **复用**（授权落地） | 08 §5 + NEM-GAP-06（"未被表述为机制"的公认缺口） |
| LedgerEntry 对象 schema/状态机 | **新造**（授权） | 08 §10 未冻结项 2；字段词汇对齐 22/25（source_refs），subject_*/design_ref 为有理由新词 |
| E35 payload | **半复用** | 34 §4.13 state_snapshot 信息边界字段为事实本体；账面只记揭示进度并引用，不双写 |
| `hook.UPDATE_LEDGERS` | **复用惯例** | 25 §5 UPDATE_ 族语义 + §7/§8/§9 机制 |
| `ledger_update_artifact` / `reconciliation_report_artifact` | **新造，入既有家族** | 登记 25 §8.1 维护家族（非 VS-02A 创作家族）；复用 §8.2/§25 公共信封；与 `continuity_warning_artifact` 切分口径本 pack 冻结 |
| 自动通过通道 | **首次契约化既有 policy** | 25 §9.3 + ADR-0019 INV-1 + ADR-0007 risk_class/auto_adoption_hint + 32 §13.1；收编 VS-00C §10 候选 3 |
| 处置四枚举 | **新造（作者面漂移裁决轴）** | 叠在 ADR-0019 七态与 32 §11 approval_record 之上；`revise_prose` 复用 VS-00E §8；`dismiss` 复用 33 Experience 回路；与 23 §8 feedback_patch 切割 |
| 每 10-20 章节拍 | **复用产品判据** | `docs/product/novel-output-milestones.md` §4.4；运行形态挂 04a checkpoint_policy + 31 §8 |
| 全量对账运行形态 | **复用+扩** | `readonly_batch_context_v1` 只读纪律 + 允许产 1 tentative 报告 = 新 profile `ledger_reconciliation_v1`；ADR-0021 A20 |
| 账面投影 | **复用既有槽** | VS-00C §3.0 progress_state_packet（设计已留实现未接）+ 06 §5.0 缺失处理；传输通道同 execution_brief 工程口径 |
| `archive_read(ledgers)` | **框架内扩员** | ADR-0025 内部翼 + 既有 8 面机械渲染口径 |
| 面板视图 | **复用消费面** | 08 §7"面板=进度态账本"+ ui/43 §5 第 9 模块 + L1-L4/只读边界 |
| trace/日志 | **复用** | StateTrace（06 §10.1/§18#9）+ ADR-0018 命名（module 白名单扩员 `ledger`） |
| 质量门分工 | **新画线** | 31 §6 五处维度重叠此前无分工表述，§6.2 首画 |
| 验收 | **新 AU 家族** | AU-13（AU-09/AU-12 边界已封不可挂靠）；复用四组既有不变量口径 |
