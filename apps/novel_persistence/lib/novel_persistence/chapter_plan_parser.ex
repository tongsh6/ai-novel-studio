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
  alias NovelDomain.VolumeBlueprint

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

  # NEM04 刀③：场级计划逐场标注（`场次：标题｜目标：…｜议程：…｜情绪：…`）。
  # 子槽用｜分隔（避开方向解析的；切分）；标题必填，缺则整行丢弃；行序即场次 seq。
  # B11C CP1：子槽词表扩到 VS-00E §1 scene_units 已冻结的场级结构全集（因果/信息差/
  # 对白/感官）；全部可选，旧标注无新子槽时解析结果逐字节不变。
  @scene_labels ["场次", "场景"]

  @scene_slot_labels %{
    "目标" => "goal",
    "场景目标" => "goal",
    "议程" => "agendas",
    "人物议程" => "agendas",
    "出场人物议程" => "agendas",
    "情绪" => "emotion",
    "情绪定位" => "emotion",
    "阻力" => "opposition",
    "冲突" => "opposition",
    "转折" => "turn",
    "后果" => "consequence",
    "读者得知" => "reader_learns",
    "读者知道" => "reader_learns",
    "主角得知" => "protagonist_learns",
    "仍隐藏" => "remains_hidden",
    "隐藏" => "remains_hidden",
    "对白表面" => "surface_topic",
    "潜台词" => "hidden_conflict",
    "感官" => "sensory",
    "时空感官" => "sensory"
  }

  # B11A CP2（VS-00J §3.1）：plot_outline 卷蓝图行——每卷一行，`｜` 分隔子槽：
  # `卷蓝图：第一卷｜序号：1｜目标冲突：…｜支线启动：…｜…`。抽取必须先于章块解析：
  # 卷块标题若写成 ASCII 冒号加空格（`卷蓝图: 第二卷: 裂变`）会命中 chapter_start_line?
  # 的 `contains?(": ")`，不先抽离就劈出假章（`第二卷：裂变` 已知雷）。子槽标签词表
  # 复用 `NovelDomain.VolumeBlueprint.slot_key/1`（与渲染/存储白名单同源，不各写一份）。
  @volume_blueprint_labels ["卷蓝图"]
  @volume_seq_label "序号"
  @volume_blueprint_separator ~r/[｜|]/u
  # 单行解析纪律：模型把长行折断时续行以｜开头——续行直接丢弃（既不入蓝图，也不参与
  # 章块解析；`|支线启动: x` 同样会劈假章/污染正文）。
  @volume_blueprint_continuation ~r/^[｜|]/u

  @type chapter :: %{
          seq: pos_integer(),
          title: String.t(),
          summary: String.t() | nil,
          plan_direction: map() | nil,
          volume_title: String.t() | nil
        }

  @typedoc "卷蓝图块：卷身份 (title, seq) 与设计槽归一 map（无设计槽时为空 map）。"
  @type volume_blueprint :: %{
          seq: pos_integer(),
          title: String.t(),
          blueprint: map()
        }

  @doc "解析章节计划文本为有序章节条目（seq 从 1 起）。空标题行被丢弃。"
  @spec parse(String.t() | nil) :: [chapter()]
  def parse(content), do: parse_with_volumes(content).chapters

  @doc """
  解析章节计划文本，同时抽取卷蓝图行（B11A CP2 / VS-00J §3.1）。

  返回 `%{chapters: [chapter()], volume_blueprints: [volume_blueprint()]}`：

  - 卷蓝图行先于章块抽取（防假章），`序号` 缺省时按出现顺序 1..n，标题必填否则整行丢弃；
  - 无卷蓝图行时 `volume_blueprints: []`，章节与仅 `parse/1` 时逐字节一致（I-VOL-4）。
  """
  @spec parse_with_volumes(String.t() | nil) :: %{
          chapters: [chapter()],
          volume_blueprints: [volume_blueprint()]
        }
  def parse_with_volumes(content) when is_binary(content) do
    {chapter_lines, volume_blueprints} =
      content
      |> lines()
      |> extract_volume_blueprints()

    %{
      chapters:
        chapter_lines
        |> chapter_blocks()
        |> Enum.map(&parse_block/1)
        |> Enum.reject(&(&1.title == ""))
        |> Enum.with_index(1)
        |> Enum.map(fn {chapter, seq} -> %{chapter | seq: seq} end),
      volume_blueprints: volume_blueprints
    }
  end

  def parse_with_volumes(_content), do: %{chapters: [], volume_blueprints: []}

  defp lines(content) do
    content
    |> String.split("\n")
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
  end

  # ── 卷蓝图行抽取（B11A CP2 / VS-00J §3.1）──────────────────────────────
  # 单趟纪律：卷蓝图行 → 场次行 → 章块（见 parse_block 内 extract_scene_plans）。
  # 卷蓝图行先抽离，剩余行才参与章块判定；续行丢弃（单行解析）。
  defp extract_volume_blueprints(lines) do
    {blueprint_lines, chapter_lines} = Enum.split_with(lines, &volume_blueprint_label_line?/1)

    {Enum.reject(chapter_lines, &volume_blueprint_continuation_line?/1),
     parse_volume_blueprint_lines(blueprint_lines)}
  end

  defp volume_blueprint_label_line?(line) do
    case split_label(line) do
      {:ok, label, _value} -> normalize_direction_label(label) in @volume_blueprint_labels
      :error -> false
    end
  end

  defp volume_blueprint_continuation_line?(line),
    do: Regex.match?(@volume_blueprint_continuation, line)

  defp parse_volume_blueprint_lines(lines) do
    lines
    |> Enum.map(&parse_volume_blueprint_line/1)
    |> Enum.reject(&is_nil/1)
    |> Enum.with_index(1)
    |> Enum.map(fn {blueprint, position} -> %{blueprint | seq: blueprint.seq || position} end)
  end

  # `卷蓝图：卷标题｜序号：N｜目标冲突：…｜…`；标题必填（空标题整行丢弃）。
  defp parse_volume_blueprint_line(line) do
    case split_label(line) do
      {:ok, _label, value} ->
        [title_part | slot_parts] = String.split(value, @volume_blueprint_separator)
        title = String.trim(title_part)

        if title == "" do
          nil
        else
          {seq, slot_parts} = extract_volume_seq(slot_parts)

          %{seq: seq, title: title, blueprint: volume_blueprint_slots(slot_parts)}
        end

      :error ->
        nil
    end
  end

  # `序号` 是卷身份的一部分（(work_id, seq)），不进蓝图 map；缺省/非法时回落行序。
  defp extract_volume_seq(slot_parts) do
    {seq, rest} = Enum.reduce(slot_parts, {nil, []}, &extract_volume_seq_part/2)
    {seq, Enum.reverse(rest)}
  end

  defp extract_volume_seq_part(part, {seq, rest}) do
    case split_label(part) do
      {:ok, label, value} ->
        if normalize_direction_label(label) == @volume_seq_label do
          {positive_integer(value), rest}
        else
          {seq, [part | rest]}
        end

      :error ->
        {seq, [part | rest]}
    end
  end

  # 子槽键口径与存储白名单同源（VolumeBlueprint.slot_key/1）；未知标签/空值丢弃。
  defp volume_blueprint_slots(parts) do
    parts
    |> Enum.reduce(%{}, fn part, acc ->
      with {:ok, label, value} <- split_label(part),
           key when is_binary(key) <-
             VolumeBlueprint.slot_key(normalize_direction_label(label)),
           trimmed when trimmed != "" <- String.trim(value) do
        Map.put(acc, key, trimmed)
      else
        _ -> acc
      end
    end)
    |> VolumeBlueprint.to_storage()
    |> Kernel.||(%{})
  end

  defp positive_integer(value) do
    case value |> normalize_digits() |> String.trim() |> Integer.parse() do
      {int, ""} when int > 0 -> int
      _ -> nil
    end
  end

  # 全角数字（０-９）→ ASCII：模型偶发全角输出，序号按缺失回落行序而非报错。
  defp normalize_digits(value) do
    value
    |> String.to_charlist()
    |> Enum.map(fn
      digit when digit in 0xFF10..0xFF19 -> digit - 0xFF10 + ?0
      other -> other
    end)
    |> List.to_string()
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
    {volume_title, body_lines} = extract_volume_title(body_lines)
    {scene_plans, direction_lines} = extract_scene_plans(body_lines)
    direction = direction_lines |> Enum.join("\n") |> parse_direction()
    direction = with_scene_plans(direction, scene_plans)

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

  # 场次行先抽取后参与方向解析（volume_title 同先例）：它是逐场结构，不该混进
  # 章级写作指导文本。
  defp extract_scene_plans(lines) do
    {scene_lines, rest} = Enum.split_with(lines, &scene_label_line?/1)

    plans =
      scene_lines
      |> Enum.map(&parse_scene_line/1)
      |> Enum.reject(&is_nil/1)

    {plans, rest}
  end

  defp scene_label_line?(line) do
    case split_label(line) do
      {:ok, label, _value} -> normalize_direction_label(label) in @scene_labels
      :error -> false
    end
  end

  defp parse_scene_line(line) do
    case split_label(line) do
      {:ok, _label, value} ->
        [title_part | slot_parts] = String.split(value, ~r/[｜|]/u)
        title = String.trim(title_part)

        if title == "" do
          nil
        else
          slot_parts
          |> Enum.reduce(%{"title" => title}, &put_scene_slot/2)
        end

      :error ->
        nil
    end
  end

  defp put_scene_slot(part, acc) do
    with {:ok, label, value} <- split_label(part),
         key when is_binary(key) <-
           Map.get(@scene_slot_labels, normalize_direction_label(label)) do
      Map.put(acc, key, value)
    else
      _ -> acc
    end
  end

  defp with_scene_plans(direction, []), do: direction

  defp with_scene_plans(nil, scene_plans),
    do: ChapterPlanDirection.new(%{scene_plans: scene_plans})

  defp with_scene_plans(direction, scene_plans) do
    direction
    |> Map.from_struct()
    |> Map.put(:scene_plans, scene_plans)
    |> ChapterPlanDirection.new()
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

  # 场次行也必须算 label 行——写成 ASCII `场次: 对账` 会命中 `contains?(": ")`，
  # 不拦就当场劈出假章（AU08 卷标注同款雷）。
  # 卷蓝图行同样算 label 行（与场次/卷标注同款防护）：即使某一行走不到先抽取，
  # ASCII 冒号写法也绝不能被当成章起始行。
  defp label_line?(line),
    do:
      direction_label_line?(line) or volume_label_line?(line) or scene_label_line?(line) or
        volume_blueprint_label_line?(line)

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

  defp blank?(value), do: not is_binary(value) or String.trim(value) == ""
end
