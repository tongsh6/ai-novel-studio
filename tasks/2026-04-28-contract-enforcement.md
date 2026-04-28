# Phase 1 · Contract Enforcement（防止代码偏离设计文档）

- 启动日期：2026-04-28
- 范围依据：`docs/design-v2/adr/0001-turn-result-v2-schema.md`、`docs/design-v2/adr/0002-state-enums.md`、`docs/design-v2/30-contract-glossary.md` §1
- 触发：本日 review 发现 Phase 1 四个 commits（`7d60e33..c7c7bb2`）存在系统性契约漂移——枚举字面量直写、TurnResult schema 字段缺失、状态枚举大小写错误（详见会话记录）
- 上一阶段：`tasks/2026-04-28-phase-1-multi-agent.md`、`tasks/2026-04-28-phase-1-consistency.md`、`tasks/2026-04-28-phase-1-long-runner.md`、`tasks/2026-04-28-phase-1-memory-foundation.md`（review 后均挂出 follow-up TBD）

## 设计意图

让 ADR 冻结的契约成为代码的强约束：JSON SSOT → codegen → 三层校验（编译期 / 运行时 / CI），漂移在 CI 早于人工 review 发现。详细策略见会话记录"防止代码偏离设计文档的策略"。

## 任务清单

| # | 任务 | Status | 关联 commit | 备注 |
|---|---|---|---|---|
| T1 | 6 个枚举 JSON SSOT 文件 | done | (pending) | `docs/design-v2/schemas/foundation/enums/`：status / turn_phase / task_phase / adoption_status / next_action / behavior_status；每个含 `x-adr` / `x-section` 锚点 |
| T2 | `mix codegen.enums [--check]` task | done | (pending) | 生成 `NovelFoundation.Enums.*` 模块；`--check` 模式接进 `mix check` aliases；后续支持 `x-form: atom` |
| T3 | 替换 schema/turn_service 字面量 | done | (pending) | `work.ex` / `long_run_task.ex` / `turn_service.ex` / `adoption_boundary.ex` 全部走 Enums；TurnResult 14 必填字段补齐；schema_version 改 `"2.0.0"`；migration 5 升级已有 lowercase 数据 |
| T4 | `TurnResultValidator` + 出口校验 | done | (pending) | 朴素版（不引入 ex_json_schema）：14 必填 + 枚举字段 + behavior/adoption 形状；TurnService.handle_message 末尾 `validate!/1` |
| T5 | enum literal lint + CI | done | (pending) | `scripts/lint_enum_literals.exs` 守 41 个 canonical 值；进 `mix check` 与 GitHub Actions |
| T6 | Channel adopt 兼容 TurnResult schema | done | (pending) | TurnService.handle_adopt 组装合法 TurnResult；channel adopt 改调它；前端可统一处理 turn_result event |
| T7 | phase × next_action 兼容矩阵 SSOT + contract test | done | (pending) | `phase_next_action_compat.json` + Foundation.PhaseNextActionCompat（编译期读 JSON）+ Validator 接入 §7 规则；53 data-driven contract tests |
| T8 | agent_type 枚举 + Writer.identity 修正 | done | (pending) | codegen.enums 加 `x-form: atom` 支持；agent_type.json 6 值；Behaviour identity 改 instance-level；Writer 实装 + 测试 |
| T9 | AdoptionBoundary 改 Ecto.Multi 真实事务 | done | (pending) | Multi.run + `stale_error_field: :revision`；事务原子性测试；Work 乐观锁单元测试 |
| T10 | Memory Interaction 补齐 §5.1 6 字段 + 3 枚举 | done | `400b3dd` | 新增 MemoryClass / RetentionTier / SourceType 枚举 SSOT + codegen；migration 00006 加 6 列；Interaction schema 全枚举引用；TurnService 传完整 12 字段 entry；lint 扩展至 56 canonical values |

## 当前状态

