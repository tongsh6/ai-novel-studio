# VS-00G 承重事实完备性与补全回路 contract pack

> 状态：**Frozen**（2026-07-22 用户拍板 OQ2/OQ4/OQ6/OQ7，其余取建议默认；§8 记裁决）
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
| prose_writing | 视角/主角（narrative_role=PROTAGONIST 或暂用态主角）、目标章设计（E18-E22） | 出场阵容、卷弧目标、题材锚（E03）、全书骨架 |
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

### 2.3 工作假定（既有对象的"暂用"态，非新实体）【已拍板：全要素开放】

**设计原则（2026-07-23 用户拍板"慎重新增实体"）**：工作假定不是新对象/新注册表，
而是**既有结构化实体的 `tentative` 态 + 来源标注 + 暂用标记**。既有实体本就带
AdoptionStatus 状态机（tentative→accepted/discarded）与多维字段，消费侧现在只是
硬过滤 tentative（如 `WorkArchiveRepo.characters` 只读 accepted）——假定=复用其
tentative 态并为其开一条"可标注注入"读取通道。**新增实体数=0**。

承载映射（按要素落到既有实体，非新建）：

| 假定的要素 | 承载实体 | 形态 |
|---|---|---|
| 主角/视角、阵容 | `Character` | `status=tentative` + `narrative_role` + 来源=ai_assumption |
| 目标体量/连载形态/创作锚 | `works` | 字段值 + `status=tentative`（works.status 本默认 tentative） |
| 世界规则/伏笔/风格（记忆类） | 见下"记忆类特殊处理" | — |

- **两处最小改动**（不动存储结构，除来源标注字段）：
  1. **来源/暂用标注**：既有实体加 `provisional_source`（如 `ai_assumption`，区分"AI 假定"
     vs"作者候选"）与 `provisional_active`（是否正在注入）——加字段而非加表（阶梯第 2 步）；
  2. **可标注注入通道**：消费侧从"硬过滤 tentative"改为"可注入 tentative 但带【暂定】标注"
     ——改一处读取逻辑（阶梯第 3 步），存储不动。
- **生命周期=既有 AdoptionStatus 状态机，不新建第三套**：
  `tentative（provisional_active）→ 作者确认 = accepted（就地转正，连"产新 TENTATIVE 提案"
  都省）｜作者否决 = discarded`。转正落在 ADR-0019 INV-1 内（canon 只从 tentative 进入）。
- **三防护（逐条硬性，语义不变）**：①显式标注——注入文本【暂定】前缀+依据，模型与作者
  双侧可见；②作者一键确认（就地 accepted）/否决（discarded）；③寿命追踪——
  provisional_active 超 N 章未决出负债 finding 催办（N=10，OQ3）。
- **一致性**：同批假定机械校验互不矛盾（盘点产出时）；与既有 accepted canon 冲突的假定
  不得置 provisional_active（canon 优先）。
- **假定 vs 盘点候选=同一 tentative 对象的两种意向**（先例排查后的收敛）：盘点候选=
  tentative 且 `provisional_active=false`（等采纳，不注入写作）；工作假定=tentative 且
  `provisional_active=true`（未采纳但已注入，带【暂定】）。二者不是两类实体，是一个
  tentative 对象的一个布尔位。
- **记忆类特殊处理（AU-09 红线保留）**：世界规则/伏笔/风格属记忆类，AU-09"未采纳候选不写
  记忆"红线对 memory_items 有效——记忆类假定**不写 memory_items**，其暂用值以**注入层
  临时材料**形态存在（缺席守则的富化变体：带【暂定】的一段文本，随注入产生随 turn 消失，
  不落持久层），确认时才走 seed 采纳落 memory。即：Character/works 类假定=持久对象 tentative
  态；记忆类假定=注入期临时文本。两类都不新建实体。
- **语义切分（先例排查三处同词冲突，保留）**：
  - 与 `CreativeOutputSelfReport.assumptions`（VS-00C §3.0.4 写后自报告）同名不同物：
    自报告可作候选来源，不自动成为暂用态；
  - 与 06 §5.5 `requires_confirmation`（未确认材料不纳入）切分：暂用态是显式标注的系统
    判断非普通材料，本包为其开可标注注入通道（突破授权=2026-07-22 用户拍板）；
  - 与 AU-09 红线：见上"记忆类特殊处理"。

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
  暂用态对象（provisional_active）：以【暂定】标注注入对应事实槽位
```

### 3.2 设计负债规则族（三态对账扩展：对照"应有设计态 vs 设计态缺位"）

沿用 VS-00F §3 规则框架与 finding 结构（rule/ledger/severity/signal/source_refs/
proposed_disposition），编号续接（R2 收编落地）：

| 规则 | 判定（确定性，I-L4） | 处置方向 |
|---|---|---|
| R2 无设计接管（收编） | 近窗高频出场人物 ∉ roster（依据=章摘要人物栏统计） | 引导物化（盘点该人物）或 revise_prose |
| R5 主角未物化 | 已写章数 ≥ 阈值 且 无 accepted narrative_role=PROTAGONIST 且无暂用态主角 | 引导物化（盘点/立项流） |
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

### 3.4 假定生命周期（既有 AdoptionStatus 状态机 + 布尔位，不新建）

```
盘点/分析产出 → 一致性校验 → tentative 对象落库（Character/works；provisional_source=ai_assumption）
                              面板「暂定设定」区可见（tentative 且 provisional_active=false）
