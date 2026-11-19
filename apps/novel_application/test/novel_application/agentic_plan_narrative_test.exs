defmodule NovelApplication.AgenticPlanNarrativeTest do
  use ExUnit.Case, async: true

  import NovelApplication.TestAgenticLoopFixtures, only: [plan_tool_call_result: 3, plan_step: 4]

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgenticPlanDraftPlanner
  alias NovelCommon.Contracts.ProviderOutput
  alias NovelDomain.AgentRun

  @narrative "先核对第一章的事实，再说明人物选择的依据。"

  setup do
    {:ok, run} =
      AgentRun.new(%{
        run_id: "run_plan_narrative",
        workspace_id: "ws_plan_narrative",
        work_id: "work_plan_narrative",
        session_id: "session_plan_narrative",
        parent_turn_ref: "turn_plan_narrative",
        origin_frame_ref: "frame_plan_narrative",
        profile_ref: "readonly_batch_context_v1",
        goal: %{text: "只读取第一章并分析人物选择，不生成候选、不修改作品", version: 1},
        authority_scope: %{production_write: false, allowed_tools: ["work_archive_read"]}
      })

    %{run: run}
  end

  for {operation, tool_name} <- [
        {:draft_plan_with_meta, "agent_plan_draft"},
        {:revise_plan_with_meta, "agent_plan_revision"}
      ] do
    @operation operation
    @tool_name tool_name

    test "#{tool_name} 拒绝真实内部身份，原调用失败回执保留且不换干净字段逃逸", %{run: run} do
      leaked = "将核对 character:e9fe5f90-c939-4f9e-abee-da235d1eaa45 的身份。"

      for origin <- [:content, :tool_arguments] do
        {content, author_reasoning} =
          case origin do
            :content -> {leaked, @narrative}
            :tool_arguments -> {"", leaked}
          end

        calls =
          for attempt <- 1..2 do
            ref = "#{@tool_name}-#{origin}-#{attempt}"

            {:ok,
             response(content, @tool_name, call_ref: ref, author_reasoning: author_reasoning)}
          end

        assert {:error, {:agent_plan_protocol_violation, :author_visible_narrative_invalid}, meta} =
                 apply(AgenticPlanDraftPlanner, @operation, [run, execution(calls), %{}])

        assert meta.provider_call_count == 2
        assert validation_statuses(meta.judgment_transcript) == ["failed", "failed"]

        receipts =
          for message <- meta.judgment_transcript.messages,
              block <- message.blocks,
              block.type == "validation_result",
              do: block.call_id

        assert receipts == [
                 "tool-#{@tool_name}-#{origin}-1",
                 "tool-#{@tool_name}-#{origin}-2"
               ]

        assert Enum.any?(meta.judgment_transcript.messages, fn message ->
                 message.role == "assistant" and
                   Enum.any?(message.blocks, fn block ->
                     (block.type == "text" and block.text == leaked) or
                       (block.type == "tool_call" and
                          block.arguments["author_reasoning"] == leaked)
                   end)
               end)

        assert Process.get(:plan_narrative_responses) == []
      end
    end

    test "#{tool_name} 只交付本次纠正后的原始说明，失败来源不冒充成功来源", %{run: run} do
      leaked = "读取 chapter:550e8400-e29b-41d4-a716-446655440000 后继续。"
      accepted = "  灯笺736：先核对第一章。\n\n保留 **角色选择**，再说明判断。\n"

      provider =
        execution([
          {:ok, response(leaked, @tool_name, call_ref: "bad-call")},
          {:ok, response(accepted, @tool_name, call_ref: "good-call")}
        ])

      assert {:ok, _plan, meta} =
               apply(AgenticPlanDraftPlanner, @operation, [run, provider, %{}])

      assert meta.summary == accepted
      assert meta.provider_call_count == 2
      assert validation_statuses(meta.judgment_transcript) == ["failed", "passed"]
      assert meta.author_narrative_source.provider_call_ref == "good-call"

      assert meta.author_narrative_source.source_byte_range == %{
               start: 0,
               length: byte_size(accepted)
             }

      assert meta.author_narrative_source.narrative_hash ==
               Base.encode16(:crypto.hash(:sha256, accepted), case: :lower)

      assert Process.get(:plan_narrative_responses) == []
    end

    test "#{tool_name} 校验选中的正文并保持原字节，不把私有字段套到公开正文", %{run: run} do
      accepted = "  她的工作过程体现了迟疑。\n\n**先查账，再追问。**\n"
      result = response(accepted, @tool_name, author_reasoning: "request_ir")

      assert {:ok, _plan, meta} =
               apply(AgenticPlanDraftPlanner, @operation, [
                 run,
                 execution([{:ok, result}]),
                 %{}
               ])

      assert meta.summary == accepted
      assert meta.author_narrative_source.source_type == "provider_output"

      result = response("", @tool_name, author_reasoning: accepted)

      assert {:ok, _plan, meta} =
               apply(AgenticPlanDraftPlanner, @operation, [
                 run,
                 execution([{:ok, result}]),
                 %{}
               ])

      assert meta.summary == accepted
      assert meta.author_narrative_source.source_type == "provider_output_tool_narrative"
      assert meta.author_narrative_source.tool_call_narrative_field == "author_reasoning"
    end
  end

  test "同批 inline plan 也在唯一选中来源处校验，不能从另一字段补合格正文", %{run: run} do
    leaked = "内部目标 chapter:550e8400-e29b-41d4-a716-446655440000"

    for result <- [
          response(leaked),
          response("", "agent_plan_draft", author_reasoning: leaked)
        ] do
      assert {:error, :author_visible_narrative_invalid} =
               AgenticPlanDraftPlanner.plan_from_result(run, result)
    end

    accepted = "  先核对第一章的线索。\n\n随后说明判断。\n"

    assert {:ok, _plan, meta} =
             AgenticPlanDraftPlanner.plan_from_result(
               run,
               response(accepted, "agent_plan_draft", author_reasoning: leaked)
             )

    assert meta.summary == accepted
    assert meta.author_narrative_source.source_type == "provider_output"

    assert {:ok, _plan, meta} =
             AgenticPlanDraftPlanner.plan_from_result(
               run,
               response("", "agent_plan_draft", author_reasoning: accepted)
             )

    assert meta.summary == accepted
    assert meta.author_narrative_source.tool_call_narrative_field == "author_reasoning"
  end

  defp response(content, tool_name \\ "agent_plan_draft", opts \\ []) do
    result =
      plan_tool_call_result(
        Keyword.get(opts, :author_reasoning, @narrative),
        [
          plan_step("read-facts", "readonly_batch", "读取第一章的作品事实",
            success_criteria: ["获得判断人物选择所需的事实"]
          )
        ],
        tool_name: tool_name
      )

    call_ref = Keyword.get(opts, :call_ref, "narrative-call")
    tool_calls = Enum.map(result.tool_calls, &Map.put(&1, "id", "tool-#{call_ref}"))

    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: "prun-#{call_ref}",
        provider_call_ref: call_ref,
        status: :ok,
        output_type: :text,
        content: %{text: content, tool_calls: tool_calls},
        refs: [call_ref]
      })

    %{result | content: content, tool_calls: tool_calls}
    |> Map.put(:provider_output, output)
  end

  defp execution(responses) do
    Process.put(:plan_narrative_responses, responses)

    %Execution{
      result_fn: fn _request ->
        [response | rest] = Process.get(:plan_narrative_responses)
        Process.put(:plan_narrative_responses, rest)
        response
      end
    }
  end

  defp validation_statuses(transcript) do
    for message <- transcript.messages,
        block <- message.blocks,
        Map.get(block, :type) == "validation_result",
        do: block.status
  end
end
