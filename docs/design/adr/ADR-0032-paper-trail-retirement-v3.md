# ADR-0032：PaperTrail 逻辑退役——source_revision_ref + StateTrace 为唯一修订权威

- 状态：Accepted（2026-10-31，作者明确选择 D：正式逻辑退役，物理清理分两步）
- 日期：2026-10-31
- 来源：B51 的 PaperTrail 只读证据；`docs/project-ledger.md` 2026-10-31 记录
- 影响范围：novel_persistence 依赖/配置/测试、tech-stack 文档、CI（不涉及业务 schema）
- 相关不变量：I1/I2/I3 不变的因果/输入/来源；revision/state trace 的真实来源
- 首个证明 slice：B51
- 取代：PaperTrail 作为 revision audit 生产方案的旧技术栈声明
- 取代者：无

## 决策

1. `source_revision_ref`（mutation/draft/decision/character_profile_revision/renumber 等）+ `StateTrace`/Replay/Projection 是当前唯一权威修订链；新代码不得接入 PaperTrail。
2. 移除产品依赖 `paper_trail`、`config :paper_trail` 配置，以及只验证第三方库行为的 `paper_trail_test.exs`；保留历史 spike 与设计记录，它们仅是选型证据，不是生产能力。
3. **保留 `versions` 表与历史 migration**：不重建 SQLite 表、不删除 migration、不触碰历史数据；该表仅为历史 schema 痕迹，不再代表 PaperTrail 是产品能力。物理删除需后续单独数据授权。
4. 文档/台账明确 PaperTrail 已逻辑退役；不得再把 versions 当生产审计来源或双权威。

## 验证

- `mix deps.unlock paper_trail` 后全量编译/测试/架构检查通过；
- `grep PaperTrail` 生产 `lib` 与 config 无引用；
- B51 CP0 证据保留：生产零调用、dev/stage versions=0。

## enforced_by

- `apps/novel_persistence/lib/novel_persistence.ex`
- `apps/novel_persistence/priv/repo/migrations/20260427000002_add_versions.exs`
- `apps/novel_persistence/mix.exs`
- `apps/novel_application/lib/novel_application/adoption_workflow.ex`
- `apps/novel_application/lib/novel_application/replay_service.ex`
- `apps/novel_domain/lib/novel_domain/decision_trace.ex`
- `tasks/slices/B51-tech-stack-current-rebase.md`
- pending: versions 表与历史 migration 按 §3 保留，物理删除需后续单独数据授权（本文件不授权）；生产库与配置当前零 paper_trail 引用

## enforcement_gaps

- 物理删除 `versions` 表尚未执行（§3 要求另行数据授权，不由本 ADR 授权）。
