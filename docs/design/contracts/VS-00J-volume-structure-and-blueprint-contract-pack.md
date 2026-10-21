# VS-00J 卷结构与卷级蓝图 Contract Pack

> 状态：**Frozen（2026-10-22，作者"做 B11① 卷结构（大周期）"开工授权；§9 四项开放决策按建议默认拍板，可在对应 CP 内凭证据/作者裁决翻案）**
>
> 授权来源：`docs/design/08-novel-element-model.md` §8 序位 6「卷级蓝图随『开新卷』创作动作提出时冻结」——作者 2026-10-22 拍板主线顺序 B13a → B11③ → B11①，B11① 即该创作动作的提出；`tasks/NEXT.md` B11 台账（volumes 表退化使用）；`tasks/slices/AU08-volume-structured-planning.md`（卷容器/逐章卷归属/目录分层已交付，本包只补卷级蓝图与动作，不重做）。
>
> 三条基准纪律适用：场景化验收红线（AGENTS.md）；contract pack 不授权代码实现，实现须经 slice（`tasks/slices/B11A-volume-blueprint.md`）与 ADR-0028；`novel_domain` 纯函数、`novel_persistence` Ecto、`novel_agent` 不得引用 domain/application 的 umbrella 边界不变。
>
> 关闭缺口：NEM-GAP-07（卷级蓝图无结构 + volumes 表退化）。**不关闭**：arc 对象化（NEM-GAP-02 余项）、五本账按卷聚合、`memory_items.volume_id` 接线。

---

## 1. 范围与真实作者问句

| 对象 | 真实作者问句（答不出即砍） |
|---|---|
| 卷级蓝图（E14-E17） | 我写到第二卷时，AI 知不知道这一卷要解决什么冲突、哪些支线该启动/收束、哪里该放高潮和缓冲、什么时候引入新地图/新人物？ |
| 卷结构写入 | 分卷规划被采纳后，卷行除了标题还留下什么？作者能不能看到并核对？ |
| 开新卷动作 | 作者说"开第二卷 / 该换地图了"，系统能不能先给方向候选、再让作者定卷纲，而不是凭空开一个空卷？ |
| 卷级收束 | 每卷可以有本卷小收束；这个"小收束"和全书"禁终局"守则谁优先？ |
| 计划卷数与事实卷数 | 作者立项说 2 卷、实际写到第 3 卷时，系统以哪个为准、是否会被静默改写？ |

非目标（本包明确不做）：

- arc 对象/表（`volume -> arc -> chapter` 的 arc 层仍无对象，NEM-GAP-02 余项）；
- 五本账按卷聚合与 `memory_items.volume_id` 召回接线；
- 卷内章号局部序列（AU08 已裁决 `chapter.seq` 为 work 级全局，本包不推翻）；
- 卷改名/重排 UI、卷蓝图作者手编 UI（CP4 只做只读展示）；
- E14-E17 背后的完整枚举与字段全集（本包只冻结最小结构化槽，见 §2）。

---

## 2. 卷级蓝图对象（E14-E17 最小结构化槽）

### 2.1 存储位（第四纪律阶梯：既有 map 列承载）

`volumes` 表**新增单列 `blueprint`（`:map`，nullable，默认 nil）**，不加 E14-E17 多列。理由与 `chapters.plan_direction`（NEM04/VS-00C）同款：卷级蓝图是**设计态 map**，键集合会随创作动作演化，map 列避免每加一个要素就 migration；物化/读取仍由 domain 纯函数白名单归一，不做自由 map 透传。

```text
volumes
  id / work_id / title / seq / status / timestamps      # 既有
  blueprint :map | nil                                   # 新增（本包）
```

`blueprint` 键集合（string keys；空值丢弃；**键不存在 = 未立蓝图**）：

| 键 | 要素 | 类型 | 语义 |
|---|---|---|---|
| `status` | — | enum | `TENTATIVE` / `CONFIRMED` / `AUTHOR_EDITED`（与 `chapter_mission_status` 同款三态；作废=删键） |
| `source_ref` | — | string | 来源引用，`artifact:<artifact_id>`（与 `design_ref` 同风格） |
| `goal_conflict` | E14 | string | 本卷要解决的核心冲突/任务 |
| `arc_stage` | E14 | string | 本卷人物走到弧光哪一步 |
| `map_boundary` | E14 | string | 本卷地图/副本/舞台边界 |
| `subplots_start` | E15 | string | 本卷启动的支线 |
| `subplots_advance` | E15 | string | 本卷推进的支线 |
| `subplots_close` | E15 | string | 本卷收束的支线 |
| `climaxes` | E16 | string | 小高潮/爽点位置（**用章标题引用**，见 §2.2） |
| `payoff_density` | E16 | string | 爽点密度/节奏说明 |
| `buffers` | E16 | string | 缓冲章/过渡位置（章标题引用） |
| `new_characters` | E17 | string | 本卷引入的新人物 |
| `new_settings` | E17 | string | 本卷引入的新设定 |
| `new_maps` | E17 | string | 本卷引入的新地图/副本 |

