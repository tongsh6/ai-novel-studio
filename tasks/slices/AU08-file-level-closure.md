# AU08 File-Level Closure

- 状态：done
- 类型：Acceptance Slice / Projection Slice / UI Contract Slice
- 启动日期：2026-06-21

## 1. 用户 / 系统目标

把 `docs/design/acceptance/author/AU-08-reading-mode.md` 从 2026-05 的 mock/缺 handler 旧结论推进到当前 checkout 的文件级可交付状态：逐场景对账真实 Reading Projection 链路、补 quality manifest 入口、把未闭合的 projection refresh 状态机登记为 P1 后续，而不是把单个历史 checkpoint 当成 AU-08 全量完成。

## 2. 开工检查

- Contract: `docs/design/acceptance/author/AU-08-reading-mode.md`；`docs/design/acceptance/SCENARIO-BLUEPRINT.md` 的“采纳到阅读投影”；`docs/design/contracts/VS-04-adoption-boundary-contract-pack.md`；`docs/design/adr/ADR-0016-projection-hint-ui-v3.md`；`docs/design/ui/44-reading-mode.md`；新增 `quality/acceptance/scenarios/p1-*.yml`。
- Invariant: 已采纳正文才进入 Reading Projection；pending/未采纳内容不进入 TOC/正文；TOC/正文按 `work_id` 隔离；ProjectionHint 不授权写 production state；阅读模式不得展示 mock 为真实作品。
- Boundary: 本 checkpoint 只改外部 harness / verifier、quality manifest、docs 和 tasks。生产 `frontend/src` 与 umbrella app runtime 不改；不新增验收 env/query/localStorage/DOM hook；不把 fixture provider 注册进 production runtime。
- Consumer: `bash scripts/quality_accept.sh p1-chapter-adoption-reading --surface tauri`、`p1-chapter-edit-then-accept`、`p1-word-count-audit`、`p1-chapter-expansion-multichapter`、`p1-export-minimum`；AU-08 文件级审计矩阵。
- Proof: `pnpm --dir frontend test -- --run frontend/slice-verify/native-tauri-verifier.test.mjs`；新增/复跑 quality acceptance；`bash scripts/quality_manifest_check.sh`；`bash scripts/task_done.sh`；`bash scripts/ai_static_scan.sh --top 10`。
- Acceptance Driver: `bash scripts/tauri_slice_verify.sh p1-chapter-adoption-reading` 证明采纳后正文、字数和 STALE banner；`p1-chapter-edit-then-accept` 证明编辑后采纳；`p1-word-count-audit` 证明短章/P1 进度；`p1-chapter-expansion-multichapter` 证明多章归属、目录点击和空章诚实显示；`p1-export-minimum` 证明导出读取已采纳事实。产品代码新增验收感知逻辑：no。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 未改 |
| novel_domain | no | 未改 |
| novel_agent | no | 未改 |
| novel_application | no | 未改 |
| novel_persistence | no | 未改 |
| novel_web | no | 未改 |
| frontend | yes | 只改 `frontend/slice-verify` 外部 driver / verifier / verifier tests |
| scripts | yes | 只改验收 harness：`scripts/tauri_slice_verify.sh` 的 Tauri 配置同步改为内容变化时才覆盖，避免 watcher 因无效 mtime 变化重启 |
| docs/design | yes | 更新 AU-08、SCENARIO-BLUEPRINT、acceptance README、project ledger |
| quality | yes | 新增 P1 Reading Projection quality manifests 并登记总表 |
| tasks | yes | 新增 AU-08 文件级收口记录并更新 slice 索引 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 重新审计 AU-08 当前实现、测试、Tauri artifacts 与质量入口 | done | 旧 mock/缺 handler 口径已被当前实现取代 |
| T2 | 补强 Tauri verifier：采纳后 STALE banner；多章 TOC 点击；空章诚实显示 | done | 只改外部 harness，不改 production UI |
| T3 | 新增 P1 Reading Projection quality manifests 并登记索引 | done | `p1-chapter-adoption-reading` 等 5 个 manifest |
| T4 | 更新 AU-08 文件级场景矩阵与 P1/P2 缺口分级 | done | P0=0；projection refresh 状态机登记 P1 |
| T5 | 复跑真实 Tauri / quality acceptance 与质量门禁 | done | 见 §5 |

## 5. 验证

- [x] 外部 verifier 单测：`pnpm --dir frontend test -- --run frontend/slice-verify/native-tauri-verifier.test.mjs`
- [x] 外部自动化驱动真实页面：`bash scripts/quality_accept.sh p1-chapter-adoption-reading --surface tauri`
- [x] 外部自动化驱动真实页面：`bash scripts/quality_accept.sh p1-chapter-edit-then-accept --surface tauri`
- [x] 外部自动化驱动真实页面：`bash scripts/quality_accept.sh p1-word-count-audit --surface tauri`
- [x] 外部自动化驱动真实页面：`bash scripts/quality_accept.sh p1-chapter-expansion-multichapter --surface tauri`
- [x] 外部自动化驱动真实页面：`bash scripts/quality_accept.sh p1-export-minimum --surface tauri`
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/task_done.sh --skip-static-scan && node scripts/task_done_check.mjs`
- [x] `bash scripts/ai_static_scan.sh --top 10`（completed；1 个历史 gitleaks `accepted_risk`，0 touched-file finding，blocking=0，命令因 secret leak scan finding 返回非零）

## 6. 决策日志

- 2026-06-21 — 不再沿用 2026-05 “AU-08 0/16 完整验收”的旧口径。当前真实链路已经有 Channel/Application/Persistence Reading Projection；核心阅读主链以 P1 chapter drivers 为当前 evidence source。
- 2026-06-21 — Projection refresh job/status machine 仍未闭环：专用 refresh action、REBUILDING/FAILED 真实来源、refresh no-write driver 登记为 AU-08 P1，不把普通聊天文本 refresh 伪装为已完成的 projection refresh。
- 2026-06-21 — 本 checkpoint 只补外部 harness/quality/docs/tasks，不改产品代码，因此没有新增产品验收感知逻辑。
- 2026-06-21 — `scripts/tauri_slice_verify.sh` 的 `sync_tauri_conf` 改为幂等覆盖，避免目标内容不变时仅因重写 `tauri.conf.json` 触发 Tauri watcher 重建；这是验收 harness 稳定性修复，不改变产品 runtime。

## 7. 试行反馈

- AU-08 历史 evidence `au08-adoption-reading-projection` 仍可作为背景，但当前可复跑入口应优先使用 `p1-chapter-adoption-reading`、`p1-chapter-edit-then-accept`、`p1-chapter-expansion-multichapter` 等 `tauri_slice_verify.sh --list` 中的 slice。
- Reading Projection 的“当前可读”与“异步 projection refresh job/status machine”应分开验收；前者是 AU-08 文件级核心，后者是后续 P1 能力。
