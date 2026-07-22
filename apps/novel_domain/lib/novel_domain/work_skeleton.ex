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

  @avg_chapter_length 1400
  @closure_threshold 0.85

  @type snapshot :: %{optional(atom()) => any()}

  @doc """
  渲染全书骨架段 + 收官守则。`written_chapters` = 当前已写章数。

  无 `target_length`（骨架未立）→ 返回 ""（诚实缺席，06 §5.0；由 R6 负债规则催办，
  不在此伪造骨架）。有则渲染骨架事实+进度+收官守则（距目标尚远时指令式禁终局）。
  """
  @spec render(snapshot(), non_neg_integer()) :: String.t()
  def render(snapshot, written_chapters) when is_map(snapshot) and is_integer(written_chapters) do
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

        "## 全书规划（连载参照）\n" <> facts <> "\n" <> closure_directive(progress)
    end
  end

  def render(_snapshot, _written), do: ""

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

  @doc "策略化参数（供 application/负债规则共用一致口径）。"
  @spec avg_chapter_length() :: pos_integer()
  def avg_chapter_length, do: @avg_chapter_length

  @spec closure_threshold() :: float()
  def closure_threshold, do: @closure_threshold

  defp target_length(snapshot) do
    case Map.get(snapshot, :target_length, Map.get(snapshot, "target_length")) do
      n when is_integer(n) and n > 0 -> n
      _ -> nil
    end
  end

  defp volume_line(snapshot) do
    case Map.get(snapshot, :planned_volumes, Map.get(snapshot, "planned_volumes")) do
      n when is_integer(n) and n > 0 -> "- 预计卷数：#{n}"
      _ -> nil
    end
  end

  defp serial_line(snapshot) do
    case Map.get(snapshot, :serial_form, Map.get(snapshot, "serial_form")) do
      s when is_binary(s) and s != "" -> "- 连载形态：#{s}"
      _ -> nil
    end
  end
end
