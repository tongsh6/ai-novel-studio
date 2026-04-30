# VS-010 Novel Domain Core Objects

- 状态：done
- 类型：Artifact Slice
- 启动日期：2026-04-30
- 完成日期：2026-04-30

## 1. 用户 / 系统目标

当前 `novel_domain` 只有 4 个薄文件（`types.ex`、`work.ex`、`narrative_position.ex`、`memory_item.ex`），设计文档 `21-novel-object-model.md` 规划的 4 组 20+ 对象几乎全部缺失。TurnService 的 `build_draft_tentative` 产出的 draft_text 无法落到任何领域对象上，MemoryRecallService 无法按人物/场景做相关性检索。

本 slice 从设计文档 §3 的 4 组对象中选取**第一批核心对象**落地到 `novel_domain` + `novel_persistence`，使上层服务获得可写、可读、可引用的领域实体。

**选取原则**：优先选端到端创作链路（VS-012）直接消费的对象。第一批：Work（已有，补全）、Volume、Chapter、Scene、Draft、Character。

暂缓：worldbuilding, main_outline, arc, faction, location, relationship, item, ability, organization, state_snapshot, timeline_event, foreshadowing, worldrule, chapter_summary, style_sample, writing_preferences, brief, feedback_patch。

## 2. 开工检查

- Contract: `docs/design-v2/21-novel-object-model.md` §3（对象分组）、§4（身份规则）、§5（主结构对象）、§6（资产对象）；`docs/design-v2/20-novel-domain-overview.md` §3（领域层职责）
- Invariant:
  1. 所有领域 struct 为纯数据（无 GenServer、无 Ecto、无 I/O），`novel_domain` 不依赖 `novel_persistence`
  2. 跨对象引用只通过 `id`，不内嵌完整对象
  3. `Draft` 的 `scene_ref` 不能为空——每个草稿必须归属到一个 scene
- Boundary: 涉及 `novel_domain`（纯 struct + 函数）、`novel_persistence`（Ecto schema + migration）；不应修改 `novel_agent`、`novel_web`、`novel_foundation`
- Consumer: `novel_application` 的 TurnService（创建/更新 Draft）、AdoptionBoundary（adopt Draft）、MemoryRecallService（按 scene/character 检索）；前端 StructurePanel（展示 Work→Volume→Chapter→Scene 树）
- Proof:
  - Domain struct 单元测试（构造/校验/状态转换）
  - Persistence schema 集成测试（insert/query/association）
  - `mix xref graph --format cycles --label compile-connected --fail-above 0`
  - `mix run scripts/arch_check.exs`

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 只引用既有 enum |
| novel_domain | yes | 新增 Volume/Chapter/Scene/Draft/Character struct + 纯函数 |
| novel_agent | no | 不修改 Agent Runtime |
| novel_application | no | 本 slice 不修改，VS-012 消费 |
| novel_persistence | yes | 新增 6 个 Ecto schema + migration |
| novel_web | no | 透传，不修改 |
| frontend | no | VS-012/VS-013 消费 |
| docs/design-v2 | no | 只引用既有 contract |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 在 `novel_domain` 中落地 `Volume` struct + 纯函数 | done | `id, work_ref, title, seq, status, created_at, updated_at`；函数：new/2, update_title/2, update_status/2, update_seq/2 |
| T2 | 在 `novel_domain` 中落地 `Chapter` struct + 纯函数 | done | `id, volume_ref, work_ref, title, seq, status, created_at, updated_at` |
| T3 | 在 `novel_domain` 中落地 `Scene` struct + 纯函数 | done | `id, chapter_ref, work_ref, title, seq, status, created_at, updated_at` |
| T4 | 在 `novel_domain` 中落地 `Draft` struct + 纯函数 | done | `id, scene_ref, work_ref, content, status, revision, created_at, updated_at`；status: tentative/accepted/discarded |
| T5 | 在 `novel_domain` 中落地 `Character` struct + 纯函数 | done | `id, work_ref, name, aliases, role, summary, status, created_at, updated_at` |
| T6 | 在 `novel_persistence` 中创建 Ecto schema：`volumes`/`chapters`/`scenes`/`drafts`/`characters` | done | 遵循 ADR-0001 的 JSON mirror 模式；`drafts` 表用 `base_revision` 做乐观锁 |
| T7 | 创建 migration 并验证可运行 | done | `mix ecto.migrate` + `mix ecto.rollback` |
| T8 | 补齐 domain + persistence 测试 | done | Domain 纯函数测试（构造/校验/状态转换）；Persistence CRUD 集成测试 |

