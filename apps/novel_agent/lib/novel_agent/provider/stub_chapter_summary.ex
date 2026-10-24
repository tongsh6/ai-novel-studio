defmodule NovelAgent.Provider.StubChapterSummary do
  @moduledoc """
  B27 CP3d：stub provider 与 SliceVerify 共用的「章摘要确定性四栏」测试 fixture。

  单一真源说明：stub 位于 `novel_agent/lib`（test-only provider，lib 编译期必须自洽），
  SliceVerify 位于 `novel_agent/test/support`；lib 不能反向引用 test/support，因此共享
  fixture 放在 lib 的 test-only provider 命名空间，由两者共同调用。

  本模块只做确定性渲染（根据生产 prompt 的「连续性维护助手 + 已采纳正文：」契约），
  不含业务规则、不改变产品 prompt，也不参与生产 runtime（stub/slice_verify 均只在测试
  或外部验收 harness 中注入）。
  """

  @prompt_marker "连续性维护助手"

  @doc "是否为章摘要生成 prompt（与生产 ChapterSummaryGenerator 的稳定角色句一致）。"
  @spec prompt?(String.t() | nil) :: boolean()
  def prompt?(text) when is_binary(text), do: String.contains?(text, @prompt_marker)
  def prompt?(_text), do: false

  @doc """
  确定性四栏 body：正文首行归「人物状态与弧光」（复刻真实模型把出场人物写进人物栏，
  令弧光账提炼可命中真实角色名），其余归「情节推进」。
  """
  @spec body(String.t() | nil) :: String.t()
  def body(prompt_text) when is_binary(prompt_text) do
    prose =
      case Regex.run(~r/已采纳正文：\n(.+)\z/su, prompt_text) do
        [_, text] -> String.trim(text)
        _ -> ""
      end

    lines = String.split(prose, "\n", trim: true)
    first_line = List.first(lines) || "（无）"
    plot = lines |> Enum.drop(1) |> Enum.join("") |> String.slice(0, 120)

    "【情节推进】#{if plot == "", do: "（无）", else: plot}\n" <>
      "【人物状态与弧光】#{first_line}\n【伏笔动作】（无）\n【情绪基调】紧张推进"
  end

  def body(_prompt_text), do: body("")
end
