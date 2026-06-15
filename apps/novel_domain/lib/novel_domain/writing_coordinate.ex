defmodule NovelDomain.WritingCoordinate do
  @moduledoc """
  写作坐标（VS-00C CP0 / `08-novel-element-model.md` §7）。

  把"这一轮到底在写哪里、处于什么写作模式"从散落在执行服务里的
  `authoring_intent` + 目标章临时推断，固化为一等值对象。

  纯值对象：意图仍由 AI / Planner 产出（`authoring_intent`），本模块只做**确定性归一**，
  不重新判定意图（不引入关键字意图判断）。
  """

  @type authoring_mode ::
          :planning | :first_draft | :continuation | :rewrite | :revision | :maintenance | :none
  @type target_unit :: :work | :volume | :chapter | :scene | :passage | nil

  @type t :: %__MODULE__{
          work_ref: String.t() | nil,
          authoring_mode: authoring_mode(),
          target_unit: target_unit(),
          target_chapter: String.t(),
          requested_chapter: String.t(),
          source_turn_ref: String.t() | nil,
          source_input_ref: String.t() | nil
        }

  defstruct work_ref: nil,
            authoring_mode: :none,
            target_unit: nil,
            target_chapter: "",
            requested_chapter: "",
            source_turn_ref: nil,
            source_input_ref: nil

  @doc """
  从已解析的动作信息推导写作坐标。

  入参 map 字段：
  - `:capability`：工具名（如 "prose_writing" / "plot_outline"）
  - `:authoring_intent`：AI 产出的写作意图（`:none | :continuation | :rewrite | nil`）
  - `:target_chapter`：应用层确定性解析后的目标章（已命中/回退）
  - `:requested_chapter`：作者本轮显式请求的目标章（解析/回退前的原值，供缺失判定）
  - `:work_ref` / `:source_turn_ref` / `:source_input_ref`：可选
  """
  @spec derive(map()) :: t()
  def derive(attrs) when is_map(attrs) do
    mode = authoring_mode(attrs[:capability], attrs[:authoring_intent])

    %__MODULE__{
      work_ref: attrs[:work_ref],
      authoring_mode: mode,
      target_unit: target_unit(mode),
      target_chapter: normalize(attrs[:target_chapter]),
      requested_chapter: normalize(attrs[:requested_chapter]),
      source_turn_ref: attrs[:source_turn_ref],
      source_input_ref: attrs[:source_input_ref]
    }
  end

  defp authoring_mode("plot_outline", _intent), do: :planning
  defp authoring_mode("prose_writing", :continuation), do: :continuation
  defp authoring_mode("prose_writing", :rewrite), do: :rewrite
  defp authoring_mode("prose_writing", _intent), do: :first_draft
  defp authoring_mode(_capability, _intent), do: :none

  defp target_unit(:planning), do: :work

  defp target_unit(mode) when mode in [:first_draft, :continuation, :rewrite, :revision],
    do: :chapter

  defp target_unit(_mode), do: nil

  defp normalize(value) when is_binary(value), do: String.trim(value)
  defp normalize(_value), do: ""
end
