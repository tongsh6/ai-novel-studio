# B11C-scene-craft-completion：场级执行结构补全（VS-00E 设计全集）与档案场次可见

**状态**：**done（2026-10-22，CP1+CP2 全落，真实 Tauri `p1-prose-execution-brief` PASS）**；作者拍板 B11③（主线顺序 B13a → B11③ → B11①，2026-10-22）。CP3（首次 append 场名误标）已登记为下一 checkpoint（B21），不在本 slice 声称闭环。
**来源**：`docs/design/08-novel-element-model.md` E23–E30 / NEM-GAP-04；`docs/design/contracts/VS-00E-prose-execution-quality-contract-pack.md` §1 `scene_units` 设计全集；Order 8 刀③ `tasks/slices/NEM04-scene-craft-planning.md`（已 done，最小三槽）。

## 0. 现状核查：为什么不是重做 NEM04

2026-10-22 开工前核查（代码 + 验收文档，不凭旧任务标题）：

| 事项 | 现状 | 结论 |
|---|---|---|
| 场次计划落库 | `plan_direction.scene_plans`（NEM04 刀③，2026-08-11 done）：`title/goal/agendas/emotion` | **已覆盖，不重做** |
| 简报多场展开 | `ProseExecutionBriefBuilder` 逐场 `planned_scene`，`scene_unit_count` 留痕；`p1-prose-execution-brief` 真实 Tauri PASS | **已覆盖，不重做** |
| 场次名进场景行 | `AdoptionRepository.resolve_scene` 优先用计划场次名 | **已覆盖，不重做** |
| 探索面可读 | `exploration_service.scene_plans_text/1`（仅三槽） | 已接面，**需随本 slice 扩展** |
| VS-00E `scene_units` 设计全集 | `causal_spine{goal,opposition_or_dilemma,turn,consequence}`、`information_delta{reader_learns,protagonist_learns,remains_hidden}`、`dialogue_intent{mode,surface_topic,hidden_conflict}`、`sensory_anchor[]` 已在契约冻结（§1）且 `ProseExecutionBrief` 的 key family / prompt 渲染函数**已存在**，但 `planned_scene` 路径**从未生产**这四个字段（只有 chapter_projection 路径产 `information_delta`） | **真缺口**：契约有结构、有渲染、无生产 |
| 作者可见性 | 档案「大纲与结构」只显示章摘要/本章使命（`plan_direction.chapter_mission`）；`get_toc` 已带 `plan_direction`（含 scene_plans）但前端未渲染 | **真缺口**：数据已在 TOC，作者看不到 |
| E28/E29/E30 | 动作编排/内心戏/场间过渡无契约 key、无生产、无消费 | **本 slice 不做**（08 §8「待真实创作动作拉动」，登记 NEM-GAP-04 余项） |

**因此本 slice = 把 VS-00E 已冻结的场级执行结构从「只渲染」补到「规划生产 → 简报消费 → 作者可见」，不是重做 NEM04。**

## 1. 问题（两处退化互为因果）

1. **规划侧**：章计划的逐场标注目前只能写三槽（目标/议程/情绪）。E23 场景解剖（因果：目标→阻力→转折→后果）、E25 场内信息差（谁知道什么/本场揭示什么/还藏什么）、E26 时空与感官、E27 对白设计（表面话题/潜台词）在规划时其实都要想，但格式没有槽位 → 模型只能写成自由文本或干脆不写，数据过目即忘。
2. **执行侧**：`ProseExecutionBrief` 的 `scene_unit` 设计全集里，writer prompt 渲染器已支持 `causal_spine` / `information_delta` / `dialogue_intent`（信息差直接决定"读者此刻该知道什么"），`sensory_anchor` 渲染函数缺失；但规划侧不产 → 写作时这些场级约束**全部为空**，多场展开只展开成"目标+议程+情绪"三行。
3. **作者侧**：场次计划已在 `get_toc` 数据里，档案大纲不渲染 → 作者无法核对"这一章分几场、每场要发生什么、信息怎么放"，也无法在写作前发现场级结构问题。

## 2. 开工检查（七问）