- `mix check` 全绿（exit 0），139 tests / 0 failures（umbrella 全测）
- 上一轮 review 中"字面量 / schema 字段 / 大小写 / Channel adopt schema 不兼容 / Writer.identity 错值 / adoption 缺事务"全部闭环
- 守护范围：**56 个 canonical 值**（41 string UPPER_SNAKE_CASE + 15 string lowercase for memory enums）+ 6 atom（agent_type）+ phase × next_action 兼容矩阵
- Memory Interaction §5.1 12 字段补齐，3 个新枚举模块 + migration 00006

## 决策日志

- **2026-04-28（下午批 T6-T9）** — 第二批闭环：
  - **TurnService 加 handle_adopt/3** 而不是让 channel 直接构造 TurnResult。理由：channel 是薄网关（`scripts/arch_check.exs` 禁 channel 直接动 schema），TurnResult 组装属于 application 层；前端因此可统一监听 `turn_result` event。
  - **phase × next_action 矩阵 JSON 编译期加载**：`PhaseNextActionCompat` 用 `@external_resource` + `File.read!` 在 compile time 读 JSON。任何 ADR-0002 §7 修改触发模块重编 + contract test 重跑。
  - **codegen.enums 加 `x-form: atom`**：agent_type 是 atom 派系（tech-stack/08 §3.1），与其他 UPPER_SNAKE_CASE string 派系混用。SSOT 仍是 string list（适合 JSON Schema），生成模块按 form 选 string 或 atom，类型/守卫/inspect 都跟着切。
  - **AdoptionBoundary 用 `Multi.run` + `stale_error_field`**：`Multi.update` 的 changeset 不接 update opts；用 `Multi.run` 内部调 `Repo.update(..., stale_error_field: :revision)` 把 raise 转成 changeset error，再翻译成 `:stale_revision` atom。这样事务边界清晰，stale 路径可测。
  - **stale_revision 真正的并发场景留给 mutation contract PR**：当前 `accept(payload)` 入口下 stale 不可达（insert + update 中间无并发窗口）。在 Work schema 单元测试里覆盖 stale_error_field 行为，AdoptionBoundary 转换由 review 担保。

- **2026-04-28（晚间批 T10）** — Memory Interaction 字段补齐：
  - **3 个新枚举 JSON SSOT**：MemoryClass (4 values)、RetentionTier (3 values)、SourceType (8 values)，均为 lowercase 语义值。`mix codegen.enums` 生成对应模块，lint 覆盖 56 个 canonical 值（新增 15 个）。
  - **Migration 00006** 加 6 列：`source_ref` / `scope_ref` / `freshness_score` / `importance_score` / `replayable` / `retrievable`。scores 默认 0.5（0.0-1.0 校验），booleans 默认 true。
  - **Interaction schema 全枚举引用**：`@valid_classes` / `@valid_tiers` 替换为 `MemoryClass.values()` / `RetentionTier.values()` / `SourceType.values()`。
  - **TurnService.record_to_memory 产出完整 12 字段 entry**：`freshness_score: 1.0`（turn 消息最新），`importance_score: 0.5`（默认），`source_ref: turn_id`，`scope_ref: workspace_id`。
  - **Memory.Store 无改动**：ETS hot tier 是通用 map 透传，字段 schema 由 Persistence 层负责。

- **2026-04-28（上午批 T1-T5）** — 防漂移基线落地。关键决策：
  - **JSON SSOT 优先于代码生成器**：枚举先以 JSON Schema 形式落 `docs/design-v2/schemas/foundation/enums/`，代码是其次。这样 ADR 改动可直接编辑 JSON，codegen 自动跟。
  - **生成模块用 zero-arity function 而非 atom**：`NextAction.ask_user()` 返回 `"ASK_USER"` 字符串。理由：JSON ↔ Elixir 边界统一用字符串；macro / module attribute 在 pattern match 上不如函数灵活。
  - **不引入 ex_json_schema**：朴素 validator 已能抓 ADR-0001 / ADR-0002 90% 的违反。引入新 dep 风险大于收益。后续如需 `$ref` 解析再升级。
  - **lint 用脚本而非 Credo 自定义 check**：grep-based 脚本零依赖、易理解、易扩展豁免列表。Credo plugin 改造成本更高。
  - **migration 含 down/0**：升级是字符串大小写转换，DB 数据可逆。`up` 同时 `ALTER COLUMN ... SET DEFAULT`。
  - **TurnService 出口处 raise 而非返回 `{:error, ...}`**：Phase 1 阶段宁可崩溃，不允许漂移悄悄通过；上层捕获后再决定降级策略。

