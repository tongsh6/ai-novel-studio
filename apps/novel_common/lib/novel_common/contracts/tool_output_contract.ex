defmodule NovelCommon.Contracts.ToolOutputContract do
  @moduledoc """
  Validation helpers for creative tool output contracts.
  """

  alias NovelCommon.AuthorVisible.Text
  alias NovelCommon.Contracts.CreativeItemAttributes

  @creative_artifact_types [
    :character_seed,
    :character_evolution_seed,
    :plot_direction,
    :outline_draft,
    :scene_draft,
    :prose_fragment,
    :prose_formatting_plan,
    :world_setting,
    :foreshadowing_seed,
    :world_rule_seed,
    :style_rule_seed,
    :constraint_seed
  ]

  @prose_companion_artifact_types [
    :character_seed,
    :foreshadowing_seed,
    :world_rule_seed,
    :constraint_seed
  ]

  @spec creative_output_contract_ref() :: String.t()
  def creative_output_contract_ref, do: "tentative_artifact_v2"

  @spec creative_artifact_types() :: [atom()]
  def creative_artifact_types, do: @creative_artifact_types

  @spec known_creative_artifact_type?(atom() | String.t()) :: boolean()
  def known_creative_artifact_type?(type) do
    case normalize_artifact_type(type) do
      {:ok, _} -> true
      {:error, _} -> false
    end
  end

  @spec normalize_artifact_type(atom() | String.t()) :: {:ok, atom()} | {:error, map()}
  def normalize_artifact_type(type) when is_atom(type) do
    if type in @creative_artifact_types do
      {:ok, type}
    else
      {:error,
       %{code: "unknown_artifact_type", message: "unknown artifact_type: #{inspect(type)}"}}
    end
  end

  def normalize_artifact_type(type) when is_binary(type) do
    type
    |> String.to_existing_atom()
    |> normalize_artifact_type()
  rescue
    ArgumentError ->
      {:error, %{code: "unknown_artifact_type", message: "unknown artifact_type: #{type}"}}
  end

  def normalize_artifact_type(type) do
    {:error, %{code: "invalid_artifact_type", message: "invalid artifact_type: #{inspect(type)}"}}
  end

  @spec validate_creative_items(term()) :: {:ok, [map()]} | {:error, map()}
  def validate_creative_items(items) when is_list(items) and items != [] do
    items
    |> Enum.reduce_while([], fn raw, acc ->
      case normalize_item(raw) do
        {:ok, item} -> {:cont, [item | acc]}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
    |> case do
      {:error, _} = error -> error
      normalized -> {:ok, Enum.reverse(normalized)}
    end
  end

  def validate_creative_items([]) do
    {:error, %{code: "empty_items", message: "creative tool output must contain items"}}
  end

  def validate_creative_items(_items) do
    {:error,
     %{code: "invalid_items", message: "creative tool output items must be a non-empty list"}}
  end

  @doc "Validate the item fields allowed by the actual task and artifact type."
  def validate_artifact_shape(type, items, companions, task) do
    mapping_required? = target_segment_mapping_required?(type, task)

    cond do
      Enum.any?(companions, &Map.has_key?(&1, :target_segment_ids)) ->
        unexpected_target_segment_ids()

      mapping_required? and not Enum.all?(items, &Map.has_key?(&1, :target_segment_ids)) ->
        {:error,
         %{
           code: "missing_target_segment_ids",
           message: "each target_segments prose item must declare its source segment IDs"
         }}

      not mapping_required? and Enum.any?(items, &Map.has_key?(&1, :target_segment_ids)) ->
        unexpected_target_segment_ids()

      true ->
        validate_formatting_shape(type, items, companions)
    end
  end

  @doc "Whether the actual task requires explicit source intervals on its prose items."
  @spec target_segment_mapping_required?(atom() | String.t(), map() | nil) :: boolean()
  def target_segment_mapping_required?(type, task)
      when type in [:prose_fragment, "prose_fragment"] and is_map(task) do
    case {map_get(task, :kind), map_get(task, :operation_effect), map_get(task, :scope)} do
      {kind, effect, scope}
      when kind in [:revision, "revision"] and effect in [:revise_candidate, "revise_candidate"] and
             is_map(scope) ->
        map_get(scope, :modification_scope) in [:target_segments, "target_segments"]

      _ ->
        false
    end
  end

  def target_segment_mapping_required?(_type, _task), do: false

  defp unexpected_target_segment_ids do
    {:error,
     %{
       code: "unexpected_target_segment_ids",
       message: "target_segment_ids is only allowed on target_segments prose items"
     }}
  end

  # ADR-0029：分段方案只有一项，必须携带换行计划，不产生伴生事实。
  defp validate_formatting_shape(type, items, companions)
       when type in [:prose_formatting_plan, "prose_formatting_plan"] do
    case {items, companions} do
      {[%{line_break_changes: [_ | _]}], []} -> :ok
      _ -> invalid_formatting_plan()
    end
  end

  defp validate_formatting_shape(_type, _items, _companions), do: :ok

  @doc """
  Validate the optional seed items emitted alongside one prose fragment.

  Each entry keeps the canonical creative item fields and adds one of the four
  existing prose companion artifact types. An empty list is valid because not
  every passage introduces a durable fact.
  """
  @spec validate_prose_companion_artifacts(term()) :: {:ok, [map()]} | {:error, map()}
  def validate_prose_companion_artifacts(nil), do: {:ok, []}
  def validate_prose_companion_artifacts([]), do: {:ok, []}

  def validate_prose_companion_artifacts(items) when is_list(items) do
    items
    |> Enum.reduce_while([], fn raw, acc ->
      with true <- is_map(raw),
           {:ok, artifact_type} <- normalize_artifact_type(map_get(raw, :artifact_type)),
           true <- artifact_type in @prose_companion_artifact_types,
           {:ok, [item]} <- validate_creative_items([raw]) do
        {:cont, [Map.put(item, :artifact_type, artifact_type) | acc]}
      else
        false ->
          {:halt,
           {:error,
            %{
              code: "invalid_companion_artifact",
              message: "prose companion artifact must use an allowed seed type"
            }}}

        {:error, _reason} = error ->
          {:halt, error}
      end
    end)
    |> case do
      {:error, _reason} = error -> error
      normalized -> {:ok, Enum.reverse(normalized)}
    end
  end

  def validate_prose_companion_artifacts(_items) do
    {:error,
     %{
       code: "invalid_companion_artifacts",
       message: "prose companion_artifacts must be a list"
     }}
  end

  @doc false
  @spec validate_unique_item_ids([map()], [map()]) :: :ok | {:error, map()}
  def validate_unique_item_ids(primary_items, companion_artifacts)
      when is_list(primary_items) and is_list(companion_artifacts) do
    ids = Enum.map(primary_items ++ companion_artifacts, &map_get(&1, :item_id))

    if length(ids) == length(Enum.uniq(ids)) do
      :ok
    else
      {:error,
       %{
         code: "duplicate_item_id",
         message: "creative primary and companion item_id values must be unique"
       }}
    end
  end

  @doc """
  Normalize optional prose-writing self-report fields.

  Quality opinions remain non-authoritative signals. Material-use declarations
  must retain every supplied reference; malformed declarations are rejected,
  then the receiving operation checks them against its actual Request IR.
  """
  @spec normalize_creative_self_report(term()) :: {:ok, map() | nil} | {:error, map()}
  def normalize_creative_self_report(nil), do: {:ok, nil}

  def normalize_creative_self_report(report) when is_map(report) do
    refs = Map.get(report, :used_context_refs, Map.get(report, "used_context_refs", []))

    if is_list(refs) and Enum.all?(refs, &(is_binary(&1) and String.trim(&1) != "")) do
      normalized = %{
        assumptions: string_list(map_get(report, :assumptions)),
        intended_reader_effect: optional_string(map_get(report, :intended_reader_effect)),
        used_context_refs: refs,
        risk_flags: string_list(map_get(report, :risk_flags))
      }

      if empty_self_report?(normalized),
        do: {:ok, nil},
        else: {:ok, Map.put(normalized, :quality_action, self_report_quality_action(normalized))}
    else
      {:error,
       %{
         code: "invalid_used_context_refs",
         message: "used_context_refs must be a list of non-empty reference strings"
       }}
    end
  end

  def normalize_creative_self_report(_report), do: {:ok, nil}

  @doc """
  Map self-reported risk flags to the first quality-gate-style action.

  This is only a signal for quality gates / trace. It does not authorize writes
  or mutate production facts.
  """
  @spec self_report_quality_action(map() | [String.t()] | nil) ::
          :proceed | :warn | :confirm | :block
  def self_report_quality_action(%{} = report),
    do: report |> Map.get(:risk_flags, []) |> self_report_quality_action()

  def self_report_quality_action(flags) when is_list(flags) do
    normalized = Enum.map(flags, &String.downcase(to_string(&1)))

    cond do
      Enum.any?(normalized, &contains_any?(&1, ["block", "阻断", "禁止", "严重冲突"])) ->
        :block

      Enum.any?(normalized, &contains_any?(&1, ["confirm", "确认", "高风险", "需作者"])) ->
        :confirm

      normalized != [] ->
        :warn

      true ->
        :proceed
    end
  end

  def self_report_quality_action(_flags), do: :proceed

  defp normalize_item(raw) when is_map(raw) do
    with {:ok, item_id} <- fetch_string(raw, :item_id),
         {:ok, title} <- fetch_string(raw, :title),
         {:ok, body} <- fetch_string(raw, :body),
         {:ok, rationale} <-
           validate_rationale(Map.get(raw, :rationale, Map.get(raw, "rationale"))),
         {:ok, changes} <- normalize_line_break_changes(map_get(raw, :line_break_changes)),
         {:ok, segment_mapping} <- normalize_target_segment_ids(raw) do
      item = %{item_id: item_id, title: title, body: body, rationale: rationale}

      item = if is_nil(changes), do: item, else: Map.put(item, :line_break_changes, changes)

      {:ok,
       item
       |> Map.merge(CreativeItemAttributes.normalize(raw))
       |> Map.merge(segment_mapping)}
    end
  end

  defp normalize_item(_raw) do
    {:error, %{code: "invalid_item", message: "creative item must be a map"}}
  end

  defp validate_rationale(nil), do: {:ok, nil}

  defp validate_rationale(text) when is_binary(text) do
    case Text.validate_narrative(text) do
      :ok ->
        {:ok, text}

      {:error, :author_visible_narrative_invalid} ->
        {:error,
         %{
           code: "author_visible_narrative_invalid",
           message: "creative item rationale must use author-visible language"
         }}
    end
  end

  defp validate_rationale(_),
    do: {:error, %{code: "invalid_item_field", message: "invalid field: rationale"}}

  defp normalize_line_break_changes(nil), do: {:ok, nil}

  defp normalize_line_break_changes(changes) when is_list(changes) do
    Enum.reduce_while(changes, {:ok, []}, fn change, {:ok, acc} ->
      with true <- is_map(change) and map_size(change) == 2,
           id when is_binary(id) and id != "" <- map_get(change, :boundary_id),
           lines when is_integer(lines) and lines in [0, 1, 2] <- map_get(change, :lines) do
        {:cont, {:ok, acc ++ [%{boundary_id: id, lines: lines}]}}
      else
        _ -> {:halt, invalid_formatting_plan()}
      end
    end)
  end

  defp normalize_line_break_changes(_), do: invalid_formatting_plan()

  defp invalid_formatting_plan do
    {:error, %{code: "invalid_formatting_plan", message: "分段方案须含一个条目及有效换行计划，不允许伴生产物"}}
  end

  defp normalize_target_segment_ids(raw) do
    value =
      case Map.fetch(raw, :target_segment_ids) do
        :error -> Map.fetch(raw, "target_segment_ids")
        found -> found
      end

    case value do
      :error -> {:ok, %{}}
      {:ok, ids} -> normalize_target_segment_id_list(ids)
    end
  end

  defp normalize_target_segment_id_list(ids) when is_list(ids) and ids != [] do
    if Enum.all?(ids, &(is_binary(&1) and String.trim(&1) != "")) and
         length(ids) == length(Enum.uniq(ids)) do
      {:ok, %{target_segment_ids: ids}}
    else
      invalid_target_segment_ids()
    end
  end

  defp normalize_target_segment_id_list(_ids), do: invalid_target_segment_ids()

  defp invalid_target_segment_ids do
    {:error,
     %{
       code: "invalid_target_segment_ids",
       message: "target_segment_ids must be a non-empty list of unique non-empty strings"
     }}
  end

  defp fetch_string(map, key) do
    case map_get(map, key) do
      value when is_binary(value) and byte_size(value) > 0 ->
        {:ok, value}

      _ ->
        {:error, %{code: "invalid_item_field", message: "missing or invalid field: #{key}"}}
    end
  end

  defp map_get(map, key), do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp string_list(values) when is_list(values) do
    values
    |> Enum.map(&optional_string/1)
    |> Enum.reject(&is_nil/1)
  end

  defp string_list(_values), do: []

  defp optional_string(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp optional_string(_value), do: nil

  defp empty_self_report?(report) do
    report.assumptions == [] and
      is_nil(report.intended_reader_effect) and
      report.used_context_refs == [] and
      report.risk_flags == []
  end

  defp contains_any?(text, terms), do: Enum.any?(terms, &String.contains?(text, &1))
end
