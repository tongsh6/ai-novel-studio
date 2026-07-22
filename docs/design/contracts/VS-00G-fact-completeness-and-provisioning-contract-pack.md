# VS-00G 承重事实完备性与补全回路 contract pack

> 状态：**Proposed**（开放问题见 §8，冻结前不编码）
>
> 授权来源：M3 节拍狗粮审计三病灶（收官循环/地基事实真空/创作锚在场但无效，
> `tasks/NEXT.md` 2026-07-22 审计节；证据 `artifacts/novel-output/p1-100k-dogfood/m3-audit-2026-07-22.txt`）
> + `notes/2026-07-22-prompt-as-function-of-state.md`（方向定型与两项用户拍板：工作假定层全要素
> 开放、盘点触发 A+B+C）+ `08` §10 未冻结项与 §8 序位 4/6 的"随创作动作提出时冻结"授权。
>
> 三条基准纪律适用：场景化验收红线（AGENTS.md）；地板档 forcing function；
> **狗粮 runner 不是用户画像**——本包每个对象附「真实作者问句」，百章标本只做验证靶不做参数来源。

---

## 1. 范围与真实作者问句

| 对象 | 真实作者问句（答不出即砍） |
|---|---|
| 承重事实清单 | 作者说"写下一章"时，系统怎么知道这次写作缺了什么关键设定、缺了该怎么办？ |
| 缺席守则 | 作者还没建主角档案就开写（完全正常的起步方式），AI 凭什么不乱立主角？ |
| 设计负债规则 | 作者写了几十章沉浸在剧情里，谁提醒他"你的主角团还没登记、书还没有骨架"？ |
| 设定盘点 | 作者自由写作/接手旧稿后想把设定整理成档案，谁替他从正文里捞出来？ |
| 工作假定 | 作者没空整理档案但还想继续写，AI 的合理猜测怎么既生效又不冒充事实？ |
| 全书骨架 | 网文作者本来就有"这书写多长、怎么连载"的意图，产品哪里让他说、说了怎么起效？ |

非目标：卷级蓝图完整对象化（E14-E17，NEM-GAP-07——本包只落全书骨架消费面，卷蓝图仍按
08 §8 序位 6 待"开新卷"创作动作提出）；存量书稿导入（全库零先例，独立能力另立，见 OQ7）；
prompt 体系化静态维（目录/骨架/口径库，归 `UA01-agentic-loop-prompt-hardening`）。

---

## 2. 对象

### 2.1 承重事实清单（CapabilityFactManifest）

每个创作能力声明其承重事实（08 要素模型在执行层的投影视图；NEM-GAP 表是文档级静态负债，
manifest 是运行时逐作品动态判定——两账切分）：

| 能力 | required（缺失须处置） | recommended（缺失记录） |
|---|---|---|
| prose_writing | 视角/主角（narrative_role=PROTAGONIST 或活跃假定）、目标章设计（E18-E22） | 出场阵容、卷弧目标、题材锚（E03）、全书骨架 |
| plot_outline | 全书骨架、题材锚、主角 | 阵容、最近摘要窗、五脉摘要 |
| character_design | 现有阵容 | 主线冲突、题材锚 |
| world_building | 题材锚、premise | 既有规则集 |

- 每项事实声明：`element_ref`（08 要素编号）、`presence_query`（机械查询口径）、
  `on_absent`（缺席守则 ref 或 MissingPolicyResult 档位）、`on_unbuilt`（负债规则 ref）。
- **判定机制不另立**：完备性判定作为 `MissingPolicyResult`（VS-00C §3.0.3）的类别扩展
  （新增 `design_missing` 缺失类别），沿用其四档严重度与"provider 调用前系统判断"的时序
  （VS00C-I9 统一决策不变量继续成立）。挂载=判断纪元机械准备步（ADR-0025 "机械准备
  判据：输出对相同输入恒定、不含创作判断"——manifest 对照查询恒定，合格）。

### 2.2 缺席守则（AbsenceDirective）

承重事实缺席时注入的**正向文本**（缺席声明+行为守则），与 OmissionNote（记录"没带什么"）
互补而非替代。例（主角缺席）：

> 本作品尚未确立主角档案：延续既有视角人物写作，不得另立新主角、不得让新角色接管主线。

