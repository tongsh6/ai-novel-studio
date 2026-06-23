# AU12 File-Level Closure / 作品档案文件级收口

- 状态：done
- 类型：Acceptance Slice + UI Contract Slice + Projection Slice
- 启动日期：2026-06-21
- 所属验收：`docs/design/acceptance/author/AU-12-work-profile.md`

## 1. 用户 / 系统目标

把 AU-12 从“只有作品档案概览 CP1”推进到文件级可交付状态：作者能在真实 Tauri 工作台核对 AI 正在消费的作品立项事实，能区分 accepted/tentative、看到空字段、不串作品数据，并且档案查看不产生写入。2026-06-22 二轮又关闭 correction 修订意图与读取失败降级两个 P1：档案发起修订会回到对话主链并产生 pending adoption，不直接写库；读取失败会显示诚实错误态，可重试恢复真实档案字段，且 no-write。

## 2. 开工检查

- **Contract**：`AU-12-work-profile.md`；`docs/design/ui/43-structure-panel.md` §3/§5；`WorkArchiveService.profile/1`；Channel `get_work_profile`；`StructurePanel` 概览/大纲/角色/伏笔/规则 tab。
- **Invariant**：AU12-I1 profile 单一事实源；AU12-I2 档案只读 no-write；AU12-I3 不泄漏内部 Work UUID；AU12-I4 按当前 work 隔离；AU12-I5 tentative/accepted 可辨；AU12-I6 空字段/读取失败诚实显示；AU12-I7 correction intent 回到对话与采纳边界。
- **Boundary**：真实 Tauri Workbench UI -> StructurePanel -> Channel -> WorkArchiveService/Repo；correction checkpoint 额外穿过 `WorkspaceChat.handleSend(generateMicroPlan=true)` -> `DialogueGateway` -> Planner/MicroPlan/Orchestrator -> `world_building` -> pending `world_setting`。未改 provider/runtime、未改 production schema、未新增 slice id/env/query/localStorage/DOM hook。
- **Consumer**：作者从作品菜单切换作品、打开作品档案、切换概览/大纲/角色/伏笔/规则并核对内容；需要修订时从概览点击「提出立项修订」回到对话流。
- **Proof**：`au12-work-profile-overview`、`au12-work-profile-status-isolation`、`au12-correction-intent-roundtrip`、`au12-profile-read-failure-degrade` 四个 Tauri / quality scenarios，native verifier tests，quality manifest check，task_done / AI static scan。
- **Acceptance Driver**：`scripts/tauri_slice_verify.sh au12-work-profile-overview`、`scripts/tauri_slice_verify.sh au12-work-profile-status-isolation`、`scripts/tauri_slice_verify.sh au12-correction-intent-roundtrip` 与 `scripts/tauri_slice_verify.sh au12-profile-read-failure-degrade`；产品代码不感知验收场景。

## 3. 场景对账

| 场景 | 状态 | 真实页面证据 | 局部证据 | 剩余缺口 |
|---|---|---|---|---|
| SC-AU12-A1 概览看立项设定 | 已验收 | `artifacts/slice-verify/au12-work-profile-overview-tauri/summary.json` | `WorkArchiveService.profile/1` / Channel tests | 无 |
| SC-AU12-A2 与 works/prompt 同源一致 | 已测试 | `au12-work-profile-overview` 证明 DTO 字段来自 works 立项字段 | `WorkspaceContext.work_snapshot/1` 与 profile 同源字段口径；backend tests | 同轮 provider prompt 外部证据缺失，P2 加强 |
| SC-AU12-A3 不泄漏 UUID | 已验收 | 两个 AU-12 Tauri summary 均检查 UI/DTO/log 不含内部 Work UUID | Channel log redaction 实现 | 无 |
| SC-AU12-A4 tentative/accepted 可辨 | 已验收 | `artifacts/slice-verify/au12-work-profile-status-isolation-tauri/summary.json` | native verifier assertions | 无 |
| SC-AU12-B1 档案模块导航 | 已验收 | `au12-work-profile-status-isolation` 点击五个真实 tab | StructurePanel 既有 tab 实现 | 无 |
| SC-AU12-B2 作品隔离 | 已验收 | `au12-work-profile-status-isolation` 双作品切换后验证 profile/角色/伏笔/规则隔离 | Channel join work 优先边界测试 | 无 |
| SC-AU12-B3 空字段/失败诚实显示 | 已验收 | `au12-work-profile-status-isolation` 验证空字段「暂未填写」；`au12-profile-read-failure-degrade` 验证读取失败诚实错误态、重试恢复与 no-write | 前端 empty/failure display copy；native verifier assertions | 无 |
| SC-AU12-C1 档案只读 no-write | 已验收 | `au12-work-profile-status-isolation` 统计 no user_message / author_action / adoption / tool / write | 只读 archive APIs | 无 |
| SC-AU12-C2 修订走 correction intent | 已验收 | `artifacts/slice-verify/au12-correction-intent-roundtrip-tauri/summary.json` | `StructurePanel` 可见入口、`WorkspaceChat.handleSend(generateMicroPlan=true)`、native verifier assertions | accepted `world_setting` 是否进一步物化回 works 立项字段为 P2 contract 后续 |
| SC-AU12-D1 真实入口可发现 | 已验收 | 四个 Tauri driver 从真实工作台打开作品档案入口或概览入口 | StructurePanel 入口实现 | 无 |
| SC-AU12-D2 外部自动化验收 | 已验收 | 四个 slice 已挂入 `tauri_slice_verify` / `quality_accept` | quality manifest | 无 |

