# AU03 Current Work / Archive Evidence Entry

- 状态：checkpoint closed
- 类型：Acceptance Slice / Quality Runtime Slice
- 启动日期：2026-06-20
- 来源：`docs/design/acceptance/author/AU-03-context.md` SC-AU03-A1/C5/D1/D2、`docs/design/acceptance/SCENARIO-BLUEPRINT.md` P0 作品内会话管理闭环。

## 1. 用户 / 系统目标

作者打开历史会话或归档会话时，系统必须保留历史 transcript 的只读边界；回到当前 active session 后，AI 使用最新 Work 背景和当前会话 transcript，而不是历史 transcript。归档会话默认不出现在日常会话列表，但仍可显式搜索回看。

本 checkpoint 不新增产品能力；当前业务实现和 native verifier 已存在，缺口是 `tauri_slice_verify.sh` / quality manifest 没有把 `au03-current-work-context-ssot` 与 `au03-archive-session-filter` 挂回当前可复跑入口，导致 AU-03 文件级审计只能引用历史 artifact。

## 2. 开工检查

- Contract: AU-03 SC-AU03-A1/C5/D1/D2、`WorkSessionService.show/archive`、`WorkspaceContext.context_fetcher_with_query/0`、quality scenario manifest。
- Invariant: 最新 Work snapshot 与 active session transcript 分层；历史/归档会话只读且普通 context 默认不召回；当前可复跑证据不能依赖历史 artifact。
- Boundary: 只改 `scripts/tauri_slice_verify.sh`、`frontend/slice-verify` 外部 driver/verifier 注册、`quality/acceptance/scenarios*`、`tasks/slices` 和验收文档；不改 `frontend/src` 或 `apps/*/lib` 产品 runtime。
- Consumer: `bash scripts/tauri_slice_verify.sh au03-current-work-context-ssot`、`bash scripts/tauri_slice_verify.sh au03-archive-session-filter` 与对应 `quality_accept.sh`。
- Proof: 两条真实 Tauri driver 重新生成 summary；`pnpm --dir frontend test -- native-tauri-verifier.test.mjs`；`bash scripts/quality_manifest_check.sh`；`bash scripts/task_done.sh --slice au03-current-work-context-ssot --skip-static-scan`；`bash scripts/task_done.sh --slice au03-archive-session-filter --skip-static-scan`；`bash scripts/ai_static_scan.sh --top 10`。
- Acceptance Driver: `frontend/slice-verify/external-ui-driver.mjs` 外部驱动真实页面；产品代码不新增验收感知逻辑。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不改 enum / Result |
| novel_domain | no | 不改领域 struct |
| novel_agent | no | 不改 provider/runtime |
| novel_application | no | 不改 ContextAssembler / WorkSessionService |
| novel_persistence | no | 不改 Repo / schema / seed 以外生产代码 |
| novel_web | no | 不改 controller/channel |
| frontend/src | no | 不改生产 React 组件 |
| frontend/slice-verify | yes | 接入外部 UI driver 与现有 native verifier evidence |
| scripts | yes | `tauri_slice_verify.sh` list/seed/gate 接入 |
| quality | yes | 新增 scenario manifest 与总表登记 |
| docs/design | yes | 更新 AU-03 文件级状态和总蓝图 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 补 `au03-current-work-context-ssot` 外部 driver / shell / quality 入口 | done | 不改产品 runtime |
| T2 | 补 `au03-archive-session-filter` 外部 driver / shell / quality 入口 | done | 复用历史会话 seed |
| T3 | 复跑两条真实 Tauri 验收 | done | 已生成当前 summary；current-work 另有 `--real-lmstudio` 证据 |
| T4 | 同步 AU-03、SCENARIO-BLUEPRINT、acceptance README、project ledger | done | 文件级矩阵更新 |
| T5 | 运行 task_done 与 static scan | done | static scan 1 条既有 accepted_risk，0 touched-file finding，blocking=0 |

## 5. 验证计划

- [x] `node --check frontend/slice-verify/external-ui-driver.mjs`
- [x] `bash scripts/tauri_slice_verify.sh --list`
- [x] `pnpm --dir frontend test -- native-tauri-verifier.test.mjs`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/tauri_slice_verify.sh au03-current-work-context-ssot`
- [x] `bash scripts/tauri_slice_verify.sh --real-lmstudio au03-current-work-context-ssot`
- [x] `bash scripts/tauri_slice_verify.sh au03-archive-session-filter`
- [x] `bash scripts/task_done.sh --slice au03-current-work-context-ssot --skip-static-scan`
- [x] `bash scripts/task_done.sh --slice au03-archive-session-filter --skip-static-scan`
- [x] `bash scripts/ai_static_scan.sh --top 10`（17 pass / 1 fail；Top 10 为既有 gitleaks accepted_risk，0 touched-file finding，blocking=0）

## 6. 决策日志

- 2026-06-20 — AU-03 文件级审计发现 `native-tauri-verifier` 和历史 artifacts 已有 current-work/archive 证据识别，但 `tauri_slice_verify.sh --list`、external driver map 和 quality manifest 未暴露当前入口。先补运行体系入口，避免把历史 artifact 冒充当前验收。
- 2026-06-20 — 已补两条外部 UI driver、`tauri_slice_verify.sh --list`/seed/gate 和 quality manifest。验证通过：`au03-current-work-context-ssot`、`au03-current-work-context-ssot --real-lmstudio`、`au03-archive-session-filter`、`native-tauri-verifier.test.mjs`、`quality_manifest_check.sh`。证据：`artifacts/slice-verify/au03-current-work-context-ssot-tauri/summary.json`、`artifacts/slice-verify/au03-current-work-context-ssot-tauri-lmstudio/summary.json`、`artifacts/slice-verify/au03-archive-session-filter-tauri/summary.json`。
- 2026-06-20 — `quality_accept.sh` 两条 AU-03 manifest 均通过；`task_done.sh` 已在最终文档同步后分别为 `au03-current-work-context-ssot` 与 `au03-archive-session-filter` 生成 manifest 并通过检查。`ai_static_scan.sh --top 10` 的唯一已知非代码问题为 `tools/company-console/server/config.mjs:4` 既有 gitleaks `accepted_risk`；本 checkpoint 不新增 touched-file finding。
