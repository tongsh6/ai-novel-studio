defmodule NovelDomain.WorkSkeletonTest do
  @moduledoc "VS-00G CP3：全书骨架渲染+收官守则（纯函数，治收官循环）。"
  use ExUnit.Case, async: true

  alias NovelDomain.WorkSkeleton

  test "无 target_length → 空段（骨架未立诚实缺席，R6 负债催办）" do
    assert WorkSkeleton.render(%{}, 30) == ""
    assert WorkSkeleton.render(%{target_length: nil}, 30) == ""
    assert WorkSkeleton.render(%{planned_volumes: 5}, 30) == ""
  end

  test "有 target_length：渲染骨架事实+进度+距目标尚远的禁终局守则" do
    text =
      WorkSkeleton.render(%{target_length: 140_000, planned_volumes: 5, serial_form: "连载"}, 30)

    assert text =~ "全书规划"
    assert text =~ "目标体量：约 140000 字"
    assert text =~ "预计卷数：5"
    assert text =~ "连载形态：连载"
    assert text =~ "当前进度：已写 30 章"
    assert text =~ "不得规划终局/收官/大结局/完结章"
  end

  test "可选字段缺失时诚实不渲染该行（卷数/连载形态）" do
    text = WorkSkeleton.render(%{target_length: 140_000}, 30)
    assert text =~ "目标体量"
    refute text =~ "预计卷数"
    refute text =~ "连载形态"
  end

  test "字符串 key 快照兼容" do
    text = WorkSkeleton.render(%{"target_length" => 140_000, "serial_form" => "连载"}, 10)
    assert text =~ "目标体量：约 140000 字"
    assert text =~ "连载形态：连载"
  end

  test "接近目标体量 → 守则转为可安排收束（不再禁终局）" do
    # 目标 140k≈100 章，已写 95 章 → progress 0.95 > 0.85 阈值
    text = WorkSkeleton.render(%{target_length: 140_000}, 95)
    assert text =~ "已接近目标体量，可开始安排收束"
    refute text =~ "不得规划终局"
  end

  test "closure_directive 阈值分界：< 0.85 禁终局，≥ 0.85 可收束" do
    assert WorkSkeleton.closure_directive(0.3) =~ "不得规划终局"
    assert WorkSkeleton.closure_directive(0.9) =~ "可开始安排收束"
  end

  # AU08 CP2：planned_volumes 此前只作事实行渲染，模型看得到「预计卷数：2」却没有任何
  # 指令要它真去分卷 —— CA01「字段在场 ≠ 守则生效」判例的第二次重演。
  describe "卷分组守则 (AU08 CP2)" do
    test "多卷 → 指令式分卷要求，含可解析的行格式" do
      text = WorkSkeleton.render(%{target_length: 140_000, planned_volumes: 3}, 10)

      assert text =~ "预计卷数：3"
      assert text =~ "全书分 3 卷"
      assert text =~ "所属卷：卷标题"
      assert text =~ "卷标题在全书内保持一致"
    end

    test "单卷或未立卷数 → 不发分卷指令（单卷书逐章标注是噪声）" do
      single = WorkSkeleton.render(%{target_length: 140_000, planned_volumes: 1}, 10)
      refute single =~ "分卷规划要求"

      absent = WorkSkeleton.render(%{target_length: 140_000}, 10)
      refute absent =~ "分卷规划要求"
    end

    test "分卷守则与收官守则并存，互不吞掉" do
      text = WorkSkeleton.render(%{target_length: 140_000, planned_volumes: 2}, 10)
      assert text =~ "不得规划终局"
      assert text =~ "分卷规划要求"
    end

    test "volume_directive 直接口径：字符串 key 兼容，非正整数不发指令" do
      assert WorkSkeleton.volume_directive(%{"planned_volumes" => 2}) =~ "全书分 2 卷"
      assert WorkSkeleton.volume_directive(%{planned_volumes: 0}) == ""
      assert WorkSkeleton.volume_directive(%{planned_volumes: nil}) == ""
      assert WorkSkeleton.volume_directive(%{}) == ""
    end

    # B11A CP2（VS-00J §3.1）：卷蓝图行格式说明。必须与 ChapterPlanParser.parse_with_volumes/1
    # 的标签口径逐字一致，且明确单行（parser 只做单行解析，续行丢弃）。
    test "多卷 → 增补卷蓝图行指令，标签与 parser 口径一致且要求单行" do
      text = WorkSkeleton.render(%{target_length: 140_000, planned_volumes: 3}, 10)

      assert text =~ "卷蓝图要求"
      assert text =~ "卷蓝图：卷标题｜序号：N"
      assert text =~ "必须单行"
      assert text =~ "子槽用｜分隔"
      # 全部 12 个设计槽标签都在指令里（parser 只认这些标签）。
      for label <- [
            "目标冲突",
            "弧光阶段",
            "地图边界",
            "支线启动",
            "支线推进",
            "支线收束",
            "高潮章",
            "爽点密度",
            "缓冲章",
            "新人物",
            "新设定",
            "新地图"
          ] do
        assert text =~ label, "卷蓝图指令缺少 #{label} 标签"
      end

      # 章引用口径：只允许章标题（VS-00J §2.1 冻结）。
      assert text =~ "只写章标题"
      assert text =~ "不写章号"
    end

    test "单卷/未立卷数 → 不发卷蓝图指令（无卷可蓝，逐字节等价 I-VOL-4）" do
      for snapshot <- [
            %{target_length: 140_000, planned_volumes: 1},
            %{target_length: 140_000}
          ] do
        refute WorkSkeleton.volume_directive(snapshot) =~ "卷蓝图"
        refute WorkSkeleton.render(snapshot, 10) =~ "卷蓝图"
      end
    end

    test "卷蓝图指令与既有分卷指令并存，既有「分卷规划要求」前缀不被改写" do
      directive = WorkSkeleton.volume_directive(%{planned_volumes: 2})
      assert directive =~ "分卷规划要求：全书分 2 卷"
      assert directive =~ "所属卷：卷标题"
      assert directive =~ "卷蓝图要求"
    end

    test "正文向渲染不含卷蓝图指令（规划指令，写章时是噪声）" do
      text = WorkSkeleton.render_for_prose(%{target_length: 140_000, planned_volumes: 3}, 10)
      assert text =~ "目标体量"
      refute text =~ "卷蓝图"
      refute text =~ "所属卷"
    end
  end

  # B11A CP4（VS-00J §4 消费面 2/3）：当前卷蓝图段——设计态卷级蓝图进创作/规划 prompt。
  # 无卷标题/无设计槽 → ""（I-VOL-4 退化等价）；status/source_ref 是采纳元数据不渲染。
  describe "volume_blueprint_section/3 (B11A CP4)" do
    @blueprint %{
      "goal_conflict" => "夺回矿脉",
      "arc_stage" => "由忍到争",
      "subplots_start" => "妹妹病危",
      "climaxes" => "对账夜",
      "new_maps" => "北境",
      "status" => "CONFIRMED",
      "source_ref" => "artifact:as-1"
    }

    test "无蓝图/空蓝图/无卷标题 → 空串（与未引入卷蓝图时逐字节等价）" do
      assert WorkSkeleton.volume_blueprint_section("第二卷·裂变", nil, nil) == ""
      assert WorkSkeleton.volume_blueprint_section("第二卷·裂变", %{}, nil) == ""
      assert WorkSkeleton.volume_blueprint_section(nil, @blueprint, nil) == ""
      assert WorkSkeleton.volume_blueprint_section("", @blueprint, nil) == ""
      assert WorkSkeleton.volume_blueprint_section("   ", @blueprint, nil) == ""
      # 只有采纳元数据、无 E14-E17 设计槽 → 不算立蓝图。
      assert WorkSkeleton.volume_blueprint_section("第二卷", %{"status" => "CONFIRMED"}, nil) == ""
    end

    test "完整蓝图 + progress：确定性段（header/卷/进度/render_lines 行；元数据不渲染）" do
      assert WorkSkeleton.volume_blueprint_section("第二卷·裂变", @blueprint, %{written: 2, total: 7}) ==
               """
               ## 当前卷蓝图（设计态）
               - 卷：第二卷·裂变
               - 本卷进度：已写 2 / 共 7 章
               目标冲突：夺回矿脉
               弧光阶段：由忍到争
               支线启动：妹妹病危
               高潮章：对账夜
               新地图：北境
               """
               |> String.trim_trailing()
    end

    test "部分蓝图：缺槽不渲染、不补占位" do
      section = WorkSkeleton.volume_blueprint_section("第一卷", %{"goal_conflict" => "掀翻旧秩序"})
      assert section == "## 当前卷蓝图（设计态）\n- 卷：第一卷\n目标冲突：掀翻旧秩序"
      refute section =~ "弧光阶段"
      refute section =~ "本卷进度"
    end

    test "progress 缺省/缺键/total 0 → 不渲染进度行（能算时才算）" do
      for progress <- [
            nil,
            %{},
            %{written: 2},
            %{total: 3},
            %{written: 0, total: 0},
            %{written: "2", total: "3"}
          ] do
        section =
          WorkSkeleton.volume_blueprint_section("第一卷", %{"goal_conflict" => "甲"}, progress)

        refute section =~ "本卷进度"
      end
    end

    test "progress 字符串 key 兼容；written=0 也渲染" do
      section =
        WorkSkeleton.volume_blueprint_section("第一卷", %{"goal_conflict" => "甲"}, %{
          "written" => 0,
          "total" => 5
        })

      assert section =~ "- 本卷进度：已写 0 / 共 5 章"
    end

    test "卷标题两侧空白归一" do
      assert WorkSkeleton.volume_blueprint_section("  第三卷·归墟  ", %{"goal_conflict" => "甲"}) =~
               "- 卷：第三卷·归墟"
    end
  end
end
