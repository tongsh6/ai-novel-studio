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

  # B11A CP5（VS-00J §4 item5 / §9 决策②）：卷级收束守则——全书守则优先（I-VOL-7）。
  describe "volume_closure_directive/3 (B11A CP5)" do
    @complete "本卷计划章已写完：可确认本卷收束并转入下一卷；全书终局仍以全书进度守则为准。"
    @near "本卷接近收束：接下来优先回收本卷支线与小高潮；不得写全书终局/大结局/完结章。"

    @small "本卷为「第二卷·裂变」：允许在本卷内做小收束（解决本卷主冲突/回收本卷支线），" <>
             "但不得写全书终局/大结局/完结章；收束后把新冲突留给后续卷。"

    defp volume(written, total),
      do: %{volume_title: "第二卷·裂变", written: written, total: total}

    test "无卷信息/无卷标题 → 空串（不注入卷级守则）" do
      assert WorkSkeleton.volume_closure_directive(nil, 10) == ""
      assert WorkSkeleton.volume_closure_directive(%{}, 10) == ""
      assert WorkSkeleton.volume_closure_directive(%{written: 1, total: 2}, 10) == ""
      assert WorkSkeleton.volume_closure_directive(%{volume_title: "   "}, 10) == ""
      assert WorkSkeleton.volume_closure_directive("bad", 10) == ""
    end

    test "全书进度达全书收束阈值（>=85%）→ 空串：全书层守则已覆盖，不重复/不矛盾" do
      for percent <- [85, 85.0, 99, 100, 130] do
        assert WorkSkeleton.volume_closure_directive(volume(5, 5), percent) == ""
        assert WorkSkeleton.volume_closure_directive(volume(1, 5), percent) == ""
      end

      assert WorkSkeleton.volume_closure_directive(volume(1, 5), 84.9) == @small
    end

    test "本卷计划章已写完（written >= total > 0）→ 收束并转入下一卷，全书终局仍看全书守则" do
      assert WorkSkeleton.volume_closure_directive(volume(5, 5), 10) == @complete
      # 计划外追加章（written > total）同样按「计划章已写完」处理
      assert WorkSkeleton.volume_closure_directive(volume(7, 5), 10) == @complete
    end

    test "本卷写入比例 >= 卷级阈值（80%）→ 接近收束" do
      assert WorkSkeleton.volume_closure_directive(volume(4, 5), 10) == @near
      assert WorkSkeleton.volume_closure_directive(volume(8, 10), 10) == @near
      # 80% 以下回落默认分支（3/4 = 75%）
      assert WorkSkeleton.volume_closure_directive(volume(3, 4), 10) ==
               "本卷为「第二卷·裂变」：允许在本卷内做小收束（解决本卷主冲突/回收本卷支线），" <>
                 "但不得写全书终局/大结局/完结章；收束后把新冲突留给后续卷。"
    end

    test "默认分支：允许本卷内小收束，不得写全书终局" do
      assert WorkSkeleton.volume_closure_directive(volume(1, 5), 10) == @small
      assert WorkSkeleton.volume_closure_directive(volume(0, 5), 0) == @small
    end

    test "边界：0/0 章、缺 written/total → 默认分支（无比例可算，不伪造完成/接近）" do
      assert WorkSkeleton.volume_closure_directive(volume(0, 0), 10) == @small
      assert WorkSkeleton.volume_closure_directive(%{volume_title: "第二卷·裂变"}, 10) == @small
      assert WorkSkeleton.volume_closure_directive(volume(nil, 5), 10) == @small
      assert WorkSkeleton.volume_closure_directive(volume(3, nil), 10) == @small
    end

    test "book_progress_percent nil/非数值 → 按「未知」处理，不抑制卷级守则" do
      assert WorkSkeleton.volume_closure_directive(volume(1, 5), nil) == @small
      assert WorkSkeleton.volume_closure_directive(volume(1, 5), "close") == @small
    end

    test "字符串键 volume_info 兼容（与 atom 键同口径）" do
      assert WorkSkeleton.volume_closure_directive(
               %{"volume_title" => "第三卷·归墟", "written" => 5, "total" => 5},
               10
             ) == @complete

      assert WorkSkeleton.volume_closure_directive(
               %{"volume_title" => "第三卷·归墟", "written" => 1, "total" => 5},
               10
             ) =~ "本卷为「第三卷·归墟」"
    end

    test "opts 策略覆盖：全书收束阈值与卷级收束阈值可按 policy proposal 调整" do
      # 全书阈值 50%：60% 视为接近全书收束 → 抑制卷级守则
      assert WorkSkeleton.volume_closure_directive(volume(1, 5), 60, book_closure_percent: 50) ==
               ""

      # 卷级阈值 0.5：3/5=60% 视为接近收束（默认 0.8 下是默认分支）
      assert WorkSkeleton.volume_closure_directive(volume(3, 5), 10,
               volume_closure_threshold: 0.5
             ) ==
               @near

      assert WorkSkeleton.volume_closure_directive(volume(3, 5), 10) == @small
    end

    test "纯函数确定性：同输入同输出" do
      for _ <- 1..3 do
        assert WorkSkeleton.volume_closure_directive(volume(4, 5), 30) == @near
      end
    end
  end

  # B11A CP3（VS-00J §3.2 形态 A）：开新卷动作 —— scope-aware 全书规划段。
  # 本轮只规划下一卷时，用 scope 版分卷指令替换既有「全书分 N 卷」指令（避免冲突）；
  # 无 scope / 非法 scope 时与既有 render/2 逐字节一致。
  describe "render/3 scope-aware (B11A CP3)" do
    @scope %{
      next_seq: 3,
      current_volume_seq: 2,
      current_volume_title: "第二卷·裂变",
      next_chapter_seq: 8,
      existing_volume_count: 2,
      existing_chapter_count: 7
    }

    test "nil scope 与 render/2 逐字节等价（既有行为不变）" do
      snapshot = %{target_length: 140_000, planned_volumes: 3, serial_form: "连载"}

      assert WorkSkeleton.render(snapshot, 10, nil) == WorkSkeleton.render(snapshot, 10)
    end

    test "非法 scope（空 map/缺字段）回落既有指令，字节等价" do
      snapshot = %{target_length: 140_000, planned_volumes: 3}

      assert WorkSkeleton.render(snapshot, 10, %{}) == WorkSkeleton.render(snapshot, 10)

      assert WorkSkeleton.render(snapshot, 10, %{next_seq: 0}) ==
               WorkSkeleton.render(snapshot, 10)
    end

    test "合法 scope 替换全书卷数版分卷指令（不冲突）" do
      snapshot = %{target_length: 140_000, planned_volumes: 3}
      text = WorkSkeleton.render(snapshot, 10, @scope)

      assert text =~ "本轮只规划第 3 卷"
      assert text =~ "每章标注所属卷："
      assert text =~ "卷蓝图行序号 3"
      assert text =~ "下一章号从 8 开始"
      assert text =~ "不要重规划已有卷/已有章"

      # 与 scope 冲突的全书卷数指令不再出现（全书卷数事实行仍在 facts 里）。
      refute text =~ "全书分 3 卷"
      refute text =~ "卷标题在全书内保持一致"
      # 骨架事实与收官守则保留（scope 只替换分卷指令）。
      assert text =~ "目标体量：约 140000 字"
      assert text =~ "不得规划终局"
    end

    test "scope 指令含本轮卷蓝图行格式（序号=next_seq）与所属卷一致性要求" do
      text = WorkSkeleton.render(%{target_length: 140_000}, 1, @scope)

      assert text =~ "「卷蓝图：卷标题｜序号：3｜…」"
      assert text =~ "必须与本轮卷蓝图行标题一致"
    end

    test "单卷书显式开新卷：scope 存在仍发本轮范围指令（不被 planned_volumes<=1 抑制）" do
      text = WorkSkeleton.render(%{target_length: 140_000, planned_volumes: 1}, 3, @scope)

      assert text =~ "本轮只规划第 3 卷"
      refute text =~ "全书分 1 卷"
    end

    test "骨架未立（无 target_length）→ \"\"（scope 段由执行层单独注入，不凭空造骨架）" do
      assert WorkSkeleton.render(%{}, 1, @scope) == ""
    end

    test "render_for_prose 不含分卷/scope 指令（规划指令不进正文向）" do
      text = WorkSkeleton.render_for_prose(%{target_length: 140_000, planned_volumes: 3}, 10)
      refute text =~ "本轮只规划"
      refute text =~ "分卷规划要求"
    end
  end
end
