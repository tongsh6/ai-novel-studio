defmodule NovelDomain.CharacterIdentity do
  @moduledoc """
  角色身份归并规则（AU12）：同名/别名/改名三种创作意图下「两行归一」的纯计算。

  name 不是身份主键——真重名/别名/改名是三种创作意图，机器不得自动判定，
  合并只能由作者从档案侧显式发起。本模块只计算归并后果，不做任何 I/O：

  - `merge_plan/3`：target 行吸收 source 行的称呼集合（主名归属由作者选择）
  - `absorb_arc_plan/3`：两行各自的弧光账条目如何归一（吸收/改挂/改标签）
  """

  alias NovelFoundation.Enums.AdoptionStatus

  @mergeable_statuses [AdoptionStatus.accepted(), AdoptionStatus.edited_accepted()]

  @type character :: %{
          optional(atom()) => term(),
          id: term(),
          work_id: term(),
          name: String.t()
        }

  @doc """
  归并计划：返回 target 行合并后的 `name`/`aliases`。

  `keep_name`："target"（默认，别名情形）或 "source"（改名情形：换主名，
  旧主名转为别名）。两行必须同属一部作品、互不相同、且都处于已采纳态
  （tentative 假定行有自己的确认/否决通道，不走合并）。
  """
  @spec merge_plan(character(), character(), String.t()) ::
          {:ok, %{name: String.t(), aliases: [String.t()]}} | {:error, atom()}
  def merge_plan(target, source, keep_name \\ "target")

  def merge_plan(%{id: id}, %{id: id}, _keep_name), do: {:error, :cannot_merge_self}

  def merge_plan(%{work_id: w1}, %{work_id: w2}, _keep_name) when w1 != w2,
    do: {:error, :cross_work_merge_forbidden}

  def merge_plan(target, source, keep_name) when keep_name in ["target", "source"] do
    cond do
      not mergeable?(target) -> {:error, :target_not_mergeable}
      not mergeable?(source) -> {:error, :source_not_mergeable}
      true -> {:ok, build_plan(target, source, keep_name)}
    end
  end

  def merge_plan(_target, _source, _keep_name), do: {:error, :invalid_keep_name}

  defp build_plan(target, source, keep_name) do
    merged_name = if keep_name == "source", do: source.name, else: target.name

    aliases =
      ((target[:aliases] || []) ++ [target.name, source.name] ++ (source[:aliases] || []))
      |> Enum.map(&normalize_alias/1)
      |> Enum.reject(&(&1 == "" or &1 == merged_name))
      |> Enum.uniq()

    %{name: merged_name, aliases: aliases}
  end

  defp normalize_alias(value) when is_binary(value), do: String.trim(value)
  defp normalize_alias(_), do: ""

  defp mergeable?(character), do: Map.get(character, :status) in @mergeable_statuses

  @doc """
  弧光账归一计划。入参为两行各自的 arc 条目（map 或 nil），返回执行指令：

  - `:noop` — 双方都没有条目
  - `{:relabel, attrs}` — 只有 target 有条目：主名变化时同步 `subject_label`
  - `{:repoint, attrs}` — 只有 source 有条目：整条改挂 target（不撞唯一索引）
  - `{:absorb, %{target_attrs: attrs, delete_entry: source_entry}}` — 双方都有：
    target 条目吸收 source 的 `source_refs` 并集与更新的进度 payload，
    source 条目删除（数据已吸收；留行必成对账噪声——RETIRED 无任何消费方过滤）
  """
  @spec absorb_arc_plan(map() | nil, map() | nil, %{id: term(), name: String.t()}) ::
          :noop
          | {:relabel, map()}
          | {:repoint, map()}
          | {:absorb, %{target_attrs: map(), delete_entry: map()}}
  def absorb_arc_plan(target_entry, source_entry, merged_target)

  def absorb_arc_plan(nil, nil, _merged_target), do: :noop

  def absorb_arc_plan(target_entry, nil, merged_target) do
    if entry_field(target_entry, :subject_label) == merged_target.name do
      :noop
    else
      {:relabel, %{subject_label: merged_target.name}}
    end
  end

  def absorb_arc_plan(nil, _source_entry, merged_target) do
    {:repoint,
     %{
       subject_ref: to_string(merged_target.id),
       subject_label: merged_target.name
     }}
  end

  def absorb_arc_plan(target_entry, source_entry, merged_target) do
    newer =
      if last_seen_seq(source_entry) > last_seen_seq(target_entry),
        do: source_entry,
        else: target_entry

    refs =
      (entry_field(target_entry, :source_refs) || []) ++
        (entry_field(source_entry, :source_refs) || [])

    {:absorb,
     %{
       target_attrs: %{
         subject_label: merged_target.name,
         status: entry_field(newer, :status),
         payload: entry_field(newer, :payload) || %{},
         last_event_chapter: entry_field(newer, :last_event_chapter),
         source_refs: Enum.uniq(refs)
       },
       delete_entry: source_entry
     }}
  end

  defp last_seen_seq(entry) do
    case entry_field(entry, :payload) do
      %{} = payload -> to_seq(payload["last_seen_seq"] || payload[:last_seen_seq])
      _ -> -1
    end
  end

  defp to_seq(seq) when is_integer(seq), do: seq
  defp to_seq(_), do: -1

  defp entry_field(entry, key), do: Map.get(entry, key) || Map.get(entry, to_string(key))
end
