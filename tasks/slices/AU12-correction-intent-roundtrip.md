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
