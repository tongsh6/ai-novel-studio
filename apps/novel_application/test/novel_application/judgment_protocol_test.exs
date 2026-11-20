defmodule NovelApplication.JudgmentProtocolTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.Stub
  alias NovelAgent.Test.Provider.SliceVerify
  alias NovelCommon.RequestIR
  alias NovelDomain.AgentRun

  alias NovelApplication.{
    AgentNarrativeSource,
    AuthoringTranscript,
    DialoguePlanningService,
    JudgmentProtocol,
    JudgmentToolContract
  }

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

  defp input(opts \\ []) do
    {:ok, run} =
      AgentRun.new(%{
        run_id: "run-judgment-fixture",
        work_id: "work-judgment-fixture",
        workspace_id: "workspace-judgment-fixture",
        session_id: "session-judgment-fixture",
        parent_turn_ref: "author-turn",
        origin_frame_ref: "frame-judgment-fixture",
        profile_ref: "judgment_plan_v1",
        goal: %{text: "根据本章实际内容判断", version: 1},
        authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]}
      })

    %{
      author_text: "根据本章实际内容判断",
      scope: %{
        work_id: run.work_id,
        facts: %{
          work: %{ref: "work:#{run.work_id}", work_id: run.work_id, title: "协议测试作品"}
        },
        context: %{},
        coverage: %{}
      },
      source_input_ref: "author-turn",
      supplied_context_refs: ["work:#{run.work_id}"],
      options: Keyword.put_new(opts, :plan_run, run)
    }
  end

  defp plan_decision_call do
    call("judgment_decision", %{
      "action" => "plan",
      "dialogue_goal" => "分步执行",
      "author_reasoning" => "需要计划"
    })
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

  defp assistant_messages(%{messages: messages}),
    do: Enum.filter(messages, &(Map.get(&1, :role) == "assistant"))

  defp blocks(%{messages: messages}, type) do
    for message <- messages,
        block <- message.blocks,
        Map.get(block, :type) == type,
        do: block
  end

  defp tool_call_blocks(transcript), do: blocks(transcript, "tool_call")
  defp validation_blocks(transcript), do: blocks(transcript, "validation_result")

  defp response_with_execution_refs(text, calls, call_ref, run_ref) do
    response(text, calls, call_ref)
    |> Map.put(:provider_call_ref, call_ref)
    |> Map.put(:provider_run_ref, run_ref)
  end

  test "非法多调用纠错逐一关闭本次调用，不遗留 pending 或覆盖历史结果" do
    bad = response("错误组合", [plan_decision_call(), call("unknown_operation", %{})])
    good = response("只讨论创作目标。", [])

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(execution([bad, good]), %{}, input())

    assert judgment.narrative == "只讨论创作目标。"
    assert {:ok, ir} = AuthoringTranscript.to_request_ir(judgment.transcript)
    assert {:ok, []} = RequestIR.pending_call_ids(ir)

    validations =
      for message <- ir.messages,
          block <- message.blocks,
          block.type == "validation_result",
          do: block

    assert length(validations) == 2
    assert Enum.all?(validations, &(&1.status == "failed"))
  end

  test "立项修订工具显式 field/value 提案进入 judgment.profile_revision" do
    revision_call =
      call("propose_work_profile_revision", %{
        "title" => "主线目标",
        "body" => "让沈砚从被动卷入转向主动查账。",
        "field" => "main_goal",
        "value" => "在巡检收网前拿到暗抽主账。",
        "author_reasoning" => "作者要求把主线目标定得更主动。"
      })

    result = response("", [revision_call])

    assert {:ok, judgment} = JudgmentProtocol.request_judgment(execution([result]), %{}, input())
    assert judgment.action == "work_profile_revision"
    assert judgment.frame_type == "execution_candidate"
    assert judgment.profile_revision.field == "main_goal"
    assert judgment.profile_revision.value == "在巡检收网前拿到暗抽主账。"
    assert judgment.profile_revision.title == "主线目标"
  end

  test "立项修订工具拒绝未知字段/数值字段非正整数" do
    bad_field =
      call("propose_work_profile_revision", %{
        "title" => "任意字段",
        "body" => "值",
        "field" => "not_a_field",
        "value" => "x",
        "author_reasoning" => "r"
      })

    assert {:error, _, _state} =
             JudgmentProtocol.request_judgment(
               execution([response("", [bad_field])]),
               %{},
               input()
             )

    bad_numeric =
      call("propose_work_profile_revision", %{
        "title" => "目标体量",
        "body" => "约 30 万字",
        "field" => "target_length",
        "value" => "30万",
        "author_reasoning" => "r"
      })

    assert {:error, _, _state} =
             JudgmentProtocol.request_judgment(
               execution([response("", [bad_numeric])]),
               %{},
               input()
             )
  end

  test "普通文本完整保留，一次 auto；未提供模型判断保持未知" do
    text = "  Strata 的工作过程缺少具体细节。\n\n可以继续讨论结尾。\n"
    result = response(text, [])
    assert {:ok, judgment} = JudgmentProtocol.request_judgment(execution([result]), %{}, input())
    assert judgment.action == "reply"
    assert judgment.provider_call_count == 1
    assert judgment.narrative == text
    assert judgment.candidate_directions == []
    assert judgment.model_interpretation_status == "not_provided"
    assert judgment.reply_record.model_interpretation == nil
    assert judgment.reply_record.supplied_context_refs == ["work:work-judgment-fixture"]

    source_hash = :crypto.hash(:sha256, text) |> Base.encode16(case: :lower)

    assert judgment.reply_record.author_narrative_source == %{
             source_type: "provider_output",
             provider_run_ref: "run-call-1",
             provider_call_ref: "call-1",
             provider_output_ref: "run-call-1",
             source_hash: source_hash,
             source_byte_range: %{start: 0, length: byte_size(text)},
             narrative_hash: source_hash
           }

    assert :ok =
             AgentNarrativeSource.verify(text, judgment.narrative_source, %{
               "run-call-1" => result.provider_output
             })

    assert_receive {:provider_request, %{projection: %{tool_choice: "auto"}}}
    refute_receive {:provider_request, _}, 10
  end

  test "提问以question唯一交付，原字节与选项均绑定实际Provider字段" do
    for options <- [
          [],
          [%{"value" => "one", "label" => " 第一章 "}],
          [
            %{
              "value" => "character:e9fe5f90-c939-4f9e-abee-da235d1eaa45",
              "label" => " 老沈\n（调查员） "
            }
          ]
        ] do
      question = "  要采用哪种结尾？\n"
      result = response("", [call("ask_author", %{"question" => question, "options" => options})])

      assert {:ok, judgment} =
               JudgmentProtocol.request_judgment(execution([result]), %{}, input())

      assert judgment.action == "await_author"
      assert judgment.question == question
      assert judgment.options == options
      assert judgment.narrative_source.source_type == "provider_output_tool_narrative"
      assert judgment.narrative_source.tool_call_narrative_field == "question"
      assert judgment.narrative == question

      source_hash = :crypto.hash(:sha256, question) |> Base.encode16(case: :lower)

      assert judgment.reply_record.author_narrative_source == %{
               source_type: "provider_output_tool_narrative",
               provider_run_ref: "run-call-1",
               provider_call_ref: "call-1",
               provider_output_ref: "run-call-1",
               tool_call_name: "ask_author",
               tool_call_narrative_field: "question",
               source_hash: source_hash,
               source_byte_range: %{start: 0, length: byte_size(question)},
               narrative_hash: source_hash
             }

      assert :ok =
               AgentNarrativeSource.verify(question, judgment.narrative_source, %{
                 "run-call-1" => result.provider_output
               })
    end
  end

  test "ask_author 只以question交付，另一份非空content即使相同也需纠错" do
    for content <- ["还有另一段说明。", "要采用哪种结尾？"] do
      result = response(content, [call("ask_author", %{question: "要采用哪种结尾？", options: []})])

      assert {:error, {:judgment_protocol_violation, :author_question_content_conflict}, state} =
               JudgmentProtocol.request_judgment(execution([result]), %{}, input())

      assert state.provider_call_count == 2
    end
  end

  test "ask_author 选项与原调用不同则沿原 call 回执纠错，最多两次" do
    args = %{
      "question" => "  要修订哪位角色？\n",
      "options" => [%{"value" => "role-one", "label" => " 老沈\n（调查员） "}]
    }

    original = response("", [call("ask_author", args)])
    changed_args = put_in(args, ["options", Access.at(0), "label"], "老沈\n（调查员）")
    result = %{original | tool_calls: [call("ask_author", changed_args)]}

    assert {:error, {:judgment_protocol_violation, :tool_call_not_bound_to_provider_output},
            state} =
             JudgmentProtocol.request_judgment(execution([result]), %{}, input())

    assert state.provider_call_count == 2
    assert_receive {:provider_request, _}
    assert_receive {:provider_request, corrected}

    assert Enum.any?(List.last(corrected.messages).blocks, fn block ->
             block.type == "validation_result" and block.status == "failed" and
               block.call_id == "tool-ask_author" and
               block.reason_code == "tool_call_not_bound_to_provider_output"
           end)
  end

  test "ask_author 保留真实缺 id 来源及重复原 id 的 canonical 映射，不改变原字段值" do
    args = %{
      "question" => "  要修订哪位角色？\n",
      "options" => [%{"value" => "role-one", "label" => " 老沈\n（调查员） "}]
    }

    without_id = call("ask_author", args) |> Map.delete(:id)
    source_without_id = response("", [without_id], "missing-id")

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(execution([source_without_id]), %{}, input())

    assert judgment.question == args["question"]
    assert judgment.options == args["options"]
    assert [%{provider_call_id: nil}] = judgment.provider_result.tool_calls

    bad_args =
      put_in(
        args,
        ["options", Access.at(0), "label"],
        "character:e9fe5f90-c939-4f9e-abee-da235d1eaa45"
      )

    bad = response("", [call("ask_author", bad_args)], "question-retry-first")
    good = response("", [call("ask_author", args)], "question-retry-good")

    assert {:ok, corrected} =
             JudgmentProtocol.request_judgment(execution([bad, good]), %{}, input())

    assert corrected.provider_call_count == 2
    assert corrected.question == args["question"]
    assert corrected.options == args["options"]

    assert [%{id: "tool-ask_author:2", provider_call_id: "tool-ask_author"}] =
             corrected.provider_result.tool_calls

    assert :ok =
             AgentNarrativeSource.verify(args["question"], corrected.narrative_source, %{
               "run-question-retry-good" => good.provider_output
             })
  end

  test "重复/带首尾空白的 option value 失败，不补虚构选项" do
    for values <- [["one", "one"], [" one"]] do
      options = Enum.map(values, &%{value: &1, label: "方向"})
      bad = response("", [call("ask_author", %{question: "选哪一个？", options: options})])

      assert {:error, {:judgment_protocol_violation, :question_option_values_invalid}, _state} =
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
          [
            call("judgment_decision", %{
              action: "reply",
              author_reasoning: "回复",
              dialogue_goal: "问答"
            })
          ],
          [
            call("judgment_decision", %{
              action: "await_author",
              author_reasoning: "提问",
              dialogue_goal: "判断"
            })
          ],
          [call("ask_author", %{question: "选择？", options: [], record_only: true})]
        ] do
      assert {:error, _, _state} =
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

    assert {:error, {:author_content_registration_invalid, :source_not_available}, _state} =
             JudgmentProtocol.request_judgment(execution([result]), %{}, input())

    bad = response("说明", [call("register_author_content", Map.put(args, :body, "替代正文"))])

    assert {:error, {:judgment_protocol_violation, :invalid_tool_arguments}, _state} =
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

  test "作者说明工具与内部探索都拒绝非空 content，不吞掉额外正文" do
    text = "  只核对已有资料，不会保存或写入作品。\n"

    args = %{
      action: "execute",
      capability: "work_archive_read",
      dialogue_goal: "核对资料",
      author_reasoning: text
    }

    tool = call("judgment_decision", args)

    protocol_input =
      input(capabilities: ["work_archive_read"], explore: true, explore_tools: ["chapter_read"])

    read_call =
      call("judgment_decision", %{
        action: "explore",
        explore_request: %{tool: "chapter_read", query: "第一章"}
      })

    for candidate <- [tool, read_call], content <- [text, "另一份说明。", "  "] do
      assert {:error, {:judgment_protocol_violation, :author_narrative_content_conflict}, state} =
               JudgmentProtocol.request_judgment(
                 execution([response(content, [candidate])]),
                 %{},
                 protocol_input
               )

      assert state.provider_call_count == 2
      assert Enum.all?(validation_blocks(state.judgment_transcript), &(&1.status == "failed"))
    end

    source = response("", [tool])

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(execution([source]), %{}, protocol_input)

    assert judgment.narrative == text
    assert judgment.capability == "work_archive_read"
    assert judgment.narrative_source.tool_call_narrative_field == "author_reasoning"

    assert :ok =
             AgentNarrativeSource.verify(text, judgment.narrative_source, %{
               "run-call-1" => source.provider_output
             })
  end

  test "判断与续行的旧 reason 参数无兼容入口，即使同时提供新正文也拒绝" do
    cases = [
      {:request_judgment, "judgment_decision",
       %{action: "execute", capability: "character_design", dialogue_goal: "设计人物"},
       input(capabilities: ["character_design"])},
      {:request_continuation, "continuation_decision", %{action: "continue", guidance: "补足结尾"},
       %{deviation_summary: "尚缺结尾", observation_block: "已有前半章", options: input().options}}
    ]

    for {function, name, fields, protocol_input} <- cases,
        args <- [
          Map.put(fields, :reason, "旧说明。"),
          fields |> Map.put(:reason, "旧说明。") |> Map.put(:author_reasoning, "新说明。")
        ] do
      assert {:error, {:judgment_protocol_violation, :invalid_tool_arguments}, state} =
               apply(JudgmentProtocol, function, [
                 execution([response("", [call(name, args)])]),
                 %{},
                 protocol_input
               ])

      assert state.provider_call_count == 2
    end
  end

  test "有正文执行与无正文探索都校验原调用，不接受被替换的参数、身份或正文" do
    execute =
      call("judgment_decision", %{
        action: "execute",
        capability: "character_design",
        dialogue_goal: "设计人物",
        author_reasoning: "根据现有材料提出候选。"
      })

    read =
      call("judgment_decision", %{
        action: "explore",
        explore_request: %{tool: "chapter_read", query: "  第一章\n"}
      })

    for {original, changed_call} <- [
          {response("", [execute]), put_in(execute.arguments.capability, "world_building")},
          {response("", [read]), put_in(read.arguments.explore_request.query, "另一章")},
          {response("", [read]), %{read | id: "forged-native-call"}},
          {response("原响应仍有正文。", [read]), read}
        ] do
      result = %{original | content: "", tool_calls: [changed_call]}

      assert {:error, {:judgment_protocol_violation, :tool_call_not_bound_to_provider_output},
              state} =
               JudgmentProtocol.request_judgment(
                 execution([result]),
                 %{},
                 input(
                   capabilities: ["character_design", "world_building"],
                   explore: true,
                   explore_tools: ["chapter_read"]
                 )
               )

      assert state.provider_call_count == 2
      assert Enum.all?(validation_blocks(state.judgment_transcript), &(&1.status == "failed"))
    end
  end

  @tag :r05_explore_contract
  test "能力、已有候选与探索目录按本次事实校验" do
    args = %{
      action: "execute",
      capability: "revise_pending_artifact",
      pending_artifact_ref: "foreign",
      dialogue_goal: "修订",
      author_reasoning: "保留原稿。"
    }

    result = response("", [call("judgment_decision", args)])

    opts = [
      capabilities: ["revise_pending_artifact"],
      pending_artifact_targets: %{"actual" => ["revise_pending_artifact"]}
    ]

    assert {:error, {:pending_artifact_invalid, :target_not_available}, _state} =
             JudgmentProtocol.request_judgment(execution([result]), %{}, input(opts))

    explore =
      call("judgment_decision", %{
        action: "explore",
        explore_request: %{tool: "chapter_read", query: "chapter:one"}
      })

    for content <- [nil, ""] do
      assert {:ok, judgment} =
               JudgmentProtocol.request_judgment(
                 execution([response(content, [explore])]),
                 %{},
                 input(explore: true, explore_tools: ["chapter_read"])
               )

      assert judgment.action == "explore"

      assert Map.take(judgment, [:dialogue_goal, :narrative, :narrative_source, :reply_record]) ==
               %{}

      assert judgment.provider_result.provider_output.content.tool_calls == [explore]
      assert judgment.tool_call_id == explore.id
    end

    assert {:error, {:judgment_protocol_violation, :exploration_not_available}, _state} =
             JudgmentProtocol.request_judgment(execution([response("", [explore])]), %{}, input())
  end

  @tag :r05_explore_contract
  test "非法叙述仅纠错一次，不换用干净字段，最终字节只绑定纠正响应" do
    leak = "character:e9fe5f90-c939-4f9e-abee-da235d1eaa45"
    execute = %{action: "execute", capability: "character_design", dialogue_goal: "设计人物"}
    gap = %{dialogue_goal: "修改身份", missing_effect: "主档案修改", author_reasoning: leak}
    good_text = "  已核对老沈的身份。\n\n请确认这份建议。\n"
    good = response(good_text, [], "good")

    bad_responses = [
      response("错误说明", [call("judgment_decision", %{action: "reply"})], "bad"),
      response(leak, [], "bad"),
      response("", [call("judgment_decision", Map.put(execute, :author_reasoning, leak))], "bad"),
      response(
        leak,
        [call("judgment_decision", Map.put(execute, :author_reasoning, "安全说明"))],
        "bad"
      ),
      response("", [call("ask_author", %{question: leak, options: []})], "bad"),
      response(
        "",
        [call("ask_author", %{question: "你指哪位？", options: [%{value: "first", label: leak}]})],
        "bad"
      ),
      response("请确认对象。", [call("ask_author", %{question: leak, options: []})], "bad"),
      response(
        "请确认对象。",
        [
          call("ask_author", %{question: "你指哪位？", options: [%{value: "first", label: leak}]})
        ],
        "bad"
      ),
      response("", [call("report_capability_gap", gap)], "bad")
    ]

    for bad <- bad_responses do
      assert {:ok, judgment} =
               JudgmentProtocol.request_judgment(
                 execution([bad, good]),
                 %{},
                 input(capabilities: ["character_design"])
               )

      assert judgment.provider_call_count == 2
      assert judgment.narrative == good_text
      assert judgment.narrative_source.provider_call_ref == "good"

      assert :ok =
               AgentNarrativeSource.verify(good_text, judgment.narrative_source, %{
                 "run-good" => good.provider_output
               })

      assert_receive {:provider_request, _}
      assert_receive {:provider_request, corrected}

      if match?([%{arguments: %{action: "reply"}}], bad.tool_calls) do
        refute List.last(validation_blocks(corrected)).detail["message"] =~ ~s("action":"execute")
      end

      if bad.tool_calls == [] do
        assert validation_text(List.last(corrected.messages)) =~ "作者叙述"
        refute validation_text(List.last(corrected.messages)) =~ leak
      else
        assert Enum.any?(List.last(corrected.messages).blocks, fn block ->
                 block.type == "validation_result" and block.status == "failed" and
                   block.call_id == hd(bad.tool_calls).id
               end)
      end

      refute_receive {:provider_request, _}, 10
    end

    assert {:error, {:judgment_protocol_violation, :author_visible_narrative_invalid}, state} =
             JudgmentProtocol.request_judgment(execution([response(leak, [])]), %{}, input())

    assert state.provider_call_count == 2
  end

  test "续行仅接受 continue/ask_author/缺口，不接受普通文本或旧停等枚举" do
    continuation_input = %{
      deviation_summary: "尚缺结尾",
      observation_block: "已有前半章",
      options: input().options
    }

    good =
      response("", [
        call("continuation_decision", %{
          action: "continue",
          guidance: "补足结尾",
          author_reasoning: "按已指出的缺口补写。"
        })
      ])

    assert {:ok, %{action: "continue", provider_call_count: 1}} =
             JudgmentProtocol.request_continuation(execution([good]), %{}, continuation_input)

    bad =
      response("", [
        call("continuation_decision", %{
          action: "continue",
          guidance: "补足结尾",
          author_reasoning: "候选 as_mwnwwxoe_11"
        })
      ])

    assert {:ok, %{action: "continue", provider_call_count: 2, narrative: "按已指出的缺口补写。"}} =
             JudgmentProtocol.request_continuation(
               execution([bad, good]),
               %{},
               continuation_input
             )

    assert {:error, {:judgment_protocol_violation, :author_visible_narrative_invalid}, failed} =
             JudgmentProtocol.request_continuation(execution([bad]), %{}, continuation_input)

    assert failed.provider_call_count == 2

    assert {:error, _, _state} =
             JudgmentProtocol.request_continuation(
               execution([response("继续", [])]),
               %{},
               continuation_input
             )
  end

  test "页面替身方向字段不因 atom/string 转换丢失，显式只聊不生成方向" do
    # 生产请求入口已统一为 canonical IR；替身直接消费带真实 tools 的 IR。
    direction_prompt =
      NovelTest.TestRequestIR.ir(
        [
          NovelTest.TestRequestIR.base("创作判断器\n## 决策与输出契约\n"),
          NovelTest.TestRequestIR.author("给我两个小说创作方向。")
        ],
        tools: JudgmentToolContract.tools(:judgment),
        projection: %{tool_choice: "auto"}
      )

    {:ok, directions} =
      SliceVerify.complete(nil, nil, direction_prompt, %{})

    assert [%{"name" => "propose_creative_directions", "arguments" => args}] =
             directions.tool_calls

    assert Enum.all?(
             args.candidate_directions,
             &(is_binary(&1["title"]) and is_binary(&1["pitch"]))
           )

    assert :ok = JudgmentToolContract.validate(directions.tool_calls, :judgment)

    plain_prompt =
      NovelTest.TestRequestIR.ir(
        [
          NovelTest.TestRequestIR.base("创作判断器\n## 决策与输出契约\n"),
          NovelTest.TestRequestIR.author("只聊节奏，不生成草稿。")
        ],
        tools: JudgmentToolContract.tools(:judgment),
        projection: %{tool_choice: "auto"}
      )

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

      # 处置状态只来自当前结构化 Scope，构造与生产判断请求同形的 IR：
      # application scope 携带处置事实，作者原话保持独立 author 消息。
      prompt =
        NovelTest.TestRequestIR.ir(
          [
            NovelTest.TestRequestIR.base("创作判断器"),
            NovelTest.TestRequestIR.scope(%{context: %{interaction_state: facts}}),
            NovelTest.TestRequestIR.author("把上一条资料原文保存为作品设定。")
          ],
          tools: JudgmentToolContract.tools(:judgment),
          projection: %{tool_choice: "auto"}
        )

      {:ok, result} = SliceVerify.complete(nil, nil, prompt, %{})

      narrative =
        case result.tool_calls do
          [] ->
            result.content

          [%{"arguments" => %{author_reasoning: narrative}}] ->
            assert result.content == ""
            narrative
        end

      assert narrative =~ expected
      refute narrative =~ "已经采纳入档"
    end
  end

  test "判断入口拒绝缺失输入配对或运行身份，已有历史与父回合也不能补来源" do
    run = %{run_id: "run-explicit-judgment", parent_turn_ref: "turn:old-parent"}
    valid = input(plan_run: run)
    assert {:ok, previous} = JudgmentProtocol.transcript_for_production(valid)
    provider = %Execution{result_fn: fn _ -> flunk("缺身份或作者来源不得调用 Provider") end}

    for {text, ref} <- [
          {valid.author_text, nil},
          {nil, valid.source_input_ref},
          {nil, nil},
          {" \r\n ", valid.source_input_ref},
          {valid.author_text, " \r\n "},
          {123, valid.source_input_ref}
        ],
        history <- [nil, previous] do
      invalid =
        Map.merge(valid, %{author_text: text, source_input_ref: ref, transcript: history})

      assert {:error, :invalid_author_input} =
               JudgmentProtocol.request_judgment(provider, %{}, invalid)
    end

    for options <- [
          [],
          [plan_run: %{}],
          [plan_run: %{work_id: "work-without-run"}],
          [plan_run: %{parent_turn_ref: "turn:parent-without-run"}],
          [plan_run: %{run_id: "  "}]
        ] do
      assert {:error, :missing_run_envelope} =
               JudgmentProtocol.request_judgment(provider, %{}, %{valid | options: options})
    end
  end

  test "没有作者输入的内部续行可用真实 run 建新段，但不能制造运行或作者身份" do
    input = %{
      deviation_summary: "待补充创作结果",
      options: [
        plan_run: %{
          run_id: "run-authorless-continuation",
          goal: %{text: "应用归纳的续行目标", version: 1}
        }
      ]
    }

    assert {:ok, transcript} = JudgmentProtocol.transcript_for_production(input, :continuation)
    assert {:ok, ir} = AuthoringTranscript.to_request_ir(transcript)
    assert ir.run.run_id == "run-authorless-continuation"
    refute Enum.any?(ir.messages, &(&1.role == "user"))

    assert {:error, :missing_run_envelope} =
             JudgmentProtocol.transcript_for_production(%{input | options: []}, :continuation)
  end

  test "steer 后先进入续行判断也记录同一原文与来源，重复构造不重写历史" do
    initial = JudgmentProtocol.request_for_production(input())
    {:ok, transcript} = AuthoringTranscript.from_request_ir(initial)
    raw = "  先重试 Ω\n只改第二段。\t "

    continuation_input = %{
      transcript: transcript,
      author_text: raw,
      source_input_ref: "author-turn:steer:2",
      author_turn: %{origin: "author_choice", question_ref: "question:retry"},
      deviation_summary: "正文执行失败",
      options: [
        plan_run: %{
          input().options[:plan_run]
          | goal: %{text: "应用归纳的续行目标", version: 2}
        }
      ]
    }

    request = JudgmentProtocol.request_for_production(continuation_input, :continuation)
    assert Enum.take(request.messages, length(initial.messages)) == initial.messages
    author = request.messages |> Enum.filter(&(&1.role == "user")) |> List.last()
    assert author.blocks == [%{type: "text", text: raw}]
    assert author.source_refs == [%{ref: "author-turn:steer:2"}]
    assert author.author_turn["question_ref"] == "question:retry"

    {:ok, continued} = AuthoringTranscript.from_request_ir(request)
    repeated_input = %{continuation_input | transcript: continued}
    repeated = JudgmentProtocol.request_for_production(repeated_input, :continuation)
    assert repeated.messages == request.messages

    assert_raise ArgumentError, "author_input_conflict", fn ->
      JudgmentProtocol.request_for_production(
        %{repeated_input | author_text: String.trim(raw)},
        :continuation
      )
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

    assert {:error, %{type: :timeout}, _state} =
             JudgmentProtocol.request_judgment(
               execution([invalid, {:error, %{type: :timeout}}]),
               %{},
               input()
             )

    assert_received {:provider_request, original}
    assert_received {:provider_request, corrected}
    assert length(corrected.messages) == length(original.messages) + 2
    refute_receive {:provider_request, _}, 10
  end

  test "首次校验失败后传输错误：保留首个 assistant 与失败校验，实际调用为二" do
    invalid =
      response_with_execution_refs(
        "错误动作",
        [call("not_registered", %{})],
        "invalid",
        "run-invalid"
      )

    assert {:error, %{type: :timeout}, state} =
             JudgmentProtocol.request_judgment(
               execution([invalid, {:error, %{type: :timeout}}]),
               %{},
               input()
             )

    assert state.provider_call_count == 2
    transcript = state.judgment_transcript

    assert [assistant] = assistant_messages(transcript)
    assert assistant.provider_call_ref == "invalid"

    assert [validation] = validation_blocks(transcript)
    assert validation.status == "failed"
    assert validation.reason_code == "tool_not_in_profile"

    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, _second}
    refute_receive {:provider_request, _third}, 10
  end

  test "全部传输错误不伪造 assistant/tool 响应，实际调用仍为二" do
    assert {:error, %{type: :timeout}, state} =
             JudgmentProtocol.request_judgment(
               execution([{:error, %{type: :timeout}}, {:error, %{type: :timeout}}]),
               %{},
               input()
             )

    assert state.provider_call_count == 2
    transcript = state.judgment_transcript

    assert assistant_messages(transcript) == []
    assert tool_call_blocks(transcript) == []
    assert validation_blocks(transcript) == []

    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, _second}
    refute_receive {:provider_request, _third}, 10
  end

  test "未创建 IR 的零调用前置错误保持纯错误且不虚增计数" do
    assert {:error, :provider_execution_required} =
             JudgmentProtocol.request_judgment(%Execution{result_fn: nil}, %{}, input())

    refute_receive {:provider_request, _}, 10
  end

  test "已创建合法前缀的请求构造失败保留前缀，调用数不虚增" do
    # 现役请求构造门：canonical IR 里不能有未闭合的 pending tool_call
    # （`RequestIR.prepare_request/2` → `validate_request_ready/1`）。旧能力门
    # `{:unsupported_capability, missing}` 已随能力目录退役。这里先用真实判断入口
    # 生成合法前缀（含真实 scope），再在末尾追加无观察的 tool_call：scope 未变，
    # 请求不会再追加消息，唯一失败点就是「请求未 ready」，从而验证同一不变量：
    # 前缀保留、无新增协议块、零真实调用。
    assert {:ok, base} = JudgmentProtocol.transcript_for_production(input())

    prefix =
      AuthoringTranscript.append_provider_result(base, %{
        content: "",
        tool_calls: [
          %{
            id: "call-prefix-1",
            name: "chapter_read",
            arguments: %{"query" => "前缀取证"}
          }
        ],
        provider_call_ref: "pcall-prefix-1",
        provider_run_ref: "prun-prefix-1"
      })

    assert {:error, {:pending_tool_calls, ["call-prefix-1"]}, state} =
             JudgmentProtocol.request_judgment(
               execution([response("不应调用", [])]),
               %{},
               input() |> Map.put(:transcript, prefix)
             )

    assert state.provider_call_count == 0
    transcript = state.judgment_transcript

    # 既有前缀逐条保留，未因构造失败新增 assistant/tool_call/校验块。
    assert Enum.take(transcript.messages, length(prefix.messages)) == prefix.messages
    assert length(assistant_messages(transcript)) == length(assistant_messages(prefix))
    assert length(tool_call_blocks(transcript)) == length(tool_call_blocks(prefix))
    assert validation_blocks(transcript) == []
    refute_receive {:provider_request, _}, 10
  end

  test "续行终局拒绝保留既有历史前缀，只计本次调用且不倒写已 passed 校验" do
    ask = call("ask_author", %{"question" => "先改哪一段？", "options" => []})

    assert {:ok, first} =
             JudgmentProtocol.request_judgment(
               execution([response("", [ask])]),
               %{},
               input()
             )

    assert_receive {:provider_request, _prior_request}

    assert length(assistant_messages(first.transcript)) == 1
    assert [passed] = validation_blocks(first.transcript)
    assert passed.status == "passed"

    continuation_input = %{
      transcript: first.transcript,
      deviation_summary: "尚缺结尾",
      observation_block: "已有前半章",
      options: input().options
    }

    invalid = response("坏响应", [call("not_registered", %{})], "bad-continuation")

    assert {:error, {:judgment_protocol_violation, :tool_not_in_profile}, state} =
             JudgmentProtocol.request_continuation(
               execution([invalid, invalid]),
               %{},
               continuation_input
             )

    # 本次续行只真实调用两次；历史里已有的一次判断调用不重算进本次 delta。
    assert state.provider_call_count == 2
    transcript = state.judgment_transcript

    assert length(assistant_messages(transcript)) == 3
    validations = validation_blocks(transcript)
    assert [^passed, failed_second, failed_third] = validations
    assert failed_second.status == "failed"
    assert failed_third.status == "failed"
    assert Enum.all?([failed_second, failed_third], &(&1.reason_code == "tool_not_in_profile"))

    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, _second}
    refute_receive {:provider_request, _third}, 10
  end

  test "其它校验 reason 的纠错文案保持原样（不混入合法组合指引）" do
    first = response("", [call("judgment_decision", %{action: "execute"})])
    second = response("已按原目标继续。", [])

    assert {:ok, %{action: "reply", provider_call_count: 2}} =
             JudgmentProtocol.request_judgment(execution([first, second]), %{}, input())

    # invalid_tool_arguments 走参数 schema 专用纠错（不含合法组合指引）；仍允许一次纠正后继续。
    assert_receive {:provider_request, _}
    assert_receive {:provider_request, corrected}
    correction = validation_text(List.last(corrected.messages))
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
      response("", [
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
    correction = validation_text(List.last(corrected.messages))
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
             :anaphoric_current_source_requires_explicit_text}, _state} =
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
    correction = validation_text(List.last(corrected.messages))
    assert correction =~ "judgment_narrative_required"
    assert correction =~ "必须给出非空 content"

    assert {:error, {:judgment_protocol_violation, :judgment_narrative_required}, _state} =
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
    prompt = JudgmentProtocol.request_for_production(input())
    content = first_text(prompt)

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
               execution([response("", [gap])]),
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
    prompt = JudgmentProtocol.request_for_production(input())
    content = first_text(prompt)

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
    correction = validation_text(List.last(corrected.messages))
    assert correction =~ "target_not_available"
    assert correction =~ "只能引用当前上下文/观察中真实列出的"
    assert correction =~ "session_adoptions"
    assert correction =~ "不得编造 ref"
  end

  test "引用不存在的目标 ref 且纠正后仍不存在 → 终局拒绝仍保留两次实际调用与失败校验" do
    arguments = %{
      "action" => "execute",
      "capability" => "revise_pending_artifact",
      "pending_artifact_ref" => "as_ghost",
      "dialogue_goal" => "修改候选",
      "author_reasoning" => "按作者要求修改。"
    }

    first_call = %{call("judgment_decision", arguments) | id: "tool-ghost-1"}

    second_call = %{call("judgment_decision", arguments) | id: "tool-ghost-2"}

    opts = [
      capabilities: ["revise_pending_artifact"],
      pending_artifact_targets: %{"as_real" => ["revise_pending_artifact"]}
    ]

    assert {:error, {:pending_artifact_invalid, :target_not_available}, state} =
             JudgmentProtocol.request_judgment(
               execution([
                 response_with_execution_refs("", [first_call], "pcall-ghost-1", "prun-ghost-1"),
                 response_with_execution_refs("", [second_call], "pcall-ghost-2", "prun-ghost-2")
               ]),
               %{},
               input(opts)
             )

    assert state.provider_call_count == 2
    transcript = state.judgment_transcript

    assistants = assistant_messages(transcript)
    assert length(assistants) == 2
    assert Enum.map(assistants, & &1.provider_call_ref) == ["pcall-ghost-1", "pcall-ghost-2"]
    assert Enum.map(assistants, & &1.provider_run_ref) == ["prun-ghost-1", "prun-ghost-2"]

    assert [first, second] = tool_call_blocks(transcript)
    assert first.call_id == "tool-ghost-1"
    assert second.call_id == "tool-ghost-2"
    assert first.arguments == arguments
    assert second.arguments == arguments

    validations = validation_blocks(transcript)
    assert length(validations) == 2
    assert Enum.all?(validations, &(&1.status == "failed"))
    assert Enum.all?(validations, &(&1.reason_code == "target_not_available"))
    assert Enum.map(validations, & &1.call_id) == ["tool-ghost-1", "tool-ghost-2"]

    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, _second}
    refute_receive {:provider_request, _third}, 10
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
    correction = validation_text(List.last(corrected.messages))
    assert correction =~ "target_ref_field_conflict"
    assert correction =~ "不得同时填两个"
  end

  defp execute_call(overrides) do
    call(
      "judgment_decision",
      Map.merge(
        %{"action" => "execute", "dialogue_goal" => "修改候选", "author_reasoning" => "按作者要求修改。"},
        overrides
      )
    )
  end

  test "可见收束/收下资料零菜单规则在判断 prompt 中明确" do
    content = first_text(JudgmentProtocol.request_for_production(input()))

    assert content =~ "最终答复收束"
    assert content =~ "作者正文必须给出可直接阅读的结论"
    assert content =~ "实际方向内容"
    assert content =~ "用 propose_creative_directions 时 author_reasoning"
    refute content =~ "用 propose_creative_directions 时 content 必须"
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
    content = first_text(JudgmentProtocol.request_for_production(input()))

    assert content =~ "必须用 ask_author 工具提出具体问题"
    assert content =~ "不能用普通 reply 里的问句或说明代替 ask_author"
    assert content =~ "不得用 report_capability_gap"
    assert content =~ "作者要求仅排版且存在可修订候选时，应执行 revise_pending_artifact"
    assert String.split(content, "必须用 ask_author 工具提出具体问题") |> length() == 2
  end

  test "task-28 证据/冒充/系统信息/收束规则在判断 prompt 中明确" do
    content = first_text(JudgmentProtocol.request_for_production(input()))

    # M14：禁止用新建同名/演化候选冒充已有主档案修改
    assert content =~ "修改已有对象的主档案/权威字段"
    assert content =~ "不得把"
    assert content =~ "新建同名对象"
    assert content =~ "演化/记忆候选"
    assert content =~ "不能说“新建档案后他就是主角/就实现了修改”"

    assert content =~ "系统可读的章节目录、章状态、统计、正文/档案材料不得转向作者索取"
    assert content =~ "未提供的目录/统计先 archive_read"
    assert content =~ "不能将未提供材料说成空或不存在"

    # M01：统计只能证明状态，叙事完成与质量结论必须取得相应正文/计划证据。
    assert content =~ "统计只证明进度与可核对状态"
    assert content =~ "这些判断需要相应正文与章计划证据，不得编造未读情节"
    # M03：继续读取不是最终答复
    assert content =~ "继续读取不是最终答复"
    assert content =~ "不得只回“已继续读取/再给结论”"

    # M09：不得用元描述代替方向
    assert content =~ "也不能用“你的请求属于创作方向讨论”这类"

    # 唯一性（关键规则只出现一次）
    assert String.split(content, "系统可读的章节目录、章状态、统计、正文/档案材料不得转向作者索取") |> length() == 2

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
    correction = validation_text(List.last(corrected.messages))
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

  @tag :r05_explore_contract
  test "M16：explore 的旧目标与执行字段沿原调用纠错，最终只接受纠正的读取请求" do
    good =
      call("judgment_decision", %{
        "action" => "explore",
        "explore_request" => %{"tool" => "chapter_read", "query" => "第01章：灯楼夜雨"}
      })
      |> Map.put(:id, "corrected-explore")

    opts = [explore: true, explore_tools: ["chapter_read"], capabilities: ["work_archive_read"]]

    for {field, value} <- [{"capability", "work_archive_read"}, {"dialogue_goal", "取得章节引用"}] do
      bad =
        good
        |> Map.put(:id, "rejected-explore")
        |> Map.update!(:arguments, &Map.put(&1, field, value))

      corrected_result = response("", [good], "corrected-provider")

      assert {:ok, judgment} =
               JudgmentProtocol.request_judgment(
                 execution([response("", [bad], "rejected-provider"), corrected_result]),
                 %{},
                 input(opts)
               )

      assert judgment.action == "explore"
      assert judgment.provider_call_count == 2

      assert Map.take(judgment, [:dialogue_goal, :narrative, :narrative_source, :reply_record]) ==
               %{}

      assert judgment.provider_result == corrected_result
      assert judgment.tool_call_id == good.id

      assert_receive {:provider_request, _first}
      assert_receive {:provider_request, corrected}
      assert [failed] = validation_blocks(corrected)
      assert failed.status == "failed"
      assert failed.reason_code == "invalid_tool_arguments"
      assert failed.call_id == bad.id
      assert [original] = tool_call_blocks(corrected)
      assert original.arguments == bad.arguments
      assert {:ok, []} = RequestIR.pending_call_ids(corrected)

      correction = failed.detail["message"]
      assert correction =~ field
      assert correction =~ ~s("action":"explore")
      refute correction =~ ~s("action":"execute")
    end
  end

  @tag :r05_explore_contract
  test "M16：execute 带 explore_request 被具体纠错后可修复" do
    bad =
      call("judgment_decision", %{
        "action" => "execute",
        "capability" => "prose_writing",
        "dialogue_goal" => "写章",
        "author_reasoning" => "作者要求。",
        "explore_request" => %{"tool" => "chapter_read", "query" => "第01章"}
      })

    good =
      call("judgment_decision", %{
        "action" => "execute",
        "capability" => "prose_writing",
        "dialogue_goal" => "写章",
        "author_reasoning" => "作者要求。"
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
    assert judgment.dialogue_goal == "写章"
    assert judgment.provider_call_count == 2

    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, corrected}
    correction = List.last(validation_blocks(corrected)).detail["message"]
    assert correction =~ ~s("action":"execute")
    assert correction =~ "explore_request"
  end

  test "task-28 补充：直接回答/唯一候选直接执行/参数 schema 指引在 prompt 中明确" do
    content = first_text(JudgmentProtocol.request_for_production(input()))

    assert content =~ "实际已读目录/统计足够回答章数、字数或是否已有正文时直接 reply"
    assert content =~ "不为形式重复读取"
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
    correction = List.last(validation_blocks(corrected)).detail["message"]
    assert correction =~ "工具参数未通过 schema 校验"
    assert correction =~ "report_capability_gap 允许字段：alternative_operation_refs、author_reasoning、"
    assert correction =~ "dialogue_goal、missing_effect"
    assert correction =~ "上次未允许字段：capability"
  end

  test "task-34 prompt：M02 质量边界/M03 占位收束/M06 未答不推进/M16 多意图/M18 探索优先" do
    content = first_text(JudgmentProtocol.request_for_production(input()))

    assert content =~ "统计只证明进度与可核对状态"
    assert content =~ "不能单凭章状态或“已保存/无待采纳候选”断言叙事完成、质量或无矛盾"
    assert content =~ "禁止用“-”“—”“…”或仅标点/空白的占位内容作为最终答复"
    assert content =~ "上一轮向作者提问后尚未收到作者回答/选择时，不得推进具体候选或版本"
    assert content =~ "不得把未回答当默认选择"
    assert content =~ "多意图请求"
    assert content =~ "先回答版本/事实问题"
    assert content =~ "来源探索优先 prose_search/chapter_read 查正文原文"

    assert String.split(content, "上一轮向作者提问后尚未收到作者回答/选择时，不得推进具体候选或版本")
           |> length() == 2

    assert String.split(content, "统计只证明进度与可核对状态") |> length() == 2
  end

  test "M03：仅 '-'/标点占位内容视为空回复，纠错后可修复；仍空则诚实拒绝" do
    dash = response("-", [])
    good = response("已覆盖 1–12000/34357；未读部分 12001–34357，结论仅限已读部分，下一步继续读取末页。", [])

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(execution([dash, good]), %{}, input())

    assert judgment.narrative =~ "已覆盖"

    assert_receive {:provider_request, _first}
    assert_receive {:provider_request, corrected}
    correction = validation_text(List.last(corrected.messages))
    assert correction =~ "judgment_narrative_required"

    assert {:error, {:judgment_protocol_violation, :judgment_narrative_required}, _state} =
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

    assert {:error, {:judgment_protocol_violation, :await_author_unanswered}, _state} =
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
    assert validation_text(List.last(corrected.messages)) =~ "judgment_narrative_required"

    assert {:error, {:judgment_protocol_violation, :judgment_narrative_required}, _state} =
             JudgmentProtocol.request_judgment(execution([markup, markup]), %{}, input())
  end

  test "探索不可用时只接受模型纠正后的普通回复，不从错误工具响应提取正文" do
    explore =
      call("judgment_decision", %{
        "action" => "explore",
        "explore_request" => %{"tool" => "chapter_read", "query" => "第01章"}
      })

    conclusion = "已读到 1–30000/34357；本轮探索预算已用尽，未读末页不纳入结论。"
    invalid = response("", [explore], "unavailable")
    corrected = response(conclusion, [], "corrected-reply")

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([invalid, corrected]),
               %{},
               input(explore: false)
             )

    assert judgment.action == "reply"
    assert judgment.narrative == conclusion
    assert judgment.narrative_source.provider_call_ref == "corrected-reply"
    assert judgment.provider_call_count == 2

    assert {:error, {:judgment_protocol_violation, :exploration_not_available}, exhausted} =
             JudgmentProtocol.request_judgment(execution([invalid]), %{}, input(explore: false))

    assert exhausted.provider_call_count == 3

    conflict = response(conclusion, [explore])

    assert {:error, {:judgment_protocol_violation, :author_narrative_content_conflict}, failed} =
             JudgmentProtocol.request_judgment(execution([conflict]), %{}, input(explore: false))

    assert failed.provider_call_count == 2
  end

  test "task-36：伪工具文本反复出现时有界重试（不无限循环）" do
    pseudo =
      response(
        "<tool_call>\n<function=chapter_read>\n<parameter=query>第01章</parameter>\n</function>\n</tool_call>",
        []
      )

    assert {:error, {:judgment_protocol_violation, :judgment_narrative_required}, _state} =
             JudgmentProtocol.request_judgment(execution([pseudo, pseudo, pseudo]), %{}, input())

    # 3 次有界尝试后诚实拒绝（不是 1 次即终局）
    assert_receive {:provider_request, _}
    assert_receive {:provider_request, _}
    assert_receive {:provider_request, _}
    refute_receive {:provider_request, _}, 10
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
    assert validation_text(List.last(corrected.messages)) =~ "discussion_only_violation"
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
    content = first_text(JudgmentProtocol.request_for_production(input()))

    assert content =~ "实际已读目录/统计足够回答章数、字数或是否已有正文时直接 reply"
    assert content =~ "未提供的目录/统计先 archive_read"
    assert content =~ "属于分析任务：不得调用"
    assert content =~ "探索预算已用尽/不可用时不得再请求 explore"
    assert content =~ "工具调用必须使用原生 tool_calls"

    assert String.split(content, "实际已读目录/统计足够回答章数、字数或是否已有正文时直接 reply")
           |> length() == 2
  end

  test "task-36 收口：分析型已有充分事实时直接 reply；质量判断才允许 explore" do
    content = first_text(JudgmentProtocol.request_for_production(input()))

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
      |> Map.update!(:options, &Keyword.merge(&1, explore: true, explore_tools: ["chapter_read"]))

    quality_explore =
      call("judgment_decision", %{
        "action" => "explore",
        "explore_request" => %{"tool" => "chapter_read", "query" => "第02章：井底回声"}
      })

    assert {:ok, %{action: "explore"}} =
             JudgmentProtocol.request_judgment(
               execution([response("", [quality_explore])]),
               %{},
               quality_input
             )
  end

  test "B28 CP1：判断 prompt 明确整章修订绑定与缺章目标澄清（不退化为 prose_writing）" do
    content = first_text(JudgmentProtocol.request_for_production(input()))

    assert content =~ "整章正文修订绑定"
    assert content =~ "chapter-scoped 修订"
    assert content =~ "该章全部当前 accepted 片段有序覆盖"
    assert content =~ "仅排版=format_only"
    assert content =~ "不得只绑单个 as_* artifact"
    assert content =~ "不得退化成 prose_writing 新创作"
    assert content =~ "缺章目标或同名章歧义时"
    assert content =~ "按页面章序与章名"
    assert content =~ "禁止猜同名/跨作品"
    assert String.split(content, "整章正文修订绑定") |> length() == 2
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

    refute Enum.any?(
             messages,
             &String.contains?(message_text(&1), "maintenance_capability_required")
           )

    refute_receive {:provider_request, _}, 10

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
      JudgmentProtocol.request_for_production(input(capabilities: ["maintain_chapter_structure"]))
      |> first_text()

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
      "author_reasoning" => "章节结构维护"
    })
  end

  test "B29 CP1：角色修订定义与真实详情绑定规则固定，默认不供应角色目录或正文" do
    request =
      input(capabilities: ["revise_character_profile", "character_design"])
      |> JudgmentProtocol.request_for_production()

    content = first_text(request)
    scope = NovelTest.TestProviderPrompt.scope_content(request)

    refute Map.has_key?(scope["facts"], "characters")

    assert scope["operation"]["available_operations"] == [
             "revise_character_profile",
             "character_design"
           ]

    refute content =~ "character:11111111-1111-1111-1111-111111111111"
    refute content =~ "灯楼查账人"
    assert content =~ "revise_character_profile"
    assert content =~ "目录只供发现与消歧"
    assert content =~ "不授予未读详情的修改资格"
    assert content =~ "不新建角色、不写正文、不冒充角色演化记忆"
    assert content =~ "不得回退 reply/character_evolution/character_design"
    assert content =~ "设计/创建新主角"
  end

  test "B33 §CP1 反例3：讨论角色主角设定的 reply 不被词法强制为修订能力" do
    author = "讨论一下把陆晨指定为主角是否合理，先不要生成候选。"

    prompt_input =
      input(capabilities: ["revise_character_profile", "character_evolution", "character_design"])
      |> Map.put(:author_text, author)

    reply = "是否设陆晨为主角取决于你希望承载的主线；可以先讨论他的动机与代价，本轮不改主档案，也不生成候选。"

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
             &String.contains?(message_text(&1), "character_profile_capability_required")
           )

    refute_receive {:provider_request, _}, 10

    # 真实可见详情、当前指纹与隐藏观察的修订资格在 B33CP1ContextHygieneTest 独立验证。
  end

  test "B29 守卫允许无身份变更的跨能力计划，不把主角状态误当叙事身份" do
    author = "先读完第01章正文，再调整章节大纲，最后更新主角当前状态"
    prompt_input = input() |> Map.put(:author_text, author)

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([
                 response("", [
                   call("agent_plan_draft", %{
                     "plan" => %{
                       "steps" => [
                         %{
                           "step_id" => "read",
                           "kind" => "explore",
                           "description" => "核对正文",
                           "success_criteria" => ["已有正文依据"],
                           "target_tool_ref" => "chapter_read",
                           "exploration_query" => "第01章"
                         },
                         %{
                           "step_id" => "outline",
                           "kind" => "act",
                           "description" => "调整大纲",
                           "success_criteria" => ["大纲候选"],
                           "target_tool_ref" => "plot_outline"
                         },
                         %{
                           "step_id" => "state",
                           "kind" => "act",
                           "description" => "更新人物状态",
                           "success_criteria" => ["状态候选"],
                           "target_tool_ref" => "character_evolution"
                         }
                       ]
                     },
                     "author_reasoning" => "先核对正文，再调整大纲与主角当前状态。",
                     "reason_codes" => ["planned"],
                     "confidence" => 0.9
                   })
                 ])
               ]),
               %{},
               prompt_input
             )

    assert judgment.action == "plan"
    assert judgment.provider_call_count == 1
    assert_receive {:provider_request, _}
    refute_receive {:provider_request, _}, 10
  end

  test "B29 CP1：同名歧义不猜 → 纠错为 ask_author；设计新主角仍走 character_design" do
    author = "有两个沈砚，一个是查账人老沈，一个是学徒小沈。把沈砚指定为主角。"

    prompt_input =
      input(capabilities: ["revise_character_profile", "character_design"])
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
                     "author_reasoning" => "绑定"
                   })
                 ]),
                 response("", [
                   call("ask_author", %{
                     "question" => "你指的是哪个沈砚？",
                     "options" => [
                       %{
                         "label" => "老沈（查账人）",
                         "value" => "老沈（查账人）"
                       },
                       %{
                         "label" => "小沈（学徒）",
                         "value" => "小沈（学徒）"
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
      input(capabilities: ["revise_character_profile", "character_design"])
      |> Map.put(:author_text, design_author)

    assert {:ok, design} =
             JudgmentProtocol.request_judgment(
               execution([
                 response("", [
                   call("judgment_decision", %{
                     "action" => "execute",
                     "capability" => "character_design",
                     "dialogue_goal" => design_author,
                     "author_reasoning" => "设计新角色"
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

    refute Enum.any?(
             messages,
             &String.contains?(message_text(&1), "action_intent_requires_execute")
           )

    refute_receive {:provider_request, _}, 10
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
    assert validation_text(List.last(corrected.messages)) =~ "discussion_only_violation"
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

    refute Enum.any?(
             messages,
             &String.contains?(message_text(&1), "action_intent_requires_execute")
           )

    refute_receive {:provider_request, _}, 10
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
        "author_reasoning" => "章级修订",
        "target_chapter_ref" => "chapter:real03",
        "modification_scope" => "target_segments"
      })

    good =
      call("judgment_decision", %{
        "action" => "execute",
        "capability" => "revise_adopted_content",
        "adopted_content_ref" => "as_chapter_three",
        "dialogue_goal" => author,
        "author_reasoning" => "按作者指定的第一段范围修订"
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

    correction =
      corrected.messages
      |> List.last()
      |> Map.fetch!(:blocks)
      |> Enum.find(&(&1.type == "validation_result"))
      |> Map.fetch!(:detail)
      |> Map.fetch!("message")

    assert correction =~ "未允许字段："
    assert correction =~ "target_chapter_ref"
    assert correction =~ "modification_scope"
    assert correction =~ "内容修订的 execute 必须用 adopted_content_ref"
    assert correction =~ "范围（第一段/整章/仅排版）写在 dialogue_goal"
    assert correction =~ "不要填 target_chapter_ref/modification_scope"
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
        "author_reasoning" => "章级修订",
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
    correction = validation_text(List.last(corrected.messages))
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
    refute Enum.any?(messages, &String.contains?(message_text(&1), "capability_required"))

    refute Enum.any?(
             messages,
             &String.contains?(message_text(&1), "action_intent_requires_execute")
           )

    refute Map.has_key?(judgment, :wrong_route)
    refute_receive {:provider_request, _}, 10
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
                     "author_reasoning" => "按章计划生成首稿"
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
                     "author_reasoning" => "角色候选"
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
                     "author_reasoning" => "局部修订"
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

    assert {:error, {:judgment_protocol_violation, :discussion_only_violation}, _state} =
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

  # B71：判断请求直接消费 canonical IR；不再保留旧 prompt/prompt_ir 旁路。
  describe "B71：IR 生产探针" do
    test "IR 判断请求保留任务上下文，确定性 provider 仍进入计划协议" do
      input =
        input()
        |> Map.put(:author_text, "请按另行起草计划设计一个角色，再设计相关世界设定。")

      prompt = JudgmentProtocol.request_for_production(input)

      assert prompt.ir_version == RequestIR.ir_version()
      assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %{})
      assert [%{"name" => "agent_plan_draft", "arguments" => arguments}] = result.tool_calls
      assert is_list(arguments.plan.steps)
      assert arguments.author_reasoning != ""
      assert result.content in [nil, ""]
      refute Map.has_key?(arguments, :dialogue_goal)
    end

    test "IR 判断请求保留角色设计执行路由" do
      assert_ir_execute_route("先看看现有角色阵容，然后设计一个反派", "character_design")
    end

    test "IR 判断请求保留正文写作执行路由" do
      assert_ir_execute_route("写下一章", "prose_writing")
    end

    test "真实 protocol_input 的 IR 请求保留角色设计执行路由" do
      author_text = "先看看现有角色阵容，然后设计一个反派"

      {:ok, run} =
        AgentRun.new(%{
          run_id: "run-ir-probe",
          workspace_id: "workspace-ir-probe",
          origin_frame_ref: "frame-ir-probe",
          profile_ref: "judgment_loop_v1",
          parent_turn_ref: "turn-ir-probe",
          work_id: "work-ir-probe",
          session_id: "session-ir-probe",
          goal: %{text: author_text, version: 1},
          authority_scope: %{
            production_write: false,
            allowed_tools: ["judgment", "character_design"]
          }
        })

      protocol_input =
        DialoguePlanningService.judgment_protocol_input_for_test(
          %{text: author_text},
          run,
          %NovelDomain.DialogueContext{work_id: "work-ir-probe"},
          []
        )

      prompt = JudgmentProtocol.request_for_production(protocol_input)

      assert prompt.ir_version == RequestIR.ir_version()
      assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %{})
      assert [call] = result.tool_calls
      arguments = Map.get(call, "arguments") || Map.get(call, :arguments)
      assert Map.get(arguments, "action") == "execute"
      assert Map.get(arguments, "capability") == "character_design"

      assert {:ok, stub_result} = Stub.complete(nil, nil, prompt, %{})
      assert [stub_call] = stub_result.tool_calls
      assert stub_call.name == "judgment_decision"
      assert stub_call.arguments.action == "execute"
      assert stub_call.arguments.capability == "character_design"
    end

    defp assert_ir_execute_route(author_text, capability) do
      prompt =
        input()
        |> Map.put(:author_text, author_text)
        |> JudgmentProtocol.request_for_production()

      assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %{})
      assert [call] = result.tool_calls
      arguments = Map.get(call, "arguments") || Map.get(call, :arguments)
      action = Map.get(arguments, "action") || Map.get(arguments, :action)
      actual_capability = Map.get(arguments, "capability") || Map.get(arguments, :capability)
      assert action == "execute"
      assert actual_capability == capability
    end
  end

  defp message_text(%{blocks: _blocks} = message),
    do: NovelApplication.TestAgenticLoopFixtures.message_text(message)

  # 判断规则在 canonical system instructions，应用数据在 native Scope：
  # 文本断言必须读与 provider 同源的完整投影视图，而不是只看第一条消息。
  defp first_text(ir), do: NovelTest.TestProviderPrompt.text(ir)

  # 协议纠错事实既可能是 tool 原生 validation_result，也可能是无 pending call 时的
  # application_notice 文本消息；两种形态都从实际请求消息读取，不合成内容。
  defp validation_text(message) do
    validation =
      for block <- Map.get(message, :blocks, []),
          Map.get(block, :type) == "validation_result",
          into: "",
          do: Jason.encode!(block)

    message_text(message) <> validation
  end
end
