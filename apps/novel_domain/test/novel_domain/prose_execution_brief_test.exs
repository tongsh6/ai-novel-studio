defmodule NovelDomain.ProseExecutionBriefTest do
  use ExUnit.Case, async: true

  alias NovelDomain.ProseExecutionBrief, as: Brief

  describe "new/1 construct + cleanse" do
    test "nil → nil" do
      assert Brief.new(nil) == nil
    end

    test "defaults brief_version and accepts string/atom keys" do
      brief =
        Brief.new(%{
          "brief_id" => "peb_1",
          "anchor" => %{target_unit: "chapter"},
          "chapter_context" => %{"chapter_role" => "铺垫章", "pacing_mode" => "restrained_build"},
          "source_refs" => ["  reb_1  ", "", nil],
          scene_units: [
            %{
              "unit_id" => "scene_1",
              "scene_mode" => "relationship",
              "target_change" => %{"type" => "relationship", "description" => "信任出现裂缝"}
            }
          ]
        })

      assert brief.brief_id == "peb_1"
      assert brief.brief_version == "prose_execution_v1"
      assert brief.anchor["target_unit"] == "chapter"
      assert brief.source_refs == ["reb_1"]
      assert [unit] = brief.scene_units
      assert unit["unit_id"] == "scene_1"
      refute Map.get(unit, "degraded")
    end
  end

  describe "scene unit degradation" do
    test "missing target_change → deliberate_pause + degraded flag, not dropped" do
      brief = Brief.new(%{scene_units: [%{"scene_mode" => "transition"}]})
      assert [unit] = brief.scene_units
      assert unit["unit_id"] == "scene_1"
      assert unit["target_change"]["type"] == "deliberate_pause"
      assert unit["degraded"] == true
      assert unit["degraded_reason"] == "missing_target_change"
    end

    test "non-map scene unit is degraded, not dropped" do
      brief = Brief.new(%{scene_units: ["garbage", %{"target_change" => %{"description" => "x"}}]})
      assert length(brief.scene_units) == 2
      assert Enum.at(brief.scene_units, 0)["degraded"] == true
      # description-only target_change is accepted (type defaults), not degraded
      refute Enum.at(brief.scene_units, 1)["degraded"]
      assert Enum.at(brief.scene_units, 1)["target_change"]["type"] == "unspecified"
    end
  end

  describe "to_map/1 serialize round trips" do
    test "serializes to string-keyed map" do
      brief = Brief.new(%{"brief_id" => "peb_2", scene_units: []})
      map = Brief.to_map(brief)
      assert map["brief_id"] == "peb_2"
      assert map["brief_version"] == "prose_execution_v1"
      assert map["scene_units"] == []
      assert Brief.to_map(nil) == nil
    end
  end

  describe "ref/1" do
    test "stable brief:<id> ref, nil when no id" do
      assert Brief.ref(Brief.new(%{"brief_id" => "peb_9"})) == "brief:peb_9"
      assert Brief.ref(Brief.new(%{scene_units: []})) == nil
      assert Brief.ref(nil) == nil
    end
  end

  describe "to_prompt_section/1 render" do
    test "empty when no scenes" do
      assert Brief.to_prompt_section(nil) == ""
      assert Brief.to_prompt_section(Brief.new(%{scene_units: []})) == ""
    end

    test "renders scene structure without leaking brief_id" do
      brief =
        Brief.new(%{
          "brief_id" => "peb_secret",
          "chapter_context" => %{"chapter_role" => "铺垫章", "pacing_mode" => "restrained_build"},
          scene_units: [
            %{
              "unit_id" => "scene_1",
              "scene_mode" => "relationship",
              "target_change" => %{"type" => "relationship", "description" => "信任出现裂缝"},
              "causal_spine" => %{"goal" => "确认师父是否隐瞒", "consequence" => "决定私下调查"},
              "character_agendas" => [%{"character_ref" => "protagonist", "wants" => "真相", "hides" => "怕信错人"}],
              "information_delta" => %{"reader_learns" => "师父知情"},
              "emotion_transition" => %{"start" => "克制信任", "end" => "冷静疏离"},
              "dialogue_intent" => %{"mode" => "subtext", "surface_topic" => "旧案", "hidden_conflict" => "你是否骗了我"}
            }
          ]
        })

      section = Brief.to_prompt_section(brief)
      assert section =~ "场级执行简述"
      assert section =~ "本章：章节定位=铺垫章，节奏=restrained_build"
      assert section =~ "scene_1"
      assert section =~ "目标变化：relationship：信任出现裂缝"
      assert section =~ "因果"
      assert section =~ "人物议程"
      assert section =~ "情绪迁移"
      assert section =~ "潜台词"
      refute section =~ "peb_secret"
    end

    test "subtext dialogue only rendered when mode=subtext" do
      brief =
        Brief.new(%{
          scene_units: [
            %{
              "unit_id" => "s1",
              "target_change" => %{"type" => "action", "description" => "x"},
              "dialogue_intent" => %{"mode" => "direct", "surface_topic" => "t"}
            }
          ]
        })

      refute Brief.to_prompt_section(brief) =~ "对话意图"
    end
  end
end
