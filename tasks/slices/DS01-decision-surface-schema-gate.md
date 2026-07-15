# DS01 决策面 Schema 闸门与卡片死代码收口

- 状态：todo
- 类型：UI Contract Slice / Schema Governance Slice
- 父 ADR：`docs/design/adr/ADR-0024-decision-surface-registry-v3.md`（Accepted，CP1）
- 启动条件：ADR-0024 已 Accepted；`07` §4 已重写为决策面注册表；本 slice 是 CP1，CP2（S4 clarification）/ CP3（S7 awaiting_author）依赖本 slice 的 schema 闸门先行。

## 1. 目标

把 ADR-0024 决策 2/3/5 落成机器闸门：ui_cards 卡片形状与决策面字段进入 codegen schema，前端删除手写 TurnResult 类型与 6 个死卡片分支，channel payload 经 safeParse 校验，未知 card_type 产生开发侧告警。此后「契约 / 后端 / 前端」的 card 漂移在 CI 变红，而不是 UI 静默兜底。

## 2. 开工检查（六问）

- **Contract**: ADR-0024 决策 2（信息 lane，卡片禁 `actions` 字段）、决策 3（card_type 三卡集合：`candidate_set` / `confirmation_card` / `result_card`）、决策 5（schema 治理）；`docs/design/07-workbench-ui-contract.md` §4.2 约束 1/3/5；schema 源落点 `docs/design/schemas/foundation/`（codegen 管线：`frontend/scripts/codegen-schemas.mjs`，命令 `pnpm codegen:schemas`）。
- **Invariant**: `00c` §7 #18（N-SURF：ui_cards 不携带可提交动作）、#10（UI 只能提交 available_actions 中的动作）。
- **Boundary**: 切穿 `frontend`（类型来源切换、死分支删除、safeParse、告警）与 `novel_application`（`dialogue_gateway.ex` result_card 移除 `actions: []` 字段）；`novel_web` 透传不改；`novel_domain` / `novel_agent` / `novel_persistence` 明确不改。
- **Consumer**: 第一个真实消费者是 `WorkspaceChat` 渲染主链（真实产品入口 App.tsx → WorkspaceChat），消费 codegen 出的 `UICard` / `TurnResult` 类型与运行时校验结果。
- **Proof**: 见 §5。核心是「漂移注入测试」：构造带未入册 card_type / 带 `actions` 字段的 TurnResult payload，断言前端告警路径与后端契约测试变红。
- **Acceptance Driver**: 复用现有外部 Tauri driver 模式（`scripts/tauri_slice_verify.sh` / `quality/acceptance/scenarios/`）驱动真实页面完成一轮「发消息 → 草稿卡渲染 → 采纳动作」回归，证明收口无行为回归；产品代码不新增任何验收感知逻辑（**no**）。

## 3. 范围

必须实现：

- `docs/design/schemas/foundation/` 新增 `ui_card.json`（三卡判别联合：公共字段 + `candidate_set` 的 items/artifact 字段 + `confirmation_card` 的 behavior_ref/target_ref + `result_card`），`turn_result` schema 的 `ui_cards` 从 `any[]` 收紧为该 schema 引用；`schema_version` 接受当前 `"3.0-draft"`（收敛策略按 ADR-0024 Deferred 项暂不做）。
- `pnpm codegen:schemas` 重新生成；前端 `WorkspaceChat.tsx` 手写 `TurnResult` / `UICardData` interface 移除，改从 `lib/schemas.ts` 导入 codegen 类型。
- channel `turn_result` payload 接收处 `safeParse`：失败不丢弃消息（容错渲染），但必须 `console.warn` + 结构化日志，禁止纯静默。
- 前端删除 6 个死卡片分支（`clarification_card` / `warning_card` / `progress_card` / `checkpoint_card` / `failure_card` / `escalation_card`）及无其他消费者的对应组件；`DefaultCard` 兜底保留 + 未知类型告警。
- 后端 `dialogue_gateway.ex` result_card 移除 `actions: []` 字段（N-SURF：卡片结构禁携带动作字段）。
- 新增契约测试：后端 TurnResult 产出的 card_type 只能属于三卡集合（Elixir 侧单测覆盖 3 个产出点）。

非目标：

- 不实现 S4 / S7 决策面（CP2 / CP3）。
- 不做 `schema_version` semver 收敛。
- 不动 `QualityReviewCard` / 候选面板 / 运行组等决策面渲染器（它们由各自字段驱动，不在 ui_cards lane）。
- 不做内容流式、渲染性能、锚定重构。

## 4. 任务清单

| 任务 | status | 关联 commit | 备注 |
|---|---|---|---|
| ui_card.json schema 源 + turn_result 引用收紧 | todo | | |
| codegen 重生成 + 前端类型切换 | todo | | typecheck 必须零错误 |
| safeParse + 未知卡片告警 | todo | | |
| 死分支与死组件删除 | todo | | |
| 后端 result_card actions 字段移除 + 契约单测 | todo | | |
| 漂移注入测试 | todo | | 前后端各一 |
| Tauri 回归场景跑通 | todo | | 复用既有 scenario |

## 5. 验收入口与 Proof

- 后端：`mix compile --warnings-as-errors`、`mix test`（含新增契约单测）、`mix run scripts/arch_check.exs`。
- 场景化不变量：`MIX_ENV=test mix run scripts/scenario_invariants/run_i{3,1,2}_*.exs` 全绿（涉及 TurnResult 改动，强制）。
- 前端：`pnpm typecheck && pnpm lint && pnpm test`；漂移注入单测（未知 card_type → DefaultCard + warn；带 actions 字段 → schema 校验失败告警）。
- 外部自动化：Tauri driver 驱动真实页面「发消息 → candidate_set 卡渲染 → accept 动作 → 采纳反馈」，证据落 `artifacts/slice-verify/`。
- 静态扫描闭环：`bash scripts/ai_static_scan.sh --top 10`。

## 6. 决策日志

- 2026-07-15：slice 创建。范围锚定 ADR-0024 CP1；S4/S7 显式排除，避免 checkpoint 缩小 slice 范围的反模式（本文件即完整 CP1 范围，无隐藏后续）。

## 7. 卡点 / TBD

- `ui_card.json` 判别联合的表达方式需与 `codegen-schemas.mjs` 现有能力核对（若不支持 discriminated union，退化为公共字段 + 可选字段并在测试层收紧）。
- Tauri 回归复用哪条既有 scenario（候选：采纳链路相关场景）待开工时从 `quality/acceptance/scenarios.yml` 选定。

## 8. 下次会话恢复指引

先读 `docs/design/adr/ADR-0024-decision-surface-registry-v3.md`（决策 2/3/5）与 `docs/design/07-workbench-ui-contract.md` §4，再看本文件 §4 任务表，从第一个 todo 开始。诊断背景见 `docs/design/notes/2026-07-15-dialogue-flow-decision-surface-review.md`。
