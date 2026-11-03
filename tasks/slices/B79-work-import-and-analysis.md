# B79：存量书稿导入与导入后分析建档

- 状态：**todo（2026-11-04 立项；契约已登记待建，实施未开始）**
- 来源：作者 2026-11-04 原话「登记一个导入功能，1 可以直接导入 2 可以导入全文和分析」+ 两轮提问拍板（§2）。
- 上游契约登记：
  - [VS-00G §1 非目标 / §8 OQ8](../../docs/design/contracts/VS-00G-fact-completeness-and-provisioning-contract-pack.md)：「存量书稿导入 = 本包不做，登记独立 slice（盘点是其核心引擎，先建引擎）」——盘点是核心引擎的先建条件已由 VS-00G CP4 完成，本 slice 即该承接项。
  - [AU-14 §7 已知限制](../../docs/design/acceptance/author/AU-14-provisioning-and-assumptions.md)：存量书稿导入（粘贴旧稿→建档）不在 AU-14。
  - [45 §4.3 风格样本导入](../../docs/design/ui/45-guided-conversation-flows.md)：大量文本→提取分析态→特征卡片，是本 slice 文风分析的最小交互先例（落地语义以 §4 为准）。
- 本任务不复制验收标准到第二份文档；契约与场景在 CP0 冻结时登记到既有落点（`docs/design/contracts/`、`quality/acceptance/`）。

## 1. 问题与判断

真实作者问句：*「我在别处已经写了几十上百万字，怎么把它搬进工作台，让 AI 读懂我的书、接着往下写？」*

现状事实（2026-11-04 核实）：

- 全产品只有「从零立项 → 逐轮对话/采纳」入口，没有任何正文导入路径；导出（`NovelApplication.ExportService`）是只写不读的单向通道。
- 正文权威存储在 `drafts`（必须挂 `scenes`），`chapters` 只存结构（title/seq/status/summary/plan_direction）；阅读与导出只消费 ACCEPTED 正文（`ReadingProjectionService.toc/chapter_content`），续写上下文消费已采纳正文/章摘要与记忆。所以「导入」= 每章机械物化 chapter → scene → draft(ACCEPTED)，且必须逐字节保真。
- 逐字节保真已有先例：Q3C 作者内容物化确立「作者提供字节是 I1 合法来源之一」，导入正文不得经模型改写。
- 分析侧引擎已存在但口径不是为存量书稿设计的：
  - `NovelApplication.FactInventoryService` 已能产 `character_seed` / `world_rule` / `foreshadowing` / `style_rule` / `constraint` + `work_skeleton_suggestion`，但产出是 **tentative 提案 + 逐项采纳**；
  - `NovelPersistence.ReadingProjectionRepo.fact_inventory_materials/1` 已是「全书 ACCEPTED 章摘要优先、缺章回退正文」的覆盖全书口径——长篇分析可直接复用的读端口；
  - `ChapterSummaryGenerator` / `ChapterSummaryMaintenance` 能产逐章摘要（`D3-summary-maintenance-reliability` 先例），是分析链的前置材料；
  - 缺口：卷章结构提炼（现有骨架建议只补缺位字段）、文风对象化（B55 deferred）。
- 判断：本 slice 的价值不是"再加一个导入按钮"，而是把「外部书稿 → 可续写的作品事实 → 可分析的知识档案」打通成一条真实主链，并以「导入批次」语义保护"直接写入"的可撤销性。

## 2. 作者拍板（2026-11-04，两轮提问）

