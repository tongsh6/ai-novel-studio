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
end
