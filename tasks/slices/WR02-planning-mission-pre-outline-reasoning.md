# WR02 规划前推理：本轮规划使命

- 状态：done（2026-08-24）
- 类型：Reasoning Slice（写前推理层第三刀：处理层接通规划路径）
- 启动日期：2026-08-24
- 前置：WR01/WR01b（正文路径的本章使命，done）；沿用 WR01 三拍板先例（run 内模型步 /
  本期不持久化不预确认 / 失败降级继续），不再重复请示。

## 1. 用户 / 系统目标

作者说「规划接下来几章」时，模型起草大纲**之前**先按进度态想一步：哪条到期伏笔该在这批章
里排回收、哪个停滞角色该排回归、主线沉寂要不要重新点火、距目标体量还剩多少章、这批章不得
做什么（提前收官/另立主角/提前揭示保密信息）。产出「本轮规划使命」（依据 ref 机器核验，
与 WR01 同款 I-M1），进规划 prompt 决策点附近；模型原话进推理区。

今天的对照：规划 prompt 已有五账机械摘要（`planning_ledger_digest`）与固定「规划要求」
一行——是账面的**罗列**，不是对表后的**结论**；M3 收官循环/题材漂移正是规划层缺这一步
推理的病灶（`notes/2026-08-11` §2③）。

完整闭环：

```text
真实工作台「规划接下来三章」
→ 判断①切 plot_outline_with_context_v1（不变）
→ 机械计划：context_assemble → planning_mission → plot_outline（CP2b 机械步序，非模型计划）
→ planning_mission 步：ChapterMissionInputs 选材料（mode=:planning，含已规划待写章）
   + 一次 planning_mission tool-call → 依据越界机器丢弃 → mission_derived 事件（N-NARR）
→ plot_outline 步：使命文本经 CreativeRequest.planning_mission 进规划 prompt
   （紧跟账面摘要段）→ 大纲草稿 tentative → 作者逐章采纳（既有边界）
→ 留痕：planning_mission.derived.done + trace_summary.planning_mission_ref/statement
```

## 2. 开工检查（七问）

- **Contract**：VS-00E §16.9（规划前推理：复用 `ChapterMissionV1` 值对象与 I-M1/I-M3/I-M4，
  工具名 `planning_mission`、prompt 锚点「规划前推理器」；`CreativeRequest.planning_mission`
  新字段默认 nil 向后兼容）；CP2b（机械步序加一步，非模型计划，无 plan_drafted/D1）。
- **Invariant**：I-M1 依据 ⊆ 材料（同款机械绑定）；I-M2 设计态随 run 消失（本期不持久化）；
  I-M3 叙事 source-bound；I-M4 失败降级——规划照常，prompt 无使命段；I-M5 不设新阈值。
- **Boundary**：`novel_domain`（`ChapterMissionInputs` 增 `mode: :planning` + `planned_chapters`
  材料组；`ChapterMission.to_prompt_lines/2` 标签参数化）、`novel_common`
  （`CreativeRequest.planning_mission`）、`novel_agent`（adapter 透传 + real.ex 规划 prompt 段 +
  两替身）、`novel_application`（service `kind: :planning`、plot flow 机械计划第三步、TES 段渲染、
  trace、预算 +1 步 +1 调用）。不改 persistence / web / 前端组件（推理区复用 `mission_derived`）。
- **Consumer**：① plot_outline writer prompt；② 推理区（mission_derived）；③ trace/why 面板
  （`planning_mission_statement` → 「本轮规划使命：…」）。
- **Proof**：domain 输入扩展单测；service planning 分支单测；plot flow 测试（三步机械计划、
  使命进 prompt、0 步不发 plan_drafted 维持）；I1/I2/I3；真实 Tauri
  `wr02-planning-mission-before-outline`。
- **Acceptance Driver**：`scripts/tauri_slice_verify.sh wr02-planning-mission-before-outline`：
  复用 WR01 seed（三章计划两章已写 + 超期伏笔 + 主角）→ 真实工作台发「按已有三章往后规划
  接下来三章的章节大纲」→ 推理区出现规划使命模型原话 → app-log
  `planning_mission.derived.done` 依据 ⊆ 材料、越界丢弃 ≥1 → 大纲草稿 tentative、零写入 →
  trace 带 `planning_mission_ref`。产品代码零验收感知逻辑。
- **Exploration**：本期不持久化，非要素物化——不适用（与 WR01 一期同口径）。

## 3. 先例沿用（不重复请示）

