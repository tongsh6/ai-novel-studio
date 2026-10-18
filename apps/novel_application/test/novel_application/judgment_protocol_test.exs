defmodule NovelApplication.JudgmentProtocolTest do
  @moduledoc """
  判断①协议解析的业务规则单测（ADR-0025 CP1）。

  锚定兜底候选语义的协议侧前提：候选结构坏了不丢探索意图
  （`candidate_directions_present`），由消费层降级为应用兜底候选。
  端到端降级行为由场景验收 au02-candidate-fallback-ui 驱动真实页面证明。
  """
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.JudgmentProtocol
  alias NovelApplication.TurnInteractionService
  alias NovelCommon.Contracts.ProviderOutput

  @narrative "你想探索方向；我先给你两个候选切入。"

  defp fake_execution(decision_arguments) do
    decision_arguments = Map.put_new(decision_arguments, "record_only", false)

    %Execution{
      result_fn: fn prompt ->
        text = prompt_text(prompt)

        if String.contains?(text, JudgmentProtocol.tool_name()) do
          {:ok,
           %{
             content: "",
             tool_calls: [
               %{name: JudgmentProtocol.tool_name(), arguments: decision_arguments}
             ],
             provider_output: provider_output("")
           }}
        else
          {:ok,
           %{
             content: @narrative,
             provider_output: provider_output(@narrative)
           }}
        end
      end
    }
  end

  defp provider_output(text) do
    %ProviderOutput{
      provider_run_ref: "prun-test",
      provider_call_ref: "pcall-test",
      status: :ok,
      content: %{text: text}
    }
  end

  defp prompt_text(%{messages: messages}) do
    Enum.map_join(messages, "\n", fn m -> m[:content] || m["content"] || "" end)
  end

  defp prompt_text(prompt) when is_binary(prompt), do: prompt
  defp prompt_text(_), do: ""

  defp request(arguments, options \\ []) do
    JudgmentProtocol.request_judgment(fake_execution(arguments), %{}, %{
      author_text: "想写赛博修仙，给我几个方向",
      context_block: "（无上下文）",
      options: options
    })
  end

  test "历史原文引用只允许当前上下文来源" do
    args = %{
      "action" => "reply",
      "reply_included" => true,
      "frame_type" => "capability_gap",
      "author_content_registration" => true,
      "author_content_source_ref" => "previous-author-turn"
    }

    assert {:ok, judgment} = request(args, author_content_sources: ["previous-author-turn"])
    assert judgment.author_content_source_ref == "previous-author-turn"
    assert {:error, _} = request(args, author_content_sources: ["another-turn"])
  end

  test "已有候选操作必须绑定当前可操作对象，纠正后才可执行" do
    bad = %{
      "action" => "execute",
      "capability" => "revise_pending_artifact",
      "pending_artifact_ref" => "foreign"
    }

    opts = [
      capabilities: ["revise_pending_artifact"],
      pending_artifact_targets: %{"actual" => ["revise_pending_artifact"]}
    ]

    assert {:error, {:pending_artifact_invalid, :target_not_available}} = request(bad, opts)

    assert {:ok, %{pending_artifact_ref: "actual", provider_call_count: 3}} =
             request_with_retry(
               bad,
               Map.merge(bad, %{
                 "pending_artifact_ref" => "actual",
                 "author_narrative" => "我会修订已确认的这份候选，原稿保留。"
               }),
               opts
             )

    clarified = %{"action" => "await_author", "author_narrative" => "请指明需要修改哪份候选。"}
    assert {:ok, result} = request_with_retry(bad, clarified, opts)
    assert result.action == "await_author"
    assert result.narrative == clarified["author_narrative"]
  end

  test "同来源已有候选不重复登记，纠正回复必须来自新的模型输出" do
    bad = %{
      "action" => "reply",
      # 实模同时给错呈现帧和重复登记信号；必须先按真实状态纠正，不能耗尽机会只修帧。
      "frame_type" => "meta_discussion",
      "author_content_registration" => true,
      "author_content_source_ref" => "original"
    }

    opts = [author_content_sources: ["original"], registered_sources: ["original"]]

    assert {:error, {:author_content_registration_invalid, :already_materialized}} =
             request(bad, opts)

    corrected = "这份资料已有待采纳候选，无需重新登记；可以说明修改要求或放弃现有候选。"

    good =
      Map.merge(bad, %{
        "author_content_registration" => false,
        "frame_type" => "question_answer",
        "author_narrative" => corrected
      })

    assert {:ok, result} = request_with_retry(bad, good, opts)
    assert result.narrative == corrected
    assert result.narrative_source.source_type == "provider_output_tool_narrative"
    refute result.author_content_registration
    assert_receive {:retry_prompt, prompt}
    assert prompt =~ "关闭 author_content_registration"
  end

  test "仅记录约束拒绝任何方向、原文物化或执行，不能因候选非空改判探索" do
    base = %{"action" => "reply", "frame_type" => "meta_discussion", "record_only" => true}
    assert {:ok, %{record_only: true, candidate_directions: []}} = request(base)

    conflicts = [
      %{"candidate_directions" => [%{"title" => "角色展开", "pitch" => "展开角色背景"}]},
      %{"frame_type" => "creative_exploration"},
      %{"author_content_registration" => true, "author_content_source_ref" => "current"},
      %{"action" => "execute", "capability" => "world_building"},
      %{"action" => "plan"},
      %{"action" => "await_author"}
    ]

    for conflict <- conflicts do
      assert {:error, {:judgment_output_conflict, :record_only_conflict}} =
               request(Map.merge(base, conflict))
    end
  end

  test "流程建议不能通过普通或缺口帧获得方向动作，纠正后不改写模型叙事" do
    for frame <- ["capability_gap", "question_answer", "meta_discussion", nil] do
      bad = %{
        "action" => "reply",
        "frame_type" => frame,
        "candidate_directions" => [%{"title" => "丢弃候选", "pitch" => "放弃这份资料"}]
      }

      assert {:error, {:judgment_output_conflict, :candidate_purpose_conflict}} = request(bad)
      good = Map.put(bad, "candidate_directions", [])
      assert {:ok, result} = request_with_retry(bad, good, [])
      assert result.candidate_directions == []
      assert result.frame_type == frame
      assert result.narrative == @narrative
      assert result.provider_call_count == 3
      assert_receive {:retry_prompt, prompt}
      assert prompt =~ "不得仅更改 frame_type 或 record_only"
    end
  end

  test "record_only 必须明确判断，缺字段或非布尔值不能默认成允许产出" do
    for value <- [nil, "false", 0] do
      assert {:error, {:judgment_output_conflict, :record_only_required}} =
               request(%{"action" => "reply", "record_only" => value})
    end

    assert {:error, {:judgment_output_conflict, :record_only_required}} =
             JudgmentProtocol.validate_output_boundary(%{action: "reply"})
  end

  test "作者后续主动展开不受上一轮仅记录约束，正常创作方向仍可输出" do
    args = %{
      "action" => "reply",
      "frame_type" => "creative_exploration",
      "record_only" => false,
      "candidate_directions" => [%{"title" => "记忆交易", "pitch" => "主角用童年记忆换取姐姐线索"}]
    }

    assert {:ok, %{candidate_directions: [_], frame_type: "creative_exploration"}} = request(args)
  end

  test "重试不能通过放宽 record_only 或改帧类别让原有矛盾候选过关" do
    candidates = [%{"title" => "丢弃候选", "pitch" => "放弃资料"}]

    bad = %{
      "action" => "reply",
      "record_only" => true,
      "frame_type" => "creative_exploration",
      "candidate_directions" => candidates
    }

    assert {:error, {:judgment_output_conflict, :record_only_conflict}} =
             request_with_retry(bad, Map.put(bad, "record_only", false), [])

    bad = Map.merge(bad, %{"record_only" => false, "frame_type" => "capability_gap"})

    assert {:error, {:judgment_output_conflict, :candidate_purpose_conflict}} =
             request_with_retry(bad, Map.put(bad, "frame_type", "creative_exploration"), [])
  end

  test "未启用原文登记时清空不参与决策的来源字段，不阻断普通回复" do
    for source <- ["null", "another-work-turn", %{unexpected: true}],
        registration <- [false, nil] do
      args = %{
        "action" => "reply",
        "frame_type" => "meta_discussion",
        "reply_included" => true,
        "author_content_registration" => registration,
        "author_content_source_ref" => source
      }

      assert {:ok, judgment} = request(args)
      assert judgment.action == "reply"
      refute judgment.author_content_registration
      assert judgment.author_content_source_ref == nil
      assert judgment.provider_call_count == 2
    end
  end

  test "启用原文登记后占位字符串或错误类型仍是非法来源，重试不能放过" do
    for source <- [nil, "null", "", " ", %{unexpected: true}] do
      assert {:error, {:author_content_registration_invalid, _}} =
               request(%{
                 "action" => "reply",
                 "frame_type" => "capability_gap",
                 "reply_included" => true,
                 "author_content_registration" => true,
                 "author_content_source_ref" => source
               })
    end
  end

  test "原文登记与 execute/plan/explore/await_author 或其它回复形态互斥" do
    base = %{
      "action" => "reply",
      "frame_type" => "capability_gap",
      "author_content_registration" => true,
      "author_content_source_ref" => "current"
    }

    for action <- ["execute", "plan", "explore", "await_author"] do
      args =
        Map.merge(base, %{
          "action" => action,
          "capability" => "world_building",
          "explore_request" => %{"tool" => "archive_read", "query" => "rules"}
        })

      assert {:error, {:author_content_registration_invalid, :operation_conflict}} =
               request(args,
                 explore: true,
                 explore_tools: ["archive_read"],
                 capabilities: ["world_building"]
               )
    end

    for frame <- [nil, "casual_reply", "question_answer"] do
      assert {:error, {:author_content_registration_invalid, :operation_conflict}} =
               request(Map.put(base, "frame_type", frame))
    end
  end

  test "登记错误的纠正提示带具体约束，纠正后保留真实来源" do
    good = %{
      "action" => "reply",
      "frame_type" => "capability_gap",
      "author_content_registration" => true,
      "author_content_source_ref" => "original"
    }

    missing = Map.delete(good, "author_content_source_ref")

    assert {:ok, judgment} =
             request_with_retry(missing, good, author_content_sources: ["original"])

    assert judgment.author_content_source_ref == "original"
    assert judgment.provider_call_count == 3
    assert_receive {:retry_prompt, prompt}
    assert prompt =~ "author_content_source_ref 必填"
    assert prompt =~ "current / original"

    conflict = Map.merge(good, %{"action" => "execute", "capability" => "world_building"})

    assert {:ok, %{action: "reply"}} =
             request_with_retry(conflict, good,
               capabilities: ["world_building"],
               author_content_sources: ["original"]
             )

    assert_receive {:retry_prompt, prompt}
    assert prompt =~ "只能搭配 action=reply"
  end

  test "两阶段消费同一份原文登记/采纳业务规则，不把原文登记强制映射为创作执行" do
    input = %{author_text: "保存我的原文", context_block: "", options: []}
    rule = TurnInteractionService.author_registration_rules() |> String.trim()
    narrative = JudgmentProtocol.narrative_prompt(input) |> prompt_text()
    decision = JudgmentProtocol.decision_prompt(input, @narrative) |> prompt_text()
    assert narrative =~ rule
    assert decision =~ rule
    refute narrative =~ "还没有候选时按单动作执行"
    refute narrative =~ "永远不要声称"
    refute decision =~ "仅此一种情况 action=reply"
  end

  # call2 首轮返回 first_arguments、重试轮返回 retry_arguments；重试轮 prompt
  # 回发测试进程供断言（矛盾提示确实注入）。
  defp request_with_retry(first_arguments, retry_arguments, options) do
    {:ok, counter} = Agent.start_link(fn -> 0 end)
    parent = self()

    execution = %Execution{
      result_fn: fn prompt ->
        text = prompt_text(prompt)

        if String.contains?(text, JudgmentProtocol.tool_name()) do
          n = Agent.get_and_update(counter, fn n -> {n, n + 1} end)
          if n > 0, do: send(parent, {:retry_prompt, text})
          arguments = if n == 0, do: first_arguments, else: retry_arguments
          arguments = Map.put_new(arguments, "record_only", false)

          {:ok,
           %{
             content: "",
             tool_calls: [%{name: JudgmentProtocol.tool_name(), arguments: arguments}],
             provider_output: %{
               provider_output("")
               | content: %{
                   text: "",
                   tool_calls: [%{name: JudgmentProtocol.tool_name(), arguments: arguments}]
                 }
             }
           }}
        else
          {:ok, %{content: @narrative, provider_output: provider_output(@narrative)}}
        end
      end
    }

    JudgmentProtocol.request_judgment(execution, %{}, %{
      author_text: "把我的大纲存档",
      context_block: "（无上下文）",
      options: options
    })
  end

  test "explore_request 归一：tool+query 齐全成立，任一缺失为 nil（不猜）" do
    assert {:ok, judgment} =
             request(
               %{
                 "action" => "explore",
                 "reason" => "missing_facts",
                 "explore_request" => %{"tool" => "prose_search", "query" => "灵气账单"}
               },
               explore: true
             )

    assert judgment.action == "explore"
    assert judgment.explore_request == %{tool: "prose_search", query: "灵气账单"}

    assert {:ok, missing_query} =
             request(
               %{
                 "action" => "explore",
                 "reason" => "missing_facts",
                 "explore_request" => %{"tool" => "prose_search", "query" => "  "}
               },
               explore: true
             )

    assert missing_query.explore_request == nil

    assert {:ok, absent} = request(%{"action" => "reply", "reason" => "ok"})
    assert absent.explore_request == nil
  end

  test "capability 目录约束（M0 狗粮缺陷回归）：execute 越界重试后诚实失败，plan 不连坐，enum 进 schema" do
    capabilities = ~w(prose_writing character_design)

    # execute + 目录外能力名 → 重试仍坏 → S7 诚实失败（不放行到 dispatch）
    assert {:error, {:judgment_decision_unparseable, _frag}} =
             request(
               %{"action" => "execute", "reason" => "go", "capability" => "text_generation"},
               capabilities: capabilities
             )

    # execute + 目录内能力名 → 通过
    assert {:ok, ok_judgment} =
             request(
               %{"action" => "execute", "reason" => "go", "capability" => "prose_writing"},
               capabilities: capabilities
             )

    assert ok_judgment.capability == "prose_writing"

    # plan + 占位能力名（live 实测形态）→ 不连坐（dispatch 忽略 plan 的 capability）
    assert {:ok, plan_judgment} =
             request(
               %{"action" => "plan", "reason" => "multi", "capability" => "planning"},
               capabilities: capabilities
             )

    assert plan_judgment.action == "plan"

    # execute + capability=null 同样越界（M2 缺陷八：null 洞——execute 必填）
    assert {:error, {:judgment_decision_unparseable, _}} =
             request(
               %{"action" => "execute", "reason" => "go", "capability" => nil},
               capabilities: capabilities
             )

    # 目录未传入 → 保持向后兼容不拦
    assert {:ok, _} =
             request(%{
               "action" => "execute",
               "reason" => "go",
               "capability" => "text_generation"
             })
  end

  test "Q3a 语义对账（D8 存档五连击回归）：execute+只读能力+写入 reason 拦截重试，改正放行，仍矛盾诚实失败" do
    opts = [
      capabilities: ~w(world_building work_archive_read),
      readonly_capabilities: ~w(work_archive_read)
    ]

    # D8 stage 真实 reason 原话形态：理解对（要写入）、动作反（选只读）→ 拦截并
    # 携带矛盾说明重试；重试轮 provider 改判 reply → 放行。
    assert {:ok, corrected} =
             request_with_retry(
               %{
                 "action" => "execute",
                 "capability" => "work_archive_read",
                 "reason" => "把《诸天之上》完整大纲作为作品设定实际写入档案"
               },
               %{
                 "action" => "reply",
                 "reason" => "引导作者采纳待采纳候选",
                 "frame_type" => "meta_discussion"
               },
               opts
             )

    assert corrected.action == "reply"
    assert_received {:retry_prompt, retry_text}
    assert retry_text =~ "语义对账"
    assert retry_text =~ "work_archive_read"

    # 重试仍矛盾 → S7 家族诚实失败（不放行只读调用冒充写入）
    assert {:error, {:judgment_semantic_conflict, frag}} =
             request(
               %{
                 "action" => "execute",
                 "capability" => "work_archive_read",
                 "reason" => "正式保存进作品档案"
               },
               opts
             )

    assert frag =~ "work_archive_read"

    # 只读能力 + 只读措辞 reason → 不拦
    assert {:ok, _} =
             request(
               %{
                 "action" => "execute",
                 "capability" => "work_archive_read",
                 "reason" => "读取档案核对既有设定"
               },
               opts
             )

    # 可写能力 + 写入 reason → 不拦（能力本可写，写入正是本分）
    assert {:ok, _} =
             request(
               %{
                 "action" => "execute",
                 "capability" => "world_building",
                 "reason" => "把大纲保存为设定候选"
               },
               opts
             )

    # readonly 集未传 → 向后兼容不拦
    assert {:ok, _} =
             request(
               %{
                 "action" => "execute",
                 "capability" => "work_archive_read",
                 "reason" => "写入档案"
               },
               capabilities: ~w(work_archive_read)
             )
  end

  test "capability_gap 保留诚实缺口回复，流程建议不得成为创作方向" do
    assert {:ok, judgment} =
             request(%{
               "action" => "reply",
               "reason" => "author_intent_lacks_capability",
               "frame_type" => "capability_gap",
               "dialogue_goal" => "把作者提供的内容登记进作品档案",
               "candidate_directions" => []
             })

    assert judgment.action == "reply"
    assert judgment.frame_type == "capability_gap"
    assert judgment.candidate_directions == []
  end

  test "call2 prompt 注入目录（T4 M2 误路由回归）：传目录时列出实名，未传保持旧措辞" do
    # M2 实锤（2026-07-20）：目录只放 schema enum（anyOf 内层）对模型不可见，
    # 全天 15 次首调 0 命中（自造名/null/被约束解码顶替成任意合法值）；顶替值
    # 合法导致越界重试网被绕过。目录名必须出现在 call2 prompt 正文里。
    input = %{
      author_text: "接着写正文",
      options: [
        explore: true,
        capabilities: ~w(character_design prose_writing),
        explore_tools: ~w(prose_search chapter_read)
      ]
    }

    text = input |> JudgmentProtocol.decision_prompt(@narrative) |> prompt_text()

    assert text =~ "capability 只能取 character_design / prose_writing，不得自造能力名"
    assert text =~ "tool 只能取 prose_search / chapter_read，不得自造工具名"

    bare_text =
      %{author_text: "接着写正文", options: []}
      |> JudgmentProtocol.decision_prompt(@narrative)
      |> prompt_text()

    assert bare_text =~ "capability 填能力目录中的能力名（只能取目录名）"
    assert bare_text =~ "tool 从「探索目录」选择"
  end

  test "call2 schema 要求 provider 明确给出 reply frame 语义" do
    prompt =
      JudgmentProtocol.decision_prompt(
        %{author_text: "为什么这一章张力不足？", options: []},
        @narrative
      )

    [%{input_schema: schema}] = prompt.tools

    assert "frame_type" in schema.required
    assert "dialogue_goal" in schema.required

    frame_type_schema = schema.properties.frame_type

    assert %{type: "string", enum: frame_types} =
             Enum.find(frame_type_schema.anyOf, &(&1[:type] == "string"))

    assert frame_types ==
             ~w(casual_reply creative_exploration question_answer meta_discussion capability_gap)
  end

  test "call2 回显双端保留（M2 达标跑缺陷回归）：长叙事保头尾，结论不被剪，短叙事原样" do
    # M2 实锤（2026-07-21）：扩章批摘要变长后 call1 叙事超 240 字符，旧头部截断
    # 剪掉尾部"单动作执行"结论 → call2 只见意图复述误判 reply（97/112 次重试）。
    head = String.duplicate("述", 300)
    conclusion = "因此本轮判定为单动作执行。"
    long_narrative = head <> conclusion

    text =
      %{author_text: "写第21章", options: []}
      |> JudgmentProtocol.decision_prompt(long_narrative)
      |> prompt_text()

    assert text =~ String.duplicate("述", 120)
    assert text =~ "…（中略）…"
    assert text =~ conclusion
    refute text =~ String.duplicate("述", 121)

    short_narrative = "判断说明很短。判定为直接回复。"

    short_text =
      %{author_text: "写第21章", options: []}
      |> JudgmentProtocol.decision_prompt(short_narrative)
      |> prompt_text()

    assert short_text =~ short_narrative
    refute short_text =~ "（中略）"
  end

  test "explore 工具目录约束（judgment-explore-internal 场景验收实测缺陷回归）：目录外工具名重试后诚实失败，enum 进 schema" do
    tools = ~w(prose_search chapter_read archive_read memory_recall)

    # explore + 目录外工具名（live 实测形态："text_search" 不存在）→ 重试仍坏 → 诚实失败
    assert {:error, {:judgment_decision_unparseable, _frag}} =
             request(
               %{
                 "action" => "explore",
                 "reason" => "need_facts",
                 "explore_request" => %{"tool" => "text_search", "query" => "灵气账单"}
               },
               explore: true,
               explore_tools: tools
             )

    # explore + 目录内工具名 → 通过
    assert {:ok, ok_judgment} =
             request(
               %{
                 "action" => "explore",
                 "reason" => "need_facts",
                 "explore_request" => %{"tool" => "prose_search", "query" => "灵气账单"}
               },
               explore: true,
               explore_tools: tools
             )

    assert ok_judgment.explore_request == %{tool: "prose_search", query: "灵气账单"}

    # 非 explore action 不连坐（目录校验只管 explore）
    assert {:ok, reply_judgment} =
             request(
               %{"action" => "reply", "reason" => "ok"},
               explore: true,
               explore_tools: tools
             )

    assert reply_judgment.action == "reply"

    # 目录未传入 → 保持向后兼容不拦（与 capability 同款语义）
    assert {:ok, _} =
             request(
               %{
                 "action" => "explore",
                 "reason" => "need_facts",
                 "explore_request" => %{"tool" => "text_search", "query" => "灵气账单"}
               },
               explore: true
             )
  end

  test "正常候选列表：解析为候选，present 为真" do
    {:ok, judgment} =
      request(%{
        "action" => "reply",
        "frame_type" => "creative_exploration",
        "reply_included" => true,
        "candidate_directions" => [
          %{"title" => "矛盾切入", "pitch" => "从冲突进入", "tone_tags" => ["冲突"]}
        ]
      })

    assert judgment.action == "reply"
    assert [%{"title" => "矛盾切入"}] = judgment.candidate_directions
    assert judgment.candidate_directions_present
  end

  test "坏候选结构（对象而非数组）：候选归空但探索意图不丢" do
    {:ok, judgment} =
      request(%{
        "action" => "reply",
        "frame_type" => "creative_exploration",
        "reply_included" => true,
        "candidate_directions" => %{"title" => "", "pitch" => ""}
      })

    assert judgment.candidate_directions == []
    assert judgment.candidate_directions_present
  end

  test "无候选字段：候选为空且无探索意图" do
    {:ok, judgment} = request(%{"action" => "reply", "reply_included" => true})

    assert judgment.candidate_directions == []
    refute judgment.candidate_directions_present
  end

  test "reply frame type 与 dialogue goal 从判断结构原样归一" do
    assert {:ok, judgment} =
             request(%{
               "action" => "reply",
               "reason" => "answer_author_question",
               "reply_included" => true,
               "frame_type" => "question_answer",
               "dialogue_goal" => "解释胜利过轻削弱张力的原因"
             })

    assert judgment.frame_type == "question_answer"
    assert judgment.dialogue_goal == "解释胜利过轻削弱张力的原因"

    assert {:ok, invalid} =
             request(%{
               "action" => "reply",
               "reason" => "bad_frame",
               "frame_type" => "execution_candidate",
               "dialogue_goal" => "  "
             })

    assert invalid.frame_type == nil
    assert invalid.dialogue_goal == nil
  end
end
