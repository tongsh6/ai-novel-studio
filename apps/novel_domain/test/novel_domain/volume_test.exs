defmodule NovelDomain.VolumeTest do
  use ExUnit.Case, async: true

  alias NovelDomain.Volume

  describe "new/4" do
    test "creates a volume with :planned status" do
      volume = Volume.new("vol_001", "work_001", "第一卷", 1)
      assert volume.id == "vol_001"
      assert volume.work_ref == "work_001"
      assert volume.title == "第一卷"
      assert volume.seq == 1
      assert volume.status == :planned
      assert %DateTime{} = volume.created_at
      assert %DateTime{} = volume.updated_at
    end
  end

  describe "update_status/2" do
    test "transitions from :planned to :drafting" do
      volume = Volume.new("vol_001", "work_001", "第一卷", 1)
      updated = Volume.update_status(volume, :drafting)
      assert updated.status == :drafting
      assert DateTime.compare(updated.updated_at, volume.updated_at) == :gt
    end
  end

  describe "update_title/2" do
    test "updates title" do
      volume = Volume.new("vol_001", "work_001", "旧标题", 1)
      updated = Volume.update_title(volume, "新标题")
      assert updated.title == "新标题"
      assert DateTime.compare(updated.updated_at, volume.updated_at) == :gt
    end
  end

  describe "update_seq/2" do
    test "reorders sequence" do
      volume = Volume.new("vol_001", "work_001", "第一卷", 1)
      updated = Volume.update_seq(volume, 3)
      assert updated.seq == 3
      assert DateTime.compare(updated.updated_at, volume.updated_at) == :gt
    end
  end

  # B11A CP1：卷级蓝图设计态（VS-00J §2.1）。nil=未立蓝图，与 chapters.plan_direction 同款。
  describe "blueprint" do
    test "new/4 默认无蓝图（nil=未立蓝图，不伪造空 map）" do
      volume = Volume.new("vol_001", "work_001", "第一卷", 1)
      assert volume.blueprint == nil
    end

    test "put_blueprint/2 归一写入并推进 updated_at；未知键/空值被丢弃" do
      volume = Volume.new("vol_001", "work_001", "第一卷", 1)

      updated =
        Volume.put_blueprint(volume, %{
          "goal_conflict" => " 夺回矿脉 ",
          "unknown_slot" => "x",
          "new_maps" => ""
        })

      assert updated.blueprint == %{"goal_conflict" => "夺回矿脉"}
      assert DateTime.compare(updated.updated_at, volume.updated_at) == :gt
    end

    test "put_blueprint/2 传 nil/空 map → 清空为未立蓝图" do
      volume =
        Volume.new("vol_001", "work_001", "第一卷", 1)
        |> Volume.put_blueprint(%{"goal_conflict" => "夺回矿脉"})

      assert Volume.put_blueprint(volume, nil).blueprint == nil
      assert Volume.put_blueprint(volume, %{}).blueprint == nil
    end

    test "put_blueprint/2 不触碰卷状态（状态推进只由结构动作拉动）" do
      volume = Volume.new("vol_001", "work_001", "第一卷", 1)
      updated = Volume.put_blueprint(volume, %{"goal_conflict" => "夺回矿脉"})
      assert updated.status == :planned
    end
  end
end