1. **Contract**：
   - 消费 `VS-00E` §1 `ProseExecutionBriefV1.scene_units` 的 `causal_spine` / `information_delta` / `dialogue_intent` / `sensory_anchor` 四个已冻结键（**不改契约、不 bump brief_version**）。
   - 扩展 `ChapterPlanDirection.scene_plans` 的**允许键集合**（仍是 `chapters.plan_direction` map 列内的设计态数据，零 migration、零新列）：新增 `opposition/turn/consequence/reader_learns/protagonist_learns/remains_hidden/surface_topic/hidden_conflict/sensory`。
   - 扩展 `ChapterPlanParser` 的逐场标注子槽词表（`@scene_slot_labels`），沿用 NEM04 的 `场次：场名｜子槽：值` 口径；无新标注 → 存储字节级不变。
   - UI 契约：档案「大纲与结构」章卡片显示只读「场次计划」块（设计文档 `docs/design/ui/43-structure-panel.md` 新增 §5.0.5，copy 进 `frontend/src/lib/copy.ts`）。
2. **Invariant**：
   - ①无新子槽的旧计划 → `scene_plans` 键集合与字节级存储不变（NEM04 存量零影响）；
   - ②`scene_plans` 仍是**设计态**，绝不写作品事实/记忆/账本（ADR-0020 I2、VS-00E）；
   - ③`scene_units` 的 `unit_id` 稳定、场次 seq=行序；缺字段不伪造（缺 → 键不存在，不写空串/`N/A`）；
   - ④`causal_spine` 等新字段只从**规划字节**确定性投影，不做模型二次生成/字节修补（I1 因果绑定精神）；
   - ⑤产品代码无验收感知逻辑（不读 slice id/env/DOM hook）。
3. **Boundary**：
   - 允许改：`novel_domain`（`ChapterPlanDirection` 允许键、`ProseExecutionBrief` 渲染补 `sensory_anchor`/direct dialogue、`ChapterMissionInputs` 场次文本）、`novel_persistence`（`ChapterPlanParser` 词表 + 测试）、`novel_agent`（`real.ex` 章计划 prompt 场次格式说明）、`novel_application`（`ProseExecutionBriefBuilder` 映射、`exploration_service` 场次文本、`prose_execution_brief.built` trace 摘要字段）、`frontend/src`（`socket.ts` 类型 + `StructurePanel` 只读渲染 + `copy.ts`）、`scripts/seed_p1_prose_execution_brief.exs`、`frontend/slice-verify/*`、`quality/acceptance/*`、`docs/design/ui/43-structure-panel.md`、`tasks/`。
   - 明确不改：`scenes` 表 schema（NEM04 §3.1 的存储位裁决仍有效：设计态不进 production 行）；阅读链投影；采纳边界；六 app 依赖方向；不新增 ADR/不新增 schema JSON（消费既有 VS-00E 键）。
4. **Consumer**：第一消费者 `ProseExecutionBrief.to_prompt_section/1`（writer prompt 逐场执行结构）；第二消费者档案「大纲与结构」（作者核对）；第三消费者探索面 `chapter_read`（判断循环内可读）；质量评审已通过 `pacing_context.chapter_direction` 拿到 scene_plans，随本 slice 自动获得新字段。
5. **Proof**：
   - parser：新子槽逐项解析 + 旧格式/无标注字节等价负例；
   - domain：`ChapterPlanDirection` 允许键归一/存储往返 + `ProseExecutionBrief` 渲染（sensory/direct dialogue/部分 causal_spine）；
   - application：builder 映射（`planned_scene` 单元含 causal_spine/information_delta/dialogue_intent/sensory_anchor）+ 缺字段不伪造；
   - 探索面：`chapter_read` 渲染新子槽（单测）；
   - 真实页面：扩展既有真实 Tauri 场景 `p1-prose-execution-brief`（见 6）。
6. **Acceptance Driver**：扩既有 `p1-prose-execution-brief`（`scripts/tauri_slice_verify.sh p1-prose-execution-brief`；外部 Playwright driver + native verifier 断言 app JSONL/trace，不新增验收感知逻辑）：
   - 种子第 02 章场次行带新子槽 → 打开档案大纲**看到**场次计划（场名 + 目标/议程/情绪/阻力/转折/后果/信息差/对白/感官），可见文本断言；
   - 生成正文草稿 → `prose_execution_brief.built` 记录 `scene_unit_count==2` 且新字段覆盖；writer prompt 段含对应值（app log / llm http log 外部证据）；
   - brief 不进作品事实（draft 仍 tentative、正文不含结构标签）。
   - 产品代码新增验收感知逻辑：**no**。
