defmodule NovelAgent.Tools.CreativeToolAdapterTaskTest do
  use ExUnit.Case, async: true

  alias NovelAgent.CreativeProvider.Real
  alias NovelAgent.Provider.Execution
  alias NovelAgent.Tools.CreativeToolAdapter
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.AuthoringTask
  alias NovelCommon.Contracts.ToolRequest

  @good_json Jason.encode!([
               %{item_id: "i1", title: "开篇", body: "夜色压在账单上。", rationale: nil}
             ])

  defp task_map do
    %AuthoringTask{
      kind: :first_draft,
      author_goal: "写第 01 章开篇",
      author_words: "把第一章开篇写出来 NONCE42",
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
      source_refs: ["turn:t1"],
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
        {:ok, %{content: @good_json}}
      end
    }
  end

  test "restores and validates authoring task from JSON-safe ToolRequest input" do
    {:ok, agent} = Agent.start_link(fn -> nil end)

    input =
      %{
        "creative_brief" => "用户创作简述占位",
        "context_text" => "上下文占位"
      }
      |> Map.merge(%{"authoring_task" => Jason.decode!(Jason.encode!(task_map()))})

    result =
      CreativeToolAdapter.execute(tool_request(input), :prose_fragment, execution(agent), Real)

    assert result.status == :succeeded
    prompt = Agent.get(agent, & &1)
    assert prompt =~ "## 创作协作共同规则"
    assert prompt =~ "本轮为首稿创作"
    assert prompt =~ "作者原话（逐字保留、可追溯）：把第一章开篇写出来 NONCE42"
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

  test "legacy call without authoring_task keeps nil task and old template" do
    {:ok, agent} = Agent.start_link(fn -> nil end)

    result =
      CreativeToolAdapter.execute(
        tool_request(%{"creative_brief" => "写第一章开篇", "context_text" => "赛博修仙"}),
        :prose_fragment,
        execution(agent),
        Real
      )

    assert result.status == :succeeded
    prompt = Agent.get(agent, & &1)
    assert prompt =~ "若上下文中已给出本章前文，请在其后自然衔接续写"
    refute prompt =~ "## 创作协作共同规则"
  end
end
