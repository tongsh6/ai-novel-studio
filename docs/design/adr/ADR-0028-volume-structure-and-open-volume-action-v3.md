# ADR-0028：卷结构与开新卷动作 v3

- 状态：**Accepted（2026-10-22，作者「做 B11① 卷结构（大周期）」开工授权；CP0–CP5 全落，真实 Tauri `au08-volume-structured-planning` 三轮扩展 PASS；长尾缺口在 enforcement_gaps 诚实登记）**
- 日期：2026-10-22
- 来源文档：
  - `../contracts/VS-00J-volume-structure-and-blueprint-contract-pack.md`（本 ADR 的契约载体，已按作者开工授权 Frozen）
  - `../08-novel-element-model.md` §4.2 E14-E17 / §6.2 NEM-GAP-07 / §8 序位 6
  - `../domain/21-novel-object-model.md` §6.4 / §10.2
  - `../domain/34-novel-element-field-priority.md` §4.4（卷/单元候选字段）
  - `../quality/32-human-approval-policy.md` §6.4（卷纲定稿语义）
  - `../ui/45-guided-conversation-flows.md` §4.2（新卷/新章规划流；Pencil `45§3-new-volume-chapter-flow`）
  - `tasks/slices/AU08-volume-structured-planning.md`（已交付的卷容器/章归属/目录分层）
- 影响范围：Domain（卷对象）/ Persistence（volumes 列、物化）/ Agent（plot_outline prompt）/ Application（采纳、规划注入、坐标）/ UI（档案卷蓝图只读）/ Slice（B11A）
- 相关不变量：VS-00J §5 I-VOL-1～8；ADR-0010 INV-1（采纳边界）、ADR-0019（状态转换）、ADR-0021（run/turn 边界）不破
- 首个证明 slice：`tasks/slices/B11A-volume-blueprint.md`（CP1-CP5）
- 取代：无
- 取代者：无

---

## 背景

AU08（2026-07-30）已交付"卷容器 + 逐章卷归属 + 目录分层"，但 `volumes` 表仍只有 `work_id/title/seq/status`：E14 卷目标、E15 支线编织、E16 节奏蓝图、E17 新要素释放计划**零字段、零产出、零消费**；产品里也不存在"开新卷"创作动作（判断目录/Channel/步骤目录/UI 均无入口；capability 的 `volume_plan` write scope 是无人消费的留位）。

同时侦察实锤两个既有缺陷：

1. `insert_volume` 恒写 `status=COMPLETED`，卷状态机建立在假值上；
2. 工作台头部"当前卷"硬编码 `"未定卷"`，写作坐标是假坐标。

B11 台账、08 §8 序位 6、VS-00G 非目标共同约定：卷级蓝图随"开新卷"创作动作的 slice 提出时再冻结。作者 2026-10-22 拍板主线顺序 B13a → B11③ → B11①，本 ADR 即该触发条件。

## 决策范围

本 ADR 冻结：

1. 卷是 canonical middle-structure unit（`work → volume → chapter`）；arc 仍不建表（NEM-GAP-02 余项）。
2. 卷级蓝图是**设计态 map**，存 `volumes.blueprint`（单列），键集合见 VS-00J §2.1；不新增 E14-E17 多列。
3. 卷身份 = `(work_id, seq)`；标题可变；旧格式按标题幂等兼容。
4. 卷蓝图产出路径 A：`plot_outline` 批量产"卷蓝图行"，经既有 `outline_draft` 候选/采纳管道物化；不新增 artifact 类型/卡型。
5. "开新卷"动作默认形态 A：复用 `plot_outline_with_context` + 机械提供的 `volume_scope`，不新增 capability（VS-00J §9 决策①）。
6. 卷行状态修复：规划物化卷写 `PLANNED`，正文自动规范单卷保持 `COMPLETED`。
7. 卷级收束优先级：全书禁终局守则优先，卷级只允许"本卷收束/转入下一卷"措辞。
8. `planned_volumes`（意图）与真实卷数（事实）分离，不一致走负债提示，不静默改写、不阻断写作。
9. 卷蓝图的消费面必须有真实消费者：档案只读、规划注入、章使命输入、探索面、卷级收束、design_ref 形状 `volume_blueprint:<volume_id>`（VS-00J §4）。

## 非目标

- arc 对象/表与 `volume -> arc -> chapter` 的 arc 层落地；
- 五本账按卷聚合、`memory_items.volume_id` 召回接线；
- 卷内章号局部序列（维持 AU08 全局 `chapter.seq`）；
- 卷改名/重排/删除 UI、卷蓝图作者手编；
- E14-E17 完整枚举与字段全集；
- 批量写该卷前的强制确认门（VS-00J §9 决策③默认不做）。

