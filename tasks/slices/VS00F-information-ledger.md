# VS00F-information-ledger：信息账正账与 design_ref 首落（Order 8 刀序④）

**状态**：in_progress（CP1 开工；拍板全落见 §7——用户否决全局阈值与机械回收，
定型「预期归伏笔自己/回收=模型提议+作者裁决」，并升华为四层体系备忘
`docs/design/notes/2026-08-11-establish-carry-process-write-pipeline.md`）
**来源**：Order 8 排查 §3.9/§5.4（information 账三库近乎零行，五本账唯一常态零行的
一本；design_ref 三库 100% NULL，三态对账缺半条腿）；VS-00F CP2 的信息账「正账」
半边从未建成（LEAKED 异常态已落，HIDDEN→REVEALED 生命周期零代码）。

## 1. 问题

1. **信息账只有事后报警,没有账**：唯一写入者是 R4 前指泄露检测（正文出现「第 N 章」
   且 N 未写 → LEAKED 条目）。藏了什么、打算何时揭示、伏笔埋了有没有回收——
   每章规划都在产这些数据（九字段「信息释放」「伏笔动作」、伏笔 seed 采纳），
   全部过目即忘。M3/M4 病灶：伏笔从埋到忘,无人问回收。
2. **design_ref 全账零写入零消费**：契约里它是三态对账的设计态锚点,现实是纯摆设。
   契约明写的漂移信号「无 design_ref 的新主导线」(R2) 因此永远发不出来。
3. **写作注入零信息差**：progress_state 投影只有 arc（prose 侧）——writer 不知道
   「哪些信息还不能让读者知道」,泄露只能事后抓（R4）,不能事前防。

## 2. 机器事实（2026-08-11 全链探索,已抽验）

- 唯一写入点 `ledger_maintenance.record_future_ref_leaks`：subject_ref
  `future_ref_<N>` 派生 key 天然幂等；design_ref 不传。
- `LedgerEntry` 无 information 专用纯函数；`@information_statuses`
  HIDDEN/PARTIALLY_REVEALED/REVEALED/LEAKED 合法但**三正态无任何转移路径写入代码**；
  裁决转移表仅 `LEAKED→REVEALED` 一条边。
- 对账规则 R1-R8 中 information 仅 `planned_info_leak`（聚合已记账 LEAKED）；
  **design_ref 全仓零非 nil 写入、零读取**；R2 moduledoc 自陈「需 design_ref
  数据基础,CP2b 落地」——从未落。
- 设计态数据源三处：`plan_direction.information_release`（自由文本,可缺席）、
  伏笔 memory（`FORESHADOWING` 类,content/summary 自由文本,**无章锚无回收信息**）、
  刀③ `scene_plans`。章摘要四栏含 `:foreshadowing`（【伏笔动作】,标本实测文本丰富）。
- subject_ref 铸造先例：内容派生 key（`future_ref_<N>`）/外键 key（`chapter_id`）/
  全书单条字面量（`genre`/`main`）；`(work_id, ledger, subject_ref)` 唯一索引 +
  两步 TENTATIVE→ACCEPTED upsert 仪式。
- 注入通道：`progress_state` tool_input 独立字段（不碰 stub 锚点）,prose 侧仅 arc、
  planning 侧四账,**均不含 information**；契约 §4 已认领「伏笔账…当前位置」槽。
- 对账约束（契约 §6.2,I-L4）：**账面对账必须确定性规则,不用模型判定**；
  质量门 knowledge_boundary 是另一层（🟡 仅 LLM）,分工表明确「不由对账补位」。
- 面板：信息行通用渲染已通；statusLabels 缺 HIDDEN/PARTIALLY_REVEALED/REVEALED
  中文文案；裁决 accept_drift 对 information 无映射（照记不动账,注释明示）。

## 3. 设计

### 3.1 身份 = 设计槽位（破「fact 无自然主键」）

不给语义事实发明主键——给**设计承诺**建账,身份即设计锚,机械可判、天然幂等：