## 4. 文件级退出结论

- 当前口径：`10/11` 已验收，`1/11` 已测试。
- P0：0 个未闭合。
- P1：0 个未闭合。
- P2：accepted `world_setting` 采纳后是否物化回 works 立项字段；更丰富的 accepted-artifact / world_setting / protagonist 类立项要素字段扩展；同轮 provider prompt 字节级加强 proof。
- 结论：AU-12 二轮应关闭 P1 已关闭，可恢复 blueprint 顺序进入/继续 E2E-01；不能声称作品档案编辑能力或完整 8 模块档案扩展完成。

## 5. 二轮剩余缺口矩阵（2026-06-22）

本轮不推翻 2026-06-21 文件级可交付结论，只复核已登记的 P1/P2、external blocker 和 cross-reference。二轮复跑与新增的当前证据为 4 个 AU-12 quality/Tauri 入口：`au12-work-profile-overview`、`au12-work-profile-status-isolation`、`au12-correction-intent-roundtrip`、`au12-profile-read-failure-degrade`，均通过。AU-12 当前没有 external platform blocker。

| 场景 ID / 名称 | 第一轮状态 | 剩余缺口描述 | 缺口类型 | 优先级 | 当前证据 | 需要补的实现或验收 driver | 是否应在 AU-12 本轮关闭 | 建议 checkpoint / slice | 是否满足继续到 E2E-01 的二轮退出标准 |
|---|---|---|---|---|---|---|---|---|---|
| SC-AU12-A1 概览看立项设定 | 已验收 | 无本轮剩余缺口 | 无 | done | `au12-work-profile-overview`：真实工作台打开作品档案概览，profile fields 来自 `get_work_profile` | 保持 quality 回归 | 否，已关闭 | 已挂入 AU-12 quality | 是 |
| SC-AU12-A2 与 works/prompt 同源一致 | 已测试 | profile DTO 与 `works` 立项字段同源已由实现/测试约束；缺同轮 provider prompt 外部证据 | 加强 proof | P2 | `au12-work-profile-overview` 证明显示侧；`WorkspaceContext.work_snapshot/1` / `WorkArchiveService.profile/1` 同源测试 | 后续补同轮 provider prompt 字节级 proof | 否；显示侧 P0 已闭环，prompt proof 是加强项 | `AU12-profile-prompt-same-source-proof` | 是 |
| SC-AU12-A3 不泄漏 UUID | 已验收 | 无本轮剩余缺口 | 无 | done | 两个 AU-12 summary 均断言 DTO/UI/log 不含内部 Work UUID | 保持 quality 回归 | 否，已关闭 | 已挂入 AU-12 quality | 是 |
| SC-AU12-A4 tentative/accepted 可辨 | 已验收 | 无本轮剩余缺口 | 无 | done | `au12-work-profile-status-isolation`：accepted 显示已确认，empty/tentative 显示待确认 | 保持 quality 回归 | 否，已关闭 | 已挂入 AU-12 quality | 是 |
| SC-AU12-B1 档案模块导航 | 已验收 | 无本轮剩余缺口 | 无 | done | `au12-work-profile-status-isolation`：概览/大纲与结构/角色/伏笔/经验规则 tab 可导航 | 保持 quality 回归 | 否，已关闭 | 已挂入 AU-12 quality | 是 |
| SC-AU12-B2 作品隔离 | 已验收 | 无本轮剩余缺口 | 无 | done | `au12-work-profile-status-isolation`：双作品切换后 profile/角色/伏笔/规则隔离 | 保持 quality 回归 | 否，已关闭 | 已挂入 AU-12 quality | 是 |
| SC-AU12-B3 空字段/失败诚实显示 | 部分实现 | 本轮已关闭读取失败诚实降级；空字段与读取失败均已真实验收 | closed | closed | `au12-work-profile-status-isolation`：4 个空字段显式显示；`au12-profile-read-failure-degrade`：外部停服触发真实错误态，隐藏空档案字段，服务恢复后重试读出真实字段，全程 no-write/no author_action | 保持 quality 回归 | 否，已关闭 | `AU12-profile-read-failure-degrade` | 是 |
| SC-AU12-C1 档案只读 no-write | 已验收 | 无本轮剩余缺口 | 无 | done | `au12-work-profile-status-isolation`：档案查看期间 no user_message / author_action / adoption / tool / write | 保持 quality 回归 | 否，已关闭 | 已挂入 AU-12 quality | 是 |
| SC-AU12-C2 修订走 correction intent | 未实现 | 本轮已关闭 P1；从档案发起修订意图会回到对话主链并重新过 pending adoption 边界，不直接写 works | closed / P2 follow-up | closed/P2 | `au12-correction-intent-roundtrip`：真实档案概览点击「提出立项修订」，`generate_micro_plan=true`，`world_building` 产出 pending `world_setting`，保存/修改/放弃可见，作者选择前 no action/adoption/write | 保持 quality 回归；若要 accepted `world_setting` 物化 works 立项字段需另立 contract | 否，当前应关 P1 已关闭 | `AU12-correction-intent-roundtrip` | 是 |
| SC-AU12-D1 真实入口可发现 | 已验收 | 无本轮剩余缺口 | 无 | done | 四个 AU-12 Tauri driver 均从真实工作台打开作品档案入口或其概览入口 | 保持 quality 回归 | 否，已关闭 | 已挂入 AU-12 quality | 是 |
| SC-AU12-D2 外部自动化验收 | 已验收 | 无本轮剩余缺口；四个 driver 均为外部 Tauri 自动化，产品代码无 slice 感知 | 无 | done | `au12-work-profile-overview`、`au12-work-profile-status-isolation`、`au12-correction-intent-roundtrip`、`au12-profile-read-failure-degrade` quality acceptance 均通过 | 保持 quality manifest 回归 | 否，已关闭 | `AU12-file-level-closure` | 是 |

