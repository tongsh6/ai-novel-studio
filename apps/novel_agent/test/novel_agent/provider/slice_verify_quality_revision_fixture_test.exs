defmodule NovelAgent.Provider.SliceVerifyQualityRevisionFixtureTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Test.Provider.SliceVerify

  @retry_env "SLICE_VERIFY_QUALITY_REVISION_RETRY"
  @body "他猛地侧身。\n他一刀劈下。\n他反手格挡。\n他迈步逼近。\n他咬住暗号ABC123继续逼近。"

  setup do
    old = System.get_env(@retry_env)
    System.delete_env(@retry_env)

    on_exit(fn ->
      if old, do: System.put_env(@retry_env, old), else: System.delete_env(@retry_env)
    end)

    :ok
  end

  test "local quality revision rewrites only the finding sentence range and preserves bytes outside" do
    assert {:ok, result} = complete(quality_prompt())

    assert [%{name: "submit_tentative_artifact"} = call] = result.tool_calls
    assert call.id == "native-submit_tentative_artifact"
    assert [item] = call.arguments["items"]
    assert [first, second, third | _tail] = String.split(@body, "\n")
    assert [first, second, third] == ["他猛地侧身。", "他一刀劈下。", "他反手格挡。"]
    outside = @body |> String.split("\n") |> Enum.drop(3) |> Enum.join("\n")
    assert String.ends_with?(item["body"], "\n" <> outside)
    assert String.contains?(item["body"], "他咬住暗号ABC123继续逼近。")
    refute item["body"] == @body
  end

  test "retry env only injects current quality revision after its own failed validation" do
    System.put_env(@retry_env, "1")

    for _attempt <- 1..2 do
      assert {:ok, invalid} = complete(quality_prompt())
      assert [%{id: "native-submit_tentative_artifact", arguments: %{}}] = invalid.tool_calls
    end

    assert {:ok, valid} = complete(retry_prompt())
    assert [%{id: "native-submit_tentative_artifact"} = call] = valid.tool_calls
    assert is_list(call.arguments["items"])
    assert hd(call.arguments["items"])["body"] != @body
  end

  test "retry env ignores a failed validation from an earlier operation scope" do
    System.put_env(@retry_env, "1")

    assert {:ok, invalid} = complete(quality_prompt_with_earlier_failure())
    assert [%{arguments: %{}}] = invalid.tool_calls
  end

  test "retry env does not alter source writer or other operations" do
    System.put_env(@retry_env, "1")

    assert {:ok, source} = complete(source_writer_prompt())
    assert [%{name: "submit_tentative_artifact"} = call] = source.tool_calls
    assert is_list(call.arguments["items"])
    assert hd(call.arguments["items"])["body"] =~ "他猛地侧身。"
  end

  defp complete(prompt) do
    SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})
  end

  defp quality_prompt(history \\ []) do
    prompt(quality_scope(), history)
  end

  defp retry_prompt do
    quality_prompt(retry_history())
  end

  defp retry_history do
    failed =
      NovelTest.TestRequestIR.validation(
        "native-submit_tentative_artifact",
        "failed",
        "invalid_items"
      )

    call =
      NovelTest.TestRequestIR.assistant("", [
        NovelTest.TestRequestIR.tool_call(
          "submit_tentative_artifact",
          %{},
          "native-submit_tentative_artifact"
        )
      ])

    [call, failed]
  end

  defp quality_prompt_with_earlier_failure do
    earlier = prompt(source_writer_scope())
    [system, base, _earlier_scope] = earlier.messages
    [call, failed] = retry_history()

    %{
      earlier
      | messages:
          [system, base] ++
            [scope_message(source_writer_scope()), call, failed, scope_message(quality_scope())]
    }
  end

  defp scope_message(scope), do: NovelTest.TestRequestIR.scope(scope)

  defp source_writer_prompt do
    source_writer_scope() |> prompt()
  end

  defp source_writer_scope do
    %{
      operation: %{
        capability: "prose_writing",
        artifact_type: "prose_fragment",
        creative_brief: "写第02章：矿区追击战正文草稿，短促动作追击",
        context_text: "## 目标章结构\n- 计划摘要：主角在废弃矿区遭遇巡检傀儡，短促的动作追击中且战且退。"
      }
    }
  end

  defp quality_scope do
    %{
      operation: %{
        capability: "prose_writing",
        artifact_type: "prose_fragment",
        creative_brief: "请基于下文给出的原正文进行局部修订：保留原有情节走向、人物状态与作品设定，只修改证据位置命中的句段。",
        context_text: "原正文（第02章：矿区追击战正文草稿，短促动作追击）：\n" <> @body,
        revision: """
        [质量修订要求]
        本次修订范围：局部修订。
        只修改证据位置命中的句段，命中范围外的文字应尽量逐字保持不变。
        请仅针对以下质量问题修改上文「原正文」，逐项回应，不得改变情节走向或新增作品事实：
        1. 连续动作句使用相同句首和标点骨架，且没有形成强度或后果递进。
           位置：第 1–3 句
           原句：他猛地侧身。他一刀劈下。他反手格挡。
           判断理由：这些句子都只陈述一个动作；重复没有承担排比、仪式感或情绪升级功能。
           修订策略：只改命中句段，让动作在风险、后果或视角上形成递进。
        修订后保持与原正文相同的情节与人物状态，只解决上述问题；仍返回完整正文供作者对比。

        """
      }
    }
  end

  defp prompt(scope, history \\ []) do
    NovelTest.TestRequestIR.ir(
      [
        NovelTest.TestRequestIR.system("identity_ref: identity:authoring/v1"),
        NovelTest.TestRequestIR.base("【应用数据 · application_base · 非作者原话】\n输出契约。"),
        NovelTest.TestRequestIR.scope(scope)
      ] ++ history,
      tools: [
        NovelTest.TestRequestIR.tool("submit_tentative_artifact", %{
          type: "object",
          properties: %{items: %{type: "array"}}
        })
      ],
      projection: %{tool_choice: "submit_tentative_artifact"}
    )
  end
end
