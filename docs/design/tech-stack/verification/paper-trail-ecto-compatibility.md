# 验证任务：paper_trail 与 Ecto 兼容性

> 状态：✅ 通过（2026-04-26 实测）
>
> 目标：确认 `paper_trail` 能否作为 v2 的 revision audit 基线，稳定支持 Ecto 3.13、SQLite 阶段 1、PostgreSQL 阶段 2，以及 adoption boundary 的事务语义。

---

## 1. 背景

tech-stack 当前推荐：

- `03-backend.md`：`paper_trail` 作为 revision audit 插件。
- `06-database.md`：`paper_trail.versions.id` 可作为 `source_revision_refs.source_revision_id`。
- `13-risks.md`：`paper_trail` 维护活性下降，必要时回退到自实现 audit log。

这个点不能只靠文档判断，因为 revision audit 是以下能力的基础：

- adoption boundary 的可追溯写入
- `source_revision_refs` 派生关系
- reading projection stale 判断
- replay / audit / 回滚分析

如果 Phase 0 后期才发现 `paper_trail` 与当前 Ecto 或双数据库策略不兼容，会影响持久化层设计。

---

## 2. 验证问题

必须回答：

1. `paper_trail` 是否能在 Elixir 1.19 + OTP 28 + Ecto 3.13 下正常编译和运行？
2. SQLite adapter (`ecto_sqlite3`) 下 insert / update / delete 是否都能生成正确版本记录？
3. PostgreSQL adapter (`postgrex`) 下同样流程是否一致？
4. `Ecto.Multi` 中业务写入 + audit 写入是否能保持同一事务边界？
5. `versions` 表记录是否足够表达 v2 需要的 `originator_id`、`origin`、`meta`、`source_revision_refs`？
6. 失败或 rollback 时是否不会产生孤立 audit record？

---

## 3. 最小实验

### 3.1 临时 schema

建立最小 `works` 表：

```elixir
schema "works" do
  field :workspace_id, :binary_id
  field :author_id, :binary_id
  field :title, :string
  field :status, Ecto.Enum, values: [:draft, :active, :archived]

  timestamps(type: :utc_datetime_usec)
end
```

### 3.2 测试动作

在 SQLite 和 PostgreSQL 两个 adapter 下分别执行：

1. insert work
2. update title
3. update status
4. delete / archive
5. 在 `Ecto.Multi` 中故意制造失败，确认 rollback 后没有孤立 version
6. 查询 versions，确认可以还原每次变化

### 3.3 命令形态

Phase 0 脚手架建立后补齐实际命令，预期形态：

```bash
mix test test/verification/paper_trail_sqlite_test.exs
DB_TYPE=postgres mix test test/verification/paper_trail_postgres_test.exs
```

---

## 4. 通过标准

必须全部满足：

- [x] `mix deps.get`、`mix compile` 通过，无不可接受 warning。（`instructor` 0.1.0 在 `lib/instructor/adapters/openai.ex:197` 有一条 unreachable clause 警告，是依赖自身问题，不阻塞。）
- [x] SQLite 下 insert / update / delete 都产生 version。
- [x] PostgreSQL 下同样产生等价 version。
- [x] `originator_id`、`origin`、`meta` 可以写入并查询。（spike 用 `originator_id: nil`、`origin: "spike:paper_trail"`、`meta: %{"trace_id" => "..."}`，4 条 version 全部回写。）
- [x] `Ecto.Multi` rollback 不留下孤立 version。
- [x] version id 可稳定写入 `source_revision_refs.source_revision_id`。
- [ ] 测试能进入 CI，不依赖手工步骤。**待办**：当前 spike 跑在本机，PostgreSQL 走容器。Phase 0 需要把这套断言迁成 ExUnit + `Ecto.Adapters.SQL.Sandbox`，并在 CI 内启停 postgres 容器（GitHub Actions 可用 `services.postgres`）。

---

## 5. 失败处理

如果任一关键标准失败，改为自实现 revision audit：

```text
Ecto.Multi
  -> 写业务表
  -> 写 versions 表
  -> 写 source_revision_refs
  -> transaction commit
```

自实现方案必须满足：

- versions 表 schema 由 v2 contract 明确。
- 所有 adoption boundary 写入必须经过统一 helper。
- 不允许业务模块绕过 audit helper 直接 `Repo.insert/update`。

---

## 6. 结果记录