| # | 决策 | 内容 |
|---|---|---|
| D1 | 功能形态 | 只有一个入口：先导入正文；分析是导入完成后的**可选后续动作**，不与导入耦合 |
| D2 | 导入源 | 单个 `.txt`、多个 `.txt`/`.md`（一章或若干章一文件）、直接粘贴纯文本；本期不做 `.docx`/`.epub`/PDF |
| D3 | 章节切分 | 完全自动识别并落库，只报统计（识别章数/总字数/未识别块数），**不做逐章预览/逐章确认**；异常事后在结构面板调整 |
| D4 | 分析范围 | 六类全要：人物档案、世界观与设定规则、大纲与卷章结构、逐章摘要、文风样本与作者偏好、伏笔与线索 |
| D5 | 分析落地 | **不走逐项采纳**，直接写入档案；写入登记为「导入分析批次」，可整体撤销 |
| D6 | 目标作品 | 新建作品导入 + 导入到现有作品；导入现有作品时作者选「追加」或「覆盖」，覆盖需二次确认 |
| D7 | 分析执行 | 导入后**手动触发**；后台分批长跑，可暂停/继续、进度可见、断点续跑 |
| D8 | 大纲/卷产出落点（2026-11-04 第二轮指示） | 分析产出的大纲与卷信息**写入系统现有 schema，零新表**：`volumes.blueprint`（卷级蓝图 12 设计槽）、`chapters.summary` + `chapters.plan_direction`（章大纲/写前方向）、`works.planning_direction` + 骨架字段；**原文没有卷划分就不产生卷信息**（不建蓝图、不编卷名，不为凑结构发明卷） |
| D9 | 覆盖导入旧正文处置（2026-11-04 拍板） | 覆盖 = **软替换**：旧正文 `SUPERSEDED`、旧章/卷 `ARCHIVED`（阅读/导出自动不可见），批次记原状态可整体回滚；**禁止物理删除**已有正文与结构（§4.7） |

## 3. 范围界定

### 3.1 做

1. **导入正文**：新建作品导入、导入到现有作品（追加/覆盖）；单文件、多文件、粘贴三种来源。
2. **确定性切分与落库**：章自动识别、按识别结果物化 work→volume→chapter→scene→draft(ACCEPTED)，逐字节保真；原文无卷划分时**不产生卷信息**（不建卷蓝图、不编卷名），章必挂卷仅作为 DB 约束（`chapters.volume_id` NOT NULL）下的承载容器，容器不冒充作品卷（D8）。
3. **导入统计报告**：识别章数、总字数、未识别块数及位置、被忽略的空行/分隔线；不要求作者逐章确认。
4. **导入后分析（手动触发）**：逐章摘要 → 全书提炼（人物/世界观/伏笔/文风）→ 大纲与卷章结构；分批后台执行、暂停/继续、断点续跑、进度可见、预算预估。
5. **直接写入 + 批次撤销**：分析产出直接落 ACCEPTED 档案；整批撤销走 superseded 而不是物理删除；正文覆盖导入亦可回滚。
6. **导入后可用性**：阅读模式可读全文、结构面板可调整、探索面（`chapter_read`/记忆 recall）同批可达、续写能消费导入正文与档案。

### 3.2 不做

- `.docx` / `.epub` / PDF 解析；OCR；网络/云导入。
- 逐章预览、人工逐章确认、手工切分界面（D3 明确否决）。
- 分析结果逐项采纳 UI、逐项否决流程（D5 明确不做；撤销以批次为单位）。
- 导入时调用模型改写/润色/纠错正文（违反 I1，绝对禁止）。
- 多用户/跨设备同步；导入历史版本管理（超出本 slice，必要时另立）。
- 重写既有盘点/摘要引擎：优先复用，只扩展材料口径与写入路径。
- 不为大纲/卷新造持久化载体（不新增表、不新增列、不新增对象类型）：卷仍写入现有 `volumes` 表（原文识别到卷划分时正常创建卷记录，属于现有表新行），章大纲写现有 `chapters.summary` / `chapters.plan_direction`，全书主线写现有 `works.planning_direction` + 骨架字段（D8）。

## 4. 契约与语义设计要点（CP0 冻结）

### 4.1 导入批次（ImportBatch）

一次导入 = 一条可审计批次：`work_id`、来源类型（单文件/多文件/粘贴）、源文件名与字节数、切分统计、落库结果 refs（volume/chapter/scene/draft）、目标模式（新建/追加/覆盖）、**覆盖时旧结构导入前的原 status（供撤销恢复）**、状态、作者可见摘要。

- 分析产出的档案项携带批次来源引用（候选复用 `memory_items.source_type = WORK_SETTING_IMPORTED` / `source_id` / `supersedes_ref` 字段，枚举已存在，勿新造同义枚举）。
- CP0 必须先论证「新增 `import_batches` 表 vs 复用既有载体（`long_run_tasks` / `mutations` / `author_action_receipts`）」；YAGNI，能用既有载体表达来源就不建同义表。

### 4.2 直接写入的合法性边界

