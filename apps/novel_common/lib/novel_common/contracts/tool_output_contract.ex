defmodule NovelCommon.Contracts.ToolOutputContract do
  @moduledoc """
  Validation helpers for creative tool output contracts.
  """

  alias NovelFoundation.Enums.NarrativeRole

  @creative_artifact_types [
    :character_seed,
    :character_evolution_seed,
    :plot_direction,
    :outline_draft,
    :scene_draft,
    :prose_fragment,
    :world_setting,
    :foreshadowing_seed,
    :world_rule_seed,
    :style_rule_seed,
    :constraint_seed
  ]

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

  @doc """
  Normalize optional prose-writing self-report fields.

  The report is a non-authoritative quality signal. Invalid or empty fields are
  dropped; invalid report shape does not invalidate otherwise valid creative
  items.
  """
  @spec normalize_creative_self_report(term()) :: {:ok, map() | nil}
  def normalize_creative_self_report(nil), do: {:ok, nil}

  def normalize_creative_self_report(report) when is_map(report) do
    normalized = %{
      assumptions: string_list(map_get(report, :assumptions)),
      intended_reader_effect: optional_string(map_get(report, :intended_reader_effect)),
      used_context_refs: string_list(map_get(report, :used_context_refs)),
      risk_flags: string_list(map_get(report, :risk_flags))
    }

    if empty_self_report?(normalized) do
      {:ok, nil}
    else
      {:ok, Map.put(normalized, :quality_action, self_report_quality_action(normalized))}
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
         {:ok, body} <- fetch_string(raw, :body) do
      rationale = map_get(raw, :rationale)
      provider_call_ref = map_get(raw, :provider_call_ref)

      item =
        %{
          item_id: item_id,
          title: title,
          body: body,
          rationale: if(is_binary(rationale), do: rationale, else: nil)
        }

      item =
        if is_binary(provider_call_ref) do
          Map.put(item, :provider_call_ref, provider_call_ref)
        else
          item
        end

      # narrative_role（可选）：角色设计候选的结构化叙事角色分类。非 I1 约束字段
      # （I1 只校验 title/body/rationale），仅在合法枚举值时保留，否则丢弃为 nil。
      item =
        case normalize_narrative_role(map_get(raw, :narrative_role)) do
          nil -> item
          narrative_role -> Map.put(item, :narrative_role, narrative_role)
        end

      # memory_subtype（可选）：角色演化记忆的角色 MemoryType 子类。同样非 I1 约束字段。
      item =
        case normalize_memory_subtype(map_get(raw, :memory_subtype)) do
          nil -> item
          subtype -> Map.put(item, :memory_subtype, subtype)
        end

      {:ok, item}
    end
  end

  defp normalize_item(_raw) do
    {:error, %{code: "invalid_item", message: "creative item must be a map"}}
  end

  # 把 provider 输出的叙事角色规范化到 NarrativeRole 契约枚举。
  # 接受 canonical 枚举值（大小写不敏感）与常见中文同义词；无法识别返回 nil
  # （角色不带主角标记，召回时诚实报缺口，不臆造主角）。
  @spec normalize_narrative_role(term()) ::
          NovelCommon.Contracts.ToolOutputContract.narrative_role()
  def normalize_narrative_role(value) when is_binary(value) do
    trimmed = value |> String.trim()
    upcased = String.upcase(trimmed)

    cond do
      NarrativeRole.valid?(upcased) -> upcased
      protagonist_label?(trimmed) -> NarrativeRole.protagonist()
      antagonist_label?(trimmed) -> NarrativeRole.antagonist()
      ensemble_label?(trimmed) -> NarrativeRole.ensemble_pov()
      supporting_label?(trimmed) -> NarrativeRole.supporting()
      minor_label?(trimmed) -> NarrativeRole.minor()
      true -> nil
    end
  end

  def normalize_narrative_role(_value), do: nil

  @typedoc "规范化后的叙事角色枚举值或 nil。"
  @type narrative_role :: String.t() | nil

  # 把 provider 输出的角色演化 memory_subtype 规范化到角色 MemoryType 子集
  # （CHARACTER_PROFILE/CURRENT_STATE/RELATIONSHIP）。接受 canonical 值与中文同义词；
  # 无法识别返回 nil（采纳层再按内容兜底分类）。
  @spec normalize_memory_subtype(term()) :: String.t() | nil
  def normalize_memory_subtype(value) when is_binary(value) do
    trimmed = String.trim(value)
    upcased = String.upcase(trimmed)

    cond do
      upcased in ["CHARACTER_PROFILE", "CURRENT_STATE", "RELATIONSHIP"] -> upcased
      relationship_label?(trimmed) -> "RELATIONSHIP"
      current_state_label?(trimmed) -> "CURRENT_STATE"
      character_profile_label?(trimmed) -> "CHARACTER_PROFILE"
      true -> nil
    end
  end

  def normalize_memory_subtype(_value), do: nil

  defp relationship_label?(text), do: contains_any?(text, ["关系", "结盟", "敌对", "背叛", "决裂", "联手"])

  defp current_state_label?(text),
    do: contains_any?(text, ["当前状态", "现状", "此刻", "目前", "伤势", "处境", "所在"])

  defp character_profile_label?(text),
    do: contains_any?(text, ["演化", "成长", "转变", "弧光", "黑化", "觉醒", "蜕变"])

  defp protagonist_label?(text), do: contains_any?(text, ["主角", "主人公", "男主", "女主", "第一主角"])
  defp antagonist_label?(text), do: contains_any?(text, ["反派", "反一", "反角", "大反派", "对手"])
  defp ensemble_label?(text), do: contains_any?(text, ["群像", "POV", "视角人物", "多主角"])
  defp supporting_label?(text), do: contains_any?(text, ["配角", "辅助", "帮手"])
  defp minor_label?(text), do: contains_any?(text, ["次要", "龙套", "路人", "群演"])

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
