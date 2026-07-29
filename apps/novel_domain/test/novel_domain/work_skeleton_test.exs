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
    text = WorkSkeleton.render(%{target_length: 140_000, planned_volumes: 5, serial_form: "连载"}, 30)
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
  end
end
