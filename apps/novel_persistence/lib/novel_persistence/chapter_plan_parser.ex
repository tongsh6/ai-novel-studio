defmodule NovelPersistence.ChapterPlanParser do
  @moduledoc """
  已采纳章节计划文本的唯一解析口径。

  章节计划内容（采纳 outline 时的正文）约定：每行一章，格式 `标题: 摘要`（摘要可缺省）。
  这里把它解析为有序章节条目，供两处共用，避免各写一套数据逻辑：

  - `AdoptionRepository`：采纳章节计划时物化为 accepted 卷/章结构（AU-08 目录来源）。
  """

  @type chapter :: %{seq: pos_integer(), title: String.t(), summary: String.t() | nil}

  @doc "解析章节计划文本为有序章节条目（seq 从 1 起）。空标题行被丢弃。"
  @spec parse(String.t() | nil) :: [chapter()]
  def parse(content) when is_binary(content) do
    content
    |> String.split("\n", trim: true)
    |> Enum.map(&parse_line/1)
    |> Enum.reject(&(&1.title == ""))
    |> Enum.with_index(1)
    |> Enum.map(fn {chapter, seq} -> %{chapter | seq: seq} end)
  end

  def parse(_content), do: []

  defp parse_line(line) do
    case String.split(line, ": ", parts: 2) do
      [title, summary] -> %{seq: 0, title: String.trim(title), summary: String.trim(summary)}
      [title] -> %{seq: 0, title: String.trim(title), summary: nil}
    end
  end
end