7. **Exploration**：`chapter_read` 的「场次计划」同批扩展渲染新子槽（探索面同步律：场级要素一旦物化，判断循环内翼必须同批可读）；`chapter_mission_inputs` 的逐场 item 同步带新槽，保证写前推理选取可见。

## 3. 设计

### 3.1 逐场标注格式（向后兼容扩展）

```text
场次：对账｜目标：核对暗扣并确认被抽走的频段｜议程：沈洛要证据、摊主要脱身｜情绪：压抑｜阻力：摊主拖延并暗中报信｜转折：账单残页暴露抽签记录｜后果：暗扣被坐实、打草惊蛇｜读者得知：公司抽走频段｜主角得知：账单上有内部编号｜仍隐藏：幕后主使｜对白表面：对账寒暄｜潜台词：互相试探底线｜感官：潮湿霉味、风扇噪音
```

- **必须单行一条（硬约束）**：parser 是行级解析，续行会被静默丢弃；prompt/seed/示例一律单行。`场次/场景` 起始；`｜` 分隔子槽；无子槽容忍；`title` 必填否则整行丢弃。
- 词表（`@scene_slot_labels`）：`阻力|冲突`→`opposition`、`转折`→`turn`、`后果`→`consequence`、`读者得知|读者知道`→`reader_learns`、`主角得知`→`protagonist_learns`、`仍隐藏|隐藏`→`remains_hidden`、`对白表面`→`surface_topic`、`潜台词`→`hidden_conflict`、`感官|时空感官`→`sensory`；既有 `目标/议程/情绪` 不变。
- 单行过长风险：prompt 只要求“按叙事需要给出（没把握可省略）”，并说明子槽可任选；不做强制。

### 3.2 Domain 归一

`ChapterPlanDirection.normalize_scene_plan/1` 白名单扩到全部 **13 键**（title + 既有 3 + 新增 9：opposition/turn/consequence/reader_learns/protagonist_learns/remains_hidden/surface_topic/hidden_conflict/sensory）；空值丢弃；title 必填。存储格式不变（string-keyed map list，`plan_direction` map 列）。子槽渲染词表收敛为 `ChapterPlanDirection.scene_slot_lines/1`（探索面与写前推理共用，CP1 实施记录）。

### 3.3 简报映射（`ProseExecutionBriefBuilder`）

`planned_scene` 路径逐场构造（缺省不写键，保持 `drop_empty_values` 语义）：

| scene_plan 键 | scene_unit 键 | 形状 |
|---|---|---|
| `opposition/turn/consequence` | `causal_spine` | `{opposition_or_dilemma, turn, consequence}`（`goal` 省略：避免与 `target_change` 重复；契约字段可缺省） |
| `reader_learns/protagonist_learns/remains_hidden` | `information_delta` | 同名键 map |
| `surface_topic/hidden_conflict` | `dialogue_intent` | `mode`: 有 `hidden_conflict`→`subtext`，否则 `direct`；`surface_topic`/`hidden_conflict` 原样 |
| `sensory` | `sensory_anchor` | 按 `、，,；;` 切分为非空字符串数组；单值也可 |

### 3.4 简报渲染补全（`ProseExecutionBrief`）

- 新增 `sensory_line/1` → `· 感官锚点：a、b`；
- `dialogue_line/1` 增 `direct` 模式渲染（`对话意图：表面谈…`）；`subtext` 缺字段时只渲染存在字段，不拼出空洞句式；
- `causal_line/1` 已支持部分字段，无需改。

### 3.5 档案可见（只读）

`StructurePanel` 大纲 tab 章卡片（本章使命块之后）渲染：

```text
场次计划（2 场）
1. 对账
   目标：… 议程：… 情绪：…
   因果：阻力…；转折…；后果…
   信息差：读者得知…；主角得知…；仍隐藏…
   对白：表面谈…；暗里争…
   感官：…、…
2. 夜巡 …
```

