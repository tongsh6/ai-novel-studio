defmodule NovelDomain.ChapterMissionTest do
  use ExUnit.Case, async: true

  alias NovelDomain.ChapterMission

  @materials [
    %{ref: "plan:3:chapter_role", basis_label: "章功能定位：推进章"},
    %{ref: "ledger:information:foreshadow_a", basis_label: "伏笔：旧账牌"},
    %{ref: "ledger:information:plan_info_5", basis_label: "第五章才揭示的信息"}
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

  test "bind/2 从同一材料条目绑定 ref 与依据，越界与无依据进 dropped" do
    unbound = raw() |> ChapterMission.new() |> Map.put(:mission_id, "cm_test")
    assert {:ok, mission} = ChapterMission.bind(unbound, @materials)

    refute mission.degraded
    assert length(mission.must_advance) == 2
    assert length(mission.dropped) == 2

    assert Enum.map(mission.must_advance, & &1["basis_ref"]) == [
             "ledger:information:foreshadow_a",
             "plan:3:chapter_role"
           ]

    assert Enum.map(mission.must_advance, & &1["basis_label"]) == [
             "伏笔：旧账牌",
             "章功能定位：推进章"
           ]

    # 顺序 = must_advance 后 must_avoid，保序去重
    assert ChapterMission.basis_refs(mission) == [
             "ledger:information:foreshadow_a",
             "plan:3:chapter_role",
             "ledger:information:plan_info_5"
           ]

    assert ChapterMission.ref(mission) == "mission:cm_test"
    assert ChapterMission.present?(mission)
  end

  test "R06: 被引用的合法材料缺少具体依据时失败，不形成残缺模型使命" do
    mission =
      ChapterMission.new(%{
        statement: "按已读材料推进。",
        must_advance: [%{text: "核对旧账", basis_ref: "chapter:source"}]
      })

    for label <- [nil, " \t\n"] do
      materials = [%{ref: "chapter:source", basis_label: label}]

      assert {:error, {:mission_material_label_missing, "chapter:source"}} =
               ChapterMission.bind(mission, materials)
    end
  end

  test "R06: 相同名称不授予另一 ref 资格，未使用的缺名材料不使使命失败" do
    mission =
      ChapterMission.new(%{
        statement: "核对两处同名章节。",
        must_advance: [
          %{text: "保留第一卷的约定", basis_ref: "chapter:first"},
          %{text: "保留第二卷的约定", basis_ref: "chapter:second"},
          %{text: "同名不能证明已读", basis_ref: "chapter:unread"}
        ]
      })

    materials = [
      %{ref: "chapter:first", basis_label: "同名章节"},
      %{ref: "chapter:second", basis_label: "同名章节"},
      %{ref: "chapter:unused", basis_label: nil}
    ]

    assert {:ok, bound} = ChapterMission.bind(mission, materials)
    assert Enum.map(bound.must_advance, & &1["basis_ref"]) == ["chapter:first", "chapter:second"]
    assert Enum.map(bound.must_advance, & &1["basis_label"]) == ["同名章节", "同名章节"]
    assert [%{"basis_ref" => "chapter:unread"}] = bound.dropped
  end

  test "R06: 同 ref 的不同实际依据保序保留，覆盖限定不会被长标签截掉" do
    directory = "章节目录：" <> String.duplicate("旧账兑现", 24) <> "；仅含身份字段"
    page = "正文第 1–20 字符；只读本页，计划仍为预览"

    materials = [
      %{ref: "chapter:shared", version: 1, basis_label: directory, complete?: false},
      %{ref: "chapter:shared", version: 2, basis_label: page, complete?: false}
    ]

    mission =
      ChapterMission.new(%{
        statement: "依据本次读页推进。",
        must_advance: [%{text: "保留未解线索", basis_ref: "chapter:shared"}]
      })

    assert {:ok, bound} = ChapterMission.bind(mission, materials)
    label = hd(bound.must_advance)["basis_label"]
    assert label =~ directory
    assert label =~ page
    assert :binary.match(label, directory) < :binary.match(label, page)

    lines = ChapterMission.to_prompt_lines(bound)
    assert Enum.any?(lines, &String.contains?(&1, "仅含身份字段"))
    assert Enum.any?(lines, &String.contains?(&1, "只读本页，计划仍为预览"))
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
    unbound = ChapterMission.new(%{"must_advance" => [%{"text" => "x", "basis_ref" => "nope"}]})
    assert {:ok, unbound} = ChapterMission.bind(unbound, @materials)

    assert unbound.degraded
    assert unbound.degraded_reason == "mission_unbound"
    refute ChapterMission.present?(unbound)

    statement_only =
      ChapterMission.new(%{
        "statement" => "按计划推进。",
        "must_advance" => [%{"text" => "x", "basis_ref" => "nope"}]
      })

    assert {:ok, statement_only} = ChapterMission.bind(statement_only, @materials)
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

    unbound =
      ChapterMission.new(%{
        "statement" => statement,
        "must_advance" => [
          %{"text" => advance, "basis_ref" => "ledger:information:foreshadow_a"}
        ],
        "must_avoid" => [
          %{"text" => avoid, "basis_ref" => "ledger:information:plan_info_5"}
        ]
      })

    materials = Enum.map(@materials, &Map.put(&1, :basis_label, label))
    assert {:ok, mission} = ChapterMission.bind(unbound, materials)
    mission = ChapterMission.as_tentative(mission)

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
    unbound = raw() |> ChapterMission.new() |> Map.put(:mission_id, "cm_1")
    assert {:ok, mission} = ChapterMission.bind(unbound, @materials)

    lines = ChapterMission.to_prompt_lines(mission)
    assert hd(lines) == "本章使命：本章必须推进旧账牌伏笔的回收。"
    assert Enum.any?(lines, &(&1 == "· 必须推进：让旧账牌编号在当铺兑现（依据：伏笔：旧账牌）"))
    assert Enum.any?(lines, &String.starts_with?(&1, "· 不得：不提前揭示第五章信息"))
    refute Enum.any?(lines, &String.contains?(&1, "编造的依据"))
    refute Enum.any?(lines, &String.contains?(&1, "ledger:"))

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
