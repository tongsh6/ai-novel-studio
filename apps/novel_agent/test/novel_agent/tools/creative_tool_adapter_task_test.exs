defmodule NovelAgent.Tools.CreativeToolAdapterTaskTest do
  use ExUnit.Case, async: true

  alias NovelAgent.CreativeProvider.Real
  alias NovelAgent.Provider.Execution
  alias NovelAgent.Tools.CreativeToolAdapter
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.AuthoringTask
  alias NovelCommon.Contracts.ToolRequest
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.SystemEnvelope

  @good_json Jason.encode!([
               %{item_id: "i1", title: "开篇", body: "夜色压在账单上。", rationale: nil}
             ])

  defp task_map do
    %AuthoringTask{
      kind: :first_draft,
      author_goal: "写第 01 章开篇",
      author_words: "把第一章开篇写出来 NONCE42",
      source: %{kind: :author_action, ref: "turn-1"},
      scope: %{refs: ["chapter:one"], coverage: :chapter},
      materials: [
        %{kind: :target_structure, ref: "target_structure:chapter:one", complete?: true}
      ],
      preserve: [],
      operation_effect: :create_candidate,
      output_contract: %{
        kind: :json,
        schema_ref: "prose_writing_v1",
        artifact_type: :prose_fragment,
        required_keys: ["items", "item_id", "title", "body"],
        allow_companions: true
      },
      source_refs: ["turn-1"],
      semantic_version: AuthoringSemantics.version()
    }
    |> AuthoringTask.to_map()
  end

  defp tool_request(input) do
    %ToolRequest{
      tool_request_id: "tq_task",
      turn_id: "turn-1",
      frame_ref: "frame-1",
      decision_ref: "decision-1",
      tool_name: "prose_writing",
      tool_version: "1.0.0",
      input: input
    }
  end

  defp execution(agent) do
    %Execution{
      result_fn: fn prompt ->
        Agent.update(agent, fn _ -> prompt end)

        {:ok,
         %{
           content: "",
           tool_calls: [
             %{
               id: "task-artifact",
               name: "submit_tentative_artifact",
               arguments: %{items: Jason.decode!(@good_json)}
             }
           ]
         }}
      end
    }
  end

  test "restores and validates authoring task from JSON-safe ToolRequest input" do
    {:ok, agent} = Agent.start_link(fn -> nil end)

    input =
      %{
        "source_input_ref" => "turn-1",
        "creative_brief" => "用户创作简述占位",
        "context_text" => "上下文占位"
      }
      |> Map.merge(%{"authoring_task" => Jason.decode!(Jason.encode!(task_map()))})

    result =
      CreativeToolAdapter.execute(tool_request(input), :prose_fragment, execution(agent), Real)

    assert result.status == :succeeded
    ir = Agent.get(agent, & &1)
    assert %RequestIR{} = ir
    assert [%{name: "submit_tentative_artifact"}] = ir.tools
    assert Enum.any?(ir.messages, &(&1.source_refs != []))

    system = SystemEnvelope.system_text(ir.system)
    assert system =~ "## 创作协作共同规则"
    assert system =~ "本轮为首稿创作"
    refute system =~ "把第一章开篇写出来 NONCE42"

    assert [author] = Enum.filter(ir.messages, &(&1.role == "user"))
    assert author.provenance == "author"
    assert author.blocks == [RequestIR.text_block("把第一章开篇写出来 NONCE42")]
    assert author.source_refs == [%{ref: "turn-1"}]

    scope = NovelTest.TestProviderPrompt.scope_content(ir)
    assert scope["authoring_task"]["kind"] == "first_draft"
    assert scope["authoring_task"]["author_goal"] == "写第 01 章开篇"
    refute Map.has_key?(scope["authoring_task"], "author_words")
    assert scope["operation"]["capability"] == "prose_writing"
    assert scope["operation"]["artifact_type"] == "prose_fragment"
    assert scope["operation"]["creative_brief"] == input["creative_brief"]
    assert scope["operation"]["context_text"] == input["context_text"]
  end

  test "invalid authoring task fails the tool call instead of silently falling back" do
    {:ok, agent} = Agent.start_link(fn -> 0 end)

    invalid = %{"kind" => :revision, "operation_effect" => :create_candidate}

    result =
      CreativeToolAdapter.execute(
        tool_request(%{"creative_brief" => "x", "authoring_task" => invalid}),
        :prose_fragment,
        execution(agent),
        Real
      )

    assert result.status == :failed
    assert [%{code: "authoring_task_invalid", message: message}] = result.errors
    assert message =~ "invalid authoring task"
    assert Agent.get(agent, & &1) == 0
  end

  test "call without authoring_task fails instead of falling back to legacy template" do
    {:ok, agent} = Agent.start_link(fn -> nil end)

    result =
      CreativeToolAdapter.execute(
        tool_request(%{"creative_brief" => "写第一章开篇", "context_text" => "赛博修仙"}),
        :prose_fragment,
        execution(agent),
        Real
      )

    assert result.status == :failed
    assert [%{code: "authoring_task_required"}] = result.errors
    assert Agent.get(agent, & &1) == nil
  end
end
