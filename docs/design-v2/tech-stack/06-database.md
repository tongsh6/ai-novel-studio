# Database 持久化策略

> 状态：草案
>
> 目的：定义 SQLite ↔ PostgreSQL 切换策略、Ecto schema 纪律、revision audit、migration 流程。本文档落地 [`../00e-architecture.md`](../00e-architecture.md) 的数据面 + [`../30-contract-glossary.md`](../30-contract-glossary.md) §2 revision 一致性约束。

---

## 1. 总览

```yaml
orm:             Ecto 3.x
adapter_alpha:   ecto_sqlite3 (Stage 1: 单机)
adapter_beta:    postgrex (Stage 2: B/S)
migration:       Ecto.Migration（手写, 不依赖 codegen）
revision_audit:  paper_trail
schema_source:   docs/design-v2/schemas/*.json （SSOT, codegen Ecto schema）
multi_tenant:    workspace_id 列 + Ecto query scope
event_emit:      after_commit hook → Phoenix.PubSub
backup:          阶段 1 SQLite 文件备份；阶段 2 pg_dump
```

---

## 2. 阶段切换策略

### 2.1 Ecto Adapter 切换

`config/config.exs` 不直接绑定 adapter，由 `runtime.exs` 决定：

```elixir
# config/runtime.exs
config :ai_novel_studio, AINovelStudio.Repo,
  adapter:
    case System.get_env("DB_TYPE", "sqlite") do
      "sqlite" -> Ecto.Adapters.SQLite3
      "postgres" -> Ecto.Adapters.Postgres
    end,
  database: System.get_env("DB_PATH", default_db_path()),
  pool_size: String.to_integer(System.get_env("POOL_SIZE", "5"))
```

阶段切换：

- 阶段 1：`DB_TYPE=sqlite DB_PATH=~/.local/share/.../db.sqlite3`
- 阶段 2：`DB_TYPE=postgres DATABASE_URL=postgres://...`

**业务代码 0 改动**。

### 2.2 PG-specific 特性的 capability detection

某些特性 SQLite 不支持，要 capability detection：

| 特性 | SQLite | PostgreSQL | 处理 |
|---|---|---|---|
| `LISTEN/NOTIFY` | ❌ | ✅ | 抽象到 `EventBus.Adapter`，SQLite 用进程内 PubSub，PG 用 LISTEN/NOTIFY |
| Full-text search | FTS5 | tsvector | 抽象到 `Search.Adapter`，两边语法不同 |
| JSON 操作 | json1 ext | jsonb 原生 | Ecto 提供 `fragment/1` 跨方言 |
| Window functions | 部分支持 | 完整支持 | 阶段 2 用到时再考虑 |
| Array 类型 | ❌ | ✅ | 用 jsonb 数组替代（两边都支持） |

**纪律**：

- 业务代码不直接调 PG 特性
- 跨方言差异统一封装到 `AINovelStudio.Persistence.Adapter`
- 各 adapter 实现 capability check

---

## 3. Schema 设计纪律

### 3.1 必须字段

所有可演化对象表（Domain Object / Continuity / Style / TurnResult）必须有：

```elixir
schema "some_object" do
  field :workspace_id, :binary_id        # 多租户
  field :author_id, :binary_id           # 创建者
  field :revision_id, :integer           # 版本号（paper_trail 管理）
  field :status, Ecto.Enum, values: [...] # 状态机
  
  # business fields ...
  
  timestamps(type: :utc_datetime_usec)   # inserted_at + updated_at
end
```

> **关于 `:binary_id` 在 SQLite 上的存储**：SQLite 没有原生 UUID 类型，`ecto_sqlite3` 默认把 `:binary_id` 序列化为 TEXT（字符串 UUID）。这与 PostgreSQL 的 `uuid` 二进制类型在 ① join 性能 ② 字节序 ③ 迁移工具行为上有差异。Phase 0 第 2 周建立 Ecto 骨架时必须实测一次 round-trip（写入 SQLite → 导出 → 写入 PostgreSQL → 校验 ID 一致），结果记录到本节。

`source_revision_refs` 这种"派生关系"用专门表表达：

```elixir
schema "source_revision_refs" do
  belongs_to :source_object, :binary_id   # polymorphic via type tag
  field :source_object_type, :string
  field :source_revision_id, :integer
  belongs_to :derived_object, :binary_id
  field :derived_object_type, :string
  field :derived_revision_id, :integer
  
  timestamps()
end
```

### 3.2 Adoption Boundary 表

[`../00e-architecture.md`](../00e-architecture.md) §10 反模式 #3："只有 Adoption Boundary 与 Projection Refresher 拥有 `production_write`"。

物理隔离 tentative 与 accepted：

