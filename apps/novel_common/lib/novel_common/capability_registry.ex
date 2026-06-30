defmodule NovelCommon.CapabilityRegistry do
  @moduledoc """
  Production capability registry shared by application and agent runtimes.
  """

  alias NovelCommon.Contracts.CapabilityRegistryEntry

  @doc "Return all registered production tool names."
  @spec list() :: [String.t()]
  def list, do: Map.keys(all())

  @doc "Fetch a registry entry by tool name."
  @spec get(String.t()) :: CapabilityRegistryEntry.t() | nil
  def get(name), do: Map.get(all(), name)

  @doc "Whether a tool can be dispatched for a new call."
  @spec dispatchable?(String.t()) :: boolean()
  def dispatchable?(name) do
    case get(name) do
      nil -> false
      entry -> CapabilityRegistryEntry.dispatchable?(entry)
    end
  end

  @doc "Validate requested read/write grants against registry scopes."
  @spec grants_valid?(String.t(), [String.t()], [String.t()]) :: boolean()
  def grants_valid?(tool_name, read_grants, write_grants) do
    case get(tool_name) do
      nil ->
        false

      entry ->
        Enum.all?(read_grants, &(&1 in entry.read_scopes)) and
          Enum.all?(write_grants, &(&1 in entry.write_scopes))
    end
  end

  defp all do
    %{
      "text_analysis" => %CapabilityRegistryEntry{
        tool_name: "text_analysis",
        tool_version: "1.0.0",
        tool_layer: :cognitive,
        input_contract_ref: "text_analysis_input_v1",
        output_contract_ref: "text_analysis_output_v1",
        read_scopes: ["author_text", "genre_tags"],
        write_scopes: [],
        risk_class: :low,
        status: :active,
        trace_level: :standard,
        provider_dependency: :none,
        supports_retry: false,
        supports_cancellation: false
      },
      "character_roster" => %CapabilityRegistryEntry{
        tool_name: "character_roster",
        tool_version: "1.0.0",
        tool_layer: :memory,
        input_contract_ref: "character_roster_query_v1",
        output_contract_ref: "character_roster_result_v1",
        read_scopes: ["character_list"],
        write_scopes: [],
        risk_class: :low,
        status: :active,
        trace_level: :standard,
        provider_dependency: :none,
        supports_retry: false,
        supports_cancellation: false
      },
      "world_building" => %CapabilityRegistryEntry{
        tool_name: "world_building",
        tool_version: "1.0.0",
        tool_layer: :creative,
        input_contract_ref: "world_building_v1",
        output_contract_ref: "tentative_artifact_v1",
        read_scopes: ["author_text", "world_summary", "lore_references"],
        write_scopes: ["world_setting", "geography", "lore_item"],
        risk_class: :medium,
        status: :active,
        trace_level: :standard,
        provider_dependency: :llm_provider,
        supports_retry: true,
        supports_cancellation: true
      },
      "character_design" => %CapabilityRegistryEntry{
        tool_name: "character_design",
        tool_version: "1.0.0",
        tool_layer: :creative,
        input_contract_ref: "character_design_v1",
        output_contract_ref: "tentative_artifact_v1",
        read_scopes: ["author_text", "character_list", "relationship_map"],
        write_scopes: ["character_profile", "character_trait", "relationship"],
        risk_class: :medium,
        status: :active,
        trace_level: :standard,
        provider_dependency: :llm_provider,
        supports_retry: true,
        supports_cancellation: true
      },
      # AU-09 角色演化记忆：更新已有角色的演化/当前状态/关系变化，采纳后写角色记忆
      # （CHARACTER_PROFILE/CURRENT_STATE/RELATIONSHIP），区别于 character_design 写主档案。
      "character_evolution" => %CapabilityRegistryEntry{
        tool_name: "character_evolution",
        tool_version: "1.0.0",
        tool_layer: :creative,
        input_contract_ref: "character_evolution_v1",
        output_contract_ref: "tentative_artifact_v1",
        read_scopes: ["author_text", "character_list", "relationship_map"],
        write_scopes: ["character_profile", "current_state", "relationship"],
        risk_class: :medium,
        status: :active,
        trace_level: :standard,
        provider_dependency: :llm_provider,
        supports_retry: true,
        supports_cancellation: true
      },
      "plot_outline" => %CapabilityRegistryEntry{
        tool_name: "plot_outline",
        tool_version: "1.0.0",
        tool_layer: :creative,
        input_contract_ref: "plot_outline_v1",
        output_contract_ref: "tentative_artifact_v1",
        read_scopes: ["author_text", "plot_summary", "beat_list"],
        write_scopes: ["volume_plan", "chapter_outline", "plot_beat"],
        risk_class: :medium,
        status: :active,
        trace_level: :standard,
        provider_dependency: :llm_provider,
        supports_retry: true,
        supports_cancellation: true
      },
      "prose_writing" => %CapabilityRegistryEntry{
        tool_name: "prose_writing",
        tool_version: "1.0.0",
        tool_layer: :creative,
        input_contract_ref: "prose_writing_v1",
        output_contract_ref: "tentative_artifact_v1",
        # VS-00E §14：补齐 prose_writing 实际读取的范围（目标章结构/方向、章摘要、
        # 前文 excerpt、现有角色主档案），而非仅 author_text/chapter_draft/style。
        read_scopes: [
          "author_text",
          "chapter_structure",
          "chapter_summary",
          "chapter_draft",
          "character_dossier",
          "prose_excerpt",
          "prose_style_guide"
        ],
        write_scopes: ["prose_fragment", "scene_draft"],
        risk_class: :medium,
        status: :active,
        trace_level: :standard,
        provider_dependency: :llm_provider,
        supports_retry: true,
        supports_cancellation: true
      },
      "disabled_tool" => %CapabilityRegistryEntry{
        tool_name: "disabled_tool",
        tool_version: "1.0.0",
        tool_layer: :debug,
        input_contract_ref: "disabled_input_v1",
        output_contract_ref: "disabled_output_v1",
        read_scopes: [],
        write_scopes: [],
        risk_class: :low,
        status: :disabled,
        trace_level: :minimal,
        provider_dependency: :none,
        supports_retry: false,
        supports_cancellation: false
      }
    }
  end
end