- 守则文案为**预定义模板**（机械域内，不问模型；ADR-0025 边界注记：模型现场生成守则即出
  机械域，禁止）；归"系统口径文案"层（ui47 §2.3 第 3 层）+ 模型口径库（UA01 架构层落地前
  暂放各注入点常量，登记迁移）。
- 与 06 §5.0 `absent`（"必须明示缺失"）语义一致，是其守则化升级；写入 06 §5.0 修订（§10）。

### 2.3 工作假定（WorkingAssumption）【已拍板：全要素开放】

AI 分析产出、作者未确认、显式标注后可注入上下文的一等对象。

- 字段：`assumption_id / work_id / element_ref / subject_label / value / basis_refs（非空，
  分析依据：章/摘要/统计）/ status / proposed_at / injected_since / confirmed_or_rejected_at`。
- **状态机（第三套，显式并列声明——ADR-0019 L25 "两套独立状态机不可混用"先例扩展）**：
  `PROPOSED → ACTIVE（注入中）→ CONFIRMED | REJECTED`；终态后不再注入。
- **三防护（逐条硬性）**：①显式标注——注入文本以"【待确认假定】"前缀+依据摘要，模型与
  作者双侧可见；②作者一键确认/否决——确认=系统产对应 TENTATIVE 提案走采纳边界
  （**INV-1 内：确认绝不直写 ACCEPTED**），否决=REJECTED 作废；③寿命追踪——ACTIVE 超
  N 章未决出负债 finding 催办（N 策略化，默认待 OQ3）。
- **一致性**：同批假定机械校验互不矛盾（盘点产出时）；与既有 canon 冲突的假定不得进入
  PROPOSED（canon 优先）。
- **语义切分（先例排查发现的三处同词冲突，冻结即写死）**：
  - 与 `CreativeOutputSelfReport.assumptions`（VS-00C §3.0.4，写后自报告线索）同名不同物：
    自报告可作为盘点/假定的**候选来源**之一，但不自动成为 WorkingAssumption；
  - 与 06 §5.5 `requires_confirmation`（未确认**材料**不纳入上下文）切分：assumption 不是
    材料，是显式标注的系统判断——本包为其开专用注入通道，突破授权=2026-07-22 用户拍板；
  - 与 AU-09"未采纳候选不写记忆"红线兼容：**假定注册表不落 memory_items**（独立存储），
    不进普通召回，不进探索面记忆五面（专属可达面见 §4）。

### 2.4 全书骨架（WorkSkeleton）

works 表第二批创作向字段（CA01 先例全链复制：migration+cast+normalize_attrs 白名单+
profile/work_snapshot 投影+判断 call1 nil 过滤+探索面 profile 渲染——CA01 CP1 记录为
接入点清单 SSOT）。字段名沿用 `34` §4.1 既有设计清单（唯一先例）：

- `target_length`（目标字数；产品判据对齐 milestones §3 阶梯）
- `planned_volumes`（预计卷数）
- `serial_form`（连载形态：连载/买断/短篇集等，自由文本+建议值）

消费（CA01"在场但无效"判例的直接修正——**字段在场≠守则生效，必须做成规则+决策点邻近注入**）：
- 规划期强制注入：全书骨架段+当前进度位置（"当前 N/M 章，全书 P%"）+
  **收官守则**（预定义指令式文案："距目标体量尚远，本批不得规划终局/收官章；收官只允许
  在作者明示或达到目标体量后"）——位置=规划 prompt 决策点邻近（六段骨架⑤位）；
- 负债规则消费（§3.2 R6/R7）；
- 探索面 profile 面三行（同步律同批）。

---

## 3. 机制

### 3.1 完备性判定（机械准备步扩展）

```
能力执行前（机械，0 调用）：
  manifest[capability] 逐项 presence_query
    → 在场：常规注入（VS-00C 分层+预算不变）
    → 缺席且有守则：注入 AbsenceDirective（预定义文案）
    → 缺席且 required 达 block 档：MissingPolicyResult 现有 block/confirm 通道
    → 该建未建（对象类事实从未物化）：记 design_missing（进 trace；负债规则消费）
  活跃假定（ACTIVE）：以【待确认假定】标注注入对应事实槽位
```

### 3.2 设计负债规则族（三态对账扩展：对照"应有设计态 vs 设计态缺位"）

