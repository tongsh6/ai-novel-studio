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

  defp plan_args do
    %{
      "plan" => %{
        "steps" => [
          %{
            "step_id" => "s1",
            "kind" => "act",
            "description" => "写正文",
            "success_criteria" => ["done"],
            "target_tool_ref" => "prose_writing"
          }
        ]
      },
      "author_reasoning" => "先取证再写",
      "reason_codes" => ["planned"],
      "confidence" => 0.9
    }
  end

  defp plan_decision_call do
    call("judgment_decision", %{
      "action" => "plan",
      "dialogue_goal" => "分步执行",
      "reason" => "需要计划"
    })
  end

  defp plan_pair do
    [call("agent_plan_draft", plan_args()), plan_decision_call()]
  end

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

  test "判断 prompt 的合法工具组合规则唯一且明确" do
    prompt = JudgmentProtocol.prompt(input())
    content = prompt.messages |> List.first() |> Map.fetch!(:content)
    guidance = JudgmentToolContract.legal_combination_guidance()

    # 规则只出现一次（单一真源，不允许别处再手写一份）
    assert String.split(content, guidance) |> length() == 2
    assert content =~ "单独返回 agent_plan_draft 是非法响应"

    plan_tool = Enum.find(prompt.tools, &(&1.name == "agent_plan_draft"))
    assert plan_tool.description =~ "必须与 judgment_decision(action=plan) 同一响应同批返回"
    # schema/名称不变
    assert plan_tool.input_schema == NovelApplication.AgentPlanToolContract.schema()
  end

  test "单独 agent_plan_draft：纠错回执携带合法组合指引且一次纠正可修复" do
    bad = response("先给计划。", [call("agent_plan_draft", plan_args())])
    good = response("按计划分步执行。", plan_pair())

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(execution([bad, good]), %{}, input())

    assert judgment.action == "plan"
    assert judgment.provider_call_count == 2

    assert_receive {:provider_request, first}
    assert_receive {:provider_request, second}
    refute_receive {:provider_request, _}

    # 保留原输入/工具集，只追加纠错消息
    assert hd(second.messages).content == hd(first.messages).content
    assert second.tools == first.tools
    assert length(second.messages) == length(first.messages) + 1

    correction = List.last(second.messages).content
    assert correction =~ "invalid_tool_combination"
    assert correction =~ "agent_plan_draft 只能与 judgment_decision(action=plan)"
    assert correction =~ JudgmentToolContract.legal_combination_guidance()
    assert correction =~ "保留同一作者输入、来源、目标、范围与权限"
  end

  test "单独 agent_plan_draft 重试后仍非法 → 终局拒绝且调用计数正确" do
    bad = response("先给计划。", [call("agent_plan_draft", plan_args())])
    still_bad = response("还是只有计划。", [call("agent_plan_draft", plan_args())])

    assert {:error, {:judgment_protocol_violation, :invalid_tool_combination}} =
             JudgmentProtocol.request_judgment(execution([bad, still_bad]), %{}, input())

    assert_receive {:provider_request, _}
    assert_receive {:provider_request, second}
    assert List.last(second.messages).content =~ "invalid_tool_combination"
    refute_receive {:provider_request, _}
  end

  test "合法组合（双工具 plan / 单 judgment_decision plan / 普通回复）不回归" do
    assert {:ok, %{action: "plan", provider_call_count: 1}} =
             JudgmentProtocol.request_judgment(
               execution([response("", plan_pair())]),
               %{},
               input()
             )

    # 单 judgment_decision(action=plan) 仍合法（不带 inline plan）
    assert {:ok, %{action: "plan"}} =
             JudgmentProtocol.request_judgment(
               execution([response("", [plan_decision_call()])]),
               %{},
               input()
             )

    assert {:ok, %{action: "reply"}} =
             JudgmentProtocol.request_judgment(execution([response("普通答复", [])]), %{}, input())

    # 单 judgment_decision execute / 其它单工具仍合法
    assert {:ok, %{action: "execute"}} =
             JudgmentProtocol.request_judgment(
               execution([
                 response("", [
                   call("judgment_decision", %{
                     "action" => "execute",
                     "capability" => "prose_writing",
                     "dialogue_goal" => "写章",
                     "reason" => "作者明确要求"
                   })
                 ])
               ]),
               %{},
               input(capabilities: ["prose_writing"])
             )
  end

  test "其它校验 reason 的纠错文案保持原样（不混入合法组合指引）" do
    first = response("", [call("judgment_decision", %{action: "execute"})])
    second = response("已按原目标继续。", [])

    assert {:ok, %{action: "reply", provider_call_count: 2}} =
             JudgmentProtocol.request_judgment(execution([first, second]), %{}, input())

    # invalid_tool_arguments 走参数 schema 专用纠错（不含合法组合指引）；仍允许一次纠正后继续。
    assert_receive {:provider_request, _}
    assert_receive {:provider_request, corrected}
    correction = List.last(corrected.messages).content
    assert correction =~ "工具参数未通过 schema 校验"
    refute correction =~ JudgmentToolContract.legal_combination_guidance()
  end

  test "M18：current 指代历史资料被机械拒绝，纠错给出来源纠正路径并允许一次修复" do
    registration =
      call("register_author_content", %{
        "author_content_source_ref" => "current",
        "dialogue_goal" => "登记灯油配方",
        "author_reasoning" => "按作者要求登记。"
      })

    bad = response("", [registration])

    good =
      response("请先指出来源。", [
        call("ask_author", %{"question" => "请指出要保存的灯油配方原文来源。", "options" => []})
      ])

    protocol_input =
      input(author_content_sources: ["turn_prev"])
      |> Map.put(:author_text, "把之前那段灯油配方的资料存进设定")

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(execution([bad, good]), %{}, protocol_input)

    assert judgment.action == "await_author"
    assert judgment.provider_call_count == 2

    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, corrected}
    correction = List.last(corrected.messages).content
    assert correction =~ "anaphoric_current_source_requires_explicit_text"
    assert correction =~ "current 只适用于本条消息本身就是被登记原文"
    assert correction =~ "judgment_decision.explore"
    assert correction =~ "ask_author"
    assert correction =~ "不得把历史指令、会话摘要或保存指令当作原文"
  end

  test "M18：纠错后仍把 current 当原文 → 终局拒绝" do
    registration =
      call("register_author_content", %{
        "author_content_source_ref" => "current",
        "dialogue_goal" => "登记灯油配方",
        "author_reasoning" => "按作者要求登记。"
      })

    protocol_input =
      input(author_content_sources: [])
      |> Map.put(:author_text, "把之前那段灯油配方的资料存进设定")

    assert {:error,
            {:author_content_registration_invalid,
             :anaphoric_current_source_requires_explicit_text}} =
             JudgmentProtocol.request_judgment(
               execution([response("", [registration]), response("", [registration])]),
               %{},
               protocol_input
             )
  end

  test "M13：只有推理占位内容视为空回复，纠错后可修复；仍空则诚实拒绝" do
    placeholder = response("[assistant reasoning omitted]", [])
    good = response("已按你刚才说的收下，先留在对话里。", [])

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(execution([placeholder, good]), %{}, input())

    assert judgment.action == "reply"
    assert judgment.narrative == "已按你刚才说的收下，先留在对话里。"
    assert judgment.provider_call_count == 2

    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, corrected}
    correction = List.last(corrected.messages).content
    assert correction =~ "judgment_narrative_required"
    assert correction =~ "必须给出非空 content"
    assert correction =~ "仅标点占位"

    assert {:error, {:judgment_protocol_violation, :judgment_narrative_required}} =
             JudgmentProtocol.request_judgment(
               execution([placeholder, placeholder]),
               %{},
               input()
             )
  end

  test "M13：占位行后附真实文本时去掉占位行，保留可追溯真实内容" do
    text = "[assistant reasoning internal]\n我收到了，这条先留在对话里。"
    result = response(text, [])

    assert {:ok, judgment} = JudgmentProtocol.request_judgment(execution([result]), %{}, input())
    assert judgment.narrative == "我收到了，这条先留在对话里。"
    refute judgment.narrative =~ "assistant reasoning"

    assert :ok =
             AgentNarrativeSource.verify(judgment.narrative, judgment.narrative_source, %{
               "run-call-1" => result.provider_output
             })
  end

  test "M14/M07 判断 prompt 包含能力缺口与已有候选优先规则（capture）" do
    prompt = JudgmentProtocol.prompt(input())
    content = prompt.messages |> List.first() |> Map.fetch!(:content)

    # M14：能力缺口必须 report_capability_gap，ask_author 不能代替
    assert content =~ "能力缺口优先"
    assert content =~ "report_capability_gap 说明缺失效果"
    assert content =~ "不得用 ask_author 问“你要哪一种”来代替缺口报告"
    assert content =~ "ask_author 只用于需要作者裁决方向/对象/范围且材料无法消歧"

    # M07：已有候选优先直接修订，预览为空不构成追问理由
    assert content =~ "已有候选优先"
    assert content =~ "直接选择 revise_pending_artifact"
    assert content =~ "候选正文预览可能为空"
    assert content =~ "不要先 ask_author"

    # 工具描述也编码区分
    ask = Enum.find(prompt.tools, &(&1.name == "ask_author"))
    gap = Enum.find(prompt.tools, &(&1.name == "report_capability_gap"))
    assert ask.description =~ "能力缺口必须用 report_capability_gap"
    assert gap.description =~ "不以 ask_author 代替"
  end

  test "能力缺口的最近可行路径允许引用判断层工具与探索工具（不发明操作）" do
    gap =
      call("report_capability_gap", %{
        "dialogue_goal" => "登记历史原文",
        "missing_effect" => "无法从当前材料找到可逐字登记的原文",
        "author_reasoning" => "请作者贴出原文后再登记。",
        "alternative_operation_refs" => ["register_author_content", "chapter_read"]
      })

    assert {:ok, %{action: "capability_gap", provider_call_count: 1}} =
             JudgmentProtocol.request_judgment(
               execution([response("说明", [gap])]),
               %{},
               input(explore: true, explore_tools: ["chapter_read"])
             )

    invented =
      call("report_capability_gap", %{
        "dialogue_goal" => "缺口",
        "missing_effect" => "缺能力",
        "author_reasoning" => "说明。",
        "alternative_operation_refs" => ["make_magic", "chapter_read"]
      })

    # 无效 refs 被过滤而非拒整条响应；真实可用项保留（M14 r2 不终局）。
    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([response("", [invented])]),
               %{},
               input(explore: true, explore_tools: ["chapter_read"])
             )

    assert judgment.reply_record.model_interpretation[:alternative_operation_refs] == [
             "chapter_read"
           ]
  end

  test "证据纪律规则在判断 prompt 中唯一且明确" do
    prompt = JudgmentProtocol.prompt(input())
    content = prompt.messages |> List.first() |> Map.fetch!(:content)

    assert String.split(content, "## 对象与版本证据纪律（先取证/消歧，再操作）") |> length() == 2
    assert content =~ "只能引用本轮上下文或观察中真实列出的 ref"
    assert content =~ "不得编造 ref"
    assert content =~ "存在多个候选（pending_adoption_count > 1）"
    assert content =~ "不得猜“最新/首条/最近讨论”"
    assert content =~ "修改权威版本"
    assert content =~ "只讨论/比较时不改变 canon"
    assert content =~ "不得把建议包装成系统已定"
    assert content =~ "execute 只填一个目标 ref 字段"

    decision = Enum.find(prompt.tools, &(&1.name == "judgment_decision"))
    assert decision.description =~ "对象/版本操作只引用上下文中真实存在的 ref"

    # task-22 上下文覆盖事实的收束规则（M03）：未覆盖末页不得声称已读全章
    assert content =~ "覆盖事实约束"
    assert content =~ "不得声称已读全章或全章无矛盾"
    assert String.split(content, "覆盖事实约束") |> length() == 2
  end

  test "引用不存在的目标 ref：纠错给出真实 ref/取证指引，修复后可执行" do
    ghost =
      execute_call(%{
        "capability" => "revise_pending_artifact",
        "pending_artifact_ref" => "as_ghost"
      })

    real =
      execute_call(%{
        "capability" => "revise_pending_artifact",
        "pending_artifact_ref" => "as_real"
      })

    opts = [
      capabilities: ["revise_pending_artifact"],
      pending_artifact_targets: %{"as_real" => ["revise_pending_artifact"]}
    ]

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([response("", [ghost]), response("", [real])]),
               %{},
               input(opts)
             )

    assert judgment.action == "execute"
    assert judgment.pending_artifact_ref == "as_real"
    assert judgment.provider_call_count == 2

    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, corrected}
    correction = List.last(corrected.messages).content
    assert correction =~ "target_not_available"
    assert correction =~ "只能引用当前上下文/观察中真实列出的"
    assert correction =~ "session_adoptions"
    assert correction =~ "不得编造 ref"
  end

  test "引用不存在的目标 ref 且纠正后仍不存在 → 终局拒绝" do
    ghost =
      execute_call(%{
        "capability" => "revise_pending_artifact",
        "pending_artifact_ref" => "as_ghost"
      })

    opts = [
      capabilities: ["revise_pending_artifact"],
      pending_artifact_targets: %{"as_real" => ["revise_pending_artifact"]}
    ]

    assert {:error, {:pending_artifact_invalid, :target_not_available}} =
             JudgmentProtocol.request_judgment(
               execution([response("", [ghost]), response("", [ghost])]),
               %{},
               input(opts)
             )
  end

  test "候选 ref 与已采纳 ref 字段混填 → 字段纠错，修复后可执行" do
    mixed =
      execute_call(%{
        "capability" => "revise_pending_artifact",
        "pending_artifact_ref" => "as_real",
        "adopted_content_ref" => "as_real"
      })

    clean =
      execute_call(%{
        "capability" => "revise_pending_artifact",
        "pending_artifact_ref" => "as_real"
      })

    opts = [
      capabilities: ["revise_pending_artifact"],
      pending_artifact_targets: %{"as_real" => ["revise_pending_artifact"]}
    ]

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([response("", [mixed]), response("", [clean])]),
               %{},
               input(opts)
             )

    assert judgment.action == "execute"
    assert judgment.pending_artifact_ref == "as_real"

    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, corrected}
    correction = List.last(corrected.messages).content
    assert correction =~ "target_ref_field_conflict"
    assert correction =~ "不得同时填两个"
  end

  defp execute_call(overrides) do
    call(
      "judgment_decision",
      Map.merge(
        %{"action" => "execute", "dialogue_goal" => "修改候选", "reason" => "按作者要求修改。"},
        overrides
      )
    )
  end

  test "可见收束/收下资料零菜单规则在判断 prompt 中明确" do
    content = JudgmentProtocol.prompt(input()).messages |> List.first() |> Map.fetch!(:content)

    assert content =~ "最终答复收束"
    assert content =~ "不得只写内部推理、计划或过渡语"
    assert content =~ "工具参数不能替代作者可见答复"
    assert content =~ "用 propose_creative_directions 时 content 必须逐条写出每个方向的标题与一句话走向"
    assert content =~ "作者只要求收下资料/只聊不展开时"
    assert content =~ "零方向菜单、零候选/登记"

    # 唯一性：关键规则只出现一次，避免多段复制后含义漂移
    assert String.split(content, "最终答复收束") |> length() == 2
    assert String.split(content, "零方向菜单、零候选/登记") |> length() == 2
  end

  test "M13：其它厂商 reasoning 占位变体也被去除，不泄漏给作者" do
    text =
      "[Assistant reasoning - internal content, not shown to author]\n" <>
        "作者要求先收下资料；这里只确认收到，不展开。"

    result = response(text, [])

    assert {:ok, judgment} = JudgmentProtocol.request_judgment(execution([result]), %{}, input())
    assert judgment.narrative == "作者要求先收下资料；这里只确认收到，不展开。"
    refute judgment.narrative =~ "assistant reasoning"
  end

  test "ask_author 正式通道与能力缺口/排版裁量规则在 prompt 中明确" do
    content = JudgmentProtocol.prompt(input()).messages |> List.first() |> Map.fetch!(:content)

    assert content =~ "必须用 ask_author 工具提出具体问题"
    assert content =~ "不能用普通 reply 里的问句或说明代替 ask_author"
    assert content =~ "不得用 report_capability_gap"
    assert content =~ "作者要求仅排版且存在可修订候选时，应执行 revise_pending_artifact"
    assert String.split(content, "必须用 ask_author 工具提出具体问题") |> length() == 2
  end

  test "task-28 证据/冒充/系统信息/收束规则在判断 prompt 中明确" do
    content = JudgmentProtocol.prompt(input()).messages |> List.first() |> Map.fetch!(:content)

    # M14：禁止用新建同名/演化候选冒充已有主档案修改
    assert content =~ "修改已有对象的主档案/权威字段"
    assert content =~ "不得把"
    assert content =~ "新建同名对象"
    assert content =~ "演化/记忆候选"
    assert content =~ "不能说“新建档案后他就是主角/就实现了修改”"

    # M02：系统已有信息不得向作者索取
    assert content =~ "系统已有的章节索引、章状态、统计、正文/档案材料不得向作者索取"

    # M01：完成/质量判断先读正文与章计划
    assert content =~ "问“某章写完了吗/有无矛盾/质量如何”必须先读正文与章计划"
    assert content =~ "不得仅凭章状态或“已保存/无待采纳候选”断言完成"

    # M03：继续读取不是最终答复
    assert content =~ "继续读取不是最终答复"
    assert content =~ "不得只回“已继续读取/再给结论”"

    # M09：不得用元描述代替方向
    assert content =~ "也不能用“你的请求属于创作方向讨论”这类"

    # 唯一性（关键规则只出现一次）
    assert String.split(content, "系统已有的章节索引、章状态、统计、正文/档案材料不得向作者索取")
           |> length() == 2

    assert String.split(content, "修改已有对象的主档案/权威字段") |> length() == 2
  end

  test "M18：指代历史原文且可探索时先 ask_author 被机械拦截，先 explore 后可通过" do
    ask =
      call("ask_author", %{
        "question" => "请贴出灯油配方原文或指出来源。",
        "options" => []
      })

    explore =
      call("judgment_decision", %{
        "action" => "explore",
        "dialogue_goal" => "查找正文中的灯油配方原文",
        "reason" => "作者指代历史原文，先取证。",
        "explore_request" => %{"tool" => "chapter_read", "query" => "第01章：灯楼夜雨"}
      })

    protocol_input =
      input(explore: true, explore_tools: ["chapter_read", "prose_search"])
      |> Map.put(:author_text, "把之前那段灯油配方的资料存进设定")

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([response("", [ask]), response("", [explore])]),
               %{},
               protocol_input
             )

    assert judgment.action == "explore"
    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, corrected}
    correction = List.last(corrected.messages).content
    assert correction =~ "explore_before_ask_required"
    assert correction =~ "session_adoptions"
    assert correction =~ "不得默认先问作者"
  end

  test "M18：无指代/不可探索/已有观察时 ask_author 仍合法" do
    ask = call("ask_author", %{"question" => "你要改哪一份候选？", "options" => []})

    # 无指代：不强制先探索
    assert {:ok, %{action: "await_author"}} =
             JudgmentProtocol.request_judgment(
               execution([response("", [ask])]),
               %{},
               input(explore: true, explore_tools: ["chapter_read"])
             )

    # 探索不可用：允许直接问
    anaphoric =
      input()
      |> Map.put(:author_text, "把之前那段灯油配方存进设定")

    assert {:ok, %{action: "await_author"}} =
             JudgmentProtocol.request_judgment(execution([response("", [ask])]), %{}, anaphoric)

    # 已有观察（完成过探索）：允许问作者
    observed =
      input(explore: true, explore_tools: ["chapter_read"])
      |> Map.put(:author_text, "把之前那段灯油配方存进设定")
      |> Map.put(:observations, [%{tool: "chapter_read", refs: ["chapter:one"]}])

    assert {:ok, %{action: "await_author"}} =
             JudgmentProtocol.request_judgment(execution([response("", [ask])]), %{}, observed)
  end

  test "M16：action 专属字段互斥在 prompt 中明确，explore 带 capability 被具体纠错后可修复" do
    content = JudgmentProtocol.prompt(input()).messages |> List.first() |> Map.fetch!(:content)

    assert content =~ "judgment_decision 各 action 的专属字段互斥"
    assert content =~ "explore 只带 explore_request"
    assert content =~ "execute 只带 capability 与一个目标 ref"
    assert String.split(content, "judgment_decision 各 action 的专属字段互斥") |> length() == 2

    bad =
      call("judgment_decision", %{
        "action" => "explore",
        "capability" => "work_archive_read",
        "dialogue_goal" => "核对章节事实",
        "reason" => "需要取证。"
      })

    good =
      call("judgment_decision", %{
        "action" => "explore",
        "dialogue_goal" => "核对章节事实",
        "reason" => "需要取证。",
        "explore_request" => %{"tool" => "chapter_read", "query" => "第01章：灯楼夜雨"}
      })

    opts = [explore: true, explore_tools: ["chapter_read"], capabilities: ["work_archive_read"]]

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([response("", [bad]), response("", [good])]),
               %{},
               input(opts)
             )

    assert judgment.action == "explore"

    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, corrected}
    correction = List.last(corrected.messages).content
    assert correction =~ "incompatible_operation_fields"
    assert correction =~ "explore 只填 explore_request"
    assert correction =~ "不得携带 capability"
    assert correction =~ "execute 才填 capability"
  end

  test "M16：execute 带 explore_request 被具体纠错后可修复" do
    bad =
      call("judgment_decision", %{
        "action" => "execute",
        "capability" => "prose_writing",
        "dialogue_goal" => "写章",
        "reason" => "作者要求。",
        "explore_request" => %{"tool" => "chapter_read", "query" => "第01章"}
      })

    good =
      call("judgment_decision", %{
        "action" => "execute",
        "capability" => "prose_writing",
        "dialogue_goal" => "写章",
        "reason" => "作者要求。"
      })

    opts = [capabilities: ["prose_writing"]]

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([response("", [bad]), response("", [good])]),
               %{},
               input(opts)
             )

    assert judgment.action == "execute"
    assert judgment.capability == "prose_writing"

    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, corrected}
    correction = List.last(corrected.messages).content
    assert correction =~ "execute 只填 capability 与一个目标 ref"
    assert correction =~ "explore_request 只用于 explore"
  end

  test "task-28 补充：直接回答/唯一候选直接执行/参数 schema 指引在 prompt 中明确" do
    content = JudgmentProtocol.prompt(input()).messages |> List.first() |> Map.fetch!(:content)

    assert content =~ "统计/章节索引已经足够回答的问题"
    assert content =~ "直接 reply，不要为形式先 explore"
    assert content =~ "待采纳候选唯一且作者明确要修改它时，直接 execute revise_pending_artifact"
    assert content =~ "探索确认对象后必须继续执行修订"
  end

  test "工具参数 schema 错误带具体字段指引，一次纠错后可修复" do
    bad =
      call("report_capability_gap", %{
        "dialogue_goal" => "改已有角色身份",
        "missing_effect" => "无法修改已有角色主档案身份",
        "author_reasoning" => "说明缺口。",
        "capability" => nil
      })

    good =
      call("report_capability_gap", %{
        "dialogue_goal" => "改已有角色身份",
        "missing_effect" => "无法修改已有角色主档案身份",
        "author_reasoning" => "说明缺口。"
      })

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([response("", [bad]), response("", [good])]),
               %{},
               input()
             )

    assert judgment.action == "capability_gap"

    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, corrected}
    correction = List.last(corrected.messages).content
    assert correction =~ "工具参数未通过 schema 校验"
    assert correction =~ "report_capability_gap 只填 dialogue_goal、missing_effect、author_reasoning"
    assert correction =~ "不要添加 action/capability/body"
  end

  test "task-34 prompt：M02 质量边界/M03 占位收束/M06 未答不推进/M16 多意图/M18 探索优先" do
    content = JudgmentProtocol.prompt(input()).messages |> List.first() |> Map.fetch!(:content)

    assert content =~ "统计/索引类问题只回答进度与可核对事实"
    assert content =~ "不得凭统计给质量/完成度结论"
    assert content =~ "禁止用“-”“—”“…”或仅标点/空白的占位内容作为最终答复"
    assert content =~ "上一轮向作者提问后尚未收到作者回答/选择时，不得推进具体候选或版本"
    assert content =~ "不得把未回答当默认选择"
    assert content =~ "多意图请求"
    assert content =~ "先回答版本/事实问题"
    assert content =~ "来源探索优先 prose_search/chapter_read 查正文原文"

    assert String.split(content, "上一轮向作者提问后尚未收到作者回答/选择时，不得推进具体候选或版本")
           |> length() == 2

    assert String.split(content, "统计/索引类问题只回答进度与可核对事实") |> length() == 2
  end

  test "M03：仅 '-'/标点占位内容视为空回复，纠错后可修复；仍空则诚实拒绝" do
    dash = response("-", [])
    good = response("已覆盖 1–12000/34357；未读部分 12001–34357，结论仅限已读部分，下一步继续读取末页。", [])

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(execution([dash, good]), %{}, input())

    assert judgment.narrative =~ "已覆盖"

    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, corrected}
    correction = List.last(corrected.messages).content
    assert correction =~ "judgment_narrative_required"
    assert correction =~ "仅标点占位"

    assert {:error, {:judgment_protocol_violation, :judgment_narrative_required}} =
             JudgmentProtocol.request_judgment(execution([dash, dash]), %{}, input())
  end

  test "M06：ask_author 重试后不得改成 execute 推进候选（未获作者回答）" do
    malformed_ask =
      call("ask_author", %{
        "question" => "要改哪一份候选的第二段？",
        "options" => [],
        "recommended" => "as_m06_a"
      })

    advance =
      execute_call(%{
        "capability" => "revise_pending_artifact",
        "pending_artifact_ref" => "as_m06_a"
      })

    opts = [
      capabilities: ["revise_pending_artifact"],
      pending_artifact_targets: %{"as_m06_a" => ["revise_pending_artifact"]}
    ]

    assert {:error, {:judgment_protocol_violation, :await_author_unanswered}} =
             JudgmentProtocol.request_judgment(
               execution([response("", [malformed_ask]), response("", [advance])]),
               %{},
               input(opts)
             )
  end

  test "M06：ask_author 参数错误重试为合法 ask_author 仍允许（不误伤澄清）" do
    malformed_ask =
      call("ask_author", %{"question" => "要改哪一份候选？", "options" => [], "recommended" => "x"})

    valid_ask = call("ask_author", %{"question" => "要改哪一份候选的第二段？", "options" => []})

    assert {:ok, %{action: "await_author", provider_call_count: 2}} =
             JudgmentProtocol.request_judgment(
               execution([response("", [malformed_ask]), response("", [valid_ask])]),
               %{},
               input()
             )
  end

  test "content 为原始工具调用 XML 标记时视为空响应，纠错后可修复" do
    markup =
      response(
        "<tool_call>\n<function=chapter_read>\n<parameter=query>第02章：井底回声</parameter>\n</function>\n</tool_call>",
        []
      )

    good = response("第 2 章「第02章：井底回声」已写完：COMPLETED，1/1 场，正文 62 字符。", [])

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(execution([markup, good]), %{}, input())

    assert judgment.narrative =~ "已写完"

    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, corrected}
    assert List.last(corrected.messages).content =~ "judgment_narrative_required"

    assert {:error, {:judgment_protocol_violation, :judgment_narrative_required}} =
             JudgmentProtocol.request_judgment(execution([markup, markup]), %{}, input())
  end

  test "task-36：探索不可用时降级为基于已有文本的 reply，不硬终局" do
    explore =
      call("judgment_decision", %{
        "action" => "explore",
        "dialogue_goal" => "继续读末页",
        "reason" => "还需覆盖末页。",
        "explore_request" => %{"tool" => "chapter_read", "query" => "第01章"}
      })

    transitional = "已读到 1–30000/34357；本轮探索预算已用尽，无法继续读取末页。"

    results =
      for _ <- 1..3 do
        response(transitional, [explore])
      end

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(execution(results), %{}, input(explore: false))

    assert judgment.action == "reply"
    assert judgment.degraded_reason == "exploration_budget_exhausted"
    assert judgment.narrative == transitional
    assert judgment.provider_call_count == 3
  end

  test "task-36：伪工具文本反复出现时有界重试（不无限循环）" do
    pseudo =
      response(
        "<tool_call>\n<function=chapter_read>\n<parameter=query>第01章</parameter>\n</function>\n</tool_call>",
        []
      )

    assert {:error, {:judgment_protocol_violation, :judgment_narrative_required}} =
             JudgmentProtocol.request_judgment(execution([pseudo, pseudo, pseudo]), %{}, input())

    # 3 次有界尝试后诚实拒绝（不是 1 次即终局）
    assert_receive {:provider_request, _}
    assert_receive {:provider_request, _}
    assert_receive {:provider_request, _}
    refute_receive {:provider_request, _}
  end

  test "task-36：只聊/分析任务不得物化方向（discussion_only 纠错后可 reply）" do
    directions =
      call("propose_creative_directions", %{
        "candidate_directions" => [%{"title" => "方向一", "pitch" => "走向"}],
        "author_reasoning" => "给出方向。"
      })

    good = response("陈九斤的弧线可以从“数灯/不接纸/不能回头”三个动作往代价走。", [])

    protocol_input =
      input()
      |> Map.put(:author_text, "先别动笔，我们聊聊主角陈九斤的性格弧线该怎么走。")

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([response("", [directions]), good]),
               %{},
               protocol_input
             )

    assert judgment.action == "reply"

    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, corrected}
    assert List.last(corrected.messages).content =~ "discussion_only_violation"
  end

  test "task-36：要求生成方向时 discussion_only 不误伤（仍可 propose）" do
    directions =
      call("propose_creative_directions", %{
        "candidate_directions" => [%{"title" => "方向一", "pitch" => "走向"}],
        "author_reasoning" => "给出方向。"
      })

    protocol_input =
      input()
      |> Map.put(:author_text, "先别动笔，给我两三个接下来可写的方向。")

    assert {:ok, %{action: "creative_directions"}} =
             JudgmentProtocol.request_judgment(
               execution([response("", [directions])]),
               %{},
               protocol_input
             )
  end

  test "task-36 prompt：M02 索引直答/M10 只聊零物化/M03 探索预算/M17 禁止伪工具文本" do
    content = JudgmentProtocol.prompt(input()).messages |> List.first() |> Map.fetch!(:content)

    assert content =~ "只问进度/章数/字数/是否已写/章状态"
    assert content =~ "直接按索引/统计 reply，不要 chapter_read"
    assert content =~ "属于分析任务：不得调用"
    assert content =~ "探索预算已用尽/不可用时不得再请求 explore"
    assert content =~ "工具调用必须使用原生 tool_calls"
    assert String.split(content, "只问进度/章数/字数/是否已写/章状态") |> length() == 2
  end

  test "task-36 收口：分析型已有充分事实时直接 reply；质量判断才允许 explore" do
    content = JudgmentProtocol.prompt(input()).messages |> List.first() |> Map.fetch!(:content)

    assert content =~ "分析/讨论类任务且系统已有充分事实"
    assert content =~ "直接 reply，"
    assert content =~ "不要为形式 explore 正文"
    assert content =~ "只有质量/矛盾/覆盖结论确实需要正文时才 chapter_read/archive_read"
    assert String.split(content, "分析/讨论类任务且系统已有充分事实") |> length() == 2

    analysis_input =
      input()
      |> Map.put(:author_text, "先别动笔，我们聊聊主角陈九斤的性格弧线该怎么走。")

    # 分析任务：直接 reply 合法（不物化、不强制 explore）
    assert {:ok, %{action: "reply"}} =
             JudgmentProtocol.request_judgment(
               execution([
                 response("基于第一章已采纳事实：陈九斤的性格弧线可以从数灯/不接纸/不能回头三个动作谈起。", [])
               ]),
               %{},
               analysis_input
             )

    # 质量/矛盾判断需要正文：explore 仍合法
    quality_input =
      analysis_input
      |> Map.put(:author_text, "第二章正文质量如何？有没有前后矛盾？")
      |> Map.put(:options, explore: true, explore_tools: ["chapter_read"])

    quality_explore =
      call("judgment_decision", %{
        "action" => "explore",
        "dialogue_goal" => "读第二章正文判断质量与矛盾",
        "reason" => "需要正文才能判断质量。",
        "explore_request" => %{"tool" => "chapter_read", "query" => "第02章：井底回声"}
      })

    assert {:ok, %{action: "explore"}} =
             JudgmentProtocol.request_judgment(
               execution([response("", [quality_explore])]),
               %{},
               quality_input
             )
  end

  test "B28 CP1：判断 prompt 明确整章修订绑定与缺 ref 澄清（不退化为 prose_writing）" do
    content = JudgmentProtocol.prompt(input()).messages |> List.first() |> Map.fetch!(:content)

    assert content =~ "整章正文修订绑定"
    assert content =~ "chapter-scoped 修订"
    assert content =~ "该章全部当前 accepted 片段有序覆盖"
    assert content =~ "仅排版=format_only"
    assert content =~ "不得只绑单个 as_* artifact"
    assert content =~ "不得退化成 prose_writing 新创作"
    assert content =~ "缺章 ref 或同名章歧义时"
    assert content =~ "禁止猜同名/跨作品"
    assert String.split(content, "整章正文修订绑定") |> length() == 2
  end

  test "B28 CP1.5：判断 prompt 出现章级目标（ref/title/片段数/coverage/modification_scope）" do
    targets = [
      %{
        chapter_ref: "chapter:c1",
        chapter_title: "第01章：灯楼夜雨",
        seq: 1,
        covered_refs: ["draft:d1", "draft:d2"],
        fragment_count: 2,
        char_count: 218,
        coverage: :complete
      }
    ]

    prompt = JudgmentProtocol.prompt(input(chapter_revision_targets: targets))
    content = prompt.messages |> List.first() |> Map.fetch!(:content)

    assert content =~ "## 可选章级修订目标"
    assert content =~ "chapter:c1"
    assert content =~ "第01章：灯楼夜雨"
    assert content =~ "片段数 2"
    assert content =~ "覆盖 complete"
    assert content =~ "format_only=仅排版"
    assert content =~ "target_segments=指定片段"
    assert content =~ "whole_chapter=整章"
    assert String.split(content, "## 可选章级修订目标") |> length() == 2
  end

  test "B33 §CP1 反例2：只解释章节编号的 reply 不再被词法强制维护能力（正例仍 execute）" do
    author = "这本书的章节编号为什么采用全书连续编号？只解释，不要修改。"
    explanation = "当前采用全书连续编号：跨卷连续累加，避免每卷重置后作者与读者引用歧义。"

    prompt_input =
      input(capabilities: ["maintain_chapter_structure", "plot_outline"])
      |> Map.put(:author_text, author)

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([response(explanation, [])]),
               %{},
               prompt_input
             )

    assert judgment.action == "reply"
    assert judgment.narrative == explanation
    assert judgment.candidate_directions == []
    assert judgment.provider_call_count == 1
    assert judgment.narrative_source.source_type == "provider_output"

    assert_receive {:provider_request, %{messages: messages}}
    refute Enum.any?(messages, &String.contains?(&1.content, "maintenance_capability_required"))
    refute_receive {:provider_request, _}

    # 正例：作者确实要求重编号时仍走既有维护能力与目标检查。
    positive_input = Map.put(prompt_input, :author_text, "把第2卷章节编号理顺，内容不要动")

    assert {:ok, positive} =
             JudgmentProtocol.request_judgment(
               execution([response("", [maintenance_decision()])]),
               %{},
               positive_input
             )

    assert positive.action == "execute"
    assert positive.capability == "maintain_chapter_structure"
    assert positive.provider_call_count == 1
  end

  test "B30 CP1：判断 prompt 含维护能力目录与边界（不生成大纲/不新建章/不改正文）" do
    content =
      JudgmentProtocol.prompt(input(capabilities: ["maintain_chapter_structure"]))
      |> Map.fetch!(:messages)
      |> List.first()
      |> Map.fetch!(:content)

    assert content =~ "maintain_chapter_structure"
    assert content =~ "只维护既有章结构"
    assert content =~ "不生成大纲"
    assert content =~ "章节结构维护"
    assert content =~ "不得回退为 reply/plot_outline/prose_writing"
  end

  defp maintenance_decision do
    call("judgment_decision", %{
      "action" => "execute",
      "capability" => "maintain_chapter_structure",
      "dialogue_goal" => "把第2卷章节编号理顺，内容不要动",
      "reason" => "章节结构维护"
    })
  end

  test "B29 CP1：判断 prompt 含角色索引/修订能力/绑定规则（与 design/evolution 区分）" do
    targets = [
      %{
        character_ref: "character:11111111-1111-1111-1111-111111111111",
        name: "沈砚",
        aliases: ["老沈"],
        narrative_role: "ENSEMBLE_POV",
        summary: "灯楼查账人"
      },
      %{
        character_ref: "character:22222222-2222-2222-2222-222222222222",
        name: "顾青",
        aliases: [],
        narrative_role: "PROTAGONIST",
        summary: "巡夜人"
      }
    ]

    content =
      JudgmentProtocol.prompt(
        input(
          capabilities: ["revise_character_profile", "character_design"],
          character_targets: targets
        )
      )
      |> Map.fetch!(:messages)
      |> List.first()
      |> Map.fetch!(:content)

    assert content =~ "## 角色索引"
    assert content =~ "character:11111111-1111-1111-1111-111111111111"
    assert content =~ "老沈"
    assert content =~ "narrative_role=ENSEMBLE_POV"
    assert content =~ "revise_character_profile"
    assert content =~ "不新建角色、不写正文、不冒充角色演化记忆"
    assert content =~ "灯楼查账人"
    assert content =~ "不得回退 reply/character_evolution/character_design"
    assert content =~ "设计/创建新主角"
  end

  test "B33 §CP1 反例3：讨论角色主角设定的 reply 不再被词法强制修订能力；明确修订仍校验目标" do
    targets = [
      %{
        character_ref: "character:11111111-1111-1111-1111-111111111111",
        name: "陆晨",
        aliases: [],
        narrative_role: "SUPPORTING",
        summary: "现役配角"
      },
      %{
        character_ref: "character:22222222-2222-2222-2222-222222222222",
        name: "顾青",
        aliases: [],
        narrative_role: "PROTAGONIST",
        summary: "当前主角"
      }
    ]

    author = "讨论一下把陆晨指定为主角是否合理，先不要生成候选。"

    prompt_input =
      input(
        capabilities: ["revise_character_profile", "character_evolution", "character_design"],
        character_targets: targets
      )
      |> Map.put(:author_text, author)

    reply = "从现有弧光看，陆晨的动机线还偏薄；是否设为主角取决于后续主线。本轮先不改主档案，也不生成候选。"

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([response(reply, [])]),
               %{},
               prompt_input
             )

    assert judgment.action == "reply"
    assert judgment.narrative == reply
    assert judgment.candidate_directions == []
    assert judgment.provider_call_count == 1

    assert_receive {:provider_request, %{messages: messages}}

    refute Enum.any?(
             messages,
             &String.contains?(&1.content, "character_profile_capability_required")
           )

    refute_receive {:provider_request, _}

    # 明确修订正例仍绑定真实 character_ref（客观身份检查保留）。
    positive_input = Map.put(prompt_input, :author_text, "把陆晨指定为主角")

    assert {:ok, positive} =
             JudgmentProtocol.request_judgment(
               execution([
                 response("", [
                   call("judgment_decision", %{
                     "action" => "execute",
                     "capability" => "revise_character_profile",
                     "character_ref" => "character:11111111-1111-1111-1111-111111111111",
                     "dialogue_goal" => "把陆晨指定为主角",
                     "reason" => "角色主档案修订"
                   })
                 ])
               ]),
               %{},
               positive_input
             )

    assert positive.action == "execute"
    assert positive.capability == "revise_character_profile"
    assert positive.character_ref == "character:11111111-1111-1111-1111-111111111111"
  end

  test "B29 守卫允许无身份变更的跨能力计划，不把主角状态误当叙事身份" do
    author = "先读完第01章正文，再调整章节大纲，最后更新主角当前状态"
    prompt_input = input() |> Map.put(:author_text, author)

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([
                 response("先制定计划，分别核对正文、调整大纲和更新状态。", [
                   call("judgment_decision", %{
                     "action" => "plan",
                     "dialogue_goal" => author,
                     "reason" => "跨能力请求"
                   })
                 ])
               ]),
               %{},
               prompt_input
             )

    assert judgment.action == "plan"
    assert judgment.provider_call_count == 1
    assert_receive {:provider_request, _}
    refute_receive {:provider_request, _}
  end

  test "B29 CP1：同名歧义不猜 → 纠错为 ask_author；设计新主角仍走 character_design" do
    author = "把沈砚指定为主角"

    targets = [
      %{
        character_ref: "character:11111111-1111-1111-1111-111111111111",
        name: "沈砚",
        aliases: ["老沈"],
        narrative_role: "ENSEMBLE_POV",
        summary: "查账人"
      },
      %{
        character_ref: "character:33333333-3333-3333-3333-333333333333",
        name: "沈砚",
        aliases: ["小沈"],
        narrative_role: "MINOR",
        summary: "学徒"
      }
    ]

    prompt_input =
      input(
        capabilities: ["revise_character_profile", "character_design"],
        character_targets: targets
      )
      |> Map.put(:author_text, author)

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([
                 response("", [
                   call("judgment_decision", %{
                     "action" => "execute",
                     "capability" => "revise_character_profile",
                     "character_ref" => nil,
                     "dialogue_goal" => author,
                     "reason" => "绑定"
                   })
                 ]),
                 response("", [
                   call("ask_author", %{
                     "question" => "你指的是哪个沈砚？",
                     "options" => [
                       %{
                         "label" => "老沈（查账人）",
                         "value" => "character:11111111-1111-1111-1111-111111111111"
                       },
                       %{
                         "label" => "小沈（学徒）",
                         "value" => "character:33333333-3333-3333-3333-333333333333"
                       }
                     ]
                   })
                 ])
               ]),
               %{},
               prompt_input
             )

    assert judgment.action == "await_author"
    assert judgment.question == "你指的是哪个沈砚？"

    # 设计新主角：不是已有角色修订意图，仍走 character_design
    design_author = "帮我设计一个新主角"

    design_input =
      input(
        capabilities: ["revise_character_profile", "character_design"],
        character_targets: targets
      )
      |> Map.put(:author_text, design_author)

    assert {:ok, design} =
             JudgmentProtocol.request_judgment(
               execution([
                 response("", [
                   call("judgment_decision", %{
                     "action" => "execute",
                     "capability" => "character_design",
                     "dialogue_goal" => design_author,
                     "reason" => "设计新角色"
                   })
                 ])
               ]),
               %{},
               design_input
             )

    assert design.action == "execute"
    assert design.capability == "character_design"
  end

  test "B33 §CP1：明确写章请求由模型判断；APP 不再用词法改写模型 reply" do
    author = "第02章：旧服务器里的残诀的正文还没写，帮我写出来吧。"
    reply = "第02章还没有正文。我可以按现有章计划直接生成首稿；需要先确认是否沿用当前大纲。"

    prompt_input =
      input(capabilities: ["prose_writing", "character_design", "revise_adopted_content"])
      |> Map.put(:author_text, author)

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([response(reply, [])]),
               %{},
               prompt_input
             )

    assert judgment.action == "reply"
    assert judgment.narrative == reply
    assert judgment.candidate_directions == []
    assert judgment.provider_call_count == 1
    refute Map.has_key?(judgment, :wrong_route)
    refute Map.has_key?(judgment, :wrong_route_correction_attempted)

    assert_receive {:provider_request, %{messages: messages}}
    refute Enum.any?(messages, &String.contains?(&1.content, "action_intent_requires_execute"))
    refute_receive {:provider_request, _}
  end

  test "B33 §CP1：讨论期“不要动笔”仍由 discussion_only 机械守卫兜底" do
    author = "讨论一下第03章结尾该怎么改，先不要动笔。"

    prompt_input =
      input(capabilities: ["revise_adopted_content"]) |> Map.put(:author_text, author)

    violation =
      response("", [
        call("propose_creative_directions", %{
          "candidate_directions" => [
            %{"title" => "雨夜收束", "pitch" => "结尾落在雨夜归途"}
          ],
          "author_reasoning" => "先给方向"
        })
      ])

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([violation, response("讨论结论：结尾的核心矛盾在信任破裂。", [])]),
               %{},
               prompt_input
             )

    assert judgment.action == "reply"
    assert judgment.provider_call_count == 2
    assert judgment.candidate_directions == []

    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, corrected}
    assert List.last(corrected.messages).content =~ "discussion_only_violation"
  end

  test "B33 §CP1 反例1：条件性错别字修订的“无需修改” reply 不被动作意图纠错" do
    author = "帮我修改第3章正文中的错别字；如果没有错别字，就告诉我无需修改。"
    reply = "我核对了第03章当前采纳正文，没有发现错别字；本轮无需修改，也未生成候选。"

    prompt_input =
      input(capabilities: ["revise_adopted_content"])
      |> Map.put(:author_text, author)

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([response(reply, [])]),
               %{},
               prompt_input
             )

    assert judgment.action == "reply"
    assert judgment.narrative == reply
    assert judgment.candidate_directions == []
    assert judgment.provider_call_count == 1
    assert judgment.narrative_source.source_type == "provider_output"

    assert_receive {:provider_request, %{messages: messages}}
    refute Enum.any?(messages, &String.contains?(&1.content, "action_intent_requires_execute"))
    refute_receive {:provider_request, _}
  end

  test "B33 §CP1：明确写章但模型给方向候选时不再触发 APP fallback 澄清" do
    author = "第09章：伪仙直播夜的正文还没写，帮我写出来吧。"

    directions =
      response("", [
        call("propose_creative_directions", %{
          "candidate_directions" => [
            %{"title" => "直播开场", "pitch" => "从公司叙事切入"},
            %{"title" => "断网余波", "pitch" => "先写事故余波"}
          ],
          "author_reasoning" => "先给方向"
        })
      ])

    prompt_input = input(capabilities: ["prose_writing"]) |> Map.put(:author_text, author)

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(execution([directions]), %{}, prompt_input)

    assert judgment.action == "creative_directions"
    assert judgment.provider_call_count == 1
    assert is_nil(judgment.question)
    assert judgment.narrative_source.source_type == "provider_output_tool_narrative"
    refute Map.has_key?(judgment, :wrong_route)
  end

  test "B33 CP2：合法讨论/查询不触发动作纠错" do
    discussion = "老沈适合当主角吗？只讨论，不要改作品设定。"

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([
                 response("可以。先看老沈当前的身份和已有弧光，再讨论他适不适合主角。", [])
               ]),
               %{},
               input() |> Map.put(:author_text, discussion)
             )

    assert judgment.action == "reply"
    assert judgment.provider_call_count == 1

    query = "第二章写完了吗？"

    assert {:ok, query_judgment} =
             JudgmentProtocol.request_judgment(
               execution([response("已按章节索引回答：还没有，当前只有第01章有正文。", [])]),
               %{},
               input() |> Map.put(:author_text, query)
             )

    assert query_judgment.action == "reply"
    assert query_judgment.provider_call_count == 1
  end

  test "B33 CP2：explore 是允许的取证中间动作（不立即纠错）" do
    author = "第02章：旧服务器里的残诀的正文还没写，帮我写出来吧。"

    prompt_input =
      input(capabilities: ["prose_writing"], explore: true, explore_tools: ["chapter_read"])

    prompt_input = Map.put(prompt_input, :author_text, author)

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([
                 response("", [
                   call("judgment_decision", %{
                     "action" => "explore",
                     "dialogue_goal" => author,
                     "reason" => "先读章计划",
                     "explore_request" => %{"tool" => "chapter_read", "query" => "第02章"}
                   })
                 ])
               ]),
               %{},
               prompt_input
             )

    assert judgment.action == "explore"
    assert judgment.provider_call_count == 1
  end

  test "B35 CP3/task-94：首答带候选 payload 字段 → 字段级纠错，二次合法 execute revise_adopted_content 通过" do
    author = "把第03章：黑市调频师的正文第一段改得更紧张，只改这一段，其他段落别动。"

    prompt_input =
      input(
        capabilities: ["prose_writing", "revise_adopted_content"],
        adopted_content_targets: %{"as_chapter_three" => ["revise_adopted_content"]}
      )
      |> Map.put(:author_text, author)

    bad =
      call("judgment_decision", %{
        "action" => "execute",
        "capability" => "revise_adopted_content",
        "dialogue_goal" => author,
        "reason" => "章级修订",
        "target_chapter_ref" => "chapter:real03",
        "modification_scope" => "target_segments"
      })

    good =
      call("judgment_decision", %{
        "action" => "execute",
        "capability" => "revise_adopted_content",
        "adopted_content_ref" => "as_chapter_three",
        "dialogue_goal" => author,
        "reason" => "按作者指定的第一段范围修订"
      })

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([response("", [bad]), response("", [good])]),
               %{},
               prompt_input
             )

    assert judgment.action == "execute"
    assert judgment.capability == "revise_adopted_content"
    assert judgment.adopted_content_ref == "as_chapter_three"

    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, corrected}
    correction = List.last(corrected.messages).content

    assert correction =~ "未允许字段："
    assert correction =~ "target_chapter_ref"
    assert correction =~ "modification_scope"
    assert correction =~ "内容修订的 execute 必须用 adopted_content_ref"
    assert correction =~ "范围（第一段/整章/仅排版）写在 dialogue_goal"
    assert correction =~ "不要在 judgment_decision 里填 target_chapter_ref/modification_scope"
    assert correction =~ ~s("capability":"revise_adopted_content")
    assert correction =~ ~s("adopted_content_ref":"<本轮可选目标里的真实章级/pending ref>")
  end

  test "B33 §CP1：工具参数结构错误仍一次纠错；纠错后普通回复由模型决定" do
    author = "把第03章：黑市调频师的正文第一段改得更紧张，只改这一段，其他段落别动。"

    prompt_input =
      input(
        capabilities: ["prose_writing", "revise_adopted_content"],
        adopted_content_targets: %{"as_chapter_three" => ["revise_adopted_content"]}
      )
      |> Map.put(:author_text, author)

    bad =
      call("judgment_decision", %{
        "action" => "execute",
        "capability" => "revise_adopted_content",
        "dialogue_goal" => author,
        "reason" => "章级修订",
        "target_chapter_ref" => "chapter:real03",
        "modification_scope" => "target_segments"
      })

    reply = "这段我按章级修订来说明：先确认目标段；本轮先不改，等你确认。"

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([response("", [bad]), response(reply, [])]),
               %{},
               prompt_input
             )

    assert judgment.action == "reply"
    assert judgment.narrative == reply
    assert judgment.provider_call_count == 2
    refute Map.has_key?(judgment, :wrong_route_correction_attempted)

    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, corrected}
    correction = List.last(corrected.messages).content
    assert correction =~ "未允许字段："
    assert correction =~ "target_chapter_ref"
    assert correction =~ "modification_scope"
  end

  # ---------------- B33 §CP2：语义责任矩阵（整改后正式回归） ----------------

  defp assert_app_does_not_force_operation(author, reply_text) do
    prompt_input = input() |> Map.put(:author_text, author)

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([response(reply_text, [])]),
               %{},
               prompt_input
             )

    assert judgment.action == "reply"
    assert judgment.narrative == reply_text
    assert judgment.candidate_directions == []
    assert judgment.provider_call_count == 1

    assert_receive {:provider_request, %{messages: messages}}
    refute Enum.any?(messages, &String.contains?(&1.content, "capability_required"))
    refute Enum.any?(messages, &String.contains?(&1.content, "action_intent_requires_execute"))
    refute Map.has_key?(judgment, :wrong_route)
    refute_receive {:provider_request, _}
  end

  test "B33 §CP2 矩阵：条件/否定/讨论/解释类自然输入不再被 APP 词法强制执行" do
    cases = [
      {"帮我看看第3章有没有错别字，没有就回我不需要改。", "第03章当前正文已核对，没有发现错别字，本轮无需修改。"},
      {"如果第03章没有错别字，就告诉我不需要改；有错别字再修正。", "本轮先核对第03章正文：没有错别字，无需修改。"},
      {"讲讲这本书为什么采用全书连续编号，别动结构。", "全书连续编号让跨卷引用保持稳定，并避免每卷重置后的引用歧义。"},
      {"聊聊陆晨当主角合不合适，先别出候选。", "陆晨当前的动机线还偏薄，是否设为主角取决于后续主线安排。"},
      {"先别改第03章的错别字，我们讨论一下有没有必要。", "先不改；是否有必要取决于错别字对阅读的影响。"},
      {"这一章的正文还有哪些不足？只分析。", "从节奏看，中段冲突推进偏慢，但这是分析，不是修改。"}
    ]

    Enum.each(cases, fn {author, reply} -> assert_app_does_not_force_operation(author, reply) end)
  end

  test "B33 §CP2 矩阵：对照正例仍按能力执行（写章/设计角色/修订/重编号）" do
    write_input =
      input(capabilities: ["prose_writing"])
      |> Map.put(:author_text, "第02章正文还没写，帮我写出来吧。")

    assert {:ok, write} =
             JudgmentProtocol.request_judgment(
               execution([
                 response("", [
                   call("judgment_decision", %{
                     "action" => "execute",
                     "capability" => "prose_writing",
                     "dialogue_goal" => "写第02章首稿",
                     "reason" => "按章计划生成首稿"
                   })
                 ])
               ]),
               %{},
               write_input
             )

    assert write.action == "execute"
    assert write.capability == "prose_writing"

    design_input =
      input(capabilities: ["character_design"])
      |> Map.put(:author_text, "帮我设计一个配角。")

    assert {:ok, design} =
             JudgmentProtocol.request_judgment(
               execution([
                 response("", [
                   call("judgment_decision", %{
                     "action" => "execute",
                     "capability" => "character_design",
                     "dialogue_goal" => "设计一个配角",
                     "reason" => "角色候选"
                   })
                 ])
               ]),
               %{},
               design_input
             )

    assert design.action == "execute"
    assert design.capability == "character_design"

    revise_input =
      input(
        capabilities: ["revise_adopted_content"],
        adopted_content_targets: %{"as_chapter_three" => ["revise_adopted_content"]}
      )
      |> Map.put(:author_text, "把第03章第一段改得更紧张，只改这一段。")

    assert {:ok, revise} =
             JudgmentProtocol.request_judgment(
               execution([
                 response("", [
                   call("judgment_decision", %{
                     "action" => "execute",
                     "capability" => "revise_adopted_content",
                     "adopted_content_ref" => "as_chapter_three",
                     "dialogue_goal" => "只改第一段，其余保持原样",
                     "reason" => "局部修订"
                   })
                 ])
               ]),
               %{},
               revise_input
             )

    assert revise.action == "execute"
    assert revise.capability == "revise_adopted_content"
    assert revise.adopted_content_ref == "as_chapter_three"

    renumber_input =
      input(capabilities: ["maintain_chapter_structure"])
      |> Map.put(:author_text, "把第2卷章节编号理顺，内容不要动")

    assert {:ok, renumber} =
             JudgmentProtocol.request_judgment(
               execution([response("", [maintenance_decision()])]),
               %{},
               renumber_input
             )

    assert renumber.action == "execute"
    assert renumber.capability == "maintain_chapter_structure"
  end

  test "B33 §CP2：讨论期违规生成候选仍有界纠错，耗尽则结构化失败（不静默放行）" do
    author = "只聊第03章结尾，不要写。"
    prompt_input = input() |> Map.put(:author_text, author)

    violation =
      response("", [
        call("propose_creative_directions", %{
          "candidate_directions" => [%{"title" => "雨夜收束", "pitch" => "结尾落在雨夜"}],
          "author_reasoning" => "给方向"
        })
      ])

    assert {:error, {:judgment_protocol_violation, :discussion_only_violation}} =
             JudgmentProtocol.request_judgment(
               execution([violation, violation]),
               %{},
               prompt_input
             )
  end

  test "B33 §CP2：reply 的 narrative 仍绑定真实 provider 字节，无 APP 代写澄清" do
    author = "讨论一下把陆晨指定为主角是否合理，先不要生成候选。"
    text = "讨论结论：陆晨当前弧光不足以支撑主角位，需要补动机线。"
    result = response(text, [])

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([result]),
               %{},
               input() |> Map.put(:author_text, author)
             )

    assert judgment.narrative == text

    assert :ok =
             AgentNarrativeSource.verify(text, judgment.narrative_source, %{
               "run-call-1" => result.provider_output
             })

    refute judgment.narrative_source.source_type =~ "application"
  end
end
