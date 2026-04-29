defmodule NovelDomain.NarrativePositionTest do
  use ExUnit.Case, async: true

  alias NovelDomain.NarrativePosition

  describe "new/1" do
    test "creates a position with work_id" do
      pos = NarrativePosition.new("work_001")
      assert pos.work_id == "work_001"
      assert pos.volume_id == nil
      assert pos.arc_id == nil
      assert pos.chapter_id == nil
      assert pos.scene_index == nil
      assert pos.narrative_layer == nil
      assert pos.timeline_node_id == nil
    end
  end

  test "struct fields are nullable by default" do
    pos = %NarrativePosition{}
    assert pos.work_id == nil
  end

  test "settable fields" do
    pos = %NarrativePosition{
      work_id: "w1",
      volume_id: "v1",
      chapter_id: "c3",
      scene_index: 2,
      narrative_layer: "flashback"
    }
    assert pos.work_id == "w1"
    assert pos.volume_id == "v1"
    assert pos.chapter_id == "c3"
    assert pos.scene_index == 2
    assert pos.narrative_layer == "flashback"
  end
end