## 考虑过的方案

### 方案 A：复用既有采纳管道，卷蓝图作为 outline_draft 的结构化块（采纳）

- 优点：复用 `ChapterPlanParser`/候选卡/采纳边界/物化，改动面最小；与 AU08 先例同构；作者在一个"规划卷章结构"动作里同时定卷纲与章计划；不新增 capability/artifact/卡型。
- 缺点：`outline_draft` content 文本变长；parser 需要单趟块抽取纪律（卷蓝图行先于章块，防假章）。

### 方案 B：新增 `volume_planning` capability + `volume_plan_draft` artifact + 独立卷管理 UI

- 优点：语义最正，卷纲动作可独立触发与展示。
- 缺点：要动 `tool_output_contract`/`adoption_workflow`/Channel 三处类型分派/`StructurePanel` tab/`WorkspaceChat` 动作识别与 copy；本轮改动面与返工风险远高于收益；45 §4.2 的方向候选流与既有 plot_outline 已能承载。

### 方案 C：作者手动建卷（表单式）

- 优点：最省实现。
- 缺点：违背"AI 引导 + 方向候选"的产品定位；卷纲内容仍要 AI 产，等于绕回 A 且多一套入口。

**最终决策：A。** 方案 B/C 不采纳；若真实作者反馈需要独立入口，按 ADR 修订（VS-00J §9 决策①翻案条件）。

## 决策理由

- **最小改动承重**：卷结构真正的承重点是"卷级事实有结构并被消费"，不是"多一个按钮"。A 让卷纲与章计划同轮产出、同轮采纳，作者一次确认即定卷纲+章方向。
- **不重蹈 AU08 的雷**：卷身份必须与标题解耦（改名不建重复卷）、卷块不能劈出假章、卷状态不能是假值——这三条在 ADR 冻结，而不是留到实现时各自发明。
- **诚实降级**：无蓝图时逐字节等价，单卷书零影响；卷蓝图缺子槽不伪造。

## Contract 影响

- 新增 `docs/design/contracts/VS-00J-volume-structure-and-blueprint-contract-pack.md`（Frozen）。
- `volumes` 增 `blueprint :map | nil` 列（migration，CP1）。
- `ChapterPlanParser` 输出增 `volume_blueprints`（无卷块时键不存在）。
- `reading_projection` 的 TOC 卷节点增 `blueprint`（nil 时不输出/保持现状）。
- `WritingCoordinate` 的 `volume_ref` 兑现（CP4；VS-00C 已冻结形状）。
- `design_ref` 的卷蓝图 ref 形状冻结为 `volume_blueprint:<volume_id>`。

## Umbrella 边界影响

- `novel_domain`：新增 `VolumeBlueprint` 纯函数模块；`WorkSkeleton` 增卷级守则；不改五本账。
- `novel_persistence`：migration + `Volume` schema + `AdoptionRepository` 物化/upsert + `reading_projection` 投影；不引用 web/application/agent。
- `novel_agent`：只改 `real.ex` plot_outline prompt 输出格式说明；不引用 domain/application。
- `novel_application`：采纳分支、规划注入、章使命输入、坐标；不新增绕过采纳的写路径。
- `novel_web`：Channel get_toc 透传 blueprint（无新 handler）。
- `frontend`：档案只读展示 + 当前卷坐标修复（CP4）；无验收感知逻辑。
- 明确不改：`novel_e2e` 边界（仍只依赖 novel_web）；阅读链结构（已就绪）。

## UI / Trace / Replay 影响

- UI：卷蓝图在「大纲与结构」卷头下只读展示（CP4）；「当前卷」由真实写作坐标驱动，替换硬编码"未定卷"；不新增卡型。
- Trace：卷蓝图采纳走既有 artifact adoption trace；`design_ref` 只存 `volume_blueprint:<id>` 引用，不落蓝图原文；不新增 Channel 事件。
- Replay：卷蓝图作为设计态可从 artifact/replay 回放；不写作品事实。

## 垂直切面证明

- CP0：本文 + VS-00J + slice 七问落档；`adr_trace` / `next_task_check` 绿。
- CP1+CP2：parser/物化/domain 单测 + 全量回归；无卷块与无蓝图路径字节等价。
- CP3：真实页面"开第二卷"→方向候选→采纳→卷行与蓝图落档。
- CP4+CP5：扩既有 `au08-volume-structured-planning` 真实 Tauri：规划多卷 → 采纳 → 档案看到卷蓝图 → 后续规划/写作上下文带当前卷目标 → 收束措辞不越全书终局门禁；I1/I2/I3 绿。
- **未闭环不得写 done**：只建字段/只加 parser 不算切片完成（AGENTS.md 禁止任务形态）。

