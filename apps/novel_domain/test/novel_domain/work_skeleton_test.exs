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
end
