# AU09 Character Candidate Per-Item Adoption / 角色候选逐项采纳

- 状态：闭环（逐候选独立采纳 + 真实页面验收）
- 类型：Artifact Slice + Adoption Boundary Slice + UI Contract Slice
- 启动日期：2026-06-23
- 来源反馈：用户问题 10
- 所属验收：`docs/design/acceptance/author/AU-09-story-memory.md`；关联 AU-05 采纳边界。

## 1. 用户 / 系统目标

作者请求“基于当前作品背景、设定和已有角色，和我一起设计一个新角色”时，AI 可能返回多个角色候选。每个候选都必须拥有自己对应的待采纳动作；不能出现两个角色候选共用一个“待采纳”按钮，导致作者无法明确采纳哪一个角色。

## 2. 开工检查

- **Contract**：`TentativeArtifactSet` / `AvailableAction` item-scoped action；`character_seed` 采纳写 Character 主档案；AU-05 selection != adoption。
- **Invariant**：
  - 每个角色候选必须有稳定 item identity 和 item-scoped adoption action。
  - 采纳候选 A 只能写入 A 对应的 Character；候选 B 保持未采纳。
  - 未采纳候选不进入作品事实、角色 tab、memory 或 context。
  - UI 不能用一个集合级按钮替代多个候选的明确授权。
- **Boundary**：
  - `novel_application`：TurnResult / available_actions 需按 artifact item 输出采纳动作。
  - `novel_web`：action payload 必须绑定候选 item id，不接受缺 item 的集合级采纳。
  - `frontend`：候选卡渲染每项独立按钮，按钮文案和禁用态来自服务端 action。
  - `novel_persistence`：采纳只物化目标候选。
  - **不改**：不绕过 AdoptionBoundary；不把前端点击直接写库。
- **Consumer**：角色候选卡、AdoptionWorkflow、作品档案角色 tab。
- **Proof**：真实 Tauri 工作台触发两个角色候选，UI 显示两个单选入口并只为当前选中项展示操作；选择并保存第二个只写入第二个角色；第一个不进入 Character / memory / context。
- **Acceptance Driver**：新增 `au09-character-candidate-per-item-adoption` 外部 Tauri driver；产品代码新增验收感知逻辑：no。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | |
| novel_domain | maybe | item identity 校验如已有则复用 |
| novel_agent | maybe | 需要稳定输出多候选 item |
| novel_application | yes | TurnResult / available_actions item-scoped |
| novel_persistence | yes | 采纳目标候选物化验证 |
| novel_web | yes | author_action payload 校验 |
| frontend | yes | 多候选卡逐项按钮 |
| docs/design | maybe | 如 contract 现有描述不清需同步 |
| quality | yes | 新增真实页面验收 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 审计当前角色候选 TurnResult 和前端卡片渲染 | done | 根因：`AvailableActionBuilder.artifact_actions` + `maybe_add_artifacts` 按 set 生成单 accept（target_ref=artifact_set_id），2 候选→1 按钮→采纳合并成一个 Character |
| T2 | 修复 item-scoped available action 和 action validation | done | `TentativeArtifactSet.adoptable_units/1` 把多候选 character_seed 拆成逐候选单元（artifact_id=`set::item`）；builder/turn_result 逐单元生成 pending + accept/discard/edit；采纳/重写复用既有按 artifact_id 查找，无契约改动 |
| T3 | 修复前端逐项按钮与状态反馈 | done | 多候选时按钮文案拼候选名（`candidateNameSuffix`，copy.ts）；可见性/已采纳追踪本就按 target_ref/artifact_id，采纳 A 只隐藏 A 的按钮 |
| T4 | 补采纳单项、未采纳不入事实的测试和 Tauri 验收 | done | domain `adoptable_units` + AvailableActionBuilder + AdoptionWorkflow 逐候选采纳测试；slice_verify 2 候选测试；真实 Tauri driver 通过 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收（`artifacts/slice-verify/au09-character-candidate-per-item-adoption-tauri/summary.json`；`scripts/quality_accept.sh au09-character-candidate-per-item-adoption --surface tauri` 通过）
- [x] 后端 / Channel / frontend 局部验证（domain/application 逐候选采纳测试 + slice_verify 2 候选 + 前端 typecheck/lint/test 全绿）
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/check_design_trace.sh`
- [x] `bash scripts/ai_static_scan.sh --top 10`（剩余 gitleaks ProjectGod 既有 accepted_risk）

## 6. 决策日志

- 2026-06-23 — 登记用户反馈 10。该问题是采纳授权粒度 bug，不是单纯 UI 文案问题；必须由服务端 item-scoped action 证明。
- 2026-06-24 — 闭环：用 `TentativeArtifactSet.adoptable_units/1` 把候选集分解为逐候选独立采纳单元（仅 `character_seed` 多候选拆分；`outline_draft` 等多 item 属同一产物保持整体）。每候选有独立 `artifact_id`（`set::item`）+ 独立 accept/discard/edit + 独立 pending；采纳一个只物化该候选的 Character，其它候选保持 pending（仍可在档案/对话中采纳）但不进入已确认角色/记忆/上下文。`AdoptionWorkflow`/`AdoptionRepository` 采纳契约零改动（按 artifact_id 查 pending，条目现含单 item）。
- 2026-07-24 — 交互澄清：保留上述逐项 action target，不改采纳边界；多候选卡改为先单选本次操作对象，底栏只展示选中项的 accept/discard/edit，未选择时禁用。真实 Tauri 证明：一轮 2 候选 → 2 单选入口 / 2 独立 action target → 选择并采纳第二个 → 只写第二个 Character、第一个仍可选择且未入已确认角色、档案仅 1 个已确认角色。

## 7. 试行反馈

- 现状：所有 character_seed 候选用同一 `accept` action type，逐候选靠 `artifact_id` 区分、按钮文案附候选名。若未来引入“方向候选 vs 角色主体候选”两类语义，需在 `adoptable_units` / action type 层显式区分，不复用同一按钮语义。
- `adoptable_units` 目前只对 `character_seed` 逐项拆分；若伏笔/规则等也需逐项采纳，扩展 `per_candidate_type?` 即可，但要同步前端按钮命名与各自 driver。