| 条目类 | subject_ref | design_ref | 建账时机 |
|---|---|---|---|
| 章计划信息 | `plan_info_<chapter_seq>` | `chapter_plan:<seq>` | 章计划物化（该章 `information_release` 非空时） |
| 伏笔 | `foreshadow_<memory_id>` | `memory_item:<id>` | 伏笔 seed 采纳（`FORESHADOWING` 记忆落库同批） |

payload：`fact`（原文）、`planted_at_seq`（伏笔）/`planned_reveal_seq`（章计划信息
= 自己的章）。既有 LEAKED 路径不动（其 design_ref 保持 nil——实现态异常本无设计锚,
诚实空缺）。

### 3.2 生命周期机械推进（I-L4：零模型判定）

- **章计划信息**：HIDDEN（章未写）→ REVEALED（该章正文采纳——信息释放是本章计划的
  组成部分,章写完即视为按计划释放;「写了但其实没释放」属质量门层语义判断,不由账面
  冒充）。
- **伏笔**：**不做机械回收判定**（用户拍板：contains 匹配抓不住变体/隐喻回收,
  纯人工等于没账;回收是语义判断）。回收 = **盘点家族模型分析提议 + 作者采纳**
  （§3.3b）;账面 HIDDEN→REVEALED 只经作者裁决（转移表增边）。
- PARTIALLY_REVEALED 无机械判定源,本刀不推进（合法态保留,等拉动）。

### 3.3 预期归伏笔自己（用户拍板：无全局阈值）

「有的几章就收,有的贯穿全书」——预期跨度是**每条伏笔的属性**：

- payload 增结构化 `planned_reveal`：`%{"kind" => "chapter"|"volume"|"whole_book",
  "seq" => n|nil}`。来源=提炼链（盘点/创作 foreshadowing_seed prompt 可选输出,
  normalize_item 白名单收敛,narrative_role 同款先例）;**模型/作者没说就是 null,
  机器不发明**。
- **R9 `foreshadowing_overdue`**：仅对「有预期且已超期」开火（chapter 型超章号/
  volume 型超卷,机械可判,I-L4 保持）;whole_book 与 null 型**永不产 warn**,
  只在接近目标体量时（收官守则同源进度口径）进「收官前未回收伏笔清单」交作者过目。

### 3.3b 回收 = 盘点提议 + 作者裁决（处理层第一个写作态实例）

盘点家族（fact_inventory,现成的模型提炼引擎+逐项采纳边界）新增第四类提案
`foreshadowing_resolution`：对照未回收伏笔清单与已采纳材料,产出「伏笔 X 疑似
已在第 N 章回收,依据…」提案;**采纳 = 账面 HIDDEN→REVEALED（design_ref 与
依据章进 source_refs）,不采纳账面不动**。模型只提议,作者收账。

### 3.4 注入（progress_state 既有契约槽,不碰 brief/锚点;按预期相关性选取）

- **prose 侧**新增信息段：①未回收伏笔——**临近/已超预期回收点的优先**
  （chapter 型临近、volume 型当前卷）;whole_book/null 型不逐条打扰,仅计数行;
  ②「后续章节计划信息,不得提前揭示」（R4 泄露的**事前预防**,HIDDEN 的未来章
  plan_info 条目即禁写清单）。
- **planning 侧**摘要行：未回收伏笔计数与最早超期项。

### 3.5 面板与文案

statusLabels 补「未揭示 / 部分揭示 / 已揭示」;信息行摘要沿用通用渲染
（subject_label 带「伏笔：」/「第 N 章信息：」前缀自明）。

## 4. 明确不做（YAGNI/分工）

- R2 无设计接管（冲突账职责,另刀）；全账 design_ref 回填（本刀只在信息账首落）；
- `reader_knows`/`character_knowledge` payload 细化（契约留位,机械层无判定源不填）；
- PARTIALLY_REVEALED 推进；质量门 knowledge_boundary（§6.2 分工:门禁层各自演进）；
- 存量标本库回填。

