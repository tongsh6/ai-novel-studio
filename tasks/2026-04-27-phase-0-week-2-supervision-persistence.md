# Phase 0 · Week 2 · Supervision tree 骨架 + Persistence 层

- 启动日期：2026-04-27
- 范围依据：`docs/design-v2/tech-stack/14-roadmap.md` §3（任务定义在那里，本文件仅跟踪状态）
- 完成标准依据：同上 §3.2
- 上一周：`tasks/2026-04-26-phase-0-week-1-bootstrap.md`（9/9 done）

## 任务清单

引自 `14-roadmap.md` §3.1。Umbrella 结构下"AINovelStudio.Application"是逻辑总线；具体落在各 sub-app 的 `*.Application`。

| # | 任务 | Status | 关联 commit | 备注 |
|---|---|---|---|---|
| T1 | OTP application 骨架（顶层 supervisor 含 Repo / PubSub / Telemetry 占位） | done | `cd93e0c` | NovelFoundation.Application 重写：5 Registry + Workspace.DynamicSupervisor 启动；Repo 留 T5；PubSub 已在 NovelWeb；Telemetry 留 Week 3 |
| T2 | Workspace.DynamicSupervisor（顶层多作者根，支持动态启停 workspace） | done | `cd93e0c` | `:one_for_one`；start_workspace/1 幂等；Workspace.Supervisor (rest_for_one) per-workspace |
| T3 | Author.DynamicSupervisor（单 workspace 下动态启停 author session） | done | `cd93e0c` | `:one_for_one`；start_author/2 幂等；Author.Supervisor (rest_for_one) per-author |
| T4 | Agent.Children.DynamicSupervisor（单 author 下 spawn 子 Agent，dummy GenServer 占位） | done | `cd93e0c` | `:one_for_one`（crash isolation 关键）；Agent.Dummy GenServer 占位；测试覆盖 crash isolation |
| T5 | Ecto Repo + 第一张表（`mix ecto.create + mix ecto.migrate` 跑通；建 `workspaces` 表） | done | `e2e0f06` | ecto_sql 3.13 + postgrex 0.22；PG 复用本机 colima v2_spike_pg；workspaces (uuid PK + name unique)；DataCase + SQL Sandbox；测试 5 个全绿 |
| T6 | Ecto schemas codegen 完整（`turn_result.json` → `Persistence.Schemas.TurnResult`） | done | `c42b938` (Week 1 T8) | roadmap §3.1 T6 的字面交付（turn_result.json → Persistence.Schemas.TurnResult）由 Week 1 T8 (Plan A: 手写 + 漂移检测) 提前满足；"真生成"升级条目已落到 Week 1 task §Phase 1 接续 |
| T7 | paper_trail 接入（第一张表 + revision audit；完成 verification doc） | todo | — | `verification/paper-trail-ecto-compatibility.md` |
| T8 | Phoenix Channels 雏形（`WorkspaceChannel` 能 join + 收消息） | todo | — | novel_web |
| T9 | Frontend Channel 客户端（`phoenix` npm client 能连上 channel + send） | todo | — | frontend；roadmap §2.0 的 phoenix npm Node 24 兼容性顺带验证 |
| T10 | Frontend Zod schema 接入（`TurnResultSchema.parse` 在前端能跑通） | todo | — | 用 T8 (Week 1) 已生成的 `frontend/src/generated/foundation/turn_result_v2.ts` |

完成标准（来自 `14-roadmap.md` §3.2）：
- [ ] 启动应用后 `Observer` 能看到完整 supervision tree
- [ ] 创建一个 workspace，supervision tree 下出现对应 Workspace.Supervisor + Author.DynamicSupervisor
- [ ] Ecto 写一条 turn_result 数据 + paper_trail 自动写 versions 表
- [ ] `paper_trail` 技术验证结论已记录到 `verification/paper-trail-ecto-compatibility.md`
- [ ] 前端能连接 Phoenix Channel + 收到一条服务端 push
- [ ] schema 一致性 CI 通过

## 决策日志

倒序，最新在上。

- **2026-04-27** — T6 标 done（指向 Week 1 T8 commit `c42b938`）。理由：roadmap §3.1 T6 的字面交付目标"`turn_result.json` → `Persistence.Schemas.TurnResult`"在 Week 1 T8 已经事实上落地（Plan A 手写 + 漂移检测）。当前 turn_result schema 已在 `apps/novel_persistence/lib/persistence/schemas/foundation/turn_result.ex`，drift check 在 CI 跑过。"自动 codegen 真生成"是 Phase 1 接续条目（`tasks/2026-04-26-phase-0-week-1-bootstrap.md` §Phase 1 接续 第 1 条），前置是下游 ADR 落地至少 5 份新 schema。Week 2 不重复劳动。

