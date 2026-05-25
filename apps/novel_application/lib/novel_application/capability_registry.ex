defmodule NovelApplication.CapabilityRegistry do
  @moduledoc """
  Application-facing wrapper for the shared production capability registry.
  """

  @doc "返回所有已注册工具的名称列表。"
  @spec list() :: [String.t()]
  defdelegate list, to: NovelCommon.CapabilityRegistry

  @doc "按名称获取注册条目。不存在返回 nil。"
  @spec get(String.t()) :: NovelCommon.Contracts.CapabilityRegistryEntry.t() | nil
  defdelegate get(name), to: NovelCommon.CapabilityRegistry

  @doc "工具是否可被 dispatch。"
  @spec dispatchable?(String.t()) :: boolean()
  defdelegate dispatchable?(name), to: NovelCommon.CapabilityRegistry

  @doc "验证 ToolRequest 的 grants 不超出 registry 声明。"
  @spec grants_valid?(String.t(), [String.t()], [String.t()]) :: boolean()
  defdelegate grants_valid?(tool_name, read_grants, write_grants),
    to: NovelCommon.CapabilityRegistry
end
