defmodule NovelDomain.ChapterPlanDirectionMissionTest do
  use ExUnit.Case, async: true

  alias NovelDomain.ChapterMission
  alias NovelDomain.ChapterPlanDirection

  @mission %{
    "mission_id" => "cm_1",
    "statement" => "本章回收伏笔。",
    "must_advance" => [%{"text" => "兑现账牌"}],
    "must_avoid" => [],
    "status" => "TENTATIVE",
    "source" => "model"
  }

  test "chapter_mission 随 plan_direction 存储往返透传，不进 prompt_lines/summary" do
    storage = %{"chapter_role" => "推进章", "chapter_mission" => @mission}
    direction = ChapterPlanDirection.from_storage(storage)

    assert direction.chapter_mission == @mission
    assert ChapterPlanDirection.to_storage(direction) == storage
    refute Enum.any?(ChapterPlanDirection.prompt_lines(direction), &(&1 =~ "使命"))
    refute ChapterPlanDirection.summary(direction) =~ "使命"
  end

  test "只有使命的方向不算空（from_storage 非 nil）但设计态为空；carry_mission 把使命带进新方向" do
    only_mission = %{"chapter_mission" => @mission}
    refute ChapterPlanDirection.empty?(only_mission)
    assert ChapterPlanDirection.design_empty?(only_mission)
    refute ChapterPlanDirection.design_empty?(%{"chapter_role" => "推进章"})
    assert ChapterPlanDirection.design_empty?(nil)

    merged = ChapterPlanDirection.carry_mission(%{"chapter_role" => "推进章"}, only_mission)
    assert merged == %{"chapter_role" => "推进章", "chapter_mission" => @mission}

    assert ChapterPlanDirection.carry_mission(%{"chapter_role" => "推进章"}, nil) == %{
             "chapter_role" => "推进章"
           }
  end

  test "ChapterMission 作者版判定、暂定标记、作者改写与落库形状" do
    tentative = @mission |> ChapterMission.from_map() |> ChapterMission.as_tentative()
    refute ChapterMission.author_version?(tentative)
    assert tentative.status == "TENTATIVE" and tentative.source == "model"

    assert ChapterMission.author_version?(Map.put(@mission, "status", "CONFIRMED"))
    assert ChapterMission.author_version?(Map.put(@mission, "status", "AUTHOR_EDITED"))
    refute ChapterMission.author_version?(nil)

    assert {:error, :statement_required} = ChapterMission.from_author(%{"statement" => ""})

    assert {:ok, author} =
             ChapterMission.from_author(%{
               "statement" => "作者版",
               "must_advance" => ["撤离", %{"text" => "对上编号"}],
               "must_avoid" => []
             })

    assert author.status == "AUTHOR_EDITED" and author.source == "author"
    assert String.starts_with?(author.mission_id, "cm_author")
    assert Enum.map(author.must_advance, & &1["text"]) == ["撤离", "对上编号"]
    assert hd(ChapterMission.to_prompt_lines(author)) == "本章使命（作者已定）：作者版"

    persisted = ChapterMission.persisted_map(%{tentative | dropped: [%{"text" => "x"}]})
    refute Map.has_key?(persisted, "dropped")
    refute Map.has_key?(persisted, "degraded")
    assert persisted["status"] == "TENTATIVE"
  end
end
