# AU02 Candidate Schema Codegen

- 状态：done（checkpoint closed）
- 类型：Acceptance Slice / UI Contract Slice / Schema Slice
- 启动日期：2026-06-20

## 1. 用户 / 系统目标

AU-02 候选方向的后端、schema/codegen、前端渲染类型和测试样例使用同一契约。候选方向是探索灵感入口，不是 artifact adoption entry；探索阶段 `adoption_status` 只能是 `not_adopted`，不能混入 artifact adoption 7 态或旧测试值。

## 2. 开工检查

- Contract: `docs/design/acceptance/author/AU-02-explore.md` 的 `SC-AU02-D2`；`docs/design/schemas/foundation/candidate_direction.json`；`docs/design/schemas/foundation/turn_result_v2.json` 的 `candidate_directions`；`NovelDomain.CandidateDirection`；`WorkspaceChat` 候选面板类型。
- Invariant: `candidate_directions[]` 必须有 `direction_id/title/pitch/tone_tags/adoption_status`；`adoption_status` 固定为 `not_adopted`；不得把 artifact adoption enum（如 `TENTATIVE`）用于候选方向。
- Boundary: 只改 design schema、generated frontend schema/type、前端契约测试和文档/task 记录；不改 production planner/provider/runtime，不改 Tauri product behavior。
- Consumer: `WorkspaceChat` 候选卡、`CandidateDirectionSchema`、`turn_result_candidates.test.ts`、`schemas.test.ts`。
- Proof: `pnpm --dir frontend codegen:schemas`、`pnpm --dir frontend typecheck`、schema/candidate/available action tests、`mix codegen.enums --check`、AU-02 真实 Tauri driver 复验证据。
- Acceptance Driver: 复用 `bash scripts/tauri_slice_verify.sh au02-natural-exploration-no-slot-form` 与 `--real-lmstudio` provider 变体证明真实页面仍消费候选方向；产品代码新增验收感知逻辑：no。

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 不改 enum generator；仅复跑 `mix codegen.enums --check`。 |
| novel_domain | no | `NovelDomain.CandidateDirection` 作为既有消费者。 |
| novel_agent | no | 不改 provider runtime。 |
| novel_application | no | 不改 Planner / TurnResultBuilder。 |
| novel_persistence | no | 不改 schema/repo。 |
| novel_web | no | 不改 Channel serialization。 |
| frontend | yes | generated Zod schema/type、`WorkspaceChat` 类型消费、契约测试。 |
| docs/design | yes | schema SSOT、AU-02 验收文档、总入口。 |
| quality | no | 复用既有 AU-02 quality scenario。 |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 新增 CandidateDirection JSON Schema | done | 独立于 artifact adoption enum，固定 `not_adopted`。 |
| T2 | TurnResult schema 引用 candidate_directions | done | `turn_result_v2.json` 增加 optional `candidate_directions`。 |
| T3 | 运行前端 schema codegen | done | 新增 generated `candidate_direction` 及补齐既有 schema 生成产物。 |
| T4 | 前端消费 generated CandidateDirection 类型 | done | `WorkspaceChat` 不再手写候选方向 interface。 |
| T5 | 修正旧测试 fixture 并补 schema 回归 | done | 拒绝 `TENTATIVE` / 缺 `adoption_status` / 旧 `"candidate"`。 |
| T6 | 同步 AU-02 文档和台账 | done | AU-02 D2 从局部证据推进为 schema/codegen 已闭环。 |

## 5. 验证

- [x] `pnpm --dir frontend codegen:schemas`
- [x] `pnpm --dir frontend typecheck`
- [x] `pnpm --dir frontend lint`
- [x] `pnpm --dir frontend exec vitest run src/lib/__tests__/schemas.test.ts src/lib/__tests__/turn_result_candidates.test.ts`
- [x] `pnpm --dir frontend exec vitest run src/components/WorkspaceChat.availableActions.test.tsx src/lib/__tests__/schemas.test.ts src/lib/__tests__/turn_result_candidates.test.ts`
- [x] `pnpm --dir frontend test -- --run src/lib/__tests__/schemas.test.ts src/lib/__tests__/turn_result_candidates.test.ts src/components/WorkspaceChat.availableActions.test.tsx`
- [x] `mix codegen.enums --check`
- [x] `bash scripts/tauri_slice_verify.sh au02-natural-exploration-no-slot-form`

## 6. 决策日志

- 2026-06-20 — 不复用 `docs/design/schemas/foundation/enums/adoption_status.json`，因为它冻结的是 artifact adoption 7 态；候选方向只是探索灵感，schema 中 `adoption_status` 只能是 `not_adopted`。
- 2026-06-20 — `WorkspaceChat.availableActions.test.tsx` 中旧 fixture `adoption_status: "candidate"` 被 typecheck 捕获并修正为 `not_adopted`，D2 schema/codegen 回归因此具备真实防回退作用。