- **2026-04-27** — T5 完成（commit `e2e0f06`）。关键决策：
  - **DB 选择**：直接走 PostgreSQL（复用本机 colima 上已有的 `v2_spike_pg` 容器，凭据 spike/spike@localhost:5432），不搭 SQLite/PG 双 adapter。06-database.md §2 规划的"阶段 1 SQLite → 阶段 2 PG"切换策略推迟到真有桌面端单机部署诉求时再实施（追加 ADR 决定）。理由：(1) 本机已有 PG 容器，0 基础设施新增成本；(2) Phase 0 只用一个 adapter 先把链路打通，避免 `Application.compile_env :db_type` 的双轨复杂度；(3) workspaces 表只用方言中立特性（uuid / unique index），将来加 SQLite 时无需重写。
  - **utc_datetime_usec 在 PG 里实际类型是 `timestamp without time zone`**：Ecto 默认行为，非 timestamptz。Phase 0 先这样，paper_trail（T7）接入时若 versions 表需要 timezone 一并回头审一次。
  - **mix.exs aliases**：`test` alias 自动跑 `ecto.create --quiet + ecto.migrate --quiet`，CI / 本地新机器拉取后 `mix test` 直接绿。
  - **DataCase**：每个测试独立 SQL Sandbox owner，async test 用独占连接，非 async 共享 owner。
  - 测试套：1 doctest + 11 tests（schema_drift 1 + turn_result changeset 5 + workspace 5）。

- **2026-04-27** — T1+T2+T3+T4 一波完成（commit `cd93e0c`）。合并理由：四项都是搭骨架，单独 commit 没有可观察边界；三层一起搭出来才能跑 iex / 测试验证 tree 完整。落地结构：
  - `NovelFoundation.Application` 启动 5 Registry（Workspace / AuthorDyn / Author / AgentChildrenDyn / Agent，全 `:unique`）+ `Workspace.DynamicSupervisor`
  - 三层 Supervisor 链：Workspace.DynamicSupervisor (`:one_for_one`) → Workspace.Supervisor (`:rest_for_one`) → Author.DynamicSupervisor (`:one_for_one`) → Author.Supervisor (`:rest_for_one`) → Agent.Children.DynamicSupervisor (`:one_for_one`) → Agent.Dummy
  - 子 supervisor 全部 `restart: :temporary`（不自动重启）。原因：调试中发现 `:transient` 下 `Process.exit(:kill)` 触发 child restart，因 Registry 清理 race 造成 restart 失败 → max_restarts=3 触发 → DynamicSupervisor 自身 shutdown → 兄弟子树受牵连。Phase 0 阶段先用 `:temporary`，crash 后由调用方决定。Phase 1 真 Memory.Service / Orchestrator 落地后再视情况切回 `:transient`。
  - 公开 API：`start_workspace/1` / `start_author/2` / `spawn_dummy_agent/3` 全部幂等
  - 测试 5 个：三层启停（3）+ Agent crash isolation（1）+ Workspace crash isolation（1），全绿
  - Telemetry 接入留待 Week 3（按 §4.1 OTel）；Repo 留待 T5；PubSub 已在 novel_web

- **2026-04-27** — Week 2 任务文件创建。Umbrella 模式下不另起 `AINovelStudio.Application` 这个第五个 OTP app；每个 sub-app 自己挂自己的子树（novel_persistence → Repo / novel_foundation → Foundation+Workspace 树 / novel_web → PubSub+Endpoint）。03-backend.md §3 的"AINovelStudio.Application"理解为 umbrella 全集的逻辑视图，非物理 module。

## 卡点 / TBD

- **Telemetry 库选择**：03-backend.md §3 列了 `AINovelStudio.Telemetry` 占位，但具体走 `:telemetry` + `telemetry_metrics` 还是直接用 OTel-erlang 在 Week 3 才决定（Week 3 §4.1 有 OTel 接入）。Week 2 暂只放 placeholder 不真接。
- **paper_trail Elixir 1.19 / Ecto 兼容性**：T7 前置必须验证（社区有 issue 报 1.16+ 兼容问题）。验证方法见 verification doc 模板。

## 下次会话恢复指引

接手者按以下顺序读取上下文：

1. `docs/design-v2/tech-stack/14-roadmap.md` §3（Week 2 任务源）+ §3.2（完成标准）
2. `docs/design-v2/tech-stack/03-backend.md` §3（顶层 supervision tree 概要）
3. `docs/design-v2/tech-stack/08-multi-agent.md` §2（per-workspace 子树权威定义 + restart 策略表）
4. 本文件 §任务清单（当前到哪）+ §决策日志（为什么这么走）
5. 从「任务清单」第一个 `status != done` 的任务继续

调整任务表 / 顺序前：先在「决策日志」追加一条说明，再改清单，不要静默修改。

完成一项任务 = 把对应行的 status 改 done + 填关联 commit + 把变更 commit 进 git，不积压。
