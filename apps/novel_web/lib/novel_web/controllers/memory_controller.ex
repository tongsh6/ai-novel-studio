defmodule NovelWeb.MemoryController do
  use Phoenix.Controller, formats: [:json]

  alias NovelApplication.MemoryService
  alias NovelApplication.MemoryRecallService

  @doc "POST /api/works/:work_id/memories — 创建记忆"
  def create(conn, %{"work_id" => work_id} = params) do
    attrs =
      params
      |> Map.take([
        "content",
        "summary",
        "type",
        "scope",
        "source_type",
        "weight",
        "confidence",
        "locked",
        "recallable",
        "tags",
        "volume_id",
        "arc_id",
        "chapter_id",
        "source_id"
      ])
      |> map_keys_to_atoms()
      |> Map.put(:work_id, work_id)

    case MemoryService.create(attrs) do
      {:ok, item} -> json(conn, %{data: to_map(item), ok: true})
      {:error, cs} -> json(conn, %{error: format_errors(cs), ok: false})
    end
  end

  @doc "GET /api/works/:work_id/memories — 搜索记忆"
  def index(conn, %{"work_id" => work_id} = params) do
    opts =
      [work_id: work_id]
      |> optional_param(params, "type")
      |> optional_param(params, "scope")
      |> optional_param(params, "status")
      |> optional_param(params, "source_type")
      |> optional_bool(params, "locked")
      |> optional_bool(params, "recallable")
      |> optional_param(params, "keyword")
      |> optional_float(params, "weight_min")
      |> optional_float(params, "weight_max")
      |> optional_sort_by(params)
      |> optional_sort_dir(params)
      |> optional_int(params, "limit", 50)
      |> optional_int(params, "offset", 0)

    items = MemoryService.search(opts)
    json(conn, %{data: Enum.map(items, &to_map/1), count: length(items), ok: true})
  end

  @doc "GET /api/works/:work_id/memories/:memory_id — 获取记忆详情"
  def show(conn, %{"work_id" => work_id, "memory_id" => id}) do
    case MemoryService.get(work_id, id) do
      {:ok, item} -> json(conn, %{data: to_map(item), ok: true})
      {:error, :not_found} -> json(conn, %{error: "not_found", ok: false})
    end
  end

  @doc "POST /api/works/:work_id/memories/:memory_id/confirm"
  def confirm(conn, %{"work_id" => work_id, "memory_id" => id}) do
    case MemoryService.confirm(work_id, id) do
      {:ok, item} -> json(conn, %{data: to_map(item), ok: true})
      {:error, reason} -> json(conn, %{error: format_error(reason), ok: false})
    end
  end

  @doc "POST /api/works/:work_id/memories/:memory_id/lock"
  def lock(conn, %{"work_id" => work_id, "memory_id" => id}) do
    case MemoryService.lock(work_id, id) do
      {:ok, item} -> json(conn, %{data: to_map(item), ok: true})
      {:error, reason} -> json(conn, %{error: format_error(reason), ok: false})
    end
  end

  @doc "POST /api/works/:work_id/memories/:memory_id/unlock"
  def unlock(conn, %{"work_id" => work_id, "memory_id" => id}) do
    case MemoryService.unlock(work_id, id) do
      {:ok, item} -> json(conn, %{data: to_map(item), ok: true})
      {:error, reason} -> json(conn, %{error: format_error(reason), ok: false})
    end
  end

  @doc "POST /api/works/:work_id/memories/:memory_id/deprecate"
  def deprecate(conn, %{"work_id" => work_id, "memory_id" => id}) do
    case MemoryService.deprecate(work_id, id) do
      {:ok, item} -> json(conn, %{data: to_map(item), ok: true})
      {:error, reason} -> json(conn, %{error: format_error(reason), ok: false})
    end
  end

  @doc "POST /api/works/:work_id/memories/:memory_id/archive"
  def archive(conn, %{"work_id" => work_id, "memory_id" => id}) do
    case MemoryService.archive(work_id, id) do
      {:ok, item} -> json(conn, %{data: to_map(item), ok: true})
      {:error, reason} -> json(conn, %{error: format_error(reason), ok: false})
    end
  end

  @doc "PATCH /api/works/:work_id/memories/:memory_id/weight"
  def update_weight(conn, %{"work_id" => work_id, "memory_id" => id, "weight" => weight}) do
    case MemoryService.update_weight(work_id, id, weight |> parse_float) do
      {:ok, item} -> json(conn, %{data: to_map(item), ok: true})
      {:error, reason} -> json(conn, %{error: format_error(reason), ok: false})
    end
  end

  @doc "PATCH /api/works/:work_id/memories/:memory_id/validity"
  def update_validity(conn, %{"work_id" => work_id, "memory_id" => id} = params) do
    case MemoryService.update_validity(
           work_id,
           id,
           params["valid_from"],
           params["valid_until"],
           params["expire_condition"]
         ) do
      {:ok, item} -> json(conn, %{data: to_map(item), ok: true})
      {:error, reason} -> json(conn, %{error: format_error(reason), ok: false})
    end
  end

  @doc "POST /api/works/:work_id/memories/recall — 召回记忆"
  def recall(conn, %{"work_id" => work_id} = params) do
    result =
      MemoryRecallService.recall(work_id,
        query: Map.get(params, "query", Map.get(params, "userInput", "")),
        scene: Map.get(params, "scene", "api_recall"),
        token_budget: parse_int(Map.get(params, "token_budget", params["tokenBudget"]), 3000),
        scope: params["scope"],
        task_type: params["taskType"],
        volume_id: params["volumeId"],
        arc_id: params["arcId"],
        chapter_id: params["chapterId"],
        scene_index: parse_optional_int(params["sceneIndex"]),
        involved_characters: parse_string_list(params["involvedCharacters"]),
        prefer_types: parse_string_list(params["prefer_types"])
      )

    json(conn, %{
      data: %{
        text: result.text,
        iron_law_count: result.iron_law_count,
        candidate_count: result.candidate_count,
        estimated_tokens: result.estimated_tokens,
        hardRules: result.hard_rules,
        currentStates: result.current_states,
        relationships: result.relationships,
        plotFacts: result.plot_facts,
        foreshadowings: result.foreshadowings,
        styleRules: result.style_rules,
        packedContext: result.packed_context,
        excludedMemories: result.excluded_memories,
        referenceTrace: result.reference_trace
      },
      ok: true
    })
  end

  @doc "GET /api/works/:work_id/memories/:memory_id/references — 查看引用记录"
  def references(conn, %{"work_id" => work_id, "memory_id" => id}) do
    case MemoryService.list_references(work_id, id) do
      {:ok, logs} ->
        logs = Enum.map(logs, &ref_log_to_map/1)
        json(conn, %{data: logs, count: length(logs), ok: true})

      {:error, reason} ->
        json(conn, %{error: format_error(reason), ok: false})
    end
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

  defp optional_sort_by(opts, params) do
    case Map.get(params, "sort_by") do
      "weight" -> Keyword.put(opts, :sort_by, :weight)
      "confidence" -> Keyword.put(opts, :sort_by, :confidence)
      "updated_at" -> Keyword.put(opts, :sort_by, :updated_at)
      "inserted_at" -> Keyword.put(opts, :sort_by, :inserted_at)
      nil -> Keyword.put(opts, :sort_by, :updated_at)
      _ -> opts
    end
  end

  defp optional_sort_dir(opts, params) do
    case Map.get(params, "sort_dir") do
      "asc" -> Keyword.put(opts, :sort_dir, :asc)
      "desc" -> Keyword.put(opts, :sort_dir, :desc)
      nil -> Keyword.put(opts, :sort_dir, :desc)
      _ -> opts
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
      is_integer(val) ->
        val

      is_binary(val) ->
        case Integer.parse(val) do
          {i, _} -> i
          :error -> default
        end

      true ->
        default
    end
  end

  defp parse_optional_int(nil), do: nil
  defp parse_optional_int(val), do: parse_int(val, nil)

  defp parse_string_list(nil), do: []
  defp parse_string_list(val) when is_list(val), do: val

  defp parse_string_list(val) when is_binary(val),
    do: String.split(val, ",") |> Enum.map(&String.trim/1)

  defp format_errors(%Ecto.Changeset{} = cs) do
    Ecto.Changeset.traverse_errors(cs, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", to_string(value))
      end)
    end)
  end

  defp format_error(%Ecto.Changeset{} = cs), do: format_errors(cs)
  defp format_error(reason), do: to_string(reason)

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