系统需要 + 分级放行（OQ2）  → provisional_active=true（开始注入，【暂定】标注）
作者确认              → status=accepted（就地转正，canon 接管；ADR-0019 INV-1 内）
作者否决              → status=discarded（停注入；同一要素不自动重提）
provisional_active 超龄 → 负债 finding 催办（审读报告渠道）
```

放行分级（OQ2 拍板）：required 事实（如主角）的假定自动 provisional_active+即时通知；
recommended 事实的假定等作者放行。记忆类假定无持久态，直接在注入期以【暂定】文本存在，
确认时走 seed 采纳落 memory。

---

## 4. 消费面（探索面同步律逐条答）

| 面 | 接入 |
|---|---|
| 写作/规划 prompt | §3.1 判定输出（守则/假定标注/骨架段）经既有 context 通道注入 |
| 判断 call1 | 骨架字段随 work section 自动投影（CA01 通道） |
| 探索面 | 暂用态角色随 characters 面按标注呈现（既有 facet 加"含暂用"视图，不新增面）；
  负债 finding 进审读渠道；**顺手修复既有缺陷：`query_help` 字串仅列 8 面漏 ledgers
  （模型看不见第 9 面）** |
| 面板 | 「暂定设定」区=既有档案面板按 tentative+provisional 过滤出的视图（AU-12"待确认"
  范式复用，非新面板对象）+负债 finding 进审读报告卡（既有载体） |
| trace | design_missing 与假定注入进 trace_summary（why 可解释） |

---

## 5. 不变量

- **I-G1 判定机械性**：manifest 判定与负债规则对同一数据现状输出恒定；模型不参与判定
  （参与的只有盘点提炼与守则外的叙述）。
- **I-G2 假定非权威**：暂用态（tentative 且 provisional_active）的对象不算 canon——
  档案权威区/记忆召回/写作事实层只认 accepted；暂用态仅经【暂定】标注通道注入。
  转正唯一路径=作者确认→status=accepted（ADR-0019 INV-1，就地转正）。
- **I-G3 标注完整性**：ACTIVE 假定注入必带【暂定】标注与依据；无标注注入=违约
  （机器可验：prompt 采样断言）。
- **I-G4 缺席不虚构**：缺席守则只声明缺席与行为约束，不得包含具体设定内容（有内容=该走
  假定或提案通道）。
- **I-G5 提案零新径**：盘点提案集只使用既有 artifact 家族与既有采纳边界；无新写入通道。
- **I-G6 探索可达**：暂用态对象/负债 finding 与对象落地同批探索可达（08 §8）。
- **I-G7 零新实体**：本包不新建存储实体；工作假定=既有实体 tentative 态+标注字段，
  负债/manifest=逻辑，盘点=既有 seed+run 壳复用（阶梯：状态→字段→读取通道→才新建）。
- 修订：VS-00F I-L1 措辞扩展（§3.2）。

---

## 6. 验收家族

**已定（OQ6 用户拍板）**：扩展 AU-13（负债规则=审读扩展，场景续 SC-AU13-D*）+ 新立 AU-14
（盘点与假定——作者补全回路）；四方边界：记忆事实（AU-09）/立项档案（AU-12）/进度账面
（AU-13）/补全提案与假定（AU-14）。场景草案（随 CP 立档）：

- SC-AU14-A1：空档案书写至 N 章 → 负债 finding（主角未物化）→ 处置"发起盘点" → 提案集
  → 逐项采纳 → 弧光账开始记账（地基真空病例的产品级修复回路全链）。
- SC-AU14-A2：盘点提案未采纳期间 → 主角假定 ACTIVE → 写作 prompt 带【暂定】→
  作者否决 → 注入消失、写作回缺席守则。
- SC-AU13-D1：骨架缺位 finding → 对话流补目标体量 → 规划 prompt 带骨架段+收官守则 →
  扩章批不再产终局章（百章标本重放先证）。

---

## 7. CP 路线（每 CP 百章标本重放验证靶；标本只验不标定）

| CP | 内容 | 标本重放靶 |
|---|---|---|
| CP0 | **done（2026-07-23）**：本包冻结重构（零新实体）+同批修订（08 NEM-GAP-08/VS-00C design_missing/VS-00F I-L1 修订+负债规则续编/06 absent 守则化+requires_confirmation 切分）+AU-14 立档+AU-13 D 系登记；00c atlas 与 ADR-0018 白名单随 CP1 实际事件名回填 | — |
| CP1 | **done（2026-07-23）**：CapabilityFactManifest（主角 E07/prose+plot_outline）+MissingPolicyResult design_missing 档+AbsenceDirective 缺席守则+机械准备注入+context.fact_completeness.done 留痕 | **重放 PASS**：真实读端口读百章标本 characters=0→主角缺席守则注入（artifacts/vs00g-replay/cp1-replay-2026-07-23.txt）；单测 domain 8+application 6 |
| CP2 | **R5 done（2026-07-23）**：主角未物化负债规则（ledger=design_debt，阈值 10 策略化，source_refs 指缺位查询[I-L1 修订]，处置=revise_design 引导变体）接入既有对账扫描+报告渠道。**重放 PASS**：百章标本 characters=0→R5 与 R3/R4 同产（artifacts/vs00g-replay/cp2-replay-2026-07-23.txt）。**R2 登记**（无设计接管需人物栏结构化提取，延后）；**R6/R7 随 CP3**（依赖全书骨架字段） | 重放：百章标本产"主角未物化" finding ✓ |
| CP3 | **done（2026-07-23，R7 除外）**：works 增 target_length/planned_volumes/serial_form（CA01 链路全复制，零新表）+WorkSkeleton domain（骨架段+收官守则[距目标禁终局]）+plot_outline 规划注入+探索面 profile 三行+**R6 骨架缺位负债规则**（profile 读容错降级）。**重放 PASS**：百章标本 R5+R6 同产（characters=0+旧 schema 无骨架→主角未物化+骨架缺位，artifacts/vs00g-replay/cp3-replay-r5-r6-2026-07-23.txt）；单测 domain 6+application 3+R6 4。**R7 提前收官登记**（需章标题/功能定位密度判定，接章计划 reader，随后） | 重放：R5+R6 同产 ✓；收官守则注入单测验证 |
| CP4a | **done（2026-07-23）**：逐项采纳白名单扩展（per_candidate_type? 从 character_seed 扩到全 seed 家族 world_rule/foreshadowing/style_rule/constraint，收编 H13）——盘点提案逐项采纳前提件 | 单测 4 |
| CP4b | 盘点 run（fact_inventory_v1 profile+提炼 prompt+三类提案产出）+触发 A/B——**较大独立段**（新创作工具+模型提炼+真实模型质量验证需狗粮） | 标本盘点：提案含主角团+世界规则，采纳后弧光账就位 |
| CP5 | 暂用态字段（provisional_source/active）+可标注注入通道+「暂定设定」视图+触发 C | SC-AU14-A2 |

---

## 8. 裁决记录（2026-07-22 用户拍板 + 建议默认）

- **OQ1 manifest SSOT 载体**：首版契约表（§2.1）+代码 module attr 镜像，稳定后 schema 化（默认取建议，可回滚实现细节）。
- **OQ2 假定放行 = 分级**（用户拍板）：required 事实的假定自动置 provisional_active+即时通知；recommended 事实的假定等作者放行。
- **OQ3 阈值默认**：R5=10 章、R6=20 章、假定寿命=10 章（来源 milestones §4.4 节拍推导，非狗粮标定；全部策略化可调，I-L4 阈值路径）。
- **OQ4 盘点产出 = 三类全产**（用户拍板）：一次盘点同产 档案提案（seed 家族）+骨架字段建议+工作假定候选。
- **OQ5 引导物化处置 = 复用 revise_design 变体**（携带盘点入口，不动 VS-00F 四枚举）。
- **OQ6 验收家族 = AU-13 扩展（SC-AU13-D*，负债规则）+ 新立 AU-14（盘点与假定，作者补全回路）**（用户拍板）；四方边界：记忆事实（AU-09）/立项档案（AU-12）/进度账面（AU-13）/补全提案与假定（AU-14）。
- **OQ7 用户可见命名**（用户拍板 WorkingAssumption）：设定盘点=「设定盘点」；WorkingAssumption=**「暂定设定」**（面板"待确认假定区"=「暂定设定」区，注入标注=【暂定】）；全书骨架用户可见词=「全书规划」（待 ui47 落地时再定，非承重）。
- **OQ8 存量书稿导入 = 本包不做**，登记独立 slice（盘点是其核心引擎，先建引擎）。

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
| 工作假定 | **复用既有对象 tentative 态+2 字段（零新实体）** | Character/works 既有 AdoptionStatus 状态机+多维字段；消费侧硬过滤 tentative 现状即改动点；2026-07-23 用户"慎重新增实体"拍板 |
| 假定语义切分 | **切分 ×3** | CreativeOutputSelfReport.assumptions（同名不同物）/06 §5.5 requires_confirmation（材料 vs 假定）/AU-09 记忆类假定走注入期文本不落 memory_items |
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
- `21-novel-object-model.md` / Character schema：加 provisional_source/provisional_active 字段注记；
- `ADR-0018`：module 白名单（inventory 事件族）；
- 验收：AU-13 扩展 D 系+AU-14 立档（OQ6 定后）+author/README 边界行；
- `ui/43`：面板假定区/盘点动作注记；`ui/47`：新用户可见词（OQ7 定后）。
