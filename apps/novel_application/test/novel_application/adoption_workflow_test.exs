defmodule NovelApplication.AdoptionWorkflowTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AdoptionWorkflow

  describe "handle_adopt/2" do
    test "evaluates a pending artifact through adoption boundary" do
      source_turn = source_turn_result()

      assert {:ok, action_result, turn_result} =
               AdoptionWorkflow.handle_adopt(source_turn, %{
                 "artifact_id" => "as-1",
                 "artifact_type" => "character_seed",
                 "payload" => %{"title" => "角色方向"}
               })

      assert action_result.status == "accepted"
      assert action_result.action_type == "adopt"
      assert action_result.decision.decision_type == :adopt_tentative
      assert "candidate_adopted_as_tentative" in action_result.decision.reason_codes
      assert action_result.persistence.persisted == false

      assert turn_result.parent_turn_id == "turn-source"
      assert turn_result.truthfulness.artifact_adopted == true
      assert turn_result.truthfulness.production_write_performed == false
      assert turn_result.adoption_state.pending == []
      assert [%{adoption_status: "ACCEPTED", requires_adoption: false}] = turn_result.adoption_state.resolved
      assert [%{refresh_status: "STALE", source_revision_refs: ["decision:" <> _]}] = turn_result.projection_refs
    end

    test "uses injected persistence writer and exposes persisted state refs" do
      source_turn = source_turn_result()

      writer = fn attrs ->
        assert attrs.work_id == "work-1"
        assert attrs.source_turn_ref == "turn-source"
        assert attrs.artifact_id == "as-1"
        assert attrs.content == "主角更果断"

        {:ok,
         %{
           mutation_id: "mutation-1",
           mutation_status: "APPLIED",
           memory_item_id: "memory-1",
           memory_status: "CONFIRMED",
           source_revision_ref: "mutation:mutation-1"
         }}
      end

      assert {:ok, action_result, turn_result} =
               AdoptionWorkflow.handle_adopt(
                 source_turn,
                 %{"artifact_id" => "as-1", "work_id" => "work-1"},
                 writer
               )

      assert action_result.persistence.persisted == true
      assert action_result.persistence.mutation_id == "mutation-1"
      assert [%{mutation_ref: "mutation-1", adopted_state_ref: "memory-1"}] =
               turn_result.adoption_state.resolved
      assert [%{source_revision_refs: ["mutation:mutation-1"], refresh_status: "STALE"}] =
               turn_result.projection_refs
      assert turn_result.truthfulness.production_write_performed == true
      assert turn_result.truthfulness.state_persisted == true
    end

    test "rejects stale revision base" do
      source_turn = source_turn_result(%{revision_base: "7"})

      assert {:error, "stale artifact revision"} =
               AdoptionWorkflow.handle_adopt(source_turn, %{
                 "artifact_id" => "as-1",
                 "base_revision" => 6
               })
    end

    test "rejects unknown pending artifact" do
      assert {:error, "pending artifact not found"} =
               AdoptionWorkflow.handle_adopt(source_turn_result(), %{"artifact_id" => "missing"})
    end
  end

  defp source_turn_result(artifact_attrs \\ %{}) do
    %{
      turn_id: "turn-source",
      adoption_state: %{
        pending: [
          Map.merge(
            %{
              artifact_id: "as-1",
              artifact_type: :character_seed,
              adoption_status: :tentative,
              requires_adoption: true,
              source_tool_result_ref: "tr-1",
              payload: %{title: "角色方向", content: "主角更果断"}
            },
            artifact_attrs
          )
        ],
        resolved: []
      },
      trace_summary: %{trace_id: "trace-source"}
    }
  end
end
