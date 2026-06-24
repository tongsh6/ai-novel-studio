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

  describe "update_narrative_role/2 与 protagonist?/1（AU-09 主角语义）" do
    test "新建角色默认无叙事角色标记，不默认为主角" do
      character = Character.new("char_001", "work_001", "小明")
      assert character.narrative_role == nil
      refute Character.protagonist?(character)
    end

    test "标记为主角后 protagonist? 为真" do
      updated =
        Character.new("char_001", "work_001", "小明")
        |> Character.update_narrative_role("PROTAGONIST")

      assert updated.narrative_role == "PROTAGONIST"
      assert Character.protagonist?(updated)
    end

    test "非主角叙事角色 protagonist? 为假" do
      updated =
        Character.new("char_001", "work_001", "小明")
        |> Character.update_narrative_role("ANTAGONIST")

      assert updated.narrative_role == "ANTAGONIST"
      refute Character.protagonist?(updated)
    end

    test "可清除叙事角色标记为 nil" do
      updated =
        Character.new("char_001", "work_001", "小明")
        |> Character.update_narrative_role("PROTAGONIST")
        |> Character.update_narrative_role(nil)

      assert updated.narrative_role == nil
    end

    test "非法叙事角色 raise，保证主角是可校验事实" do
      character = Character.new("char_001", "work_001", "小明")

      assert_raise ArgumentError, fn ->
        Character.update_narrative_role(character, "HERO")
      end
    end

    test "protagonist?/1 接受裸枚举值" do
      assert Character.protagonist?("PROTAGONIST")
      refute Character.protagonist?("SUPPORTING")
      refute Character.protagonist?(nil)
    end
  end
end
