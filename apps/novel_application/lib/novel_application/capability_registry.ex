defmodule NovelApplication.CapabilityRegistry do
  @moduledoc """
  工具能力注册表。替代 v2 的 IntentRegistry——工具不再是 intent/slot 模型，
  而是有 contract 版本、风险等级、状态生命周期的能力注册。

  VS-02 使用内存注册表，不依赖数据库。
  """

  alias NovelDomain.CapabilityRegistryEntry

  @doc "返回所有已注册工具的名称列表。"
  @spec list() :: [String.t()]
  def list, do: Map.keys(all())

  @doc "按名称获取注册条目。不存在返回 nil。"
  @spec get(String.t()) :: CapabilityRegistryEntry.t() | nil
  def get(name), do: Map.get(all(), name)

  @doc "工具是否可被 dispatch。"
  @spec dispatchable?(String.t()) :: boolean()
  def dispatchable?(name) do
    case get(name) do
      nil -> false
      entry -> CapabilityRegistryEntry.dispatchable?(entry)
    end
  end

  @doc "验证 ToolRequest 的 grants 不超出 registry 声明。"
  @spec grants_valid?(String.t(), [String.t()], [String.t()]) :: boolean()
  def grants_valid?(tool_name, read_grants, write_grants) do
    case get(tool_name) do
      nil ->
        false

      entry ->
        read_ok = Enum.all?(read_grants, &(&1 in entry.read_scopes))
        write_ok = Enum.all?(write_grants, &(&1 in entry.write_scopes))
        read_ok and write_ok
    end
  end

  # ── registry ──────────────────────────────────

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
      "creative_generation" => %CapabilityRegistryEntry{
        tool_name: "creative_generation",
        tool_version: "1.0.0",
        tool_layer: :creative,
        input_contract_ref: "creative_generation_input_v1",
        output_contract_ref: "creative_generation_output_v1",
        read_scopes: ["author_text", "context_snapshot", "conversation_summary"],
        write_scopes: [],
        risk_class: :medium,
        status: :active,
        trace_level: :standard,
        provider_dependency: :llm_provider,
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
        supports_cancellation: false
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
        supports_cancellation: false
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
        supports_cancellation: false
      },
      "prose_writing" => %CapabilityRegistryEntry{
        tool_name: "prose_writing",
        tool_version: "1.0.0",
        tool_layer: :creative,
        input_contract_ref: "prose_writing_v1",
        output_contract_ref: "tentative_artifact_v1",
        read_scopes: ["author_text", "chapter_draft", "prose_style_guide"],
        write_scopes: ["prose_fragment", "scene_draft"],
        risk_class: :medium,
        status: :active,
        trace_level: :standard,
        provider_dependency: :llm_provider,
        supports_retry: true,
        supports_cancellation: false
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