沿用 VS-00F §3 规则框架与 finding 结构（rule/ledger/severity/signal/source_refs/
proposed_disposition），编号续接（R2 收编落地）：

| 规则 | 判定（确定性，I-L4） | 处置方向 |
|---|---|---|
| R2 无设计接管（收编） | 近窗高频出场人物 ∉ roster（依据=章摘要人物栏统计） | 引导物化（盘点该人物）或 revise_prose |
| R5 主角未物化 | 已写章数 ≥ 阈值 且 无 narrative_role=PROTAGONIST 且无 ACTIVE 主角假定 | 引导物化（盘点/立项流） |
| R6 骨架缺位 | 已写章数 ≥ 阈值 且 target_length 空 | 引导补立项（对话流确认目标体量） |
| R7 提前收官 | 进度 < 阈值% 且 近窗章计划含终局/收官功能定位密度异常 | revise_design（调整规划）或作者确认收束 |

- **I-L1 措辞修订**（§10）："引用真实存在的对象"扩为"引用真实存在的对象**或真实执行的
  缺位查询**（负债 finding 的 source_refs=证据侧：统计窗口章/摘要 refs/空查询口径）"。
- 阈值全部策略化（不从狗粮书标定；默认值来源=milestones 产品判据推导或 Experience 回路，
  I-L4 阈值调整路径不变）。
- 处置四枚举复用；`引导物化` 落为 revise_design 的引导变体（处置动作携带盘点入口），
  不新增第五处置（OQ5 确认）。

### 3.3 设定盘点（fact_inventory run）【已拍板触发 A+B+C】

- 运行形态：`fact_inventory_v1` AgentRun profile，照抄 `ledger_reconciliation_v1` 壳
  （readonly 纪律+模型只起草计划；区别：**提炼环节是创作判断，模型参与**——盘点=模型读
  现状材料提炼设定提案，机械环节负责材料装配与提案集校验）。产出恰一个 tentative
  **设定提案集**。
- 提案集内容=**既有 seed artifact 家族**（06 §4.5.2 映射零新增）：`character_seed`（含
  narrative_role 建议）/`world_rule_seed`/`foreshadowing_seed`/`style_rule_seed`/
  `constraint_seed`；另可含全书骨架字段建议与工作假定候选（见 OQ4）。
- 逐项采纳：复用 `TentativeArtifactSet.adoptable_units`，`per_candidate_type?` 白名单从
  character_seed 扩到全 seed 家族（收编 user-journeys H13"伏笔/规则逐项采纳扩展"登记）。
- 交互：45§2 引导流（候选+确认收束）与 §4.3"读文本→提取→确认卡"先例；提炼先例=
  ChapterSummaryGenerator（失败容忍+独立 prompt+采纳边界）。
- 触发：A=负债 finding 处置动作；B=面板"发起设定盘点"（底部动作条范式）；C=对话流自动
  提议（同一缺失只提一次、可关闭）。A+B 先行。
- AU-12 world_setting 物化 P2 债在本包收编：盘点提案采纳后按 06 §4.5 映射落位；works
  字段类提案（骨架/创作锚）落位=立项字段回写（该债的正向链路）。

### 3.4 假定生命周期

```
盘点/分析产出 → 一致性校验 → PROPOSED（面板待确认假定区可见）
作者无动作 + 系统需要 → ACTIVE（开始注入，【待确认假定】标注）
作者确认 → 产对应 TENTATIVE 提案 → 采纳边界 → canon；假定转 CONFIRMED（停止注入，事实接管）
作者否决 → REJECTED（停止注入；同一 element 不自动重提）
ACTIVE 超龄 → 负债 finding 催办（审读报告渠道）
```

PROPOSED→ACTIVE 是否需作者显式放行：见 OQ2（默认建议：required 事实的假定自动 ACTIVE
并即时通知，recommended 事实的假定等作者放行）。

---

## 4. 消费面（探索面同步律逐条答）

| 面 | 接入 |
|---|---|
| 写作/规划 prompt | §3.1 判定输出（守则/假定标注/骨架段）经既有 context 通道注入 |
| 判断 call1 | 骨架字段随 work section 自动投影（CA01 通道） |
| 探索面 | 假定注册表+负债 finding 探索可达：扩员 `assumptions` 第 10 面（ledgers 第 9 面
  扩员全路径复制：facet 守卫→渲染→消费面表登记→00c 回填）；**顺手修复既有缺陷：
  `query_help` 字串仅列 8 面漏 ledgers（模型看不见第 9 面）** |
