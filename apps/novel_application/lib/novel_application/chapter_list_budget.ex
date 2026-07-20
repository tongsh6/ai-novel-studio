defmodule NovelApplication.ChapterListBudget do
  @moduledoc """
  章节列表的有界投影（T2a，call2 病灶结构性收口）。

  病灶数据：判断/起草 prompt 的章节段随章数**无界增长**，M2 长跑实证 call2
  结构化可靠性随上下文长度递减（17 章形态下 capability=null 高频）且模型调用
  时延劣化拖垮交互节奏。这也违反 08 §2.2 教义——dump 全表与窗口大小无关地错误。

  投影规则（确定性，机械准备判据成立）：

  - 章数 ≤ `@full_list_threshold`：全列（既有小作品行为不变）。
  - 超限：首章 + 最近 `@recent_count` 章全名 + **作者点名章**（正文中出现的
    `第N章`/`第N卷` 序号词精确匹配的章全名——target_chapter 精确复制契约的
    依赖项，点名章必须在列）+ 折叠说明行（总数与省略说明）。

  P2-P4 千章规模本来必需的设计（领域拉动成立），弱模型只是提前逼出它。
  """

  @full_list_threshold 12
  @recent_count 6

  @doc """
  投影章节全名列表。`author_text` 用于点名章匹配（nil 则只按首/尾投影）。

  返回 `{listed_titles, omitted_count}`：`listed_titles` 保持原顺序；
  `omitted_count` 为被折叠的章数（0 表示全列）。
  """
  @spec project([String.t()], String.t() | nil) :: {[String.t()], non_neg_integer()}
  def project(titles, author_text \\ nil)

  def project(titles, _author_text) when length(titles) <= @full_list_threshold,
    do: {titles, 0}

  def project(titles, author_text) do
    named = named_chapter_titles(titles, author_text)

    keep =
      MapSet.new(
        Enum.take(titles, 1) ++ Enum.take(titles, -@recent_count) ++ named
      )

    listed = Enum.filter(titles, &MapSet.member?(keep, &1))
    {listed, length(titles) - length(listed)}
  end

  @doc "渲染投影后的章节段正文（含折叠说明行；调用方自拼段标题）。"
  @spec render_lines([String.t()], non_neg_integer(), non_neg_integer()) :: String.t()
  def render_lines(listed, omitted_count, total) do
    lines = Enum.map_join(listed, "\n", &"- #{&1}")

    if omitted_count > 0 do
      lines <>
        "\n（共 #{total} 章；中段 #{omitted_count} 章从略——只列首章、最近 #{@recent_count} 章与作者点名章。）"
    else
      lines
    end
  end

  # 作者点名章匹配：正文里出现的 第N章/第N卷 序号词（阿拉伯/全角/中文数字），
  # 命中标题即保留。确定性文本匹配，不做语义猜测。
  defp named_chapter_titles(_titles, nil), do: []

  defp named_chapter_titles(titles, author_text) when is_binary(author_text) do
    tokens =
      ~r/第[\s]*[0-9０-９一二三四五六七八九十百零两]+[\s]*[章卷回]/u
      |> Regex.scan(author_text)
      |> List.flatten()
      |> Enum.map(&String.replace(&1, ~r/\s/, ""))
      |> Enum.uniq()

    Enum.filter(titles, fn title ->
      normalized = String.replace(title, ~r/\s/, "")
      Enum.any?(tokens, &String.contains?(normalized, &1))
    end)
  end

  defp named_chapter_titles(_titles, _author_text), do: []
end
