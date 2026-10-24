defmodule NovelApplication.ChapterListBudget do
  @moduledoc """
  章节列表的有界投影（T2a，长上下文病灶结构性收口；历史两段式时期发现）。

  病灶数据：判断/起草 prompt 的章节段随章数**无界增长**，M2 长跑实证旧两段式
  结构调用（call2）结构性可靠性随上下文长度递减（17 章形态下 capability=null
  高频）且模型调用时延劣化拖垮交互节奏；单调用后仍保留同一有界投影纪律。
  这也违反 08 §2.2 教义——dump 全表与窗口大小无关地错误。

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
      MapSet.new(Enum.take(titles, 1) ++ Enum.take(titles, -@recent_count) ++ named)

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

  @doc """
  投影章节索引条目（B24 双面身份）：条目形如
  `%{title: String.t(), seq: integer | nil, id: String.t() | nil, has_prose: boolean}`。

  与 `project/2` 同规则（总数 ≤ 12 全列；超限保留首章 + 最近 6 章 + 作者点名章），
  但以**条目身份**（title+seq+id）保留重复标题的不同章，供模型按 `chapter_ref` 寻址。
  返回 `{listed_entries, omitted_count}`，顺序与投影前一致。
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

  @doc """
  渲染章节索引条目：带 id 的条目渲染为
  `- 第 3 章「恐惧体验」[chapter_ref=chapter:<uuid>]`（模型按 ref 寻址，I-READ-9）；
  无 id 的条目退回旧标题行（手工构造上下文/兼容路径）。
  """
  @spec render_entry_lines([map()], non_neg_integer(), non_neg_integer()) :: String.t()
  def render_entry_lines(entries, omitted_count, total) do
    lines = Enum.map_join(entries, "\n", &entry_line/1)

    if omitted_count > 0 do
      lines <>
        "\n（共 #{total} 章；中段 #{omitted_count} 章从略——只列首章、最近 #{@recent_count} 章与作者点名章。）"
    else
      lines
    end
  end

  @doc false
  @spec entry_line(map()) :: String.t()
  def entry_line(entry) do
    title = display_entry_title(entry)
    planned = if Map.get(entry, :has_prose) == false, do: "（计划中）", else: ""

    case Map.get(entry, :id) do
      id when is_binary(id) and id != "" ->
        ref = "chapter:#{id}"

        case Map.get(entry, :seq) do
          seq when is_integer(seq) -> "- 第 #{seq} 章「#{title}」[chapter_ref=#{ref}]#{planned}"
          _ -> "- 「#{title}」[chapter_ref=#{ref}]#{planned}"
        end

      _ ->
        "- #{title}#{planned}"
    end
  end

  # B30 CP3-P（Q06/Q07）：有当前 seq 时展示 seq 章号 + title core（剥历史“第NN章：”前缀），
  # 避免与真实 seq 双重编号；不改写存储 title。
  defp display_entry_title(entry) do
    title = entry_field(entry, :title, "")

    embedded = NovelApplication.ChapterDisplay.title_number(title)
    seq = Map.get(entry, :seq)

    if is_integer(seq) and is_binary(title) and title != "" and
         not (is_integer(embedded) and embedded == seq) do
      NovelApplication.ChapterDisplay.core_title(title)
    else
      title
    end
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
