# WR01 写前推理层：本章使命

- 状态：done（2026-08-21）
- 类型：Reasoning Slice（四层体系 ③处理层首刀）
- 启动日期：2026-08-21
- 立论：`docs/design/notes/2026-08-11-establish-carry-process-write-pipeline.md` §2/§4
  （「处理层真空最大」「写前推理层是缺口最大的一步」）；谱系
  `notes/2026-07-22-prompt-as-function-of-state.md`（prompt = f(状态)）。

## 1. 用户 / 系统目标

作者说「写第 N 章」时，系统在调用正文写作之前**先想一步**：综合本章计划（设计态）与
五本账/全书进度（进度态），由模型推导出**本章使命**——这一章现在必须推进什么、不得
做什么，每条都注明依据（哪条账、哪个计划字段）。使命进入场级执行简报，紧挨写作
决策点；模型那段「我在想这一章该干什么」的原话进对话区推理段，作者看得见。

今天的对照：正文 prompt 的 12 块材料全是机械搬运（`turn_execution_service.ex:120-185`），
执行简报是 0 调用的确定性投影（`ProseExecutionBriefBuilder`），章计划是规划时一次写死的
静态文本，账本是活的，两者之间没有任何一步对表——M3 漂移的结构性解释之一
（备忘 §2 ④）。

完整闭环：

```text
真实工作台「写第 N 章」
→ 判断①切 prose_drafting_with_quality_v1（不变）
→ 模型起草计划：context_assemble → chapter_mission → prose_writing（新步由模型排入）
→ chapter_mission 步：机械选取携带状态（0 调用）+ 模型推导使命（1 调用）
   → 依据不在输入材料内的条目机器丢弃 → mission_derived 事件（模型原话，N-NARR 绑定）
   → stage_state.chapter_mission
→ prose_writing 步：使命进 CreativeDecisionPacket → ProseExecutionBrief.chapter_context
   → writer prompt「本章使命」段（brief_source 含 chapter_mission）
→ 正文 tentative → 作者采纳/放弃（既有边界，不变）
→ 留痕：chapter_mission.derived.done 业务日志 + trace_summary.chapter_mission_ref
```

## 2. 开工检查（七问）

- **Contract**：扩 `VS-00E-prose-execution-quality-contract-pack.md` §16「写前推理：本章
  使命」（`ChapterMissionV1` 值对象、进 `CreativeDecisionPacket["chapter_mission"]` →
  `ProseExecutionBrief.chapter_context["mission"]`、`brief_source += "chapter_mission"`、
  失败降级语义）；消费 ADR-0023（N-PLAN：新步由模型排入，D1 `step_preconditions` 兜底）、
  ADR-0022/46 §9（N-NARR：`mission_derived` 事件的 `author_narrative` 必须 source-bound）、
  VS-00F（五本账只读）、08 §5 三态表（进度态 × 设计态 → 使命）。
- **Invariant**：
  - I-M1 使命每条「必须推进/不得做」的依据 ref 必须存在于本步机械选取的输入材料 ref 集合；
    不在集合内的条目机器丢弃并计数（模型不得编造依据，与 I1 因果绑定同构）。
  - I-M2 使命是设计态，随 run 消失，不写 chapters/memory/ledger 任何权威层；
    `production_write_performed=false`。
  - I-M3 使命叙事只来自模型输出字节（`AgentNarrativeSource` 绑定），app 不造句。
  - I-M4 推理步失败/缺席不阻断写作：brief 标 `degraded`，留痕失败原因，正文照常生成。
  - I-M5 预期归对象：携带选取沿用刀④口径（有预期的伏笔按临近排序、无预期只计数），
    不新设全局阈值。
- **Boundary**：切 `novel_domain`（`ChapterMission` / `ChapterMissionInputs` 纯函数）、
  `novel_application`（`ChapterMissionService`、prose flow 新步、planner 四注册点、
  `TurnExecutionService`/`ProseExecutionBriefBuilder`/`TraceWriter` 透传）、
  `novel_agent` 仅 test/support 替身；`frontend` 只加推理区事件标签与过滤名单
  （`agentRunTimeline.ts` / `copy.ts`）。不改 `novel_persistence`（零新表零新列，
  加一个 `written_progress` 读端口装配即可）、不改 `novel_web`。
- **Consumer**：① writer prompt（`ProseExecutionBrief.to_prompt_section/1`）；② 对话区
  推理段（`mission_derived` 事件，与 `exploration_observed` 同渲染路径）；③ trace_summary。
- **Proof**：domain 单测（输入选取/绑定过滤/渲染）；service 单测（tool-call 解析、叙事绑定、
  坏结构重试、失败降级）；prose flow 测试（计划含 mission 步、writer prompt 含「本章使命」、
  事件带 author_narrative、D1 漏步 replan）；I1/I2/I3；真实 Tauri 场景
  `wr01-chapter-mission-before-prose`。
