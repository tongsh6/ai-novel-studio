defmodule NovelApplication.AgenticPlanDraftPlannerTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgenticPlanDraftPlanner
  alias NovelCommon.Contracts.ProviderOutput
  alias NovelDomain.AgentRun

  @narrative "作者要求接着第01章继续写，先读取正文上下文，再生成续写草稿并质量复核。"

  defp probe_run do
    {:ok, run} =
      AgentRun.new(%{
        run_id: "run_plan_draft_test",
        workspace_id: "ws_plan_draft",
        work_id: "work_plan_draft",
        session_id: "session_plan_draft",
        parent_turn_ref: "turn_plan_draft",
        origin_frame_ref: "frame_plan_draft",
        profile_ref: "prose_drafting_with_quality_v1",
        goal: %{text: "接着第01章往下写一段正文", version: 1},
        authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]}
      })

    run
  end

  defp plan_arguments do
    %{
      "author_reasoning" => @narrative,
      "plan" => %{
        "steps" => [
          %{
            "step_id" => "s1",
            "kind" => "explore",
            "description" => "读取正文写作上下文",
            "success_criteria" => ["上下文观察"],
            "target_tool_ref" => "context_assemble"
          },
          %{
            "step_id" => "s2",
            "kind" => "act",
            "description" => "生成续写草稿并质量复核",
            "success_criteria" => ["待采纳 prose_fragment"],
            "target_tool_ref" => "prose_writing",
            "write_intent" => "tentative",
            "authoring_intent" => "continuation",
            "target_chapter" => "第01章：开端",
            "requested_chapter_raw" => "第01章"
          }
        ]
      },
      "reason_codes" => ["agent_plan_drafted"],
      "confidence" => 0.9
    }
  end

  defp provider_result(content) do
    tool_calls = [%{"name" => "agent_plan_draft", "arguments" => plan_arguments()}]

    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: "prun_plan_draft",
        provider_call_ref: "pcall_plan_draft",
        status: :ok,
        output_type: :text,
        content: %{text: content, tool_calls: tool_calls},
        refs: ["pcall_plan_draft"]
      })

    %{content: content, tool_calls: tool_calls, provider_output: output}
  end

  test "empty assistant content falls back to author_reasoning tool argument with tool-narrative source binding" do
    execution = %Execution{result_fn: fn _prompt -> {:ok, provider_result("")} end}

    assert {:ok, plan, meta} = AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), execution)

    assert length(plan.steps) == 2
    assert meta.summary == @narrative
    assert meta.author_narrative_source.source_type == "provider_output_tool_narrative"
    assert meta.author_narrative_source.tool_call_name == "agent_plan_draft"
    assert meta.author_narrative_source.narrative_hash == meta.author_narrative_source.source_hash

    # 写作坐标随 PlanStep 透传
    act = Enum.at(plan.steps, 1)
    assert act.authoring_intent == :continuation
    assert act.target_chapter == "第01章：开端"
  end

  test "non-empty assistant content stays the preferred narrative source" do
    execution = %Execution{result_fn: fn _prompt -> {:ok, provider_result(@narrative)} end}

    assert {:ok, _plan, meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), execution)

    assert meta.summary == @narrative
    assert meta.author_narrative_source.source_type == "provider_output"
  end

  test "two-stage protocol: free-form reasoning call first, forced tool call second, narrative binds to reasoning call" do
    test_pid = self()

    {:ok, reasoning_output} =
      ProviderOutput.new(%{
        provider_run_ref: "prun_reasoning",
        provider_call_ref: "pcall_reasoning",
        status: :ok,
        output_type: :text,
        content: %{text: @narrative},
        refs: ["pcall_reasoning"]
      })

    result_fn = fn prompt ->
      send(test_pid, {:prompt, prompt})

      if NovelAgent.Provider.tool_call_prompt?(prompt) do
        # 第二段：强制 tool call，content 系统性为空（LM Studio 形态）
        {:ok, provider_result("")}
      else
        {:ok,
         %{content: @narrative, tool_calls: [], provider_output: reasoning_output}}
      end
    end

    execution = %Execution{result_fn: result_fn}

    assert {:ok, plan, meta} = AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), execution)

    assert_received {:prompt, first_prompt}
    assert_received {:prompt, second_prompt}
    refute NovelAgent.Provider.tool_call_prompt?(first_prompt)
    assert NovelAgent.Provider.tool_choice(second_prompt) == "agent_plan_draft"

    # 第二段 prompt 内嵌第一段 reasoning
    assert second_prompt.messages |> hd() |> Map.fetch!(:content) =~ @narrative

    assert length(plan.steps) == 2
    assert meta.provider_call_count == 2
    assert meta.summary == @narrative
    # 叙事绑定第一段（流式 reasoning）的 provider output，而不是结构调用
    assert meta.author_narrative_source.source_type == "provider_output"
    assert meta.author_narrative_source.provider_run_ref == "prun_reasoning"
  end

  test "conversation plan with creative tool as standalone step is rejected at draft time" do
    test_pid = self()

    {:ok, run} =
      NovelDomain.AgentRun.new(%{
        run_id: "run_plan_target_test",
        workspace_id: "ws_plan_target",
        work_id: "work_plan_target",
        session_id: "session_plan_target",
        parent_turn_ref: "turn_plan_target",
        origin_frame_ref: "frame_plan_target",
        profile_ref: "conversation_turn_v1",
        # 对话 profile 的 authority_scope 允许创作工具（由 strategy_gate 裁决后在
        # 回应管线内调用），但它们不是合法的独立 PlanStep 目标
        goal: %{text: "聊聊世界观怎么立", version: 1},
        authority_scope: %{
          production_write: false,
          allowed_tools: ["world_building", "prose_writing"]
        }
      })

    bad_arguments = %{
      "author_reasoning" => @narrative,
      "plan" => %{
        "steps" => [
          %{
            "step_id" => "s1",
            "kind" => "explore",
            "description" => "读取上下文",
            "success_criteria" => [],
            "target_tool_ref" => "context_assemble"
          },
          %{
            "step_id" => "s2",
            "kind" => "act",
            "description" => "调用 world_building 推演设定",
            "success_criteria" => [],
            "target_tool_ref" => "world_building"
          }
        ]
      },
      "reason_codes" => ["agent_plan_drafted"],
      "confidence" => 0.9
    }

    bad_tool_calls = [%{"name" => "agent_plan_draft", "arguments" => bad_arguments}]

    result_fn = fn prompt ->
      if NovelAgent.Provider.tool_call_prompt?(prompt) do
        send(test_pid, {:structure_prompt, prompt})
        {:ok, %{content: "", tool_calls: bad_tool_calls}}
      else
        {:ok, %{content: @narrative, tool_calls: []}}
      end
    end

    assert {:error, {:plan_step_target_not_allowed, ["world_building"]}} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(run, %Execution{result_fn: result_fn})

    # 起草被拒后走了一次纠错重试（第二个结构 prompt 是纠错 prompt）
    assert_received {:structure_prompt, _first}
    assert_received {:structure_prompt, retry_prompt}

    retry_text = retry_prompt.messages |> hd() |> Map.fetch!(:content)
    assert retry_text =~ "无法被系统解析"
  end

  test "empty content and missing author_reasoning still fails honestly after retry" do
    arguments = Map.delete(plan_arguments(), "author_reasoning")
    tool_calls = [%{"name" => "agent_plan_draft", "arguments" => arguments}]

    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: "prun_plan_draft",
        provider_call_ref: "pcall_plan_draft",
        status: :ok,
        output_type: :text,
        content: %{text: "", tool_calls: tool_calls},
        refs: ["pcall_plan_draft"]
      })

    execution = %Execution{
      result_fn: fn _prompt ->
        {:ok, %{content: "", tool_calls: tool_calls, provider_output: output}}
      end
    }

    assert {:error, :reasoning_text_required} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), execution)
  end
end
