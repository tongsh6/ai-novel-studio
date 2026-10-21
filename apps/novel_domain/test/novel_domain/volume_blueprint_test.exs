defmodule NovelDomain.VolumeBlueprintTest do
  @moduledoc "B11A CP1：卷级蓝图 domain 归一/渲染/三态（VS-00J §2.1，纯函数）。"
  use ExUnit.Case, async: true

  alias NovelDomain.VolumeBlueprint
  alias NovelFoundation.Enums.VolumeBlueprintStatus

  describe "new/1 归一" do
    test "字符串键：trim 后保留，空值丢弃" do
      assert VolumeBlueprint.new(%{
               "goal_conflict" => "  夺回矿脉  ",
               "arc_stage" => "",
               "map_boundary" => "   ",
               "climaxes" => "对账夜"
             }) == %{
               "goal_conflict" => "夺回矿脉",
               "climaxes" => "对账夜"
             }
    end

    test "原子键兼容，与字符串键同口径" do
      assert VolumeBlueprint.new(%{goal_conflict: "夺回矿脉", new_maps: "北境"}) ==
               %{"goal_conflict" => "夺回矿脉", "new_maps" => "北境"}
    end

    test "unknown 键（含 title）被丢弃——title 不是蓝图的一部分" do
      assert VolumeBlueprint.new(%{
               "title" => "第一卷",
               "unknown_slot" => "x",
               "goal_conflict" => "夺回矿脉"
             }) == %{"goal_conflict" => "夺回矿脉"}
    end

    test "无有效键 → nil（未立蓝图，不写空 map 占位）" do
      assert VolumeBlueprint.new(nil) == nil
      assert VolumeBlueprint.new(%{}) == nil
      assert VolumeBlueprint.new(%{"goal_conflict" => ""}) == nil
      assert VolumeBlueprint.new(%{"title" => "第一卷"}) == nil
      assert VolumeBlueprint.new("not-a-map") == nil
      assert VolumeBlueprint.new(goal_conflict: "夺回矿脉") == %{"goal_conflict" => "夺回矿脉"}
    end

    test "status 经 VolumeBlueprintStatus 校验；非法状态丢弃" do
      assert VolumeBlueprint.new(%{"status" => VolumeBlueprintStatus.confirmed()}) ==
               %{"status" => "CONFIRMED"}

      assert VolumeBlueprint.new(%{"status" => "DONE"}) == nil

      assert VolumeBlueprint.new(%{
               "status" => String.downcase(VolumeBlueprintStatus.confirmed())
             }) ==
               nil
    end

    test "source_ref 是白名单元数据键，与设计槽一起归一" do
      assert VolumeBlueprint.new(%{
               "source_ref" => "artifact:as-1",
               "goal_conflict" => "夺回矿脉"
             }) == %{"source_ref" => "artifact:as-1", "goal_conflict" => "夺回矿脉"}
    end
  end

  describe "from_storage/1 与 to_storage/1" do
    test "同口径归一，nil 透传" do
      storage = %{"goal_conflict" => "夺回矿脉", "status" => "CONFIRMED"}
      assert VolumeBlueprint.from_storage(storage) == storage
      assert VolumeBlueprint.to_storage(storage) == storage
      assert VolumeBlueprint.from_storage(nil) == nil
      assert VolumeBlueprint.to_storage(%{"unknown" => "x"}) == nil
    end
  end

  describe "status/1 与 put_status/2" do
    test "status/1 读合法状态；缺省/非法 → nil" do
      assert VolumeBlueprint.status(%{"status" => "CONFIRMED"}) == "CONFIRMED"
      assert VolumeBlueprint.status(%{"goal_conflict" => "x"}) == nil
      assert VolumeBlueprint.status(%{"status" => "BOGUS"}) == nil
      assert VolumeBlueprint.status(nil) == nil
    end

    test "put_status/2 设置、替换、去除（nil）" do
      blueprint = %{"goal_conflict" => "夺回矿脉"}

      assert VolumeBlueprint.status(VolumeBlueprint.put_status(blueprint, "CONFIRMED")) ==
               "CONFIRMED"

      author =
        blueprint
        |> VolumeBlueprint.put_status("TENTATIVE")
        |> VolumeBlueprint.put_status("AUTHOR_EDITED")

      assert VolumeBlueprint.status(author) == "AUTHOR_EDITED"
      assert VolumeBlueprint.put_status(author, nil) == blueprint
    end

    test "非法状态不写入（返回归一原蓝图），nil 蓝图 + 合法状态只产元数据" do
      blueprint = %{"goal_conflict" => "夺回矿脉"}
      assert VolumeBlueprint.put_status(blueprint, "DONE") == blueprint
      assert VolumeBlueprint.put_status(nil, "CONFIRMED") == %{"status" => "CONFIRMED"}
      assert VolumeBlueprint.put_status(nil, nil) == nil
    end
  end

  describe "merge/2" do
    test "右侧覆盖左侧；空值不擦除左侧有效值" do
      left = %{"goal_conflict" => "夺回矿脉", "arc_stage" => "觉醒"}
      right = %{"arc_stage" => "裂变", "new_maps" => ""}

      assert VolumeBlueprint.merge(left, right) == %{
               "goal_conflict" => "夺回矿脉",
               "arc_stage" => "裂变"
             }

      assert VolumeBlueprint.merge(nil, left) == left
      assert VolumeBlueprint.merge(left, nil) == left
      assert VolumeBlueprint.merge(nil, nil) == nil
    end
  end

  describe "empty?/1" do
    test "只看设计槽：nil/空/只有元数据 → empty；有任一设计槽 → 非空" do
      assert VolumeBlueprint.empty?(nil)
      assert VolumeBlueprint.empty?(%{})
      assert VolumeBlueprint.empty?(%{"status" => "CONFIRMED"})
      assert VolumeBlueprint.empty?(%{"source_ref" => "artifact:as-1"})

      refute VolumeBlueprint.empty?(%{"goal_conflict" => "夺回矿脉"})
      refute VolumeBlueprint.empty?(%{"new_maps" => "北境"})
    end
  end

  describe "render_lines/1" do
    test "按设计槽声明顺序输出「标签：值」，缺槽不出现，元数据不渲染" do
      lines =
        VolumeBlueprint.render_lines(%{
          "new_maps" => "北境",
          "goal_conflict" => "夺回矿脉",
          "climaxes" => "对账夜",
          "status" => "CONFIRMED",
          "source_ref" => "artifact:as-1"
        })

      assert lines == ["目标冲突：夺回矿脉", "高潮章：对账夜", "新地图：北境"]
    end

    test "nil/空蓝图 → []" do
      assert VolumeBlueprint.render_lines(nil) == []
      assert VolumeBlueprint.render_lines(%{}) == []
      assert VolumeBlueprint.render_lines(%{"status" => "CONFIRMED"}) == []
    end

    test "渲染顺序与 design_keys/0 一致（确定性）" do
      full =
        Map.new(VolumeBlueprint.design_keys(), fn key -> {key, "#{key}-值"} end)

      lines = VolumeBlueprint.render_lines(full)
      assert length(lines) == length(VolumeBlueprint.design_keys())

      rendered_keys =
        Enum.map(VolumeBlueprint.design_keys(), fn key ->
          Enum.find(lines, &String.ends_with?(&1, "#{key}-值"))
        end)

      assert lines == rendered_keys
    end
  end

  describe "slot_key/1（parser 标签口径）" do
    test "全部设计槽标签可映射到键" do
      assert VolumeBlueprint.slot_key("目标冲突") == "goal_conflict"
      assert VolumeBlueprint.slot_key("弧光阶段") == "arc_stage"
      assert VolumeBlueprint.slot_key("地图边界") == "map_boundary"
      assert VolumeBlueprint.slot_key("支线启动") == "subplots_start"
      assert VolumeBlueprint.slot_key("支线推进") == "subplots_advance"
      assert VolumeBlueprint.slot_key("支线收束") == "subplots_close"
      assert VolumeBlueprint.slot_key("高潮章") == "climaxes"
      assert VolumeBlueprint.slot_key("爽点密度") == "payoff_density"
      assert VolumeBlueprint.slot_key("缓冲章") == "buffers"
      assert VolumeBlueprint.slot_key("新人物") == "new_characters"
      assert VolumeBlueprint.slot_key("新设定") == "new_settings"
      assert VolumeBlueprint.slot_key("新地图") == "new_maps"
    end

    test "空白归一；未知标签/非字符串 → nil（不发明键）" do
      assert VolumeBlueprint.slot_key(" 目标 冲突 ") == "goal_conflict"
      assert VolumeBlueprint.slot_key("目标") == nil
      assert VolumeBlueprint.slot_key("title") == nil
      assert VolumeBlueprint.slot_key(nil) == nil
    end
  end

  test "keys/0 是设计槽 + status/source_ref 的白名单" do
    assert VolumeBlueprint.keys() == VolumeBlueprint.design_keys() ++ ["status", "source_ref"]
    assert length(VolumeBlueprint.design_keys()) == 12
  end
end
