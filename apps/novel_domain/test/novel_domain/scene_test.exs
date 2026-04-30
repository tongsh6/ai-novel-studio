defmodule NovelDomain.SceneTest do
  use ExUnit.Case, async: true

  alias NovelDomain.Scene

  describe "new/5" do
    test "creates a scene with :planned status" do
      scene = Scene.new("sc_001", "work_001", "ch_001", "第一场", 1)
      assert scene.id == "sc_001"
      assert scene.work_ref == "work_001"
      assert scene.chapter_ref == "ch_001"
      assert scene.title == "第一场"
      assert scene.seq == 1
      assert scene.status == :planned
      assert %DateTime{} = scene.created_at
      assert %DateTime{} = scene.updated_at
    end
  end

  describe "update_status/2" do
    test "transitions status" do
      scene = Scene.new("sc_001", "work_001", "ch_001", "第一场", 1)
      updated = Scene.update_status(scene, :drafting)
      assert updated.status == :drafting
    end
  end
end
