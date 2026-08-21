defmodule NovelCommon.Contracts.ToolOutputContractTest do
  use ExUnit.Case, async: true

  alias NovelCommon.Contracts.ToolOutputContract

  test "validates prose companion artifacts and preserves existing seed semantics" do
    assert {:ok,
            [
              %{
                artifact_type: :character_seed,
                item_id: "char-new",
                title: "岑雾",
                body: "新登场的巡夜人",
                rationale: "正文中首次出场",
                narrative_role: "SUPPORTING"
              },
              %{
                artifact_type: :constraint_seed,
                item_id: "constraint-night",
                title: "夜间约束",
                body: "日落后不得点灯",
                rationale: "作者明确要求"
              }
            ]} =
             ToolOutputContract.validate_prose_companion_artifacts([
               %{
                 "artifact_type" => "character_seed",
                 "item_id" => "char-new",
                 "title" => "岑雾",
                 "body" => "新登场的巡夜人",
                 "rationale" => "正文中首次出场",
                 "narrative_role" => "SUPPORTING"
               },
               %{
                 "artifact_type" => "constraint_seed",
                 "item_id" => "constraint-night",
                 "title" => "夜间约束",
                 "body" => "日落后不得点灯",
                 "rationale" => "作者明确要求"
               }
             ])

    assert {:error, %{code: "invalid_companion_artifact"}} =
             ToolOutputContract.validate_prose_companion_artifacts([
               %{
                 artifact_type: "style_rule_seed",
                 item_id: "style",
                 title: "风格",
                 body: "短句",
                 rationale: nil
               }
             ])
  end

  test "rejects duplicate item ids across prose and companions" do
    primary = [%{item_id: "same"}]
    companions = [%{item_id: "same", artifact_type: :world_rule_seed}]

    assert {:error, %{code: "duplicate_item_id"}} =
             ToolOutputContract.validate_unique_item_ids(primary, companions)
  end

  test "accepts explicit archive artifact types" do
    assert {:ok, :foreshadowing_seed} =
             ToolOutputContract.normalize_artifact_type("foreshadowing_seed")

    assert {:ok, :world_rule_seed} =
             ToolOutputContract.normalize_artifact_type(:world_rule_seed)

    assert {:ok, :style_rule_seed} =
             ToolOutputContract.normalize_artifact_type("style_rule_seed")

    assert {:ok, :constraint_seed} =
             ToolOutputContract.normalize_artifact_type(:constraint_seed)
  end

  test "normalizes creative output self report as non-authoritative signal" do
    assert {:ok,
            %{
              assumptions: ["按章计划处理"],
              intended_reader_effect: "紧张、期待",
              used_context_refs: ["reader_effect_brief", "target_structure"],
              risk_flags: ["章尾钩子需作者确认"],
              quality_action: :confirm
            }} =
             ToolOutputContract.normalize_creative_self_report(%{
               "assumptions" => ["按章计划处理", ""],
               "intended_reader_effect" => " 紧张、期待 ",
               "used_context_refs" => ["reader_effect_brief", "target_structure"],
               "risk_flags" => ["章尾钩子需作者确认"]
             })
  end

  test "drops empty or invalid self report" do
    assert {:ok, nil} = ToolOutputContract.normalize_creative_self_report(%{})
    assert {:ok, nil} = ToolOutputContract.normalize_creative_self_report("not-a-map")
  end

  test "maps risk flags to quality actions" do
    assert ToolOutputContract.self_report_quality_action([]) == :proceed
    assert ToolOutputContract.self_report_quality_action(["节奏偏弱"]) == :warn
    assert ToolOutputContract.self_report_quality_action(["需要作者确认主线承诺"]) == :confirm
    assert ToolOutputContract.self_report_quality_action(["严重冲突，禁止采纳"]) == :block
  end

  describe "narrative_role 流转（AU-09 角色类型/主角语义）" do
    test "保留合法 canonical 叙事角色到 item" do
      assert {:ok, [item]} =
               ToolOutputContract.validate_creative_items([
                 %{item_id: "i1", title: "林烬", body: "稽查官", narrative_role: "PROTAGONIST"}
               ])

      assert item.narrative_role == "PROTAGONIST"
    end

    test "把中文角色类型同义词归一化到枚举" do
      assert ToolOutputContract.normalize_narrative_role("主角") == "PROTAGONIST"
      assert ToolOutputContract.normalize_narrative_role("反派") == "ANTAGONIST"
      assert ToolOutputContract.normalize_narrative_role("配角") == "SUPPORTING"
      assert ToolOutputContract.normalize_narrative_role("群像视角") == "ENSEMBLE_POV"
      assert ToolOutputContract.normalize_narrative_role("protagonist") == "PROTAGONIST"
    end

    test "无法识别的叙事角色与缺省时为 nil，不写入 item" do
      assert ToolOutputContract.normalize_narrative_role("不知道") == nil
      assert ToolOutputContract.normalize_narrative_role(nil) == nil

      assert {:ok, [item]} =
               ToolOutputContract.validate_creative_items([
                 %{item_id: "i2", title: "无名", body: "身份不明"}
               ])

      refute Map.has_key?(item, :narrative_role)
    end

    # AU12 CP2 角色主体输入面：role/aliases 是重建式白名单的显式 opt-in 键——
    # 不加白名单模型输出会被静默丢弃（narrative_role 同先例）。
    test "role/aliases 收敛后保留到 item；空壳与非法形状整键丢弃" do
      assert {:ok, [item]} =
               ToolOutputContract.validate_creative_items([
                 %{
                   item_id: "i1",
                   title: "云栖",
                   body: "关键配角",
                   role: "  旧机房维护者 ",
                   aliases: ["栖姐", " 栖姐 ", "", 42, "云姨"]
                 }
               ])

      assert item.role == "旧机房维护者"
      assert item.aliases == ["栖姐", "云姨"]

      assert {:ok, [bare]} =
               ToolOutputContract.validate_creative_items([
                 %{item_id: "i2", title: "无名", body: "身份不明", role: "  ", aliases: ["", 1]}
               ])

      refute Map.has_key?(bare, :role)
      refute Map.has_key?(bare, :aliases)
    end

    # VS00F 刀④：伏笔预期回收槽——预期归伏笔自己，不合法整键丢弃（机器不发明预期）。
    test "planned_reveal 收敛为 kind/seq 结构；whole_book 不带 seq；不合法丢弃" do
      assert {:ok, [item]} =
               ToolOutputContract.validate_creative_items([
                 %{
                   item_id: "f1",
                   title: "矿区旧账",
                   body: "编号伏笔",
                   planned_reveal: %{"kind" => "Volume", "seq" => "3"}
                 }
               ])

      assert item.planned_reveal == %{"kind" => "volume", "seq" => 3}

      assert {:ok, [whole]} =
               ToolOutputContract.validate_creative_items([
                 %{
                   item_id: "f2",
                   title: "身世之谜",
                   body: "贯穿全书",
                   planned_reveal: %{"kind" => "whole_book"}
                 }
               ])

      assert whole.planned_reveal == %{"kind" => "whole_book"}

      for bad <- [
            %{"kind" => "chapter"},
            %{"kind" => "sometime", "seq" => 3},
            %{"seq" => 5},
            "第三卷"
          ] do
        assert {:ok, [dropped]} =
                 ToolOutputContract.validate_creative_items([
                   %{item_id: "f3", title: "x", body: "y", planned_reveal: bad}
                 ])

        refute Map.has_key?(dropped, :planned_reveal)
      end
    end

    # VS00F 刀④ CP3：回收提案槽——resolution_target 必须锚定账面引用，防臆造。
    test "resolution_target/resolved_at_seq 收敛；非 foreshadow_ 引用整键丢弃" do
      assert {:ok, [item]} =
               ToolOutputContract.validate_creative_items([
                 %{
                   item_id: "r1",
                   title: "矿区旧账",
                   body: "第7章已兑现",
                   resolution_target: " foreshadow_abc ",
                   resolved_at_seq: "7"
                 }
               ])

      assert item.resolution_target == "foreshadow_abc"
      assert item.resolved_at_seq == 7

      assert {:ok, [bad]} =
               ToolOutputContract.validate_creative_items([
                 %{item_id: "r2", title: "x", body: "y", resolution_target: "memory_item:1"}
               ])

      refute Map.has_key?(bad, :resolution_target)
    end

    test "memory_subtype 归一化到角色 MemoryType 子集并保留到 item（AU-09 §4.5）" do
      assert ToolOutputContract.normalize_memory_subtype("relationship") == "RELATIONSHIP"
      assert ToolOutputContract.normalize_memory_subtype("结盟反目") == "RELATIONSHIP"
      assert ToolOutputContract.normalize_memory_subtype("当前状态") == "CURRENT_STATE"
      assert ToolOutputContract.normalize_memory_subtype("黑化") == "CHARACTER_PROFILE"
      assert ToolOutputContract.normalize_memory_subtype("不知道") == nil
      assert ToolOutputContract.normalize_memory_subtype(nil) == nil

      assert {:ok, [item]} =
               ToolOutputContract.validate_creative_items([
                 %{
                   item_id: "evo1",
                   title: "林烬：演化",
                   body: "黑化转向",
                   memory_subtype: "CHARACTER_PROFILE"
                 }
               ])

      assert item.memory_subtype == "CHARACTER_PROFILE"
    end

    test "narrative_role 不影响 I1（title/body/rationale）契约校验" do
      assert {:ok, [item]} =
               ToolOutputContract.validate_creative_items([
                 %{
                   item_id: "i3",
                   title: "苏晚",
                   body: "并列视角主角",
                   rationale: "群像结构",
                   narrative_role: "乱填"
                 }
               ])

      assert item.title == "苏晚"
      assert item.body == "并列视角主角"
      assert item.rationale == "群像结构"
      refute Map.has_key?(item, :narrative_role)
    end
  end
end
