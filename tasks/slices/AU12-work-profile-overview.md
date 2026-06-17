# AU12 Work Profile Overview / 作品档案立项概览只读视图

- 状态：checkpoint closed（CP1 已闭环；用户 2026-06-17 调整队列先做 AU12，完成后队首回到 `AU10-workbench-recovery-disconnect-timeout`；AU12 整体仍有 CP2/CP3 缺口）
- 类型：UI Contract Slice + Projection Slice（作品档案只读投影）
- 启动日期：2026-06-17
- 所属设计：`docs/design/ui/43-structure-panel.md` §5①（Work 概览）/ §4.1（L1 概览）/ §3（只读 + correction intent）/ §4（L1–L4 渐进披露层级）
- 所属验收：`docs/design/acceptance/author/AU-12-work-profile.md`（作品档案——2026-06-17 新立独立 AU，本 slice 是其首个承重切面，覆盖场景组 A + D1/D2）；与 `AU-03-context.md`（作者看见 AI 参考了什么）同向，与 `AU-09-story-memory.md`（故事设定记忆）边界互斥

> 本文件是 slice 入口和 CP1 完成记录；后续 CP2/CP3 仍需独立开工检查与外部验收。

---

## 0. 为什么需要这个 slice（缺口事实）

作品档案面板（`frontend/src/components/StructurePanel.tsx`）当前只有 4 个 tab：
`outline / character / foreshadowing / rule`，对应设计 43 §5 计划 8 模块里的 ②③④⑧。

设计 43 §5① 的 **「Work 概览（立项设定、主题、大纲）」缺整块查看入口**。而这些立项字段
（题材 / 核心卖点 / 目标读者 / 基调）**数据是存在且权威的**——`works` 表已落字段
（`apps/novel_persistence/lib/novel_persistence/schemas/work.ex:22-28`），并已通过
`WorkspaceContext.work_snapshot/1`（`workspace_context.ex:331`）喂进 Planner / 创作 prompt
（`ContextAssembler.current_work_context_parts`，`context_assembler.ex:291-304`）。

即：**AI 正在使用一份作者自己在 UI 里看不到的立项档案**。本 slice 把这份已存在、已被 AI 消费的
立项事实，补一个只读查看面，让作者能核对"AI 依据的作品设定到底是什么"。

---

## 1. 用户 / 系统目标

作者在真实工作台呼出作品档案 → 点「概览」→ 看到本作品的权威立项设定
（题材 / 核心卖点 / 目标读者 / 基调 / 修订号），且这份显示与 AI prompt 用的是**同一事实源**、
不泄漏内部 UUID、能区分 tentative 与 accepted 状态。

长期承重能力：把"作品档案"从"采纳产物的副产物面板"补成"作者可核对的作品事实视图"，
为后续从面板发起 correction（立项修订走对话流）打地基。

---

## 2. 开工检查（承重六问）

- **Contract**：
  - 消费设计 43 §5①/§4.1/§3，以及 `docs/design/domain/34-novel-element-field-priority.md` 的字段优先级；复用既有档案只读通道形态
    （`get_work_*` channel ↔ `WorkArchiveService` ↔ `WorkArchiveRepo`，已有 stats/characters/foreshadowing/rules）。
  - 新增 `NovelApplication.WorkArchiveService.profile/1` → `WorkArchiveRepo.profile/1`，
    creative fields 与 `WorkspaceContext.work_snapshot/1` 同源同口径（title / genre / core_selling_point /
    target_reader / tone_preference），档案额外显示 status / revision / updated_at 作为只读状态信息。
  - 新增 channel `get_work_profile`（镜像 `workspace_channel.ex:514` 的 `get_work_stats`）。
  - 新增前端 `socket.ts` helper `getWorkProfile`（镜像 `getWorkStats`）+ StructurePanel「概览」tab +
    `copy.ts` `STRUCTURE_PANEL.tabs.overview` 与字段标签文案（文案集中，禁硬编码）。
- **Invariant**：
  - **I-A 单一事实源**：面板显示的立项字段与 `works` 表 authoritative 值字节相等，不由前端二次加工/硬编码；
    与 prompt 用的 `work_snapshot` 同字段集同口径。
  - **I-B 只读边界**：面板不直接写库；"想改"只发起 correction intent 抛回对话流（本 slice 只读，
    编辑落后续 checkpoint）。设计 43 §3。
  - **I-C 不泄漏内部 id**：profile 不含 Work UUID（沿用 `workspace_context.ex:327-330` 约束），
    面板与日志都不暴露主键。
  - **I-D 状态可辨**：tentative vs accepted 的 work `status` 在面板可区分，不把未确认立项显示成既定事实
    （设计 43 §6.3）。
  - **I-E 既有不变量不破**：I1/I2/I3 scenario invariants + real.ex 三锚点不动（本 slice 不碰 provider/prompt/planner）。
- **Boundary**：
  - `novel_persistence`：`WorkArchiveRepo.profile/1` 只读 `works` 立项字段（与 work_snapshot 同集，nil/空剔除）。
  - `novel_application`：`WorkArchiveService.profile/1` 薄封装。
  - `novel_web`：`get_work_profile` handler（emit `channel.get_work_profile.done`）。
  - `frontend`：`socket.ts` helper + StructurePanel 概览 tab + `copy.ts` 文案。
  - **不改**：`works` schema（字段已存在）、provider/real.ex/prompt/planner、adoption boundary、
    VS-00C CP0–CP5 上下文链、reading projection 口径。
- **Consumer**：第一个真实消费者是作者在真实工作台打开档案「概览」tab；外部消费者是
  `channel.get_work_profile.done` 业务日志 + Tauri driver 对面板渲染的断言。
