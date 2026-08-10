defmodule NovelPersistence.AssumptionRepoTest do
  @moduledoc """
  VS-00G CP5b：工作假定物化守卫（canon 优先/同名不重提）与「暂定设定」读端口。
  """
  use NovelPersistence.DataCase, async: true

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.AssumptionRepo
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Character
  alias NovelPersistence.WorkRepo

  defp create_work do
    {:ok, work} = WorkRepo.create(%{title: "暂定设定作品"})
    work
  end

  defp attrs(work, overrides \\ %{}) do
    Map.merge(
      %{work_id: work.id, name: "沈砚", summary: "追查灵气账单的核心视角人物。", narrative_role: "PROTAGONIST"},
      overrides
    )
  end

  test "物化主角假定：tentative + AI_ASSUMPTION + 自动激活（required 分级放行）" do
    work = create_work()

    assert {:ok, %Character{} = character} = AssumptionRepo.materialize_character(attrs(work))
    assert character.status == AdoptionStatus.tentative()
    assert character.provisional_source == "AI_ASSUMPTION"
    assert character.provisional_active == true
    assert character.narrative_role == "PROTAGONIST"

    assert [listed] = AssumptionRepo.list_assumption_characters(work.id)
    assert listed.id == character.id
  end

  # AU12 CP2 别名后门：同名精确命中与别名命中都要能回答「命中的是谁」，
  # 确认卡据此点名规范行；未命中/占位 work id 诚实返回 nil。
  test "accepted_character_matching 命中同名/别名并返回规范行主名" do
    work = create_work()

    %Character{}
    |> Character.changeset(%{
      work_id: work.id,
      name: "沈洛",
      aliases: ["洛公子"],
      status: AdoptionStatus.accepted()
    })
    |> Repo.insert!()

    assert %{name: "沈洛", alias_hit: false} =
             AssumptionRepo.accepted_character_matching(work.id, " 沈洛 ")

    assert %{name: "沈洛", alias_hit: true} =
             AssumptionRepo.accepted_character_matching(work.id, "洛公子")

    assert AssumptionRepo.accepted_character_matching(work.id, "无此人") == nil
    assert AssumptionRepo.accepted_character_matching("lobby", "沈洛") == nil

    assert AssumptionRepo.accepted_character_named?(work.id, "洛公子")
    refute AssumptionRepo.accepted_character_named?(work.id, "无此人")
  end

  test "物化假定携带 role/aliases（AU12 CP2 输入面）" do
    work = create_work()

    assert {:ok, %Character{} = character} =
             AssumptionRepo.materialize_character(
               attrs(work, %{role: "底层调查者", aliases: ["砚哥"]})
             )

    assert character.role == "底层调查者"
    assert character.aliases == ["砚哥"]
  end

  test "canon 优先：已有 accepted 角色时不物化假定" do
    work = create_work()

    %Character{}
    |> Character.changeset(%{work_id: work.id, name: "既有主角", status: AdoptionStatus.accepted()})
    |> Repo.insert!()

    assert {:ok, :skipped_canon_present} = AssumptionRepo.materialize_character(attrs(work))
    assert AssumptionRepo.list_assumption_characters(work.id) == []
  end

  test "同名不自动重提：同名行（含已否决）存在时跳过" do
    work = create_work()

    %Character{}
    |> Character.changeset(%{
      work_id: work.id,
      name: "沈砚",
      status: AdoptionStatus.discarded(),
      provisional_source: "AI_ASSUMPTION"
    })
    |> Repo.insert!()

    assert {:ok, :skipped_duplicate} = AssumptionRepo.materialize_character(attrs(work))
  end

  test "空名与非法 work_id 诚实拒绝/降级" do
    work = create_work()
    assert {:error, :assumption_name_missing} = AssumptionRepo.materialize_character(attrs(work, %{name: "  "}))
    assert AssumptionRepo.list_assumption_characters("not-a-uuid") == []
  end
end