## 卡点 / TBD（下一批 PR 候选）

按上一轮 review 优先级排，**本次未闭环**：

- **LongRunTask schema 缺 18 字段**（`06-planning-and-long-run.md` §5）— `plan_ref` / `authority_scope` / `estimated_budget` / `consumed_budget` / `scope_ref` / `parent_turn_ref` 等。当前只有 7 字段。
- **LongRunner GenServer 不写 DB**（`long_runner.ex` 注释承诺与实装脱节）。重启数据全丢。同时 `list_active/1` 忽略 workspace_id 是数据隔离漏洞。
- **Mutation contract 整体缺**（`07-consistency-and-concurrency.md` §4.4 / §7.1）— 没有 `mutations` 表，`AdoptionBoundary.accept(payload)` 接口签名不接 `base_revision`，stale_revision 在当前路径不可达；需要重新设计 accept 入口。
- ~~**Memory Interaction 缺 6 必填字段**~~ → T10（2026-04-28 晚间批闭环）
- **IntentRegistry slot envelope 缺 7 字段**（ADR-0010 §3）— `requiredness` / `inferability` / `defaultability` / `scope_dependency` / `allowed_values_ref` / `validation_rules_ref` / 顶层 `schema_id` / `deferred_to_runtime`。
- **TurnResult `errors[]` 非空时 status 不得为 DONE**（ADR-0002 §7 规则 4）— TurnService 当前不 emit errors，规则未在 Validator 实装。
- **task context 兼容性**（`task:RUNNING` / `task:CHECKPOINT` 等）— Validator 当前只校验 turn context；LongRunner 输出 TurnResult 后再加。
- **ADR ↔ 实装 traceability 索引未建**（策略文档 Phase B 第 7 项）— 每个冻结 ADR 加 `enforced_by` frontmatter + `scripts/adr_trace.exs` 双向校验。

**已闭环**（不再列入 TBD）：

- ~~Channel adopt 广播 schema 不兼容~~ → T6
- ~~Writer.identity/0 返回静态错值~~ → T8
- ~~agent_type 枚举缺值~~ → T8（`agent_type.json` 6 值）
- ~~adoption 路径无 transaction~~ → T9
- ~~phase × next_action 兼容矩阵无 contract test~~ → T7
- ~~Memory Interaction 缺 6 字段~~ → T10（`400b3dd`）

## 下次会话恢复指引

1. 先读 **本文件**（含决策日志 + 已落地的 9 件事）
2. 然后读 `tasks/README.md`、`docs/design-v2/adr/0001-turn-result-v2-schema.md`、`docs/design-v2/adr/0002-state-enums.md`、`docs/design-v2/30-contract-glossary.md` §1-3 四份契约源
3. 校验当前状态：`mix check`（应全绿，139 tests）；`mix codegen.enums --check`（应 in sync）；`mix run scripts/lint_enum_literals.exs`（应 clean）
4. 选下一批：按工作量从小到大：
   - **Memory Interaction 字段补齐** ~~（已完成 T10）~~ + **IntentRegistry slot envelope 补齐**（schema-driven，下一个）
   - **LongRunTask schema 18 字段** + **LongRunner workspace 隔离**（中等 — 涉及新 migration + GenServer 重构）
   - **Mutation contract 落地**（最大 — 重新设计 AdoptionBoundary 入口签名）
5. 新增枚举（如 `memory_class.json` / `slot_type.json` / `behavior_type.json`）流程：建 JSON SSOT → `mix codegen.enums` → 在用到的 schema 里替换字面量 → 跑 `mix check`。`x-form: atom` 用于 atom 派系。
6. 新增 contract test（如 task phase 状态机）：参考 `phase_next_action_compat_test.exs` —— JSON SSOT + `for ... do test do ... end` data-driven。
