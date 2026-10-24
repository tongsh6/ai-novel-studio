defmodule NovelApplication.JudgmentProtocolTest do
  use ExUnit.Case, async: true
  alias NovelAgent.Provider.Execution
  alias NovelAgent.Test.Provider.SliceVerify
  alias NovelApplication.{AgentNarrativeSource, JudgmentProtocol, JudgmentToolContract}
  alias NovelCommon.Contracts.ProviderOutput

  defp response(text, calls, ref \\ "call-1") do
    %{
      content: text,
      tool_calls: calls,
      provider_output: %ProviderOutput{
        provider_run_ref: "run-#{ref}",
        provider_call_ref: ref,
        status: :ok,
        content: %{text: text, tool_calls: calls}
      }
    }
  end

  defp call(name, args), do: %{id: "tool-#{name}", name: name, arguments: args}

  defp input(opts \\ []),
    do: %{
      author_text: "根据本章实际内容判断",
      context_block: "章计划/读取范围",
      source_input_ref: "author-turn",
      supplied_context_refs: ["chapter:one"],
      options: opts
    }

  defp execution(results) do
    parent = self()
    ref = make_ref()
    Process.put(ref, results)

    %Execution{
      result_fn: fn prompt ->
        send(parent, {:provider_request, prompt})
        [result | rest] = Process.get(ref)
        Process.put(ref, if(rest == [], do: [result], else: rest))

        case result do
          {:error, _} = error -> error
          _ -> {:ok, result}
        end
      end
    }
  end

  test "普通文本完整保留，一次 auto；未提供模型判断保持未知" do
    text = "  本章尚未兑现开篇承诺。\n\n可以继续讨论结尾。\n"
    result = response(text, [])
    assert {:ok, judgment} = JudgmentProtocol.request_judgment(execution([result]), %{}, input())
    assert judgment.action == "reply"
    assert judgment.provider_call_count == 1
    assert judgment.narrative == text
    assert judgment.candidate_directions == []
    assert judgment.model_interpretation_status == "not_provided"
    assert judgment.reply_record.model_interpretation == nil
    assert judgment.reply_record.supplied_context_refs == ["chapter:one"]

    assert :ok =
             AgentNarrativeSource.verify(text, judgment.narrative_source, %{
               "run-call-1" => result.provider_output
             })

    assert_receive {:provider_request, %{tool_choice: "auto"}}
    refute_receive {:provider_request, _}
  end

  test "固定 profile 的 schema 不随动态来源/对象/权限变化" do
    first = JudgmentProtocol.prompt(input(capabilities: ["prose_writing"], explore: true))
    second = JudgmentProtocol.prompt(input(capabilities: [], author_content_sources: ["other"]))
    assert first.tools == second.tools
    assert first.tool_choice == "auto"
    refute first.messages == second.messages
  end

  test "提问有选项或空选项均合法，question 原话可回退" do
    for options <- [[], [%{"value" => "one", "label" => " 第一章 "}]] do
      question = "  要采用哪种结尾？\n"
      result = response("", [call("ask_author", %{"question" => question, "options" => options})])

      assert {:ok, judgment} =
               JudgmentProtocol.request_judgment(execution([result]), %{}, input())

      assert judgment.action == "await_author"
      assert judgment.question == question
      assert judgment.options == options
      assert judgment.narrative == question

      assert :ok =
               AgentNarrativeSource.verify(question, judgment.narrative_source, %{
                 "run-call-1" => result.provider_output
               })
    end
  end

  test "重复/带首尾空白的 option value 失败，不补虚构选项" do
    for values <- [["one", "one"], [" one"]] do
      options = Enum.map(values, &%{value: &1, label: "方向"})
      bad = response("说明", [call("ask_author", %{question: "选哪一个？", options: options})])

      assert {:error, {:judgment_protocol_violation, :question_option_values_invalid}} =
               JudgmentProtocol.request_judgment(execution([bad]), %{}, input())
    end
  end

  test "合法工具也不能混返或重复；旧 reply/await_author 字段与 native 探索拒绝" do
    ask = call("ask_author", %{question: "选择？", options: []})

    reg =
      call("register_author_content", %{
        author_content_source_ref: "current",
        dialogue_goal: "登记",
        author_reasoning: "生成候选"
      })

    for calls <- [
          [ask, reg],
          [ask, ask],
          [call("chapter_read", %{query: "one"})],
          [call("judgment_decision", %{action: "reply", reason: "回复", dialogue_goal: "问答"})],
          [
            call("judgment_decision", %{action: "await_author", reason: "提问", dialogue_goal: "判断"})
          ],
          [call("ask_author", %{question: "选择？", options: [], record_only: true})]
        ] do
      assert {:error, _} =
               JudgmentProtocol.request_judgment(execution([response("说明", calls)]), %{}, input())
    end
  end

  test "原文登记使用明确来源；不再要求旧 reply/capability_gap 联合字段" do
    args = %{
      author_content_source_ref: "previous",
      dialogue_goal: "登记资料",
      author_reasoning: "按原文生成候选。"
    }

    result = response("", [call("register_author_content", args)])

    assert {:ok, %{action: "author_content_registration", author_content_source_ref: "previous"}} =
             JudgmentProtocol.request_judgment(
               execution([result]),
               %{},
               input(author_content_sources: ["previous"])
             )

    assert {:error, {:author_content_registration_invalid, :source_not_available}} =
             JudgmentProtocol.request_judgment(execution([result]), %{}, input())

    bad = response("说明", [call("register_author_content", Map.put(args, :body, "替代正文"))])

    assert {:error, {:judgment_protocol_violation, :invalid_tool_arguments}} =
             JudgmentProtocol.request_judgment(execution([bad]), %{}, input())
  end

  test "方向与缺口有明确工具来源，不从正文提取" do
    args = %{
      candidate_directions: [%{title: " 逆转 ", pitch: "保留代价\n", tone_tags: []}],
      author_reasoning: "两个取舍中的一种。"
    }

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([response("", [call("propose_creative_directions", args)])]),
               %{},
               input()
             )

    assert judgment.action == "creative_directions"
    assert judgment.candidate_directions == args.candidate_directions

    gap =
      call("report_capability_gap", %{
        dialogue_goal: "修改角色身份",
        missing_effect: "主档案字段修改",
        author_reasoning: "当前只能记录演化记忆。"
      })

    assert {:ok, %{action: "capability_gap"}} =
             JudgmentProtocol.request_judgment(execution([response("", [gap])]), %{}, input())
  end

  test "能力、已有候选与探索目录按本次事实校验" do
    args = %{
      action: "execute",
      capability: "revise_pending_artifact",
      pending_artifact_ref: "foreign",
      dialogue_goal: "修订",
      reason: "保留原稿。"
    }

    result = response("说明", [call("judgment_decision", args)])

    opts = [
      capabilities: ["revise_pending_artifact"],
      pending_artifact_targets: %{"actual" => ["revise_pending_artifact"]}
    ]

    assert {:error, {:pending_artifact_invalid, :target_not_available}} =
             JudgmentProtocol.request_judgment(execution([result]), %{}, input(opts))

    explore =
      call("judgment_decision", %{
        action: "explore",
        dialogue_goal: "读章",
        reason: "核对全文。",
        explore_request: %{tool: "chapter_read", query: "chapter:one"}
      })

    assert {:ok, %{action: "explore"}} =
             JudgmentProtocol.request_judgment(
               execution([response("", [explore])]),
               %{},
               input(explore: true, explore_tools: ["chapter_read"])
             )

    assert {:error, {:judgment_protocol_violation, :exploration_not_available}} =
             JudgmentProtocol.request_judgment(execution([response("", [explore])]), %{}, input())
  end

  test "纠错仅一次，最终叙事只绑定纠正响应，实际计数为二" do
    bad = response("错误说明", [call("judgment_decision", %{action: "reply"})], "bad")
    good = response("纠正后的答复", [], "good")

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(execution([bad, good]), %{}, input())

    assert judgment.provider_call_count == 2
    assert judgment.narrative == "纠正后的答复"
    assert judgment.narrative_source.provider_call_ref == "good"
    assert_receive {:provider_request, _}
    assert_receive {:provider_request, _}
    refute_receive {:provider_request, _}
  end

  test "续行仅接受 continue/ask_author/缺口，不接受普通文本或旧停等枚举" do
    continuation_input = %{
      goal_text: "写本章",
      deviation_summary: "尚缺结尾",
      observation_block: "已有前半章"
    }

    good =
      response("按已指出的缺口补写。", [
        call("continuation_decision", %{action: "continue", guidance: "补足结尾", reason: "已有明确修正依据。"})
      ])

    assert {:ok, %{action: "continue", provider_call_count: 1}} =
             JudgmentProtocol.request_continuation(execution([good]), %{}, continuation_input)

    assert {:error, _} =
             JudgmentProtocol.request_continuation(
               execution([response("继续", [])]),
               %{},
               continuation_input
             )
  end

  test "页面替身方向字段不因 atom/string 转换丢失，显式只聊不生成方向" do
    direction_prompt = "创作判断器\n## 作者输入\n给我两个小说创作方向。\n## 决策与输出契约\n"

    {:ok, directions} =
      SliceVerify.complete(nil, nil, direction_prompt, %{})

    assert [%{"name" => "propose_creative_directions", "arguments" => args}] =
             directions.tool_calls

    assert Enum.all?(
             args.candidate_directions,
             &(is_binary(&1["title"]) and is_binary(&1["pitch"]))
           )

    assert :ok = JudgmentToolContract.validate(directions.tool_calls, :judgment)

    plain_prompt = "创作判断器\n## 作者输入\n只聊节奏，不生成草稿。\n## 决策与输出契约\n"
    {:ok, plain} = SliceVerify.complete(nil, nil, plain_prompt, %{})
    assert plain.tool_calls == []
    assert is_binary(plain.content) and plain.content != ""
  end

  test "页面替身只按被引用的资料判断已采纳，其他来源的状态不能串入" do
    source = %{turn_ref: "history-source", text: "先只记录这份资料：旧书铺"}
    unrelated = %{source_ref: "author_input:another-source", status: "ACCEPTED"}

    for {pending, expected} <- [
          {[], "生成待采纳候选"},
          {[%{source_ref: "author_input:history-source", status: "TENTATIVE"}], "尚未采纳"}
        ] do
      facts = %{
        author_inputs: [source],
        pending_adoptions: pending,
        resolved_adoptions: [unrelated]
      }

      prompt = "创作判断器\n#{Jason.encode!(facts)}\n## 作者输入\n把上一条资料原文保存为作品设定。\n## 决策与输出契约\n"
      {:ok, result} = SliceVerify.complete(nil, nil, prompt, %{})
      assert result.content =~ expected
      refute result.content =~ "已经采纳入档"
    end
  end

  test "续行替身消费当前回复与真实失败事实，分别提问、重试和报告缺口" do
    for {goal, tool, phrase} <- [
          {"写下一章正文", "ask_author", "还没有可采纳的正文草稿"},
          {"  先按原目标重试一次。  ", "continuation_decision", "保持原范围再执行一次"},
          {"写下一章正文，然后同步到发布平台", "report_capability_gap", "没有同步到发布平台的能力"}
        ] do
      prompt = %{
        messages: [
          %{
            role: "user",
            content:
              "## 当前目标\n#{goal}\n## 偏离事实\n工具 prose_writing 执行失败\n## 决策与输出契约\ncontinuation_decision"
          }
        ],
        tools: JudgmentToolContract.tools(:continuation),
        tool_choice: "auto"
      }

      {:ok, result} = SliceVerify.complete(nil, nil, prompt, %{})
      assert [%{name: ^tool}] = result.tool_calls
      assert result.content =~ phrase
      assert :ok = JudgmentToolContract.validate(result.tool_calls, :continuation)
    end
  end

  test "传输重试保留原请求，和结构纠正共享一次额度" do
    assert {:ok, %{provider_call_count: 2}} =
             JudgmentProtocol.request_judgment(
               execution([{:error, %{type: :timeout}}, response("已恢复。", [])]),
               %{},
               input()
             )

    assert_received {:provider_request, first}
    assert_received {:provider_request, second}
    assert first == second

    invalid = response("错误动作", [call("not_registered", %{})])

    assert {:error, %{type: :timeout}} =
             JudgmentProtocol.request_judgment(
               execution([invalid, {:error, %{type: :timeout}}]),
               %{},
               input()
             )

    assert_received {:provider_request, original}
    assert_received {:provider_request, corrected}
    assert length(corrected.messages) == length(original.messages) + 1
    refute_receive {:provider_request, _}
  end
end