- 无 `scene_plans` 的章不显示该块（诚实缺席）；
- 只读，不新增 author_action（本 slice YAGNI）；
- 文案进 `copy.ts`（`structurePanel.scenePlans.*`）；类型 `TocChapter.plan_direction` 增 `scene_plans?: ScenePlanDto[]`；
- 设计文档 `43-structure-panel.md` 新增 §5.0.5（含可视化层级与只读边界）。

### 3.6 可观测（trace 摘要，非验收钩子）

`prose_execution_brief.built` 事件在既有 `scene_unit_count/brief_source` 之外补 `scene_field_coverage`（**并集去重 + VS-00E §1 契约字段顺序**：`target_change, causal_spine, character_agendas, information_delta, emotion_transition, dialogue_intent, sensory_anchor` 中实际出现的字段名数组），供真实页面验收与线上排障读取；不记录正文/`unit_id`。验收断言用「包含」而非严格全序。

## 4. CP 拆分

| CP | 内容 | Proof |
|---|---|---|
| **CP1** 解析/归一/简报/渲染/探索面 | parser 词表 + direction 白名单 + builder 映射 + brief 渲染（sensory/direct dialogue）+ exploration/chapter_mission_inputs 场次文本 + trace coverage + 单测 | 后端聚焦测试 + 全量回归（无新标注旧计划零差异） | **done（2026-10-22）** |
| **CP2** 档案可见 + 真实页面验收 | `socket.ts` 类型 + `StructurePanel` 渲染 + `copy.ts` + 43 §5.0.5 + 种子扩新子槽 + `p1-prose-execution-brief` driver/verifier/场景断言扩展 | `tauri_slice_verify.sh p1-prose-execution-brief` 真实 Tauri PASS；前端 typecheck/lint/test | **done（2026-10-22，真实 Tauri PASS）** |

**最小实现步不缩范围**：CP1 单独交付不算 slice done——必须 CP2 真实页面看到场次计划 + 简报新字段进入写作链路。

## 4b. 交付结果（2026-10-22）

**CP1 后端（done）**：`@scene_slot_labels` 扩 8 组词表；`ChapterPlanDirection` 白名单 13 键 + 共用渲染纯函数 `scene_slot_lines/1`；`ProseExecutionBrief` 补感官锚点行/direct 对白/缺字段不拼空洞 + `field_coverage/1`；builder 把 `opposition/turn/consequence → causal_spine`、信息差、对白意图、感官锚点确定性映射（缺省不写键）；`chapter_read` 与 `ChapterMissionInputs` 同批渲染新槽；plot_outline prompt 扩新子槽（保三锚点）；`prose_execution_brief.built.done` 增 `scene_field_coverage`（并集去重 + VS-00E §1 顺序，不含正文）。测试：parser/direction/brief/builder/exploration/mission_inputs/real prompt/trace 全补；全量 `mix test` **1,651/0**、compile --warnings-as-errors、xref 无环、arch 通过、I1/I2/I3/N-NARR/I-CACHE-1 绿。

**CP2 前端 + 验收（done）**：`ScenePlanDto`/`TocChapter.plan_direction.scene_plans` 类型；`scenePlanView.ts` 纯函数（缺字段不造行、无数据返回 null）+ 8 单测；`StructurePanel` 章卡片（本章使命块后）只读「场次计划（N 场）」块（目标/议程/情绪/因果/信息差/对白/感官；组内只渲染存在子槽；无 author_action/data-testid/新请求）；`copy.ts` 集中文案；`43-structure-panel.md` §5.0.5。前端 **32 files / 505 tests**、audit 27、design trace 16 绿。

