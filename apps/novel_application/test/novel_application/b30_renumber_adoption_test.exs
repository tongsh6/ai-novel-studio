defmodule NovelApplication.B30RenumberAdoptionTest do
  use ExUnit.Case, async: false

  import Ecto.Query

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.AdoptionWorkflow
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume, Work}

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  defp seed do
    work = Repo.insert!(%Work{title: "B30 workflow"})
    volume = Repo.insert!(%Volume{work_id: work.id, title: "第二卷", seq: 2})

    chapters =
      for {title, seq} <- [{"第11章：甲", 11}, {"第12章：乙", 12}, {"第13章：丙", 13}] do
        chapter =
          Repo.insert!(%Chapter{work_id: work.id, volume_id: volume.id, title: title, seq: seq})

        scene =
          Repo.insert!(%Scene{work_id: work.id, chapter_id: chapter.id, title: "场景 1", seq: 1})

        Repo.insert!(%Draft{
          work_id: work.id,
          scene_id: scene.id,
          content: "正文-#{seq}",
          status: AdoptionStatus.accepted(),
          revision: 1
        })

        chapter
      end

    {work, chapters}
  end

  defp source_turn(work_id, artifact_id, payload) do
    %{
      turn_id: "turn-b30",
      work_id: work_id,
      adoption_state: %{
        pending: [
          %{
            artifact_id: artifact_id,
            artifact_type: :outline_draft,
            adoption_status: "TENTATIVE",
            requires_adoption: true,
            payload: payload
          }
        ],
        resolved: []
      },
      trace_summary: %{trace_ref: "trace-b30"}
    }
  end

  test "renumber change plan 采纳：action_result 回执基于已提交映射；不写正文/不建章" do
    {work, [c1, c2, c3]} = seed()
    artifact_id = "as-b30-renumber-#{System.unique_integer([:positive])}"

    payload = %{
      object_kind: "chapter_structure_change_plan",
      change_plan: %{
        operation: "renumber_chapters",
        object_count: 2,
        effects: ["display_number_only"],
        mapping: [
          %{chapter_ref: "chapter:#{c1.id}", from_seq: 11, to_seq: 13},
          %{chapter_ref: "chapter:#{c3.id}", from_seq: 13, to_seq: 11}
        ],
        base_versions: [
          %{chapter_ref: "chapter:#{c1.id}", version: 1},
          %{chapter_ref: "chapter:#{c3.id}", version: 1}
        ],
        warnings: []
      }
    }

    assert {:ok, action_result, _turn_result} =
             AdoptionWorkflow.handle_adopt(
               source_turn(work.id, artifact_id, payload),
               %{"artifact_id" => artifact_id, "work_id" => work.id},
               fn _attrs -> flunk("renumber 不应调用 artifact writer") end
             )

    assert action_result.adoption_effect.mode == "renumber_chapters"
    assert action_result.object_count == 2
    assert length(action_result.committed_mapping) == 2
    assert Repo.get!(Chapter, c1.id).seq == 13
    assert Repo.get!(Chapter, c3.id).seq == 11
    assert Repo.get!(Chapter, c2.id).seq == 12
    assert chapter_count(work.id) == 3

    assert Enum.all?(
             from(d in Draft, where: d.work_id == ^work.id) |> Repo.all(),
             &(&1.status == AdoptionStatus.accepted())
           )
  end

  test "renumber effect 校验：unsupported_effect / no_target 拒绝且零写入" do
    {_work, [c1, _c2, _c3]} = seed()
    _artifact_id = "as-b30-bad-#{System.unique_integer([:positive])}"
    before = Repo.all(Chapter) |> Enum.map(&{&1.id, &1.seq})

    bad_effect = %{
      object_kind: "chapter_structure_change_plan",
      change_plan: %{
        operation: "renumber_chapters",
        object_count: 1,
        effects: ["reorder"],
        mapping: [%{chapter_ref: "chapter:#{c1.id}", from_seq: 11, to_seq: 12}]
      }
    }

    assert {:error, :unsupported_effect} =
             AdoptionWorkflow.validate_b28_contract(%{payload: bad_effect})

    no_target = %{
      object_kind: "chapter_structure_change_plan",
      change_plan: %{
        operation: "renumber_chapters",
        effects: ["display_number_only"],
        mapping: []
      }
    }

    assert {:error, :no_target} = AdoptionWorkflow.validate_b28_contract(%{payload: no_target})

    after_rows = Repo.all(Chapter) |> Enum.map(&{&1.id, &1.seq})
    assert after_rows == before
  end

  defp chapter_count(work_id) do
    Repo.aggregate(from(c in Chapter, where: c.work_id == ^work_id), :count)
  end
end
