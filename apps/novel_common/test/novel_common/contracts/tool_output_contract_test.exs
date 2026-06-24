defmodule NovelCommon.Contracts.ToolOutputContractTest do
  use ExUnit.Case, async: true

  alias NovelCommon.Contracts.ToolOutputContract

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
