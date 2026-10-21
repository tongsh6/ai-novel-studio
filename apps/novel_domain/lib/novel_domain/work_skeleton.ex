defmodule NovelDomain.WorkSkeleton do
  @moduledoc """
  全书骨架（VS-00G §2.4 / NEM-GAP-08）：规划期"朝多长写、怎么连载"的意图投影 +
  收官守则。纯函数（domain 纪律）。

  CA01"在场但无效"判例的直接修正：字段在场≠守则生效——本模块把骨架事实（目标体量/
  卷数/连载形态 + 当前进度）与**指令式收官守则**一起渲染，供规划 prompt 决策点邻近注入。
  收官守则专治 M3 收官循环（扩章批每批自带终局→漂移点火器）。

  `avg_chapter_length` / `closure_threshold` 为策略化估算参数（默认值来源 milestones §3
  阶梯推导，非狗粮标定）；进度只作粗略信号，守则不依赖精确 P%。
  """

  alias NovelDomain.VolumeBlueprint
  alias NovelDomain.VolumeScope

  @avg_chapter_length 1400
  @closure_threshold 0.85

  # B11A CP5（VS-00J §4 item5 / §9 决策②）：卷级收束阈值——本卷计划章写入比例达到该值即
  # 提示接近收束。策略化估算（非狗粮标定），调整只经 Experience 回路 policy proposal
  # （与全书阈值同款纪律，I-L4 确定性不受影响）。
  @volume_closure_threshold 0.8

  @type snapshot :: %{optional(atom()) => any()}

  @doc """
  渲染全书骨架段 + 收官守则。`written_chapters` = 当前已写章数。

  无 `target_length`（骨架未立）→ 返回 ""（诚实缺席，06 §5.0；由 R6 负债规则催办，
  不在此伪造骨架）。有则渲染骨架事实+进度+收官守则（距目标尚远时指令式禁终局）。
  """
  @spec render(snapshot(), non_neg_integer()) :: String.t()
  def render(snapshot, written_chapters), do: render(snapshot, written_chapters, nil)

  @doc """
  渲染全书骨架段 + 收官守则；`volume_scope` 非 nil 时用**本轮规划范围**版分卷指令替换
  既有「全书分 planned_volumes 卷」指令（B11A CP3 开新卷动作：本轮只规划下一卷，
  避免与全书卷数指令冲突）。

  `volume_scope` 由 `NovelDomain.VolumeScope` 机械推导并 `normalize/1`；nil/非法 →
  与 `render/2` **逐字节一致**（既有行为不变）。
  """
  @spec render(snapshot(), non_neg_integer(), map() | nil) :: String.t()
  def render(snapshot, written_chapters, volume_scope)
      when is_map(snapshot) and is_integer(written_chapters) do
    case target_length(snapshot) do
      nil ->
        ""

      target when target > 0 ->
        est_chapters = ceil(target / @avg_chapter_length)
        progress = if est_chapters > 0, do: written_chapters / est_chapters, else: 0.0

        facts =
          [
            "- 目标体量：约 #{target} 字（预计 #{est_chapters} 章）",
            volume_line(snapshot),
            serial_line(snapshot),
            "- 当前进度：已写 #{written_chapters} 章（约全书 #{round(progress * 100)}%）"
          ]
          |> Enum.reject(&is_nil/1)
          |> Enum.join("\n")

        directives =
          [closure_directive(progress), volume_directive_for(snapshot, volume_scope)]
          |> Enum.reject(&(&1 == ""))
          |> Enum.join("\n")

        "## 全书规划（连载参照）\n" <> facts <> "\n" <> directives
    end
  end

  def render(_snapshot, _written, _volume_scope), do: ""

  @doc """
  正文向渲染（CA04 G1）：骨架事实 + 收官守则，**不含分卷守则**（「逐章标注所属卷」是
  规划指令，写章时是噪声）。骨架未立同样返回 ""（诚实缺席）。
  """
  @spec render_for_prose(snapshot(), non_neg_integer()) :: String.t()
  def render_for_prose(snapshot, written_chapters)
      when is_map(snapshot) and is_integer(written_chapters) do
    case target_length(snapshot) do
      nil ->
        ""

      target when target > 0 ->
        est_chapters = ceil(target / @avg_chapter_length)
        progress = if est_chapters > 0, do: written_chapters / est_chapters, else: 0.0

        facts =
          [
            "- 目标体量：约 #{target} 字（预计 #{est_chapters} 章）",
            serial_line(snapshot),
            "- 当前进度：已写 #{written_chapters} 章（约全书 #{round(progress * 100)}%）"
          ]
          |> Enum.reject(&is_nil/1)
          |> Enum.join("\n")

        "## 全书规划（连载参照）\n" <> facts <> "\n" <> closure_directive(progress)
    end
  end

  def render_for_prose(_snapshot, _written), do: ""

  @doc """
  卷分组守则（AU08 CP2）：`planned_volumes > 1` 时要求逐章标注所属卷。

  与收官守则同款——CA01「在场但无效」判例的第二次修正：`planned_volumes: 2` 此前只作为
  事实行渲染（「预计卷数：2」），模型看得到却没有任何指令要它真去分卷，于是全书章一律
  落进单一默认卷（B11 / NEM-GAP-07）。字段在场 ≠ 守则生效，故此处给出**指令式**分卷要求
  与精确到行的输出格式（`ChapterPlanParser` 的解析口径）。

  B11A CP2（VS-00J §3.1）：同一守则增补**卷蓝图行**格式说明——多卷时每卷另起一行写
  卷级蓝图（E14-E17 最小结构化槽），行格式与 `ChapterPlanParser.parse_with_volumes/1`
  的解析口径逐字一致，且必须单行（parser 只做单行解析，续行丢弃）。单卷书不发卷蓝图
  指令（无卷可蓝，逐章标注与蓝图行都是噪声；I-VOL-4 退化等价）。

  单卷（或未立卷数）不发指令——单卷书逐章标注是噪声。
  """
  @spec volume_directive(snapshot()) :: String.t()
  def volume_directive(snapshot) when is_map(snapshot) do
    case planned_volumes(snapshot) do
      n when is_integer(n) and n > 1 ->
        "分卷规划要求：全书分 #{n} 卷，每章必须在结构化方向中另起一行标注所属卷，" <>
          "格式为「所属卷：卷标题」（例：所属卷：第一卷）；同卷各章连续排列，" <>
          "卷标题在全书内保持一致，不要为同一卷起两个名字。\n" <>
          volume_blueprint_directive()

      _ ->
        ""
    end
  end

  def volume_directive(_snapshot), do: ""

  # B11A CP3：开新卷动作（形态 A）的 scope-aware 分卷指令——替换全书卷数版指令，
  # 让模型只规划机械给定的下一卷（不让模型/前端猜范围）。scope nil/非法 → 回退既有指令。
  defp volume_directive_for(snapshot, nil), do: volume_directive(snapshot)

  defp volume_directive_for(snapshot, volume_scope) do
    case VolumeScope.normalize(volume_scope) do
      nil -> volume_directive(snapshot)
      scope -> scoped_volume_directive(scope)
    end
  end

  defp scoped_volume_directive(scope) do
    "分卷规划要求（本轮范围受限）：本轮只规划第 #{scope.next_seq} 卷" <>
      "（当前已有 #{scope.existing_volume_count} 卷，当前卷《#{scope.current_volume_title}》）；" <>
      "每章标注所属卷：本轮新卷卷标题（必须与本轮卷蓝图行标题一致，不得沿用当前卷标题）；" <>
      "卷蓝图行序号 #{scope.next_seq}；下一章号从 #{scope.next_chapter_seq} 开始；" <>
      "不要重规划已有卷/已有章。\n" <>
      "卷蓝图要求：为本轮新卷产出一条单行「卷蓝图：卷标题｜序号：#{scope.next_seq}｜…」" <>
      "（子槽用｜分隔、标签与既有口径一致；没有把握的子槽可省略，但标签不要改写）。"
  end

  # 卷蓝图行格式：与 parser 的标签词表同源（`NovelDomain.VolumeBlueprint` 设计槽），
  # 单行、｜分隔。高潮章/缓冲章按 VS-00J §2.1 只允许章标题引用（章号是 work 级全局派生值）。
  defp volume_blueprint_directive do
    "卷蓝图要求：每卷另写一行卷蓝图（必须单行、子槽用｜分隔），" <>
      "格式为「卷蓝图：卷标题｜序号：N｜目标冲突：…｜弧光阶段：…｜地图边界：…｜" <>
      "支线启动：…｜支线推进：…｜支线收束：…｜高潮章：…｜爽点密度：…｜缓冲章：…｜" <>
      "新人物：…｜新设定：…｜新地图：…」，序号从 1 起；" <>
      "没有把握的子槽可省略，但标签不要改写；高潮章/缓冲章只写章标题、不写章号。"
  end

  @doc "收官守则文本：距目标体量尚远 → 指令式禁终局；接近 → 可安排收束。"
  @spec closure_directive(float()) :: String.t()
  def closure_directive(progress) when is_number(progress) do
    if progress < @closure_threshold do
      "写作规划要求：距目标体量尚远，本批不得规划终局/收官/大结局/完结章；" <>
        "每批只推进当前冲突，把新冲突留给后续；收官只在接近目标体量或作者明示时安排。"
    else
      "写作规划要求：已接近目标体量，可开始安排收束章，但仍需回收未兑现的伏笔与承诺。"
    end
  end

  @doc """
  卷级收束守则（B11A CP5 / VS-00J §4 item5 + §9 决策②）：全书收束守则优先（I-VOL-7）。

  - `volume_info`：`%{volume_title, written, total}`（可 nil / 缺卷标题 → `""`）；
  - `book_progress_percent`：全书进度百分比（0..100；nil=骨架未立/不可算，按「未知」处理，
    不抑制卷级守则）；
  - 全书进度 ≥ 全书收束阈值（#{round(@closure_threshold * 100)}%）→ `""`——全书层守则已覆盖，
    卷级不重复、不矛盾；
  - 本卷计划章已写完（written ≥ total > 0）→ 可确认本卷收束并转入下一卷（全书终局仍由
    全书进度守则裁决）；
  - 本卷写入比例 ≥ 卷级阈值（#{round(@volume_closure_threshold * 100)}%）→ 接近收束，优先回收
    本卷支线与小高潮，不得写全书终局；
  - 否则 → 允许本卷内小收束（解决本卷主冲突/回收支线），但不得写全书终局。

  纯函数、确定性、无 I/O。`opts` 为策略覆盖（测试/policy proposal 用）：
  `:book_closure_percent`（默认 #{round(@closure_threshold * 100)}）、`:volume_closure_threshold`
  （默认 #{@volume_closure_threshold}）；不传则用冻结默认口径。
  """
  @spec volume_closure_directive(map() | nil, number() | nil, keyword()) :: String.t()
  def volume_closure_directive(volume_info, book_progress_percent, opts \\ [])

  def volume_closure_directive(volume_info, book_progress_percent, opts)
      when is_map(volume_info) and is_list(opts) do
    title = normalize_title(info_value(volume_info, :volume_title))

    cond do
      title == "" ->
        ""

      book_closure?(book_progress_percent, opts) ->
        ""

      true ->
        volume_stage_directive(
          title,
          info_value(volume_info, :written),
          info_value(volume_info, :total),
          opts
        )
    end
  end

  def volume_closure_directive(_volume_info, _book_progress_percent, _opts), do: ""

  # 全书收束守则优先（I-VOL-7）：全书进度达阈值时卷级不再重复/矛盾。
  defp book_closure?(book_progress_percent, opts) do
    threshold = Keyword.get(opts, :book_closure_percent, @closure_threshold * 100)

    is_number(book_progress_percent) and is_number(threshold) and
      book_progress_percent >= threshold
  end

  defp volume_stage_directive(title, written, total, opts) do
    case volume_closure_stage(written, total, opts) do
      :complete -> volume_complete_directive()
      :near -> volume_near_closure_directive()
      :open -> volume_small_closure_directive(title)
    end
  end

  defp volume_closure_stage(written, total, opts) do
    cond do
      not positive_integer?(total) -> :open
      not is_integer(written) -> :open
      written >= total -> :complete
      written / total >= volume_closure_threshold(opts) -> :near
      true -> :open
    end
  end

  defp positive_integer?(value), do: is_integer(value) and value > 0

  defp volume_closure_threshold(opts),
    do: Keyword.get(opts, :volume_closure_threshold, @volume_closure_threshold)

  defp volume_complete_directive do
    "本卷计划章已写完：可确认本卷收束并转入下一卷；全书终局仍以全书进度守则为准。"
  end

  defp volume_near_closure_directive do
    "本卷接近收束：接下来优先回收本卷支线与小高潮；不得写全书终局/大结局/完结章。"
  end

  defp volume_small_closure_directive(title) do
    "本卷为「#{title}」：允许在本卷内做小收束（解决本卷主冲突/回收本卷支线），" <>
      "但不得写全书终局/大结局/完结章；收束后把新冲突留给后续卷。"
  end

  defp info_value(map, key), do: Map.get(map, key, Map.get(map, Atom.to_string(key)))

  defp normalize_title(value) when is_binary(value), do: String.trim(value)
  defp normalize_title(_value), do: ""

  @doc "策略化参数（供 application/负债规则共用一致口径）。"
  @spec avg_chapter_length() :: pos_integer()
  def avg_chapter_length, do: @avg_chapter_length

  @spec closure_threshold() :: float()
  def closure_threshold, do: @closure_threshold

  @doc """
  当前卷蓝图段（B11A CP4 / VS-00J §4 消费面 2/3）：把设计态卷级蓝图注入创作/规划 prompt。

  - 无卷标题或无 E14-E17 设计槽 → `""`（诚实缺席；与未引入卷蓝图时逐字节等价，I-VOL-4）；
  - `progress` = `%{written: n, total: n}`（可 nil / 缺键）——能算时渲染本卷进度行；
  - 与 `render_for_prose/2` 独立：卷蓝图是规划/写作共用的设计态参照，不属于全书骨架。
  """
  @spec volume_blueprint_section(String.t() | nil, map() | nil, map() | nil) :: String.t()
  def volume_blueprint_section(volume_title, blueprint, progress \\ nil)

  def volume_blueprint_section(volume_title, blueprint, progress)
      when is_binary(volume_title) and is_map(blueprint) do
    title = String.trim(volume_title)
    blueprint_lines = VolumeBlueprint.render_lines(blueprint)

    if title == "" or blueprint_lines == [] do
      ""
    else
      header =
        [
          "## 当前卷蓝图（设计态）",
          "- 卷：#{title}",
          volume_progress_line(progress)
        ]
        |> Enum.reject(&is_nil/1)
        |> Enum.join("\n")

      header <> "\n" <> Enum.join(blueprint_lines, "\n")
    end
  end

  def volume_blueprint_section(_volume_title, _blueprint, _progress), do: ""

  defp volume_progress_line(progress) when is_map(progress) do
    written = progress_value(progress, :written)
    total = progress_value(progress, :total)

    if is_integer(written) and is_integer(total) and total > 0 do
      "- 本卷进度：已写 #{written} / 共 #{total} 章"
    end
  end

  defp volume_progress_line(_progress), do: nil

  defp progress_value(progress, key),
    do: Map.get(progress, key, Map.get(progress, Atom.to_string(key)))

  @doc """
  进度口径（WR01 写前推理复用，与 `render/2` 同源）：骨架未立返回 nil。
  """
  @spec progress(snapshot(), non_neg_integer()) ::
          %{target_length: pos_integer(), est_chapters: pos_integer(), percent: non_neg_integer()}
          | nil
  def progress(snapshot, written_chapters)
      when is_map(snapshot) and is_integer(written_chapters) do
    case target_length(snapshot) do
      nil ->
        nil

      target ->
        est_chapters = max(ceil(target / @avg_chapter_length), 1)

        %{
          target_length: target,
          est_chapters: est_chapters,
          percent: round(written_chapters / est_chapters * 100)
        }
    end
  end

  def progress(_snapshot, _written_chapters), do: nil

  defp target_length(snapshot) do
    case Map.get(snapshot, :target_length, Map.get(snapshot, "target_length")) do
      n when is_integer(n) and n > 0 -> n
      _ -> nil
    end
  end

  defp volume_line(snapshot) do
    case planned_volumes(snapshot) do
      n when is_integer(n) and n > 0 -> "- 预计卷数：#{n}"
      _ -> nil
    end
  end

  defp planned_volumes(snapshot) do
    Map.get(snapshot, :planned_volumes, Map.get(snapshot, "planned_volumes"))
  end

  defp serial_line(snapshot) do
    case Map.get(snapshot, :serial_form, Map.get(snapshot, "serial_form")) do
      s when is_binary(s) and s != "" -> "- 连载形态：#{s}"
      _ -> nil
    end
  end
end
