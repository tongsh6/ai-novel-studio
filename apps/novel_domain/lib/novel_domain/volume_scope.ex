defmodule NovelDomain.VolumeScope do
  @moduledoc """
  开新卷动作的机械规划范围（B11A CP3 / VS-00J §3.2 形态 A / ADR-0028）。

  作者在工作台点「规划下一卷」时，服务端从阅读投影 TOC **机械推导**本轮只该规划
  哪一卷、下一章号从哪起——不让模型/前端猜（ADR-0025 机械准备判据）。scope 是
  设计态输入（随 turn 消费、不落作品事实）；采纳仍走既有 outline_draft 候选/采纳/
  物化链路，本模块不写任何权威层。

  `scope` 形状（atom keys，`normalize/1` 校验后）：

  - `next_seq`：本轮要规划的下一卷序号（卷序 append-only，取 max(seq)+1）
  - `current_volume_seq` / `current_volume_title`：当前末卷（作者核对锚点）
  - `next_chapter_seq`：全书下一章号（章号 work 级全局续排，AU08 CP1 不变量）
  - `existing_volume_count` / `existing_chapter_count`：已有卷/章计数（进度参照）

  纯函数、无 I/O（domain 纪律）。
  """

  @section_title "## 本轮规划范围（机械给定，不得改）"
  @section_title_marker "本轮规划范围（机械给定，不得改）"

  @type t :: %{
          next_seq: pos_integer(),
          current_volume_seq: pos_integer(),
          current_volume_title: String.t(),
          next_chapter_seq: pos_integer(),
          existing_volume_count: non_neg_integer(),
          existing_chapter_count: non_neg_integer()
        }

  @doc "规划范围段标题（渲染与外部证据共用同一常量）。"
  @spec section_title() :: String.t()
  def section_title, do: @section_title

  @doc "规划范围段标题的识别标记（测试替身/证据按真实文本识别，不认 slice/env）。"
  @spec section_marker() :: String.t()
  def section_marker, do: @section_title_marker

  @doc """
  从阅读投影 TOC 机械推导「规划下一卷」范围。

  - TOC 无任何已采纳卷 → `{:error, :no_volume_to_extend}`（无卷可续，必须走立项/首卷规划）；
  - 当前卷取 `seq` 最大者；下一章号取全书章 `seq` 最大值 + 1（章号全局续排）；
  - 下一卷序号取 `max(vol.seq) + 1`（VS-00J §2.2 卷序 append-only；正常连续数据下
    等于「卷数 + 1」）。
  """
  @spec from_toc(map() | nil) :: {:ok, t()} | {:error, :no_volume_to_extend}
  def from_toc(toc) when is_map(toc) do
    volumes = toc |> get(:volumes) |> List.wrap() |> Enum.filter(&is_map/1)

    case volumes do
      [] ->
        {:error, :no_volume_to_extend}

      _ ->
        last_volume = Enum.max_by(volumes, &volume_seq/1)
        chapters = Enum.flat_map(volumes, &chapter_list/1)

        {:ok,
         %{
           next_seq: volume_seq(last_volume) + 1,
           current_volume_seq: volume_seq(last_volume),
           current_volume_title: volume_title(last_volume),
           next_chapter_seq: next_chapter_seq(chapters),
           existing_volume_count: length(volumes),
           existing_chapter_count: length(chapters)
         }}
    end
  end

  def from_toc(_toc), do: {:error, :no_volume_to_extend}

  @doc """
  确定性渲染「本轮规划范围（机械给定，不得改）」段。

  `nil`/非法 scope → `""`（诚实缺席，不改既有 prompt 字节）。
  """
  @spec render_section(t() | map() | nil) :: String.t()
  def render_section(nil), do: ""

  def render_section(scope) when is_map(scope) do
    case normalize(scope) do
      nil ->
        ""

      scope ->
        [
          @section_title,
          "- 本轮只规划下一卷：第 #{scope.next_seq} 卷",
          "- 当前已有 #{scope.existing_volume_count} 卷，当前卷《#{scope.current_volume_title}》，" <>
            "已有 #{scope.existing_chapter_count} 章",
          "- 下一章号从 #{scope.next_chapter_seq} 开始（全书章号全局续排，不得重排已有章）",
          "- 不要重规划已有卷/已有章；不要改写已有卷的卷蓝图",
          "- 必须为该卷产出一条「卷蓝图：卷标题｜序号：#{scope.next_seq}｜…」行" <>
            "（单行，子槽用｜分隔）",
          "- 为该卷开篇章节标注「所属卷：卷标题」（与该卷蓝图行的卷标题一致）"
        ]
        |> Enum.join("\n")
    end
  end

  def render_section(_scope), do: ""

  @doc """
  校验并归一 scope：拒绝负/非整数/空标题字段，`nil`/非法 → nil。
  """
  @spec normalize(map() | nil) :: t() | nil
  def normalize(nil), do: nil

  def normalize(%{} = scope) do
    next_seq = get(scope, :next_seq)
    current_volume_seq = get(scope, :current_volume_seq)
    current_volume_title = scope |> get(:current_volume_title) |> normalize_title()
    next_chapter_seq = get(scope, :next_chapter_seq)
    existing_volume_count = get(scope, :existing_volume_count)
    existing_chapter_count = get(scope, :existing_chapter_count)

    if positive_integer?(next_seq) and positive_integer?(current_volume_seq) and
         current_volume_title != "" and positive_integer?(next_chapter_seq) and
         non_negative_integer?(existing_volume_count) and
         non_negative_integer?(existing_chapter_count) do
      %{
        next_seq: next_seq,
        current_volume_seq: current_volume_seq,
        current_volume_title: current_volume_title,
        next_chapter_seq: next_chapter_seq,
        existing_volume_count: existing_volume_count,
        existing_chapter_count: existing_chapter_count
      }
    end
  end

  def normalize(_scope), do: nil

  # ── helpers ─────────────────────────────────────────

  defp volume_seq(volume) do
    case get(volume, :seq) do
      seq when is_integer(seq) and seq > 0 -> seq
      _ -> 0
    end
  end

  defp volume_title(volume) do
    case volume |> get(:title) |> normalize_title() do
      "" -> "未命名卷"
      title -> title
    end
  end

  defp chapter_list(volume) do
    volume |> get(:chapters) |> List.wrap() |> Enum.filter(&is_map/1)
  end

  defp next_chapter_seq([]), do: 1

  defp next_chapter_seq(chapters) do
    chapters
    |> Enum.map(fn chapter ->
      case get(chapter, :seq) do
        seq when is_integer(seq) and seq > 0 -> seq
        _ -> 0
      end
    end)
    |> Enum.max()
    |> Kernel.+(1)
  end

  defp get(map, key) when is_map(map) do
    Map.get(map, key, Map.get(map, Atom.to_string(key)))
  end

  defp get(_map, _key), do: nil

  defp normalize_title(value) when is_binary(value), do: String.trim(value)
  defp normalize_title(_value), do: ""

  defp positive_integer?(value), do: is_integer(value) and value > 0
  defp non_negative_integer?(value), do: is_integer(value) and value >= 0
end
