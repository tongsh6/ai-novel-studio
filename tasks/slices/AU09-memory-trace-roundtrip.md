# AU09 Memory Trace Roundtrip / 记忆治理 Trace 闭环

- 状态：checkpoint closed
- 类型：Memory Trace Slice + Trace/Replay Slice
- 启动日期：2026-06-18
- 所属验收：`docs/design/acceptance/author/AU-09-story-memory.md` SC-AU09-C1 / SC-AU09-C2 / SC-AU09-C3 / SC-AU09-D2，AU09-GAP-06 / GAP-07 / GAP-09 / GAP-10。
- 所属设计：`docs/design/06-memory-context-and-trace.md` §10，`docs/design/07-workbench-ui-contract.md` trace summary 约束，AU-07 author-safe trace。

## 1. 用户 / 系统目标

作者已经能从真实工作台管理记忆生命周期：创建、确认、锁定、废弃和归档，并且状态会影响后续 recall/why。下一步必须让这些治理动作和召回/排除结果可解释：系统能回答某条记忆为什么被使用、为什么被废弃/归档后不再进入上下文、locked 记忆为什么仍可召回但不能被终端操作。

本 slice 不重复实现记忆管理入口。`AU09-memory-management-workbench-entry` 已证明入口和基础生命周期闭环；本 slice 补 MemoryTrace / StateTrace / reference log 到 author-safe why/replay 的链路。

## 2. 开工检查

- **Contract**：消费 `docs/design/06-memory-context-and-trace.md` §10 的 StateTrace / MemoryTrace 语义、`MemoryItem` status / locked / recallable lifecycle、`memory_reference_logs`、`TraceSummaryView` / author-safe redaction。
- **Invariant**：
  - 生产记忆状态变化必须能追溯到来源动作、actor、前后状态和 work/session scope。
  - terminal memory（DEPRECATED / ARCHIVED）不得进入普通 recall；被排除原因必须可解释但不泄漏内部 prompt。
  - locked memory 可以进入 recall，但内容/summary/type/scope 的改写或终端动作必须被阻止并能留下可审计原因。
  - 产品代码不得读取验收专用 env、slice id、URL query、localStorage 或验收专用 DOM hook。
- **Boundary**：
  - `novel_application` / `novel_persistence`：补记忆生命周期和 recall/reference 的 trace 写入或读模型聚合。
  - `novel_web`：只通过正式 REST/Channel/TurnResult/trace summary 暴露 author-safe 信息。
  - `frontend`：只消费正式 trace/why/references 输出，不读取内部表或添加验收 hook。
  - **不改** MemoryItem enum、不把 fake provider 注册进生产 runtime、不修改 scenario invariant driver。
- **Consumer**：真实工作台的记忆详情/why 面板、后续 ReplayService / trace 查询、AU-09 recall 主链。
- **Proof**：
  - 外部 Tauri：从真实工作台完成确认、锁定、废弃、归档和后续对话，打开 why/引用视图，证明 used/excluded memory 的 author-safe trace 可见。
  - 后端局部：trace 写入、work/session 隔离、locked/terminal reason、reference log 聚合测试。
- **Acceptance Driver**：计划新增 `bash scripts/tauri_slice_verify.sh au09-memory-trace-roundtrip`。driver 必须从真实工作台操作，不新增产品验收感知逻辑。

## 3. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 审计现有 `memory_reference_logs`、why 面板、trace/replay 读模型 | done | 复用现有 reference log 作为本 CP 的 author-safe trace read model，避免另造平行体系。 |
| T2 | 设计并实现记忆 lifecycle trace 写入边界 | done | create/confirm/lock/unlock/deprecate/archive 成功写 `memory_lifecycle`；locked terminal attempt 写 `memory_lifecycle_blocked` 并返回 validation error。 |
| T3 | 把 recall used/excluded reason 聚合到 author-safe trace/references 输出 | done | 记忆详情通过正式 references API 展示 lifecycle/reference；后续 why 仍按 context refs 解释本轮 used memory，terminal 内容不进入 why。 |
| T4 | 外部真实页面验收 driver/verifier | done | `au09-memory-trace-roundtrip` 从真实工作台操作生命周期、打开引用追溯、触发 recall/terminal probe。 |
| T5 | 同步 AU-09 / AU-07 / NEXT / ledger | done | 证据出现后同步 checkpoint closed；下一队首转入有效期窗口召回。 |

## 4. 当前缺口

- 本 checkpoint 用现有 `memory_reference_logs` 承载 author-safe lifecycle/reference 追溯；完整独立 `MemoryTrace` / `StateTrace` 表、developer replay 和历史旧 turn 查询仍属于后续 trace/replay 深化。
- blocked locked terminal action 已有 service/schema 测试和 blocked trace；真实页面侧因为按钮禁用，不产生一次作者失败提交。
- 有效期窗口、跨作品 UI 隔离、AU-03 historical/active session 分层仍是后续 checkpoint，不在本 slice 中冒充完成。

## 5. 验证计划

- [x] 后端 trace/reference 聚合单测
- [x] `node --check frontend/slice-verify/external-ui-driver.mjs`
- [x] `node --check frontend/slice-verify/native-tauri-verifier.mjs`
- [x] `cd frontend && pnpm exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] `bash scripts/tauri_slice_verify.sh au09-memory-trace-roundtrip`
- [x] `bash scripts/ai_static_scan.sh --top 10`（17 pass / 1 fail；剩余 gitleaks 为既有 accepted_risk，0 touched findings，0 blocking）

## 6. 决策日志

- 2026-06-18 — `AU09-memory-management-workbench-entry` 已证明真实工作台入口和基础生命周期；下一 P0 缺口转为 trace/replay 层，而不是重复实现记忆管理页。
- 2026-06-18 — CP closed：本轮不新增独立 trace table，先复用 `memory_reference_logs` 作为 author-safe lifecycle/reference 读模型；后端阻止 locked terminal action 并记录 blocked trace，前端记忆详情展示“引用与治理追溯”，Tauri 证据为 `artifacts/slice-verify/au09-memory-trace-roundtrip-tauri/summary.json`。
