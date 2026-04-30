defmodule NovelDomain.ChapterTest do
  use ExUnit.Case, async: true

  alias NovelDomain.Chapter

  describe "new/5" do
    test "creates a chapter with :planned status" do
      chapter = Chapter.new("ch_001", "work_001", "vol_001", "第一章", 1)
      assert chapter.id == "ch_001"
      assert chapter.work_ref == "work_001"
      assert chapter.volume_ref == "vol_001"
      assert chapter.title == "第一章"
      assert chapter.seq == 1
      assert chapter.status == :planned
      assert %DateTime{} = chapter.created_at
      assert %DateTime{} = chapter.updated_at
    end
  end

  describe "update_status/2" do
    test "transitions status" do
      chapter = Chapter.new("ch_001", "work_001", "vol_001", "第一章", 1)
      updated = Chapter.update_status(chapter, :drafting)
      assert updated.status == :drafting
      assert DateTime.compare(updated.updated_at, chapter.updated_at) == :gt
    end
  end

  describe "update_title/2" do
    test "updates title" do
      chapter = Chapter.new("ch_001", "work_001", "vol_001", "旧标题", 1)
      updated = Chapter.update_title(chapter, "新标题")
      assert updated.title == "新标题"
    end
  end

  describe "update_seq/2" do
    test "reorders sequence" do
      chapter = Chapter.new("ch_001", "work_001", "vol_001", "第一章", 1)
      updated = Chapter.update_seq(chapter, 5)
      assert updated.seq == 5
    end
  end
end
