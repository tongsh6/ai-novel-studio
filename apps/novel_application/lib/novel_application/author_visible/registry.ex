defmodule NovelApplication.AuthorVisible.Registry do
  @moduledoc """
  作者可见显示名的完整性诊断（只读）。

  `JudgmentToolContract` 是判断协议工具目录的唯一来源；本模块只回答
  「这些真实工具 code 是否都在作者可见 SSOT 登记」以及提供显示名查询，
  不做运行时拦截（完整性由生成期与测试保证）。
  """

  alias NovelApplication.JudgmentToolContract
  alias NovelCommon.AuthorVisible.Display

  @doc "判断协议全部工具 code（judgment + continuation，去重排序）。"
  @spec judgment_tool_codes() :: [String.t()]
  def judgment_tool_codes do
    (JudgmentToolContract.tools(:judgment) ++ JudgmentToolContract.tools(:continuation))
    |> Enum.map(& &1.name)
    |> Enum.uniq()
    |> Enum.sort()
  end

  @doc "未登记作者可见显示名的判断工具（应为空；新增工具忘登记时测试红）。"
  @spec missing_tool_displays() :: [String.t()]
  def missing_tool_displays do
    Enum.reject(judgment_tool_codes(), &Display.known?(:tool, &1))
  end

  @doc "工具 code 的作者显示名（测试/诊断用）。"
  @spec tool_display(String.t()) :: String.t()
  def tool_display(code), do: Display.label(:tool, code)
end
