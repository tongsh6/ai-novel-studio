# SU02 Work Restart Recovery

- 状态：checkpoint closed（作品重启恢复与 stale lastOpened 降级最小真实工作台 checkpoint 已补；SU-02 全量矩阵未完成）
- 类型：UI Contract Slice / Acceptance Slice / System Slice
- 启动日期：2026-06-19

## 1. 用户 / 系统目标

系统用户关闭或刷新工作台后，应用应恢复到上次打开的真实作品；如果上次作品已经被安全移出或不可用，应用必须回退到另一个真实可用 Work，不能恢复到 `DISCARDED` work，也不能把 `lobby` 当成真实作品。

本 slice 只补 `SC-SU02-D1/D2` 的重启恢复最小闭环。它不补完整跨作品 artifact/projection/trace 隔离矩阵，也不补真实慢 LLM 迟到结果归属；这些仍作为 SU-02 后续缺口。

## 2. 开工检查

- Contract: `docs/design/acceptance/system/SU-02-work-switching.md` `SC-SU02-D1/D2`；`pickInitialWorkId`；`getLastOpenedWorkId` / `setLastOpenedWorkId`；Work list/discard 合同。
- Invariant: lastOpened 只能恢复仍存在的真实 Work；`DISCARDED` work 不出现在默认作品列表，也不能成为当前 work；`lobby` 不能被持久化或恢复为真实作品。
- Boundary: 本 checkpoint 只改外部 driver/verifier、quality manifest、slice 记录和验收文档；不修改 production runtime、`novel_agent`、`novel_domain`、`novel_persistence` 或 `novel_web`。
- Consumer: 第一个真实消费者是 `WorkspaceChat` 启动时的作品选择和 `openWork` join 流程。
- Proof: 外部 driver 选中真实作品后 reload，证明 lastOpened 恢复；再由外部 harness 将该 Work 安全移出并模拟 stale lastOpened，reload 后证明回退到真实可用 Work。
- Acceptance Driver: `su02-work-restart-recovery`，通过 `frontend/slice-verify/external-ui-driver.mjs` 操作真实工作台；产品代码不读取 slice id、URL query、localStorage 验收开关，也不新增隐藏 DOM hook。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不新增基础类型。 |
| novel_domain | no | 不新增领域抽象。 |
| novel_agent | no | 与 provider/runtime 无关。 |
| novel_application | no | 复用现有 WorkService。 |
| novel_persistence | no | 复用现有 WorkRepo list/discard 行为。 |
| novel_web | no | 复用现有 WorksController 和 Channel join。 |
| frontend | yes | 只改外部 slice driver/verifier，不改生产 React 组件。 |
| docs/design | yes | 回填 SU-02 恢复 checkpoint 证据和未闭环限制。 |
| quality | yes | 新增 scenario manifest 和 Tauri verifier 入口。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 核查 SU-02 D1/D2 当前实现与证据 | done | Tauri preference command 和 `lobby` 过滤已存在；缺真实 reload checkpoint。 |
| T2 | 新增重启恢复外部 driver | done | slice id：`su02-work-restart-recovery`。 |
| T3 | 新增 verifier / 单测 / quality manifest | done | summary 记录 restored/fallback/discarded work id。 |
| T4 | 回填 SU-02 / 蓝图 / README / 台账 | done | 不把 pending 迟到结果、artifact/projection/trace 全矩阵写成 closed。 |
| T5 | 跑必要验证与静态扫描 | done | 真实验收、quality acceptance、局部测试、manifest、task_done 和 static scan 已闭环；static scan 只剩既有 gitleaks accepted risk。 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh su02-work-restart-recovery`
- [x] quality 场景入口：`bash scripts/quality_accept.sh su02-work-restart-recovery --surface tauri`
- [x] 前端 verifier 局部验证：`pnpm --dir frontend test -- native-tauri-verifier.test.mjs`
- [x] Work preference helper 局部验证：`pnpm --dir frontend test -- works.test.ts`
- [x] 前端门禁：`cd frontend && pnpm typecheck && pnpm lint && pnpm test`
- [x] 后端/架构：`mix compile --warnings-as-errors`、`mix xref graph --format cycles --label compile-connected --fail-above 0`、`mix run scripts/arch_check.exs`
- [x] quality manifest：`bash scripts/quality_manifest_check.sh`
- [x] 设计追溯：`bash scripts/check_design_trace.sh`
- [x] 静态扫描：`bash scripts/ai_static_scan.sh --top 10`（17/18 pass；剩余 gitleaks 为既有 `accepted_risk`，blocking=0）

证据：`artifacts/slice-verify/su02-work-restart-recovery-tauri/summary.json`，summary 记录 `first_restored_work_id == stale_last_opened_work_id`、`discarded_status=DISCARDED`、`fallback_work_id != discarded_work_id`、`fallback_work_id != "lobby"`。

## 6. 决策日志

- 2026-06-19 — SU-02 当前最高优先级缺口中，真实慢 LLM 迟到结果归属需要更深的异步/持久化语义证明；本轮先选择同文件内可闭环的重启恢复 checkpoint，补齐 `SC-SU02-D1/D2` 的外部验收。
- 2026-06-19 — 当前实现已在 Tauri 下通过 app config preference 保存 lastOpened，并通过 `shouldPersistLastOpenedWorkId` 阻止 `lobby` 持久化；SU-02 文档中“lastOpened 仍用 localStorage”的旧口径需要同步纠偏。
- 2026-06-19 — checkpoint closed：`su02-work-restart-recovery` 已证明 reload 恢复 existing lastOpened；当 stored lastOpened 指向已 `DISCARDED` 的 Work 时，工作台回退到真实可用 Work 并替换 stale preference。

## 7. 试行反馈

- 当前 `tauri_slice_verify.sh` 的外部 driver 仍以可见工作台 DOM、业务日志和 API 证据为主；本 checkpoint 证明恢复选择和 channel join 语义，不声称已覆盖 OS-level Tauri preference 文件读写。
