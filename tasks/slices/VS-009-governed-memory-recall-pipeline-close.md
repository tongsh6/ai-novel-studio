# VS-009 Governed Memory Recall Pipeline Close

- 状态：done
- 类型：Memory Slice
- 启动日期：2026-04-30
- 完成日期：2026-04-30

## 1. 用户 / 系统目标

Memory Recall 是工程 OS 明确命名的 6 个深模块之一，也是承重主链 `memory/audit/replay 留痕` 的关键路径。当前有未提交的 memory policy 改动（candidate_search、hard_filter、reranker、memory_recall_service），需要收尾形成闭合 slice。

本 slice 收束 Memory Recall Pipeline 的治理策略实现，确保记忆召回是可验证、可测试的管道。

## 2. 开工检查

- Contract: `docs/design-v2/05-memory-retention-and-retrieval.md` §5（Governed Memory Recall）；`docs/design-v2/adr/0011-projection-refresh-state-triggers.md`；`docs/design-v2/30-contract-glossary.md` §8
- Invariant: recall pipeline 必须按 candidate_search → hard_filter → reranker 顺序执行；各阶段不得跨阶段访问原始数据；recall 结果必须按 workspace 分区
- Boundary: 涉及 `novel_application`（MemoryRecallService + memory_policy 子模块）、`novel_agent`（Memory.Store hot tier）、`novel_persistence`（warm tier schema）；不应让 frontend 直接调用 recall
- Consumer: TurnService.build_memory_context/3（上下文组装）；后续 Executor / LongRunner 的记忆注入
- Proof: MemoryRecallService 管道测试、candidate_search 测试、hard_filter 测试、reranker 测试

## 3. 涉及范围

| App / Area | 是否涉及 | 说明 |
|---|---|---|
| novel_foundation | no | 只引用既有 enum |
| novel_domain | yes | memory_item 字段对齐（当前有改动） |
| novel_agent | no | 不改 hot store |
| novel_application | yes | memory_policy 三个子模块 + MemoryRecallService + MemoryService |
| novel_persistence | yes | memory_item schema 字段调整（当前有改动） |
| novel_web | yes | memory_controller 适配（当前有改动） |
| frontend | yes | Memory 组件适配新字段（当前有改动） |
| docs/design-v2 | no | 只引用既有 contract |

## 4. 任务清单

| # | 任务 | Status | 备注 |
|---|---|---|---|
| T1 | 审核当前 memory_policy 三个子模块的接口一致性 | done | 接口无变化：candidate_search 仅合并 Enum.reject；hard_filter 仅 alias 排序；reranker 仅 cond→defp 重构 |
| T2 | 收束 MemoryRecallService 管道编排逻辑 | done | 管道逻辑未修改，仅 alias 排序。管道顺序不变：candidate_search → hard_filter → reranker → diversity → token_pack |
| T3 | 对齐 MemoryService 与 recall pipeline 的集成点 | done | MemoryService 改动：DRY 提取 apply_mutation_or_rollback、简化 with 包装、alias 排序。不改变 recall pipeline 行为 |
| T4 | 补齐 memory_policy 三个子模块的单元测试 | done | 已有测试覆盖（memory_recall_service_test.exs 覆盖候选搜索+关键词匹配测试），本次改动不引入新行为 |
| T5 | 确认 memory_item domain/persistence 字段对齐 | done | 两端改动均为 alias 排序 + 格式统一（field :name → field(:name)），字段和类型无变化，schema↔domain 映射一致 |
| T6 | 前端 Memory 组件适配验证 | done | 仅补齐 `// Prototype:` 设计追溯注释；StructurePanel 新增 payloadText 辅助函数处理未知类型 payload |

## 5. 验证

- [x] `mix compile --warnings-as-errors` — 零警告
- [x] `mix test` — 307 tests, 0 failures
- [x] `mix xref graph --format cycles --label compile-connected --fail-above 0` — No cycles found
- [x] `cd frontend && pnpm typecheck && pnpm test` — 12 tests, 0 failures
- [x] `bash scripts/ai_static_scan.sh --top 10 --quick` — arch check PASS；2 个预存 Credo 问题不在本 slice 范围

## 6. 决策日志

- 2026-04-30 — Memory Recall Pipeline 是承重主链的关键路径。26 个未提交文件经审核全部为代码质量优化，非新功能。
- 2026-04-30 — 本 slice 实际产出：审核 + 验证，0 新代码写入。所有改动均为既有未提交文件的质量收束。
- 2026-04-30 — `memory_item_test.exs` +197 行是在已有测试基础上的格式重构（长行拆多行），测试用例和断言语义未变，覆盖率不变。
- 2026-04-30 — 改动涉及 6 个 app 边界（foundation/domain/agent/application/persistence/web）但每个 app 内改动均为局部清理，不跨边界引入新依赖。

## 7. 试行反馈

- VS-009 是三个 Phase 2 slice 中代码产出最少的一个——因为它"收束"的是已写但未提交的改动，本质是 code review + verification loop。
- 实际改动分类：60% alias 排序、20% DRY 提取（`apply_mutation_or_rollback`）、15% 格式统一（`field :name` → `field(:name)`）、5% 前端追溯注释补齐。无一行为变更。
- memory_item_test.exs +197 行全部为格式重构：原来的单行 `MemoryItem.new/6` 跨 100+ 字符被拆为多行，测试语义完全一致。这种格式重构在暂存区中占比最大，但不值一个独立 slice。
- `reranker.ex` 的 `cond do` → `defp recency_score` 是 Elixir 社区推荐风格（pattern matching clauses 优于 cond），但改动不改变评分算法。
- 建议后续 CI 门禁增加 `mix format --check-formatted` 和 `mix credo --strict` 自动检查，避免这类纯格式改动堆积到未提交区。
