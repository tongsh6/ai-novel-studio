defmodule NovelApplication.CharacterCandidatePerItemAdoptionTest do
  @moduledoc """
  AU-09 角色候选逐项采纳：多个角色候选必须各自拥有独立的待采纳动作；
  采纳候选 B 只写入 B 对应的 Character，候选 A 不被合并写入。
  """
  use ExUnit.Case, async: true

  alias NovelApplication.AdoptionWorkflow
  alias NovelApplication.AvailableActionBuilder
  alias NovelDomain.TentativeArtifactSet

  defp two_candidate_set do
    %TentativeArtifactSet{
      artifact_set_id: "as_chars",
      artifact_type: :character_seed,
      items: [
        %{item_id: "cand_a", title: "沈砚", body: "冷峻克制的稽查官", rationale: nil},
        %{item_id: "cand_b", title: "云栖", body: "游离秩序之外的线人", rationale: nil}
      ],
      source_turn_ref: "turn_src",
      source_tool_result_ref: "tr_src"
    }
  end

  describe "AvailableActionBuilder.artifact_actions 逐候选动作" do
    test "两个角色候选各有独立的 accept/discard/edit 动作，target_ref 互不相同" do
      actions = AvailableActionBuilder.artifact_actions(two_candidate_set())

      accepts = Enum.filter(actions, &(&1.action_type == "accept"))
      assert length(accepts) == 2

      targets = Enum.map(accepts, & &1.target_ref)
      assert "as_chars::cand_a" in targets
      assert "as_chars::cand_b" in targets
      # 不再用一个集合级 target 替代两个候选授权。
      refute "as_chars" in targets

      # 每个候选三类动作齐全（accept/discard/edit_then_accept）。
      for target <- ["as_chars::cand_a", "as_chars::cand_b"] do
        types = actions |> Enum.filter(&(&1.target_ref == target)) |> Enum.map(& &1.action_type)
        assert Enum.sort(types) == ["accept", "discard", "edit_then_accept"]
      end
    end

    test "单候选角色集仍为集合级单一采纳动作（向后兼容）" do
      single = %{two_candidate_set() | items: [%{item_id: "only", title: "沈砚", body: "档案"}]}
      accepts = AvailableActionBuilder.artifact_actions(single) |> Enum.filter(&(&1.action_type == "accept"))

      assert [%{target_ref: "as_chars"}] = accepts
    end
  end

  describe "采纳单个候选只物化该候选" do
    setup do
      pending = fn artifact_id, item ->
        %{
          artifact_id: artifact_id,
          artifact_type: :character_seed,
          adoption_status: :tentative,
          requires_adoption: true,
          source_tool_result_ref: "tr_src",
          payload: %{items: [item], item_count: 1}
        }
      end

      source_turn = %{
        turn_id: "turn_src",
        adoption_state: %{
          pending: [
            pending.(
              "as_chars::cand_a",
              %{item_id: "cand_a", title: "沈砚", body: "冷峻克制的稽查官", narrative_role: "ANTAGONIST"}
            ),
            pending.(
              "as_chars::cand_b",
              %{item_id: "cand_b", title: "云栖", body: "游离秩序之外的线人"}
            )
          ],
          resolved: []
        },
        trace_summary: %{trace_ref: "trace-src"}
      }

      %{source_turn: source_turn}
    end

    test "采纳候选 B：写入 B 的角色，正文/标题/叙事角色都不来自候选 A", %{source_turn: source_turn} do
      test_pid = self()

      writer = fn attrs ->
        send(test_pid, {:adopt_attrs, attrs})

        {:ok,
         %{
           mutation_id: "m_b",
           mutation_status: "APPLIED",
           memory_item_id: "char_b",
           memory_status: "CONFIRMED",
           source_revision_ref: "mutation:m_b",
           reading_projection: nil
         }}
      end

      assert {:ok, action_result, turn_result} =
               AdoptionWorkflow.handle_adopt(
                 source_turn,
                 %{"artifact_id" => "as_chars::cand_b", "work_id" => "work_1"},
                 writer
               )

      assert action_result.status == "accepted"
      assert turn_result.truthfulness.artifact_adopted == true

      assert_received {:adopt_attrs, attrs}
      # 只写候选 B：标题/正文来自 B，且不含候选 A 的正文与叙事角色。
      assert attrs.summary == "云栖"
      assert attrs.content =~ "游离秩序之外的线人"
      refute attrs.content =~ "冷峻克制的稽查官"
      assert Map.get(attrs, :narrative_role) in [nil, ""]
    end

    test "采纳候选 A：写入 A 的角色与其叙事角色，不混入候选 B", %{source_turn: source_turn} do
      test_pid = self()

      writer = fn attrs ->
        send(test_pid, {:adopt_attrs, attrs})

        {:ok,
         %{
           mutation_id: "m_a",
           mutation_status: "APPLIED",
           memory_item_id: "char_a",
           memory_status: "CONFIRMED",
           source_revision_ref: "mutation:m_a",
           reading_projection: nil
         }}
      end

      assert {:ok, _action_result, _turn_result} =
               AdoptionWorkflow.handle_adopt(
                 source_turn,
                 %{"artifact_id" => "as_chars::cand_a", "work_id" => "work_1"},
                 writer
               )

      assert_received {:adopt_attrs, attrs}
      assert attrs.summary == "沈砚"
      assert attrs.content =~ "冷峻克制的稽查官"
      refute attrs.content =~ "游离秩序之外的线人"
      assert attrs.narrative_role == "ANTAGONIST"
    end
  end
end
