defmodule NovelDomain.DraftTest do
  use ExUnit.Case, async: true

  alias NovelDomain.Draft

  describe "new/4" do
    test "creates a draft with :tentative status and revision 1" do
      draft = Draft.new("draft_001", "work_001", "sc_001", "正文内容")
      assert draft.id == "draft_001"
      assert draft.work_ref == "work_001"
      assert draft.scene_ref == "sc_001"
      assert draft.content == "正文内容"
      assert draft.status == :tentative
      assert draft.revision == 1
      assert %DateTime{} = draft.created_at
      assert %DateTime{} = draft.updated_at
    end
  end

  describe "accept/1" do
    test "transitions from :tentative to :accepted" do
      draft = Draft.new("draft_001", "work_001", "sc_001", "正文")
      accepted = Draft.accept(draft)
      assert accepted.status == :accepted
      assert DateTime.compare(accepted.updated_at, draft.updated_at) == :gt
    end

    test "no-op when not :tentative" do
      draft = Draft.new("draft_001", "work_001", "sc_001", "正文")
      accepted = Draft.accept(draft)
      again = Draft.accept(accepted)
      assert again.status == :accepted
    end
  end

  describe "discard/1" do
    test "transitions from :tentative to :discarded" do
      draft = Draft.new("draft_001", "work_001", "sc_001", "正文")
      discarded = Draft.discard(draft)
      assert discarded.status == :discarded
      assert DateTime.compare(discarded.updated_at, draft.updated_at) == :gt
    end

    test "no-op when not :tentative" do
      draft = Draft.new("draft_001", "work_001", "sc_001", "正文")
      accepted = Draft.accept(draft)
      again = Draft.discard(accepted)
      assert again.status == :accepted
    end
  end

  describe "update_content/2" do
    test "updates content and increments revision" do
      draft = Draft.new("draft_001", "work_001", "sc_001", "正文")
      updated = Draft.update_content(draft, "修改后的正文")
      assert updated.content == "修改后的正文"
      assert updated.revision == 2
      assert DateTime.compare(updated.updated_at, draft.updated_at) == :gt
    end
  end
end
