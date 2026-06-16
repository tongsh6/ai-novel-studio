defmodule NovelDomain.ReaderEffectBrief do
  @moduledoc """
  写章前的读者效果目标，对齐 VS-00C CP5。

  它从章计划方向投影而来，告诉 prose_writing 本章要制造的情绪、张力、
  承诺和连载钩子；不是写后评价，也不会直接成为作品事实。
  """

  alias NovelDomain.ChapterPlanDirection

  @type t :: %__MODULE__{
          intended_emotion: String.t() | nil,
          tension_source: String.t() | nil,
          payoff_or_promise: String.t() | nil,
          suspense_boundary: String.t() | nil,
          hook_target: String.t() | nil,
          web_serial_risk_notes: [String.t()]
        }

  defstruct intended_emotion: nil,
            tension_source: nil,
            payoff_or_promise: nil,
            suspense_boundary: nil,
            hook_target: nil,
            web_serial_risk_notes: []

  @spec from_plan_direction(ChapterPlanDirection.t() | map() | nil) :: t() | nil
  def from_plan_direction(value) do
    case ChapterPlanDirection.from_storage(value) do
      nil ->
        nil

      direction ->
        new(%{
          intended_emotion: direction.emotion,
          tension_source: first_text([direction.plot_progress, direction.foreshadowing_action]),
          payoff_or_promise:
            first_text([direction.information_release, direction.character_change]),
          suspense_boundary: direction.ending_hook,
          hook_target: direction.opening_hook,
          web_serial_risk_notes: risk_notes(direction)
        })
    end
  end

  @spec new(map() | nil) :: t() | nil
  def new(nil), do: nil

  def new(attrs) when is_map(attrs) do
    brief = %__MODULE__{
      intended_emotion: clean(get_any(attrs, [:intended_emotion, "intended_emotion"])),
      tension_source: clean(get_any(attrs, [:tension_source, "tension_source"])),
      payoff_or_promise: clean(get_any(attrs, [:payoff_or_promise, "payoff_or_promise"])),
      suspense_boundary: clean(get_any(attrs, [:suspense_boundary, "suspense_boundary"])),
      hook_target: clean(get_any(attrs, [:hook_target, "hook_target"])),
      web_serial_risk_notes:
        attrs |> get_any([:web_serial_risk_notes, "web_serial_risk_notes"]) |> clean_list()
    }

    if empty?(brief), do: nil, else: brief
  end

  def new(_attrs), do: nil

  @spec empty?(t() | nil) :: boolean()
  def empty?(nil), do: true

  def empty?(%__MODULE__{} = brief) do
    text_empty? =
      [
        brief.intended_emotion,
        brief.tension_source,
        brief.payoff_or_promise,
        brief.suspense_boundary,
        brief.hook_target
      ]
      |> Enum.all?(&blank?/1)

    text_empty? and brief.web_serial_risk_notes == []
  end

  @spec to_storage(t() | nil) :: map() | nil
  def to_storage(nil), do: nil

  def to_storage(%__MODULE__{} = brief) do
    %{}
    |> put_text("intended_emotion", brief.intended_emotion)
    |> put_text("tension_source", brief.tension_source)
    |> put_text("payoff_or_promise", brief.payoff_or_promise)
    |> put_text("suspense_boundary", brief.suspense_boundary)
    |> put_text("hook_target", brief.hook_target)
    |> put_list("web_serial_risk_notes", brief.web_serial_risk_notes)
    |> empty_to_nil()
  end

  @spec prompt_lines(t() | nil) :: [String.t()]
  def prompt_lines(nil) do
    ["- 读者效果：未形成 ReaderEffectBrief（缺少结构化章方向，按计划摘要降级）"]
  end

  def prompt_lines(%__MODULE__{} = brief) do
    [
      "- 读者效果：ReaderEffectBrief（写前约束）",
      line("目标情绪", brief.intended_emotion),
      line("张力来源", brief.tension_source),
      line("承诺/爽点", brief.payoff_or_promise),
      line("悬念边界", brief.suspense_boundary),
      line("章首钩子", brief.hook_target),
      risk_line(brief.web_serial_risk_notes)
    ]
    |> Enum.reject(&blank?/1)
  end

  defp risk_notes(direction) do
    [
      if(blank?(direction.emotion), do: "缺少情绪定位：读者体验目标不明确"),
      if(blank?(direction.opening_hook), do: "缺少章首拉力：开篇吸引力可能不足"),
      if(blank?(direction.ending_hook), do: "缺少章尾断章：连载追读风险较高"),
      if(blank?(direction.information_release) and blank?(direction.foreshadowing_action),
        do: "信息释放与伏笔动作不足：本章承诺可能难以兑现"
      )
    ]
    |> Enum.reject(&blank?/1)
    |> case do
      [] -> ["不要削弱章首拉力、章尾断章和本章承诺；无法兑现时必须在 self_report.risk_flags 标出"]
      notes -> notes
    end
  end

  defp first_text(values), do: Enum.find(values, &(!blank?(&1)))

  defp line(_label, value) when value in [nil, ""], do: ""
  defp line(label, value), do: "- #{label}：#{value}"

  defp risk_line([]), do: ""
  defp risk_line(notes), do: "- 风险约束：" <> Enum.join(notes, "；")

  defp put_text(acc, _key, value) when value in [nil, ""], do: acc
  defp put_text(acc, key, value), do: Map.put(acc, key, value)

  defp put_list(acc, _key, []), do: acc
  defp put_list(acc, key, value), do: Map.put(acc, key, value)

  defp get_any(map, keys) do
    Enum.find_value(keys, fn key ->
      if Map.has_key?(map, key), do: Map.get(map, key)
    end)
  end

  defp clean(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp clean(_value), do: nil

  defp clean_list(values) when is_list(values) do
    values
    |> Enum.map(&clean/1)
    |> Enum.reject(&blank?/1)
  end

  defp clean_list(_values), do: []

  defp blank?(value), do: not is_binary(value) or String.trim(value) == ""

  defp empty_to_nil(map) when map == %{}, do: nil
  defp empty_to_nil(map), do: map
end
