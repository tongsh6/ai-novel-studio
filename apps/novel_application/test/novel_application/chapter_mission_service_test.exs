defmodule NovelApplication.ChapterMissionServiceTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.Projection
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.ChapterMissionService
  alias NovelCommon.RequestIR
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

  defp tool_call_result(reasoning, arguments, opts \\ []) do
    %{
      content: Keyword.get(opts, :content, reasoning),
      provider_call_id: Keyword.get(opts, :call_id, "pc-mission"),
      tool_calls: [%{"name" => "chapter_mission", "arguments" => arguments}]
    }
  end

  test "一次 tool-call 产使命：依据越界条目被机械丢弃，叙事绑定 content，prompt 只列名材料 ref" do
    parent = self()

    result_fn = fn prompt ->
      send(parent, {:prompt, prompt})

      {:ok,
       tool_call_result("我核对了计划与脉络：旧账牌伏笔已超期，本章先收这条线。", %{
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
               author_text: "续写第三章"
             )

    assert_receive {:prompt, prompt}
    assert RequestIR.Tools.tool_choice(prompt) == "chapter_mission"
    assert [%{name: "chapter_mission"}] = prompt.tools
    content = text(prompt)
    assert content =~ ChapterMissionService.prompt_anchor()
    assert content =~ "[ledger:information:foreshadow_a]"
    assert content =~ "[plan:3:chapter_role]"

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
    NovelApplication.TestAssertions.assert_provider_output_narrative_source(meta.narrative_source)
  end

  test "content 为空时叙事回退 tool arguments.author_reasoning（强制 tool_choice 判例）" do
    result_fn = fn _prompt ->
      {:ok,
       tool_call_result(
         "",
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
        [_first | rest] = prompt.messages
        assert Enum.any?(rest, &(text(&1) =~ "上一次输出无法使用"))
      end

      {:ok, %{content: "我直接写正文了。", provider_call_id: "pc-bad-#{attempt}", tool_calls: []}}
    end

    assert {:error, {:native_tool_call_required, "chapter_mission"}, %{provider_call_count: 2}} =
             ChapterMissionService.derive(inputs(), execution(result_fn), run: fixture_run())

    assert Agent.get(counter, & &1) == 2
  end

  test "依据全部越界且无 statement → 重试后仍失败 mission_unbound；statement 在场则成功保留" do
    result_fn = fn _prompt ->
      {:ok,
       tool_call_result("x", %{
         "author_reasoning" => "x",
         "statement" => "",
         "must_advance" => [%{"text" => "a", "basis_ref" => "nope"}],
         "must_avoid" => [],
         "confidence" => 0.5
       })}
    end

    assert {:error, :mission_unbound, %{provider_call_count: 2}} =
             ChapterMissionService.derive(inputs(), execution(result_fn), run: fixture_run())

    ok_fn = fn _prompt ->
      {:ok,
       tool_call_result("核清了。", %{
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

  test "使命请求同样使用 IR，规则与材料不冒充作者输入" do
    author_text = "  把这一章写得更紧凑\n"
    parent = self()

    provider =
      execution(fn prompt ->
        send(parent, {:mission_prompt, prompt})
        {:ok, tool_call_result("按紧凑要求回收旧账牌。", valid_arguments())}
      end)

    assert {:ok, _mission, _meta} =
             ChapterMissionService.derive(inputs(), provider,
               run: fixture_run(),
               author_text: author_text
             )

    assert_receive {:mission_prompt, prompt}
    assert %RequestIR{} = prompt
    assert prompt.ir_version == RequestIR.ir_version()

    assert [%{role: "user", provenance: "author"} = author_message] =
             Enum.filter(prompt.messages, &(&1.role == "user" and &1.provenance == "author"))

    assert text(author_message) == author_text

    # 2026-11-06 裁决 A：角色规则/输出协议在 canonical system 前缀；材料仍在消息中。
    system_text = Projection.system_text(prompt.system)
    material = Enum.find(prompt.messages, &(text(&1) =~ "材料（每条以 [ref] 开头"))
    assert system_text =~ "author_reasoning"
    assert system_text =~ "调用 chapter_mission 工具"
    assert material
    assert material.provenance == "application"
    assert text(material) =~ "[plan:3:chapter_role]"
    refute system_text == author_text
    refute text(material) == author_text
  end

  test "没有真实 run 或历史时不伪造运行事实，也不调用 Provider" do
    provider = execution(fn _ -> flunk("缺 run 不得调用模型") end)

    assert {:error, :missing_run_envelope, %{provider_call_count: 0}} =
             ChapterMissionService.derive(inputs(), provider)

    assert {:error, :missing_run_envelope, %{provider_call_count: 0}} =
             ChapterMissionService.derive(inputs(), provider, author_text: "续写第三章")
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
        {:ok, tool_call_result("先回收旧账牌。", valid_arguments())}
      end)

    assert {:ok, mission, meta} =
             ChapterMissionService.derive(inputs(), provider,
               run: run,
               snapshot: %{stage_state: %{judgment_transcript: transcript}},
               author_text: "不要把应用目标重复成作者发言"
             )

    assert_receive {:canonical_mission_prompt, prompt}
    assert Enum.take(prompt.messages, length(before_ir.messages)) == before_ir.messages

    assert Enum.count(
             prompt.messages,
             &(&1.role == "user" and &1.provenance == "author" and text(&1) == "  续写第三章\n")
           ) == 1

    refute Enum.any?(
             prompt.messages,
             &(&1.role == "user" and text(&1) == "不要把应用目标重复成作者发言")
           )

    assert Enum.map(prompt.tools, & &1.name) == ["chapter_mission"]
    latest_scope = Enum.find(Enum.reverse(prompt.messages), &(&1.role == "scope_update"))
    assert latest_scope
    assert text(latest_scope) =~ "当前应用目标：只补第三章结尾，保留已写正文"

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
             |> AuthoringTranscript.checkpoint()
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

        {:ok, tool_call_result("核对材料。", args, call_id: "pc-mission-#{attempt}")}
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
          block.type == "validation_result" and block.reason_code == "mission_unbound"
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
        {:ok,
         tool_call_result("错误依据。", %{valid_arguments() | "statement" => "", "must_advance" => []})}
      end)

    assert {:error, :mission_unbound, invalid_meta} =
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
        author_text: "  续写第三章\n"
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
