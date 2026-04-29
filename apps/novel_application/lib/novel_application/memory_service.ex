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

  alias NovelDomain.MemoryItem, as: DomainItem
  alias NovelDomain.NarrativePosition
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.ID
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.MemoryItem, as: SchemaItem

  # ── Create ──

  @doc """
  创建一条新的记忆，返回 Domain MemoryItem。
  """
  @spec create(map()) :: {:ok, DomainItem.t()} | {:error, Ecto.Changeset.t()}
  def create(attrs) when is_map(attrs) do
    id = Map.get(attrs, :id, ID.uuid())

    schema_attrs = %{
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
      source_type: Map.get(attrs, :source_type),
      source_id: Map.get(attrs, :source_id),
      tags: Map.get(attrs, :tags),
      valid_from: Map.get(attrs, :valid_from),
      valid_until: Map.get(attrs, :valid_until),
      expire_condition: Map.get(attrs, :expire_condition),
      locked: Map.get(attrs, :locked, false),
      recallable: Map.get(attrs, :recallable, true),
      common_sense: Map.get(attrs, :common_sense, false),
      weight: Map.get(attrs, :weight, 0.5),
      confidence: Map.get(attrs, :confidence, 0.5),
      source_confidence: Map.get(attrs, :source_confidence, 0.5)
    }

    case %SchemaItem{}
         |> SchemaItem.changeset(schema_attrs)
         |> Repo.insert() do
      {:ok, schema} -> {:ok, to_domain(schema)}
      {:error, changeset} -> {:error, changeset}
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
        {:type, val}, q when not is_nil(val) -> from(m in q, where: m.type == ^val)
        {:scope, val}, q when not is_nil(val) -> from(m in q, where: m.scope == ^val)
        {:status, val}, q when not is_nil(val) -> from(m in q, where: m.status == ^val)
        {:source_type, val}, q when not is_nil(val) -> from(m in q, where: m.source_type == ^val)
        {:locked, val}, q when is_boolean(val) -> from(m in q, where: m.locked == ^val)
        {:recallable, val}, q when is_boolean(val) -> from(m in q, where: m.recallable == ^val)
        {:keyword, val}, q when not is_nil(val) ->
          like = "%#{val}%"
          from(m in q, where: ilike(m.content, ^like) or ilike(m.summary, ^like))
        {:weight_min, val}, q when not is_nil(val) -> from(m in q, where: m.weight >= ^val)
        {:weight_max, val}, q when not is_nil(val) -> from(m in q, where: m.weight <= ^val)
        _, q -> q
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
    with {:ok, schema} <- fetch(id),
         :ok <- ensure_unlocked(schema) do
      {:ok, updated} =
        schema
        |> SchemaItem.update_changeset(%{status: MemoryStatus.confirmed()})
        |> Repo.update()

      {:ok, to_domain(updated)}
    end
  end

  @doc "锁定记忆，代表作者意志。"
  @spec lock(String.t()) :: {:ok, DomainItem.t()} | {:error, :not_found}
  def lock(id) do
    with {:ok, schema} <- fetch(id) do
      {:ok, updated} =
        schema
        |> SchemaItem.update_changeset(%{locked: true})
        |> Repo.update()

      {:ok, to_domain(updated)}
    end
  end

  @doc "解锁记忆。"
  @spec unlock(String.t()) :: {:ok, DomainItem.t()} | {:error, :not_found}
  def unlock(id) do
    with {:ok, schema} <- fetch(id) do
      {:ok, updated} =
        schema
        |> SchemaItem.update_changeset(%{locked: false})
        |> Repo.update()

      {:ok, to_domain(updated)}
    end
  end

  @doc "废弃记忆，自动设为不可召回。"
  @spec deprecate(String.t()) :: {:ok, DomainItem.t()} | {:error, :not_found} | {:error, :locked}
  def deprecate(id) do
    with {:ok, schema} <- fetch(id),
         :ok <- ensure_unlocked(schema) do
      {:ok, updated} =
        schema
        |> SchemaItem.update_changeset(%{status: MemoryStatus.deprecated(), recallable: false})
        |> Repo.update()

      {:ok, to_domain(updated)}
    end
  end

  @doc "归档记忆，自动设为不可召回。"
  @spec archive(String.t()) :: {:ok, DomainItem.t()} | {:error, :not_found} | {:error, :locked}
  def archive(id) do
    with {:ok, schema} <- fetch(id),
         :ok <- ensure_unlocked(schema) do
      {:ok, updated} =
        schema
        |> SchemaItem.update_changeset(%{status: MemoryStatus.archived(), recallable: false})
        |> Repo.update()

      {:ok, to_domain(updated)}
    end
  end

  # ── Field updates ──

  @doc "更新权重。locked 记忆不允许修改。"
  @spec update_weight(String.t(), float()) :: {:ok, DomainItem.t()} | {:error, :not_found} | {:error, :locked}
  def update_weight(id, weight) when is_float(weight) do
    with {:ok, schema} <- fetch(id),
         :ok <- ensure_unlocked(schema) do
      {:ok, updated} =
        schema
        |> SchemaItem.update_changeset(%{weight: weight})
        |> Repo.update()

      {:ok, to_domain(updated)}
    end
  end

  @doc "更新有效期。"
  @spec update_validity(String.t(), map() | nil, map() | nil, String.t() | nil) ::
          {:ok, DomainItem.t()} | {:error, :not_found} | {:error, :locked}
  def update_validity(id, valid_from, valid_until, expire_condition \\ nil) do
    with {:ok, schema} <- fetch(id),
         :ok <- ensure_unlocked(schema) do
      {:ok, updated} =
        schema
        |> SchemaItem.update_changeset(%{
          valid_from: valid_from,
          valid_until: valid_until,
          expire_condition: expire_condition
        })
        |> Repo.update()

      {:ok, to_domain(updated)}
    end
  end

  @doc "更新召回开关。"
  @spec update_recallable(String.t(), boolean()) :: {:ok, DomainItem.t()} | {:error, :not_found}
  def update_recallable(id, recallable) when is_boolean(recallable) do
    with {:ok, schema} <- fetch(id) do
      {:ok, updated} =
        schema
        |> SchemaItem.update_changeset(%{recallable: recallable})
        |> Repo.update()

      {:ok, to_domain(updated)}
    end
  end

  # ── Private helpers ──

  defp fetch(id) do
    case Repo.get(SchemaItem, id) do
      nil -> {:error, :not_found}
      schema -> {:ok, schema}
    end
  end

  defp ensure_unlocked(%{locked: true}), do: {:error, :locked}
  defp ensure_unlocked(_), do: :ok

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