**引用口径（冻结）**：蓝图里提到具体章时**只能写章标题文本**，不写数字章号。理由：章号是 work 级全局派生值（AU08 CP1），卷内"第 3 章"与全局 seq 不一致时必然误读；章标题是作者可核对、可从 `chapters.title` 反查的稳定文本。

### 2.2 卷身份（稳定键）与改名语义

- **卷身份 = `(work_id, seq)`**；`title` 只是属性。
- 卷蓝图块若携带卷序号（`序号：N`）：物化按 `(work_id, seq)` 解析；同序号卷已存在时，**只在标题不同时更新 title**（采纳新大纲即作者授权改名），不得新建重复卷。
- 旧格式（只有逐章 `所属卷：卷标题`、无卷蓝图块）保持 `(work_id, title)` 幂等与既有行为**逐字节一致**（AU08 兼容口径）。
- 卷序 append-only（`max(seq)+1`）；本包不提供卷重排/删除。

### 2.3 卷行状态修复

`insert_volume` 目前恒写 `status=COMPLETED`（B11 侦察实锤），使卷状态机建立在假值上。本包冻结：

- **规划物化**（章计划/卷蓝图采纳）建出的卷 → `status=PLANNED`；
- **正文采纳**在无卷信息时自动建的规范单卷 → 保持 `COMPLETED`（存量/单卷逐字节等价，不推翻既有数据语义）；
- 卷状态推进（PLANNED→DRAFTING→COMPLETED）本包不新增自动推进，留给后续真实动作拉动。

---

## 3. 产出路径

### 3.1 路径 A（CP2，本周期）：plot_outline 批量产卷蓝图块

`plot_outline` 是既有唯一规划产出动作（capability 目录已宣称"规划卷纲"，`volume_plan` write scope 早已留位但无消费者）。本包把留位兑现：

- 仅当作品 `planned_volumes > 1` 或作者本轮显式要求分卷规划时，prompt 在既有章块格式之外增加**卷蓝图行**（每卷一行，`｜` 分隔子槽，与场次行同款解析纪律）：

```text
卷蓝图：第一卷｜序号：1｜目标冲突：…｜弧光阶段：…｜地图边界：…
｜支线启动：…｜支线推进：…｜支线收束：…｜高潮章：章标题A、章标题B｜爽点密度：…｜缓冲章：…｜新人物：…｜新设定：…｜新地图：…
```

- `ChapterPlanParser` 先抽取卷蓝图行（**抽离后再参与章块解析**，防 `第二卷：裂变` 被当章起始行劈出假章），产出 `volume_blueprints: [%{seq, title, blueprint}]`；无卷蓝图行时键不存在、一切现状不变。
- 物化：采纳该 `outline_draft` 后逐卷 `upsert_volume_blueprint(work_id, seq, title, blueprint)`（§2.2 解析顺序）；同时既有逐章 `所属卷` 继续决定章归属（两条口径不冲突：蓝图定"卷是什么"，章标注定"章挂哪卷"）。
- 卷蓝图是**采纳产物的一部分**：未采纳的候选不写 `volumes`（ADR-0019 INV-1）；采纳即作者对卷纲的定稿授权（32 §6.4 卷纲定稿语义，不新增确认门）。

### 3.2 路径 B（CP3，后续 checkpoint）：开新卷动作

**默认形态 A（§9 决策①）**：不新增 capability/artifact 类型，复用 `plot_outline_with_context` + 作者意图作用域：

- 作者说"开第二卷 / 换地图 / 该收束第一卷了"→ 判断循环（ADR-0025）识别为规划意图并带 **`volume_scope: %{next_seq: N}`** 结构化作用域（由机械上下文给出当前卷数与末章位置，不让模型猜）；
- planner 只产**下一卷**的卷蓝图 + 该卷前若干章计划（候选仍是 `outline_draft`，走既有候选卡/采纳管道）；
- 采纳后按 §2.2 建/更新卷行 + 蓝图，章计划照旧落章。
- 明确不做：新 artifact_type、新卡型、独立"卷管理"页面；如后续真实作者反馈需要独立入口，再按 ADR 修订。

### 3.3 不产出蓝图的合法情形

