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
      brief =
        Brief.new(%{scene_units: ["garbage", %{"target_change" => %{"description" => "x"}}]})

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
              "character_agendas" => [
                %{"character_ref" => "protagonist", "wants" => "真相", "hides" => "怕信错人"}
              ],
              "information_delta" => %{"reader_learns" => "师父知情"},
              "emotion_transition" => %{"start" => "克制信任", "end" => "冷静疏离"},
              "dialogue_intent" => %{
                "mode" => "subtext",
                "surface_topic" => "旧案",
                "hidden_conflict" => "你是否骗了我"
              }
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

    test "subtext renders surface + hidden; direct renders surface topic only" do
      subtext =
        Brief.new(%{
          scene_units: [
            %{
              "unit_id" => "s1",
              "target_change" => %{"type" => "action", "description" => "x"},
              "dialogue_intent" => %{
                "mode" => "subtext",
                "surface_topic" => "旧案",
                "hidden_conflict" => "你是否骗了我"
              }
            }
          ]
        })

      assert Brief.to_prompt_section(subtext) =~ "对话意图：潜台词：表面谈旧案，暗里争你是否骗了我"

      direct =
        Brief.new(%{
          scene_units: [
            %{
              "unit_id" => "s1",
              "target_change" => %{"type" => "action", "description" => "x"},
              "dialogue_intent" => %{"mode" => "direct", "surface_topic" => "对账寒暄"}
            }
          ]
        })

      assert Brief.to_prompt_section(direct) =~ "对话意图：表面谈对账寒暄"
      refute Brief.to_prompt_section(direct) =~ "潜台词"
    end

    test "direct dialogue without surface topic renders nothing" do
      brief =
        Brief.new(%{
          scene_units: [
            %{
              "unit_id" => "s1",
              "target_change" => %{"type" => "action", "description" => "x"},
              "dialogue_intent" => %{"mode" => "direct"}
            }
          ]
        })

      refute Brief.to_prompt_section(brief) =~ "对话意图"
    end

    test "subtext missing one side renders only the present field (no hollow template)" do
      surface_only =
        Brief.new(%{
          scene_units: [
            %{
              "unit_id" => "s1",
              "target_change" => %{"type" => "action", "description" => "x"},
              "dialogue_intent" => %{"mode" => "subtext", "surface_topic" => "旧案"}
            }
          ]
        })

      section = Brief.to_prompt_section(surface_only)
      assert section =~ "对话意图：潜台词：表面谈旧案"
      refute section =~ "暗里争"

      hidden_only =
        Brief.new(%{
          scene_units: [
            %{
              "unit_id" => "s1",
              "target_change" => %{"type" => "action", "description" => "x"},
              "dialogue_intent" => %{"mode" => "subtext", "hidden_conflict" => "你是否骗了我"}
            }
          ]
        })

      section = Brief.to_prompt_section(hidden_only)
      assert section =~ "对话意图：潜台词：暗里争你是否骗了我"
      refute section =~ "表面谈"
    end

    test "renders sensory anchors; empty/missing anchors add nothing" do
      brief =
        Brief.new(%{
          scene_units: [
            %{
              "unit_id" => "s1",
              "target_change" => %{"type" => "action", "description" => "x"},
              "sensory_anchor" => ["潮湿霉味", " 风扇噪音 ", ""]
            }
          ]
        })

      assert Brief.to_prompt_section(brief) =~ "· 感官锚点：潮湿霉味、风扇噪音"

      no_anchor =
        Brief.new(%{
          scene_units: [
            %{
              "unit_id" => "s1",
              "target_change" => %{"type" => "action", "description" => "x"},
              "sensory_anchor" => []
            }
          ]
        })

      refute Brief.to_prompt_section(no_anchor) =~ "感官锚点"
    end
  end

  # B11C CP1 §3.6：trace 摘要字段覆盖——实际出现的场级结构字段名（规范顺序），
  # 不含正文/内部 id；缺省字段不伪造。
  describe "field_coverage/1" do
    test "nil and empty briefs have no coverage" do
      assert Brief.field_coverage(nil) == []
      assert Brief.field_coverage(Brief.new(%{scene_units: []})) == []
    end

    test "union of present craft fields in canonical order" do
      brief =
        Brief.new(%{
          scene_units: [
            %{
              "unit_id" => "scene_1",
              "target_change" => %{"type" => "planned_scene", "description" => "核对暗扣"},
              "causal_spine" => %{"opposition_or_dilemma" => "摊主拖延"},
              "information_delta" => %{"reader_learns" => "公司抽走频段"},
              "dialogue_intent" => %{"mode" => "direct", "surface_topic" => "对账寒暄"},
              "sensory_anchor" => ["潮湿霉味"]
            },
            %{
              "unit_id" => "scene_2",
              "target_change" => %{"type" => "planned_scene", "description" => "撤离"},
              "character_agendas" => "沈洛要撤",
              "emotion_transition" => %{"end" => "紧绷"}
            }
          ]
        })

      assert Brief.field_coverage(brief) == [
               "target_change",
               "causal_spine",
               "character_agendas",
               "information_delta",
               "emotion_transition",
               "dialogue_intent",
               "sensory_anchor"
             ]
    end

    test "does not report unit identity fields or body content" do
      brief =
        Brief.new(%{
          scene_units: [
            %{
              "unit_id" => "scene_1",
              "scene_title" => "对账",
              "scene_mode" => "planned_scene",
              "target_change" => %{"type" => "action", "description" => "x"}
            }
          ]
        })

      assert Brief.field_coverage(brief) == ["target_change"]
    end
  end
end