- 正文：作者字节，I1 合法来源；新建 draft 以 ACCEPTED 落库是初始态（现有 changeset 注释已说明 TENTATIVE→ACCEPTED 合法路径），但**必须逐行走 repository changeset 校验，禁止 `update_all` 绕过**（B44 教训）。
- 档案：内容字节必须来自 provider 响应（I1），系统不得拼接/改写/补齐；直接 accepted 需要新的生命周期入口，CP0 需在 ADR-0019 矩阵语义下给出合法路径（新建即 accepted，或扩展显式 import 来源转换）并写测试锁定。
- 撤销：批次撤销 = 对该批次产出项执行 ACTIVE→SUPERSEDED（矩阵已有 supersede 先例，Q1C/B44）+ 写 mutation/receipt 留痕，**不物理删除**；撤销后 reading projection / recall 必须立即不可见（投影新鲜度断言）。
- D5 拍板不改变「候选→采纳」主链语义：创作产物仍走逐项采纳，只有导入分析批次走直接写入，两条来源在 trace 上必须可区分。

### 4.3 切分规则与统计口径

- 纯函数解析：原始文本 → `[%{kind: :volume | :chapter, title, body, start_offset, end_offset, confidence}]` + 统计。识别中文章节/卷标题、`Chapter N`、序章/楔子/番外/后记、分隔线；不识别块按统计报告，处理策略（并入前章/单独成章/忽略）CP0 定，禁止静默丢字。
- 卷：只有原文识别到卷标题才产生卷信息（`volumes.title`/`seq`）；原文无卷划分时**不产生卷信息**——不建 `volumes.blueprint`、不编卷名。DB 约束 `chapters.volume_id NOT NULL` 决定每章必须挂卷，因此需要一个不冒充作品事实的承载容器；容器是否在 UI 显示、用什么中性文案，CP0/CP2 定（**不得默认「第一卷」冒充作者事实**）。
- 编码：UTF-8 为主；中文 txt 常见的 GBK/GB18030 必须检测并明确失败或转换，**乱码不得静默入库**。
- 字数口径复用 `ProseAudit`（与阅读/导出一致），统计报告里的字数必须与阅读投影一致。

### 4.4 分析产出映射

| 分析项（D4） | 目标产出 | 复用/缺口 |
|---|---|---|
| 逐章摘要 | `chapter_summaries`（每章一条） | 复用 `ChapterSummaryGenerator`；需分批 + 失败断点 |
| 人物档案 | `characters` / `character_seed` 物化 | 复用盘点 + seed 映射；需扩展全文材料口径 |
| 世界观与设定规则 | `memory_items` world_rule | 复用盘点 |
| 伏笔与线索 | `memory_items` foreshadowing | 复用盘点 |
| 文风样本与偏好 | `memory_items` STYLE_RULE / AUTHOR_PREFERENCE + 样本原文 | B55 deferred，最小方案落记忆项；样本抽取需原文而非摘要 |
| 大纲与卷章结构 | **落现有 schema，零新表（D8）**：`volumes.blueprint`（`VolumeBlueprint` 12 设计槽：目标冲突/弧光阶段/地图边界/支线启动推进收束/高潮章/爽点密度/缓冲章/新人物新设定新地图）、`chapters.summary` + `chapters.plan_direction`（章大纲/写前方向）、`works.planning_direction` + 骨架字段（target_length/planned_volumes/serial_form） | 复用 `VolumeBlueprint` 白名单归一与章大纲采纳落库口径；仅对有卷划分的原文写 blueprint（D8：无卷不产生卷信息）；现有骨架建议只补缺位字段，主线脉络/卷弧提炼为增量缺口 |

- 分析顺序：逐章摘要必须先行（全书提炼的材料口径依赖它）；六类产出的调用批次、预算与暂停粒度 CP0 定。

### 4.5 导入源读取与传输

- 文件：前端 Tauri dialog 选路径 → channel 传路径 → application 读文件（与导出 `export_dir` 对称）；避免百万字经 WebSocket 往返两次。
- 粘贴：前端直发文本，必须设大小上限并在超限时引导改用文件（上限 CP0 定），不得静默截断。
- 文件读取失败/编码失败/空文件必须给出作者可读错误，禁止部分成功后冒充成功。

### 4.6 覆盖导入与撤销：软替换，不物理删除既有事实