## 迁移与兼容

- 存量 `volumes` 行 `blueprint` 为 NULL：TOC/探索/prompt/面板逐字节不变（I-VOL-4）。
- 存量 `status=COMPLETED` 的自动单卷语义保留；仅新规划物化卷写 `PLANNED`。
- 旧格式逐章 `所属卷`（无卷蓝图块）保持标题幂等；新格式卷块按 `(work_id, seq)` 解析。
- 不引用/不废弃任何 v2 约束；VS-00G 非目标句同步改为"卷级蓝图归 VS-00J"。

## 后续工作

- 本 ADR 已转 Accepted（2026-10-22）；CP0–CP5 全部落地并有真实 Tauri au08 三轮扩展证据；`## enforced_by` 引用各 CP 真实文件，长尾缺口列 `## enforcement_gaps`。
- B11A CP1+CP2（同批）→ CP3 → CP4+CP5；每 CP 更新 `tasks/NEXT.md` 与 slice 档。
- CP5 收尾时同步 `08` NEM-GAP-07 状态、`21`/`34` 的"暂不冻结"注记、`VS-00F` design_ref 卷蓝图形状。

## enforced_by

- apps/novel_domain/lib/novel_domain/volume_blueprint.ex
- apps/novel_domain/lib/novel_domain/volume.ex
- apps/novel_domain/lib/novel_domain/work_skeleton.ex
- apps/novel_domain/test/novel_domain/volume_blueprint_test.exs
- apps/novel_domain/test/novel_domain/volume_test.exs
- apps/novel_domain/test/novel_domain/work_skeleton_test.exs
- apps/novel_persistence/lib/novel_persistence/chapter_plan_parser.ex
- apps/novel_persistence/lib/novel_persistence/adoption_repository.ex
- apps/novel_persistence/lib/novel_persistence/reading_projection_repo.ex
- apps/novel_persistence/lib/novel_persistence/schemas/volume.ex
- apps/novel_persistence/priv/repo/migrations/20261022000001_add_volume_blueprint.exs
- apps/novel_persistence/test/novel_persistence/chapter_plan_parser_test.exs
- apps/novel_persistence/test/novel_persistence/adoption_repository_test.exs
- apps/novel_persistence/test/novel_persistence/reading_projection_repo_test.exs
- docs/design/schemas/foundation/enums/volume_blueprint_status.json
- frontend/src/lib/volumeBlueprintView.ts
- frontend/src/lib/__tests__/volumeBlueprintView.test.ts
- frontend/src/components/StructurePanel.tsx
- apps/novel_application/lib/novel_application/context_assembler.ex
- apps/novel_application/lib/novel_application/carry_registry.ex
- apps/novel_application/lib/novel_application/turn_execution_service.ex
- apps/novel_persistence/lib/novel_persistence/workspace_context.ex
- frontend/slice-verify/external-ui-driver.mjs
- frontend/slice-verify/native-tauri-verifier.mjs
- quality/acceptance/scenarios/au08-volume-structured-planning.yml
- apps/novel_domain/lib/novel_domain/ledger_reconciliation.ex
- apps/novel_application/lib/novel_application/ledger_reconciliation_service.ex
- apps/novel_domain/test/novel_domain/work_skeleton_test.exs
- apps/novel_application/test/novel_application/b11a_cp5_volume_debt_scan_test.exs

- apps/novel_domain/lib/novel_domain/volume_scope.ex
- apps/novel_domain/test/novel_domain/volume_scope_test.exs
- apps/novel_web/lib/novel_web/channels/workspace_channel.ex
- apps/novel_web/test/novel_web/channels/workspace_channel_plan_next_volume_test.exs
- apps/novel_application/lib/novel_application/dialogue_planning_service.ex
- apps/novel_application/lib/novel_application/agent_run_flows/judgment_plan.ex
- apps/novel_application/lib/novel_application/agent_run_flows/plot_outline_with_context.ex
- apps/novel_application/test/novel_application/b11a_cp3_volume_scope_test.exs
- frontend/src/lib/socket.ts
- frontend/src/components/StructurePanel.tsx
- frontend/src/lib/__tests__/planNextVolume.test.ts

## enforcement_gaps

> B13b 对账裁决（2026-10-22）：7 条原缺口逐项裁决——2 条降级（契约明示延后/已拍板形态裁剪）、2 条关闭（伪缺口/随基线清账）、1 条转独立 slice（工作台当前卷）、1 条正触发验收转独立 slice、1 条随本批场景修复改写；裁决台账见 `tasks/slices/B13B-adr-enforcement-reconciliation.md`。