| 面板 | 待确认假定区（AU-12"待确认"范式复用）+负债 finding 进审读报告卡（既有载体）；
  AU-12/AU-13 边界重画见 §6 |
| trace | design_missing 与假定注入进 trace_summary（why 可解释） |

---

## 5. 不变量

- **I-G1 判定机械性**：manifest 判定与负债规则对同一数据现状输出恒定；模型不参与判定
  （参与的只有盘点提炼与守则外的叙述）。
- **I-G2 假定非权威**：WorkingAssumption 任何状态都不进 canon/档案权威区/记忆召回；
  转正唯一路径=作者确认→TENTATIVE→采纳（ADR-0019 INV-1）。
- **I-G3 标注完整性**：ACTIVE 假定注入必带【待确认假定】标注与依据；无标注注入=违约
  （机器可验：prompt 采样断言）。
- **I-G4 缺席不虚构**：缺席守则只声明缺席与行为约束，不得包含具体设定内容（有内容=该走
  假定或提案通道）。
- **I-G5 提案零新径**：盘点提案集只使用既有 artifact 家族与既有采纳边界；无新写入通道。
- **I-G6 探索可达**：假定注册表/负债 finding 与对象落地同批探索可达（08 §8）。
- 修订：VS-00F I-L1 措辞扩展（§3.2）。

---

## 6. 验收家族