- 覆盖导入 = 新批次激活 + 旧事实退出可见，**不物理删除**已有正文/结构：
  - 正文：旧 draft `ACCEPTED → SUPERSEDED`（ADR-0019 矩阵已支持，Q1C 先例），新 draft 以 ACCEPTED 落库；历史与 revision 链保留。
  - 结构：旧章/卷置 `ARCHIVED`（`StructureStatus` 现有值；`ReadingProjectionRepo.structure_chapters` 已过滤 ARCHIVED，阅读/导出天然不可见），memory/chapter_summary/trace 的 chapter 引用不悬空。
  - 批次内记录旧结构导入前的原 status，撤销覆盖时据此恢复（如 ARCHIVED→COMPLETED）。
- 撤销「新建作品导入」：本批次新建、经引用检查无外部消费者的产物可删；一旦被续写/摘要/记忆引用，降级为 ARCHIVED + supersede，不删。
- 物理删除只允许用于本批次自己新建且无外部引用的产物；引用检查口径 CP1 定，禁止按 work_id 批量删。

### 4.7 覆盖导入的旧正文处置（2026-11-04 作者拍板：软替换）

| 方案 | 结论 | 行为与代价 |
|---|---|---|
| A. 软替换 | **已选（D9）** | 旧 draft SUPERSEDED + 旧章 ARCHIVED，阅读/导出自动不可见；历史可查、批次可回滚。代价：存储不回收、需批次记原状态与恢复路径 |
| B. 物理替换 | **否决** | 删除旧正文/旧结构，破坏审计与撤销能力，悬空引用需另行清理，与既有 SUPERSEDED/ARCHIVED 机制冲突 |

裁决理由：与项目既有「修订 = SUPERSEDED + revision link」（Q1C）、「归档不出阅读投影」（`ReadingProjectionRepo.structure_chapters` 过滤 ARCHIVED）一致，也是 D5「直接写入 + 批次可撤销」成立的前提。CP0 按 A 冻结恢复路径，**禁止按 B 实施**。

## 5. 开工七问

- **Contract**：VS-00G OQ8 承接 + 本 slice §4 冻结的导入批次/切分/直接写入/撤销契约；正文身份链 `chapter_ref = chapter:<id>`（B24/B25）；`memory_source_type` 既有枚举；ADR-0019 状态矩阵；入口契约沿用 `WorkspaceChannel`（新增 channel 动作在 CP0 登记）。
- **Invariant**：① 导入正文逐字节保真，模型不得改写（I1 作者字节来源）；② 未撤销的分析批次产出不得伪造为 Author 已确认来源（trace 可区分 import 来源）；③ 批次撤销后档案在 reading projection / recall 中立即不可见；④ 重复导入同一文件不得产生重复章节（幂等或显式确认，CP0 定）；⑤ tentative 创作候选语义不被导入路径污染；⑥ 原文无卷划分时不产生卷信息（不建 blueprint、不编卷名，D8）；⑦ 覆盖/撤销不物理删除已有正文与结构（正文 SUPERSEDED、结构 ARCHIVED），已有引用不悬空。
- **Boundary**：`novel_web`（channel 动作）→ `novel_application`（导入用例/分析编排）→ `novel_domain`（切分纯函数、批次语义）/ `novel_persistence`（repo + schema/migration）/ `novel_foundation`（枚举若需）；不改 `novel_agent` 运行时内部（分析复用既有 AgentRun/长跑），禁止 web 直连 Repo。
- **Consumer**：真实消费者是作者从工作台/作品入口发起的导入 → 阅读模式读到导入正文 → 手动触发分析 → 档案/记忆面板可见；下游是续写主链消费导入正文与记忆。
- **Proof**：切分纯函数单测（多语料/边界/编码）+ 导入落库 persistence 测试（字节相等、字数口径一致、追加/覆盖矩阵）+ 批次撤销测试（零残留可见）+ 分析映射集成测试 + 外部自动化真实页面场景；执行 AGENTS 全门禁与 I1/I2/I3。
- **Acceptance Driver**：外部 Tauri 脚本从真实入口选 fixture 文本 → 点击导入 → 断言统计可见、阅读模式正文逐字节一致、结构面板章数正确 → 点击开始分析 → 断言进度/暂停恢复 → 断言档案可见 → 点击撤销批次 → 断言档案消失。产品代码不得新增验收感知逻辑（默认 no）。
- **Exploration**：导入物化的正文与档案必须同批经探索面可达——`chapter_read` 按 `chapter_ref` 读到导入正文（B24 口径），人物/规则/伏笔/文风进 memory recall（AU09 口径），逐章摘要进写作携带；需证明判断循环观察携带 `used_context_refs` 且观察进入后续真实 provider 请求，而非只证明"查得到"。未配置专用 packet 的要素复用通用探索面（不新增固定 packet）。

