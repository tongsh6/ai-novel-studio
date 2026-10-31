# AU12 Correction Intent Roundtrip / 作品档案修订意图回到对话流

- 状态：done
- 类型：Acceptance Slice + UI Intent Boundary Slice
- 启动日期：2026-06-22
- 所属验收：`docs/design/acceptance/author/AU-12-work-profile.md` SC-AU12-C2

## 1. 目标

关闭 AU-12 剩余 P1 中的修订意图缺口：作者在作品档案概览中核对立项字段后，可以从真实档案入口提出立项修订；该意图回到工作台对话主链，由 Planner / MicroPlan / Orchestrator / Tool / TurnResult 处理，并产生待采纳设定草稿，而不是由档案面板直接写 `works` 或其它作品事实。

## 2. 开工检查

- **Contract**：`AU-12-work-profile.md` SC-AU12-C2；`docs/design/ui/43-structure-panel.md` §3/§5；`docs/design/domain/24-novel-intent-catalog.md` correction；`TurnResult.adoption_state.pending` 与 `available_actions`。
- **Invariant**：作品档案只读；修订只能作为作者意图进入对话主链；生成的修订材料在作者动作前保持 pending/tentative；档案入口不得直接触发 author_action、adoption evaluation 或 production write。
- **Boundary**：真实 Tauri Workbench UI → `StructurePanel` → `WorkspaceChat.handleSend(generateMicroPlan=true)` → Channel → `DialogueGateway` → Planner / MicroPlan / Orchestrator → `world_building` → pending `world_setting`。不改 production provider runtime，不新增验收 env/query/localStorage/DOM hook。
- **Consumer**：作者从作品档案概览点击「提出立项修订」；质量消费者为 `scripts/quality_accept.sh au12-correction-intent-roundtrip --surface tauri`。
- **Proof**：frontend copy/component targeted test、native verifier test、`bash scripts/quality_accept.sh au12-correction-intent-roundtrip --surface tauri`、quality manifest check、task_done/static scan。
- **Acceptance Driver**：`frontend/slice-verify/external-ui-driver.mjs` 的 `au12-correction-intent-roundtrip`；产品代码新增验收感知逻辑：no。

## 3. 缺口依赖矩阵

| 场景 ID / 名称 | 原 blueprint 位置 | 本轮处理顺序 | 第一轮状态 | 第二轮状态 | 剩余缺口描述 | 缺口类型 | 优先级 | 当前证据 | 依赖关系与重排理由 | 已补实现或验收 driver | 是否已真实验收 | 回填到哪些验收文件 | 是否仍应在 AU-12 内关闭 | 建议 checkpoint / slice | 是否满足恢复 blueprint 顺序 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SC-AU12-C2 修订走 correction intent | AU-12 | AU-12 后、E2E 二轮复核后优先关闭 | 未实现 | 已验收 | 档案已能从立项概览发起修订意图并重新过采纳边界；accepted `world_setting` 是否物化回 works 立项字段另立 P2 contract | P1 closed / P2 follow-up | closed/P2 | `artifacts/slice-verify/au12-correction-intent-roundtrip-tauri/summary.json` 证明可见「提出立项修订」触发 `generate_micro_plan=true`，Planner/MicroPlan/Orchestrator 允许 `world_building`，产生 pending `world_setting`，作者选择前 no author_action / no adoption / no write | 不依赖外部 provider credentials；复用现有 `world_building` / `world_setting` pending adoption 主链，可真实页面关闭 | 新增「提出立项修订」入口、Tauri driver、native verifier、quality manifest | 是 | AU-12；AU-10/E2E 作为 no-write/adoption boundary cross evidence | 否，本轮应关项已关闭 | `AU12-correction-intent-roundtrip` | 是，恢复 AU-12/E2E 后续收口顺序 |

## 4. 预期验证