```elixir
# 待采纳（tentative）
schema "tentative_artifacts" do
  field :workspace_id, :binary_id
  field :artifact_type, :string          # "draft" / "summary" / "outline" / etc.
  field :content, :map                   # jsonb / json
  field :revision_base, :integer         # 基于哪个 base revision 产出
  field :requires_adoption, :boolean, default: true
  field :adoption_status, Ecto.Enum,
    values: [:proposed, :reviewing, :accepted, :edited_accepted, 
             :rejected, :superseded, :archived]  # ADR-0007 §3
  field :proposed_by_agent_id, :binary_id  # §12 agent_ref
  
  timestamps()
end

# 已采纳的具体 Domain Object（accepted）—— 各对象单独表
schema "drafts" do
  field :workspace_id, :binary_id
  field :work_id, :binary_id
  field :chapter_id, :binary_id
  field :revision_id, :integer
  field :content, :string
  field :status, Ecto.Enum, values: [:active, :archived]
  
  timestamps()
end
```

Adoption boundary 是一个 `Ecto.Multi` 函数：

```elixir
def adopt(workspace_id, tentative_artifact_id) do
  Ecto.Multi.new()
  |> Ecto.Multi.run(:fetch_tentative, fn _, _ ->
    Persistence.get_tentative(workspace_id, tentative_artifact_id)
  end)
  |> Ecto.Multi.run(:check_revision_base, fn _, %{fetch_tentative: t} ->
    Persistence.verify_revision_base(t)  # 检查 base 还是不是最新
  end)
  |> Ecto.Multi.insert(:create_accepted, fn %{fetch_tentative: t} ->
    Domain.Object.from_tentative(t)
  end)
  |> Ecto.Multi.update(:mark_adopted, fn %{fetch_tentative: t} ->
    Tentative.changeset(t, %{adoption_status: :accepted})
  end)
  |> Ecto.Multi.run(:emit_event, fn _, %{create_accepted: obj} ->
    Phoenix.PubSub.broadcast(
      AINovelStudio.PubSub,
      "workspace:#{workspace_id}:accepted_changed",
      {:accepted_changed, obj}
    )
    {:ok, :emitted}
  end)
  |> Repo.transaction()
end
```

### 3.3 Reading Projection 单独表

ADR-0011 已冻结：

```elixir
schema "reading_projection_root" do
  field :workspace_id, :binary_id
  field :work_id, :binary_id
  field :status, Ecto.Enum, values: [:fresh, :stale, :rebuilding, :failed]
  field :projected_at, :utc_datetime_usec
  field :source_revision_refs, {:array, :map}  # 派生来源
  
  timestamps()
end

schema "reading_projection_toc" do
  belongs_to :root, ReadingProjectionRoot
  field :work_id, :binary_id
  field :entries, {:array, :map}                # 章节结构投影
  
  timestamps()
end

schema "reading_projection_chapter" do
  belongs_to :root, ReadingProjectionRoot
  field :chapter_id, :binary_id
  field :title, :string
  field :content, :string
  field :word_count, :integer
  
  timestamps()
end

schema "reader_recap" do
  belongs_to :root, ReadingProjectionRoot
  field :scope, :string
  field :content, :string
  field :generated_at, :utc_datetime_usec
  
  timestamps()
end
```

---

## 4. Multi-Tenant 隔离（Workspace）

[`00-overview.md`](./00-overview.md) §1 约束 5："多作者 schema 从 day 1"。

### 4.1 全局 query scope

所有查询自动带 `workspace_id` 过滤：

```elixir
defmodule AINovelStudio.Persistence.Repo do
  use Ecto.Repo,
    otp_app: :ai_novel_studio,
    adapter: Ecto.Adapters.SQLite3

  # Override prepare_query/3 to enforce workspace scope
  @impl true
  def prepare_query(_operation, query, opts) do
    if opts[:skip_workspace_scope] || opts[:schema_migration] do
      {query, opts}
    else
      workspace_id = opts[:workspace_id] || raise "workspace_id required"
      {Ecto.Query.where(query, [q], q.workspace_id == ^workspace_id), opts}
    end
  end
end
```

业务代码：

```elixir
# 必须传 workspace_id
Drafts.list(workspace_id: ws_id)

# 显式跳过（极少数场景如 admin / migration）
Drafts.list_all(skip_workspace_scope: true)
```

> **设计状态：骨架，Phase 0 第 2 周必须验证以下边界后再固化**：
>
> - `Repo.preload/2` 的关联 query 是否自动透传 opts？已知 Ecto 在某些路径不透传，需要显式补 `where` 或 `Repo.preload(query, in_query_fn)`。
> - `Ecto.Multi` 内嵌查询的 opts 透传范围。
> - 报错信息（"workspace_id required"）的栈追踪是否能定位到业务代码而不是 framework 内部。
>
> 如果以上任一条不满足，回退到"per-workspace dynamic repo（`Ecto.Repo.put_dynamic_repo`）"或"process dictionary + `with_workspace_scope/2` 包装函数"，并在本节追加 ADR 记录决策。

