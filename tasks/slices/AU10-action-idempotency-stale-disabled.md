# AU10 Action Idempotency / Stale / Disabled / 旧·重复·失效 action 的真实页面验收

- 状态：todo（待用户批准开 CP1）
- 类型：Acceptance Slice（外部真实页面验收为主 + 必要时最小 UI 反馈补齐）
- 启动日期：（待批准）
- 所属验收：`docs/design/acceptance/author/AU-10-workbench-ui.md` **AU10-GAP-03（P0）** + SC-AU10-C3 / SC-AU10-C4
- 所属设计：`00c` §7 不变量 #10（UI 只能提交 action）、`ADR-0007-next-action-available-action-v3.md`（action 必带 idempotency key + trace ref）、`07-workbench-ui-contract.md` §（idempotency_key 防重复提交）、`contracts/VS-05-ui-roundtrip-contract-pack.md`（重复 key → 返回已有结果 / idempotent response）

> 本文件是 slice 入口。范围已与用户讨论对齐：后端逻辑已实现，本 slice 收口"外部真实页面验收 + UI 反馈可见性"。

---

## 0. 现状（开工核对，已查实）

后端**已实现且有单测**，本 slice **默认不改后端逻辑**：

- `NovelApplication.ActionValidator`：拒绝 **stale**（`source_turn_ref` ≠ 当前 turn）、**invented**（不在 `available_actions`）、**disabled**（带 `disabled_reason`）action。
- `NovelApplication.ActionIdempotencyLedger` + `ActionIdempotencyService`：按 `idempotency_key` 去重；`WorkspaceChannel` 已 `assign(:action_idempotency_ledger)` 并在 `author_action` 路径 lookup/record（重复 → 返回已记录结果）。
- 单测：`action_roundtrip_test.exs`、`workspace_channel_v3_test.exs`（invented action 拒绝）。

**真缺口（AU10-GAP-03 P0 / SC-AU10-C3/C4 明示"未验收"）**：
1. **没有外部自动化驱动真实页面**证明双击/旧 turn/disabled 三类 action 的端到端行为。
2. **UI 反馈可见性未确认**：`sendAuthorAction` 在拒绝时 promise reject，但真实工作台是否让作者**看见**"已处理/已失效/不可点原因"未验证——可能静默吞掉。

---

## 1. 用户 / 系统目标

作者在真实工作台对 action（采纳、采用方向、确认等）**双击 / 点旧按钮 / 点禁用按钮**时，系统不重复执行、不重复写作品事实、不执行失效动作，且作者**看得见**为什么没反应（已处理 / 已失效 / 禁用原因）。

---

## 2. 开工检查（承重六问）

- **Contract**：消费不变量 #10、ADR-0007、07 §action、VS-05（idempotent response）、AU-10 SC-AU10-C3/C4。本 slice 固化的是**端到端可见行为**（验收 + 必要 UI 反馈），不新增后端契约。
- **Invariant**：
  - **I-a 幂等**：同 `idempotency_key` 重复提交 → 返回已有结果，`production_write_performed` 不翻倍、作品事实只写一次。
  - **I-b stale 拒绝**：`source_turn_ref` 非当前 turn 的 action 被拒，不执行；作者可见说明。
  - **I-c disabled 不可绕过**：disabled action 不可点击且显示 `disabled_reason`；前端状态 hack 不能让它可执行。
  - **I-d 可见反馈**：上述三类被拒/去重时，真实工作台给作者可见反馈，不静默。
  - **I-e 不破既有**：I1/I2/I3、既有 action 授权链（AU-02/AU-05）不回归。
- **Boundary**：
  - `frontend`：确认并（若缺）最小补齐 action 拒绝/重复/禁用的**可见反馈**（disabled_reason tooltip、"已处理/已失效"提示）；文案进 `copy.ts`。
  - 外部 harness：`external-ui-driver.mjs` + `native-tauri-verifier.mjs` + `tauri_slice_verify.sh` 注册新 slice id。
  - **不改**：`ActionValidator` / `ActionIdempotencyLedger` / `ActionIdempotencyService` / Channel 去重逻辑（已实现，除非 driver 实证 bug）。
- **Consumer**：每次 `author_action` 提交（真实高频）；外部 Tauri verifier。
- **Proof**：见 §4。
- **Acceptance Driver**：`bash scripts/tauri_slice_verify.sh au10-action-idempotency-stale-disabled`；产品代码不读 slice id/env/query/localStorage。复用既有 adoption/candidate seed 与真实 action 按钮。

---

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_domain / agent / persistence | no | |
| novel_application | no（默认）| ActionValidator/Idempotency 已实现；仅当 driver 实证 bug 才动 |
| novel_web | no（默认）| Channel 去重已接线 |
| frontend | yes | 确认/最小补齐拒绝·重复·禁用的可见反馈 + copy.ts |
| 外部 harness | yes | driver + verifier + 脚本注册 |
| docs/design | no | 复用 AU-10 / ADR-0007 / VS-05 |

---

## 4. Proof（外部真实页面为主）

- **外部 Tauri driver** `au10-action-idempotency-stale-disabled`，真实工作台：
  1. **双击同一 action**（如"采用这个方向"/"采纳"）→ 后端按 idempotency_key 去重，断言只执行一次、作品事实只写一次（`production_write_performed` 不翻倍 / 同一 mutation）；作者无重复结果。
  2. **点旧 turn 的 action**（新一轮后残留旧按钮）→ 被拒，UI 可见"已失效/已处理"，无执行。
  3. **disabled action** → 不可点击 + 显示 `disabled_reason`。
  - 证据：websocket 帧 + 业务日志（action 路由、去重命中、拒绝原因）+ 截图 + summary.json。
- **frontend 单测**：拒绝/重复/禁用的可见反馈渲染（若本 slice 新增反馈）。
- **不变量**：I1/I2/I3 全过；既有 AU-02/AU-05 action Tauri 证据不回归。
- **工程门禁**：compile -Werror、各 app test、arch/xref；frontend typecheck/lint/test。

---

## 5. Checkpoint 拆分

- **CP1（本 slice）**：双击幂等 + 旧 turn stale 拒绝 + disabled 不可点，三者真实页面验收闭环；补齐缺失的可见反馈。
- CP2（后续，若需要）：idempotency 跨"断线重连后旧按钮"场景（与 AU10 recovery CP2 交叉）、action_result 全状态可见矩阵。

---

## 6. 诚实边界

- 后端逻辑已存在，本 slice 价值在**外部真实页面证明 + 作者可见反馈**，不是重写后端。
- 若 driver 实证后端去重/拒绝有 bug，再按最小改动修后端并补单测（届时更新本文 Boundary）。
- 完整 action_result 全状态 UI 矩阵、全 card 视觉是更大的 AU-10 后续，不在本 CP1。

---

## 7. 决策日志

- 2026-06-17：与用户讨论选定。先做本 slice 而非 CP3C（异步 LongRunner streaming）——因为 LongRunner 异步路径（`TaskRunner.start/resume`/`perform_execution`）**无真实生产消费者**（仅测试 + sleep 桩），CP3C 属投机基建；本 slice 有真实高频消费者（每次 action）、契约已冻结、是 AU10-GAP-03 P0。开工核对发现后端 stale/invented/disabled/idempotency 已实现且有单测，故定位为**承重验收 slice**（外部真实页面 + UI 反馈可见性）。
