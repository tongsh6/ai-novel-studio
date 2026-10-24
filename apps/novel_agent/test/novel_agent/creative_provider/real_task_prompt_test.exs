defmodule NovelAgent.CreativeProvider.RealTaskPromptTest do
  use ExUnit.Case, async: true

  alias NovelAgent.CreativeProvider.Real
  alias NovelAgent.Provider.Execution
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.AuthoringTask
  alias NovelCommon.Contracts.CreativeRequest

  @good_json Jason.encode!([
               %{item_id: "i1", title: "开篇", body: "夜色压在账单上。", rationale: nil}
             ])

  defp execution(agent) do
    %Execution{
      result_fn: fn prompt ->
        Agent.update(agent, fn _ -> prompt end)
        {:ok, %{content: @good_json}}
      end
    }
  end

  defp base_task(kind, attrs) do
    task = %AuthoringTask{
      kind: kind,
      author_goal: "写第 01 章开篇",
      author_words: "把第一章开篇写出来 NONCE42",
      scope: %{refs: ["chapter:one"], coverage: :chapter},
      materials: [
        %{
          kind: :target_structure,
          ref: "target_structure:chapter:one",
          complete?: false,
          omission_note: "仅目标章与前后邻章结构窗口"
        }
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

    struct!(task, attrs)
  end

  defp revision_task do
    base_task(:revision,
      operation_effect: :revise_candidate,
      scope: %{refs: ["as_1"], coverage: :single, base_ref: "as_1", base_hash: "abc123"},
      preserve: ["未要求修改的内容逐字保留"],
      author_goal: "按质量发现修订正文候选"
    )
  end

  defp request(task) do
    %CreativeRequest{
      request_id: "req-task",
      tool_name: "prose_writing",
      artifact_type: "prose_fragment",
      creative_brief: "用户创作简述占位",
      context_text: "上下文占位",
      source_turn_ref: "turn-1",
      task: task,
      provider_hints: %{}
    }
  end

  defp captured_prompt(task) do
    {:ok, agent} = Agent.start_link(fn -> nil end)
    result = Real.generate(request(task), execution(agent))
    assert result.status == :ok
    Agent.get(agent, & &1)
  end

  test "task-aware writer prompt renders shared semantics exactly once as L1" do
    kind_cases = [
      {:first_draft, "本轮为首稿创作"},
      {:continuation, "本轮为续写"},
      {:rewrite, "本轮为重写/覆盖"}
    ]

    for {kind, operation_marker} <- kind_cases do
      attrs =
        if kind == :rewrite do
          %{
            scope: %{refs: ["chapter:one"], coverage: :chapter, base_ref: "chapter:one"},
            preserve: ["未覆盖范围的正文与既有作品事实保持不变"]
          }
        else
          %{}
        end

      task = base_task(kind, attrs)
      prompt = captured_prompt(task)

      assert String.split(prompt, AuthoringSemantics.static_block(task)) |> length() == 2
      assert prompt =~ "## 创作协作共同规则"
      assert String.split(prompt, "## 创作协作共同规则") |> length() == 2
      assert prompt =~ operation_marker
      assert prompt =~ "## 本轮作者目标"
      assert prompt =~ "作者原话（逐字保留、可追溯）：把第一章开篇写出来 NONCE42"
      assert prompt =~ "本轮目标（应用据作者输入与已验证上下文归纳，来源可追溯）：写第 01 章开篇"
      assert prompt =~ "## 材料与覆盖"
      assert prompt =~ "target_structure"
      assert prompt =~ "不完整"
      assert prompt =~ "仅目标章与前后邻章结构窗口"

      # I3 规则只从单一 helper 渲染一次
      assert String.split(prompt, "随机标识符串") |> length() == 2

      # 输出契约与运行时校验同源：self_report/companions 为可选/允许，不写更严的"必须"
      assert prompt =~ "self_report"
      assert prompt =~ "companion_artifacts"
    end
  end

  test "rewrite task prompt has no fixed continuation instruction (X1 closed)" do
    task =
      base_task(:rewrite,
        scope: %{refs: ["chapter:one"], coverage: :chapter, base_ref: "chapter:one"},
        preserve: ["未覆盖范围的正文与既有作品事实保持不变"]
      )

    prompt = captured_prompt(task)

    refute prompt =~ "请在其后自然衔接续写"
    assert prompt =~ "## 对象与范围"
    assert prompt =~ "基线对象：chapter:one"
    assert prompt =~ "## 必须保留"
    assert prompt =~ "未覆盖范围的正文与既有作品事实保持不变"
  end

  test "revision task prompt uses revision operation only" do
    prompt = captured_prompt(revision_task())

    assert prompt =~ "本轮为修订"
    refute prompt =~ "本轮为续写"
    refute prompt =~ "请在其后自然衔接续写"
    assert prompt =~ "基线对象：as_1"
    assert prompt =~ "## 必须保留"
    assert prompt =~ "未要求修改的内容逐字保留"
  end

  test "call without task fails instead of using legacy template" do
    {:ok, agent} = Agent.start_link(fn -> nil end)

    request = %CreativeRequest{
      request_id: "req-legacy",
      tool_name: "prose_writing",
      artifact_type: "prose_fragment",
      creative_brief: "写第一章开篇",
      context_text: "赛博修仙",
      source_turn_ref: "turn-1",
      provider_hints: %{}
    }

    result = Real.generate(request, execution(agent))
    assert result.status == :error
    assert [%{code: "authoring_task_required"}] = result.errors
    assert Agent.get(agent, & &1) == nil
  end

  test "correction prompt re-renders the same output contract instead of relaxing it" do
    task = revision_task()
    request = request(task)

    {:ok, agent} = Agent.start_link(fn -> [] end)

    result_fn = fn prompt ->
      calls = Agent.get_and_update(agent, &{&1, &1 ++ [prompt]})

      if calls == [] do
        {:ok, %{content: ~s([{"item_id": "i1", "title": "x", "body": "b",}])}}
      else
        {:ok, %{content: @good_json}}
      end
    end

    execution = %Execution{result_fn: result_fn}
    assert Real.generate(request, execution).status == :ok

    [_original, correction] = Agent.get(agent, & &1)
    assert correction =~ "不是合法 JSON"
    assert correction =~ "结构必须与首次请求完全一致"
    refute correction =~ "或一个包含 \"items\" 数组的 JSON 对象"
    assert correction =~ "伴生产物：允许"
  end
end
