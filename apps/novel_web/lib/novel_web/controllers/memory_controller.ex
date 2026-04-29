defmodule NovelWeb.MemoryController do
  use Phoenix.Controller, formats: [:json]

  alias NovelApplication.MemoryService
  alias NovelApplication.MemoryRecallService
  alias NovelPersistence.MemoryReferenceLog

  @doc "POST /api/works/:work_id/memories — 创建记忆"
  def create(conn, %{"work_id" => work_id} = params) do
    attrs = params |> Map.take(["content", "summary", "type", "scope", "source_type",
                                 "weight", "confidence", "locked", "recallable", "tags",
                                 "volume_id", "arc_id", "chapter_id", "source_id"])
    |> map_keys_to_atoms()
    |> Map.put(:work_id, work_id)

    case MemoryService.create(attrs) do
      {:ok, item} -> json(conn, %{data: to_map(item), ok: true})
      {:error, cs} -> json(conn, %{error: format_errors(cs), ok: false})
    end
  end

  @doc "GET /api/works/:work_id/memories — 搜索记忆"
  def index(conn, %{"work_id" => work_id} = params) do
    opts = [work_id: work_id]
    |> optional_param(params, "type")
    |> optional_param(params, "scope")
    |> optional_param(params, "status")
    |> optional_param(params, "source_type")
    |> optional_bool(params, "locked")
    |> optional_bool(params, "recallable")
    |> optional_param(params, "keyword")
    |> optional_float(params, "weight_min")
    |> optional_float(params, "weight_max")
    |> optional_param(params, "sort_by", :updated_at)
    |> optional_param(params, "sort_dir", :desc)
    |> optional_int(params, "limit", 50)
    |> optional_int(params, "offset", 0)

    items = MemoryService.search(opts)
    json(conn, %{data: Enum.map(items, &to_map/1), count: length(items), ok: true})
  end

  @doc "GET /api/works/:work_id/memories/:memory_id — 获取记忆详情"
  def show(conn, %{"memory_id" => id}) do
    case MemoryService.get(id) do
      {:ok, item} -> json(conn, %{data: to_map(item), ok: true})
      {:error, :not_found} -> json(conn, %{error: "not_found", ok: false})
    end
  end

  @doc "POST /api/works/:work_id/memories/:memory_id/confirm"
  def confirm(conn, %{"memory_id" => id}) do
    case MemoryService.confirm(id) do
      {:ok, item} -> json(conn, %{data: to_map(item), ok: true})
      {:error, reason} -> json(conn, %{error: to_string(reason), ok: false})
    end
  end

  @doc "POST /api/works/:work_id/memories/:memory_id/lock"
  def lock(conn, %{"memory_id" => id}) do
    case MemoryService.lock(id) do
      {:ok, item} -> json(conn, %{data: to_map(item), ok: true})
      {:error, reason} -> json(conn, %{error: to_string(reason), ok: false})
    end
  end

  @doc "POST /api/works/:work_id/memories/:memory_id/unlock"
  def unlock(conn, %{"memory_id" => id}) do
    case MemoryService.unlock(id) do
      {:ok, item} -> json(conn, %{data: to_map(item), ok: true})
      {:error, reason} -> json(conn, %{error: to_string(reason), ok: false})
    end
  end

  @doc "POST /api/works/:work_id/memories/:memory_id/deprecate"
  def deprecate(conn, %{"memory_id" => id}) do
    case MemoryService.deprecate(id) do
      {:ok, item} -> json(conn, %{data: to_map(item), ok: true})
      {:error, reason} -> json(conn, %{error: to_string(reason), ok: false})
    end
  end

  @doc "POST /api/works/:work_id/memories/:memory_id/archive"
  def archive(conn, %{"memory_id" => id}) do
    case MemoryService.archive(id) do
      {:ok, item} -> json(conn, %{data: to_map(item), ok: true})
      {:error, reason} -> json(conn, %{error: to_string(reason), ok: false})
    end
  end

  @doc "PATCH /api/works/:work_id/memories/:memory_id/weight"
  def update_weight(conn, %{"memory_id" => id, "weight" => weight}) do
    case MemoryService.update_weight(id, weight |> parse_float) do
      {:ok, item} -> json(conn, %{data: to_map(item), ok: true})
      {:error, reason} -> json(conn, %{error: to_string(reason), ok: false})
    end
  end

  @doc "PATCH /api/works/:work_id/memories/:memory_id/validity"
  def update_validity(conn, %{"memory_id" => id} = params) do
    case MemoryService.update_validity(id, params["valid_from"], params["valid_until"], params["expire_condition"]) do
      {:ok, item} -> json(conn, %{data: to_map(item), ok: true})
      {:error, reason} -> json(conn, %{error: to_string(reason), ok: false})
    end
  end

  @doc "POST /api/works/:work_id/memories/recall — 召回记忆"
  def recall(conn, %{"work_id" => work_id} = params) do
    result = MemoryRecallService.recall(work_id,
      query: Map.get(params, "query", ""),
      scene: Map.get(params, "scene", "api_recall"),
      token_budget: parse_int(params["token_budget"], 3000),
      scope: params["scope"],
      prefer_types: parse_string_list(params["prefer_types"])
    )

    json(conn, %{
      data: %{
        text: result.text,
        iron_law_count: result.iron_law_count,
        candidate_count: result.candidate_count,
        estimated_tokens: result.estimated_tokens
      },
      ok: true
    })
  end

  @doc "GET /api/works/:work_id/memories/:memory_id/references — 查看引用记录"
  def references(conn, %{"memory_id" => id}) do
    logs = MemoryReferenceLog.by_memory(id) |> Enum.map(&ref_log_to_map/1)
    json(conn, %{data: logs, count: length(logs), ok: true})
  end

  # ── private ──

  defp map_keys_to_atoms(map) do
    Map.new(map, fn {k, v} -> {String.to_atom(k), v} end)
  end

  defp optional_param(opts, params, key, _default \\ nil) do
    case Map.get(params, key) do
      nil -> opts
      val -> Keyword.put(opts, String.to_atom(key), val)
    end
  end

  defp optional_bool(opts, params, key) do
    case Map.get(params, key) do
      nil -> opts
      "true" -> Keyword.put(opts, String.to_atom(key), true)
      "false" -> Keyword.put(opts, String.to_atom(key), false)
      val when is_boolean(val) -> Keyword.put(opts, String.to_atom(key), val)
      _ -> opts
    end
  end

  defp optional_float(opts, params, key) do
    case Map.get(params, key) do
      nil -> opts
      val -> Keyword.put(opts, String.to_atom(key), parse_float(val))
    end
  end

  defp optional_int(opts, params, key, default) do
    val = Map.get(params, key)
    opts = Keyword.put(opts, String.to_atom(key), parse_int(val, default))
    opts
  end

  defp parse_float(val) when is_number(val), do: val / 1
  defp parse_float(val) when is_binary(val) do
    case Float.parse(val) do
      {f, _} -> f
      :error -> 0.5
    end
  end
  defp parse_float(_), do: 0.5

  defp parse_int(val, default) do
    cond do
      is_integer(val) -> val
      is_binary(val) ->
        case Integer.parse(val) do
          {i, _} -> i
          :error -> default
        end
      true -> default
    end
  end

  defp parse_string_list(nil), do: []
  defp parse_string_list(val) when is_list(val), do: val
  defp parse_string_list(val) when is_binary(val), do: String.split(val, ",") |> Enum.map(&String.trim/1)

  defp format_errors(%Ecto.Changeset{} = cs) do
    Ecto.Changeset.traverse_errors(cs, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", to_string(value))
      end)
    end)
  end

  defp to_map(%NovelDomain.MemoryItem{} = item) do
    %{
      id: item.id,
      work_id: item.work_id,
      volume_id: item.volume_id,
      arc_id: item.arc_id,
      chapter_id: item.chapter_id,
      content: item.content,
      summary: item.summary,
      type: item.type,
      scope: item.scope,
      status: item.status,
      source_type: item.source_type,
      source_id: item.source_id,
      reference_count: item.reference_count,
      weight: item.weight,
      confidence: item.confidence,
      source_confidence: item.source_confidence,
      locked: item.locked,
      recallable: item.recallable,
      common_sense: item.common_sense,
      valid_from: item.valid_from && to_np_map(item.valid_from),
      valid_until: item.valid_until && to_np_map(item.valid_until),
      expire_condition: item.expire_condition,
      version: item.version,
      tags: item.tags,
      last_referenced_at: item.last_referenced_at && DateTime.to_iso8601(item.last_referenced_at),
      created_at: item.created_at && DateTime.to_iso8601(item.created_at),
      updated_at: item.updated_at && DateTime.to_iso8601(item.updated_at)
    }
  end

  defp ref_log_to_map(log) do
    %{
      id: serialize_id(log.id),
      memory_id: serialize_id(log.memory_id),
      work_id: serialize_id(log.work_id),
      task_id: serialize_id(log.task_id),
      conversation_id: serialize_id(log.conversation_id),
      reference_scene: log.reference_scene,
      reference_reason: log.reference_reason,
      inserted_at: serialize_datetime(log.inserted_at)
    }
  end

  defp serialize_id(nil), do: nil
  defp serialize_id(id) when is_binary(id) do
    if String.valid?(id) and not String.contains?(id, "\0") do
      id
    else
      case Ecto.UUID.load(id) do
        {:ok, str} -> str
        :error -> Base.encode16(id, case: :lower)
      end
    end
  end

  defp serialize_datetime(nil), do: nil
  defp serialize_datetime(%DateTime{} = dt), do: DateTime.to_iso8601(dt)
  defp serialize_datetime(%NaiveDateTime{} = ndt), do: NaiveDateTime.to_iso8601(ndt)

  defp to_np_map(%NovelDomain.NarrativePosition{} = np) do
    %{
      work_id: np.work_id,
      volume_id: np.volume_id,
      arc_id: np.arc_id,
      chapter_id: np.chapter_id,
      scene_index: np.scene_index,
      narrative_layer: np.narrative_layer,
      timeline_node_id: np.timeline_node_id
    }
  end
end