## 6. CP 拆分

| CP | 内容 | 完成判据 |
|---|---|---|
| CP0 | 契约冻结：导入批次载体、切分规则与统计口径、直接写入 ADR-0019 合法路径、撤销语义、分析产出映射（现有 schema 落点）、覆盖软替换与恢复路径（D9）、channel 动作与场景注册 | 契约/场景落既有落点；无新造平行文档；风险项裁决完成 |
| CP1 | 确定性导入链：解析纯函数 + 落库（新建/追加/覆盖）+ 统计 + 编码/失败处理 | 单测 + persistence 测试 + 字节保真断言 |
| CP2 | 真实页面导入闭环：入口 UI、文件对话框、粘贴、进度、统计展示、阅读可读、结构可调 | 外部 Tauri 场景 PASS（确定性 fixture） |
| CP3 | 分析长跑骨架：手动触发、逐章摘要分批、暂停/继续/断点、进度、预算预估 | 确定性 provider 机制验收 + 真实模型窗口预注册 |
| CP4 | 六类分析写入档案 + 批次撤销 + 探索面可达 + 续写消费证据 | 外部 Tauri 场景 PASS（真实模型）+ 撤销零残留断言 |
| CP5 | 收口：全门禁、I1/I2/I3、静态扫描、场景化验收、登记核对 | 汇报区分真实页面验收/局部证据/未闭环缺口 |

- 最小实现步只作 checkpoint，不缩小 §3.1 范围；CP2/CP4 缺真实页面证据时只能标「局部证据」。

## 7. 风险与待裁决

| # | 风险 | 处置 |
|---|---|---|
| R1 | D5「直接写入」绕过 tentative→adoption 语义，可能与 ADR-0019/采纳审计冲突 | CP0 给出矩阵合法路径 + 批次可撤销 + trace 区分来源；不得用 `update_all` 绕过 |
| R2 | 覆盖式导入会动已采纳正文（最高风险） | 二次确认 + 已拍板软替换（D9：旧 draft SUPERSEDED、旧章 ARCHIVED，阅读投影已过滤 ARCHIVED）+ 批次记原状态可回滚；禁止物理删除已有事实 |
| R3 | 大文件性能（几十 MB、百万字、几百章） | 流式解析、事务分块、粘贴上限；CP1 用大 fixture 压测 |
| R4 | 分析成本与时长（数百次模型调用） | 45 §4.4 长跑 pre-flight 确认先例：预算预估 + 明确确认 + 分段预算 |
| R5 | 文风对象化依赖 B55（deferred） | 本 slice 最小方案落 memory STYLE_RULE/样本原文，不建 style 对象体系；B55 重启时再收编 |
| R6 | 六类分析质量（尤其卷章结构/文风） | 真实模型窗口证据 + 人工抽检；不得以确定性替身证明语义质量 |
| R7 | 导入后立刻续写时，摘要/记忆尚未生成 | 依赖既有 lazy 补做机制（`d3-summary-lazy-repair` 先例）；纯导入路径也必须有可续写证据 |
| R8 | 乱码/编码/切分异常静默丢字 | 失败显式报错 + 统计报告 + 零静默丢弃测试 |

## 8. 恢复指引

- 开工先读：本文件 §2–§6 → VS-00G OQ8 原文 → `fact_inventory_service.ex` / `reading_projection_repo.ex`（`fact_inventory_materials/1`、`structure_chapters` 过滤 ARCHIVED）/ `chapter_summary_generator.ex` / `export_service.ex` / `volume_blueprint.ex`。
- 2026-11-04 第二轮作者指示：D8（大纲与卷分析落现有 schema 零新表；原文没有卷划分就不产生卷信息）+ D9（覆盖导入=软替换，禁止物理删除）。
- 当前状态：仅立项登记，无实现改动；CP0 未开始。
- 完成后需同步：`tasks/slices/README.md` 索引、`tasks/NEXT.md` 状态、`docs/project-ledger.md` 事实（仅交付时）、`quality/acceptance/` 场景注册；不新建平行文档。
