defmodule NovelApplication.B29CharacterRevisionAdoptionTest do
  use ExUnit.Case, async: false

  import Ecto.Query

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.AdoptionWorkflow
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.{AdoptionRepository, Repo}
  alias NovelPersistence.Schemas.{Character, MemoryItem, Work}

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  defp seed do
    work = Repo.insert!(%Work{title: "B29 采纳"})

    shen =
      Repo.insert!(%Character{
        work_id: work.id,
        name: "沈砚",
        aliases: ["老沈"],
        role: "灯楼查账人",
        narrative_role: "ENSEMBLE_POV",
        status: AdoptionStatus.accepted()
      })

    gu =
      Repo.insert!(%Character{
        work_id: work.id,
        name: "顾青",
        role: "捕快",
        narrative_role: "PROTAGONIST",
        status: AdoptionStatus.accepted()
      })

    {work, shen, gu}
  end

  defp source_turn(work_id, artifact_id, payload) do
    %{
      turn_id: "turn-b29",
      work_id: work_id,
      adoption_state: %{
        pending: [
          %{
            artifact_id: artifact_id,
            artifact_type: :character_profile_revision,
            adoption_status: "TENTATIVE",
            requires_adoption: true,
            payload: payload
          }
        ],
        resolved: []
      },
      trace_summary: %{trace_ref: "trace-b29"}
    }
  end

  test "character_profile_revision 采纳：同 id 更新 narrative_role、回执 committed_changes、不写 memory/不新建角色" do
    {work, shen, gu} = seed()
    {:ok, fact} = AdoptionRepository.character_profile_context(work.id, "character:#{shen.id}")

    payload = %{
      object_kind: "character_profile_revision",
      character_ref: "character:#{shen.id}",
      character_name: "沈砚",
      base_fingerprint: fact.base_fingerprint,
      changes: [%{field: "narrative_role", old: "ENSEMBLE_POV", new: "PROTAGONIST"}],
      effects: ["character_field_update"],
      other_character_changes: [],
      adoption_effect: %{mode: "character_field_update", character_ref: "character:#{shen.id}"}
    }

    before_ids = characters_for(work.id) |> Enum.map(& &1.id) |> Enum.sort()

    assert {:ok, action_result, _turn_result} =
             AdoptionWorkflow.handle_adopt(
               source_turn(work.id, "as-b29-rev", payload),
               %{"artifact_id" => "as-b29-rev", "work_id" => work.id},
               fn _attrs -> flunk("character revision 不应调用 artifact writer") end
             )

    assert action_result.adoption_effect.mode == "character_field_update"
    assert action_result.character_ref == "character:#{shen.id}"
    assert action_result.base_fingerprint == fact.base_fingerprint

    assert [%{field: "narrative_role", old: "ENSEMBLE_POV", new: "PROTAGONIST"}] =
             action_result.committed_changes

    assert Repo.get!(Character, shen.id).narrative_role == "PROTAGONIST"
    assert Repo.get!(Character, gu.id).narrative_role == "PROTAGONIST"
    assert Repo.aggregate(from(ch in Character, where: ch.work_id == ^work.id), :count) == 2
    assert characters_for(work.id) |> Enum.map(& &1.id) |> Enum.sort() == before_ids
    assert Repo.aggregate(MemoryItem, :count) == 0
  end

  test "校验：非法字段/非法值/other_character_changes/缺 ref 拒绝且零写入" do
    {work, shen, _gu} = seed()
    {:ok, fact} = AdoptionRepository.character_profile_context(work.id, "character:#{shen.id}")

    base = %{
      object_kind: "character_profile_revision",
      character_ref: "character:#{shen.id}",
      base_fingerprint: fact.base_fingerprint,
      changes: [%{field: "narrative_role", old: "ENSEMBLE_POV", new: "PROTAGONIST"}],
      effects: ["character_field_update"],
      other_character_changes: []
    }

    assert {:error, :unsupported_field} =
             AdoptionWorkflow.validate_b28_contract(%{
               payload: %{base | changes: [%{field: "role", old: "灯楼查账人", new: "捕快"}]}
             })

    assert {:error, :invalid_character_role} =
             AdoptionWorkflow.validate_b28_contract(%{
               payload: %{
                 base
                 | changes: [%{field: "narrative_role", old: "ENSEMBLE_POV", new: "HERO"}]
               }
             })

    assert {:error, :unsupported_effect} =
             AdoptionWorkflow.validate_b28_contract(%{
               payload: %{
                 base
                 | other_character_changes: [%{character_ref: "character:x", to: "SUPPORTING"}]
               }
             })

    assert {:error, :target_missing} =
             AdoptionWorkflow.validate_b28_contract(%{
               payload: Map.put(base, :character_ref, nil)
             })

    assert Repo.get!(Character, shen.id).narrative_role == "ENSEMBLE_POV"
  end

  defp characters_for(work_id) do
    from(ch in Character, where: ch.work_id == ^work_id) |> Repo.all()
  end
end
