defmodule NovelDomain.ExportDocument do
  @moduledoc """
  全书导出文档渲染（确定性纯函数，无 IO）。

  P1-export-minimum（docs/product/novel-output-milestones.md §7 #5）：导出完整
  Markdown，目录与章节顺序可验证。输入是阅读投影的单一作品事实源
  （AU-08：已采纳卷/章结构 + 各章已采纳正文），本模块只负责把它渲染成文档：

  - 头部元信息（标题 / 导出时间 / 章节总数 / 全书有效字数）；
  - 目录段：全部章节按卷内 seq 顺序列出（含尚无正文的计划章）；
  - 正文段：逐卷逐章输出已采纳正文；无正文的章诚实占位，不编造内容。

  未采纳草稿不在输入里（阅读投影口径），因此天然不会进入导出。
  """

  @empty_chapter_placeholder "（本章暂无已采纳正文）"

  @type scene :: %{optional(:title) => String.t() | nil, content: String.t() | nil}

  @doc """
  渲染全书 Markdown。

  - `volumes`：阅读投影 `toc` 的卷/章结构（章含 `:title`/`:seq`/`:id`）。
  - `scenes_by_chapter`：章 id → 该章已采纳场景列表（`chapter_content` 口径）。
  - `meta`：`:exported_at`（ISO8601 字符串）、`:total_word_count`。
  """
  @spec render(String.t(), [map()], %{String.t() => [scene()]}, map()) :: String.t()
  def render(work_title, volumes, scenes_by_chapter, meta) do
    chapters = all_chapters(volumes)

    [
      "# #{work_title}",
      "",
      "- 导出时间：#{Map.get(meta, :exported_at, "")}",
      "- 章节总数：#{length(chapters)}",
      "- 全书有效字数：#{Map.get(meta, :total_word_count, 0)}",
      "",
      "## 目录",
      "",
      toc_lines(chapters),
      "",
      "---",
      "",
      body_sections(volumes, scenes_by_chapter)
    ]
    |> List.flatten()
    |> Enum.join("\n")
    |> String.trim_trailing()
    |> Kernel.<>("\n")
  end

  @doc "导出文件名（不含扩展名）：作品标题去掉路径分隔等非法字符。"
  @spec filename(String.t()) :: String.t()
  def filename(work_title) do
    sanitized =
      work_title
      |> String.replace(~r{[/\\:*?"<>|]}u, "_")
      |> String.trim()

    if sanitized == "", do: "未命名作品", else: sanitized
  end

  defp all_chapters(volumes) do
    Enum.flat_map(volumes, &(Map.get(&1, :chapters) || []))
  end

  defp toc_lines(chapters) do
    chapters
    |> Enum.with_index(1)
    |> Enum.map(fn {chapter, index} -> "#{index}. #{chapter.title}" end)
  end

  defp body_sections(volumes, scenes_by_chapter) do
    Enum.flat_map(volumes, fn volume ->
      ["# #{volume.title}", ""] ++ chapters_body(volume, scenes_by_chapter)
    end)
  end

  defp chapters_body(volume, scenes_by_chapter) do
    volume
    |> Map.get(:chapters)
    |> List.wrap()
    |> Enum.flat_map(fn chapter ->
      ["## #{chapter.title}", ""] ++ chapter_prose(chapter, scenes_by_chapter) ++ [""]
    end)
  end

  defp chapter_prose(chapter, scenes_by_chapter) do
    prose =
      scenes_by_chapter
      |> Map.get(chapter.id, [])
      |> Enum.map(&(&1[:content] || ""))
      |> Enum.reject(&(String.trim(&1) == ""))

    case prose do
      [] -> ["> #{@empty_chapter_placeholder}"]
      sections -> Enum.intersperse(sections, "")
    end
  end
end