- **Acceptance Driver**：`scripts/tauri_slice_verify.sh wr01-chapter-mission-before-prose`：
  seed 三章计划 + 两章已采纳 + 一条带预期且超期的伏笔（复用 au14 seed 形态）→ 真实工作台
  发「续写第三章」→ 推理区出现「本章使命」标签段且正文可见 → verifier 从 app-log 证
  `chapter_mission.derived.done` 的依据 ref ⊆ 输入 ref、`prose_execution_brief.built.done`
  的 `brief_source` 含 `chapter_mission`、writer 调用 prompt 含「本章使命」段、无写入。
  产品代码零验收感知逻辑。
- **Exploration**：本期使命不持久化（随 run 消失，用户拍板），非要素物化——**不适用**；
  若后续 CP 落 `chapters.plan_direction["chapter_mission"]`，须同批让 `chapter_read`
  渲染该键（探索面同步律）。

## 3. 用户拍板（2026-08-21）

| 问题 | 裁决 | 含义 |
|---|---|---|
| 推理步放哪 | 正文 run 里新增一步（模型计划可见） | 不藏在 prompt 组装里；4 注册点 + D1 前置兜底 |
| 存不存 / 作者先确认否 | 本期不存不确认 | 使命只活在本次 run；作者靠采纳正文裁决；落章计划与改写归下一期 |
| 推理失败 | 降级继续写 | 与质量评审失败同策略；留痕不拦稿 |

## 4. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | — |
| novel_domain | yes | `ChapterMission`（值对象+绑定过滤+prompt 渲染）、`ChapterMissionInputs`（按坐标选取携带状态，统一三处重复的账本过滤） |
| novel_common | no | — |
| novel_agent | test/support only | 替身 provider：计划含 mission 步、`chapter_mission` tool-call 按真实 prompt 材料产使命 |
| novel_application | yes | `ChapterMissionService`；prose flow 新步 + D1 前置 + 预算；planner 四注册点；`TurnExecutionService`/`ProseExecutionBriefBuilder`/`ProseExecutionBrief` 透传与渲染；`TraceWriter` ref；`persistence_written_progress_reader/0`；run server `@stage_event_types` 增 `:mission_derived` |
| novel_persistence | no | 零新表零新列 |
| novel_web | no | — |
| frontend | yes（最小） | `agentRunTimeline.ts` 推理事件名单 + `copy.ts` 标签「本章使命」 |
| docs/design | yes | VS-00E §16；46 §9.2 事件清单（08 要素表未加编号，使命作为 E18/E19 的运行时函数形态记在 VS-00E §16） |
| quality | yes | 新 manifest/driver/verifier；seed 脚本 |

## 5. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 契约：VS-00E §16 + 46 §9 事件清单 | done | VS-00E §16（ChapterMissionV1 / 机械半边与模型半边 / N-PLAN 形态 / 进简报 / 留痕 / 不变量 / 本期边界）；46 §9.2 推理事件清单增 `mission_derived` |
| T2 | domain：`ChapterMissionInputs` 选取与渲染、`ChapterMission` 值对象与绑定过滤 | done | `apps/novel_domain/lib/novel_domain/chapter_mission_inputs.ex`（十组材料逐条 `[ref]`，目标章自身 plan_info 不算保密、无预期伏笔只计数）、`chapter_mission.ex`（`bind/3` 依据过滤 + `dropped` 留痕 + `to_prompt_lines/1`）；`WorkSkeleton.progress/2` 公开进度口径；单测 6 例 |
| T3 | application：`ChapterMissionService`（1 次 native tool-call，坏结构重试 1 次，叙事绑定） | done | `chapter_mission_service.ex`：`chapter_mission` 工具 schema、信封解套、依据全越界=`mission_unbound` 重试、叙事 content 优先 / `arguments.author_reasoning` 回退、绑不上不作废使命；单测 5 例（含 `provider_output_tool_narrative` 回退） |
| T4 | prose flow 新步 + planner 注册（targets/catalog/internal steps）+ D1 前置 + 预算 +1 步 +1 调用 + `mission_derived` 事件 | done | `prose_drafting_with_quality.ex` `execute_mission_decision_step`（目标章复用 `TurnExecutionService.resolve_target_chapter/5`，解析不到取下一待写章）；`step_preconditions` 仅 `max_steps>1` 声明；`AgentEvent`/run server `@stage_event_types` 增 `:mission_derived`；`persistence_written_progress_reader/0`；预算 4→5 步、5→6 调用；flow 测试 8/8（主测试断 mission 事件 source-bound、writer prompt 含使命且不含越界条目、trace ref） |
| T5 | 使命进简报：packet → builder → `chapter_context["mission"]` → prompt 段；`brief_source`；LogEmit；trace ref | done | `CreativeDecisionPacketBuilder`/`ProseExecutionBriefBuilder`/`ProseExecutionBrief.to_prompt_section`（章行之后、场次之前）；`brief_source` 取值 `chapter_mission` / `chapter_mission_degraded`；`chapter_mission.derived.done|error` + `prose_execution_brief.built.done.chapter_mission_ref`；`trace_summary.chapter_mission_ref`；单测 2 例（缺席时简报逐字节不变） |
| T6 | 替身 provider + 后端测试 + I1/I2/I3 | done | `Provider.Stub` 与 `SliceVerify` 计划含 `chapter_mission` 步、按 prompt 材料 `[ref]` 产使命（SliceVerify 刻意多给一条越界依据供绑定过滤取证）；flow/预算夹具同步 +1；全量门禁见 §6 |
| T7 | 前端事件标签/名单 + 真实 Tauri 场景 `wr01-chapter-mission-before-prose` | done | `agentRunTimeline.ts` 推理事件名单 + `copy.ts` 标签「本章使命」；seed `scripts/seed_wr01_chapter_mission.exs`、manifest、driver `driveWr01ChapterMissionBeforeProse`、verifier 取证/行为 + 单测；真实页面运行结果见 §8 |

