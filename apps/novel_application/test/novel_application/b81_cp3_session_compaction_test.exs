defmodule NovelApplication.B81Cp3SessionCompactionTest do
  @moduledoc """
  B81 CP3 机制验收：压缩作用域=会话历史。

  真实链路（存储 → 会话视图 → 跨 run 压缩 → 段追加 checkpoint → 会话级校验 → 投影折叠）：
  1) run1 以真实 canonical 形状持久化 5 个已完成交换；
  2) run2 段含 1 个已完成交换与当前作者回合；
  3) 在会话视图上派生维护计划（保留最近 K，跨 run 选择更早交换）；
  4) plan 作为 checkpoint 追加到 run2 段（段内不要求 covers 可见）；
  5) `AuthoringCheckpoint` 在会话视图上完成完整 IR/Compaction 校验（含证据 refs/versions）；
  6) Provider 投影按 call_id 折叠被覆盖的历史交换，原始消息保留；
  7) 段恢复（含跨段 checkpoint）通过，checkpoint 在 canonical 记录中。
  """

  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunPersistence
  alias NovelApplication.AuthoringCheckpoint
  alias NovelApplication.AuthoringSessionHistory
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.JudgmentProtocol
  alias NovelApplication.TranscriptCompaction
  alias NovelCommon.Contracts.{AgentEvent, ProviderOutput}
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Compaction
  alias NovelCommon.RequestIR.Projection
  alias NovelDomain.AgentRun
  alias NovelPersistence.{AgentRunLog, AuthoringSessionLog, Repo}

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  defp identity(run_id, overrides \\ %{}) do
    Map.merge(
      %{
        run_id: run_id,
        workspace_id: "ws-cp3",
        work_id: "work-cp3",
        session_id: "sess-cp3",
        parent_turn_ref: "turn-#{run_id}"
      },
      overrides
    )
  end

  defp run_record(run_id) do
    identity = identity(run_id)

    %{
      id: identity.run_id,
      workspace_id: identity.workspace_id,
      work_id: identity.work_id,
      session_id: identity.session_id,
      parent_turn_ref: identity.parent_turn_ref
    }
  end

  defp base_transcript(run_id, author_text) do
    AuthoringTranscript.new(identity(run_id),
      base_text: "会话压缩测试 Base",
      author_text: author_text,
      author_turn_ref: identity(run_id).parent_turn_ref
    )
  end

  defp append_exchange(transcript, call_id, chapter_ref) do
    transcript
    |> AuthoringTranscript.append_assistant("读取", [
      RequestIR.tool_call_block("chapter_read", %{"chapter" => chapter_ref}, call_id)
    ])
    |> AuthoringTranscript.append_observation(call_id, %{
      status: "ok",
      source_refs: [%{ref: chapter_ref}],
      versions: %{},
      content: %{text: "真实观察"}
    })
  end

  defp seed_run!(transcript, status) do
    NovelApplication.TestAgenticLoopFixtures.append_segment!(transcript, status: status)
  end

  defp first_round_transcript do
    Enum.reduce(1..5, base_transcript("run-cp3-1", "第一轮作者原话"), fn n, transcript ->
      append_exchange(transcript, "cp3-call-1-#{n}", "chapter:#{n}")
    end)
  end

  defp second_round_segment do
    base_transcript("run-cp3-2", "第二轮作者原话")
    |> append_exchange("cp3-call-2-1", "chapter:9")
  end

  test "跨 run 维护计划 + 段追加 checkpoint + 会话视图校验 + 投影折叠 + 段恢复" do
    seed_run!(first_round_transcript(), "completed")

    segment = second_round_segment()
    assert {:ok, history} = AuthoringSessionHistory.fetch(segment.run)
    view = AuthoringSessionHistory.compose(segment, history)

    # 1) 会话视图上派生计划：全会话保留最近 4 项（含当前的 1 项），整理 run1 最早 2 项。
    assert {:ok, plan} = TranscriptCompaction.plan_maintenance(view, keep_recent_items: 4)
    assert plan.scope == "earlier_work_turns"
    covered = plan.covers.call_ids
    assert covered == ["cp3-call-1-1", "cp3-call-1-2"]

    # 2) checkpoint 追加到本 run 段；段内不要求 covers 可见。
    assert {:ok, compacted_segment} = AuthoringCheckpoint.append_checkpoint(segment, plan)

    assert {:ok, ^compacted_segment} =
             AuthoringCheckpoint.append_checkpoint(compacted_segment, plan)

    assert Enum.any?(compacted_segment.messages, &(&1.role == "checkpoint"))

    # 3) 编码边界只产出真实落库形状；完整会话视图校验在写入事务内对同一
    #    run_record + segment 执行（含 Compaction 证据校验）后通过。
    assert {:ok, stored} =
             AuthoringCheckpoint.encode_segment_for_write(compacted_segment)

    assert is_map(stored)
    assert :ok = AuthoringCheckpoint.validate_segment(run_record("run-cp3-2"), stored)

    # 4) 压缩后的会话视图投影折叠被覆盖的历史交换；原始消息保留在 canonical 视图。
    compacted_view = AuthoringSessionHistory.compose(compacted_segment, history)
    assert {:ok, compacted_ir} = AuthoringTranscript.to_request_ir(compacted_view)
    assert {:ok, body} = Projection.project(compacted_ir, "chat_completions")
    projected_ids = collect_provider_message_ids(body)
    refute Enum.any?(covered, &(&1 in projected_ids))
    assert Enum.any?(view.messages, &canonical_call_id?(&1, hd(covered)))

    # 5) 段恢复：含跨段 checkpoint 的段可在会话视图校验下恢复。
    seed_run!(compacted_segment, "running")

    assert {:ok, restored, :session_segment} =
             AuthoringCheckpoint.restore(run_record("run-cp3-2"), nil)

    assert Enum.any?(restored.messages, &(&1.role == "checkpoint"))
    assert inspect(restored.messages) =~ hd(covered)
  end

  test "无更早已完成交换时维护计划返回 nothing（不产生空 checkpoint）" do
    seed_run!(base_transcript("run-cp3-only", "只此一轮"), "completed")

    assert {:ok, history} =
             AuthoringSessionHistory.fetch(identity("run-cp3-next"))

    view =
      AuthoringSessionHistory.compose(base_transcript("run-cp3-next", "下一轮"), history)

    assert {:ok, :nothing_to_compact} =
             TranscriptCompaction.plan_maintenance(view, keep_recent_items: 4)
  end

  for rounds <- [3, 10, 20], version <- ~w(v1 v2) do
    test "#{rounds} 轮纯讨论 #{version}：独立覆盖表、当前与最近 K 保护、原文不变及 JSON codec" do
      rounds = unquote(rounds)
      version = unquote(version)

      for n <- 1..(rounds - 1) do
        NovelApplication.TestAgenticLoopFixtures.append_segment!(
          discussion_segment(n),
          status: "completed"
        )
      end

      segment = discussion_segment(rounds, false)
      {:ok, history} = AuthoringSessionHistory.fetch(segment.run)
      view = AuthoringSessionHistory.compose(segment, history)
      before_rows = raw_session_rows()

      if rounds == 3 do
        assert {:ok, :nothing_to_compact} = TranscriptCompaction.plan(view)
      else
        assert {:ok, plan} = TranscriptCompaction.plan(view)

        # fixture 预注册每段为 base/Scope/author/assistant，真实 DB 坐标独立给出预期。
        expected_scope_runs = Enum.map(1..(rounds - 5), &"discussion-#{&1}")
        scope_refs = Enum.filter(plan.covers.message_refs, &(&1.role == "scope_update"))
        discussion_refs = Enum.filter(plan.covers.message_refs, &(&1.role == "assistant"))

        assert Enum.map(scope_refs, &{&1.run_id, &1.run_sequence}) ==
                 Enum.map(expected_scope_runs, &{&1, 2})

        assert Enum.map(discussion_refs, &{&1.run_id, &1.run_sequence}) ==
                 [
                   {"discussion-1", 4},
                   {"discussion-2", 4},
                   {"discussion-3", 4},
                   {"discussion-4", 4}
                 ]

        assert plan.covers.call_ids == []
        assert plan.history_target == %{session_id: "sess-cp3", turn_id: "turn-discussion-1"}

        assert Enum.map(plan.discussion_sources, & &1.author_text) ==
                 Enum.map(1..4, &discussion_author/1)

        assert plan.retained_items == rounds - 5

        # 这里只验证字节 codec/纯投影；无实际 Provider 的源不能通过提交验真。
        # 实际 Provider 准入/持久化/恢复由 TranscriptCompactionSummaryTest 验证。
        raw =
          Jason.encode!(%{
            version: "authoring-discussion-summary/#{version}",
            entries:
              Enum.map(0..3, fn index ->
                retained =
                  case version do
                    "v1" -> %{retained_obligations: [discussion_promise()]}
                    # 独立夹具：正文为第 0 行，承诺为第 1 行；不从产品分片器生成预期。
                    "v2" -> %{retained_fragment_indices: [1]}
                  end

                Map.merge(retained, %{
                  source_index: index,
                  summary: "早期方案讨论，比较仍待履行。"
                })
              end)
          }) <> "\r\n"

        discussion = %{
          response_text: raw,
          response_sha256: :crypto.hash(:sha256, raw) |> Base.encode16(case: :lower),
          provider_call_ref: "unexecuted-codec-call",
          provider_run_ref: "unexecuted-codec-run"
        }

        {:ok, compacted} =
          AuthoringCheckpoint.append_checkpoint(segment, Map.put(plan, :discussion, discussion))

        checkpoint =
          AuthoringCheckpoint.checkpoint(compacted) |> Jason.encode!() |> Jason.decode!()

        {:ok, restored} = AuthoringCheckpoint.restore_segment(checkpoint)
        [block] = List.last(restored.messages).blocks
        assert block.discussion.response_text == raw
        assert block.covers.message_refs == plan.covers.message_refs
        refute Jason.encode!(checkpoint) =~ "canonical_ref"

        {:ok, stored} = AuthoringCheckpoint.encode_segment_for_write(restored)

        assert {:error, :discussion_summary_history_mismatch} =
                 AuthoringCheckpoint.validate_segment(run_record(segment.run.run_id), stored)

        {:ok, ir} =
          restored
          |> AuthoringSessionHistory.compose(history)
          |> AuthoringTranscript.to_request_ir()

        for target <- ~w(chat_completions anthropic_messages responses_api) do
          assert {:ok, body} = Projection.project(ir, target)
          json = Jason.encode!(body)
          for n <- 1..rounds, do: assert(json =~ Jason.encode!(discussion_author(n)))
          for n <- 1..4, do: refute(json =~ Jason.encode!(discussion_reply(n)))

          for n <- (rounds - 4)..(rounds - 1),
              do: assert(json =~ Jason.encode!(discussion_reply(n)))

          assert json =~ discussion_promise()
          assert json =~ "retained_source_fragments"
          refute json =~ "retained_obligations"
          assert json =~ "model_derived_history"
        end
      end

      assert raw_session_rows() == before_rows
    end
  end

  for current_owner <- [true, false] do
    test "最近 K 计数包含受保护的完整讨论，当前 run=#{current_owner}" do
      for n <- 1..5 do
        NovelApplication.TestAgenticLoopFixtures.append_segment!(discussion_segment(n),
          status: "completed"
        )
      end

      segment =
        if unquote(current_owner) do
          discussion_segment(6)
        else
          NovelApplication.TestAgenticLoopFixtures.append_segment!(discussion_segment(6),
            status: "awaiting_author"
          )

          discussion_segment(7, false)
        end

      {:ok, history} = AuthoringSessionHistory.fetch(segment.run)
      view = AuthoringSessionHistory.compose(segment, history)
      before_rows = raw_session_rows()
      assert {:ok, plan} = TranscriptCompaction.plan(view)
      discussions = Enum.filter(plan.covers.message_refs, &(&1.role == "assistant"))

      # 六条完整讨论中最近四条是 3/4/5/6；当前或活动的第六条只能计数，不能被覆盖。
      assert Enum.map(discussions, &{&1.run_id, &1.run_sequence}) ==
               [{"discussion-1", 4}, {"discussion-2", 4}]

      assert plan.retained_items == 4
      refute Enum.any?(plan.covers.message_refs, &(&1.run_id == "discussion-6"))
      assert raw_session_rows() == before_rows
    end
  end

  test "可装入的完整来源继续推进：四条合计超预算不永久卡住，超大单条不吞原文" do
    for n <- 1..9 do
      text = if n == 1, do: String.duplicate("x", 150_000), else: String.duplicate("y", 40_000)
      transcript = discussion_segment(n, false) |> AuthoringTranscript.append_assistant(text)
      NovelApplication.TestAgenticLoopFixtures.append_segment!(transcript, status: "completed")
    end

    current = discussion_segment(10, false)
    {:ok, history} = AuthoringSessionHistory.fetch(current.run)
    view = AuthoringSessionHistory.compose(current, history)
    before_rows = raw_session_rows()
    assert {:ok, plan} = TranscriptCompaction.plan(view)
    selected = Enum.filter(plan.covers.message_refs, &(&1.role == "assistant"))
    assert Enum.map(selected, & &1.run_id) == ["discussion-2", "discussion-3", "discussion-4"]
    assert Enum.all?(plan.discussion_sources, &(byte_size(&1.text) == 40_000))

    assert {:ok, material} =
             Compaction.discussion_material(plan.discussion_sources)

    assert byte_size(material) <= 131_072
    assert raw_session_rows() == before_rows

    assert Enum.any?(
             view.messages,
             &(Map.get(&1, :role) == "assistant" and
                 Projection.text_of(&1.blocks) ==
                   String.duplicate("x", 150_000))
           )
  end

  defp discussion_segment(n, with_reply \\ true) do
    id = "discussion-#{n}"

    transcript =
      AuthoringTranscript.new(identity(id),
        base_text: "稳定会话说明",
        initial_scope: %{
          content: %{work_id: "work-cp3", context: %{marker: "Scope #{n}"}},
          versions: %{"scope_revision" => 1},
          source_refs: [%{ref: "context:#{id}", version: 1}]
        },
        author_text: discussion_author(n),
        author_turn_ref: "turn-#{id}"
      )

    if with_reply,
      do: AuthoringTranscript.append_assistant(transcript, discussion_reply(n)),
      else: transcript
  end

  defp discussion_author(n), do: "  第 #{n} 轮：保留两种方案。\r\n待确定视角后比较代价。  "
  defp discussion_promise, do: "等你确定视角后，我还会把第二方案与第三方案的代价逐项比较。"

  defp discussion_reply(n),
    do:
      "第 #{n} 轮完整的早期方案论证。" <>
        String.duplicate("论证细节。", 100) <> "\n" <> discussion_promise()

  defp raw_session_rows do
    Repo.query!(
      "SELECT run_id, run_sequence, message FROM authoring_session_messages WHERE session_id = ? ORDER BY sequence",
      ["sess-cp3"]
    ).rows
  end

  # B81 ADR-0035 回归：判断请求组装会话历史，但持久化仍只落本 run 段。
  describe "B81 ADR-0035：判断请求组装会话历史" do
    @history_author_text "第一轮作者原话"
    @current_author_text "本轮作者原话：继续判断"
    @old_plan_call_id "tool-agent_plan_draft"

    test "跨段 checkpoint 覆盖历史已闭合调用时，判断出站成功且保存段不含历史作者原话" do
      seed_run!(first_round_transcript(), "completed")

      assert {:ok, segment} =
               base_transcript("run-cp3-b81-1", @current_author_text)
               |> AuthoringCheckpoint.append_checkpoint(%{
                 covers: %{call_ids: ["cp3-call-1-1"], message_refs: []},
                 source_refs: [%{ref: "chapter:1"}],
                 versions: %{},
                 omissions: ["被覆盖的读取原文保留在会话历史中。"],
                 summary: "跨段压缩历史读取"
               })

      assert {:ok, history} = AuthoringSessionHistory.fetch(segment.run)

      assert {:ok, judgment} =
               JudgmentProtocol.request_judgment(
                 execution([response("本轮判断完成。", [])]),
                 %{},
                 b81_input(segment, history, @current_author_text)
               )

      # 跨段 checkpoint 的 covers 只在会话视图可见；调用必须真实发生且携带历史作者原话。
      assert_received {:provider_request, %RequestIR{messages: request_messages}}
      assert Enum.any?(request_messages, &message_has_text?(&1, @history_author_text))

      # 保存/返回的 transcript 仍是本 run 段：无历史作者原话，只有本轮作者原话。
      assert judgment.transcript.run.run_id == "run-cp3-b81-1"
      refute Enum.any?(judgment.transcript.messages, &message_has_text?(&1, @history_author_text))
      assert Enum.any?(judgment.transcript.messages, &message_has_text?(&1, @current_author_text))
    end

    test "已组装标记视图作为当前 transcript 且 input 无显式历史时，协议层保留会话前缀给外层" do
      seed_run!(base_transcript("run-cp3-view-1", "更早会话作者原话"), "completed")

      segment = base_transcript("run-cp3-view-2", @current_author_text)
      assert {:ok, history} = AuthoringSessionHistory.fetch(segment.run)
      view = AuthoringSessionHistory.compose(segment, history)
      assert Enum.any?(view.messages, &(Map.get(&1, :session_history_run_id) == "run-cp3-view-1"))

      input =
        b81_input(view, nil, @current_author_text)
        |> Map.delete(:session_history)

      assert {:ok, judgment} =
               JudgmentProtocol.request_judgment(
                 execution([response("本轮判断完成。", [])]),
                 %{},
                 input
               )

      assert_received {:provider_request, %RequestIR{messages: request_messages}}
      assert Enum.any?(request_messages, &message_has_text?(&1, "更早会话作者原话"))

      # 外层 AuthoringSession 仍需按归属剥离；协议层不得提前移除会话视图前缀。
      assert Enum.any?(
               judgment.transcript.messages,
               &message_has_text?(&1, "更早会话作者原话")
             )

      assert Enum.any?(
               judgment.transcript.messages,
               &(Map.get(&1, :session_history_run_id) == "run-cp3-view-1")
             )
    end

    test "历史已闭合同名 agent_plan_draft 复用时 canonical 化并保留 provider_call_id" do
      history_transcript =
        base_transcript("run-cp3-b81-history-2", "历史作者原话：上一轮计划")
        |> AuthoringTranscript.append_assistant("", [
          RequestIR.tool_call_block(
            "agent_plan_draft",
            plan_args(),
            @old_plan_call_id
          )
        ])
        |> AuthoringTranscript.append_validation(
          @old_plan_call_id,
          "passed",
          "agent_plan_validated"
        )

      seed_run!(history_transcript, "completed")

      current_author_text = "本轮作者原话：继续计划"
      segment = base_transcript("run-cp3-b81-2", current_author_text)
      assert {:ok, history} = AuthoringSessionHistory.fetch(segment.run)

      assert {:ok, judgment} =
               JudgmentProtocol.request_judgment(
                 execution([response("", plan_calls())]),
                 %{},
                 b81_input(segment, history, current_author_text)
               )

      decision =
        Enum.find(tool_call_blocks(judgment.transcript), &(&1.name == "agent_plan_draft"))

      # 返回值与落段使用同一 canonical id；原 id 只作来源标记，旧 id 不写回本 run 段。
      assert decision.call_id == judgment.tool_call_id
      assert judgment.tool_call_id == @old_plan_call_id <> ":2"
      assert Map.get(decision, :provider_call_id) == @old_plan_call_id
      refute @old_plan_call_id in judgment.transcript.call_ids
    end

    defp b81_input(segment, history, author_text) do
      {:ok, run} =
        segment.run
        |> Map.merge(%{
          origin_frame_ref: "frame-#{segment.run.run_id}",
          profile_ref: "judgment_plan_v1",
          goal: %{text: author_text, version: 1},
          authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]}
        })
        |> AgentRun.new()

      %{
        author_text: author_text,
        scope: %{work_id: segment.run.work_id, facts: %{}, context: %{}, coverage: %{}},
        source_input_ref: segment.run.parent_turn_ref,
        supplied_context_refs: ["chapter:one"],
        options: [plan_run: run],
        transcript: segment,
        session_history: history
      }
    end

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

    defp plan_calls do
      [call("agent_plan_draft", plan_args())]
    end

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

    defp execution(results) do
      parent = self()
      ref = make_ref()
      Process.put(ref, results)

      %Execution{
        result_fn: fn prompt ->
          send(parent, {:provider_request, prompt})
          [result | rest] = Process.get(ref)
          Process.put(ref, if(rest == [], do: [result], else: rest))

          if match?({:error, _}, result), do: result, else: {:ok, result}
        end
      }
    end

    defp tool_call_blocks(%{messages: messages}) do
      for message <- messages,
          block <- message.blocks,
          Map.get(block, :type) == "tool_call",
          do: block
    end

    defp message_has_text?(%{blocks: blocks}, text),
      do: Enum.any?(blocks, &(Map.get(&1, :text) == text))
  end

  # B81 CP3 并发回归：两个写者基于同一份旧会话历史各自准备压缩提交。第二个写者
  # 必须在写入事务内按最新历史被拒绝，且整个事务回滚；否则两个 checkpoint 覆盖同一
  # call，之后的真实恢复全部报 `:checkpoint_already_applied`。
  describe "B81 CP3 并发压缩提交" do
    @race_workspace "ws-cp3-race"
    @race_work "work-cp3-race"
    @race_session "sess-cp3-race"

    test "同一旧快照准备的两个压缩提交，第二个被拒绝且全事务回滚，B 可恢复" do
      run_a = race_run("run-cp3-race-a", :completed)
      transcript_a = race_closed_exchanges("run-cp3-race-a", "A 的作者原话", 5)

      assert {:ok, snapshot_a} =
               AgentRunPersistence.snapshot(run_a, race_state(transcript_a), :delivery)

      assert {:ok, _run_a} = AgentRunPersistence.commit(snapshot_a)

      prepared_b = prepare_race_compaction("run-cp3-race-b", "B 的作者原话")

      prepared_c =
        prepare_race_compaction("run-cp3-race-c", "C 的作者原话", [race_event("run-cp3-race-c")])

      # 两个计划都基于同一份旧历史（仅 A），覆盖同一批 call。
      assert prepared_b.plan.covers.call_ids == prepared_c.plan.covers.call_ids
      assert prepared_b.plan.covers.call_ids != []

      assert {:ok, _run_b} = AgentRunPersistence.commit(prepared_b.snapshot)

      # 控制组：B 提交后 A 的会话视图仍可恢复；失败只应出现在第二个写者。
      assert {:ok, _restored_a, :session_segment} =
               AuthoringCheckpoint.restore(AgentRunLog.get_run("run-cp3-race-a"), nil)

      assert {:error, :checkpoint_already_applied} =
               AgentRunPersistence.commit(prepared_c.snapshot)

      # 全事务回滚：C 的 run/段/消息/事件都不存在，会话只有 B 的一条 checkpoint。
      refute AgentRunLog.get_run("run-cp3-race-c")
      assert {:ok, nil} = AuthoringSessionLog.fetch_run_segment("run-cp3-race-c")

      assert {:ok, %{rows: rows}} = AuthoringSessionLog.fetch_session(@race_session)
      refute Enum.any?(rows, &(&1.run_id == "run-cp3-race-c"))

      assert AgentRunLog.list_events("run-cp3-race-c") == []
      assert length(race_checkpoints()) == 1

      # B 与 A 均可恢复；重新规划按最新状态不再选择已覆盖交换。
      assert {:ok, restored_b, :session_segment} =
               AuthoringCheckpoint.restore(AgentRunLog.get_run("run-cp3-race-b"), nil)

      assert Enum.any?(restored_b.messages, &(&1.role == "checkpoint"))

      assert {:ok, _restored_a_after, :session_segment} =
               AuthoringCheckpoint.restore(AgentRunLog.get_run("run-cp3-race-a"), nil)

      assert {:ok, history} =
               AuthoringSessionHistory.fetch(race_identity("run-cp3-race-d"))

      view =
        AuthoringSessionHistory.compose(
          race_transcript("run-cp3-race-d", "D 的作者原话"),
          history
        )

      assert {:ok, :nothing_to_compact} =
               TranscriptCompaction.plan_maintenance(view, keep_recent_items: 4)
    end

    defp prepare_race_compaction(run_id, author_text, events \\ []) do
      run = race_run(run_id, :running)
      transcript = race_transcript(run_id, author_text)

      assert {:ok, history} = AuthoringSessionHistory.fetch(run)
      view = AuthoringSessionHistory.compose(transcript, history)
      assert {:ok, plan} = TranscriptCompaction.plan_maintenance(view, keep_recent_items: 4)
      assert {:ok, compacted} = AuthoringCheckpoint.append_checkpoint(transcript, plan)

      assert {:ok, snapshot} =
               AgentRunPersistence.snapshot(run, race_state(compacted), :compaction,
                 events: events
               )

      %{snapshot: snapshot, plan: plan}
    end

    defp race_checkpoints do
      assert {:ok, %{rows: rows}} = AuthoringSessionLog.fetch_session(@race_session)
      Enum.filter(rows, &(&1.role == "checkpoint"))
    end

    defp race_closed_exchanges(run_id, author_text, count) do
      Enum.reduce(1..count, race_transcript(run_id, author_text), fn n, transcript ->
        append_exchange(transcript, "cp3-race-call-#{n}", "chapter:#{n}")
      end)
    end

    defp race_transcript(run_id, author_text) do
      AuthoringTranscript.new(race_identity(run_id),
        base_text: "B81 CP3 并发压缩 Base",
        author_text: author_text,
        author_turn_ref: "input:race:#{run_id}"
      )
    end

    defp race_identity(run_id) do
      identity(run_id, %{
        workspace_id: @race_workspace,
        work_id: @race_work,
        session_id: @race_session
      })
    end

    defp race_state(transcript) do
      %{events: [], event_sequence: 0, stage_state: %{judgment_transcript: transcript}}
    end

    defp race_event(run_id) do
      %AgentEvent{
        event_id: "evt-#{run_id}",
        run_ref: run_id,
        sequence: 1,
        event_type: :checkpoint_created,
        visibility: :author,
        summary: "整理完成",
        reason_codes: [],
        refs: [],
        payload: %{}
      }
    end

    defp race_run(run_id, status) do
      %AgentRun{
        run_id: run_id,
        workspace_id: @race_workspace,
        work_id: @race_work,
        session_id: @race_session,
        parent_turn_ref: "turn-#{run_id}",
        origin_frame_ref: "frame-#{run_id}",
        profile_ref: "conversation_turn_v1",
        goal: %{text: "B81 CP3 并发压缩", version: 1},
        status: status,
        phase: if(status == :completed, do: :finalizing, else: :executing),
        authority_scope: %{production_write: false, allowed_tools: []}
      }
    end
  end

  defp collect_provider_message_ids(body) do
    messages = Map.get(body, :messages) || Map.get(body, "messages") || []

    Enum.flat_map(messages, fn message ->
      tool_calls = Map.get(message, :tool_calls) || Map.get(message, "tool_calls") || []

      ids =
        Enum.map(tool_calls, fn call ->
          Map.get(call, :id) || Map.get(call, "id")
        end)

      ids ++ [Map.get(message, :tool_call_id) || Map.get(message, "tool_call_id")]
    end)
    |> Enum.reject(&is_nil/1)
  end

  defp canonical_call_id?(message, call_id) do
    Enum.any?(Map.get(message, :blocks, []), fn block ->
      Map.get(block, :type) == "tool_call" and Map.get(block, :call_id) == call_id
    end)
  end
end