| 决策 | 沿用 |
|---|---|
| 放哪一步 | run 内模型步；本 flow 是 CP2b 机械步序 → 机械计划加第三步（无 N-PLAN/D1 事宜） |
| 存不存 | 本期不持久化（规划使命是轮级设计，无自然的章槽位；落位设计等 M5 观察后再议） |
| 失败 | 降级继续规划（prompt 无使命段，日志 error 留痕） |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | domain：inputs `mode/planned_chapters`；`to_prompt_lines` 标签参数化 | done | `ChapterMissionInputs` `mode: :planning` + 「已规划待写的章」材料组（`plan:<seq>:summary`，上限 8）+ 规划头行；`ChapterMission.to_prompt_lines/2` 基础标签参数化（作者版拼「（作者已定）」） |
| T2 | service：`kind: :planning`（工具名/锚点/要求文案分派） | done | `@tool_names/@prompt_anchors` 双 kind；intro/requirement 分派（规划味：排回收/排回归/控节奏/不提前收官）；tool_name 贯穿解析/纠错/叙事绑定 |
| T3 | contract+agent：`CreativeRequest.planning_mission`、adapter 透传、real.ex 规划段、两替身 | done | 新字段默认 nil；adapter `optional_text` 同型透传；real.ex 规划 prompt 账面摘要段后插使命段（缺席逐字节不变）；Stub/SliceVerify 识别双锚点并按 kind 产规划味 statement（SliceVerify 仍多给一条越界依据） |
| T4 | plot flow：机械计划第三步 + 步实现 + TES 段渲染 + trace + 预算 | done | `mech_planning_mission` 步（CP2b 机械步序）；`execute_planning_mission_step`（0 调用选材 + 1 调用推导，失败降级）；TES `render_planning_mission` → `input["planning_mission"]`；trace `planning_mission_ref/statement`；DPS 透传 ledger/progress 读端口；预算不变（3 步 2 调用在既有额度内） |
| T5 | 测试 + 契约文档 VS-00E §16.9 + why 面板一行 | done | plot flow 测试扩（材料含已规划章/越界丢弃/prompt 使命段/trace）；§16.9 已落；`TRACE.planningMission` + traceSummaryView；前端 441 tests 绿 |
| T6 | 真实 Tauri 场景 | done | manifest/driver/verifier/单测 + `tauri_slice_verify.sh` 登记；PASS 见 §7 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收（2026-08-24 `tauri_slice_verify.sh wr02-planning-mission-before-outline` PASS，见 §7）
- [x] 后端局部验证（全量 1450 tests 0 failures）；I3 / I1 / I2 PASS
- [x] `mix compile --warnings-as-errors && mix test`；xref 无环；arch_check 通过
- [x] `cd frontend && pnpm typecheck && pnpm lint && pnpm test`（441 tests）
- [x] `bash scripts/quality_manifest_check.sh`；`bash scripts/ai_static_scan.sh --top 10`（经 `task_done.sh --slice` 统一收尾） 

## 6. 决策日志

- 2026-08-24 — 规划使命不复用 `chapter_mission` 工具名/日志域：规划轮与写章轮是两类调用点
  （prompt 目录 SSOT 原则），工具名 `planning_mission`、日志 `planning_mission.derived.*`、
  trace 键独立，值对象与绑定机制复用。
- 2026-08-24 — 使命文本进规划 prompt 的位置：紧跟账面摘要段（`progress_state_section`）之后
  ——摘要是材料、使命是结论，相邻呈现且都在输出契约之前（决策点邻近）。

## 7. 试行反馈

- 2026-08-24 — 真实 Tauri 首跑 PASS（`artifacts/slice-verify/wr02-planning-mission-before-outline-tauri/`）：
  真实工作台「按已有三章往后规划接下来三章」→ 机械步序 context → planning_mission →
  plot_outline → 推理步材料含已规划待写章 + 超期伏笔 + 弧光/进度 → 使命依据 ⊆ 材料、替身
  刻意给的越界依据被丢（`dropped_unbound_count≥1`）→ `mission_derived` 模型原话在推理区可见
  → 大纲草稿 tentative、`production_write_performed=false` → trace 带
  `planning_mission_ref/statement`。行为断言 8 条全中。
- 与 WR01 的分工确认成立：规划使命管「这批章排什么」，写章使命管「这一章现在干什么」，
  两类调用点独立留痕（`planning_mission.*` vs `chapter_mission.*`），why 面板两行文案区分。
- 真实模型侧未验（M5 狗粮）：qwen3.8-27b 在规划轮的 tool-call 稳定性、规划使命是否真的
  让超期伏笔进入新章计划（对照無使命的规划轮）、以及与收官守则的协同（进度接近阈值时
  must_avoid 是否切换为可收束）。
- 本期边界重申：规划使命不持久化（轮级设计）；作者裁决入口未做（若 M5 显示规划使命常被
  作者否定，再考虑规划确认交互）。