### 4.2 阶段 2 PostgreSQL Row-Level Security（可选）

阶段 2 可考虑用 PG RLS 作 defense-in-depth：

```sql
ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON drafts
  USING (workspace_id = current_setting('app.workspace_id')::uuid);
```

不强制，因为应用层 query scope 已经够。

---

## 5. Migration 纪律

### 5.1 Migration 来源

Migration **手写**，不依赖 codegen：

```bash
mix ecto.gen.migration add_drafts_table
# 编辑 priv/repo/migrations/20260426120000_add_drafts_table.exs
```

每个 migration 必须：

- 同时支持 SQLite 和 PostgreSQL（用 `Ecto.Migration` 提供的方言中立 API）
- 含 `up/0` 和 `down/0`（双向迁移）
- 测试在两个 adapter 上都跑通

### 5.2 规则

- **加字段**：默认允许（NULL 或有 default）
- **改字段类型**：必须双步（先加新列 + dual-write + 切流量 + 删旧列）
- **删字段**：先 deprecation 一个版本，再删
- **改字段名**：用 `rename`，但 SQLite 老版本不支持，必须先 `add` 新列 + 复制数据 + 删旧列
- **加索引**：CONCURRENTLY（PG）/ 后台（SQLite）

### 5.3 Schema migration 跨 adapter

某些 SQL 在两个 adapter 不同：

```elixir
def change do
  # 中立写法
  create table(:drafts, primary_key: false) do
    add :id, :binary_id, primary_key: true
    add :workspace_id, :binary_id, null: false
    add :content, :text
    timestamps(type: :utc_datetime_usec)
  end
  
  create index(:drafts, [:workspace_id])
  
  # 方言相关：放到 execute/1
  if direction() == :up do
    case repo().__adapter__() do
      Ecto.Adapters.Postgres -> 
        execute("CREATE INDEX drafts_content_fts ON drafts USING GIN (to_tsvector('simple', content))")
      Ecto.Adapters.SQLite3 ->
        execute("CREATE VIRTUAL TABLE drafts_fts USING fts5(content, content=drafts)")
    end
  end
end
```

---

## 6. paper_trail Revision Audit

### 6.1 启用

```elixir
defmodule AINovelStudio.Domain.Drafts do
  use PaperTrail.Schema
  
  schema "drafts" do
    field :workspace_id, :binary_id
    field :content, :text
    # ...
    timestamps()
  end
  
  def changeset(struct, params) do
    struct
    |> cast(params, [:workspace_id, :content])
    |> validate_required([:workspace_id, :content])
  end
end

# Versions table（自动创建）
schema "versions" do
  field :event, :string                # "insert" / "update" / "delete"
  field :item_type, :string            # "Draft"
  field :item_id, :binary_id
  field :item_changes, :map            # jsonb 增量
  field :originator_id, :binary_id     # author_id
  field :origin, :string               # "intent.DRAFT_SCENE" 等
  field :meta, :map
  
  timestamps(updated_at: false)
end
```

### 6.2 写入

```elixir
# 替代 Repo.insert
{:ok, %{model: draft, version: version}} = 
  PaperTrail.insert(changeset, originator: %User{id: author_id}, origin: "intent.DRAFT_SCENE")

# version 自动写入 versions 表
```

### 6.3 与 ADR-0001 source_revision_refs 的关系

> 实测：`paper_trail.versions.id` 是单调递增的 BIGSERIAL/INTEGER，可直接写入 `source_revision_refs.source_revision_id (BIGINT)`。详见 [`verification/paper-trail-ecto-compatibility.md`](./verification/paper-trail-ecto-compatibility.md) §6.2，实测脚本同时在 SQLite 与 PostgreSQL 各跑过 4 条 versions（insert / update / update / delete）。

```elixir
%{
  source_object_type: "draft",
  source_object_id: draft.id,
  source_revision_id: version.id    # paper_trail 的 version.id（BIGINT，单调递增）
}
```

### 6.4 关于 `item_id` 类型与 `:binary_id` 的开放项

§6.1 示例中 `item_id` 写为 `:binary_id`；这只在 paper_trail 显式配置 `config :paper_trail, item_type: Ecto.UUID, originator_type: Ecto.UUID` 且 source schema 使用 binary_id PK 时成立。本仓 spike 验证的是默认 `item_type: :integer + 自增 PK` 组合（业务表 PK 也是 integer）。

Phase 0 必须把这件事补完：

