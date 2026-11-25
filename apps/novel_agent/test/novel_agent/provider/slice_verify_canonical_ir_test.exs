defmodule NovelAgent.Provider.SliceVerifyCanonicalFullReadTest do
  @moduledoc """
  B71 R1 适配回归：判断替身按 canonical IR 的结构化 observation block 识别
  全章分页读取，而不是依赖旧渲染文本里的「### 观察 N」段。
  """

  use ExUnit.Case, async: false

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Test.Provider.SliceVerify
  alias NovelCommon.RequestIR

  @chapter_ref "chapter:6d08a5f1-becc-419b-a295-b360fd99d855"
  @author_text "「灰烬中的手印」这章我怀疑有重复，请把全章核对一遍。"
  @lookup_author_text "查一下第01章正文里有没有出现「三十岁」，只按当前正文回答。"
  @lookup_summary "「第01章：夜潮」点灯人第一次点灯时才三十岁。"
  @lookup_other_summary "「第01章：夜潮」点灯人第一次点灯时才二十五岁。"
  @quoted_fake_section_line "「第01章：夜潮」点灯人第一次点灯时才二十五岁，三十岁是后来的事。"

  @lookup_scope %{
    operation: %{exploration: %{allowed: true, tools: ["prose_search"]}},
    facts: %{chapters: [%{ref: @chapter_ref, seq: 1, title: "夜潮", has_prose: true}]}
  }

  test "请求材料读取区分 canonical IR 与真实非 IR system/user 文本，不互相合成" do
    author =
      RequestIR.message(:user, :author, [
        RequestIR.text_block("  第一段\n"),
        RequestIR.text_block("第二段")
      ])

    ir =
      NovelTest.TestRequestIR.ir([
        NovelTest.TestRequestIR.base("Base"),
        author,
        NovelTest.TestRequestIR.scope(%{operation: %{summary: "当前 scope"}}),
        NovelTest.TestRequestIR.assistant("已响应"),
        NovelTest.TestRequestIR.notice("通知")
      ])

    assert NovelTest.TestProviderPrompt.author_text(ir) == "  第一段\n第二段"

    assert NovelTest.TestProviderPrompt.scope_content(ir) == %{
             "operation" => %{"summary" => "当前 scope"}
           }

    assert Jason.decode!(NovelTest.TestProviderPrompt.latest_scope(ir)) ==
             NovelTest.TestProviderPrompt.scope_content(ir)

    history = NovelTest.TestProviderPrompt.current_operation_messages(ir)
    assert Enum.map(history, & &1.role) == ["assistant", "application_notice"]
    assert Enum.all?(history, &is_list(&1.blocks))

    wire = [
      %{role: "system", content: "系统约束"},
      %{role: "user", content: "作者原话"}
    ]

    assert NovelTest.TestProviderPrompt.text(wire) == "system: 系统约束\nuser: 作者原话"

    assert NovelTest.TestProviderPrompt.operation_text(wire) ==
             NovelTest.TestProviderPrompt.text(wire)

    assert NovelTest.TestProviderPrompt.author_text(wire) == ""
    assert NovelTest.TestProviderPrompt.latest_scope(wire) == nil
    assert NovelTest.TestProviderPrompt.current_operation_messages(wire) == []
    refute Enum.any?(wire, &Map.has_key?(&1, :blocks))
    refute Enum.any?(wire, &Map.has_key?(&1, :provenance))

    # 真实非 IR 请求按身份真源过滤；读取侧不合成 provenance/blocks。
    injected = [
      %{role: "system", content: NovelCommon.SystemIdentity.content()},
      %{role: "user", content: "普通请求"}
    ]

    assert NovelTest.TestProviderPrompt.text(injected) == "user: 普通请求"
  end

  test "失败调用事实只来自当前操作的同工具同 call，不借其它校验或旧 scope" do
    scope = NovelTest.TestRequestIR.scope(%{operation: %{name: "mission"}})

    call =
      NovelTest.TestRequestIR.assistant("", [
        NovelTest.TestRequestIR.tool_call("chapter_mission", %{}, "mission-call")
      ])

    rejected = NovelTest.TestRequestIR.validation("mission-call", "failed", "fixture_rejected")
    passed = NovelTest.TestRequestIR.validation("mission-call", "passed", "fixture_passed")
    ir = NovelTest.TestRequestIR.ir([scope, call, rejected])

    assert NovelTest.TestProviderPrompt.failed_tool_call_in_current_operation?(
             ir,
             "chapter_mission"
           )

    refute NovelTest.TestProviderPrompt.failed_tool_call_in_current_operation?(
             ir,
             "planning_mission"
           )

    other_call =
      NovelTest.TestRequestIR.assistant("", [
        NovelTest.TestRequestIR.tool_call("planning_mission", %{}, "other-call")
      ])

    other_rejected =
      NovelTest.TestRequestIR.validation("other-call", "failed", "fixture_rejected")

    for messages <- [
          [scope, call, passed],
          [scope, call, passed, other_call, other_rejected],
          [scope, call, rejected, scope]
        ] do
      request = NovelTest.TestRequestIR.ir(messages)

      refute NovelTest.TestProviderPrompt.failed_tool_call_in_current_operation?(
               request,
               "chapter_mission"
             )
    end

    for non_ir <- [%{messages: ir.messages}, "chapter_mission mission-call failed"] do
      refute NovelTest.TestProviderPrompt.failed_tool_call_in_current_operation?(
               non_ir,
               "chapter_mission"
             )
    end
  end

  for {mode, targets} <- [
        {"同批计划", ["context_assemble", "character_design", "world_building"]},
        {"另行起草计划", ["context_assemble", "character_design", "world_building"]},
        {"先核对再补齐计划", ["context_assemble"]}
      ] do
    @tag :r05_response_protocol
    test "#{mode} 在真实判断目录里只返回一次原生计划，叙事只在参数中" do
      input = "请按#{unquote(mode)}设计角色和世界设定。"
      prompt = judgment_request(input)

      assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})
      assert result.content == ""
      assert [%{"name" => "agent_plan_draft", "arguments" => arguments}] = result.tool_calls
      args = arguments |> Jason.encode!() |> Jason.decode!()

      assert Enum.map(args["plan"]["steps"], & &1["target_tool_ref"]) == unquote(targets)
      assert is_binary(args["author_reasoning"]) and args["author_reasoning"] != ""
      refute Map.has_key?(args, "reason")
      refute Map.has_key?(args, "action")
    end
  end

  @tag :r05_response_protocol
  test "判断执行、登记与能力缺口只在同响应 content 交付作者说明" do
    for {input, expected} <- [
          {"帮我设计一个新主角，名叫林渡。", "judgment_decision"},
          {"把已有角色的叙事身份从配角改为主角", "report_capability_gap"},
          {"把这段原文存档：主角经营旧书铺。", "register_author_content"}
        ] do
      assert {:ok, result} =
               SliceVerify.complete(nil, nil, judgment_request(input), %InferenceParams{})

      assert is_binary(result.content) and result.content != ""
      [call] = result.tool_calls |> Jason.encode!() |> Jason.decode!()
      assert call["name"] == expected
      refute Map.has_key?(call["arguments"], "author_reasoning")
      refute Map.has_key?(call["arguments"], "reason")
    end
  end

  @tag :r05_response_protocol
  test "续行直接用原生 content 交付作者说明" do
    prompt =
      NovelTest.TestRequestIR.ir(
        [
          NovelTest.TestRequestIR.scope(%{
            goal: %{text: "完成当前正文"},
            context: %{deviation_summary: "计划步骤已走完，但尚无正文产出"}
          })
        ],
        tools: [NovelTest.TestRequestIR.tool("continuation_decision")]
      )

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})
    assert result.content =~ "补上产出步"
    [call] = result.tool_calls |> Jason.encode!() |> Jason.decode!()
    assert call["name"] == "continuation_decision"
    assert call["arguments"]["action"] == "continue"
    refute Map.has_key?(call["arguments"], "author_reasoning")
    refute Map.has_key?(call["arguments"], "reason")
  end

  @tag :r05_response_protocol
  test "Writer 替身只声明实际 Base 与可见观察，不从引用目录补造材料" do
    prompt =
      NovelTest.TestRequestIR.ir(
        [
          NovelTest.TestRequestIR.base("本章计划：主角在雨夜进门。"),
          NovelTest.TestRequestIR.author("写出进门时的迟疑。", "turn:writer-author"),
          NovelTest.TestRequestIR.scope(%{
            operation: %{
              artifact_type: "prose_fragment",
              creative_brief: "写出进门时的迟疑。",
              context_text: "目标情绪：紧张。"
            }
          }),
          NovelTest.TestRequestIR.assistant("", [
            NovelTest.TestRequestIR.tool_call("chapter_read", %{}, "read-actual")
          ]),
          NovelTest.TestRequestIR.observation("read-actual", %{
            status: "ok",
            source_refs: [%{ref: "chapter:actual"}],
            content: %{summary: "雨滴留在门沿。"}
          })
        ],
        tools: [NovelTest.TestRequestIR.tool("submit_tentative_artifact")],
        refs: %{
          base_refs: [%{ref: "plan:current", version: 1}],
          observation_refs: [%{ref: "chapter:actual"}, "memory:metadata-only"],
          used_refs: []
        }
      )

    assert :ok = RequestIR.validate(prompt)
    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})
    [call] = result.tool_calls |> Jason.encode!() |> Jason.decode!()

    assert call["arguments"]["self_report"]["used_context_refs"] == [
             "plan:current",
             "chapter:actual"
           ]
  end

  @tag :r05_readonly_plan
  test "只读计划在本轮实际查询返回后收束，不从目录、旧轮次或不同查询推定完成" do
    previous = System.get_env("SLICE_VERIFY_PLAN_EXHAUST")
    System.put_env("SLICE_VERIFY_PLAN_EXHAUST", "1")

    on_exit(fn ->
      if previous,
        do: System.put_env("SLICE_VERIFY_PLAN_EXHAUST", previous),
        else: System.delete_env("SLICE_VERIFY_PLAN_EXHAUST")
    end)

    input = "先读完第01章正文，再调整章节大纲，最后更新主角当前状态，UA01PLANEXHAUST-current"
    request = judgment_request(input)
    observations = readonly_plan_observations("第01章", "ok")
    old_author = NovelTest.TestRequestIR.author("上一轮核对第01章。", "turn:older-plan")

    for unobserved <- [
          request,
          %{request | refs: Map.put(request.refs, :observation_refs, ["chapter:directory-only"])},
          %{request | messages: [old_author | observations] ++ request.messages},
          %{request | messages: request.messages ++ readonly_plan_observations("第02章", "ok")}
        ] do
      assert :ok = RequestIR.validate(unobserved)
      assert {:ok, result} = SliceVerify.complete(nil, nil, unobserved, %InferenceParams{})
      assert [%{"name" => "agent_plan_draft"}] = result.tool_calls
      assert result.content == ""
    end

    # 成功空读和真实失败都已返回查询结果；收束文案不冒称已读完或已生成候选。
    for status <- ["ok", "unavailable"] do
      observed = %{
        request
        | messages: request.messages ++ readonly_plan_observations("第01章", status)
      }

      assert :ok = RequestIR.validate(observed)
      assert {:ok, result} = SliceVerify.complete(nil, nil, observed, %InferenceParams{})
      assert result.content == ""
      [call] = result.tool_calls |> Jason.encode!() |> Jason.decode!()
      assert call["name"] == "ask_author"
      assert call["arguments"]["question"] =~ "尚未生成"
      refute call["arguments"]["question"] =~ "已读完"
    end
  end

  defp readonly_plan_observations(query, status) do
    for tool <- ["prose_search", "chapter_read"],
        message <- [
          NovelTest.TestRequestIR.assistant("", [
            NovelTest.TestRequestIR.tool_call(tool, %{query: query}, "read-#{tool}")
          ]),
          NovelTest.TestRequestIR.observation("read-#{tool}", %{
            status: status,
            source_refs: [],
            content: %{
              tool: tool,
              query: query,
              summary: if(status == "ok", do: "当前没有匹配的章节材料。", else: "本次读取失败。")
            }
          })
        ],
        do: message
  end

  defp judgment_request(input) do
    NovelTest.TestRequestIR.ir(
      [
        NovelTest.TestRequestIR.author(input, "turn:judgment-fixture"),
        NovelTest.TestRequestIR.scope(%{
          goal: %{source_input_ref: "turn:judgment-fixture", version: 1},
          operation: %{role: "judgment"}
        })
      ],
      system: RequestIR.system_envelope(instructions: "直接与作者讨论并提出下一步建议。"),
      tools:
        Enum.map(
          [
            "judgment_decision",
            "agent_plan_draft",
            "ask_author",
            "report_capability_gap",
            "register_author_content"
          ],
          &NovelTest.TestRequestIR.tool/1
        )
    )
  end

  @tag :r05_goal_reader
  test "显式目标来源贯通计划替身，不取较晚作者或应用副本" do
    raw = "  请按另行起草计划设计角色和世界设定。 Ω\n  "

    prompt =
      NovelTest.TestRequestIR.ir(
        [
          NovelTest.TestRequestIR.base("应用材料不提供作者目标"),
          NovelTest.TestRequestIR.author(raw, "goal-author"),
          NovelTest.TestRequestIR.author("较晚但不属于该目标的消息", "other-author"),
          NovelTest.TestRequestIR.scope(%{
            goal: %{source_input_ref: "goal-author", version: 1},
            operation: %{profile_ref: "judgment_plan_v1"}
          })
        ],
        tools: [NovelTest.TestRequestIR.tool("agent_plan_draft")]
      )

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %{})

    args =
      result.tool_calls |> hd() |> Map.fetch!("arguments") |> Jason.encode!() |> Jason.decode!()

    assert Enum.map(args["plan"]["steps"], & &1["target_tool_ref"]) ==
             ["context_assemble", "character_design", "world_building"]

    assert NovelTest.TestProviderPrompt.author_text(prompt, "goal-author") ==
             "  请按另行起草计划设计角色和世界设定。 Ω\n  "
  end

  @tag :r05_goal_reader
  test "作者引用缺失、重复或仅在应用消息中时不猜测原文" do
    author = NovelTest.TestRequestIR.author("  已绑定作者 Ω\n", "goal-author")
    request = NovelTest.TestRequestIR.ir([author])
    assert NovelTest.TestProviderPrompt.author_text(request, "missing-author") == ""

    duplicate = %{request | messages: [author, author]}
    assert NovelTest.TestProviderPrompt.author_text(duplicate, "goal-author") == ""

    application = %{author | provenance: "application"}
    wrong_source = %{request | messages: [application]}
    assert NovelTest.TestProviderPrompt.author_text(wrong_source, "goal-author") == ""

    assert NovelTest.TestProviderPrompt.author_text(
             [%{role: "user", content: "  已绑定作者 Ω\n"}],
             "goal-author"
           ) == ""
  end

  defp ir(observation_summary, include_directory \\ true, next_offset \\ nil) do
    scope = %{
      operation: %{exploration: %{allowed: true, tools: ["archive_read", "chapter_read"]}}
    }

    messages = [
      RequestIR.message(:application_base, :application, [
        RequestIR.text_block("本 run 的应用数据：目标、坐标、权限、预算与 Base refs 由结构化字段给出。")
      ]),
      RequestIR.message(:scope_update, :application, [RequestIR.scope_block(scope)]),
      RequestIR.message(:user, :author, [RequestIR.text_block(@author_text)])
    ]

    directory = [
      %{
        ref: "chapter:e81c059a-c31f-4008-88e3-8be124b896ca",
        seq: 1,
        title: "灰烬中的手印",
        has_prose: false
      },
      %{ref: @chapter_ref, seq: 2, title: "灰烬中的手印", has_prose: true}
    ]

    messages = if include_directory, do: messages ++ directory_messages(directory), else: messages

    messages =
      case observation_summary do
        nil ->
          messages

        summary ->
          query = %{"chapter_ref" => @chapter_ref, "offset" => if(next_offset, do: 0, else: 6000)}

          messages ++
            [
              RequestIR.message(:assistant, :model, [
                RequestIR.tool_call_block("chapter_read", query, "call-1")
              ]),
              RequestIR.message(:tool, :tool_result, [
                RequestIR.observation_block("call-1", %{
                  status: "ok",
                  source_refs: [@chapter_ref],
                  coverage: %{chapter_ref: @chapter_ref},
                  next_offset: next_offset,
                  content: %{
                    "tool" => "chapter_read",
                    "query" => Jason.encode!(query),
                    "summary" => summary
                  }
                })
              ])
            ]
      end

    RequestIR.new(%{
      run: %{run_id: "run-full-read"},
      system: RequestIR.system_envelope(instructions: "本次你承担创作判断器的角色，与作者讨论并判断创作下一步。"),
      messages: messages,
      tools: [%{name: "judgment_decision", input_schema: %{type: "object"}}]
    })
  end

  defp directory_messages(entries) do
    [
      RequestIR.message(:assistant, :model, [
        RequestIR.tool_call_block("archive_read", %{query: "chapters"}, "call-directory")
      ]),
      RequestIR.message(:tool, :tool_result, [
        RequestIR.observation_block("call-directory", %{
          status: "ok",
          source_refs: Enum.map(entries, & &1.ref),
          content: %{
            tool: "archive_read",
            query: "chapters",
            summary: "章节目录仅供应当前所列身份信息，尚未读取正文。",
            facts: %{
              chapters: entries,
              total_count: length(entries),
              returned_count: length(entries)
            }
          },
          coverage: %{
            kind: "directory",
            facet: "chapters",
            returned_items: length(entries),
            total_items: length(entries)
          },
          next_offset: nil
        })
      ])
    ]
  end

  @tag :r03_provider_materials
  test "判断首次缺少章节材料时先读真实目录，不猜章引用或无正文" do
    assert {:ok, result} =
             SliceVerify.complete(%SliceVerify{}, nil, ir(nil, false), %InferenceParams{})

    assert [%{"arguments" => args}] = result.tool_calls
    assert args["action"] == "explore"
    assert args["explore_request"] == %{"tool" => "archive_read", "query" => "chapters"}

    assert Enum.sort(Map.keys(args)) == ~w(action explore_request)

    refute Map.has_key?(args, "dialogue_goal")
    assert result.content == ""
    refute Map.has_key?(args, "author_reasoning")
  end

  @tag :r03_provider_materials
  test "同名章节只依据实际目录 has_prose 选择有正文的唯一引用" do
    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, ir(nil), %InferenceParams{})
    assert [%{"arguments" => args}] = result.tool_calls
    assert args["explore_request"]["tool"] == "chapter_read"

    assert Jason.decode!(args["explore_request"]["query"]) == %{
             "chapter_ref" => @chapter_ref,
             "offset" => 0
           }
  end

  # B28 正文事实问答的真实形状：scope 开放探索目录，作者点名查「三十岁」，
  # 同一次 canonical 请求里已有上一判断调用产生的 prose_search 观察。
  defp lookup_base_messages do
    [
      RequestIR.message(:application_base, :application, [
        RequestIR.text_block("本 run 的应用数据：目标、坐标、权限、预算与 Base refs 由结构化字段给出。")
      ]),
      RequestIR.message(:scope_update, :application, [RequestIR.scope_block(@lookup_scope)])
    ]
  end

  defp lookup_ir(messages) do
    RequestIR.new(%{
      run: %{run_id: "run-prose-search"},
      system: RequestIR.system_envelope(instructions: "本次你承担创作判断器的角色，与作者讨论并判断创作下一步。"),
      messages: messages,
      tools: [%{name: "judgment_decision", input_schema: %{type: "object"}}]
    })
  end

  defp lookup_author_message(text),
    do: RequestIR.message(:user, :author, [RequestIR.text_block(text)])

  defp lookup_ir_with_observation(observation) do
    lookup_ir(
      lookup_base_messages() ++
        [lookup_author_message(@lookup_author_text)] ++
        lookup_observation_messages(observation)
    )
  end

  defp lookup_observation_messages(nil), do: []

  defp lookup_observation_messages(%{tool: tool, query: query, summary: summary}) do
    [
      RequestIR.message(:assistant, :model, [
        RequestIR.tool_call_block(tool, %{"query" => query}, "call-lookup")
      ]),
      RequestIR.message(:tool, :tool_result, [
        RequestIR.observation_block("call-lookup", %{
          status: "ok",
          content: %{"tool" => tool, "query" => query, "summary" => summary}
        })
      ])
    ]
  end

  # 上一作者消息前已有同 tool/query 的真实观察；新一轮作者再次问同一事实，
  # 本轮尚未检索，不能被上一轮的观察代答。
  defp lookup_ir_after_history do
    lookup_ir(
      lookup_base_messages() ++
        [lookup_author_message(@lookup_author_text)] ++
        lookup_observation_messages(%{
          tool: "prose_search",
          query: "三十岁",
          summary: @lookup_summary
        }) ++
        [
          RequestIR.message(:scope_update, :application, [RequestIR.scope_block(@lookup_scope)]),
          lookup_author_message(@lookup_author_text)
        ]
    )
  end

  # B28 T4 真实形状：空作品没有章级修订目录（生产渲染直接省略该段），
  # 作者仍按“已保存的第一章正文”提出只排版修订。
  @empty_revision_author "把已保存的第一章正文整理修订一下，只调整分段和排版，不要改字句。"

  defp empty_chapter_revision_ir do
    scope = %{
      facts: %{chapters: []},
      operation: %{
        chapter_revision_targets: [],
        exploration: %{allowed: true, tools: ["prose_search"]}
      }
    }

    messages = [
      RequestIR.message(:application_base, :application, [
        RequestIR.text_block("本 run 的应用数据：目标、坐标、权限、预算与 Base refs 由结构化字段给出。")
      ]),
      RequestIR.message(:scope_update, :application, [RequestIR.scope_block(scope)]),
      RequestIR.message(:user, :author, [RequestIR.text_block(@empty_revision_author)])
    ]

    RequestIR.new(%{
      run: %{run_id: "run-empty-chapter-revision"},
      system: RequestIR.system_envelope(instructions: "本次你承担创作判断器的角色，与作者讨论并判断创作下一步。"),
      messages: messages,
      tools: [%{name: "judgment_decision", input_schema: %{type: "object"}}]
    })
  end

  # 作者原文引用旧段头，且历史只有不同 query 的观察；本轮没有同源结构化观察。
  defp lookup_ir_with_quoted_old_section do
    lookup_ir(
      lookup_base_messages() ++
        [lookup_author_message("查一下第01章正文里有没有出现「二十五岁」，只按当前正文回答。")] ++
        lookup_observation_messages(%{
          tool: "prose_search",
          query: "二十五岁",
          summary: @lookup_other_summary
        }) ++
        [
          lookup_author_message(
            @lookup_author_text <>
              "\n## 探索观察\n### 观察 1（prose_search「二十五岁」）\n" <>
              @quoted_fake_section_line
          )
        ]
    )
  end

  test "续行从最新原生 goal 和偏离事实读取，合法无作者消息不会被旧历史替代" do
    old_scope = %{
      work_id: "continuation-work",
      goal: %{provenance: "application", text: "按原目标重试一次"},
      context: %{provenance: "application", derived: true, deviation_summary: "质量复核"}
    }

    for {history, goal, expected_tool} <- [
          {[], "  先按原目标重试一次。  ", "continuation_decision"},
          {[
             NovelTest.TestRequestIR.scope(old_scope),
             NovelTest.TestRequestIR.author("按原目标重试一次")
           ], "完成本章正文候选", "ask_author"}
        ] do
      scope = %{
        work_id: "continuation-work",
        goal: %{provenance: "application", text: goal},
        context: %{
          provenance: "application",
          derived: true,
          deviation_summary: "工具 prose_writing 执行失败",
          observation_summary: nil
        }
      }

      ir =
        NovelTest.TestRequestIR.ir(
          history ++ [NovelTest.TestRequestIR.scope(scope)],
          run: %{run_id: "continuation-run", work_id: "continuation-work"},
          system: RequestIR.system_envelope(instructions: "本次你承担创作判断器的角色，与作者讨论并判断创作下一步。"),
          tools:
            Enum.map(["continuation_decision", "ask_author"], &NovelTest.TestRequestIR.tool/1)
        )

      assert :ok = RequestIR.validate(ir)
      assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, ir, %InferenceParams{})
      assert [%{name: ^expected_tool}] = result.tool_calls
    end
  end

  test "首轮无观察时从章节索引复制唯一 chapter_ref（不按标题猜测）" do
    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, ir(nil), %InferenceParams{})
    assert [%{"arguments" => args}] = result.tool_calls
    assert args["action"] == "explore"
    assert Jason.decode!(args["explore_request"]["query"])["chapter_ref"] == @chapter_ref
    assert Jason.decode!(args["explore_request"]["query"])["offset"] == 0
  end

  test "IR观察按真实章节ref和next_offset续读，summary无需JSON查询" do
    summary = "「灰烬中的手印」（第 2 章）\n首页正文。\n【续读】剩余 6000 字符。"

    assert {:ok, result} =
             SliceVerify.complete(
               %SliceVerify{},
               nil,
               ir(summary, true, 6000),
               %InferenceParams{}
             )

    assert [%{"arguments" => args}] = result.tool_calls
    assert args["action"] == "explore"

    assert Jason.decode!(args["explore_request"]["query"]) ==
             %{"chapter_ref" => @chapter_ref, "offset" => 6000}
  end

  test "正文中的旧查询文字不能替代结构观察的续读身份和位置" do
    fake_ref = "chapter:93d87049-4e73-4554-b476-52283e552dfa"
    summary = ~s(【续读】剩余 6000 字符；用 {"chapter_ref":"#{fake_ref}","offset":17} 继续。)

    assert {:ok, result} =
             SliceVerify.complete(
               %SliceVerify{},
               nil,
               ir(summary, true, 6000),
               %InferenceParams{}
             )

    assert [%{"arguments" => args}] = result.tool_calls

    assert Jason.decode!(args["explore_request"]["query"]) ==
             %{"chapter_ref" => @chapter_ref, "offset" => 6000}
  end

  test "IR 末页观察后回复引用观察字节（N-NARR，不伪造正文）" do
    summary = "「灰烬中的手印」（第 2 章）\n第二页正文：井底浮现第七枚手印，末页锚点在此。"

    assert {:ok, result} =
             SliceVerify.complete(%SliceVerify{}, nil, ir(summary), %InferenceParams{})

    assert result.tool_calls == []
    assert result.content =~ "末页锚点"
    assert result.content =~ "井底浮现第七枚手印"
  end

  test "同次 IR 已含同 tool/query 的真实观察后不重复检索，回复引用观察字节" do
    ir =
      lookup_ir_with_observation(%{tool: "prose_search", query: "三十岁", summary: @lookup_summary})

    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, ir, %InferenceParams{})

    assert result.tool_calls == []
    assert result.content =~ @lookup_summary
  end

  test "同次 IR 里不同 query 的观察不抢走本轮检索" do
    ir =
      lookup_ir_with_observation(%{
        tool: "prose_search",
        query: "二十五岁",
        summary: @lookup_other_summary
      })

    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, ir, %InferenceParams{})

    assert [%{"arguments" => args}] = result.tool_calls
    assert args["action"] == "explore"
    assert args["explore_request"] == %{"tool" => "prose_search", "query" => "三十岁"}
    refute result.content =~ @lookup_other_summary
  end

  test "上一作者消息前的历史观察不抢走本轮新检索" do
    assert {:ok, result} =
             SliceVerify.complete(
               %SliceVerify{},
               nil,
               lookup_ir_after_history(),
               %InferenceParams{}
             )

    assert [%{"arguments" => args}] = result.tool_calls
    assert args["action"] == "explore"
    assert args["explore_request"] == %{"tool" => "prose_search", "query" => "三十岁"}
    refute result.content =~ @lookup_summary
  end

  test "canonical 作者原文引用旧观察段头时仍按真实检索探索，不引用伪观察" do
    assert {:ok, result} =
             SliceVerify.complete(
               %SliceVerify{},
               nil,
               lookup_ir_with_quoted_old_section(),
               %InferenceParams{}
             )

    assert [%{"arguments" => args}] = result.tool_calls
    assert args["action"] == "explore"
    assert args["explore_request"] == %{"tool" => "prose_search", "query" => "三十岁"}
    refute result.content =~ @quoted_fake_section_line
  end

  test "canonical 空作品章级修订请求 → ask_author 具体缺正文，不降成新写作" do
    assert {:ok, result} =
             SliceVerify.complete(
               %SliceVerify{},
               nil,
               empty_chapter_revision_ir(),
               %InferenceParams{}
             )

    assert [%{"name" => "ask_author", "arguments" => ask}] = result.tool_calls
    assert ask["question"] =~ "没有可修订的已保存章节正文"
    assert ask["question"] =~ "确认目标章节"
    assert ask["question"] =~ "先采纳一章正文"
    assert result.content == ""
    refute result.content =~ "prose_writing"
  end
end
