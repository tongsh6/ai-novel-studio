defmodule NovelAgent.Test.WireToolFacts do
  @moduledoc """
  仅测试支持：离线替身从真实请求读取工具事实的唯一入口。

  - `%RequestIR{}`：委托 `NovelAgent.Provider` 现役 API（生产唯一请求形态）。
  - legacy 文本形态（binary / messages list / 旧 map）：保留旧测试替身的读取规则，
    只读取调用方显式给出的 `tools` / `tool_choice`，不从文本推断。

  这不是生产兼容层：生产 `Gateway` 只接受 `%RequestIR{}`。测试替身仍可能被历史
  测试直接用文本 prompt 调用，本模块只负责让这些调用不因 API 收紧而崩溃，且不回
  到"从文本猜工具"的旧行为。
  """

  alias NovelAgent.Provider
  alias NovelAgent.Provider.RequestIR

  @spec specs(term()) :: [map()]
  def specs(%RequestIR{} = ir), do: Provider.tool_specs(ir)

  def specs(prompt) when is_map(prompt), do: legacy_specs(field(prompt, :tools))

  def specs(_prompt), do: []

  @spec choice(term()) :: String.t() | nil
  def choice(%RequestIR{} = ir), do: Provider.tool_choice(ir)

  def choice(prompt) when is_map(prompt) do
    case field(prompt, :tool_choice) do
      value when is_binary(value) and value != "" -> value
      %{name: name} when is_binary(name) and name != "" -> name
      %{"name" => name} when is_binary(name) and name != "" -> name
      _ -> nil
    end
  end

  def choice(_prompt), do: nil

  @spec active_tool_name(term()) :: String.t() | nil
  def active_tool_name(prompt) do
    names = Enum.map(specs(prompt), & &1.name)

    case choice(prompt) do
      nil -> single_tool_name(names)
      "auto" -> single_tool_name(names)
      "required" -> single_tool_name(names)
      "none" -> nil
      name -> if name in names, do: name
    end
  end

  @spec tool_call?(term()) :: boolean()
  def tool_call?(prompt), do: specs(prompt) != [] and choice(prompt) != "none"

  defp single_tool_name([name]), do: name
  defp single_tool_name(_names), do: nil

  defp legacy_specs(tools) when is_list(tools) do
    Enum.flat_map(tools, fn tool ->
      case field(tool, :name) do
        name when is_binary(name) and name != "" -> [%{name: name}]
        _ -> []
      end
    end)
  end

  defp legacy_specs(_tools), do: []

  defp field(map, key) when is_map(map) do
    case Map.fetch(map, key) do
      {:ok, value} -> value
      :error -> Map.get(map, to_string(key))
    end
  end

  defp field(_map, _key), do: nil
end
