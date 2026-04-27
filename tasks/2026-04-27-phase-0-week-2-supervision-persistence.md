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
| T8 | Phoenix Channels 雏形（`WorkspaceChannel` 能 join + 收消息） | done | `2d94d4b` | UserSocket /socket + WorkspaceChannel "workspace:*" + ping/pong reply；3 个 ChannelTest 全绿；secret_key_base + pubsub_server 完成 endpoint 配置 |
| T9 | Frontend Channel 客户端（`phoenix` npm client 能连上 channel + send） | done | `5b3f362` | phoenix 1.8.5 + @types/phoenix；socket.ts helper + ChannelDemo 组件；4 个单测；端到端浏览器验证待用户手动跑 |
| T10 | Frontend Zod schema 接入（`TurnResultSchema.parse` 在前端能跑通） | done | `5b3f362` | schemas.ts barrel + 别名（TurnResultV2Schema → TurnResultSchema）；4 个 vitest 测试覆盖 parse 接受/拒绝路径 |

完成标准（来自 `14-roadmap.md` §3.2）：
- [x] 启动应用后 `Observer` 能看到完整 supervision tree（`iex -S mix` 实测 + foundation 测试覆盖）
- [x] 创建一个 workspace，supervision tree 下出现对应 Workspace.Supervisor + Author.DynamicSupervisor（`NovelFoundation.start_workspace + start_author` 实测）
- [ ] Ecto 写一条 turn_result 数据 + paper_trail 自动写 versions 表（T7 待办；当前已能写 workspaces，缺 paper_trail / turn_result 的真接入）
- [x] `paper_trail` 技术验证结论已记录到 `verification/paper-trail-ecto-compatibility.md`（spike 已完成 ✅，但仍待 binary_id 复跑——T7 卡点）
- [x] 前端能连接 Phoenix Channel + 收到一条服务端 push（前后端代码 + 单测全绿；端到端浏览器实测待用户手动跑：`mix phx.server` + `pnpm dev` → :5173 看 ChannelDemo "joined" + pong）
- [x] schema 一致性 CI 通过（Week 1 T8 + T9 已建立的 drift check）

## 决策日志

倒序，最新在上。

- **2026-04-27** — T8 + T9 + T10 一波拿下（commits `2d94d4b` / `5b3f362`）。Phoenix Channel 链路前后端打通：
  - 后端：UserSocket on `/socket` + WorkspaceChannel "workspace:*" + ping/pong reply。Endpoint 加 `pubsub_server: NovelWeb.PubSub` 解决 `subscribe_and_join` 的 ArgumentError。secret_key_base 暂用 dev 占位（prod runtime 必须 override）。
  - 前端：phoenix 1.8.5 + @types/phoenix；socket.ts 提供 createSocket / joinWorkspace / ping helper；ChannelDemo 组件 mount 在 App.tsx 顶部，连接 ws://localhost:4000/socket + auto ping。schemas.ts barrel 把 generated/ 下导出聚合 + 别名（去掉版本后缀对齐 backend 路径）。
  - 测试：backend 3 个 channel tests + frontend 8 个单测（4 socket helper + 4 zod parse），全绿。
  - **端到端浏览器验证待用户手动跑**：`mix phx.server` + （另一窗口）`cd frontend && pnpm dev` → 访问 http://localhost:5173/，预期 ChannelDemo 顶部显示 "status: joined" + "pong: {...echo: {hello: world}}"。
  - 完成标准 §3.2 至此 5/6 ✅，剩 paper_trail 接入（T7）。

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
