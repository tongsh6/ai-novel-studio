defmodule NovelPersistence.ChapterPlanParser do
  @moduledoc """
  已采纳章节计划文本的唯一解析口径。

  章节计划内容（采纳 outline 时的正文）兼容两种格式：

  - 旧格式：每行一章，`标题: 摘要`（摘要可缺省）。
  - CP4 结构格式：每章以 `标题: ...` 开头，后续多行可包含 E18-E22 标签
    （章功能定位 / 情节推进 / 人物变化 / 信息释放 / 伏笔动作 / 情绪定位 / 章首拉力 /
    章尾断章 / 字数与场次）。

  这里把它解析为有序章节条目，供两处共用，避免各写一套数据逻辑：

  - `AdoptionRepository`：采纳章节计划时物化为 accepted 卷/章结构（AU-08 目录来源）。
  """

  alias NovelDomain.ChapterPlanDirection

  @direction_label_groups [
    chapter_role: ["章功能定位", "功能定位", "章功能"],
    plot_progress: ["情节推进", "剧情推进", "主线推进"],
    character_change: ["人物变化", "人物弧光", "人物状态", "人物状态与弧光"],
    information_release: ["信息释放", "信息揭示", "真相释放"],
    foreshadowing_action: ["伏笔动作", "伏笔", "伏笔处理"],
    emotion: ["情绪定位", "情绪基调", "读者情绪"],
    opening_hook: ["章首拉力", "开篇钩子", "开场钩子", "章首钩子"],
    ending_hook: ["章尾断章", "断章要求", "结尾钩子", "悬念断点"],
    word_count_and_scenes: ["字数与场次", "字数与场次划分", "场次划分", "字数"]
  ]

  @direction_fields Map.new(
                      for {field, labels} <- @direction_label_groups,
                          label <- labels,
                          do: {label, field}
                    )

  # AU08 CP2：卷归属逐章标注（`所属卷：第一卷`）。它不是章的「方向」（E18-E22 九字段是
  # 写作指导），而是结构归属，故独立成 chapter 字段而非塞进 plan_direction。
  # 选逐章标注而非卷标题分隔行：标注自描述、不依赖行序，重排/追加不会串卷。
  @volume_labels ["所属卷", "卷归属", "所属分卷"]

  @type chapter :: %{
          seq: pos_integer(),
          title: String.t(),
          summary: String.t() | nil,
          plan_direction: map() | nil,
          volume_title: String.t() | nil
        }

  @doc "解析章节计划文本为有序章节条目（seq 从 1 起）。空标题行被丢弃。"
  @spec parse(String.t() | nil) :: [chapter()]
  def parse(content) when is_binary(content) do
    content
    |> lines()
    |> chapter_blocks()
    |> Enum.map(&parse_block/1)
    |> Enum.reject(&(&1.title == ""))
    |> Enum.with_index(1)
    |> Enum.map(fn {chapter, seq} -> %{chapter | seq: seq} end)
  end

  def parse(_content), do: []

  defp lines(content) do
    content
    |> String.split("\n")
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
  end

  defp chapter_blocks(lines) do
    lines
    |> Enum.reduce([], fn line, blocks ->
      if chapter_start_line?(line) or blocks == [] do
        [[line] | blocks]
      else
        [current | rest] = blocks
        [[line | current] | rest]
      end
    end)
    |> Enum.reverse()
    |> Enum.map(&Enum.reverse/1)
  end

  # 标注行不得被当成新章的起始行。卷标注若用 ASCII 冒号加空格写成 `所属卷: 第一卷`，
  # 会命中 `contains?(": ")` —— 不把它算进 label_line? 就会当场劈出一个空章。
  defp chapter_start_line?(line) do
    not label_line?(line) and
      (String.contains?(line, ": ") or Regex.match?(~r/^第\s*[0-9０-９一二三四五六七八九十百]+\s*[章节回]/u, line))
  end

  defp parse_block([first | rest]) do
    {title, initial} = parse_title_and_initial(first)
    body_lines = [initial | rest] |> Enum.reject(&blank?/1)
    {volume_title, direction_lines} = extract_volume_title(body_lines)
    direction = direction_lines |> Enum.join("\n") |> parse_direction()

    %{
      seq: 0,
      title: title,
      summary: summary(initial, direction),
      plan_direction: ChapterPlanDirection.to_storage(direction),
      volume_title: volume_title
    }
  end

  defp parse_block(_block),
    do: %{seq: 0, title: "", summary: nil, plan_direction: nil, volume_title: nil}

  # 卷标注抽出后不再参与方向解析与摘要计算：它是结构归属，不该混进写作指导文本。
  defp extract_volume_title(lines) do
    {volume_lines, rest} = Enum.split_with(lines, &volume_label_line?/1)

    volume_title =
      volume_lines
      |> Enum.find_value(fn line ->
        case split_label(line) do
          {:ok, _label, value} -> blank_to_nil(value)
          :error -> nil
        end
      end)

    {volume_title, rest}
  end

  defp volume_label_line?(line) do
    case split_label(line) do
      {:ok, label, _value} -> normalize_direction_label(label) in @volume_labels
      :error -> false
    end
  end

  defp parse_title_and_initial(line) do
    case String.split(line, ": ", parts: 2) do
      [title, initial] -> {String.trim(title), String.trim(initial)}
      [title] -> {String.trim(title), nil}
    end
  end

  defp parse_direction(text) when is_binary(text) do
    text
    |> String.split(~r/\n|；|;/u)
    |> Enum.map(&String.trim/1)
    |> Enum.reduce(%{}, &put_direction_field/2)
    |> ChapterPlanDirection.new()
  end

  defp parse_direction(_text), do: nil

  defp put_direction_field(line, acc) do
    case split_label(line) do
      {:ok, label, value} ->
        case direction_field(label) do
          nil -> acc
          field -> Map.put(acc, field, value)
        end

      :error ->
        acc
    end
  end

  defp split_label(line) do
    case Regex.run(~r/^([^:：]+)[:：]\s*(.+)$/u, line) do
      [_, label, value] -> {:ok, String.trim(label), String.trim(value)}
      _ -> :error
    end
  end

  defp direction_label_line?(line) do
    case split_label(line) do
      {:ok, label, _value} -> not is_nil(direction_field(label))
      :error -> false
    end
  end

  defp label_line?(line), do: direction_label_line?(line) or volume_label_line?(line)

  defp direction_field(label) do
    label
    |> normalize_direction_label()
    |> then(&Map.get(@direction_fields, &1))
  end

  defp normalize_direction_label(label), do: label |> String.replace(~r/\s/u, "") |> String.trim()

  defp summary(initial, direction) do
    cond do
      not blank?(initial) and not direction_label_line?(initial) ->
        String.trim(initial)

      not ChapterPlanDirection.empty?(direction) ->
        direction |> ChapterPlanDirection.summary() |> blank_to_nil()

      true ->
        nil
    end
  end

  defp blank_to_nil(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp blank_to_nil(_value), do: nil

  defp blank?(value), do: not is_binary(value) or String.trim(value) == ""
end