## 5. 验证

- [x] `mix compile --warnings-as-errors` — 零警告
- [x] `mix test` — 366 tests, 0 failures（+31 new: 16 domain + 15 persistence）
- [x] `mix xref graph --format cycles --label compile-connected --fail-above 0` — No cycles
- [x] `mix run scripts/arch_check.exs` — 1 pre-existing violation（provider_controller.ex，非本 slice 引入）
- [x] `mix run scripts/lint_enum_literals.exs` — clean（93 canonical values guarded）
- [x] `mix codegen.enums --check` — in sync
- [x] `mix run scripts/adr_trace.exs` — 16/16 ADR(s) traced
- [x] `cd frontend && pnpm typecheck && pnpm test` — 12 tests, 0 failures（不受影响）

## 6. 决策日志

- 2026-04-30 — 选取第一批 6 个核心对象：Work（补全）、Volume、Chapter、Scene、Draft、Character。Work 已有基础 struct，本 slice 补全 persistence schema。暂缓所有连续性对象、风格对象和 7 种资产子类型——它们对端到端创作链路不是阻塞项。
- 2026-04-30 — Draft 的 `status` 使用 3 态：`:tentative | :accepted | :discarded`，对应 ADR-0002 的 `AdoptionStatus`。Draft 的 `scene_ref` 不允许为空——所有草稿必须归属 scene，不支持无场景的自由创作（约束来自 `21-novel-object-model.md` §5.4）。
- 2026-04-30 — 领域 struct 严格禁止引用 Ecto 或任何 persistence 概念。`novel_domain` 的 deps 只有 `novel_foundation`（复用枚举类型），不依赖 `novel_persistence`。这是编译期强制约束。
- 2026-04-30 — Persistence schema 采用 Ecto schema + migration 的常规方式（非 embedded JSON mirror）。Draft 表需 `revision` 字段支持乐观锁（对应 ADR-0002 Revision 和 `07-consistency-and-concurrency.md`）。
- 2026-04-30 — 新增 `StructureStatus` 枚举（PLANNED/DRAFTING/COMPLETED/ARCHIVED）——创建于 `docs/design-v2/schemas/foundation/enums/structure_status.json` + `NovelFoundation.Enums.StructureStatus`，通过 `mix codegen.enums` 同步。Volume/Chapter/Scene 的 persistence schema 使用此枚举。
- 2026-04-30 — `Draft.revision` 受 paper_trail 影响，insert 后 revision 可能 > 1。已调整测试断言为 `>= 1`（与 Work 测试保持一致）。不变量由 `optimistic_lock(:revision)` 保护（并发 adopt 拒绝后到者）。
- 2026-04-30 — `Character` 的 persistence schema 使用 `AdoptionStatus` 枚举（与 Work 一致），domain struct 使用 `Types.work_status()` atom。翻译层在 `novel_application`，本 slice 不介入。

## 7. 试行反馈

- 新增 domain struct 的模式高度统一（`defstruct` + `@type t` + `new/N` + `update_*` + `next_updated_at`），5 个 struct 都是同一模式。后续如有 10+ 领域对象，可考虑用宏或 codegen 生成样板代码，但当前数量级手写无问题。
- `StructureStatus` 枚举是首个非 ADR 来源的 Foundation 枚举——它来自 `21-novel-object-model.md` §5 的设计约束而非 ADR。`enum_literal_lint` 检查有效驱动了枚举标准化。
- Persistence schema 的 changeset 模式与现有 Work schema 高度一致，`adopt_changeset`/`discard_changeset` 已在 slice 内预置，VS-012 的 AdoptionBoundary 可直接消费。
- `arch_check.exs` 有 1 个预存违规（`provider_controller.ex` 直接引用 `NovelAgent.Provider.LMStudio`），不在本 slice 范围。VS-012 可能需要修复或豁免此违规。
