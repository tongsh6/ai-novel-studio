defmodule NovelAgent.Provider.SliceVerifyWriterFaultScopeTest do
  # 故障开关是进程外的环境变量；本组必须等异步测试结束后串行执行并恢复原值。
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Test.Provider.SliceVerify
  alias NovelTest.TestRequestIR

  @timeout_env "SLICE_VERIFY_WRITER_TIMEOUT"
  @scoped_author "缩小范围重试：先只写当前章的第一个场景，500 字以内；写完就停。"
  @current_ref "turn:current-author-goal"
  @prose_scope %{
    authoring_task: %{author_goal: %{source_input_ref: @current_ref}},
    operation: %{
      capability: "prose_writing",
      artifact_type: "prose_fragment",
      creative_brief: "生成正文",
      context_text: "已有计划"
    }
  }

  setup do
    previous = System.get_env(@timeout_env)
    System.put_env(@timeout_env, "1")

    on_exit(fn ->
      if previous,
        do: System.put_env(@timeout_env, previous),
        else: System.delete_env(@timeout_env)
    end)

    :ok
  end

  test "恢复读取当前任务真实作者来源，派生简报没有复述缩小范围也能恢复" do
    assert {:error, %{type: :timeout}} =
             complete(native_prompt("submit_tentative_artifact", @prose_scope))

    current = TestRequestIR.author(@scoped_author, @current_ref)

    assert {:ok, _result} =
             complete(native_prompt("submit_tentative_artifact", @prose_scope, [], [current]))
  end

  test "历史正文不得让续行或质量工具误超时" do
    for {tool, scope} <- [
          {"continuation_decision", %{operation: %{summary: "你的两种续行方式：继续或等待作者。"}}},
          {"report_quality_findings", %{operation: %{prose_text: "夜色落在城门上。"}}}
        ] do
      assert {:ok, _result} = complete(native_prompt(tool, scope, [@prose_scope]))
    end
  end

  test "后续角色创作只按最新 scope 判定，不受历史正文或正文内容字段污染" do
    current = %{
      operation: %{
        capability: "character_design",
        artifact_type: "character_seed",
        creative_brief: "设计一个配角",
        context_text: "既有正文记录 artifact_type：prose_fragment，只是背景。"
      }
    }

    assert {:ok, _result} =
             complete(native_prompt("submit_tentative_artifact", current, [@prose_scope]))
  end

  test "历史作者原话或派生简报不得冒充本次缩小范围授权" do
    old_retry =
      put_in(@prose_scope, [:authoring_task, :author_goal, :source_input_ref], "turn:old")

    old_author = TestRequestIR.author(@scoped_author, "turn:old")
    current = TestRequestIR.author("请写整章正文。", @current_ref)
    derived = put_in(@prose_scope, [:operation, :creative_brief], @scoped_author)

    for scope <- [@prose_scope, derived, Map.delete(derived, :authoring_task)] do
      assert {:error, %{type: :timeout}} =
               complete(
                 native_prompt("submit_tentative_artifact", scope, [old_retry], [
                   old_author,
                   current
                 ])
               )
    end
  end

  test "禁用工具或没有活动工具的 canonical 请求不走 legacy 故障判断" do
    prompt = native_prompt("submit_tentative_artifact", @prose_scope)
    assert {:ok, _result} = complete(%{prompt | projection: %{tool_choice: "none"}})
    assert {:ok, _result} = complete(%{prompt | tools: [], projection: %{tool_choice: nil}})
  end

  defp native_prompt(tool, scope, history \\ [], authors \\ []) do
    messages = authors ++ Enum.map(history ++ [scope], &TestRequestIR.scope/1)

    NovelTest.TestRequestIR.ir(
      messages,
      tools: [NovelTest.TestRequestIR.tool(tool)],
      projection: %{tool_choice: tool}
    )
  end

  defp complete(prompt), do: SliceVerify.complete(nil, nil, prompt, %InferenceParams{})
end