```bash
node --check frontend/slice-verify/external-ui-driver.mjs
node --check frontend/slice-verify/native-tauri-verifier.mjs
bash -n scripts/tauri_slice_verify.sh
pnpm --dir frontend exec vitest run src/lib/__tests__/structure_panel.test.ts slice-verify/native-tauri-verifier.test.mjs
bash scripts/quality_accept.sh au12-correction-intent-roundtrip --surface tauri
bash scripts/quality_manifest_check.sh
bash scripts/task_done.sh --slice au12-correction-intent-roundtrip --skip-static-scan
bash scripts/ai_static_scan.sh --top 10
node scripts/task_done_check.mjs
```

## 5. 验证结果

- [x] `node --check frontend/slice-verify/external-ui-driver.mjs`
- [x] `node --check frontend/slice-verify/native-tauri-verifier.mjs`
- [x] `bash -n scripts/tauri_slice_verify.sh`
- [x] `pnpm --dir frontend exec vitest run src/lib/__tests__/structure_panel.test.ts slice-verify/native-tauri-verifier.test.mjs`
- [x] `bash scripts/quality_accept.sh au12-correction-intent-roundtrip --surface tauri`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/task_done.sh --slice au12-correction-intent-roundtrip --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`
- [x] `node scripts/task_done_check.mjs`

真实验收证据：`artifacts/slice-verify/au12-correction-intent-roundtrip-tauri/summary.json`，记录 `turn_id=turn_3`、`decision_type=allow_tool`、`tool_name=world_building`、`pending_artifact_type=world_setting`、`provider=slice_verify`、`surface=tauri`。behavior assertions 覆盖可见档案修订入口、`generate_micro_plan=true`、Planner/MicroPlan 完成、Orchestrator 允许工具、pending artifact 需要采纳、保存/修改/放弃动作可用、作者选择前无 `author_action`、无 adoption evaluation、无 production write。

## 6. 当前剩余

- 本 checkpoint 已关闭“从档案发起修订意图并产生 pending adoption”的 P1。
- accepted `world_setting` 是否进一步物化回 `works` 立项字段，需另立 contract 和采纳后回写验收；本 checkpoint 不伪装完成该 P2。
- AU-12 文件内仍剩读取失败诚实降级矩阵 P1。

## P2 立项修订的采纳落位与同源消费

- 状态：**blocked（实现、真实页面流程、新会话消费均 PASS；task_done 要求 UI 证据 surface=tauri，当前外部 driver 只能产生 surface=browser，原生 webview/CUA driver 未就绪；不伪造 surface）**。
- 来源：本任务 §6、[AU-12](../../docs/design/acceptance/author/AU-12-work-profile.md) AU12-I1/I7、[CA01 写入余项](CA01-planning-context-completion.md)。用户场景是“修订作品立项并采纳后，档案和后续模型使用同一新事实”。
- 已核事实：`AdoptionRepository` 的 `work_skeleton_suggestion` 仅允许 target_length/planned_volumes/serial_form；`world_setting` 沿记忆类型落位。这些不能证明 premise/theme/main_goal 或题材/卖点/读者/基调等通用修订已回写 works，也不能由自然语言关键词自动推断应覆盖哪个立项字段。
- CP0（可推进）：列清现有字段权威源、artifact 类型/显式目标、producer、采纳事务、版本及读模型消费者；比较复用既有结构化提案与扩展最小契约的差异，形成字段落位/不落位/缺失值/锁定及冲突处理方案。契约接受前不把任意 world_setting 全量覆盖 works、不新增平行资料表。
- 后续完整闭环：同一明确修订经真实作者采纳才修改授权字段，未采纳/放弃/过期/跨作品/重复请求不误写；保持 revision 与真实 StateTrace，概览、通用探索、后续判断/专业模型请求同源更新，历史事实可回查。采纳前后字节与来源不得由 APP 补写创作内容。
- Proof/Boundary：domain 字段/版本规则，application 作者意图/采纳编排，persistence works/现有回执，web/前端概览与真实候选动作。外部真实 Tauri 从概览提出修订→候选→采纳→刷新/新会话→模型实际请求核对；A2 同轮来源证据并入，不用 pending 卡出现冒充最终落位。B39 负责按需求证，B45 协同必要 schema，CA01 仅指向本 owner 不维护另一份状态。

### CP0 契约准备记录（2026-10-31）

**字段权威源（works 行，Work.changeset optimistic_lock）**
- 通用立项：title/genre/core_selling_point/target_reader/tone_preference；
- NEM-GAP-01：premise/theme/main_goal；
- 全书骨架：target_length/planned_volumes/serial_form；
- revision 由 changeset 递增，与作者手工编辑同一冲突语义。

**现有落位能力**
- `work_skeleton_suggestion` 采纳仅允许 `skeleton_field in target_length/planned_volumes/serial_form` + `skeleton_value`；缺失/非法字段拒绝（不静默吞）。
- `world_setting` 落记忆，不写 works；无自然语言自动推断字段，不能证明 premise/theme/main_goal 或通用立项修订已回写。
- producer：`fact_inventory_service` skeleton prompt 仅 3 个骨架字段（VS-00G owner）；无通用立项字段的显式提案项。
- 消费者缺口：`WorkService.to_dto` 仅 id/title/genre/status/revision/timestamps，概览契约读不到 premise/theme/main_goal/卖点/读者/基调；`ContextAssembler.current_work_context_parts` 只列 genre/core_selling_point/target_reader/tone_preference/protagonist 等，**premise/theme/main_goal 未证实进入模型请求**。
- 零写入：pending 候选不改 works；采纳事务中 work update 才落 revision；无 StateTrace 专门覆盖（沿用既有 adoption 回执）。

**方案比较**
- **A（推荐）**：扩展现有 `work_skeleton_suggestion`/显式 field-value 提案白名单到通用立项标量字段（premise/theme/main_goal/core_selling_point/target_reader/tone_preference）+ producer 显式项 + Work DTO/概览消费 + ContextAssembler 同源字段；无新表、无自然语言推断。
- **B**：新 artifact type `work_profile_revision`，契约面更大、需新 schema/动作，暂不推荐。
- **C**：只保留 memory/known-gap，不满足 AU-12 后果。
- 字段缺失/非法：继续拒绝采纳；锁定冲突：沿用 revision conflict；跨作品：run work_id 绑定，不做跨作品写；重复请求按幂等回执。
- 未采纳/放弃/过期：零 works 写入；显示候选与来源字节由现有 artifact/rationale 保持，APP 不补写创作内容。

**CP1 下一步**：实现 A 的 domain 字段白名单/persistence 落位 + DTO/概览/ContextAssembler 消费，补局部测试；再预注册真实 Tauri 概览修订→候选→采纳→刷新/新会话→模型请求字节证据（不新建平行资料表、不改 B39 规划所有权）。

### CP1 实施记录与 producer 阻塞（2026-10-31）

**已实现**
- persistence `work_skeleton_suggestion` 显式 field-value 白名单扩展：target_length/planned_volumes/serial_form + premise/theme/main_goal/core_selling_point/target_reader/tone_preference；数值/文本类型校验，缺失/非法拒绝，不写记忆、不建平行表；revision 沿用 Work.changeset optimistic lock。
- `WorkService.to_dto` 暴露通用立项字段；`WorkArchiveRepo.profile` 已有 premise/theme/main_goal，前端 `WorkProfile`/StructurePanel 概览新增「前提/主题/主线目标」行（copy 集中）。
- `ContextAssembler.current_work_context_parts` 加入 premise/theme/main_goal，使模型上下文与 works 同源。
- 测试：adoption 落位/拒绝 (54/0)、Work DTO、全量 backend **1058/0**、前端 **657/657**+lint。

**producer 阻塞（需裁决）**
- 现役 producer 只有 VS-00G fact inventory 的 3 个 skeleton 字段；作者从档案概览点「提出立项修订」走自然语言，judgment/chat 没有生成 `work_skeleton_suggestion` 显式字段项的工具/契约，因此真实页面 `概览修订→候选→采纳→刷新/新会话→模型请求` 无法闭环。
- 选项：
  - **A（推荐，最小）**：在现役 judgment/创作工具边界增加显式「立项字段修订提案」能力（复用 work_skeleton_suggestion + field/value，无新表/ADR），概览入口改为提交结构化修订意图；
  - **B**：扩展 fact inventory 生成全部立项字段提案（只覆盖批量盘点，不覆盖概览点改）；
  - **C**：先做作者可编辑表单单写 works（新增 UI/版本边界，不等于候选采纳链）。
- 未裁决前不加新 artifact/tool、不改 acceptance；不把 world_setting 全量覆盖 works。

### CP1 A producer 实施记录（2026-10-31）

- `JudgmentToolContract` 新增 `propose_work_profile_revision`：显式 field 白名单（premise/theme/main_goal/卖点/读者/基调/体量/卷数/连载形态）+ title/body/value/author_reasoning；数值正整数校验、文本非空。
- `JudgmentProtocol` 归一为 `work_profile_revision` 操作（frame_type execution_candidate）、校验 discussion_only/未知字段/非法值，输出 profile_revision 结构。
- `DialoguePlanningService` 将该操作投影为 pending `work_skeleton_suggestion`（title/body/rationale 逐字来自 provider，带 skeleton_field/value）；available accept/discard/edit 走既有采纳；**未采纳零 works 写**，采纳后沿用 CP1 落位链。
- 测试：judgment protocol 新增 2 组用例（成功/非法字段/数值）；全量 backend **1063/0**、frontend 657/657。
- 文档：UA-01 §2.2.2 增加 C2 工具契约、映射/终态表行；fixture `slice_verify` 识别概览立项修订意图并返回该工具。
- **待做**：旧 `au12-correction-intent-roundtrip` 场景/driver/verifier 仍期待旧 world_setting 语义，需按 A 重锚；新增/改造真实页面「概览修订→候选→采纳→概览/新会话消费」证据。

### P2 实现与页面证据（2026-10-31，作者选 A；task_done 待原生 surface）

- **CP1 producer**：`propose_work_profile_revision` 显式字段白名单/值校验 → `work_profile_revision` 操作 → pending `work_skeleton_suggestion`（title/body/rationale 逐字 provider，未采纳零 works 写）。
- **CP2 真实页面采纳**：`au12-correction-intent-roundtrip` 重锚 PASS——概览「提出立项修订」→ pending 候选（main_goal）→ 作者点「采纳为全书规划」→ `works.main_goal` 回写、概览与 API 同源显示、无 `world_setting` 记忆副作用。
- **CP3 后续消费**：新会话真实请求 prompt 含采纳后的 `main_goal`，证明不是只写库。
- 证据：`artifacts/slice-verify/au12-correction-intent-roundtrip-tauri/summary.json`，behavior `work_profile_correction_explicit_field_proposal_adopted_into_works`，11 条断言；`work-profile-revision.json`。
- 门禁：backend 1063/0、frontend 657/657、typecheck/lint、I1/I2/I3、manifest 222/224。
- 注：为支持 API 数据核对，`WorksController.serialize/1` 增补只读立项字段（title/genre/status 等之外），不改变写路径。

### 收口阻塞（2026-10-31）

- 场景 `au12-correction-intent-roundtrip` PASS（11 断言），但 `summary.json` 如实记录 `surface: "browser"`、`requested_surface: "tauri"`、`tauri_window_launched: true`；外部 driver 仍是 headless Chromium，不是原生 webview。
- `task_done.sh` 因此拒绝：`UI summary must come from Tauri surface`；静态扫描 `task-done-manifest` 失败为同一环境能力缺口，未用假 summary 绕过。
- 已登记残余：Q1C-NATIVE / 原生 Tauri webview driver；需作者裁决「补原生 driver」还是「调整验收 surface 判据」。
