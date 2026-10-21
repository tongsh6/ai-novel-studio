# ADR-0009：Confirmation Binding v3

- 状态：Accepted
- 日期：2026-05-07
- 来源文档：
  - `../00c-state-and-contract-atlas.md` §5, §6, §7, §8, §9
  - `../04-execution-orchestrator.md` §8, §9, §14
  - `../05-turn-behavior-and-state-model.md` §8, §11
  - `../07-workbench-ui-contract.md` §2, §3
  - `../contracts/VS-03-behavior-lifecycle-contract-pack.md`
- 影响范围：Behavior / Execution / UI / Trace / Slice
- 相关不变量：`00c` §7 #3、#7、#10、#12、#14
- 首个证明 slice：VS-03 Clarification / Confirmation Behavior 生命周期
- 取代：无
- 取代者：无

---

## 背景

确认不能是“用户点了一个按钮，所以可以执行最近那个动作”。确认必须绑定一个明确 open confirmation、target、state snapshot 和重新 gate 过程。

## 决策范围

本 ADR 冻结 `contracts/VS-03-behavior-lifecycle-contract-pack.md` §5 的 ConfirmationBinding 最小 policy。

## 非目标

- 不冻结完整 adoption policy。
- 不冻结所有幂等冲突处理。
- 不定义最终 UI 按钮。
- 不执行 production write。

## 考虑过的方案

### 方案 A：确认最近 pending action

- 优点：交互短。
- 缺点：跨 turn、并发和 stale action 下会确认错对象。

### 方案 B：UI 确认后直接执行

- 优点：前端体验顺。
- 缺点：绕过 Orchestrator gate 和 trace。

### 方案 C：ConfirmationBinding + re-gate

- 优点：确认对象、作者输入、幂等键、状态快照和 gate 结果都可追踪。
- 缺点：确认后仍需要一次系统裁决。

## 最终决策

采用方案 C。确认回答必须绑定 open confirmation，并在执行前重新经过 Orchestrator gate。

## 决策理由

confirmation 是高风险边界，不能因为 UI 有按钮就降低系统审查。re-gate 保护权限、预算、状态快照和 stale action。

## Contract 影响

- 新增 VS-03 最小 ConfirmationBinding policy。
- `AvailableAction.confirm_before_execute` 必须带 behavior / target / idempotency。
- confirmation answer 只能触发 re-gate，不能直接生产写入。

## Umbrella 边界影响

application 处理 binding 和 re-gate；web/frontend 只提交 action；agent 不接收 confirmation；persistence 不根据确认字段直接写业务状态。

## UI / Trace / Replay 影响

UI 展示确认对象和影响范围。Trace 记录 binding、state snapshot 和 gate result。Replay 能解释 stale / duplicate confirmation 的处理。

## 垂直切面证明

VS-03 证明 confirmation target binding、confirmation answer re-gates、stale / duplicate confirmation 不产生新执行。

## 迁移与兼容

v2 的确认按钮需要迁移为 AvailableAction + ConfirmationBinding。

## 后续工作

- VS-04 冻结 adoption confirmation 的生产写入边界。
- VS-05 冻结 UI action roundtrip。
- VS-06 冻结 replay explanation。

---

## enforced_by

- apps/novel_domain/lib/novel_domain/confirmation_binding.ex
- apps/novel_domain/lib/novel_domain/micro_plan.ex
- apps/novel_application/lib/novel_application/execution_orchestrator.ex
- apps/novel_application/lib/novel_application/gate_order.ex
- apps/novel_application/lib/novel_application/dialogue_gateway.ex
- apps/novel_domain/test/novel_domain/confirmation_binding_test.exs
- apps/novel_application/test/novel_application/action_roundtrip_test.exs
- quality/acceptance/scenarios/au04-confirm-before-execute.yml

## enforcement_gaps

- B13b 裁决（2026-10-22，降级：由上游守门）：`ConfirmationBinding.build/1` 保持纯结构校验（`confirmation_binding.ex:52-73`）；open confirmation/target 绑定由 `ActionValidator` 精确 scoped-ref 匹配（`action_validator.ex:108-130`）+ Channel current-turn guard（`workspace_channel.ex:21-25,2861-2870`）保证，gateway 只从服务端授权 action 构造 binding（`dialogue_gateway.ex:671-698`）。若 VS-03 §5 冻结，则需在 binding/gateway 层补显式校验（并入策略关闭 slice）。

### B13b 裁决（2026-10-22）

> 依据 B13b 对账裁决（汇总见 `tasks/slices/B13B-adr-enforcement-reconciliation.md`）。本小节记录原 gap 的裁决痕迹，避免静默删除或静默降级；被 DELETE 的条目不回填历史文件内容，其原文摘要与证据保留在 B13b 汇总的逐条裁决台账中。

- 降级（由上游守门，改写见上方 gap）：binding 自身不校验 open/target。后续动作：若 VS-03 §5 冻结，按 ADR README §11.4 新增 ADR 收窄或另开 slice（本批不新建 ADR）。
- 修复-本批转下批 B 轨（DELETE，本批未落地代码）：原 gap「`idempotency_key`/`trace_ref` 未设为必填」——修复方案已定（`confirmation_binding.ex:52-73` 两字段改用 `require_field`，更新 domain 测试 fixtures；gateway 已恒传，生产路径不受影响）；转下批 B 轨候选。
