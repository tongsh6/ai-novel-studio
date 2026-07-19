defmodule NovelDomain.ChapterSummary do
  @moduledoc """
  章摘要（连续性层，VS-00C §5 / `domain/22-continuity-model.md` §10/§16/§17）。

  **写后内容压缩**：对某一章已采纳正文的高信息密度总结，用于续写衔接、跨章连续性与
  long-run resume。与 `chapters.summary`（**计划摘要**，规划采纳时落下的写前大纲意图）是
  两个不同对象——本对象不是 chapter 偷塞一个 summary 字段（契约 §5.1）。

  状态走 artifact adoption 七态：产出即 TENTATIVE，自动采纳转 ACCEPTED；同章正文重写/续写
  再次采纳后旧 ACCEPTED 摘要置 SUPERSEDED、生成新 tentative（revision_base 指向新正文）。
  转换合法性复用 `NovelDomain.AdoptionStatus`（ADR-0019），状态常量取
  `NovelFoundation.Enums.AdoptionStatus`。

  `summary_text` 按要素四栏结构组织（`08` §7：一个对象同时喂四本账的最小近似）：
  情节推进 / 人物状态与弧光 / 伏笔动作 / 情绪基调。`render_sections/1` 把四栏 map 渲染为
  canonical 文本，`four_column?/1` 校验文本是否含全部四栏（供 maintenance 降级判定与验收）。
  """

  alias NovelDomain.AdoptionStatus, as: Transitions
  alias NovelFoundation.Enums.AdoptionStatus, as: Status

  # 四栏顺序与标签（契约 §5.2）。顺序固定，渲染与校验同源。
  @section_order [:plot, :characters, :foreshadowing, :mood]
  @section_labels %{
    plot: "情节推进",
    characters: "人物状态与弧光",
    foreshadowing: "伏笔动作",
    mood: "情绪基调"
  }

  @type t :: %__MODULE__{
          id: String.t() | nil,
          work_id: String.t(),
          chapter_id: String.t(),
          status: String.t(),
          summary_text: String.t(),
          source_ref: String.t() | nil,
          revision_base: String.t() | nil
        }

  @enforce_keys [:work_id, :chapter_id, :summary_text]
  defstruct id: nil,
            work_id: nil,
            chapter_id: nil,
            status: nil,
            summary_text: nil,
            source_ref: nil,
            revision_base: nil

  @doc "新建一条 tentative 章摘要（产出即 TENTATIVE）。"
  @spec new(map()) :: t()
  def new(attrs) when is_map(attrs) do
    %__MODULE__{
      id: get(attrs, :id),
      work_id: fetch!(attrs, :work_id),
      chapter_id: fetch!(attrs, :chapter_id),
      status: Status.tentative(),
      summary_text: fetch!(attrs, :summary_text),
      source_ref: get(attrs, :source_ref),
      revision_base: get(attrs, :revision_base)
    }
  end

  @doc "TENTATIVE → ACCEPTED（自动采纳，契约 §6.2 用户决策）。"
  @spec accept(t()) :: {:ok, t()} | {:error, {:illegal_transition, String.t(), String.t()}}
  def accept(%__MODULE__{} = summary), do: transition(summary, Status.accepted())

  @doc "ACCEPTED/EDITED_ACCEPTED → SUPERSEDED（同章正文更新后旧摘要退场）。"
  @spec supersede(t()) :: {:ok, t()} | {:error, {:illegal_transition, String.t(), String.t()}}
  def supersede(%__MODULE__{} = summary), do: transition(summary, Status.superseded())

  @doc "是否当前有效 canon 摘要（ACCEPTED/EDITED_ACCEPTED）。"
  @spec canon?(t()) :: boolean()
  def canon?(%__MODULE__{status: status}), do: status in Transitions.canon_statuses()

  @doc "四栏顺序。"
  @spec section_order() :: [atom()]
  def section_order, do: @section_order

  @doc "四栏标签映射。"
  @spec section_labels() :: %{atom() => String.t()}
  def section_labels, do: @section_labels

  @doc """
  把四栏 map 渲染成 canonical `summary_text`。

  缺栏以「（无）」占位，保证渲染结果始终四栏齐全（`four_column?/1` 恒为 true）。
  """
  @spec render_sections(map()) :: String.t()
  def render_sections(sections) when is_map(sections) do
    Enum.map_join(@section_order, "\n", fn key ->
      "【#{@section_labels[key]}】" <> section_body(sections, key)
    end)
  end

  @doc """
  从 canonical `summary_text` 解析回四栏 map（`render_sections/1` 的逆变换）。

  确定性标签解析：只认识【标签】前缀行，未知标签忽略、缺栏键缺席（不伪造）、
  「（无）」占位还原为缺席。无任何标签时整段归 :plot（与生成侧兜底同语义）。
  五本账等按维度消费（M3）与探索面结构化渲染统一走本入口。
  """
  @spec parse_sections(String.t() | nil) :: %{atom() => String.t()}
  def parse_sections(text) when is_binary(text) do
    by_label = Map.new(@section_labels, fn {key, label} -> {label, key} end)

    sections =
      text
      |> String.split("【", trim: true)
      |> Enum.reduce(%{}, fn chunk, acc ->
        case String.split(chunk, "】", parts: 2) do
          [label, body] ->
            case Map.get(by_label, String.trim(label)) do
              nil -> acc
              key -> put_section(acc, key, String.trim(body))
            end

          _ ->
            acc
        end
      end)

    case {map_size(sections), String.trim(text)} do
      {0, ""} -> %{}
      {0, trimmed} -> %{plot: trimmed}
      _ -> sections
    end
  end

  def parse_sections(_text), do: %{}

  defp put_section(acc, _key, ""), do: acc
  defp put_section(acc, _key, "（无）"), do: acc
  defp put_section(acc, key, body), do: Map.put(acc, key, body)

  @doc "校验文本是否含全部四栏标签（四栏结构成立）。"
  @spec four_column?(any()) :: boolean()
  def four_column?(text) when is_binary(text) do
    Enum.all?(@section_order, fn key ->
      String.contains?(text, "【#{@section_labels[key]}】")
    end)
  end

  def four_column?(_), do: false

  defp transition(%__MODULE__{status: from} = summary, to) do
    if Transitions.transition_allowed?(from, to) do
      {:ok, %{summary | status: to}}
    else
      {:error, {:illegal_transition, from, to}}
    end
  end

  defp section_body(sections, key) do
    case get(sections, key) do
      value when is_binary(value) ->
        case String.trim(value) do
          "" -> "（无）"
          trimmed -> trimmed
        end

      _ ->
        "（无）"
    end
  end

  defp fetch!(attrs, key), do: get(attrs, key) || raise(KeyError, key: key, term: attrs)
  defp get(attrs, key), do: Map.get(attrs, key) || Map.get(attrs, to_string(key))
end
