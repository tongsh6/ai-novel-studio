defmodule NovelAgent.Provider.RequestIR.Tools do
  @moduledoc """
  canonical Request IR 的工具目录视图与本次选择查询（VS-00L §19.1）。

  `tools` 与 `projection.tool_choice` 是唯一来源；本模块只做规范化与
  provider-neutral 查询，不查 Gateway、不猜实际路由或本阶段意图。投影与
  执行边界消费同一视图，避免各自复制工具判定。
  """

  alias NovelAgent.Provider.RequestIR

  @type tool_spec :: %{
          required(:name) => String.t(),
          required(:input_schema) => map(),
          optional(:description) => String.t()
        }

  @doc "本次请求声明的工具目录（规范化视图；`tools` 是唯一来源）。"
  @spec tool_specs(RequestIR.t()) :: [tool_spec()]
  def tool_specs(%RequestIR{tools: tools}), do: normalize_tool_specs(tools)

  @doc "本次请求的 `projection.tool_choice`；未声明时为 nil。"
  @spec tool_choice(RequestIR.t()) :: String.t() | nil
  def tool_choice(%RequestIR{projection: projection}), do: Map.get(projection, :tool_choice)

  @doc "工具调用模式：目录非空且未被 `tool_choice: none` 显式禁用。"
  @spec tool_call_prompt?(RequestIR.t()) :: boolean()
  def tool_call_prompt?(%RequestIR{} = ir),
    do: tool_specs(ir) != [] and tool_choice(ir) != "none"

  @doc """
  本次请求明确选中的唯一工具。

  多工具 `auto`/`required`、禁用或未声明的选择都返回 nil；这里不猜 provider
  路由或本阶段意图。
  """
  @spec active_tool_name(RequestIR.t()) :: String.t() | nil
  def active_tool_name(%RequestIR{} = ir) do
    names = Enum.map(tool_specs(ir), & &1.name)

    case tool_choice(ir) do
      choice when choice in [nil, "auto", "required"] -> single_tool_name(names)
      "none" -> nil
      name -> if name in names, do: name
    end
  end

  # 工具目录的唯一规范化视图：只保留 Provider 可投影的字段，schema 键统一为
  # 字符串；非法条目丢弃而不是伪造默认 schema（目录事实由 RequestIR.validate/1
  # 校验，本模块不重复报错）。
  defp normalize_tool_specs(specs) when is_list(specs) do
    Enum.flat_map(specs, fn spec ->
      name = field(spec, :name)
      schema = field(spec, :input_schema) || field(spec, :parameters)

      if is_binary(name) and name != "" and is_map(schema) do
        [
          %{
            name: name,
            description: to_string(field(spec, :description) || ""),
            input_schema: RequestIR.json_value(schema)
          }
        ]
      else
        []
      end
    end)
  end

  defp normalize_tool_specs(_specs), do: []

  defp single_tool_name([name]), do: name
  defp single_tool_name(_names), do: nil

  defp field(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, to_string(key))

  defp field(_map, _key), do: nil
end