二轮退出判断：AU-12 本轮已关闭 `SC-AU12-C2` correction 修订意图 P1 与 `SC-AU12-B3` 读取失败诚实降级 P1。A2 prompt proof、accepted `world_setting` 物化 works 字段和更丰富立项要素扩展均为 P2 后续，已明确 owner、证据边界和恢复路径。当前文件满足恢复 blueprint 顺序并进入/继续 E2E-01 后续收口的退出标准。

## 6. 验证

- [x] `bash scripts/tauri_slice_verify.sh au12-work-profile-overview`
- [x] `bash scripts/tauri_slice_verify.sh au12-work-profile-status-isolation`
- [x] `bash scripts/quality_accept.sh au12-work-profile-overview --surface tauri`
- [x] `bash scripts/quality_accept.sh au12-work-profile-status-isolation --surface tauri`
- [x] `bash scripts/quality_accept.sh au12-correction-intent-roundtrip --surface tauri`
- [x] `bash scripts/quality_accept.sh au12-profile-read-failure-degrade --surface tauri`
- [x] `cd frontend && pnpm test -- native-tauri-verifier.test.mjs`
- [x] 后端 / frontend targeted regression tests
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/check_design_trace.sh`
- [x] `bash scripts/task_done.sh --slice au12-correction-intent-roundtrip --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`（执行完成；历史 `gitleaks` accepted_risk 返回 1，touched-file findings=0，blocking=0）
- [x] `node scripts/task_done_check.mjs`

## 7. 决策日志

- 2026-06-21 — 文件级审计确认 CP1 不能代表 AU-12 完成；补 `au12-work-profile-status-isolation` 作为第二 checkpoint，关闭状态/空字段/导航/隔离/no-write 矩阵。
- 2026-06-21 — 读取失败降级和 correction 修订意图不是当前已有能力，不用 driver 假装完成；登记为 P1 后续后允许 AU-12 文件级退出。
- 2026-06-22 — 二轮缺口收敛不回退文件级可交付结论。2 个 AU-12 quality/Tauri 入口串行复跑通过；读取失败降级、correction 修订意图和同轮 provider prompt proof 继续按 P1/P2 登记，当前无 AU-12 本轮必须关闭的 P0/P1，可进入 E2E-01。
- 2026-06-22 — 依赖排序下提前关闭 `SC-AU12-C2` correction 修订意图 P1。`au12-correction-intent-roundtrip` 证明可见档案修订入口会回到对话主链，产出 pending `world_setting` 和保存/修改/放弃动作，作者选择前不直接写库；accepted `world_setting` 是否物化 works 字段另作为 P2 contract。
- 2026-06-22 — 继续关闭 `SC-AU12-B3` 读取失败诚实降级 P1。`au12-profile-read-failure-degrade` 证明外部停服后真实作品档案显示读取失败与重试，不把失败伪装为空字段；服务恢复后点击重试读回真实 profile 字段，全程 no user_message / no author_action / no adoption / no tool / no write。
