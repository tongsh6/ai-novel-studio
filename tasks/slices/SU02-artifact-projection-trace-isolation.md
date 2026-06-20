# SU02 Artifact Projection Trace Isolation

- 状态：checkpoint closed（SC-SU02-C3 文件级剩余 P1 已关闭）
- 类型：Artifact Slice / Projection Slice / UI Contract Slice / Acceptance Slice
- 启动日期：2026-06-20

## 1. 用户 / 系统目标

作者在作品 A 里生成、保留、采纳创作材料后，切到作品 B 时不能看到或消费 A 的待采纳 artifact、已采纳阅读投影或 trace/why 来源；切回 A 时，A 的待采纳或已采纳内容仍归属于 A。

本 checkpoint 关闭 SU-02 `SC-SU02-C3` 中 artifact / projection / trace 三类跨作品隔离矩阵；消息流、记忆和 pending 迟到结果已有独立 checkpoint 证据。

## 2. 开工检查

- Contract: `docs/design/acceptance/system/SU-02-work-switching.md` `SC-SU02-C3`；`docs/design/contracts/VS-04-adoption-boundary-contract-pack.md`；`docs/design/contracts/VS-06-replay-surface-contract-pack.md`；AU-08 reading projection 口径；`WorkspaceChannel` `work_id` scoped action/read model。
- Invariant: 作品 A 的 pending artifact、accepted artifact、reading projection、trace/why source 不得在作品 B 可见或被 B 的 turn 消费；所有 adoption / projection / trace 读写必须绑定当前 `work_id`。
- Boundary: 切穿真实 Tauri 工作台、`novel_web` Channel、`novel_application` adoption / reading projection / trace summary、`novel_persistence` reading projection read model；不修改 provider production runtime，不新增验收专用 DOM hook、env、query、localStorage 或产品 autorun。
- Consumer: 第一个真实消费者是 Tauri 工作台的作品菜单、档案大纲、待保存草稿卡、采纳按钮、阅读模式和 why 面板。
- Proof: `bash scripts/tauri_slice_verify.sh su02-artifact-projection-trace-isolation`；native verifier 单测；reading projection / adoption / trace 现有局部测试；涉及 artifact 主链后运行 I1/I2/I3。
- Acceptance Driver: 外部 Playwright driver 打开真实 Tauri 工作台，使用可见作品菜单、档案 tab、生成正文草稿按钮、保存按钮、阅读模式和 why 按钮；产品代码不新增验收感知逻辑。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不新增基础 enum/schema。 |
| novel_domain | no | 不新增领域模型。 |
| novel_agent | no | 不改 provider/runtime 注册。 |
| novel_application | no | 预期先复用既有 adoption/projection/trace 流；若验收暴露 bug 再最小修正。 |
| novel_persistence | no | 预期先复用既有 work-scoped read model；若验收暴露 bug 再最小修正。 |
| novel_web | no | 预期先复用既有 Channel action/projection/trace 路由。 |
| frontend | yes | 新增外部验收 driver/verifier；不新增产品验收 hook。 |
| docs/design | yes | 回填 SU-02 矩阵、蓝图和 acceptance README。 |
| quality | yes | 新增 scenario manifest 并接入总表。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 新增 SU-02 C3 artifact/projection/trace 外部 Tauri driver | done | 复用 P1 章节草稿/采纳和 SU-02 作品切换真实入口；不改产品代码。 |
| T2 | 新增 native verifier 行为断言和单测 | done | 汇总 pending artifact 不串、projection 不串、why/trace 不串。 |
| T3 | 注册 `tauri_slice_verify` 与 quality manifest | done | `su02-artifact-projection-trace-isolation`。 |
| T4 | 跑真实验收和局部验证 | done | 真实 Tauri、quality_accept、native verifier、后端定向测试和 I1/I2/I3 已通过。 |
| T5 | 回填 SU-02 文件级矩阵和收口状态 | done | SU-02 更新为 13/13 已验收，当前可进入 SU-03；P2 后续保留。 |
| T6 | task_done 与 static scan 闭环 | done | 静态扫描剩历史 gitleaks accepted_risk，blocking=0，touched files=0。 |

## 5. 验证

- [x] 外部自动化驱动真实页面的场景化验收：`bash scripts/tauri_slice_verify.sh su02-artifact-projection-trace-isolation`
- [x] quality 场景入口：`bash scripts/quality_accept.sh su02-artifact-projection-trace-isolation --surface tauri`
- [x] native verifier 局部验证：`pnpm --dir frontend exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] 后端局部验证：reading projection / adoption / trace 相关测试
- [x] scenario invariants：I1 / I2 / I3
- [x] `bash scripts/quality_manifest_check.sh`
- [x] `bash scripts/check_design_trace.sh`
- [x] `bash scripts/task_done.sh --skip-static-scan --slice su02-artifact-projection-trace-isolation`
- [x] `bash scripts/ai_static_scan.sh --top 10`

## 6. 决策日志

- 2026-06-20 — SU-02 文件级复核剩余 P1 集中在 `SC-SU02-C3` 的 artifact / projection / trace 矩阵。已有 `su02-work-switching`、`su02-pending-result-work-isolation` 和 `au09-cross-work-memory-isolation` 分别证明消息、pending 迟到结果和记忆不串，但还不能证明创作材料与阅读投影不串作品。
- 2026-06-20 — `su02-artifact-projection-trace-isolation` 真实 Tauri 验收通过。证据证明源作品 pending prose artifact 不泄漏到目标作品，源作品采纳后 reading projection 只在源作品有章节内容，目标作品 TOC 仍为空，目标 why/trace 不带源作品 artifact/chapter 上下文。SU-02 更新为 13/13 已验收，恢复/归档管理、后端不可用 UX、大列表和异常矩阵登记为 P2 后续。
- 2026-06-20 — `task_done` 和 `ai_static_scan --top 10` 已完成闭环。静态扫描 Top 10 剩 1 个历史 `gitleaks|generic-api-key|tools/company-console/server/config.mjs|4|generic-api-key`，状态为 `accepted_risk`，不在 touched files，blocking=0。

## 7. 试行反馈

- 外部 driver 首次失败暴露的是菜单精确匹配过窄：种子作品已在真实 UI 当前 work 中，但 driver 仍强制刷新并做精确菜单文本匹配。修正为先读取当前可见作品标题，已在目标作品时不重复切换，否则再按可见标题包含匹配进行用户式切换；产品代码未新增验收感知逻辑。
