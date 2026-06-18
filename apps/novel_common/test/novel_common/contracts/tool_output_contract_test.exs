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
end
