# AU12 Work Profile Status Isolation / 作品档案状态、空字段与隔离矩阵

- 状态：done
- 类型：Acceptance Slice + UI Contract Slice + Projection Slice
- 启动日期：2026-06-21
- 所属验收：`docs/design/acceptance/author/AU-12-work-profile.md` SC-AU12-A4 / B1 / B2 / B3 / C1。
- 所属设计：`docs/design/ui/43-structure-panel.md` §3 / §5，`docs/design/domain/34-novel-element-field-priority.md`。

## 1. 用户 / 系统目标

作者在真实 Tauri 工作台查看作品档案时，不只要能看到 CP1 的立项字段，还必须能判断这些字段是已确认还是待确认；当字段缺失时看到诚实的「暂未填写」；切换作品后，概览、角色、伏笔和规则都只展示当前作品的数据；查看档案本身不能产生 adoption、tool 或 production write。

本 checkpoint 关闭 AU-12 当前可由外部验收补证的文件级 P0/P1 缺口；`SC-AU12-C2` 从概览发起 correction 修订意图仍登记为后续 checkpoint，不在本次用验收脚本假装完成。

## 2. 开工检查

- **Contract**：消费 `AU-12-work-profile.md` A4/B1/B2/B3/C1；`WorkArchiveService.profile/1` / Channel `get_work_profile`；前端 `WorkProfile` / `StructurePanel` 概览 tab。
- **Invariant**：
  - `status=ACCEPTED` 与 `status=TENTATIVE` 在真实 UI 中可辨。
  - 缺失立项字段必须显示「暂未填写」，不得留空或编造。
  - 切换作品后，概览、角色、伏笔、规则均按当前 work 隔离。
  - 档案查看不产生 tool/adoption/production write，也不泄漏内部 Work UUID。
- **Boundary**：
  - 验收 seed 位于 `scripts/`，只准备测试数据。
  - 真实链路：Tauri Workbench UI -> StructurePanel -> Channel `get_work_profile` / archive readers -> WorkArchiveService/Repo。
  - 不改 provider/runtime，不改 persistence schema，不向生产代码加入 slice id/env/query/localStorage/DOM hook。
- **Consumer**：真实作者在工作台从作品菜单切换作品、打开作品档案、切换概览/大纲/角色/伏笔/规则。
- **Proof**：
  - `bash scripts/tauri_slice_verify.sh au12-work-profile-status-isolation`
  - `bash scripts/quality_accept.sh au12-work-profile-status-isolation --surface tauri`
  - targeted verifier / frontend / backend tests。
- **Acceptance Driver**：新增外部 Tauri driver；产品代码不感知本 slice。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | |
| novel_domain | no | |
| novel_agent | no | |
| novel_application | no | 只复用既有 `WorkArchiveService` |
| novel_persistence | no | seed 脚本用测试环境直接准备数据，不改 schema/runtime |
| novel_web | no | 只复用既有 Channel |
| frontend | yes | 只改验收 driver/verifier；如发现 UI 缺口再最小修复 |
| docs/design | yes | AU-12 验收文件和索引同步 |
| quality | yes | 新增 scenario manifest |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 新增 seed：accepted 作品 + 空字段作品 + foreign archive facts | done | `scripts/seed_au12_work_profile_status_isolation.exs` |
| T2 | 新增 Tauri driver / verifier / shell 注册 | done | `au12-work-profile-status-isolation` 已出现在 `scripts/tauri_slice_verify.sh --list` |
| T3 | 新增 quality scenario manifest 并挂入总表 | done | `quality/acceptance/scenarios/au12-work-profile-status-isolation.yml` |
| T4 | 复跑 AU-12 真实验收和局部测试 | done | 形成 `artifacts/slice-verify/au12-work-profile-status-isolation-tauri/summary.json` |
| T5 | 同步 AU-12 文件级矩阵和 ledger | done | AU-12 P0 关闭，剩余 P1/P2 见 `AU12-file-level-closure.md` |

## 5. 验证

- [x] `bash scripts/tauri_slice_verify.sh au12-work-profile-status-isolation`
- [x] `bash scripts/quality_accept.sh au12-work-profile-status-isolation --surface tauri`
- [x] frontend targeted verifier tests：`pnpm test -- native-tauri-verifier.test.mjs`
- [x] 后端 / frontend targeted regression tests
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/check_design_trace.sh`
- [x] `bash scripts/task_done.sh --slice au12-work-profile-status-isolation --top 10`（执行完成；历史 `gitleaks` accepted_risk 返回 1，blocking=0）
- [x] `bash scripts/ai_static_scan.sh --top 10`（由 `task_done` 执行；Top 10 仅历史 `gitleaks` accepted_risk，0 touched files）

## 6. 决策日志

- 2026-06-21 — 选取状态/空字段/隔离/no-write 矩阵作为 AU-12 文件级 checkpoint。C2 correction 修订入口不是已有能力，不能用 driver 冒充，登记为后续 P1/P0 视文件级退出评估决定。
- 2026-06-21 — checkpoint 已闭环：真实 Tauri driver 证明 accepted/tentative 状态、空字段、五个档案 tab 导航、跨作品概览/角色/伏笔/规则隔离、no-write 和 UUID 脱敏。C2 correction 与读取失败降级登记为 AU-12 文件级 P1 后续。
