defmodule NovelDomain.ChapterMissionTest do
  use ExUnit.Case, async: true

  alias NovelDomain.ChapterMission

  @known [
    "plan:3:chapter_role",
    "ledger:information:foreshadow_a",
    "ledger:information:plan_info_5"
  ]

  defp raw do
    %{
      "author_reasoning" => "我核对了计划与脉络。",
      "statement" => "本章必须推进旧账牌伏笔的回收。",
      "must_advance" => [
        %{"text" => "让旧账牌编号在当铺兑现", "basis_ref" => "ledger:information:foreshadow_a"},
        %{"text" => "按推进章定位收网", "basis_ref" => "plan:3:chapter_role"},
        %{"text" => "编造的依据", "basis_ref" => "ledger:information:foreshadow_zzz"},
        %{"text" => "没有依据"}
      ],
      "must_avoid" => [
        %{"text" => "不提前揭示第五章信息", "basis_ref" => "ledger:information:plan_info_5"}
      ],
      "confidence" => 0.8
    }
  end

  test "bind/3 只保留依据在材料集合内的条目，越界与无依据进 dropped 并回填 basis_label" do
    mission =
      raw()
      |> ChapterMission.new()
      |> Map.put(:mission_id, "cm_test")
      |> ChapterMission.bind(@known, fn
        "plan:3:chapter_role" -> "章功能定位：推进章"
        _ -> nil
      end)

    refute mission.degraded
    assert length(mission.must_advance) == 2
    assert length(mission.dropped) == 2

    assert Enum.map(mission.must_advance, & &1["basis_ref"]) == [
             "ledger:information:foreshadow_a",
             "plan:3:chapter_role"
           ]

    assert Enum.at(mission.must_advance, 1)["basis_label"] == "章功能定位：推进章"
    # 顺序 = must_advance 后 must_avoid，保序去重
    assert ChapterMission.basis_refs(mission) == [
             "ledger:information:foreshadow_a",
             "plan:3:chapter_role",
             "ledger:information:plan_info_5"
           ]

    assert ChapterMission.ref(mission) == "mission:cm_test"
    assert ChapterMission.present?(mission)
  end

  test "R06: 降级使命直接返回空引用，实际 stage map 与恢复后也不循环" do
    degraded = ChapterMission.degraded("mission_validation_exhausted")
    stage_map = ChapterMission.to_map(degraded)

    restored =
      stage_map
      |> Jason.encode!()
      |> Jason.decode!()
      |> ChapterMission.from_map()

    for mission <- [degraded, stage_map, restored] do
      assert ChapterMission.ref(mission) == nil
    end
  end

  test "全部依据越界且无 statement → 降级 mission_unbound；有 statement 则保留" do
    unbound =
      %{"must_advance" => [%{"text" => "x", "basis_ref" => "nope"}]}
      |> ChapterMission.new()
      |> ChapterMission.bind(@known)

    assert unbound.degraded
    assert unbound.degraded_reason == "mission_unbound"
    refute ChapterMission.present?(unbound)

    statement_only =
      %{"statement" => "按计划推进。", "must_advance" => [%{"text" => "x", "basis_ref" => "nope"}]}
      |> ChapterMission.new()
      |> ChapterMission.bind(@known)

    refute statement_only.degraded
    assert statement_only.must_advance == []
    assert length(statement_only.dropped) == 1
    assert ChapterMission.present?(statement_only)
  end

  test "R06: 使命原文与材料标签经过构造、绑定、持久形状和恢复仍逐字节相同" do
    statement = " \n本章回收旧账牌。\u00A0"
    advance = "\t让旧账牌编号兑现。\r\n"
    avoid = "\n暂不揭示第五章信息。  "
    label = "  伏笔：旧账牌\n"

    mission =
      %{
        "statement" => statement,
        "must_advance" => [
          %{"text" => advance, "basis_ref" => "ledger:information:foreshadow_a"}
        ],
        "must_avoid" => [
          %{"text" => avoid, "basis_ref" => "ledger:information:plan_info_5"}
        ]
      }
      |> ChapterMission.new()
      |> ChapterMission.bind(@known, fn _ -> label end)
      |> ChapterMission.as_tentative()

    assert mission.statement == statement
    assert hd(mission.must_advance)["text"] == advance
    assert hd(mission.must_avoid)["text"] == avoid

    restored =
      mission
      |> ChapterMission.persisted_map()
      |> Jason.encode!()
      |> Jason.decode!()
      |> ChapterMission.from_map()

    assert restored.statement == statement

    assert hd(restored.must_advance) == %{
             "text" => advance,
             "basis_ref" => "ledger:information:foreshadow_a",
             "basis_label" => label
           }

    assert hd(restored.must_avoid) == %{
             "text" => avoid,
             "basis_ref" => "ledger:information:plan_info_5",
             "basis_label" => label
           }

    for constructor <- [&ChapterMission.new/1, &ChapterMission.from_map/1] do
      blank = constructor.(%{"statement" => " \t\r\n", "must_advance" => [%{"text" => "\n  "}]})
      assert blank.statement == nil
      assert blank.must_advance == []
    end
  end

  test "to_prompt_lines/1 渲染使命与依据文本，不输出 ref；降级为空；to_map/from_map 往返" do
    mission =
      raw()
      |> ChapterMission.new()
      |> Map.put(:mission_id, "cm_1")
      |> ChapterMission.bind(@known, fn ref -> "材料：#{ref}" end)

    lines = ChapterMission.to_prompt_lines(mission)
    assert hd(lines) == "本章使命：本章必须推进旧账牌伏笔的回收。"
    assert Enum.any?(lines, &(&1 == "· 必须推进：让旧账牌编号在当铺兑现（依据：材料：ledger:information:foreshadow_a）"))
    assert Enum.any?(lines, &String.starts_with?(&1, "· 不得：不提前揭示第五章信息"))
    refute Enum.any?(lines, &String.contains?(&1, "编造的依据"))

    roundtrip = mission |> ChapterMission.to_map() |> ChapterMission.from_map()
    assert roundtrip.statement == mission.statement
    assert roundtrip.must_advance == mission.must_advance
    assert roundtrip.dropped == mission.dropped
    assert ChapterMission.to_prompt_lines(ChapterMission.to_map(mission)) == lines

    assert ChapterMission.to_prompt_lines(ChapterMission.degraded("boom")) == []
    assert ChapterMission.to_prompt_lines(nil) == []
    refute ChapterMission.present?(ChapterMission.degraded("boom"))
  end
end
