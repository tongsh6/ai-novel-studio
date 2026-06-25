defmodule NovelApplication.CreativeDecisionPacketBuilder do
  @moduledoc """
  组装一次创作决策的输入载体 CreativeDecisionPacket（VS-00E §4）。

  packet 聚合一次 turn 的创作决策输入（坐标 / 章方向 / 读者效果 / 目标章 / 作者输入 /
  来源 turn），供 `ProseExecutionBriefBuilder` 消费产出场级执行简述。

  packet 不是作品事实，是一次 turn 的决策载体（plain map）。CP1 为最小聚合，后续
  checkpoint 可在此扩展 continuity / style_intent 等维度。
  """

  @type input :: %{
          optional(:coordinate) => term(),
          optional(:chapter_direction) => term(),
          optional(:reader_effect_brief) => term(),
          optional(:chapter) => map(),
          optional(:author_input) => String.t(),
          optional(:source_turn_ref) => String.t()
        }

  @spec build(input()) :: map()
  def build(inputs) when is_map(inputs) do
    %{
      "coordinate" => Map.get(inputs, :coordinate),
      "chapter_direction" => Map.get(inputs, :chapter_direction),
      "reader_effect_brief" => Map.get(inputs, :reader_effect_brief),
      "chapter" => Map.get(inputs, :chapter, %{}),
      "author_input" => Map.get(inputs, :author_input, ""),
      "source_turn_ref" => Map.get(inputs, :source_turn_ref)
    }
  end
end