## 6. 验证

- [x] 外部自动化驱动真实页面的场景化验收（2026-08-21 `bash scripts/tauri_slice_verify.sh wr01-chapter-mission-before-prose` PASS，见 §8）
- [x] 后端 / Agent / Application 局部验证（domain 268 / agent 156 / application 531 / 全量 1442 tests 0 failures）
- [x] `MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs`
- [x] `MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs`
- [x] `MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs`
- [x] `mix compile --warnings-as-errors && mix test`
- [x] `mix xref graph --format cycles --label compile-connected --fail-above 0`
- [x] `mix run scripts/arch_check.exs`
- [x] `cd frontend && pnpm typecheck && pnpm lint && pnpm test`（439 tests）
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/ai_static_scan.sh --top 10`（经 `task_done.sh --slice` 统一收尾，本刀触碰文件 0 发现；credo 唯一剩余为既有 deferred 的 `chapter_summary.ex` 嵌套）

## 7. 决策日志

- 2026-08-21 — 使命输出形态 = 一句使命 + 「必须推进」列表 + 「不得做」列表，每条带
  `basis_ref`；依据集合由机械选取器给出并随 prompt 一起列名（`[ref] 文本`），模型只能
  引用列出的 ref。选择原因：让推理可核、让「模型编依据」在 app 侧被机械拦住。
- 2026-08-21 — 一次 native tool-call（`chapter_mission`）而非两段式：推理步只需一段结论，
  两段式多一倍调用；叙事绑定走 content 优先 / `arguments.author_reasoning` 回退
  （与计划起草同款，LM Studio 强制 tool_choice 下空 content 的既有判例）。
- 2026-08-21 — D1 前置声明 `prose_writing` 依赖 `chapter_mission`，但 `max_steps == 1`
  的作者显式一步预算不声明（一步预算是硬约束，不能逼模型排两步）。
- 2026-08-21 — 携带选取不新设阈值：伏笔按刀④「有预期按临近、无预期计数」；弧光 STALLED
  优先；主线/承诺取当前状态；情绪曲线只取最近三章；进度取全书百分比。选取器同时成为
  今天三处重复账本过滤（写作携带/盘点核对/R9）的统一入口候选，本刀先只接写作侧。

## 8. 试行反馈

- 2026-08-21 — 真实 Tauri 首跑 PASS（`artifacts/slice-verify/wr01-chapter-mission-before-prose-tauri/`）：
  真实工作台一条「生成第03章正文草稿」→ 模型计划 `context_assemble → chapter_mission →
  prose_writing` → 推理步材料 10 条 ref（seed：第 03 章九字段+两场次、一条超期伏笔、
  沈洛弧光、主线/承诺/情绪账、全书进度缺位、阵容）→ 使命 2 条必须推进
  （`ledger:information:foreshadow_<id>` + `plan:3:chapter_role`）、替身刻意给的越界依据
  `foreshadow_unlisted` 被机械丢弃（`dropped_unbound_count=1`）→ `mission_derived` 事件
  `provider_output` 绑定、模型原话在推理区可见 → 简报 `brief_source=[chapter_plan_scene_plans,
  reader_effect_brief, chapter_mission]`、`chapter_mission_ref` 与 trace 一致 → 正文 tentative、
  `production_write_performed=false`。9 条行为断言全中。
- 观察：seed 只有第 03 章带 `information_release`，且目标章自身的 plan_info 不算保密，故
  `must_avoid_count=0`——保密清单在「后面还有带信息释放的章计划」时才有材料，符合设计
  （不凑数）。
- 真实模型侧未验（M5 狗粮观察项）：qwen3.8-27b 在强制 `tool_choice` 下是否稳定返回
  `chapter_mission` 结构、`author_reasoning` 是否走 content 还是 arguments 回退、依据越界率
  （`dropped_unbound_count` 分布）、以及使命对正文的实际牵引（对照 brief 无使命的章）。
- 成本实测：正文 run 从 4 次模型调用变 5 次（judgment① 之外）；替身下推理步 1 次、无重试。
- 下一期候选（不在本刀）：使命落 `chapters.plan_direction["chapter_mission"]` + 作者确认/改写
  + `chapter_read` 探索可达；规划（plot_outline）前推理；「为什么」面板展示 `chapter_mission_ref`
  与简报（今天 trace 有 ref、UI 零展示）。
