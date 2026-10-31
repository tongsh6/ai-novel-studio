defmodule NovelApplication.FactInventoryProposalTest do
  use ExUnit.Case, async: true

  alias NovelApplication.FactInventoryProposal

  defp report(disposition \\ nil) do
    %{
      id: "report-r5",
      work_id: "work-1",
      adoption_status: "TENTATIVE",
      findings: [
        %{
          "rule" => "protagonist_undermaterialized",
          "signal" => "已写 10 章但尚无主角档案",
          "proposed_disposition" => "revise_design",
          "disposition" => disposition
        }
      ]
    }
  end

  defp turn_result do
    %{
      turn_id: "turn-review",
      assistant_message: %{text: "全书审读完成。"},
      available_actions: [],
      ui_cards: []
    }
  end

  test "未处置 R5 在真实审读结果上提供盘点与关闭动作，不启动 run、不造候选或 canon" do
    result = FactInventoryProposal.attach_to_report(turn_result(), report())

    assert result.assistant_message.text =~ "已写 10 章但尚无主角档案"
    assert result.assistant_message.text =~ "逐项确认后才会进入作品档案"
    assert result.ui_cards == []
    refute Map.has_key?(result, :adoption_state)
    refute Map.has_key?(result, :agent_run)

    assert [
             %{
               action_type: "start_fact_inventory",
               target_ref: "finding:report-r5:0",
               source_turn_ref: "turn-review"
             },
             %{action_type: "adjudicate_finding", target_ref: "finding:report-r5:0"}
           ] = result.available_actions

    assert FactInventoryProposal.author_payload(
             "start_fact_inventory",
             "finding:report-r5:0"
           ) == %{
             "trigger_type" => "finding",
             "report_id" => "report-r5",
             "finding_index" => 0,
             "finding_rule" => "protagonist_undermaterialized",
             "proposal_ref" => "finding:report-r5:0"
           }

    assert FactInventoryProposal.author_payload(
             "adjudicate_finding",
             "finding:report-r5:0"
           ) == %{
             "report_id" => "report-r5",
             "finding_index" => 0,
             "disposition" => "dismiss",
             "proposal_ref" => "finding:report-r5:0"
           }
  end

  test "旧提议提交时绑定当前活跃的同规则 finding，非提议 payload 不改写" do
    payload = FactInventoryProposal.author_payload("start_fact_inventory", "finding:old:0")
    current = put_in(report(), [:findings, Access.at(0), "signal"], "新报告")

    assert FactInventoryProposal.rebind_author_payload(
             "work-1",
             "start_fact_inventory",
             payload,
             current
           ) == %{payload | "report_id" => "report-r5", "finding_index" => 0}

    ordinary = %{"report_id" => "old", "finding_index" => 0, "disposition" => "dismiss"}

    assert FactInventoryProposal.rebind_author_payload(
             "work-1",
             "adjudicate_finding",
             ordinary,
             current
           ) == ordinary
  end

  test "已处置、历史已关闭或非 R5 的条目不重复提议" do
    assert FactInventoryProposal.attach_to_report(turn_result(), report("dismiss")) ==
             turn_result()

    assert FactInventoryProposal.attach_to_report(turn_result(), report(), true) ==
             turn_result()

    unrelated = put_in(report(), [:findings, Access.at(0), "rule"], "skeleton_missing")
    assert FactInventoryProposal.attach_to_report(turn_result(), unrelated) == turn_result()
  end

  test "已展示过发起但未处置：重复审读只保留关闭动作，不重复发起（原提议不消失）" do
    opts = %{dispositioned?: false, shown?: true}
    result = FactInventoryProposal.attach_to_report(turn_result(), report(), opts)

    assert [
             %{
               action_type: "adjudicate_finding",
               target_ref: "finding:report-r5:0",
               label_key: "fact_inventory.dismiss"
             }
           ] = result.available_actions

    assert result.assistant_message.text =~ "此前的盘点提议仍待处理"
    refute Enum.any?(result.available_actions, &(&1.action_type == "start_fact_inventory"))
    # 已处置（作者关闭/采纳）仍然完全不附加
    assert FactInventoryProposal.attach_to_report(turn_result(), report(), %{
             dispositioned?: true,
             shown?: true
           }) == turn_result()
  end

  test "历史恢复只撤销已处置的提议动作，保留其它真实动作" do
    proposed = FactInventoryProposal.attach_to_report(turn_result(), report())
    other = %{action_id: "other", action_type: "accept", target_ref: "artifact-1"}
    proposed = Map.update!(proposed, :available_actions, &(&1 ++ [other]))

    recovered = FactInventoryProposal.revalidate(proposed, "work-1", resolved_rule?: true)

    assert recovered.available_actions == [other]
    assert FactInventoryProposal.author_payload("start_fact_inventory", "finding:bad") == nil
  end
end