- **Proof**：见 §4。
- **Acceptance Driver**：外部 Tauri driver 用真实档案按钮 + tab 点击 + websocket 帧 + 业务日志验收；
  产品代码**不读** slice id / env / query / localStorage。立项查看对所有作品一致，是真实产品能力，非验收钩子。

---

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | |
| novel_domain | no | 立项字段已是 works 持久化事实，无需新值对象 |
| novel_agent | no | 不碰 provider/prompt |
| novel_application | yes | `WorkArchiveService.profile/1` 薄封装 |
| novel_persistence | yes | `WorkArchiveRepo.profile/1` 只读立项字段（与 work_snapshot 同源） |
| novel_web | yes | `get_work_profile` channel handler |
| frontend | yes | `socket.ts` helper + StructurePanel 概览 tab + `copy.ts` 文案 |
| docs/design | no | 复用 43，不改设计（如需字段优先级裁剪，引用 `docs/design/domain/34-novel-element-field-priority.md`） |
| quality | no | |

---

## 4. Proof

- **persistence 单测**：`profile/1` 返回立项字段集、不含 `id`、剔除 nil/空、字段值与 works 行一致。
- **application 单测**：`WorkArchiveService.profile/1` 透传无加工。
- **web channel 测试**：`get_work_profile` reply 形状（含 work_id 维度、不含 UUID 字段）。
- **frontend**：`socket.ts` helper 推 `get_work_profile`（单测）+ StructurePanel 概览 tab render（含 tentative/accepted 状态区分）+ 文案取自 `copy.ts`。
- **不变量**：
  - `MIX_ENV=test mix run scripts/scenario_invariants/run_i3_nonce.exs`
  - `MIX_ENV=test mix run scripts/scenario_invariants/run_i1_causal.exs`
  - `MIX_ENV=test mix run scripts/scenario_invariants/run_i2_variation.exs`
- **工程门禁**：`mix compile --warnings-as-errors`、各 app `mix test`、`arch_check`、`xref` 无循环；
  `cd frontend && pnpm typecheck && pnpm lint && pnpm test`、`bash scripts/frontend_audit.sh`、
  `bash scripts/check_design_trace.sh`。
- **外部验收**：`bash scripts/tauri_slice_verify.sh au12-work-profile-overview`——真实工作台打开档案→点「概览」→
  断言题材/核心卖点/目标读者/基调渲染且与持久化字节一致、未泄漏 UUID、状态标签正确。

CP1 完成证据：

- `artifacts/slice-verify/au12-work-profile-overview-tauri/summary.json`
- 后端局部：`WorkArchiveService.profile/1` / Channel `get_work_profile` 回归覆盖 joined work 优先、profile 不含内部 id。
- 前端局部：`getWorkProfile` helper 与 StructurePanel「概览」tab 渲染测试。

---

## 5. 最小闭环 checkpoint 拆分（不缩小 slice 范围）

- **CP1（本 slice）— 立项档案只读概览**：works 表立项字段（题材/卖点/目标读者/基调/状态/修订号）
  端到端只读查看，外部 Tauri 驱动真实页面验收。
- **CP2（后续）— accepted-artifact 类立项要素**：world_setting / protagonist 等来自**采纳产物**（非 works 表）
  的立项要素纳入概览（与既有 character/rule tab 的采纳事实同源），不重复造数据。
- **CP3（后续）— 从面板发起 correction**：作者在概览点「修订」→ 发起 correction intent 抛回对话流，
  重新过 adoption boundary（设计 43 §3「不绕过 Agent 直接写库」），编辑能力落地。

CP2/CP3 是本 slice 完整闭环的计划内后果，不写"范围外"。

---

## 6. 非目标 / 诚实边界

- **不做编辑 / 不直接写库**（CP1 只读；编辑是 CP3 的 correction intent）。
- **不做巨型表单**（设计 43 §3：档案是阅读/导航/发起意图，不是字段平铺表单）。
- **不纳入**设计 43 §5 的其余模块：⑤ Timeline/State snapshot、⑥ Style/Writing preferences、
  ⑦ Long-run tasks 监控台（⑦ 属 AU-10 recovery/taskstate 方向）——各自独立 slice。
- **不碰** VS-00C CP0–CP5 创作上下文链与 provider/prompt——本 slice 是查看面，不改 AI 行为。
- CP1 完成只证明"立项档案可被作者核对"，**不等于**作品档案 8 模块全齐；档案完善是多 checkpoint 累积。

---

## 7. 决策日志

- 2026-06-17：草稿创建。缺口经核对设计 43 §5 成立——StructurePanel 现 4 tab 覆盖 §5②③④⑧，
  §5①「Work 概览」无查看入口而数据已被 AI 消费（works 表 → work_snapshot/1 → ContextAssembler）。
- 2026-06-17：用户决策两项——① **排队位置**：登记到 `tasks/NEXT.md`，但排在当前 AU10 recovery 队首之后，不插队；
  ② **AU 归属**：作品档案立独立 AU = **AU-12**（新建 `docs/design/acceptance/author/AU-12-work-profile.md`），
  与 AU-09（故事设定记忆）边界互斥——立项元数据与档案查看面归 AU-12，故事记忆对象语义归 AU-09。
- 2026-06-17：用户调整任务队列，先做 AU12。CP1 已闭环：新增 profile read model、Channel `get_work_profile`、StructurePanel「概览」tab 与外部 Tauri driver；证据 `artifacts/slice-verify/au12-work-profile-overview-tauri/summary.json`。当前队首回到 AU10 recovery；AU12 后续保留 CP2 accepted-artifact 类立项要素与 CP3 correction 修订入口。