- ✅ **已关闭（2026-10-23，R10R11-VOLUME-DEBT-SCENARIO）** R10/R11 finding 真实触发验收：扩既有 tauri 审读场景 `au13-review-adjudication-roundtrip` 为正触发——seed `planned_volumes=4`、事实 3 卷（第 1 卷有蓝图、第 2/3 卷缺蓝图）、计划第 3/4 章分到第 2/3 卷 → 真实页面「发起全书审读」产出 8 处偏离（4 `arc_stalled` + 1 `premature_finale` + 1 `volume_plan_mismatch` + 2 `volume_blueprint_missing`）；断言 R10 文案「立项计划 4 卷，实际已建 3 卷」+ `work:planned_volumes=4`/`volumes:actual=3` source refs + 不阻断写作，R11 逐卷卷名 + `volume:<title>` refs，三条卷债各走真实「修订设定」correction intent 回对话流，全部处置后报告清空 + rail 计数归零。真实 Tauri PASS（`artifacts/slice-verify/au13-review-adjudication-roundtrip-tauri/summary.json`）；`au14-finding-inventory-arc-loop` 回归 PASS（seed planned=1，finding_count=1）。产品代码零改动（规则实现本 slice 前已存在），只补验收证据与 B13b 要求的既有场景修复。
- **`VolumeBlueprint.design_ref/1` 只给形状**：`volume_blueprint:<id>` 未实际写入五本账 `design_ref`（VS-00J §4 item6 原文：本包只定形状，不接线）。— B13b 裁决（2026-10-22）：**降级**——契约明文延后项，非 enforcement 失败；接线归后续 R2/承诺账 slice（`ledger_reconciliation.ex` 已注明 R2 依赖 design_ref 数据基础），不阻塞本 ADR。
- ✅ **已关闭（2026-10-24，WORKBENCH-CURRENT-VOLUME；作者默认裁决 Q11-A）** 工作台「当前卷」硬编码占位：后端 `TurnExecutionService` 把本轮 `WritingCoordinate` 子集（volume_ref/authoring_mode/matched_chapter）additive 装进 TurnResult（与 app JSONL `turn_execution.writing_coordinate.done` 同源；`turn_result_v3` schema additive 可选字段）；`ReadingProjectionService.current_writing_coordinate/2` 按最近 TurnResult 坐标 → get_toc 卷节点解析标题，无坐标回退末个有章卷（规划态），无卷返回 nil；Channel 新增 `get_writing_coordinate` handler；前端 `socket.getWritingCoordinate` + `WorkspaceChat.refreshWritingCoordinate`（join/每轮 turn_result 刷新头部），移除两处硬编码「未定卷」（初始 null，回退「全书」）。真实 Tauri `au08-volume-structured-planning` 扩展 PASS：channel reply `volume_title` 与页面头部可见文本 = 本轮坐标解析真实卷（`第一卷·觉醒`），页面零「未定卷」（`artifacts/slice-verify/au08-volume-structured-planning-tauri/summary.json`）。卷蓝图作者编辑/作废入口仍维持非目标（enum `AUTHOR_EDITED` 仅留位）。
- **开新卷形态 A 为最小入口**：`plan_next_volume` 机械 scope + 既有采纳管道；45 §4.2 的完整新卷方向候选流/独立确认卡未做。— B13b 裁决（2026-10-22）：**降级**——形态 A 为 VS-00J §9① 已拍板默认（真实页面 au08 第三阶段 PASS），45 §4.2 属已冻结的产品形态裁剪，非实现缺陷；保留为产品 backlog，翻案条件=真实作者反馈需要独立卷管理入口，届时按 ADR 修订开独立 slice。
- ✅ **已关闭（2026-10-23，R10R11-VOLUME-DEBT-SCENARIO）** 其它多卷场景回归：`au13-review-adjudication-roundtrip` seed 改为 planned=4/事实 3 卷（含 2 缺蓝图）并复跑 PASS（8 处偏离，R10/R11 从漂移噪声变正触发断言）；`au14-finding-inventory-arc-loop` seed planned=1，复跑 PASS（finding_count=1）；ca04 仅受 blueprint 行 additive 影响（最后证据 2026-08-24，本轮未复跑，保留为独立回归待办，非本 ADR enforcement gap）；au08 已有三轮蓝图证据。blueprint 增量回归断言与 R10/R11 正反两面固化已由 au13 扩展覆盖（正触发：4≠3 与缺蓝图 ×2；反触发：au14/au08 单卷或蓝图齐全不触发）。
- **`next_seq` 采用 max(seq)+1**：与 VS-00J §2.2 append-only 口径逐字一致——B13b 裁决（2026-10-22）：**伪缺口，已从 gaps 移出**（保留为实现注记）。

