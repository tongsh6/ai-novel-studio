defmodule NovelApplication.TranscriptCompactionResponseValidationTest do
  @moduledoc """
  响应拒收事实对压缩保留窗口和摘要材料的影响；原始消息及回执仍保留。
  """

  use ExUnit.Case, async: true

  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.TranscriptCompaction
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.MessageCoverage
  alias NovelCommon.RequestIR.Projection

  @author_text "先读取沈砚的当前叙事身份，再给出把主角改为顾青的 tentative 候选。"

  defp run do
    %{
      run_id: "run-compaction-1",
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      parent_turn_ref: "turn-1",
      goal: %{text: @author_text}
    }
  end

  defp base_transcript(run_identity \\ run(), opts \\ []) do
    AuthoringTranscript.new(
      run_identity,
      Keyword.merge(
        [
          base_text: "run goal: 读取角色事实后给出 tentative 候选",
          author_text: @author_text,
          author_turn_ref: "turn-1",
          tools: [%{name: "read_character", description: "读取角色", input_schema: %{type: "object"}}]
        ],
        opts
      )
    )
  end

  @tag :r08_response_rejection
  test "R08 最近 K 不让失败尝试挤占真实讨论的保留位置，原文和回执仍在" do
    transcript = response_rejection_compaction_transcript()
    before = transcript.messages

    assert {:ok, plan} = TranscriptCompaction.plan_maintenance(transcript, keep_recent_items: 1)
    assert plan.retained_items == 1
    assert plan.covers.call_ids == []

    assert plan.covers.message_refs == [
             %{
               run_id: "r08-old-discussion",
               run_sequence: 2,
               role: "assistant",
               source_refs: [],
               versions: %{}
             }
           ]

    assert plan.discussion_sources == [
             %{
               source_index: 0,
               source: %{run_id: "r08-old-discussion", run_sequence: 2},
               text: "较早的正常讨论。",
               author_text: "讨论第一件事。"
             }
           ]

    assert transcript.messages == before

    assert Enum.any?(
             before,
             &(&1.role == "assistant" and Projection.text_of(&1.blocks) == "  未接收的末次尝试。\r\n")
           )

    assert Enum.any?(before, &(&1.role == "application_notice"))
  end

  @tag :r08_response_rejection
  test "R08 K=0 只把真实旧讨论交摘要，失败末稿不成为第三份材料或工具项" do
    transcript = response_rejection_compaction_transcript()
    assert {:ok, plan} = TranscriptCompaction.plan_maintenance(transcript, keep_recent_items: 0)
    assert plan.retained_items == 0
    assert plan.covers.call_ids == []
    assert Enum.map(plan.covers.message_refs, & &1.run_sequence) == [2, 4]

    assert Enum.map(plan.discussion_sources, &{&1.source_index, &1.text, &1.author_text}) == [
             {0, "较早的正常讨论。", "讨论第一件事。"},
             {1, "最近的正常讨论。", "讨论第二件事。"}
           ]

    refute inspect(plan.discussion_sources) =~ "未接收的末次尝试"
    assert length(transcript.messages) == 8
  end

  defp response_rejection_compaction_transcript do
    current = base_transcript()

    old_run =
      Map.merge(run(), %{
        run_id: "r08-old-discussion",
        parent_turn_ref: "old-author-1",
        status: "completed"
      })

    refs = %{
      provider_call_ref: "pcall-r08-compaction-rejected",
      provider_run_ref: "prun-r08-compaction-rejected"
    }

    receipt = %{
      type: "validation_result",
      status: "failed",
      reason_code: "invalid_narrative",
      detail: %{"message" => "本次响应未通过接收，未作为作者回复发布；仍在处理原作者输入。\n请只纠正这次说明。"},
      retryable: false,
      budget_after: %{"exchange" => %{"provider_call_budget" => 2, "provider_call_count" => 2}}
    }

    history = [
      RequestIR.message(:user, :author, [RequestIR.text_block("讨论第一件事。")], %{
        source_refs: [%{ref: "old-author-1"}]
      }),
      RequestIR.message(:assistant, :model, [RequestIR.text_block("较早的正常讨论。")]),
      RequestIR.message(:user, :author, [RequestIR.text_block("讨论第二件事。")], %{
        source_refs: [%{ref: "old-author-2"}]
      }),
      RequestIR.message(:assistant, :model, [RequestIR.text_block("最近的正常讨论。")]),
      RequestIR.message(:assistant, :model, [RequestIR.text_block("  未接收的末次尝试。\r\n")], refs),
      RequestIR.message(:application_notice, :application, [receipt], refs)
    ]

    history = MessageCoverage.annotate(history, old_run)
    [base, author] = current.messages
    %{current | messages: [base] ++ history ++ [author]}
  end
end
