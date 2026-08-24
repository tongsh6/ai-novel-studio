defmodule NovelPersistence.PlanningMissionRepoTest do
  @moduledoc """
  WR01c：规划使命落 `works.planning_direction["planning_mission"]`——暂定写入不覆盖作者版、
  确认/改写/作废状态机、get_mission 作者版直取入口。
  """
  use NovelPersistence.DataCase, async: true

  alias NovelPersistence.PlanningMissionRepo
  alias NovelPersistence.WorkRepo

  defp seed_work do
    {:ok, work} = WorkRepo.create(%{title: "规划使命作品"})
    work
  end

  defp mission_map(statement) do
    %{
      "mission_id" => "cm_model_p1",
      "statement" => statement,
      "must_advance" => [%{"text" => "安排伏笔回收章", "basis_ref" => "ledger:information:foreshadow_a"}],
      "must_avoid" => [],
      "dropped" => [%{"text" => "越界"}],
      "confidence" => 0.8
    }
  end

  test "put_tentative 落暂定（去 dropped、标 TENTATIVE/model），新暂定覆盖旧暂定；作者版在场不覆盖" do
    work = seed_work()

    assert {:ok, :stored, stored} = PlanningMissionRepo.put_tentative(work.id, mission_map("第一版"))
    assert stored["status"] == "TENTATIVE"
    assert stored["source"] == "model"
    refute Map.has_key?(stored, "dropped")
    assert is_binary(stored["derived_at"])

    assert {:ok, :stored, second} = PlanningMissionRepo.put_tentative(work.id, mission_map("第二版"))
    assert second["statement"] == "第二版"

    assert {:ok, decision} = PlanningMissionRepo.confirm(work.id)
    assert decision.mission_status == "CONFIRMED"
    assert decision.mission["source"] == "author"

    assert {:ok, :author_version_kept, kept} =
             PlanningMissionRepo.put_tentative(work.id, mission_map("第三版"))

    assert kept["statement"] == "第二版"
    assert PlanningMissionRepo.get_mission(work.id)["status"] == "CONFIRMED"
  end

  test "rewrite → AUTHOR_EDITED（换 id、依据归作者）；discard 删键后 get_mission 为 nil" do
    work = seed_work()
    assert {:ok, :stored, _} = PlanningMissionRepo.put_tentative(work.id, mission_map("暂定"))

    assert {:ok, decision} =
             PlanningMissionRepo.rewrite(work.id, %{
               statement: "作者要求先收束支线",
               must_advance: [%{"text" => "收束当前支线"}],
               must_avoid: [%{"text" => "不开新卷"}]
             })

    assert decision.mission_status == "AUTHOR_EDITED"
    assert decision.mission["statement"] == "作者要求先收束支线"
    assert String.starts_with?(decision.mission["mission_id"], "cm_author_")

    assert {:ok, :author_version_kept, _} =
             PlanningMissionRepo.put_tentative(work.id, mission_map("模型再推"))

    assert {:ok, cleared} = PlanningMissionRepo.discard(work.id)
    assert cleared.mission == nil
    assert PlanningMissionRepo.get_mission(work.id) == nil
    assert {:error, :mission_not_found} = PlanningMissionRepo.discard(work.id)
  end

  test "confirm 只收暂定；作品不存在诚实报错" do
    work = seed_work()
    assert {:error, :mission_not_found} = PlanningMissionRepo.confirm(work.id)
    assert {:error, :work_not_found} = PlanningMissionRepo.confirm(Ecto.UUID.generate())

    assert {:ok, :stored, _} = PlanningMissionRepo.put_tentative(work.id, mission_map("暂定"))
    assert {:ok, _} = PlanningMissionRepo.confirm(work.id)
    assert {:error, :mission_not_tentative} = PlanningMissionRepo.confirm(work.id)
  end
end