## 5. CP 拆分

- **CP1 建账双源 + planned_reveal 槽贯通 done（2026-08-11，dd44c993）**：
  伏笔 seed 采纳建账（design_ref 首个真实写入）+ 章计划信息释放建账（重物化幂等
  不回退）+ 本章正文采纳机械 REVEALED + planned_reveal 槽全链（盘点 prompt 可选
  输出→normalize 白名单收敛→采纳链→账 payload）；账面两步仪式在采纳事务内执行。
  单测四组，1412 后端零回归（旧数据零新条目由全部既有 fixture 证明），I1/I2/I3
  PASS。
- **CP2 R9 超期 + 收官清单 + 裁决 + 面板 + 注入**：`foreshadowing_overdue`
  （仅有预期且超期）+ 收官前未回收清单（进度口径与收官守则同源）+ 裁决转移边
  HIDDEN→REVEALED + statusLabels 文案 + progress_state 信息段（prose 双段 +
  planning 摘要行）。
- **CP3 盘点回收提案 + 真实 Tauri**：`foreshadowing_resolution` 第四类提案
  （盘点 prompt/映射/采纳=REVEALED）+ 场景验收（AU-13/14 族扩展：埋伏笔带预期 →
  超期 finding → 盘点提议回收 → 作者采纳 → 账面 REVEALED + 注入证据）。

## 6. 七问

- **Contract**：VS-00F §2.4 信息账正账落地注记（payload 子集：fact/planted_at_seq/
  planned_reveal_seq,机械层不填 reader_knows/character_knowledge,契约修订登记）；
  R9 规则进对账规则族；裁决转移表增边；progress_state 投影扩 information
  （§4 已认领槽位,实现登记）。
- **Invariant**：①对账零模型判定（I-L4）；②建账幂等（subject_ref 设计锚派生 +
  唯一索引 + 两步 upsert 仪式）；③无计划信息/无伏笔的作品零新条目（标本重放证）；
  ④注入只读账面,不写；⑤I1/I2/I3 不受影响。
- **Boundary**：novel_domain（纯函数/规则/转移表）、novel_application
  （maintenance 钩/注入投影/审读）、novel_persistence（adoption 建账钩）；
  **不动** channel/web/前端组件（面板走既有通用渲染,仅 copy 文案）、质量门、brief。
- **Consumer**：R9 审读 finding（design_ref 首个消费者）、writer prompt 信息段
  （禁提前揭示+未回收伏笔）、脉络面板信息行、探索面 ledgers facet。
- **Proof**：domain/maintenance 单测；标本重放；真实 Tauri 场景（埋→悬空→回收全环）。
- **Acceptance Driver**：AU-13 场景族扩展,外部 driver 真实页面,产品零验收感知。
- **Exploration**：`archive_read(ledgers)` 信息行已有渲染（render_ledger_entry
  information 分支）,新条目同批可读——第七问天然闭环。

## 7. 拍板记录（2026-08-11 全落）

1. **建账双源**：批准（章计划信息 + 伏笔）。
2. **伏笔回收判定**：用户否决机械匹配与纯人工两案（「都不好,伏笔回收需要进行
   分析一下」）→ 定型 §3.3b 盘点模型提议 + 作者裁决。
3. **悬空阈值**：用户否决全局阈值（「没有标准化答案,有的几章就收了有的贯穿
   全书」）→ 定型 §3.3 预期归伏笔自己（planned_reveal 槽,仅超期开火,
   whole_book/null 永不催）。
4. **注入范围**：同 3 的洞察 → 定型 §3.4 按预期相关性选取（临近/超期优先,
   长线不打扰）。

## 8. 决策日志

- 2026-08-11 — 全链探索 + 七问补全。
- 2026-08-11 — 用户四拍板全落（§7）;讨论升华为四层体系备忘
  `notes/2026-08-11-establish-carry-process-write-pipeline.md`（设立→携带→
  处理→写作方向;本刀三件事各占一层）。CP1 开工。
