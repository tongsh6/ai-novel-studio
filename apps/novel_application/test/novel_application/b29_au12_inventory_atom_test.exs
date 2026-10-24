defmodule NovelApplication.B29Au12InventoryAtomTest do
  use ExUnit.Case, async: true

  alias NovelApplication.FactInventoryService

  test "artifact_type_atom 显式白名单映射（含 work_skeleton_suggestion），未知返回 :error 不 crash/不建 atom" do
    assert {:ok, :character_seed} = FactInventoryService.artifact_type_atom("character_seed")

    assert {:ok, :work_skeleton_suggestion} =
             FactInventoryService.artifact_type_atom("work_skeleton_suggestion")

    assert :error = FactInventoryService.artifact_type_atom("mystery_seed")
    assert :error = FactInventoryService.artifact_type_atom(nil)
    assert :error = FactInventoryService.artifact_type_atom(:work_skeleton_suggestion)
  end

  test "artifact_sets 含 work_skeleton_suggestion 不 badarg（AU12 首轮盘点路径）" do
    proposal = %{
      skeleton_suggestions: [
        %{
          item_id: "skeleton_target_length",
          title: "全书目标字数",
          body: "建议 80 万字",
          rationale: "长篇连载",
          provider_call_ref: "pc-1"
        }
      ]
    }

    attrs = %{source_turn_ref: "turn-au12", source_tool_result_ref: "tool-au12"}

    assert [set] = FactInventoryService.artifact_sets(proposal, attrs)
    assert set.artifact_type == :work_skeleton_suggestion
    assert set.items == proposal.skeleton_suggestions
    assert set.source_turn_ref == "turn-au12"
  end

  test "未知 artifact_type 解析为可解释错误，不 crash" do
    content =
      Jason.encode!([
        %{
          "artifact_type" => "mystery_seed",
          "item_id" => "x",
          "title" => "x",
          "body" => "x",
          "rationale" => nil
        }
      ])

    assert {:error, {:unsupported_inventory_artifact_type, "mystery_seed"}} =
             FactInventoryService.parse_proposal(content)
  end
end
