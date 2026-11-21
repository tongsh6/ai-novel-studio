defmodule NovelApplication.ChapterListBudget do
  @moduledoc """
  章节结构条目的有界投影。

  章数不超过 12 时全列；超限时保留首章、最近 6 章和作者点名章。
  原条目的身份、当前序号和标题保持不变，返回准确的遗漏数量，
  由既有调用方写入结构事实、覆盖范围和不足说明。
  """

  @full_list_threshold 12
  @recent_count 6

  @doc """
  投影章节条目，返回 {listed_entries, omitted_count}，保持输入顺序。

  按条目的真实身份保留同名、同序的不同章节。
  """
  @spec project_entries([map()], String.t() | nil) :: {[map()], non_neg_integer()}
  def project_entries(entries, author_text \\ nil)

  def project_entries(entries, _author_text) when length(entries) <= @full_list_threshold,
    do: {entries, 0}

  def project_entries(entries, author_text) do
    named =
      entries
      |> Enum.map(&entry_field(&1, :title, ""))
      |> named_chapter_titles(author_text)
      |> MapSet.new()

    keep_keys =
      entries
      |> Enum.take(1)
      |> Kernel.++(Enum.take(entries, -@recent_count))
      |> Kernel.++(Enum.filter(entries, &MapSet.member?(named, entry_field(&1, :title, ""))))
      |> MapSet.new(&entry_key/1)

    listed = Enum.filter(entries, &MapSet.member?(keep_keys, entry_key(&1)))
    {listed, length(entries) - length(listed)}
  end

  defp entry_field(entry, key, default) do
    case Map.get(entry, key) do
      value when is_binary(value) -> String.trim(value)
      nil -> default
      other -> other
    end
  end

  defp entry_key(entry) do
    {entry_field(entry, :title, ""), Map.get(entry, :seq), Map.get(entry, :id)}
  end

  # 作者点名章匹配：正文里出现的 第N章/第N卷 序号词（阿拉伯/全角/中文数字），
  # 命中标题即保留。确定性文本匹配，不做语义猜测。
  @doc false
  @spec named_chapter_titles([String.t()], String.t() | nil) :: [String.t()]
  def named_chapter_titles(_titles, nil), do: []

  def named_chapter_titles(titles, author_text) when is_binary(author_text) do
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

  def named_chapter_titles(_titles, _author_text), do: []
end
