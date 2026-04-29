defmodule NovelApplication.MemoryService do
  @moduledoc """
  记忆管理用例编排 —— CRUD + 查询 + 治理操作。

  MemoryService 是 Governed Memory 层的应用入口。它负责：
  - 将领域层调用转换为持久化操作
  - 执行 locked 冲突检查
  - 返回 NovelDomain.MemoryItem struct

  ## ADR refs
  - 05-memory-retention-and-retrieval.md §8.1 — MemoryItem 字段设计
  - 05-memory-retention-and-retrieval.md §3.5 — locked 代表人类意志
  """

  import Ecto.Query, only: [from: 2, limit: 2, offset: 2]

  alias NovelAgent.Orchestrator
  alias NovelDomain.MemoryItem, as: DomainItem
  alias NovelDomain.NarrativePosition
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.ID
  alias NovelPersistence.MemoryReferenceLog
  alias NovelPersistence.MutationLog
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.MemoryItem, as: SchemaItem

  @recallable_statuses [
    MemoryStatus.draft(),
    MemoryStatus.confirmed(),
    MemoryStatus.stabilized()
  ]

  @lockable_statuses [
    MemoryStatus.confirmed(),
    MemoryStatus.stabilized()
  ]

  @terminal_statuses [
    MemoryStatus.deprecated(),
    MemoryStatus.archived()
  ]

  @source_defaults %{
    MemorySourceType.author_confirmed() => %{
      weight: 0.95,
      confidence: 0.95,
      source_confidence: 0.95
    },
    MemorySourceType.author_created() => %{
      weight: 0.85,
      confidence: 0.90,
      source_confidence: 0.90
    },
    MemorySourceType.work_setting_imported() => %{
      weight: 0.80,
      confidence: 0.80,
      source_confidence: 0.80
    },
    MemorySourceType.chapter_extracted() => %{
      weight: 0.60,
      confidence: 0.60,
      source_confidence: 0.60
    },
    MemorySourceType.ai_extracted() => %{weight: 0.45, confidence: 0.45, source_confidence: 0.45},
    MemorySourceType.session_context() => %{
      weight: 0.30,
      confidence: 0.40,
      source_confidence: 0.40
    }
  }

  # ── Create ──

  @doc """
  创建一条新的记忆，返回 Domain MemoryItem。
  """
  @spec create(map()) :: {:ok, DomainItem.t()} | {:error, Ecto.Changeset.t()}
  def create(attrs) when is_map(attrs) do
    id = Map.get(attrs, :id, ID.uuid())
    source_type = Map.get(attrs, :source_type)
    defaults = source_defaults(source_type)

    schema_attrs =
      %{
        id: id,
        work_id: Map.get(attrs, :work_id),
        volume_id: Map.get(attrs, :volume_id),
        arc_id: Map.get(attrs, :arc_id),
        chapter_id: Map.get(attrs, :chapter_id),
        content: Map.get(attrs, :content),
        summary: Map.get(attrs, :summary),
        type: Map.get(attrs, :type),
        scope: Map.get(attrs, :scope),
        status: Map.get(attrs, :status, MemoryStatus.draft()),
        source_type: source_type,
        source_id: Map.get(attrs, :source_id),
        tags: Map.get(attrs, :tags),
        valid_from: Map.get(attrs, :valid_from),
        valid_until: Map.get(attrs, :valid_until),
        expire_condition: Map.get(attrs, :expire_condition),
        locked: Map.get(attrs, :locked, false),
        recallable: Map.get(attrs, :recallable, true),
        common_sense: Map.get(attrs, :common_sense, false),
        weight: Map.get(attrs, :weight, defaults.weight),
        confidence: Map.get(attrs, :confidence, defaults.confidence),
        source_confidence: Map.get(attrs, :source_confidence, defaults.source_confidence)
      }
      |> normalize_locked()

    Repo.transaction(fn ->
      case %SchemaItem{}
           |> SchemaItem.changeset(schema_attrs)
           |> validate_locked_status()
           |> Repo.insert() do
        {:ok, schema} ->
          case record_applied_mutation(schema, "memory.create", 1, attrs) do
            {:ok, _mutation} -> schema
            {:error, reason} -> Repo.rollback(reason)
          end

        {:error, changeset} ->
          Repo.rollback(changeset)
      end
    end)
    |> case do
      {:ok, schema} -> {:ok, to_domain(schema)}
      {:error, reason} -> {:error, reason}
    end
  end

  # ── Read ──

  @doc "按 ID 获取单条记忆。"
  @spec get(String.t()) :: {:ok, DomainItem.t()} | {:error, :not_found}
  def get(id) when is_binary(id) do
    case Repo.get(SchemaItem, id) do
      nil -> {:error, :not_found}
      schema -> {:ok, to_domain(schema)}
    end
  end

  @doc "按作品 ID 和记忆 ID 获取单条记忆。"
  @spec get(String.t(), String.t()) :: {:ok, DomainItem.t()} | {:error, :not_found}
  def get(work_id, id) when is_binary(work_id) and is_binary(id) do
    case fetch(work_id, id) do
      {:ok, schema} -> {:ok, to_domain(schema)}
      {:error, :not_found} -> {:error, :not_found}
    end
  end

  @doc """
  搜索记忆，支持多条件筛选和排序。

  筛选条件（均为可选）：
  - work_id (必填)
  - type, scope, status, source_type
  - locked, recallable
  - keyword (content LIKE)
  - weight_min, weight_max
  - sort_by (:weight, :confidence, :updated_at, :inserted_at)
  - sort_dir (:asc, :desc)
  - limit, offset
  """
  @spec search(keyword()) :: [DomainItem.t()]
  def search(opts \\ []) do
    work_id = Keyword.fetch!(opts, :work_id)

    base =
      from(m in SchemaItem,
        where: m.work_id == ^work_id,
        select: m
      )

    base =
      Enum.reduce(opts, base, fn
        {:type, val}, q when not is_nil(val) ->
          from(m in q, where: m.type == ^val)

        {:scope, val}, q when not is_nil(val) ->
          from(m in q, where: m.scope == ^val)

        {:status, val}, q when not is_nil(val) ->
          from(m in q, where: m.status == ^val)

        {:source_type, val}, q when not is_nil(val) ->
          from(m in q, where: m.source_type == ^val)

        {:locked, val}, q when is_boolean(val) ->
          from(m in q, where: m.locked == ^val)

        {:recallable, val}, q when is_boolean(val) ->
          from(m in q, where: m.recallable == ^val)

        {:recallable_statuses, vals}, q when is_list(vals) ->
          from(m in q, where: m.status in ^vals)

        {:valid_at, val}, q when not is_nil(val) ->
          apply_valid_at_filter(q, val)

        {:keyword, val}, q when not is_nil(val) ->
          like = "%#{val}%"
          from(m in q, where: ilike(m.content, ^like) or ilike(m.summary, ^like))

        {:weight_min, val}, q when not is_nil(val) ->
          from(m in q, where: m.weight >= ^val)

        {:weight_max, val}, q when not is_nil(val) ->
          from(m in q, where: m.weight <= ^val)

        _, q ->
          q
      end)

    base = apply_sort(base, opts)
    base = apply_pagination(base, opts)

    base
    |> Repo.all()
    |> Enum.map(&to_domain/1)
  end

  defp apply_sort(q, opts) do
    dir = Keyword.get(opts, :sort_dir, :desc)
    sort_field = Keyword.get(opts, :sort_by, :updated_at)

    from(m in q, order_by: [{^dir, field(m, ^sort_field)}])
  end

  defp apply_pagination(q, opts) do
    lim = Keyword.get(opts, :limit, 50)
    off = Keyword.get(opts, :offset, 0)
    q |> limit(^lim) |> offset(^off)
  end

  # ── Status transitions ──

  @doc "确认记忆，状态 DRAFT/CONFLICTED → CONFIRMED。"
  @spec confirm(String.t()) :: {:ok, DomainItem.t()} | {:error, :not_found} | {:error, :locked}
  def confirm(id) do
    with {:ok, schema} <- fetch(id) do
      confirm_schema(schema)
    end
  end

  @doc "在指定作品内确认记忆。"
  @spec confirm(String.t(), String.t()) ::
          {:ok, DomainItem.t()} | {:error, :not_found} | {:error, :locked}
  def confirm(work_id, id) do
    with {:ok, schema} <- fetch(work_id, id) do
      confirm_schema(schema)
    end
  end

  @doc "锁定记忆，代表作者意志。"
  @spec lock(String.t()) :: {:ok, DomainItem.t()} | {:error, :not_found}
  def lock(id) do
    with {:ok, schema} <- fetch(id) do
      lock_schema(schema)
    end
  end

  @doc "在指定作品内锁定记忆。"
  @spec lock(String.t(), String.t()) :: {:ok, DomainItem.t()} | {:error, :not_found}
  def lock(work_id, id) do
    with {:ok, schema} <- fetch(work_id, id) do
      lock_schema(schema)
    end
  end

  @doc "解锁记忆。"
  @spec unlock(String.t()) :: {:ok, DomainItem.t()} | {:error, :not_found}
  def unlock(id) do
    with {:ok, schema} <- fetch(id) do
      unlock_schema(schema)
    end
  end

  @doc "在指定作品内解锁记忆。"
  @spec unlock(String.t(), String.t()) :: {:ok, DomainItem.t()} | {:error, :not_found}
  def unlock(work_id, id) do
    with {:ok, schema} <- fetch(work_id, id) do
      unlock_schema(schema)
    end
  end

  @doc "废弃记忆，自动设为不可召回。"
  @spec deprecate(String.t()) :: {:ok, DomainItem.t()} | {:error, :not_found} | {:error, :locked}
  def deprecate(id) do
    with {:ok, schema} <- fetch(id) do
      deprecate_schema(schema)
    end
  end

  @doc "在指定作品内废弃记忆。"
  @spec deprecate(String.t(), String.t()) ::
          {:ok, DomainItem.t()} | {:error, :not_found} | {:error, :locked}
  def deprecate(work_id, id) do
    with {:ok, schema} <- fetch(work_id, id) do
      deprecate_schema(schema)
    end
  end

  @doc "归档记忆，自动设为不可召回。"
  @spec archive(String.t()) :: {:ok, DomainItem.t()} | {:error, :not_found} | {:error, :locked}
  def archive(id) do
    with {:ok, schema} <- fetch(id) do
      archive_schema(schema)
    end
  end

  @doc "在指定作品内归档记忆。"
  @spec archive(String.t(), String.t()) ::
          {:ok, DomainItem.t()} | {:error, :not_found} | {:error, :locked}
  def archive(work_id, id) do
    with {:ok, schema} <- fetch(work_id, id) do
      archive_schema(schema)
    end
  end

  # ── Field updates ──

  @doc "更新权重。locked 记忆不允许修改。"
  @spec update_weight(String.t(), float()) ::
          {:ok, DomainItem.t()}
          | {:error, :not_found}
          | {:error, :locked}
          | {:error, Ecto.Changeset.t()}
  def update_weight(id, weight) when is_float(weight) do
    with {:ok, schema} <- fetch(id) do
      update_weight_schema(schema, weight)
    end
  end

  @doc "在指定作品内更新权重。locked 记忆不允许修改。"
  @spec update_weight(String.t(), String.t(), float()) ::
          {:ok, DomainItem.t()}
          | {:error, :not_found}
          | {:error, :locked}
          | {:error, Ecto.Changeset.t()}
  def update_weight(work_id, id, weight) when is_float(weight) do
    with {:ok, schema} <- fetch(work_id, id) do
      update_weight_schema(schema, weight)
    end
  end

  @doc "更新有效期。"
  @spec update_validity(String.t(), map() | nil, map() | nil, String.t() | nil) ::
          {:ok, DomainItem.t()} | {:error, :not_found} | {:error, :locked}
  def update_validity(id, valid_from, valid_until, expire_condition \\ nil) do
    with {:ok, schema} <- fetch(id) do
      update_validity_schema(schema, valid_from, valid_until, expire_condition)
    end
  end

  @doc "在指定作品内更新有效期。"
  @spec update_validity(String.t(), String.t(), map() | nil, map() | nil, String.t() | nil) ::
          {:ok, DomainItem.t()} | {:error, :not_found} | {:error, :locked}
  def update_validity(work_id, id, valid_from, valid_until, expire_condition) do
    with {:ok, schema} <- fetch(work_id, id) do
      update_validity_schema(schema, valid_from, valid_until, expire_condition)
    end
  end

  @doc "更新召回开关。"
  @spec update_recallable(String.t(), boolean()) :: {:ok, DomainItem.t()} | {:error, :not_found}
  def update_recallable(id, recallable) when is_boolean(recallable) do
    with {:ok, schema} <- fetch(id) do
      update_schema_with_mutation(schema, %{recallable: recallable}, "memory.update_recallable")
    end
  end

  @doc "列出指定作品内某条记忆的引用记录。"
  @spec list_references(String.t(), String.t()) :: {:ok, [map()]} | {:error, :not_found}
  def list_references(work_id, id) when is_binary(work_id) and is_binary(id) do
    with {:ok, _schema} <- fetch(work_id, id) do
      {:ok, MemoryReferenceLog.by_memory(id)}
    end
  end

  @doc "写入记忆引用记录。"
  @spec write_reference(map()) :: {:ok, map()}
  def write_reference(attrs) when is_map(attrs), do: MemoryReferenceLog.write(attrs)

  @doc "写入记忆引用记录，并回写引用计数。"
  @spec record_references([map()]) :: {:ok, non_neg_integer()} | {:error, term()}
  def record_references([]), do: {:ok, 0}

  def record_references(entries) when is_list(entries) do
    now = DateTime.utc_now()

    Repo.transaction(fn ->
      {:ok, count} = MemoryReferenceLog.batch_write(entries)

      ids =
        entries
        |> Enum.map(& &1.memory_id)
        |> Enum.uniq()

      from(m in SchemaItem, where: m.id in ^ids)
      |> Repo.update_all(
        inc: [reference_count: 1],
        set: [last_referenced_at: now, updated_at: now]
      )

      count
    end)
    |> case do
      {:ok, count} -> {:ok, count}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc "普通召回允许的状态。"
  @spec recallable_statuses() :: [String.t()]
  def recallable_statuses, do: @recallable_statuses

  # ── Private helpers ──

  defp fetch(id) do
    case Repo.get(SchemaItem, id) do
      nil -> {:error, :not_found}
      schema -> {:ok, schema}
    end
  end

  defp fetch(work_id, id) do
    case Repo.get_by(SchemaItem, id: id, work_id: work_id) do
      nil -> {:error, :not_found}
      schema -> {:ok, schema}
    end
  end

  defp confirm_schema(schema) do
    with :ok <- ensure_unlocked(schema),
         {:ok, updated} <-
           update_schema_with_mutation(schema, %{status: MemoryStatus.confirmed()}, "memory.confirm") do
      {:ok, updated}
    end
  end

  defp lock_schema(schema) do
    with :ok <- ensure_lockable(schema),
         {:ok, updated} <-
           update_schema_with_mutation(schema, %{locked: true}, "memory.lock") do
      {:ok, updated}
    end
  end

  defp unlock_schema(schema) do
    with {:ok, updated} <-
           update_schema_with_mutation(schema, %{locked: false}, "memory.unlock") do
      {:ok, updated}
    end
  end

  defp deprecate_schema(schema) do
    with :ok <- ensure_unlocked(schema),
         {:ok, updated} <-
           update_schema_with_mutation(
             schema,
             %{
               status: MemoryStatus.deprecated(),
               recallable: false
             },
             "memory.deprecate"
           ) do
      {:ok, updated}
    end
  end

  defp archive_schema(schema) do
    with :ok <- ensure_unlocked(schema),
         {:ok, updated} <-
           update_schema_with_mutation(
             schema,
             %{
               status: MemoryStatus.archived(),
               recallable: false
             },
             "memory.archive"
           ) do
      {:ok, updated}
    end
  end

  defp update_weight_schema(schema, weight) do
    with :ok <- ensure_unlocked(schema),
         {:ok, updated} <-
           update_schema_with_mutation(schema, %{weight: weight}, "memory.update_weight") do
      {:ok, updated}
    end
  end

  defp update_validity_schema(schema, valid_from, valid_until, expire_condition) do
    with :ok <- ensure_unlocked(schema),
         {:ok, updated} <-
           update_schema_with_mutation(
             schema,
             %{
               valid_from: valid_from,
               valid_until: valid_until,
               expire_condition: expire_condition
             },
             "memory.update_validity"
           ) do
      {:ok, updated}
    end
  end

  defp update_schema_with_mutation(schema, changes, mutation_type, audit_attrs \\ %{}) do
    base_revision = schema.version || 1
    changes = Map.put(changes, :version, base_revision + 1)

    Repo.transaction(fn ->
      case schema
           |> SchemaItem.update_changeset(changes)
           |> Repo.update() do
        {:ok, updated} ->
          case record_applied_mutation(updated, mutation_type, base_revision, audit_attrs) do
            {:ok, _mutation} -> updated
            {:error, reason} -> Repo.rollback(reason)
          end

        {:error, changeset} ->
          Repo.rollback(changeset)
      end
    end)
    |> case do
      {:ok, updated} -> {:ok, to_domain(updated)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp record_applied_mutation(schema, mutation_type, base_revision, audit_attrs) do
    MutationLog.create_applied(%{
      actor_ref: audit_value(audit_attrs, :actor_ref, "system"),
      source_turn_ref: audit_value(audit_attrs, :source_turn_ref) || Orchestrator.allocate_turn_id(),
      source_task_ref: audit_value(audit_attrs, :source_task_ref),
      target_scope: audit_value(audit_attrs, :target_scope, "memory_item"),
      target_object_ref: schema.id,
      base_revision: base_revision,
      mutation_type: mutation_type,
      authority_scope: audit_value(audit_attrs, :authority_scope, "production_write"),
      requires_adoption: false
    })
  end

  defp audit_value(attrs, key, default \\ nil) do
    Map.get(attrs, key) || Map.get(attrs, Atom.to_string(key)) || default
  end

  defp ensure_unlocked(%{locked: true}), do: {:error, :locked}
  defp ensure_unlocked(_), do: :ok

  defp ensure_lockable(%{status: status}) when status in @lockable_statuses, do: :ok
  defp ensure_lockable(_), do: {:error, :invalid_status}

  defp apply_valid_at_filter(q, %{chapter_id: chapter_id}) when is_binary(chapter_id) do
    from(m in q,
      where:
        is_nil(m.valid_until) or
          fragment("?->>'chapter_id' IS NULL", m.valid_until) or
          fragment("?->>'chapter_id' = ?", m.valid_until, ^chapter_id)
    )
  end

  defp apply_valid_at_filter(q, %{scene_index: scene_index}) when is_integer(scene_index) do
    from(m in q,
      where:
        is_nil(m.valid_until) or
          fragment("?->>'scene_index' IS NULL", m.valid_until) or
          fragment("(?->>'scene_index')::int >= ?", m.valid_until, ^scene_index)
    )
  end

  defp apply_valid_at_filter(q, _), do: from(m in q, where: is_nil(m.valid_until))

  defp source_defaults(source_type) do
    Map.get(@source_defaults, source_type, %{weight: 0.5, confidence: 0.5, source_confidence: 0.5})
  end

  defp normalize_locked(%{status: status} = attrs) when status in @terminal_statuses do
    Map.put(attrs, :locked, false)
  end

  defp normalize_locked(attrs), do: attrs

  defp validate_locked_status(changeset) do
    locked = Ecto.Changeset.get_field(changeset, :locked)
    status = Ecto.Changeset.get_field(changeset, :status)

    if locked and status not in @lockable_statuses do
      Ecto.Changeset.add_error(
        changeset,
        :locked,
        "is only allowed for CONFIRMED or STABILIZED memories"
      )
    else
      changeset
    end
  end

  # ── Schema → Domain mapping ──

  defp to_domain(schema) do
    %DomainItem{
      id: schema.id,
      work_id: schema.work_id,
      volume_id: schema.volume_id,
      arc_id: schema.arc_id,
      chapter_id: schema.chapter_id,
      content: schema.content,
      summary: schema.summary,
      type: schema.type,
      scope: schema.scope,
      status: schema.status,
      source_type: schema.source_type,
      source_id: schema.source_id,
      reference_count: schema.reference_count,
      weight: to_float(schema.weight),
      confidence: to_float(schema.confidence),
      source_confidence: to_float(schema.source_confidence),
      locked: schema.locked,
      recallable: schema.recallable,
      common_sense: schema.common_sense,
      valid_from: to_narrative_position(schema.valid_from),
      valid_until: to_narrative_position(schema.valid_until),
      expire_condition: schema.expire_condition,
      version: schema.version,
      tags: schema.tags,
      last_referenced_at: schema.last_referenced_at,
      created_at: schema.inserted_at,
      updated_at: schema.updated_at
    }
  end

  defp to_float(nil), do: 0.5
  defp to_float(d), do: Decimal.to_float(d)

  defp to_narrative_position(nil), do: nil

  defp to_narrative_position(%{} = attrs) when is_map(attrs) do
    %NarrativePosition{
      work_id: attrs["work_id"],
      volume_id: attrs["volume_id"],
      arc_id: attrs["arc_id"],
      chapter_id: attrs["chapter_id"],
      scene_index: attrs["scene_index"],
      narrative_layer: attrs["narrative_layer"],
      timeline_node_id: attrs["timeline_node_id"]
    }
  end

  defp to_narrative_position(%NarrativePosition{} = pos), do: pos
end