1. 决定 v2 contract 的 ID 策略：业务表整体走 binary_id（UUID）还是 integer？
2. 若选 binary_id，复跑一次 paper_trail spike 并显式配置 `item_type: Ecto.UUID`，验证：
   - SQLite 下 UUID 字符串落 TEXT 字段后能否回查
   - PostgreSQL 下能否复用原生 `uuid` 类型
   - `versions.item_id` 索引选择性是否仍可接受
3. 把验证结论落回到本节。

在结论补全之前，**示例代码里的 `:binary_id` 仅表达意图，不是已实测约束**。

### 6.5 SQLite 阶段的强约束（实测后追加）

- `pool_size: 1`，否则会触发 "database is locked"。
- `journal_mode: :wal`，避免长写阻塞读。
- 写路径必须经统一 helper（封住 paper_trail 的 `repo.transaction(multi)` vs `PaperTrail.Multi.commit/1` 误用差异）。详见 [`03-backend.md`](./03-backend.md) §2.4。

---

## 7. Event Emission

ADR-0011 §9 要求 emit `accepted_draft_changed` 等事件。

### 7.1 阶段 1：进程内 PubSub

```elixir
defmodule AINovelStudio.Persistence.EventEmitter do
  def emit_after_commit(workspace_id, event_name, payload) do
    Phoenix.PubSub.broadcast(
      AINovelStudio.PubSub,
      "workspace:#{workspace_id}:#{event_name}",
      {event_name, payload}
    )
  end
end

# 集成到 Ecto.Multi
Ecto.Multi.run(:emit, fn _, results ->
  EventEmitter.emit_after_commit(ws_id, "accepted_draft_changed", results.draft)
  {:ok, :emitted}
end)
```

### 7.2 阶段 2：跨节点 PubSub

Distributed Erlang 让 `Phoenix.PubSub` 自动跨节点广播，**业务代码 0 改动**。

但是某些场景要求"持久化事件"（不能因为消费者崩溃丢事件）→ 切换到 PostgreSQL `LISTEN/NOTIFY` 或外部 broker（NATS / Kafka）：

```elixir
# 抽象层
defmodule AINovelStudio.EventBus do
  @callback publish(topic, event) :: :ok | {:error, term}
  @callback subscribe(topic) :: :ok
end

defmodule AINovelStudio.EventBus.PubSub do
  @behaviour AINovelStudio.EventBus
  # uses Phoenix.PubSub
end

defmodule AINovelStudio.EventBus.Postgres do
  @behaviour AINovelStudio.EventBus
  # uses LISTEN/NOTIFY
end
```

---

## 8. 备份与恢复

### 8.1 阶段 1（SQLite）

- 备份：复制 `db.sqlite3` 文件 + WAL 文件
- Tauri 内置功能：用户菜单 → 导出备份 → 选择保存位置
- 自动备份：每天 / 每章生成时自动备份到 `~/Library/.../backups/`

### 8.2 阶段 2（PostgreSQL）

- `pg_dump` 定期全量
- WAL archiving + Point-in-Time Recovery
- 跨 region replication（按需）

---

## 9. 关键查询模式

### 9.1 Reading Projection 查询

```elixir
def get_chapter_for_reading(workspace_id, work_id, chapter_id) do
  Repo.one(
    from c in ReadingProjectionChapter,
      join: r in ReadingProjectionRoot, on: c.root_id == r.id,
      where: r.workspace_id == ^workspace_id 
         and r.work_id == ^work_id
         and c.chapter_id == ^chapter_id
         and r.status == :fresh,
      select: c
  )
end
```

### 9.2 Stale projection 检测

```elixir
def find_stale_projections(workspace_id) do
  # 找出所有 status=stale 且 source revisions 与 accepted 不同步的 projection
  Repo.all(
    from r in ReadingProjectionRoot,
      where: r.workspace_id == ^workspace_id and r.status == :stale,
      preload: [:source_objects]
  )
end
```

### 9.3 Adoption pending list

```elixir
def list_pending_adoptions(workspace_id) do
  Repo.all(
    from t in TentativeArtifact,
      where: t.workspace_id == ^workspace_id 
         and t.requires_adoption == true
         and t.adoption_status in [:proposed, :reviewing],
      order_by: [desc: t.inserted_at]
  )
end
```

---

## 10. 当前 TBD

- 阶段 2 PostgreSQL 主备拓扑（单机 vs 主从 vs Patroni 集群）
- 全文检索方案在 SQLite FTS5 vs PostgreSQL tsvector 的具体差异
- 大文本字段是否需要外部对象存储（章节 > 100KB 时）
- jsonb 字段索引策略（GIN vs 局部索引）
- Migration zero-downtime 策略（阶段 2）

以上 TBD 在阶段 2 触发时再决策。
