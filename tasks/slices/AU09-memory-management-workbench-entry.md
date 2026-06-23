# AU09 Memory Management Workbench Entry / 记忆管理工作台入口

- 状态：checkpoint closed（2026-06-18）
- 类型：UI Contract Slice + Memory Governance Slice（正式入口 -> 管理操作 -> 召回证明）
- 启动日期：2026-06-18
- 所属验收：`docs/design/acceptance/author/AU-09-story-memory.md` SC-AU09-A1 / SC-AU09-A5 / AU09-GAP-01。
- 所属设计：`docs/design/06-memory-context-and-trace.md`、`docs/design/ui/43-structure-panel.md`、AU-09 记忆生命周期与 author-safe trace。

## 1. 用户 / 系统目标

作者能从真实工作台进入正式记忆管理界面，查看当前作品的记忆项，并对记忆执行创建、确认、锁定、废弃等生命周期动作。所有动作必须按当前 `work_id` 隔离，且后续对话只召回符合治理规则的 confirmed + recallable 记忆。

这个 slice 不是重复做作品档案伏笔/规则读模型。`AU09-archive-memory-roundtrip` 已证明 AI 设定经 adoption 进入 governed memory 并被档案 tab 与 recall 消费；本 slice 补作者直接管理记忆生命周期的正式入口和状态操作。

## 2. 开工检查

- **Contract**：消费 AU-09 MemoryItem status / locked / recallable / validity window，Memory REST 最小入口，以及 author-safe trace 中的 confirmed memory source。
- **Invariant**：
  - 创建入口不得允许 caller 直接伪造 confirmed/stabilized 状态。
  - locked 记忆不得被静默覆盖；deprecated/archived 记忆不得进入普通 recall。
  - 所有 list/show/update/action 均按当前 `work_id` 隔离。
  - 产品代码不得读取验收专用 env、slice id、URL query 或 localStorage。
- **Boundary**：
  - `frontend`：真实工作台挂接记忆管理入口，复用现有 `MemoryListPage` / `memoryApi` 能力或按设计收敛。
  - `novel_web`：只通过公开 REST/Channel 入口暴露管理动作，不绕过 application/persistence。
  - `novel_application` / `novel_persistence`：复用既有 memory lifecycle guard 与 recall/read model。
  - **不改** MemoryType enum、production fake provider、scenario invariant 脚本。
- **Consumer**：作者从真实工作台进入的记忆管理界面；后续 `ContextAssembler` / why 面板消费 confirmed memory。
- **Proof**：
  - 外部 Tauri：从真实工作台进入记忆管理，创建 draft，确认为 governed memory，锁定/废弃状态在 UI 和 recall 中一致。
  - 后端局部：REST/Channel/action guard 覆盖 status、locked、work_id 隔离。
  - trace：why 面板只显示可召回的 confirmed memory。
- **Acceptance Driver**：`bash scripts/tauri_slice_verify.sh au09-memory-management-entry`；产品代码不新增验收感知逻辑。该 driver 从真实工作台头部「记忆」入口进入管理页，创建/确认/锁定记忆，证明锁定后仍可召回且 why 显示 author-safe 来源；随后解锁废弃该记忆、创建并归档另一条记忆，再证明这两条 terminal memory 不再进入后续 dialogue context / why 内容。

## 3. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 核对现有 `MemoryListPage` / `memoryApi` / REST 入口与设计差异 | done | 审计确认 `App.tsx` 已挂 `mode === "memory"`，`WorkspaceChat` 头部已有真实「记忆」入口；旧“未挂载”判断已过时。 |
| T2 | 从真实工作台挂接正式记忆管理入口 | done | 既有入口已由 `au09-memory-create-recall` 与本 checkpoint 复用并验证。 |
| T3 | 创建 -> 确认 -> list/show 状态回读 | done | `au09-memory-management-entry` 从真实页面创建 DRAFT、确认 CONFIRMED，并在详情中回读状态。 |
| T4 | locked/deprecated/archived guard UI 与 recall 验证 | done | 锁定后终端动作按钮禁用且仍可召回；解锁后废弃、另一条归档，后续 context/why 排除这两条 terminal memory。 |
| T5 | 外部 Tauri 验收 driver 与 verifier | done | 新增 `au09-memory-management-entry` driver/verifier；证据见 `artifacts/slice-verify/au09-memory-management-entry-tauri/summary.json`。 |

## 4. 当前缺口

- 作品档案伏笔/规则 roundtrip 已闭环；正式工作台记忆入口、创建/确认/锁定/废弃/归档与 recall/why 基础生命周期也已闭环。
- `frontend/src/lib/memoryApi.ts`、后端 REST 与真实工作台入口当前可达；本 checkpoint 复用真实 REST/API/UI，不新增生产验收钩子。
- AU-09 整体仍不能标 done：lifecycle/reference 最小 trace、章节有效期窗口、跨作品隔离和 AU-03 会话分层后续已补；普通旧 turn scoped query 与 partial replay UI 已由 AU-07 回填；管理页仍是 Phase 0 UI，缺正式设计原型/追溯、完整 MemoryTrace/StateTrace/replay、多类型 replay UI 和 Channel 管理入口。

## 5. 验证

- [x] `node --check frontend/slice-verify/external-ui-driver.mjs`
- [x] `node --check frontend/slice-verify/native-tauri-verifier.mjs`
- [x] `cd frontend && pnpm exec vitest run slice-verify/native-tauri-verifier.test.mjs`
- [x] `bash scripts/tauri_slice_verify.sh au09-memory-management-entry`

## 6. 决策日志

- 2026-06-18 — 审计发现 `MemoryListPage` 已通过 `App.tsx` / `WorkspaceChat` 真实入口可达，`au09-memory-create-recall` 已证明入口、创建、确认、召回和 why；因此本 checkpoint 不重复“挂入口”，转为证明作者直接管理生命周期状态。
- 2026-06-18 — `au09-memory-management-entry` 通过：创建/确认/锁定后仍可召回；锁定时废弃/归档按钮禁用；解锁废弃一条、归档另一条后，后续相关对话仍可召回无关种子 memory，但不再包含这两条 terminal memory 内容。