**真实页面验收（外部自动化，真实 Tauri）**：`PHOENIX_PORT=4656 VITE_DEV_PORT=5770 bash scripts/tauri_slice_verify.sh p1-prose-execution-brief` → **exit 0 / passed**（默认端口被用户 `scripts/stage.sh` 占用，改用脚本官方支持 env 端口；未杀用户进程）。证据 `artifacts/slice-verify/p1-prose-execution-brief-tauri/summary.json`：
- 档案大纲可见「场次计划（2 场）」「1. 对账」「2. 夜巡」及 9/9 新子槽行内片段（阻力/转折/后果/读者得知/主角得知/仍隐藏/表面谈/暗里争/感官）；第二场刻意缺 6 槽 → UI 未伪造空行；
- `scene_unit_count=2`、`brief_source=chapter_plan_scene_plans`、`degraded=false`、`scene_field_coverage` 含全部 4 个新字段（按包含断言，不锁全序）；writer prompt（llm-calls 外证）含 `场：对账`/`场：夜巡` 与因果/信息变化/对话意图/感官锚点；
- draft 仍 tentative、无 adopt 事件、正文不含执行简述；`has_plan_direction=true`；产品代码新增验收感知逻辑 **no**。
证据截图：`artifacts/slice-verify/p1-prose-execution-brief-tauri/p1-prose-execution-brief-scene-plan.png`。

**诚实边界**：
- 本 slice 交付的是「章级 draft + 场级执行简述 + 场级计划可见」，**不是多场正文**；阅读链仍按章级 draft 投影（多场正文/场级质量归 B11D/后续）。
- 首次 append 场名误标（B21）为既有缺陷，本 slice 未修（登记 CP3 候选）。
- 真实规划模型是否稳定产出新子槽没有新证据（seed 手写证明链路；真实模型样本归狗粮观察）；UI 对无 `scene_plans` 的存量章一整块不渲染（诚实缺席，NEM04 不回填拍板仍有效）。
- `quality_manifest_check` 整命令仍因两个 HEAD 既有未登记 browser driver exit 1（本次改动前即存在）；本 slice 扩的是既有已注册 `p1-prose-execution-brief` 场景，未新增未登记 driver。

## 5. 明确不做（YAGNI / 诚实登记）

- E28 动作编排、E29 内心戏、E30 场间过渡：无契约 key，等真实创作动作拉动（NEM-GAP-04 余项保留）；
- `scenes` 表加 craft 列：NEM04 §3.1 存储位裁决仍有效（设计态不进 production 行）；本 slice 不重开；
- 场次计划作者编辑/增删改：本 slice 只读可见；
- 阅读模式场级 UI 变化：阅读链不动；
- 存量「场景 N」回填：NEM04 拍板③仍有效；
- **CP3（下一 checkpoint，登记未做）**：多场计划首次 append 的场名误标——D7 后 `authoring_intent=nil` 走 `:append`，首次 append `seq=1` 会把整章正文命名为 `scene_plans[0].title`，阅读模式因此把整章挂到"第 1 场"（真实 m5 数据：3 场计划只落 1 个 scene 行）。修复方向：首次 append 不回填计划场名（保持占位、阅读端隐藏），或引入 artifact 场作用域；需单测 + 采纳→阅读真实页面断言；
- **质量场粒度（B11D 候选）**：`QualityFinding` scope 只有 local/paragraph/chapter，`brief_field_refs` 未在质量卡展示，作者无法按场修订；
- **E28/E29/E30**：动作编排/内心戏/场间过渡无契约 key，继续挂 NEM-GAP-04。

## 6. 风险

| 风险 | 处置 |
|---|---|
| prompt 场次行变长导致模型漏写/写坏 | 子槽全部可选 + “没把握可省略”措辞；真实模型质量归狗粮观察，不在本 slice 用替身证明 |
| 新字段与 `target_change` 语义重叠 | `causal_spine.goal` 不产；`目标` 仍只进 `target_change`，避免 prompt 重复 |
| UI 信息过载 | 场次块只在展开章显示、按场分组；只显示存在字段；沿用 43 §L1-L4 渐进披露 |
| I1 字节绑定 | 新字段全部来自规划 artifact 字节的确定性解析，无拼接/修补；增负例测试 |
| 旧计划回归 | 无新子槽时归一/存储/简报逐字节等价，parser 既有测试 + 新增负例 |

## 7. 决策日志

- 2026-10-22 — 作者拍板 B11③ 开工。开工核查发现「场级 craft 只差落库」的旧推荐口径已过时：NEM04（2026-08-11）已完成最小三槽落库 + 简报多场展开 + 场景命名；本 slice 据实际代码状态重新定义为「VS-00E 设计全集补全 + 作者可见」，不重做已交付部分。E28-E30 继续挂 NEM-GAP-04 余项。
