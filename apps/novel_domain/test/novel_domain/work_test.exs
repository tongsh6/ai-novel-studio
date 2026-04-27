defmodule NovelDomain.WorkTest do
  use ExUnit.Case, async: true

  alias NovelDomain.Work

  describe "new/2" do
    test "creates a work with :draft status" do
      work = Work.new("work_001", "我的第一本书")
      assert work.id == "work_001"
      assert work.title == "我的第一本书"
      assert work.status == :draft
      assert %DateTime{} = work.created_at
      assert %DateTime{} = work.updated_at
    end
  end

  describe "update_status/2" do
    test "updates status and timestamp" do
      work = Work.new("work_001", "测试")
      updated = Work.update_status(work, :active)
      assert updated.status == :active
      assert updated.id == work.id
      assert DateTime.compare(updated.updated_at, work.updated_at) == :gt
    end
  end

  describe "update_title/2" do
    test "updates title and timestamp" do
      work = Work.new("work_001", "旧标题")
      updated = Work.update_title(work, "新标题")
      assert updated.title == "新标题"
      assert updated.status == work.status
      assert DateTime.compare(updated.updated_at, work.updated_at) == :gt
    end
  end
end
