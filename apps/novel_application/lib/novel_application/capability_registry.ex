defmodule NovelApplication.CapabilityRegistry do
  @moduledoc """
  Application-facing wrapper for the shared production capability registry.

  B30 CP1：章节结构维护是 application 级能力（无 tool adapter/provider 依赖），
  以本地 additive entry 暴露给判断/计划目录；不修改已冻结的 novel_common registry。
  """

  alias NovelCommon.Contracts.CapabilityRegistryEntry

  @local_entries %{
    "revise_character_profile" => %CapabilityRegistryEntry{
      tool_name: "revise_character_profile",
      tool_version: "1.0.0",
      tool_layer: :policy,
      input_contract_ref: "character_profile_revision_input_v1",
      output_contract_ref: "character_profile_revision_v1",
      effect_summary: "修订既有角色主档案字段（首闭环 narrative_role），生成可审阅旧→新角色字段修订候选；不新建角色、不写正文、不冒充角色演化记忆。",
      read_scopes: ["character_dossier", "character_list"],
      write_scopes: ["character_dossier"],
      risk_class: :medium,
      status: :active,
      trace_level: :standard,
      provider_dependency: :none,
      supports_retry: false,
      supports_cancellation: false
    },
    "maintain_chapter_structure" => %CapabilityRegistryEntry{
      tool_name: "maintain_chapter_structure",
      tool_version: "1.0.0",
      tool_layer: :policy,
      input_contract_ref: "chapter_structure_maintenance_input_v1",
      output_contract_ref: "chapter_structure_change_plan_v1",
      effect_summary:
        "只维护既有章结构（首闭环 renumber_chapters：仅重编号/只改展示章号），生成可审阅旧→新编号变更计划；不生成大纲、不新建章、不改 title/正文/归卷/章数。",
      read_scopes: ["chapter_structure", "chapter_list"],
      write_scopes: ["chapter_structure"],
      risk_class: :medium,
      status: :active,
      trace_level: :standard,
      provider_dependency: :none,
      supports_retry: false,
      supports_cancellation: false
    }
  }

  @doc "返回所有已注册工具/能力名称（共享 registry + application 本地 additive）。"
  @spec list() :: [String.t()]
  def list do
    Enum.uniq(NovelCommon.CapabilityRegistry.list() ++ Map.keys(@local_entries))
  end

  @doc "按名称获取注册条目。不存在返回 nil。"
  @spec get(String.t()) :: CapabilityRegistryEntry.t() | nil
  def get(name), do: Map.get(@local_entries, name) || NovelCommon.CapabilityRegistry.get(name)

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
        Enum.all?(read_grants, &(&1 in entry.read_scopes)) and
          Enum.all?(write_grants, &(&1 in entry.write_scopes))
    end
  end

  @doc "B30：章节结构维护能力的本地目录条目（判断/计划 prompt 目录使用）。"
  def maintenance_capability_entries, do: @local_entries
end