建议：**扩展 AU-13**（负债规则=审读扩展，场景续 SC-AU13-D*）+ **新立 AU-14**（盘点与假定
——作者补全回路，与 AU-9/12/13 四方边界：记忆事实/立项档案/进度账面/**补全提案与假定**）。
待 OQ6 拍板。场景草案（随 CP 立档）：

- SC-AU14-A1：空档案书写至 N 章 → 负债 finding（主角未物化）→ 处置"发起盘点" → 提案集
  → 逐项采纳 → 弧光账开始记账（地基真空病例的产品级修复回路全链）。
- SC-AU14-A2：盘点提案未采纳期间 → 主角假定 ACTIVE → 写作 prompt 带【待确认假定】→
  作者否决 → 注入消失、写作回缺席守则。
- SC-AU13-D1：骨架缺位 finding → 对话流补目标体量 → 规划 prompt 带骨架段+收官守则 →
  扩章批不再产终局章（百章标本重放先证）。

---

## 7. CP 路线（每 CP 百章标本重放验证靶；标本只验不标定）

| CP | 内容 | 标本重放靶 |
|---|---|---|
| CP0 | 本包冻结+配套 ADR+同批修订（§10）+AU 立档 | — |
| CP1 | manifest+MissingPolicyResult 扩展+缺席守则（prose/plot_outline 两能力先行） | 重放：空 roster 书的 prose 请求注入主角缺席守则 |
| CP2 | 负债规则族 R2/R5/R6/R7+审读报告渠道+处置引导 | 重放：标本在 ch10 即产"主角未物化"、ch12 计划批产"提前收官" finding |
| CP3 | 全书骨架字段+规划注入+收官守则 | 重放：扩章 prompt 带骨架段（对照实验：终局标题密度） |
| CP4 | 盘点 run+提案集+逐项采纳扩展+触发 A/B | 标本盘点：提案含主角团+世界规则，采纳后弧光账就位 |
| CP5 | 假定注册表+注入+面板假定区+触发 C | SC-AU14-A2 |

---

## 8. 开放问题（冻结前拍板）

- **OQ1 manifest SSOT 载体**：契约文档表（本包 §2.1，代码 module attr 镜像）vs
  `docs/design/schemas/` JSON（codegen）。建议：首版契约表+代码镜像，稳定后 schema 化。
- **OQ2 假定 PROPOSED→ACTIVE 放行**：全自动（提案即注入）vs 分级（required 自动+
  recommended 等作者）vs 全手动。建议：分级。
- **OQ3 阈值默认值**：R5/R6 章数阈值、假定寿命 N 的默认（建议 R5=10 章、R6=20 章、
  寿命=10 章，来源=milestones §4.4 节拍推导，非狗粮标定）。
- **OQ4 盘点提案集是否含"骨架字段建议+假定候选"**（即盘点一次产三类：档案提案/字段建议/
  假定）vs 只产档案提案。建议：含（一次盘点全补）。
- **OQ5 "引导物化"处置形态**：复用 revise_design 携带盘点入口 vs 新增第五处置枚举。
  建议：复用（不动 VS-00F 四枚举）。
- **OQ6 验收家族切分**：AU-13 扩展+新立 AU-14（建议）vs 全挂 AU-13。
- **OQ7 用户可见命名**：盘点=「设定盘点」（已用）；WorkingAssumption 用户可见词——
  建议「暂定设定」（待确认假定区=「暂定设定」区）；全书骨架=「连载蓝图」或「全书规划」。
- **OQ8 存量书稿导入**：全库零先例的新能力（粘贴/上传旧稿→分章→盘点建档）。建议：
  本包不做，登记独立 slice（盘点是它的核心引擎，先把引擎建好）。

---

## 9. 复用 vs 新造先例映射总表（三路排查产出，出处见各 sweep 记录）

| 构件 | 判定 | 先例 |
|---|---|---|
| 完备性判定 | **复用+扩** | VS-00C MissingPolicyResult 四档+VS00C-I9；ADR-0025 机械准备判据 |
| 缺席守则 | **新造（有语义先例）** | 06 §5.0 absent"明示缺失"；narrative_role"诚实报缺口不默认第一角色"；探索面"诚实缺席"文案 |
| 负债规则族 | **复用框架+扩规则** | VS-00F §3 finding 结构/处置枚举/审读渠道；R2 收编；I-L1 措辞修订 |
| 盘点 run | **复用壳** | ledger_reconciliation_v1+start_full_review 范式；ChapterSummaryGenerator 提炼先例 |
| 提案写入 | **纯复用** | 06 §4.5.2 seed 映射全套；VS-04 system action 来源位；ADR-0019 INV-1 |
| 逐项采纳 | **复用+白名单扩** | adoptable_units（Order53）；H13 登记收编 |
| 盘点交互 | **复用** | 45§2 引导流+§4.3 读文本→提取→确认卡 |
| 假定注册表 | **新造（声明第三状态机）** | ADR-0019 L25 多状态机并存先例；AU-12"待确认"面板范式；转正走既有采纳 |
| 假定语义切分 | **切分 ×3** | CreativeOutputSelfReport.assumptions（同名不同物）/06 §5.5 requires_confirmation（材料 vs 假定）/AU-09 不写记忆红线（假定不落 memory_items） |
| 全书骨架字段 | **复用清单+CA01 链路** | 34 §4.1 目标字数/预计卷数/更新频率（唯一设计先例）；CA01 接入点清单 |
| 收官守则 | **新造** | "收官/连载形态/目标体量"设计树零先例；"终局"与 ADR-0023/0024 run 语义同词异义（切分） |
| 探索面扩员 | **复用路径** | ledgers 第 9 面全路径；顺手修 query_help 8/9 面缺陷 |
| AU-12 P2 债 | **收编** | world_setting 物化回 works 字段（四处登记） |

---

## 10. 冻结时同批修订清单（比照 ADR-0026 :63 先例）

- `08-novel-element-model.md`：§4.1 增全书骨架要素（或 NEM-GAP-08 登记）+§6.2 表更新+
  §8 序位注记（序位 4 扩批/序位 6 部分提前）；
- `VS-00C`：§3.0.3 MissingPolicyResult 增 design_missing 类别+§3.1 L3/L4 注记假定标注层；
- `VS-00F`：§3 负债规则族续编+I-L1 措辞修订+处置"引导物化"变体注记；
- `06`：§5.0 缺失枚举语义注记（absent 守则化）+§5.5 requires_confirmation 与假定切分注记+
  §4.5 盘点提案来源注记；
- `00c-state-and-contract-atlas.md`：对象/不变量/事件回填；
- `ADR-0018`：module 白名单（assumption/inventory 事件族）；
- 验收：AU-13 扩展 D 系+AU-14 立档（OQ6 定后）+author/README 边界行；
- `ui/43`：面板假定区/盘点动作注记；`ui/47`：新用户可见词（OQ7 定后）。
