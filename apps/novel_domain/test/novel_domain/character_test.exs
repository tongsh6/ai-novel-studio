defmodule NovelDomain.CharacterTest do
  use ExUnit.Case, async: true

  alias NovelDomain.Character

  describe "new/3" do
    test "creates a character with :draft status and empty aliases" do
      character = Character.new("char_001", "work_001", "小明")
      assert character.id == "char_001"
      assert character.work_ref == "work_001"
      assert character.name == "小明"
      assert character.aliases == []
      assert character.role == nil
      assert character.summary == nil
      assert character.status == :draft
      assert %DateTime{} = character.created_at
      assert %DateTime{} = character.updated_at
    end
  end

  describe "update_name/2" do
    test "updates name" do
      character = Character.new("char_001", "work_001", "旧名")
      updated = Character.update_name(character, "新名")
      assert updated.name == "新名"
      assert DateTime.compare(updated.updated_at, character.updated_at) == :gt
    end
  end

  describe "update_aliases/2" do
    test "sets aliases" do
      character = Character.new("char_001", "work_001", "小明")
      updated = Character.update_aliases(character, ["明哥", "阿明"])
      assert updated.aliases == ["明哥", "阿明"]
    end
  end

  describe "update_role/2" do
    test "sets role" do
      character = Character.new("char_001", "work_001", "小明")
      updated = Character.update_role(character, "主角")
      assert updated.role == "主角"
    end
  end

  describe "update_summary/2" do
    test "sets summary" do
      character = Character.new("char_001", "work_001", "小明")
      updated = Character.update_summary(character, "一个普通的少年")
      assert updated.summary == "一个普通的少年"
    end
  end

  describe "update_status/2" do
    test "transitions status" do
      character = Character.new("char_001", "work_001", "小明")
      updated = Character.update_status(character, :active)
      assert updated.status == :active
      assert DateTime.compare(updated.updated_at, character.updated_at) == :gt
    end
  end
end
