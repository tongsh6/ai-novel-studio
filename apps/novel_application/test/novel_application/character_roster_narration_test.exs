defmodule NovelApplication.CharacterRosterNarrationTest do
  use ExUnit.Case, async: true

  alias NovelApplication.CharacterRosterNarration, as: Narration

  describe "message/1 主角感知叙述（AU-09 角色类型/主角语义）" do
    test "无任何已确认角色：诚实说没有角色也没有主角，给设计入口" do
      msg = Narration.message([])

      assert msg =~ "还没有已确认角色"
      assert msg =~ "还没有确定主角"
      assert msg =~ "设计主角"
      # 只读不写
      assert msg =~ "没有写入作品事实" or msg =~ "采纳后才会写入"
    end

    test "已确认角色但无人标记主角：诚实报缺口，不把第一个角色默认当主角" do
      characters = [
        %{name: "周临", narrative_role: "SUPPORTING", role: "配角"},
        %{name: "陈默", narrative_role: nil, role: "线人"}
      ]

      msg = Narration.message(characters)

      assert msg =~ "还没有谁被标记为主角"
      # 不得把第一个角色周临当主角
      refute msg =~ "主角是 周临"
      refute msg =~ "主角是周临"
      assert msg =~ "共有 2 个已确认角色"
      assert msg =~ "没有写入作品事实"
    end

    test "有 1 位已确认主角：直接回答主角姓名与类型标签" do
      characters = [
        %{name: "林烬", narrative_role: "PROTAGONIST", role: "稽查官"},
        %{name: "周临", narrative_role: "ANTAGONIST", role: "对手"}
      ]

      msg = Narration.message(characters)

      assert msg =~ "当前作品的主角是 林烬"
      # 花名册标签用结构化叙事角色
      assert msg =~ "林烬（主角）"
      assert msg =~ "周临（反派）"
      assert msg =~ "共有 2 个已确认角色"
    end

    test "多位已确认主角：作为群像列出全部主角" do
      characters = [
        %{name: "林烬", narrative_role: "PROTAGONIST"},
        %{name: "苏晚", narrative_role: "PROTAGONIST"},
        %{name: "周临", narrative_role: "SUPPORTING"}
      ]

      msg = Narration.message(characters)

      assert msg =~ "2 位主角（群像）"
      assert msg =~ "林烬"
      assert msg =~ "苏晚"
      assert msg =~ "共有 3 个已确认角色"
    end

    test "无 narrative_role 时回退自由文本 role 作为标签" do
      msg = Narration.message([%{name: "无名", narrative_role: nil, role: "神秘人"}])

      assert msg =~ "无名（神秘人）"
      assert msg =~ "还没有谁被标记为主角"
    end

    test "字符串 key 的花名册条目也能识别主角" do
      msg = Narration.message([%{"name" => "林烬", "narrative_role" => "PROTAGONIST"}])
      assert msg =~ "当前作品的主角是 林烬"
    end
  end

  describe "role_label/1" do
    test "枚举值映射到中文标签，未知值返回 nil" do
      assert Narration.role_label("PROTAGONIST") == "主角"
      assert Narration.role_label("ANTAGONIST") == "反派"
      assert Narration.role_label("ENSEMBLE_POV") == "群像视角"
      assert Narration.role_label("UNKNOWN") == nil
      assert Narration.role_label(nil) == nil
    end
  end
end
