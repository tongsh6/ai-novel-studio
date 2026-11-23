defmodule NovelApplication.ChapterMissionServiceTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentNarrativeSource
  alias NovelApplication.AuthoringCheckpoint
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.ChapterMissionService
  alias NovelCommon.Contracts.ProviderOutput
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelDomain.ChapterMission
  alias NovelDomain.ChapterMissionInputs

  defp inputs do
    ChapterMissionInputs.build(%{
      chapter: %{
        seq: 3,
        title: "第03章：巡检收网",
        plan_direction: %{"chapter_role" => "推进章", "plot_progress" => "带证据撤出黑市"}
      },
      entries: [
        %{
          ledger: "information",
          subject_ref: "foreshadow_a",
          subject_label: "伏笔：旧账牌",
          status: "HIDDEN",
          payload: %{"planned_reveal" => %{"kind" => "chapter", "seq" => 2}}
        },
        %{
          ledger: "information",
          subject_ref: "plan_info_5",
          subject_label: "第5章信息",
          status: "HIDDEN",
          payload: %{"fact" => "第五章才揭示", "planned_reveal_seq" => 5}
        }
      ],
      written_progress: %{chapter_seq: 2, volume_seq: 1}
    })
  end

  # 用 event sink 包装让 result_fn 合成 ProviderOutput（与 flow 内 stage sink 路径同形）。
  defp execution(result_fn) do
    Execution.with_event_sink(%Execution{result_fn: result_fn}, fn _ -> :ok end)
  end

  defp tool_call_result(arguments, opts \\ []) do
    %{
      content: Keyword.get(opts, :content, ""),
      provider_call_id: Keyword.get(opts, :call_id, "pc-mission"),
      tool_calls: [
        %{"name" => Keyword.get(opts, :tool_name, "chapter_mission"), "arguments" => arguments}
      ]
    }
  end

  test "一次 tool-call 产使命：依据越界条目被机械丢弃，唯一工具说明绑定原文，prompt 只列名材料 ref" do
    parent = self()

    result_fn = fn prompt ->
      send(parent, {:prompt, prompt})

      {:ok,
       tool_call_result(%{
         "author_reasoning" => "我核对了计划与脉络：旧账牌伏笔已超期，本章先收这条线。",
         "statement" => "本章必须回收旧账牌伏笔。",
         "must_advance" => [
           %{"text" => "让旧账牌编号兑现", "basis_ref" => "ledger:information:foreshadow_a"},
           %{"text" => "编造依据", "basis_ref" => "ledger:information:foreshadow_zzz"}
         ],
         "must_avoid" => [
           %{"text" => "不提前揭示第五章信息", "basis_ref" => "ledger:information:plan_info_5"}
         ],
         "confidence" => 0.9
       })}
    end

    assert {:ok, %ChapterMission{} = mission, meta} =
             ChapterMissionService.derive(inputs(), execution(result_fn),
               run: fixture_run(),
               author_text: "续写第三章",
               source_input_ref: "input:mission-author"
             )

    assert_receive {:prompt, prompt}
    assert RequestIR.Tools.tool_choice(prompt) == "chapter_mission"
    assert [%{name: "chapter_mission"}] = prompt.tools
    content = text(prompt)
    assert content =~ ChapterMissionService.prompt_anchor()

    material_refs =
      prompt
      |> NovelTest.TestProviderPrompt.scope_content()
      |> get_in(["operation", "mission_inputs", "items"])
      |> Enum.map(& &1["ref"])

    assert "ledger:information:foreshadow_a" in material_refs
    assert "plan:3:chapter_role" in material_refs

    assert Enum.any?(
             prompt.messages,
             &(&1.role == "user" and &1.provenance == "author" and text(&1) == "续写第三章")
           )

    assert mission.statement == "本章必须回收旧账牌伏笔。"

    assert [%{"basis_ref" => "ledger:information:foreshadow_a", "basis_label" => label}] =
             mission.must_advance

    assert label =~ "伏笔：旧账牌"
    assert [%{"basis_ref" => "ledger:information:plan_info_5"}] = mission.must_avoid
    assert [%{"basis_ref" => "ledger:information:foreshadow_zzz"}] = mission.dropped
    assert mission.provider_call_ref == "pc-mission"
    assert String.starts_with?(ChapterMission.ref(mission), "mission:cm_")

    assert meta.provider_call_count == 1
    assert meta.narrative =~ "旧账牌伏笔已超期"

    NovelApplication.TestAssertions.assert_provider_output_narrative_source(
      meta.narrative_source,
      "provider_output_tool_narrative"
    )
  end

  test "content 为空且工具 author_reasoning 完整时绑定唯一作者说明" do
    result_fn = fn _prompt ->
      {:ok,
       tool_call_result(
         %{
           "author_reasoning" => "本章按计划推进，没有到期压力。",
           "statement" => "按计划推进。",
           "must_advance" => [],
           "must_avoid" => [],
           "confidence" => 0.7
         },
         content: ""
       )}
    end

    assert {:ok, mission, meta} =
             ChapterMissionService.derive(inputs(), execution(result_fn), run: fixture_run())

    assert mission.statement == "按计划推进。"
    assert meta.narrative == "本章按计划推进，没有到期压力。"
    assert meta.narrative_source.source_type == "provider_output_tool_narrative"
  end

  test "坏结构携带原因重试一次；第二次仍失败返回 error 且 provider_call_count=2" do
    {:ok, counter} = Agent.start_link(fn -> 0 end)

    result_fn = fn prompt ->
      attempt = Agent.get_and_update(counter, &{&1 + 1, &1 + 1})

      if attempt == 2 do
        assert Enum.any?(prompt.messages, fn
                 %{
                   role: "application_notice",
                   blocks: [%{type: "validation_result", status: "failed", detail: detail}]
                 } ->
                   detail["message"] =~ "上一次输出无法使用"

                 _message ->
                   false
               end)
      end

      {:ok,
       %{
         content: "我直接写正文了。",
         provider_call_id: "pc-bad-#{attempt}",
         provider_call_ref: "pc-bad-#{attempt}",
         provider_run_ref: "prun-mission-bad-#{attempt}",
         tool_calls: []
       }}
    end

    assert {:error, {:native_tool_call_required, "chapter_mission"}, %{provider_call_count: 2}} =
             ChapterMissionService.derive(inputs(), execution(result_fn), run: fixture_run())

    assert Agent.get(counter, & &1) == 2
  end

  test "空 statement 不满足工具契约；合法 statement 在场时仍保留原依据丢弃规则" do
    result_fn = fn _prompt ->
      {:ok,
       tool_call_result(%{
         "author_reasoning" => "x",
         "statement" => "",
         "must_advance" => [%{"text" => "a", "basis_ref" => "nope"}],
         "must_avoid" => [],
         "confidence" => 0.5
       })}
    end

    assert {:error, :invalid_mission_tool_arguments, %{provider_call_count: 2}} =
             ChapterMissionService.derive(inputs(), execution(result_fn), run: fixture_run())

    ok_fn = fn _prompt ->
      {:ok,
       tool_call_result(%{
         "author_reasoning" => "核清了。",
         "statement" => "按计划推进。",
         "must_advance" => [%{"text" => "a", "basis_ref" => "nope"}],
         "must_avoid" => [],
         "confidence" => 0.5
       })}
    end

    assert {:ok, mission, %{provider_call_count: 1}} =
             ChapterMissionService.derive(inputs(), execution(ok_fn), run: fixture_run())

    assert mission.must_advance == []
    assert length(mission.dropped) == 1
  end

  test "provider 缺席或调用失败诚实返回 error" do
    assert {:error, :provider_execution_missing, %{provider_call_count: 0}} =
             ChapterMissionService.derive(inputs(), nil, run: fixture_run())

    failing = execution(fn _prompt -> {:error, :timeout} end)

    assert {:error, _reason, %{provider_call_count: 1}} =
             ChapterMissionService.derive(inputs(), failing, run: fixture_run())
  end

  test "R05: 规划使命保留卷级目标，不把所有大纲请求改成下一批章节" do
    parent = self()
    goal = "规划第一卷的总体冲突和弧光，不创建任何章节。"
    author_words = "  这次只谈卷纲 R05MISSIONAUTHOR\r\n"
    run = %{fixture_run() | goal: %{text: goal, version: 2}}

    provider =
      execution(fn prompt ->
        send(parent, {:r05_planning_prompt, prompt})

        {:ok,
         %{
           content: "",
           provider_call_id: "pc-r05-volume-mission",
           tool_calls: [
             %{
               "name" => "planning_mission",
               "arguments" => %{
                 "author_reasoning" => "本轮只明确卷级冲突和弧光。",
                 "statement" => "卷级冲突与弧光保持一致。",
                 "must_advance" => [],
                 "must_avoid" => [],
                 "confidence" => 0.9
               }
             }
           ]
         }}
      end)

    assert {:ok, _mission, _meta} =
             ChapterMissionService.derive(
               ChapterMissionInputs.build(%{mode: :planning}),
               provider,
               kind: :planning,
               run: run,
               author_text: author_words,
               source_input_ref: "input:r05-volume-mission"
             )

    assert_receive {:r05_planning_prompt, prompt}
    scope = NovelTest.TestProviderPrompt.scope_content(prompt)
    assert scope["goal"]["text"] == goal
    assert NovelTest.TestProviderPrompt.author_text(prompt) == author_words
    rules = Projection.system_text(prompt.system)
    refute rules =~ "下一批章节大纲尚未起草"
    refute rules =~ "这批章必须安排"
    refute rules =~ "这批章不得安排"
  end

  test "使命请求同样使用 IR，规则与材料不冒充作者输入" do
    author_text = "  把这一章写得更紧凑\n"
    parent = self()

    provider =
      execution(fn prompt ->
        send(parent, {:mission_prompt, prompt})
        {:ok, tool_call_result(valid_arguments())}
      end)

    assert {:ok, _mission, _meta} =
             ChapterMissionService.derive(inputs(), provider,
               run: fixture_run(),
               author_text: author_text,
               source_input_ref: "input:mission-raw-author"
             )

    assert_receive {:mission_prompt, prompt}
    assert %RequestIR{} = prompt
    assert prompt.ir_version == RequestIR.ir_version()

    assert [%{role: "user", provenance: "author"} = author_message] =
             Enum.filter(prompt.messages, &(&1.role == "user" and &1.provenance == "author"))

    assert text(author_message) == author_text
    assert author_message.source_refs == [%{ref: "input:mission-raw-author"}]

    # 2026-11-06 裁决 A：角色规则/输出协议在 canonical system 前缀；材料仍在消息中。
    system_text = Projection.system_text(prompt.system)
    material = Enum.find(prompt.messages, &(&1.role == "scope_update"))
    assert system_text =~ "author_reasoning"
    assert system_text =~ "调用 chapter_mission 工具"
    assert material.provenance == "application"
    assert [%{type: "scope", content: scope}] = material.blocks
    mission_inputs = scope["operation"]["mission_inputs"]
    assert mission_inputs["mode"] == "prose"

    assert mission_inputs["items"] ==
             RequestIR.json_value(
               Enum.map(
                 inputs().items,
                 &Map.update!(&1, :group, fn group -> Atom.to_string(group) end)
               )
             )

    assert Enum.any?(mission_inputs["items"], &(&1["ref"] == "plan:3:chapter_role"))

    assert Enum.map(material.source_refs, & &1.ref) ==
             inputs() |> ChapterMissionInputs.refs() |> Enum.sort()

    refute system_text == author_text
    refute Map.has_key?(scope, "author_words")
  end

  test "缺少真实 run 或明确作者来源时不补造事实，也不调用 Provider" do
    provider = execution(fn _ -> flunk("缺 run 或作者来源不得调用模型") end)

    assert {:error, :missing_run_envelope, %{provider_call_count: 0}} =
             ChapterMissionService.derive(inputs(), provider)

    assert {:error, :missing_run_envelope, %{provider_call_count: 0}} =
             ChapterMissionService.derive(inputs(), provider,
               author_text: "续写第三章",
               source_input_ref: "input:mission-without-run"
             )

    assert {:error, :invalid_author_input, %{provider_call_count: 0}} =
             ChapterMissionService.derive(inputs(), provider,
               run: fixture_run(),
               author_text: "续写第三章"
             )
  end

  @tag :mission_canonical
  test "使命请求保留真实前序会话，独立作者原话不重复，成功后可恢复" do
    parent = self()
    {run, transcript} = mission_conversation()
    run = %{run | goal: %{text: "只补第三章结尾，保留已写正文", version: 2}}
    {:ok, before_ir} = AuthoringTranscript.to_request_ir(transcript)

    provider =
      execution(fn prompt ->
        send(parent, {:canonical_mission_prompt, prompt})
        {:ok, tool_call_result(valid_arguments())}
      end)

    assert {:ok, mission, meta} =
             ChapterMissionService.derive(inputs(), provider,
               run: run,
               snapshot: %{stage_state: %{judgment_transcript: transcript}}
             )

    assert_receive {:canonical_mission_prompt, prompt}
    assert Enum.take(prompt.messages, length(before_ir.messages)) == before_ir.messages

    assert Enum.count(
             prompt.messages,
             &(&1.role == "user" and &1.provenance == "author" and text(&1) == "  续写第三章\n")
           ) == 1

    refute Enum.any?(
             prompt.messages,
             &(&1.role == "user" and text(&1) == run.goal.text)
           )

    assert Enum.map(prompt.tools, & &1.name) == ["chapter_mission"]
    latest_scope = Enum.find(Enum.reverse(prompt.messages), &(&1.role == "scope_update"))
    assert latest_scope
    assert [%{type: "scope", content: scope}] = latest_scope.blocks
    assert scope["goal"]["text"] == "只补第三章结尾，保留已写正文"
    assert scope["goal"]["version"] == 2

    # 目标版本是 canonical scope 的结构化事实；投影文本（provider 实际可读）同源携带。
    assert latest_scope.versions["goal_version"] == 2

    assert Projection.scope_update_text(latest_scope) =~
             ~s("goal_version":2)

    assert mission.statement == "本章回收旧账牌。"
    assert meta.provider_call_count == 1
    assert {:ok, ir} = AuthoringTranscript.to_request_ir(meta.judgment_transcript)
    assert {:ok, []} = RequestIR.pending_call_ids(ir)

    assert {:ok, restored} =
             meta.judgment_transcript
             |> AuthoringCheckpoint.checkpoint()
             |> Jason.encode!()
             |> Jason.decode!()
             |> AuthoringTranscript.restore()

    assert {:ok, restored_ir} = AuthoringTranscript.to_request_ir(restored)

    # checkpoint 是 JSON 边界：工具 map 的 key 表示在往返后变为字符串；恢复后的
    # 请求语义必须逐项一致——运行事实/消息/来源引用严格相等，工具 description/schema
    # 按 JSON 语义相等，且三种 wire 投影逐字节一致。
    assert %{restored_ir | tools: []} == %{ir | tools: []}
    assert normalized_tools(restored_ir.tools) == normalized_tools(ir.tools)

    for target <- ["chat_completions", "anthropic_messages", "responses_api"] do
      assert Projection.project(restored_ir, target) ==
               Projection.project(ir, target)
    end
  end

  # 工具语义的规范化视图：JSON 边界两侧都按 string-key 对象比较。
  defp normalized_tools(tools) do
    tools
    |> Enum.map(&Projection.json_value/1)
    |> Enum.sort_by(&(Map.get(&1, "name") || Map.get(&1, :name)))
  end

  @tag :mission_canonical
  test "无效使命通过原生失败结果回流，下一真实请求保留响应与正确关联" do
    parent = self()
    {:ok, attempts} = Agent.start_link(fn -> 0 end)
    {run, transcript} = mission_conversation()

    provider =
      execution(fn prompt ->
        attempt = Agent.get_and_update(attempts, &{&1 + 1, &1 + 1})
        send(parent, {:mission_attempt, attempt, prompt})

        args =
          if attempt == 1,
            do: %{
              valid_arguments()
              | "statement" => "",
                "must_advance" => [%{"text" => "越界", "basis_ref" => "unread:fact"}]
            },
            else: valid_arguments()

        {:ok, tool_call_result(args, call_id: "pc-mission-#{attempt}")}
      end)

    assert {:ok, _mission, meta} =
             ChapterMissionService.derive(inputs(), provider,
               run: run,
               snapshot: %{stage_state: %{judgment_transcript: transcript}}
             )

    assert_receive {:mission_attempt, 1, first}
    assert_receive {:mission_attempt, 2, second}
    assert Enum.take(second.messages, length(first.messages)) == first.messages

    feedback =
      Enum.find(second.messages, fn message ->
        Enum.any?(message.blocks, fn block ->
          block.type == "validation_result" and
            block.reason_code == "invalid_mission_tool_arguments"
        end)
      end)

    assert feedback

    assert %{type: "validation_result", status: "failed", call_id: rejected_id} =
             Enum.find(feedback.blocks, &(&1.type == "validation_result"))

    assert Enum.any?(second.messages, fn message ->
             Enum.any?(message.blocks, &(&1.type == "tool_call" and &1.call_id == rejected_id))
           end)

    assert meta.provider_call_count == 2
    assert {:ok, ir} = AuthoringTranscript.to_request_ir(meta.judgment_transcript)
    assert {:ok, []} = RequestIR.pending_call_ids(ir)
  end

  @tag :mission_canonical
  test "最终坏使命与传输失败均保留可恢复会话及实际调用数" do
    {run, transcript} = mission_conversation()
    opts = [run: run, snapshot: %{stage_state: %{judgment_transcript: transcript}}]

    invalid =
      execution(fn _ ->
        {:ok, tool_call_result(%{valid_arguments() | "statement" => "", "must_advance" => []})}
      end)

    assert {:error, :invalid_mission_tool_arguments, invalid_meta} =
             ChapterMissionService.derive(inputs(), invalid, opts)

    assert invalid_meta.provider_call_count == 2
    assert {:ok, invalid_ir} = AuthoringTranscript.to_request_ir(invalid_meta.judgment_transcript)
    assert {:ok, []} = RequestIR.pending_call_ids(invalid_ir)

    failed = execution(fn _ -> {:error, :timeout} end)
    assert {:error, _, failed_meta} = ChapterMissionService.derive(inputs(), failed, opts)
    assert failed_meta.provider_call_count == 1

    assert Enum.take(failed_meta.judgment_transcript.messages, length(transcript.messages)) ==
             transcript.messages
  end

  for {kind, tool_name} <- [{:prose, "chapter_mission"}, {:planning, "planning_mission"}] do
    test "R06 #{kind}: 唯一工具说明与使命内容保留首尾空白、换行及 Unicode 原字节" do
      kind = unquote(kind)
      tool_name = unquote(tool_name)
      author_text = "  请讨论 ref 与基线的技术含义，再推进第三章。\r\n"
      reasoning = " \n我会先收回旧账牌，再让人物承担选择的代价。\u00A0"
      statement = "\t本章回收旧账牌。\r\n"
      advance = "  让旧账牌编号兑现。\n"
      avoid = "\n暂不揭示第五章信息。\t"

      args = %{
        "author_reasoning" => reasoning,
        "statement" => statement,
        "must_advance" => [
          %{"text" => advance, "basis_ref" => "ledger:information:foreshadow_a"}
        ],
        "must_avoid" => [
          %{"text" => avoid, "basis_ref" => "ledger:information:plan_info_5"}
        ],
        "confidence" => 0.9
      }

      for content <- [nil, ""] do
        result =
          args
          |> tool_call_result(tool_name: tool_name, content: content)
          |> with_provider_output()

        provider = %Execution{
          result_fn: fn prompt ->
            assert NovelTest.TestProviderPrompt.author_text(prompt) == author_text
            {:ok, result}
          end
        }

        assert {:ok, mission, meta} =
                 ChapterMissionService.derive(inputs(), provider,
                   kind: kind,
                   run: fixture_run(),
                   author_text: author_text,
                   source_input_ref: "input:r06-mission"
                 )

        assert meta.provider_call_count == 1
        assert meta.narrative == reasoning
        assert mission.statement == statement
        assert hd(mission.must_advance)["text"] == advance
        assert hd(mission.must_avoid)["text"] == avoid
        assert hd(mission.must_advance)["basis_ref"] == "ledger:information:foreshadow_a"
        assert meta.narrative_source.source_type == "provider_output_tool_narrative"
        assert meta.narrative_source.tool_call_name == tool_name

        assert meta.narrative_source.source_byte_range == %{
                 start: 0,
                 length: byte_size(reasoning)
               }

        assert :ok ==
                 AgentNarrativeSource.verify(reasoning, meta.narrative_source, %{
                   result.provider_output.provider_run_ref => result.provider_output
                 })
      end
    end

    test "R06 #{kind}: 第二正文即使与工具说明相同或仅含空白也必须拒绝" do
      kind = unquote(kind)
      tool_name = unquote(tool_name)

      for content <- ["先回收旧账牌。", "改为回收另一条线。", " \t\r\n"] do
        provider =
          execution(fn _ ->
            {:ok, tool_call_result(valid_arguments(), tool_name: tool_name, content: content)}
          end)

        assert {:error, :author_narrative_content_conflict, meta} =
                 ChapterMissionService.derive(inputs(), provider, kind: kind, run: fixture_run())

        assert_rejected_mission(meta)
      end
    end

    test "R06 #{kind}: 说明与每个使命内容字段均在接收前校验，不能接受一段好说明掩盖坏使命" do
      kind = unquote(kind)
      tool_name = unquote(tool_name)
      leaked = "应推进 chapter:22660419，并保留原有选择。"

      cases = [
        Map.put(valid_arguments(), "author_reasoning", leaked),
        Map.put(valid_arguments(), "statement", leaked),
        Map.put(valid_arguments(), "must_advance", [
          %{"text" => leaked, "basis_ref" => "ledger:information:foreshadow_a"}
        ]),
        Map.put(valid_arguments(), "must_avoid", [
          %{"text" => leaked, "basis_ref" => "ledger:information:plan_info_5"}
        ])
      ]

      for args <- cases do
        provider = execution(fn _ -> {:ok, tool_call_result(args, tool_name: tool_name)} end)

        assert {:error, _reason, meta} =
                 ChapterMissionService.derive(inputs(), provider, kind: kind, run: fixture_run())

        assert_rejected_mission(meta)
      end
    end

    test "R06 #{kind}: 闭合工具参数拒绝额外标签、额外字段、缺失说明和旧嵌套信封" do
      kind = unquote(kind)
      tool_name = unquote(tool_name)

      cases = [
        Map.put(valid_arguments(), "extra", "不属于使命的字段"),
        Map.put(valid_arguments(), "must_advance", [
          %{
            "text" => "回收旧账牌",
            "basis_ref" => "ledger:information:foreshadow_a",
            "basis_label" => "模型伪造的依据标签"
          }
        ]),
        Map.delete(valid_arguments(), "author_reasoning"),
        Map.put(valid_arguments(), "author_reasoning", 42),
        %{"name" => tool_name, "arguments" => valid_arguments()}
      ]

      for args <- cases do
        provider = execution(fn _ -> {:ok, tool_call_result(args, tool_name: tool_name)} end)

        assert {:error, _reason, meta} =
                 ChapterMissionService.derive(inputs(), provider, kind: kind, run: fixture_run())

        assert_rejected_mission(meta)
      end
    end

    test "R06 #{kind}: 核对整个原工具调用，缺来源或替换使命、调用身份、原 content 都不接受" do
      kind = unquote(kind)
      tool_name = unquote(tool_name)
      original = tool_call_result(valid_arguments(), tool_name: tool_name)

      changed_statement =
        update_in(original.tool_calls, fn [call] ->
          [put_in(call, ["arguments", "statement"], "应用改写了使命。")]
        end)

      changed_call_id =
        update_in(original.tool_calls, fn [call] -> [Map.put(call, "id", "forged-call")] end)

      cases = [
        original,
        with_provider_output(changed_statement, original),
        with_provider_output(changed_call_id, original),
        with_provider_output(original, %{original | content: "原输出还包含第二正文。"})
      ]

      for result <- cases do
        provider = %Execution{result_fn: fn _ -> {:ok, result} end}

        assert {:error, _reason, meta} =
                 ChapterMissionService.derive(inputs(), provider, kind: kind, run: fixture_run())

        assert_rejected_mission(meta)
      end
    end

    test "R06 #{kind}: 拒绝原调用后只接受第二次纠正，原坏字节与关联回执进入下一请求" do
      kind = unquote(kind)
      tool_name = unquote(tool_name)
      parent = self()
      {:ok, attempts} = Agent.start_link(fn -> 0 end)
      bad = %{valid_arguments() | "author_reasoning" => "先读 chapter:22660419。"}
      good = %{valid_arguments() | "author_reasoning" => " \n先回收旧账牌。\r\n"}

      provider =
        execution(fn prompt ->
          attempt = Agent.get_and_update(attempts, &{&1 + 1, &1 + 1})
          send(parent, {:r06_mission_attempt, attempt, prompt})
          args = if attempt == 1, do: bad, else: good

          {:ok,
           tool_call_result(args,
             tool_name: tool_name,
             call_id: "pc-r06-mission-#{attempt}"
           )}
        end)

      assert {:ok, _mission, meta} =
               ChapterMissionService.derive(inputs(), provider, kind: kind, run: fixture_run())

      assert Agent.get(attempts, & &1) == 2
      assert meta.provider_call_count == 2
      assert meta.narrative == good["author_reasoning"]
      assert meta.narrative_source.provider_call_ref == "pc-r06-mission-2"
      assert_receive {:r06_mission_attempt, 1, first}
      assert_receive {:r06_mission_attempt, 2, second}
      assert Enum.take(second.messages, length(first.messages)) == first.messages

      [rejected] =
        for message <- second.messages,
            %{type: "validation_result", status: "failed"} = block <- message.blocks,
            do: block

      assert Enum.any?(second.messages, fn message ->
               Enum.any?(message.blocks, fn block ->
                 block.type == "tool_call" and block.call_id == rejected.call_id and
                   RequestIR.json_value(block.arguments) == bad
               end)
             end)

      assert {:ok, restored} = AuthoringTranscript.to_request_ir(meta.judgment_transcript)
      assert {:ok, []} = RequestIR.pending_call_ids(restored)
      refute_receive {:r06_mission_attempt, 3, _}
    end
  end

  defp with_provider_output(result, original \\ nil) do
    original = original || result

    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: "prun-#{result.provider_call_id}",
        provider_call_ref: result.provider_call_id,
        status: :ok,
        output_type: :text,
        content: %{text: original.content, tool_calls: original.tool_calls},
        refs: [result.provider_call_id]
      })

    Map.put(result, :provider_output, output)
  end

  defp assert_rejected_mission(meta) do
    assert meta.provider_call_count == 2
    refute Map.has_key?(meta, :narrative)
    assert {:ok, ir} = AuthoringTranscript.to_request_ir(meta.judgment_transcript)
    assert {:ok, []} = RequestIR.pending_call_ids(ir)

    failures =
      for message <- ir.messages,
          %{type: "validation_result", status: "failed"} = block <- message.blocks,
          do: block

    assert length(failures) == 2
    assert length(Enum.uniq_by(failures, & &1.call_id)) == 2
  end

  defp text(%RequestIR{} = ir), do: NovelApplication.TestAgenticLoopFixtures.prompt_text(ir)

  defp text(%{blocks: _} = message),
    do: NovelApplication.TestAgenticLoopFixtures.message_text(message)

  defp text(text) when is_binary(text), do: text

  defp fixture_run, do: %{run_id: "run-mission", work_id: "work-mission", goal: %{text: "续写第三章"}}

  defp mission_conversation do
    run = %{run_id: "run-mission", work_id: "work-mission", goal: %{text: "续写第三章"}}

    transcript =
      AuthoringTranscript.new(run,
        base_text: "作者保留采纳权",
        author_text: "  续写第三章\n",
        author_turn_ref: "input:mission-conversation"
      )
      |> AuthoringTranscript.append_assistant("先核对已读材料。", [
        RequestIR.tool_call_block("archive_read", %{}, "prior-read")
      ])
      |> AuthoringTranscript.append_observation("prior-read", %{
        status: "ok",
        source_refs: [],
        content: %{summary: "第三章计划已读取"}
      })

    {run, transcript}
  end

  defp valid_arguments do
    %{
      "author_reasoning" => "先回收旧账牌。",
      "statement" => "本章回收旧账牌。",
      "must_advance" => [%{"text" => "回收旧账牌", "basis_ref" => "ledger:information:foreshadow_a"}],
      "must_avoid" => [],
      "confidence" => 0.9
    }
  end
end
