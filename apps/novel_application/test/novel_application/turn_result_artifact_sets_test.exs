defmodule NovelApplication.TurnResultArtifactSetsTest do
  use ExUnit.Case, async: true

  alias NovelApplication.TurnResultBuilder
  alias NovelCommon.Contracts.ToolResult
  alias NovelDomain.DialogueFrame
  alias NovelDomain.TentativeArtifactSet

  test "一次 TurnResult 合并多个既有 seed set，并保持逐项采纳 target 类型" do
    frame = %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-inventory",
      turn_id: "turn-inventory",
      workspace_id: "work-inventory",
      primary: false,
      frame_type: :execution_candidate,
      source_refs: %{author_input_ref: "turn-source"},
      dialogue_goal: %{summary: "盘点正文设定"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "设定盘点完成，请逐项确认。"},
      evidence_summary: %{},
      uncertainty: []
    }

    tool_result = %ToolResult{
      tool_result_id: "tr-inventory",
      tool_request_ref: "req-inventory",
      tool_name: "fact_inventory",
      status: :succeeded,
      output: %{item_count: 3}
    }

    sets = [
      set(:character_seed, [
        item("char-1", "沈砚"),
        item("char-2", "云栖")
      ]),
      set(:world_rule_seed, [item("rule-1", "灵气计费")])
    ]

    result = TurnResultBuilder.build_artifact_sets(frame, %{}, nil, tool_result, sets)

    assert Enum.map(result.ui_cards, & &1.artifact_type) == [
             :character_seed,
             :world_rule_seed
           ]

    assert Enum.map(result.adoption_state.pending, & &1.artifact_type) == [
             :character_seed,
             :character_seed,
             :world_rule_seed
           ]

    assert Enum.map(result.adoption_state.pending, & &1.artifact_id) == [
             "as-character_seed::char-1",
             "as-character_seed::char-2",
             "as-world_rule_seed"
           ]

    assert length(result.available_actions) == 9
    assert Enum.all?(result.adoption_state.pending, &(&1.adoption_status == :tentative))
    refute result.truthfulness.production_write_performed
    refute result.truthfulness.artifact_adopted
  end

  defp set(type, items) do
    %TentativeArtifactSet{
      artifact_set_id: "as-#{type}",
      artifact_type: type,
      items: items,
      source_turn_ref: "turn-inventory",
      source_tool_result_ref: "tr-inventory",
      adoption_status: :tentative
    }
  end

  defp item(id, title),
    do: %{item_id: id, title: title, body: "#{title}正文", rationale: "依据第1章"}
end