| 字段 | 内容 |
|---|---|
| 实测日期 | 2026-04-26 |
| Elixir / OTP | Elixir 1.19.5 / OTP 28 (erts 16.4) |
| Ecto / adapter 版本 | ecto 3.13 系，`ecto_sql` 3.13.5；`ecto_sqlite3` 0.22.0 (exqlite 0.36.0)；`postgrex` 0.22.0 |
| paper_trail 版本 | 1.1.2（Hex.pm 2024-08-30 发布；2025-2026 无正式 release，维护风险仍需监控） |
| SQLite 结果 | 8/8 全部通过：insert/update title/update status/delete 各产生 1 条 version；Multi 强制失败时无孤立 version；versions.id 为正向 BIGSERIAL，可作 source_revision_id |
| PostgreSQL 结果 | 8/8 全部通过：行为与 SQLite 一致；`item_changes` 落 JSONB；versions.inserted_at 微秒精度保留 |
| 结论 | ✅ 通过 |
| 后续文档更新 | 1) `13-risks.md` 保留 `paper_trail` 维护活性风险，但标注“当前栈已 spike 通过，风险从阻塞项降为监控项”；2) `06-database.md` 可写实 `source_revision_refs.source_revision_id` ↔ `versions.id` 的类型约束（BIGINT，单调递增）；3) `03-backend.md` 把 paper_trail 从"评估中"提升为"基线"。 |

### 6.1 实测脚手架

代码位于 `spikes/v2_verification/`（与文档同仓库）。一键复跑：

```bash
cd spikes/v2_verification
mix deps.get
SPIKE_DB=sqlite   mix run -e 'V2Verification.Spike.PaperTrail.run(:sqlite)'
SPIKE_DB=postgres mix run -e 'V2Verification.Spike.PaperTrail.run(:postgres)'
```

PostgreSQL 走容器（首次运行前）：

```bash
docker run -d --name v2_spike_pg \
  -e POSTGRES_PASSWORD=spike -e POSTGRES_USER=spike -e POSTGRES_DB=spike \
  -p 5432:5432 postgres:16-alpine
```

### 6.2 关键实测断言

| 断言 | 含义 | 结果 |
|---|---|---|
| `insert_emits_version` | `PaperTrail.insert/2` 返回 `{:ok, %{model, version}}` 且 `version.event == "insert"`，`item_id == model.id` | SQLite ✅ / PG ✅ |
| `update_title_emits_version` | 标题字段更新仅写 `{"title": "..."}` 到 `item_changes` | SQLite ✅ / PG ✅ |
| `update_status_emits_version` | `Ecto.Enum` 字段更新写入字符串/atom，反序列化对账成功 | SQLite ✅ / PG ✅ |
| `delete_emits_version` | `PaperTrail.delete/2` 写入 `event="delete"`，`item_changes` 为完整快照 | SQLite ✅ / PG ✅ |
| `multi_rollback_no_orphan` | `Ecto.Multi.run(:fail, fn -> {:error, ...} end)` 与 `PaperTrail.Multi.insert` 同事务时，rollback 后 versions 表行数不变 | SQLite ✅ / PG ✅ |
| `version_trail_reconstructable` | 按 `item_type="Work"` 与 `item_id=N` 升序查询 versions 得到 `["insert","update","update","delete"]` | SQLite ✅ / PG ✅ |
| `originator_origin_meta_persisted` | `origin: "spike:paper_trail"` 与 `meta: %{trace_id: ...}` 4 条 versions 全部回写并可读出 | SQLite ✅ / PG ✅ |
| `version_id_usable_as_source_revision_id` | versions.id 全部为正整数 → 可直接写入 `source_revision_refs.source_revision_id (BIGINT)` | SQLite ✅ / PG ✅ |

### 6.3 注意事项与边界

- `PaperTrail.Multi.commit/1` 对 error 分支假设第三元为 `Ecto.Changeset`；想塞自定义错误时应直接调用 `repo.transaction(multi)` 而不经过 `commit/1`，否则会触发 `BadMapError`。本仓 spike 已采用这种写法，正式实现也应在文档中明确。
- `paper_trail` 默认 item_type 为 `Module |> Module.split() |> List.last()`（即 `"Work"`），跨 namespace 时需在查询条件里使用末段名，不是完整模块名；如果跨 boundary 复用同名 schema，需要在 `versions.meta` 里冗余 namespace。
- SQLite 单连接池（`pool_size: 1`）+ WAL 是必要前置条件；多连接并发写时已经观察到 "database is locked" 错误。这是 SQLite 的固有约束，不是 paper_trail 的缺陷，但 v2 contract 应在 SQLite 适配层固化这个约束。
- `paper_trail` 1.1.2 早于 Ecto 3.13 发布；本结论是 **v2 spike 实测兼容**，不是 upstream maintainer 对 Ecto 3.13 的官方验证。每次 Ecto / Elixir / OTP 主版本升级后都必须复跑本 spike。
