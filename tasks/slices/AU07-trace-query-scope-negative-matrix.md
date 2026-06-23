# AU07 Trace Query Scope Negative Matrix

- 状态：checkpoint closed / AU-07 E3 closed
- 类型：Acceptance / Trace Replay / Tauri Slice
- 验收文件：`docs/design/acceptance/author/AU-07-trace-and-replay.md`
- 场景：SC-AU07-E3 跨作品和历史会话 trace 隔离

## 开工检查

- Contract: AU-07 SC-AU07-E3；`TraceReplayService.fetch_turn_report/3`；`TraceReplayController` 的 `/api/works/:work_id/sessions/:session_id/turns/:turn_id/replay`；VS-06 ReplayReport no-provider replay。
- Invariant: replay 查询必须按 `work_id` / `session_id` / `turn_id` 同时限定；跨 work、跨 session、同 work 其他 session 和 missing turn 请求不得返回 trace，不得调用 provider，不得写作品状态，不得把错误注入产品 UI。
- Boundary: 外部 Tauri driver 先通过真实工作台建立普通 turn，再从产品外部请求 replay API 负向组合；允许改外部 harness、verifier、quality manifest 和台账；不新增产品验收 env/query/localStorage、DOM hook 或自动输入/点击逻辑。
- Consumer: `WorkspaceChat` 旧消息 why 入口、`TraceReplayController`、AU-07/E2E/SU-02/AU-03 的 trace 隔离 cross-reference。
- Proof: `node --check frontend/slice-verify/external-ui-driver.mjs`；`node --check frontend/slice-verify/native-tauri-verifier.mjs`；`bash -n scripts/tauri_slice_verify.sh`；`pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`；`bash scripts/quality_manifest_check.sh`；`bash scripts/quality_accept.sh au07-trace-query-scope-negative-matrix --surface tauri`；`task_done` 与 static scan。
- Acceptance Driver: `scripts/tauri_slice_verify.sh au07-trace-query-scope-negative-matrix`，由外部 Playwright/Tauri driver 驱动真实页面并读取 API response matrix / app log / UI state；产品代码新增验收感知逻辑：no。

## 缺口依赖矩阵

| 场景 ID / 名称 | 原 blueprint 位置 | 本轮处理顺序 | 第一轮状态 | 第二轮状态 | 剩余缺口描述 | 缺口类型 | 优先级 | 当前证据 | 依赖关系与重排理由 | 已补实现或验收 driver | 是否已真实验收 | 回填到哪些验收文件 | 是否仍应在 AU-07 内关闭 | 建议 checkpoint / slice | 是否满足恢复 blueprint 顺序 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SC-AU07-E3 跨作品和历史会话 trace 隔离 | AU-07 / E3；同时影响 SU-02、AU-03、AU-01、E2E-01 | AU-07 二轮依赖 checkpoint，位于 old-turn query / partial UI / gate reason 后 | 部分实现 | 已验收 | scoped negative matrix 已闭合；developer 权限模型、旧 workspace_id 迁移设计和会话级完整 replay 仍为后续 | P1 closed / P1-P2 follow-up | closed/P1-P2 | `artifacts/slice-verify/au07-trace-query-scope-negative-matrix-tauri/summary.json`：valid replay 200；四个负向请求均 404；无 trace_summary/replay_report 泄漏；错误未进 UI；no-provider/no-tool/no-write | 下游 AU-01/AU-03/E2E 的 replay/trace cross-reference 依赖真实 scoped negative proof；先补本 checkpoint 可避免下游继续只引用局部 service tests | 新增 `au07-trace-query-scope-negative-matrix` 外部 Tauri driver、native verifier、quality manifest | 是 | AU-07、AU-01、SU-02、AU-03、E2E-01、SCENARIO-BLUEPRINT、acceptance README、project-ledger | 当前应关闭项已关闭；剩余 developer/migration 不在本 checkpoint 伪关闭 | 保持 `AU07-trace-query-scope-negative-matrix` 回归；后续 `AU07-developer-view-boundary` / migration design | 是 |

## 验收证据

- `artifacts/slice-verify/au07-trace-query-scope-negative-matrix-tauri/summary.json`
- `artifacts/slice-verify/au07-trace-query-scope-negative-matrix-tauri/ui-state.json`
- `artifacts/slice-verify/au07-trace-query-scope-negative-matrix-tauri/app-log.json`
- `artifacts/slice-verify/au07-trace-query-scope-negative-matrix-tauri/au07-trace-query-scope-negative-matrix-external-ui.png`

关键事实：

- 原 work/session/turn replay 返回 200，且 response scope 匹配可见 turn。
- `foreign_work_with_source_session` 返回 404 / `session_not_found`。
- `source_work_with_foreign_session` 返回 404 / `session_not_found`。
- `source_work_with_same_work_other_session` 返回 404 / `trace_not_found`。
- `source_scope_with_missing_turn` 返回 404 / `trace_not_found`。
- 所有负向响应均未包含 `trace_summary` 或 `replay_report`。
- 负向错误未出现在产品 UI。
- replay 未调用 provider，setup turn 未调用工具、未写生产状态。

## 验证命令

```bash
node --check frontend/slice-verify/external-ui-driver.mjs
node --check frontend/slice-verify/native-tauri-verifier.mjs
bash -n scripts/tauri_slice_verify.sh
bash scripts/quality_manifest_check.sh
pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs
bash scripts/quality_accept.sh au07-trace-query-scope-negative-matrix --surface tauri
```

最终收口还需在文档/ledger/quality 更新后运行：

```bash
bash scripts/task_done.sh --slice au07-trace-query-scope-negative-matrix --skip-static-scan
bash scripts/ai_static_scan.sh --top 10
node scripts/task_done_check.mjs
```

## 决策日志

- 2026-06-22 — 该 checkpoint 按依赖关系提前处理，因为 AU-07 E3 的 scoped negative proof 同时阻塞 AU-01 D1、SU-02 trace isolation、AU-03 replay isolation 和 E2E-01 E10 cross-reference 的证据强度。
- 2026-06-22 — 负向请求由外部 harness 直接访问产品 replay API，产品 runtime 不感知 slice id，也没有新增验收专用 DOM hook 或自动上报逻辑。
- 2026-06-22 — 本 checkpoint 只关闭 work/session/turn scoped negative matrix；developer 权限模型、旧 workspace_id 迁移和多类型 replay UI 继续登记为后续 owner。
