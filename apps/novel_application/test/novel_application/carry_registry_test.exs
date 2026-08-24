defmodule NovelApplication.CarryRegistryTest do
  use ExUnit.Case, async: true

  alias NovelApplication.CarryRegistry

  test "登记表 v1 = 现状快照：id 唯一、门按行声明、manifest 门与 :all 门语义正确" do
    ids = CarryRegistry.ids()
    assert ids == Enum.uniq(ids)

    # 现状快照抽查（CA03 拍板：先统一不改行为——这些就是今天的门）
    assert CarryRegistry.carries?(:target_structure, "prose_writing")
    refute CarryRegistry.carries?(:target_structure, "plot_outline")
    assert CarryRegistry.carries?(:work_skeleton, "plot_outline")
    refute CarryRegistry.carries?(:work_skeleton, "prose_writing")
    assert CarryRegistry.carries?(:creative_facts, "prose_writing")
    refute CarryRegistry.carries?(:creative_facts, "plot_outline")
    assert CarryRegistry.carries?(:character_roster, "character_design")
    refute CarryRegistry.carries?(:character_roster, "world_building")
    assert CarryRegistry.carries?(:planning_mission, "plot_outline")
    refute CarryRegistry.carries?(:planning_mission, "prose_writing")
    assert CarryRegistry.carries?(:roster_payload, "character_roster")

    # :all 门与 manifest 门（prose/plot 已登记 manifest，world_building 未登记）
    assert CarryRegistry.carries?(:dialogue_context, "world_building")
    assert CarryRegistry.carries?(:absence_directives, "prose_writing")
    assert CarryRegistry.carries?(:absence_directives, "plot_outline")
    refute CarryRegistry.carries?(:absence_directives, "world_building")

    refute CarryRegistry.carries?(:unknown_carrier, "prose_writing")
  end

  test "carry_report 三分：carried / gated（登记表挡的）/ empty（源空诚实缺席）" do
    report =
      CarryRegistry.carry_report("prose_writing", [
        {:target_structure, "## 目标章结构…"},
        {:character_roster, ""},
        {:roster_payload, []},
        {:creative_facts, "## 作品事实…"},
        {:work_skeleton, ""},
        {:planning_mission, nil},
        {:decision_packet, %{"coordinate" => %{}}},
        {:dialogue_context, "## 当前作品上下文…"}
      ])

    assert report.carried == ~w(target_structure creative_facts decision_packet dialogue_context)
    # gated 不冒充 empty：work_skeleton/planning_mission/roster_payload 是登记表挡的
    assert report.gated == ~w(roster_payload work_skeleton planning_mission)
    assert report.empty == ~w(character_roster)

    planning =
      CarryRegistry.carry_report("plot_outline", [
        {:target_structure, "有内容也算 gated"},
        {:planning_mission, "## 本轮规划使命…"},
        {:decision_packet, nil}
      ])

    assert planning.gated == ~w(target_structure decision_packet)
    assert planning.carried == ~w(planning_mission)
  end
end