- 单卷书（`planned_volumes <= 1`）：不发卷蓝图指令，行为与今天一致；
- 作者不要求分卷、计划无卷蓝图行：不伪造蓝图（键不存在）；
- 蓝图缺子槽：允许部分填写，缺省键不存在（诚实缺席，不写 `N/A`）。

---

## 4. 消费面（每个都必须有真实消费者，否则砍）

| # | 消费面 | 投影 | CP |
|---|---|---|---|
| 1 | 档案「大纲与结构」 | 卷头下只读显示蓝图要点（目标冲突/支线/高潮/新要素），无蓝图不渲染 | CP4 |
| 2 | 规划上下文 | planner 注入「当前卷蓝图 + 本卷进度」（章数/已写章标题），WritingCoordinate 带 `volume_ref` | CP4 |
| 3 | 写作/章使命上下文 | `chapter_mission_inputs` 取当前卷目标冲突/弧光阶段作为设计态输入（缺省不注入） | CP4 |
| 4 | 探索面 | `chapter_read`/profile 探索面同批可读当前卷蓝图与卷分布（08 §8 探索面同步律） | CP4 |
| 5 | 卷级收束 | `WorkSkeleton` 卷内守则（本卷可小收束；全书禁终局优先） | CP5 |
| 6 | 三态对账 design_ref | 卷蓝图 ref 形状冻结为 `volume_blueprint:<volume_id>`，供后续 R2/承诺账引用（本包只定形状，不接线） | CP4 |

---

## 5. 不变量（冻结）

1. **I-VOL-1 章归属唯一**：每章恰属 1 卷（既有 `chapter.volume_id` non-null），卷蓝图不改变章归属判定。
2. **I-VOL-2 章号全局**：`chapter.seq` 在 work 内全局唯一单调（AU08 CP1 裁决不变）；卷内局部序号只能是派生值，不得落列/写入。
3. **I-VOL-3 卷身份稳定**：`(work_id, seq)` 是卷身份；标题可变；采纳新大纲不得因改名新建重复卷。
4. **I-VOL-4 退化等价**：无卷蓝图（`blueprint` nil）时 TOC、探索面、prompt、面板输出与今天逐字节一致。
5. **I-VOL-5 采纳边界**：卷蓝图只经 `outline_draft` 采纳进入权威层；未采纳候选不改 `volumes`；作者裁决只经既有 author_action（不新增静默写路径）。
6. **I-VOL-6 意图/事实分离**：`works.planned_volumes`（意图）与 `volumes` 行（事实）不一致时不得静默改写任一方；由 CP5 设计负债规则提示，不阻断写作。
7. **I-VOL-7 收束优先级**：全书收束守则（距目标体量尚远禁终局/完结）优先于卷级收束；卷级只允许"本卷收束/转入下一卷"措辞。
8. **I-VOL-8 设计态边界**：`blueprint` 是设计态，不写作品事实/记忆/账本；brief/上下文可读，采纳链仍只写 `volumes` 行。

---

## 6. CP 路线（与 slice 档一致）

| CP | 内容 | 独立交付 | 依赖 |
|---|---|---|---|
| CP0 | 本 pack Frozen + ADR-0028 + slice 七问 + 相关设计文档留位修订 + NEXT 拆分 | ✓（纯文档） | — |
| CP1 | `volumes.blueprint` 迁移 + Volume schema/domain `VolumeBlueprint`（归一/渲染/三态）+ 卷状态修复 + 采纳 upsert + 读投影暴露 | ✗ 必须与 CP2 同批 | CP0 |
| CP2 | prompt 卷蓝图块 + parser 卷块抽取 + 物化 + 候选卡展示 | ✗ 与 CP1 同批 | CP0 |
| CP3 | 开新卷动作（作用域 A）+ 判断/规划链 + 候选→采纳 | ✓ | CP1/CP2 |
| CP4 | 卷蓝图消费面（档案/规划/章使命/探索/坐标/design_ref 形状） | ✓ | CP1 |
| CP5 | 卷级收束 + 计划卷数/事实卷数负债规则 + 真实页面验收 | ✗ 与 CP4 同批验收 | CP2/CP3/CP4 |

CP1+CP2 不单独算 done（"只建字段/只加解析"是 AGENTS.md 禁止的任务形态）；CP4+CP5 必须由外部自动化驱动真实页面（扩 `au08-volume-structured-planning`，优先扩既有场景而非新建）。

---

## 7. 与 B11③（场级 craft）的协同

