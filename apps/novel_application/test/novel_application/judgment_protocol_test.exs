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

    # capability_not_available 在现有协议里属于需纠正后重试；本用例验证第一轮纠错文案：
    # 其它 reason 仍用原泛化文案，不混入合法组合指引。
    assert_receive {:provider_request, _}
    assert_receive {:provider_request, corrected}
    correction = List.last(corrected.messages).content
    assert correction =~ "只纠正不合法结构"
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
    assert correction =~ "占位词"

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
        "alternative_operation_refs" => ["make_magic"]
      })

    assert {:error, {:judgment_protocol_violation, :alternative_operation_not_available}} =
             JudgmentProtocol.request_judgment(
               execution([response("", [invented])]),
               %{},
               input()
             )
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
end
