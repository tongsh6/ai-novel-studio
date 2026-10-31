defmodule NovelApplication.AU09WorkDirectionTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution
  alias NovelApplication.{DialogueGateway, WorkService}
  alias NovelDomain.AuthorActionInput
  alias NovelFoundation.Enums.MemoryType
  alias NovelPersistence.{MemoryRecallRepo, Repo}
  alias NovelPersistence.Schemas.MemoryItem

  import Ecto.Query

  setup do
    :ok = Sandbox.checkout(Repo)
    {:ok, work} = WorkService.create(%{title: "方向召回作品"})
    %{work: work}
  end

  test "choose_candidate adopt_tentative writes exactly one WORK_DIRECTION memory and recalls it",
       %{
         work: work
       } do
    source = direction_source(work.id)
    input = direction_input()
    execution = %Execution{result_fn: fn _ -> {:error, :provider_not_used} end}

    assert {:ok, action_result, turn_result} =
             DialogueGateway.handle_action(input, source, execution)

    assert action_result.status == "accepted"
    assert turn_result.adoption_decision.decision_type == :adopt_tentative

    [memory] = direction_memories(work.id)
    assert memory.type == MemoryType.work_direction()
    assert memory.status == "CONFIRMED"
    assert memory.scope == "WORK"
    assert memory.summary == "让主角主动追查旧账"
    assert memory.content =~ "从被动卷入转向主动查账"
    assert "candidate:dir-au09" in memory.tags
    assert "candidate_set:candidate_set:turn-au09" in memory.tags
    assert Enum.any?(memory.tags, &String.starts_with?(&1, "decision:"))
    assert "risk:low" in memory.tags
    assert memory.source_id != nil

    recalled = MemoryRecallRepo.recall(work.id, "追查旧账", limit: 10)
    assert Enum.any?(recalled, &(&1.id == memory.id and &1.type == MemoryType.work_direction()))

    # 重复采纳（幂等）：不重复写 mutation/memory。
    assert {:ok, _action, _turn} = DialogueGateway.handle_action(input, source, execution)
    assert length(direction_memories(work.id)) == 1
  end

  test "non-adopted or non-direction actions do not write", %{work: work} do
    source = direction_source(work.id)

    rejected_input = %{direction_input() | candidate_ref: "dir-other"}

    execution = %Execution{result_fn: fn _ -> {:error, :provider_not_used} end}
    assert {:error, _reason} = DialogueGateway.handle_action(rejected_input, source, execution)
    assert direction_memories(work.id) == []
  end

  defp direction_input do
    %AuthorActionInput{
      input_id: "input-au09",
      source_turn_ref: "turn-au09",
      action_id: "choose_candidate:dir-au09",
      action_type: "choose_candidate",
      target_ref: "dir-au09",
      candidate_set_ref: "candidate_set:turn-au09",
      candidate_ref: "dir-au09"
    }
  end

  defp direction_source(work_id) do
    %{
      turn_id: "turn-au09",
      work_id: work_id,
      frame_ref: "frame-au09",
      frame_summary: %{frame_type: "creative_exploration"},
      candidate_directions: [
        %{
          direction_id: "dir-au09",
          kind: "creative_direction",
          title: "让主角主动追查旧账",
          pitch: "从被动卷入转向主动查账。",
          work_id: work_id,
          risk_hint: "low"
        }
      ],
      available_actions: [
        %{
          action_id: "choose_candidate:dir-au09",
          action_type: "choose_candidate",
          target_ref: "dir-au09",
          candidate_set_ref: "candidate_set:turn-au09",
          candidate_ref: "dir-au09",
          enabled: true
        }
      ]
    }
  end

  defp direction_memories(work_id) do
    MemoryItem
    |> where([m], m.work_id == ^work_id and m.type == ^MemoryType.work_direction())
    |> Repo.all()
  end
end