两者都改 `plot_outline` prompt 与 `ChapterPlanParser`：B11C 先落（场次行 E25-E30 扩展），B11A CP2 复用同一"行块抽取先于章块解析"纪律；卷蓝图行与场次行共用 `split_label`/`label_line?` 防护，**不得**让卷块标题劈出假章（`第二卷：裂变` 是已知雷）。两批 parser 改动若同时在场，按"卷蓝图行 → 场次行 → 章块"顺序单趟抽取。

---

## 8. Proof

- CP0：本文 + ADR-0028 落档；`mix run scripts/adr_trace.exs` 保持绿（ADR-0028 Proposed 不参与门禁）；`node scripts/next_task_check.mjs` 绿。
- CP1/CP2：domain 归一/渲染/三态单测；parser 卷块单测（含假章负例、无卷块字节等价）；物化单测（幂等/改名不建重复卷/单卷退化）；`reading_projection` 无蓝图字节等价；全量后端回归。
- CP4/CP5：扩 `au08-volume-structured-planning` 真实 Tauri：作者规划多卷 → 采纳 → 档案可见卷蓝图 → 写作/规划上下文带当前卷目标 → 卷级收束措辞不越全书终局门禁；I1/I2/I3 绿。

---

## 9. 四项开放决策（作者开工授权按建议默认，可翻案）

| # | 决策 | 默认（已按此冻结） | 翻案条件 |
|---|---|---|---|
| ① | 开新卷入口形态 | **A：复用 plot_outline + `volume_scope` 作用域**，不新增 capability/artifact 类型/卡型 | 真实作者反馈需要独立卷管理入口时按 ADR 修订 |
| ② | 卷级收束语义 | 允许"本卷小收束/卷终局"，**全书禁终局守则优先**；任何"全书完结/大结局"仍由全书进度门禁裁决 | 长篇狗粮证明需要更强的卷级门禁时另行冻结 |
| ③ | 卷蓝图是否必须采纳才生效 / 定稿后才允许批量写该卷 | **采纳才生效**；**不新增**"定稿后才允许批量写该卷"的 gate（32 §6.4 只作策略默认，不升级为阻断） | 真实误写事故拉动时再冻结 |
| ④ | `planned_volumes` 与事实卷数不一致 | **事实优先**，不静默改写任一方；CP5 设计负债规则提示，不阻断写作 | 作者明确要求以意图为准时按 ADR 修订 |

---

## 10. 变更记录

- 2026-10-22 — **CP5 卷级收束与负债规则落地**：`WorkSkeleton.volume_closure_directive/3`（全书收束优先；本卷写完/接近收束（卷级阈值 0.8）/一般卷三档）在 CP4 卷蓝图段后注入 writer/planner；`LedgerReconciliation` R10（计划卷数 vs 事实卷数）/R11（多卷缺蓝图）接入 `scan`（最小只读 volumes 端口，缺席/读失败不阻断）；真实 Tauri au08 第三轮扩展 PASS（writer prompt 默认分支收束段）。R10/R11 finding 真实触发验收待补。
- 2026-10-22 — **CP4 完整消费面落地**：structured_chapters 卷键 + ContextAssembler 透传；`WorkSkeleton.volume_blueprint_section/3` 注入 planner/prose 上下文（carry 登记门）；`WritingCoordinate.volume_ref`；`ChapterMissionInputs` 卷材料；`chapter_read` 探索面；`VolumeBlueprint.design_ref/1` 形状（不接五笔账）。真实 Tauri au08 扩展 PASS：writer prompt 恰一份卷蓝图段、坐标 volume_ref == TOC 当前卷 id。
- 2026-10-22 — **CP1+CP2+CP4-lite 落地**：`volumes.blueprint` map 列 + enum codegen；`VolumeBlueprint` 归一/渲染；`ChapterPlanParser.parse_with_volumes/1`（卷蓝图行先于章块抽取、单行、按 `(work_id,seq)` 物化、改名不重复建卷）；`WorkSkeleton.volume_directive/1` 多卷时增补卷蓝图行指令；`insert_volume` 状态修复（计划物化 PLANNED / 正文规范单卷 COMPLETED）；TOC 卷节点暴露 blueprint；档案大纲卷蓝图只读可见。CP3（开新卷动作）、CP5（卷级收束/负债规则）、CP4 完整消费面与真实页面验收仍未做，见 ADR-0028 enforcement_gaps。
- 2026-10-22 — 初版 Frozen（CP0）：作者开工授权按 §9 默认拍板；E14-E17 最小槽冻结；卷身份/章引用/状态修复/收紧优先级/退化等价等 8 条不变量；CP0-CP5 路线。来源为 B11 侦察（2026-10-22，证据见 slice 档 §0）。
