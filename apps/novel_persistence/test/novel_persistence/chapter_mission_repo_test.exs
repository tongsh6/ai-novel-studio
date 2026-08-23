defmodule NovelPersistence.ChapterMissionRepoTest do
  @moduledoc """
  WR01b：本章使命落 `chapters.plan_direction["chapter_mission"]`——暂定写入不覆盖作者版、
  确认/改写/作废状态机、大纲重物化带回使命。
  """
  use NovelPersistence.DataCase, async: true

  alias NovelPersistence.AdoptionRepository
  alias NovelPersistence.ChapterMissionRepo
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.WorkRepo

  defp seed_work do
    {:ok, work} = WorkRepo.create(%{title: "本章使命作品"})

    {:ok, _} =
      AdoptionRepository.persist(%{
        actor_ref: "author",
        work_id: work.id,
        source_turn_ref: "turn_cm_plan",
        artifact_id: "as_cm_plan",
        artifact_type: :outline_draft,
        base_revision: 1,
        content: "第01章：对账夜: 沈洛核对账单。\n第02章：旧账兑现: 账牌兑现。",
        summary: "两章计划"
      })

    chapters =
      Chapter |> Repo.all() |> Enum.filter(&(&1.work_id == work.id)) |> Enum.sort_by(& &1.seq)

    {work, chapters}
  end

  defp mission_map(statement) do
    %{
      "mission_id" => "cm_model_1",
      "statement" => statement,
      "must_advance" => [%{"text" => "推进伏笔", "basis_ref" => "ledger:information:foreshadow_a"}],
      "must_avoid" => [],
      "dropped" => [%{"text" => "越界"}],
      "confidence" => 0.8
    }
  end

  test "put_tentative 落暂定（去 dropped、标 TENTATIVE/model），新暂定覆盖旧暂定；作者版在场不覆盖" do
    {work, [ch1 | _]} = seed_work()

    assert {:ok, :stored, stored} =
             ChapterMissionRepo.put_tentative(work.id, 1, mission_map("第一版"))

    assert stored["status"] == "TENTATIVE"
    assert stored["source"] == "model"
    refute Map.has_key?(stored, "dropped")
    assert is_binary(stored["derived_at"])

    assert {:ok, :stored, second} =
             ChapterMissionRepo.put_tentative(work.id, 1, mission_map("第二版"))

    assert second["statement"] == "第二版"

    assert {:ok, decision} = ChapterMissionRepo.confirm(work.id, ch1.id)
    assert decision.mission_status == "CONFIRMED"
    assert decision.mission["source"] == "author"

    assert {:ok, :author_version_kept, kept} =
             ChapterMissionRepo.put_tentative(work.id, 1, mission_map("第三版"))

    assert kept["statement"] == "第二版"

    assert {:error, :chapter_not_found} =
             ChapterMissionRepo.put_tentative(work.id, 99, mission_map("x"))
  end

  test "confirm 只接受暂定；rewrite 换 id 标 AUTHOR_EDITED；discard 删键后可重新落暂定" do
    {work, [ch1 | _]} = seed_work()
    assert {:error, :mission_not_found} = ChapterMissionRepo.confirm(work.id, ch1.id)

    {:ok, :stored, _} = ChapterMissionRepo.put_tentative(work.id, 1, mission_map("模型版"))

    assert {:ok, rewritten} =
             ChapterMissionRepo.rewrite(work.id, ch1.id, %{
               statement: "作者版：这章只写撤离。",
               must_advance: [%{"text" => "撤离黑市"}],
               must_avoid: [%{"text" => "不揭示幕后"}]
             })

    assert rewritten.mission_status == "AUTHOR_EDITED"
    assert String.starts_with?(rewritten.mission["mission_id"], "cm_author")
    assert rewritten.mission["must_advance"] == [%{"text" => "撤离黑市"}]
    assert {:error, :mission_not_tentative} = ChapterMissionRepo.confirm(work.id, ch1.id)

    assert {:error, :statement_required} =
             ChapterMissionRepo.rewrite(work.id, ch1.id, %{statement: " "})

    assert {:ok, cleared} = ChapterMissionRepo.discard(work.id, ch1.id)
    assert cleared.mission == nil
    assert {:error, :mission_not_found} = ChapterMissionRepo.discard(work.id, ch1.id)
    assert {:ok, :stored, _} = ChapterMissionRepo.put_tentative(work.id, 1, mission_map("再推"))
  end

  test "只落了使命的章在大纲重物化时补进九字段并带回使命（design_empty?/carry_mission）" do
    {work, [_ch1, ch2]} = seed_work()
    {:ok, :stored, _} = ChapterMissionRepo.put_tentative(work.id, 2, mission_map("保留我"))
    {:ok, _} = ChapterMissionRepo.confirm(work.id, ch2.id)

    {:ok, _} =
      AdoptionRepository.persist(%{
        actor_ref: "author",
        work_id: work.id,
        source_turn_ref: "turn_cm_plan_2",
        artifact_id: "as_cm_plan_2",
        artifact_type: :outline_draft,
        base_revision: 1,
        content: "第01章：对账夜: 沈洛核对账单。\n第02章：旧账兑现: 账牌兑现。\n章功能定位：推进章\n情节推进：账牌兑现牵出链路",
        summary: "带方向的重物化"
      })

    chapter = Repo.get!(Chapter, ch2.id)
    assert chapter.plan_direction["chapter_role"] == "推进章"
    assert chapter.plan_direction["chapter_mission"]["statement"] == "保留我"
    assert chapter.plan_direction["chapter_mission"]["status"] == "CONFIRMED"
  end
end
