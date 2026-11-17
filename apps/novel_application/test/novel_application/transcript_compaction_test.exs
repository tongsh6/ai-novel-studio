defmodule NovelApplication.TranscriptCompactionTest do
  @moduledoc """
  B71 P2（VS-00L §16.2/§16.4）：显式压缩的派生与执行边界。

  覆盖从 canonical 事实派生命中范围、证据和摘要，以及原始交换保留与投影折叠；
  真实 Channel/页面消费者见 `workspace_channel_compaction_test.exs`。
  """

  use ExUnit.Case, async: true

  alias NovelApplication.AuthoringCheckpoint
  alias NovelApplication.AuthoringReplay
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.TranscriptCompaction
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Compaction
  alias NovelCommon.RequestIR.Projection

  @author_text "先读取沈砚的当前叙事身份，再给出把主角改为顾青的 tentative 候选。"
  @internal_marker ~r/\b(?:RequestIR|request_ir|provider_session|reasoning_content|call_id|tool_call)\b|\b(?:call_|run_|turn_|ctx_|trace_|pc_)[a-z0-9_-]+|\b(?:chapter|work|character):[a-z0-9_-]+/i

  defp run do
    %{
      run_id: "run-compaction-1",
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      parent_turn_ref: "turn-1",
      goal: %{text: @author_text}
    }
  end

  defp base_transcript(run_identity \\ run(), opts \\ []) do
    AuthoringTranscript.new(
      run_identity,
      Keyword.merge(
        [
          base_text: "run goal: 读取角色事实后给出 tentative 候选",
          author_text: @author_text,
          author_turn_ref: "turn-1",
          tools: [%{name: "read_character", description: "读取角色", input_schema: %{type: "object"}}]
        ],
        opts
      )
    )
  end

  defp tool_call(call_id, tool \\ "read_character") do
    RequestIR.tool_call_block(tool, %{"character_ref" => "character:1"}, call_id)
  end

  defp observation(call_id, opts) do
    refs = Keyword.get(opts, :source_refs, [%{ref: "character:1", version: 2}])
    versions = Keyword.get(opts, :versions, %{"character:1" => 2})

    {call_id,
     %{
       status: "ok",
       source_refs: refs,
       versions: versions,
       content: Keyword.get(opts, :content, %{summary: "已读取角色"})
     }}
  end

  defp append_exchange(transcript, call_id, opts \\ []) do
    {call_id, payload} = observation(call_id, opts)

    transcript
    |> AuthoringTranscript.append_assistant("读取角色。", [tool_call(call_id)])
    |> AuthoringTranscript.append_observation(call_id, payload)
  end

  test "指定 K=0 时只选择更早完整交换，原始事实不变而 Provider 投影折叠" do
    transcript =
      base_transcript()
      |> append_exchange("call-1")
      |> AuthoringTranscript.append_scope_update(
        %{work_id: "work-1", operation: %{exploration: %{allowed: false}}},
        %{"scope_revision" => 2},
        [],
        []
      )
      |> append_exchange("call-2",
        source_refs: [%{ref: "character:2", version: 5}],
        versions: %{"character:2" => 5}
      )

    transcript = begin_next_turn(transcript)

    before = transcript.messages

    assert {:ok, plan} = TranscriptCompaction.plan_maintenance(transcript, keep_recent_items: 0)

    assert plan.covers == %{
             call_ids: ["call-1", "call-2"],
             message_refs: [],
             turn_range: "turn-1"
           }

    assert plan.source_refs == [
             %{ref: "character:1", version: 2},
             %{ref: "character:2", version: 5}
           ]

    assert plan.versions == %{"character:1" => 2, "character:2" => 5}
    assert [_ | _] = plan.omissions

    # 派生器是纯函数：不改写 canonical transcript。
    assert transcript.messages == before

    # 与机制层端到端：派生 plan 可直接追加 checkpoint。
    assert {:ok, %{call_ids: ["call-1", "call-2"]} = compacted} =
             AuthoringTranscript.compact(
               transcript,
               plan.covers,
               plan.source_refs,
               plan.versions,
               plan.omissions,
               plan.summary
             )

    assert Enum.take(compacted.messages, length(before)) == before
    assert Enum.count(compacted.messages, &(&1.role == "checkpoint")) == 1
    assert {:ok, ir} = AuthoringTranscript.to_request_ir(compacted)
    assert :ok = Compaction.validate(ir.messages)
    assert {:ok, body} = Projection.project(ir, "chat_completions")

    # checkpoint 是唯一压缩表达：模型可见覆盖范围，但被覆盖的工具往返不再出现。
    refute Enum.any?(body.messages, &(&1.role == "tool"))
    assert inspect(body) =~ "checkpoint"
    assert inspect(body) =~ "call-1"
    assert inspect(body) =~ "2 项已完成操作"
  end

  test "计划聚合的完整父交换进入 checkpoint 时，版本与来源来自各叶" do
    page1_versions = %{"draft:page-1" => 1}
    page2_versions = %{"draft:page-2" => 7}

    payload = %{
      status: "ok",
      source_refs: [%{ref: "chapter:1", version: 3}],
      coverage: %{},
      omissions: [],
      content: %{
        tool: "planned_exploration",
        summary: "计划内只读检索完成（2 次）",
        observations: [
          %{
            status: "ok",
            source_refs: [%{ref: "draft:page-1", version: 1}],
            versions: page1_versions,
            coverage: %{"prose_range" => %{"start" => 1, "end" => 6000}},
            omissions: [],
            next_offset: 6000,
            content: %{
              tool: "chapter_read",
              summary: "第 1 页",
              observation_ref: "observation:obs_page_1"
            }
          },
          %{
            status: "ok",
            source_refs: [%{ref: "draft:page-2", version: 7}],
            versions: page2_versions,
            coverage: %{"prose_range" => %{"start" => 6001, "end" => 7000}},
            omissions: [],
            next_offset: nil,
            content: %{
              tool: "chapter_read",
              summary: "第 2 页",
              observation_ref: "observation:obs_page_2"
            }
          }
        ]
      }
    }

    transcript =
      base_transcript()
      |> AuthoringTranscript.append_assistant("读取同章两页。", [tool_call("call-plan")])
      |> AuthoringTranscript.append_observation("call-plan", payload)

    transcript = begin_next_turn(transcript)

    before = transcript.messages

    assert {:ok, plan} = TranscriptCompaction.plan_maintenance(transcript, keep_recent_items: 0)
    assert plan.covers.call_ids == ["call-plan"]

    assert Enum.map(plan.source_refs, &(Map.get(&1, :ref) || Map.get(&1, "ref"))) ==
             ["draft:page-1", "draft:page-2"]

    # 两页不同 draft ref：若只读顶层或后页覆盖，前页版本会丢失。
    assert plan.versions == %{"draft:page-1" => 1, "draft:page-2" => 7}

    assert {:ok, %{call_ids: ["call-plan"]} = compacted} =
             AuthoringTranscript.compact(
               transcript,
               plan.covers,
               plan.source_refs,
               plan.versions,
               plan.omissions,
               plan.summary
             )

    assert {:ok, ir} = AuthoringTranscript.to_request_ir(compacted)
    assert :ok = Compaction.validate(ir.messages)

    # checkpoint 自身携带两页各自的版本，而不是聚合顶层空 versions。
    assert [%{blocks: [checkpoint]}] =
             Enum.filter(compacted.messages, &(&1.role == "checkpoint"))

    assert checkpoint.versions == %{"draft:page-1" => 1, "draft:page-2" => 7}

    # canonical 原始交换仍在，checkpoint 只是追加视图。
    assert Enum.take(compacted.messages, length(before)) == before

    assert [%{blocks: [observation]}] =
             Enum.filter(compacted.messages, &(&1.role == "tool"))

    assert observation.content["tool"] == "planned_exploration"

    assert Enum.map(observation.content["observations"], & &1["versions"]) ==
             [page1_versions, page2_versions]
  end

  test "未完成的交换不进入压缩范围，等待真实结果后才可整理" do
    transcript =
      base_transcript()
      |> append_exchange("call-1")
      |> begin_next_turn()
      |> AuthoringTranscript.append_assistant("再次读取。", [tool_call("call-2")])

    transcript = begin_next_turn(transcript)

    assert {:ok, plan} = TranscriptCompaction.plan_maintenance(transcript, keep_recent_items: 0)
    assert plan.covers == %{call_ids: ["call-1"], message_refs: [], turn_range: "turn-1"}
  end

  test "已经整理过的交换不重复覆盖；没有剩余交换时报 nothing_to_compact" do
    transcript = base_transcript() |> append_exchange("call-1")

    transcript = begin_next_turn(transcript)

    assert {:ok, plan} = TranscriptCompaction.plan_maintenance(transcript, keep_recent_items: 0)
    assert plan.covers == %{call_ids: ["call-1"], message_refs: [], turn_range: "turn-1"}

    assert {:ok, compacted} =
             AuthoringTranscript.compact(
               transcript,
               plan.covers,
               plan.source_refs,
               plan.versions,
               plan.omissions,
               plan.summary
             )

    assert {:ok, :nothing_to_compact} =
             TranscriptCompaction.plan_maintenance(compacted, keep_recent_items: 0)

    assert %{compacted: false, reason: :nothing_to_compact} =
             TranscriptCompaction.receipt(:nothing_to_compact)
  end

  test "并行多调用整条选择，不产生 mechanism 拒绝的部分覆盖" do
    transcript =
      base_transcript()
      |> AuthoringTranscript.append_assistant("并行核查。", [
        tool_call("call-1"),
        tool_call("call-2")
      ])
      |> AuthoringTranscript.append_observation("call-1", %{
        status: "ok",
        source_refs: [%{ref: "character:1", version: 2}],
        versions: %{"character:1" => 2},
        content: %{summary: "角色"}
      })
      |> AuthoringTranscript.append_observation("call-2", %{
        status: "ok",
        source_refs: [],
        versions: %{},
        content: %{summary: "设定"}
      })

    transcript = begin_next_turn(transcript)

    assert {:ok, plan} = TranscriptCompaction.plan_maintenance(transcript, keep_recent_items: 0)

    assert plan.covers == %{
             call_ids: ["call-1", "call-2"],
             message_refs: [],
             turn_range: "turn-1"
           }

    assert plan.source_refs == [%{ref: "character:1", version: 2}]
    assert plan.versions == %{"character:1" => 2}
  end

  test "损坏的重复结果明确拒绝，不以空整理掩盖坏历史" do
    transcript =
      base_transcript()
      |> append_exchange("call-1")
      |> AuthoringTranscript.append_observation("call-1", %{
        status: "ok",
        source_refs: [%{ref: "character:1", version: 2}],
        versions: %{"character:1" => 2},
        content: %{summary: "重复结果"}
      })
      |> AuthoringTranscript.append_assistant("另一个待完成调用。", [tool_call("call-9")])

    # 重复结果破坏 canonical 绑定；未完成的合法交换由独立用例保护。
    transcript = begin_next_turn(transcript)

    assert {:error, :duplicate_tool_result_for_call} =
             TranscriptCompaction.plan_maintenance(transcript, keep_recent_items: 0)
  end

  test "空 transcript 或没有已完成交换时返回 nothing_to_compact" do
    assert {:ok, :nothing_to_compact} = TranscriptCompaction.plan(base_transcript())

    only_author_exit =
      base_transcript()
      |> AuthoringTranscript.append_author_exit("ask_author", %{})

    assert {:ok, :nothing_to_compact} = TranscriptCompaction.plan(only_author_exit)
  end

  test "回执只含作者语义：数量、摘要、省略与已有来源显示名，不含内部标识" do
    transcript =
      base_transcript()
      |> append_exchange("call-1",
        source_refs: [%{ref: "character:1", version: 2, display_name: "沈砚"}],
        versions: %{"character:1" => 2}
      )
      |> append_exchange("call-2", source_refs: [], versions: %{})

    transcript = begin_next_turn(transcript)

    assert {:ok, plan} = TranscriptCompaction.plan_maintenance(transcript, keep_recent_items: 0)

    assert %{
             compacted: true,
             covered_counts: %{tool_exchanges: 2, scope_updates: 0, discussion_messages: 0}
           } = TranscriptCompaction.receipt(plan)

    assert {:ok, compacted} =
             AuthoringTranscript.compact(
               transcript,
               plan.covers,
               plan.source_refs,
               plan.versions,
               plan.omissions,
               plan.summary
             )

    # 作者可见面由既有 AuthoringReplay 统一投影（AgentRunServer 回执同源）。
    assert [author_view] = AuthoringReplay.checkpoint_summaries(compacted)

    assert author_view.summary =~ "2 项已完成操作"
    assert author_view.omissions != []
    assert author_view.source_names == ["沈砚"]

    visible = inspect(author_view)
    refute visible =~ "call-1"
    refute visible =~ "call-2"
    refute visible =~ "character:1"
    refute Regex.match?(@internal_marker, author_view.summary)
    refute Enum.any?(author_view.omissions, &Regex.match?(@internal_marker, &1))

    # 摘要不冒充已读或已采纳事实。
    refute author_view.summary =~ "已读"
    refute author_view.summary =~ "采纳"
    refute author_view.summary =~ "确认"
  end

  test "同一 transcript 的 plan 是确定性的，连续调用得到完全相同结果" do
    transcript =
      base_transcript()
      |> append_exchange("call-1")
      |> append_exchange("call-2",
        source_refs: [%{ref: "character:2", version: 3}],
        versions: %{"character:2" => 3}
      )

    transcript = begin_next_turn(transcript)

    assert {:ok, plan} = TranscriptCompaction.plan_maintenance(transcript, keep_recent_items: 0)

    assert plan.covers == %{
             call_ids: ["call-1", "call-2"],
             message_refs: [],
             turn_range: "turn-1"
           }

    assert TranscriptCompaction.plan_maintenance(transcript, keep_recent_items: 0) == {:ok, plan}
  end

  test "nil transcript 如实返回 transcript_not_found，不伪造成功" do
    assert {:error, :transcript_not_found} = TranscriptCompaction.plan(nil)
    assert {:error, :transcript_not_found} = TranscriptCompaction.plan(%{})
  end

  test "无可绑定作者回合时拒绝派生压缩范围，不伪造 turn_range" do
    transcript =
      AuthoringTranscript.new(run(),
        base_text: "run goal: 不绑定作者回合的续行",
        allow_authorless: true,
        tools: [
          %{name: "read_character", description: "读取角色", input_schema: %{type: "object"}}
        ]
      )
      |> append_exchange("call-1")

    transcript = begin_next_turn(transcript)

    assert {:error, :checkpoint_turn_range_unavailable} =
             TranscriptCompaction.plan_maintenance(transcript, keep_recent_items: 0)
  end

  # ── 安全点维护派生（VS-00L §18 提案方向；阶段 4 基础设施） ─────────────────

  test "维护派生保留当前工作回合，不整理最后一条作者消息之后的交换" do
    transcript =
      base_transcript()
      |> append_exchange("call-1")
      |> AuthoringTranscript.append_author_turn("继续写下一场。", "author_turn:turn-2")
      |> append_exchange("call-2")

    # keep=0 隔离验证「当前工作回合永不整理」；默认 K=4 由下一用例单独验证。
    assert {:ok, plan} = TranscriptCompaction.plan_maintenance(transcript, keep_recent_items: 0)
    assert plan.covers == %{call_ids: ["call-1"], message_refs: [], turn_range: "turn-1"}
    assert plan.scope == "earlier_work_turns"
    # 当前工作回合的交换（call-2）不计入整理范围，只作为保留项计数。
    assert plan.retained_items == 1

    # 内部显式入口与维护共用当前回合和默认最近 K 保护，不能从旁路删当前消息。
    assert {:ok, :nothing_to_compact} = TranscriptCompaction.plan(transcript)
  end

  test "维护派生保留最近 keep_recent_items 项，只整理更早的交换" do
    transcript =
      base_transcript()
      |> append_exchange("call-1")
      |> append_exchange("call-2")
      |> append_exchange("call-3")
      |> append_exchange("call-4")
      |> AuthoringTranscript.append_author_turn("继续。", "author_turn:turn-2")
      |> append_exchange("call-5")

    assert {:ok, plan} = TranscriptCompaction.plan_maintenance(transcript, keep_recent_items: 2)

    assert plan.covers == %{
             call_ids: ["call-1", "call-2", "call-3"],
             message_refs: [],
             turn_range: "turn-1"
           }

    # 全会话最近 2 项为 call-4/5，当前回合 call-5 同时受整回合保护。
    assert plan.retained_items == 2
  end

  test "当前初始 Scope 在无完整项或只有待完成调用时仍整回合保留" do
    transcript =
      base_transcript(run(),
        initial_scope: %{
          content: %{work_id: "work-1"},
          versions: %{"scope_revision" => 1},
          source_refs: []
        }
      )
      |> AuthoringTranscript.append_scope_update(
        %{work_id: "work-1"},
        %{"scope_revision" => 2},
        [],
        []
      )

    pending = AuthoringTranscript.append_assistant(transcript, "仍待工具完成。", [tool_call("pending")])

    for current <- [transcript, pending] do
      assert {:ok, :nothing_to_compact} =
               TranscriptCompaction.plan_maintenance(current, keep_recent_items: 0)
    end

    assert {:ok, plan} =
             transcript
             |> begin_next_turn()
             |> TranscriptCompaction.plan_maintenance(keep_recent_items: 0)

    assert plan.covers.call_ids == []
    assert [%{run_sequence: 2, role: "scope_update"}] = plan.covers.message_refs
  end

  test "只有当前工作回合时维护派生出幂等空结果（不整理）" do
    transcript = base_transcript() |> append_exchange("call-1")

    assert {:ok, :nothing_to_compact} =
             TranscriptCompaction.plan_maintenance(transcript)

    assert {:ok, :nothing_to_compact} = TranscriptCompaction.plan(transcript)
  end

  test "全部交换都在保留线内时维护派生不产生 plan" do
    transcript =
      base_transcript()
      |> append_exchange("call-1")
      |> append_exchange("call-2")
      |> AuthoringTranscript.append_author_turn("继续。", "author_turn:turn-2")

    assert {:ok, :nothing_to_compact} =
             TranscriptCompaction.plan_maintenance(transcript, keep_recent_items: 4)
  end

  test "维护派生排除未完成与已覆盖交换，且非法参数使用默认保留项" do
    transcript =
      base_transcript()
      |> append_exchange("call-1")
      |> append_exchange("call-2")
      |> append_exchange("call-3")
      |> append_exchange("call-4")
      |> append_exchange("call-5")
      |> AuthoringTranscript.append_author_turn("继续。", "author_turn:turn-2")
      |> AuthoringTranscript.append_assistant("待完成。", [
        RequestIR.tool_call_block("read_character", %{}, "call-pending")
      ])

    # 非法参数回退默认 K=4：只整理最早的第 1 项；未完成交换不选。
    assert {:ok, plan} =
             TranscriptCompaction.plan_maintenance(transcript, keep_recent_items: "bad")

    assert plan.covers == %{call_ids: ["call-1"], message_refs: [], turn_range: "turn-1"}
    assert plan.retained_items == 4
  end

  describe "显式压缩保留原始作者与来源事实" do
    setup do
      run_identity = %{
        run_id: "run-ir-1",
        work_id: "work-1",
        workspace_id: "ws-1",
        goal: %{text: @author_text}
      }

      %{
        base:
          base_transcript(run_identity,
            author_turn_ref: "author_turn:turn-1",
            base_refs: [%{ref: "work:work-1", version: 3}]
          )
      }
    end

    test "checkpoint 与 author_exit：显式压缩、无伪作者消息", %{base: base} do
      {:ok, compacted} =
        base
        |> AuthoringTranscript.append_assistant("读取角色。", [tool_call("call-1")])
        |> AuthoringTranscript.append_observation("call-1", character_observation())
        |> begin_next_turn()
        |> AuthoringTranscript.compact(
          %{call_ids: ["call-1"], message_refs: [], turn_range: "turn-1..turn-20"},
          [%{ref: "character:1", version: 2}],
          %{"character:1" => 2},
          ["对话细节"],
          "前 20 轮摘要。"
        )

      transcript =
        AuthoringTranscript.append_author_exit(compacted, "author_decision_required", %{
          question_ref: "question:1"
        })

      assert {:ok, ir} = AuthoringTranscript.to_request_ir(transcript)
      {:ok, body} = Projection.project(ir, "chat_completions")

      checkpoint_message =
        Enum.find(body.messages, &(is_binary(&1.content) and &1.content =~ "checkpoint"))

      assert checkpoint_message.content =~ "turn-1..turn-20"
      refute inspect(body) =~ "author_exit"
      refute Enum.any?(body.messages, &(&1.role == "tool"))
    end

    test "显式压缩只改变 Provider 投影，canonical 原始交换与作者字节仍可回查", %{base: base} do
      transcript =
        base
        |> AuthoringTranscript.append_assistant("读取角色。", [tool_call("call-1")])
        |> AuthoringTranscript.append_observation("call-1", character_observation())
        |> AuthoringTranscript.append_scope_update(
          %{work_id: "work-1", operation: %{exploration: %{allowed: false}}},
          %{"scope_revision" => 2},
          [],
          []
        )
        |> AuthoringTranscript.declare_used_refs(["character:1"])
        |> begin_next_turn()

      assert {:ok, compacted} = compact(transcript, ["call-1"])
      assert Enum.take(compacted.messages, length(transcript.messages)) == transcript.messages
      assert compacted.call_ids == transcript.call_ids
      assert compacted.observation_refs == transcript.observation_refs

      assert AuthoringTranscript.current_scope(compacted) ==
               AuthoringTranscript.current_scope(transcript)

      assert compact(compacted, ["call-1"]) == {:ok, compacted}
      assert {:error, :checkpoint_already_applied} = compact(compacted, ["call-1"], "不同摘要")

      for target <- ["chat_completions", "anthropic_messages", "responses_api"] do
        assert {:ok, ir} = AuthoringTranscript.to_request_ir(compacted)
        assert {:ok, body} = Projection.project(ir, target)
        refute provider_call_ids(body) |> Enum.member?("call-1")
        assert inspect(body) =~ "已读取角色"
        assert inspect(body) =~ @author_text
        assert inspect(body) =~ "省略工具调用的逐字内容"
        refute inspect(body) =~ "ENSEMBLE_POV"
      end

      assert {:ok, restored} =
               compacted
               |> AuthoringCheckpoint.checkpoint()
               |> Jason.encode!()
               |> Jason.decode!()
               |> AuthoringTranscript.restore()

      assert Jason.encode!(restored.messages) == Jason.encode!(compacted.messages)
      assert inspect(restored.messages) =~ "ENSEMBLE_POV"
      assert {:ok, restored_ir} = AuthoringTranscript.to_request_ir(restored)

      assert Projection.project(restored_ir, "chat_completions") ==
               Projection.project(
                 elem(AuthoringTranscript.to_request_ir(compacted), 1),
                 "chat_completions"
               )
    end

    test "压缩必须精确选择实际已闭合交换，不接受任意范围说明", %{base: base} do
      transcript =
        base
        |> AuthoringTranscript.append_assistant("读取角色。", [tool_call("call-1")])
        |> AuthoringTranscript.append_observation("call-1", character_observation())
        |> begin_next_turn()

      assert {:error, :checkpoint_selection_required} =
               AuthoringTranscript.compact(
                 transcript,
                 %{turn_range: "另一轮"},
                 [],
                 %{},
                 ["省略"],
                 "摘要"
               )

      assert {:error, :checkpoint_unknown_call} = compact(transcript, ["missing-call"])
      assert {:error, :checkpoint_invalid_call_ids} = compact(transcript, ["call-1", "call-1"])

      assert {:error, :checkpoint_omissions_required} =
               AuthoringTranscript.compact(
                 transcript,
                 %{call_ids: ["call-1"], message_refs: []},
                 [],
                 %{},
                 [],
                 "摘要"
               )

      pending =
        AuthoringTranscript.append_assistant(base, "读取角色。", [tool_call("call-1")])

      assert {:error, :checkpoint_incomplete_exchange} = compact(pending, ["call-1"])
    end

    test "连续压缩按显式调用范围选择，未选历史和待完成调用保持不变", %{base: base} do
      transcript =
        base
        |> AuthoringTranscript.append_assistant("读取角色。", [tool_call("call-1")])
        |> AuthoringTranscript.append_observation("call-1", character_observation())
        |> AuthoringTranscript.append_scope_update(
          %{work_id: "work-1", operation: %{exploration: %{allowed: true}}},
          %{"scope_revision" => 2},
          [],
          []
        )
        |> AuthoringTranscript.append_assistant("再次读取。", [
          RequestIR.tool_call_block("read_character", %{}, "call-2")
        ])
        |> AuthoringTranscript.append_observation("call-2", character_observation())
        |> begin_next_turn()

      assert {:ok, first} = compact(transcript, ["call-2"])
      assert {:ok, ir} = AuthoringTranscript.to_request_ir(first)
      assert {:ok, body} = Projection.project(ir, "chat_completions")
      assert provider_call_ids(body) == ["call-1", "call-1"]

      assert {:ok, second} = compact(first, ["call-1"])
      assert Enum.take(second.messages, length(transcript.messages)) == transcript.messages
      assert Enum.count(second.messages, &(&1.role == "checkpoint")) == 2
      assert {:ok, ir} = AuthoringTranscript.to_request_ir(second)
      assert {:ok, body} = Projection.project(ir, "chat_completions")
      assert provider_call_ids(body) == []
      assert {:error, :checkpoint_already_applied} = compact(second, ["call-1", "call-2"])
    end

    test "压缩不能丢失真实来源版本或声明没有读过的来源", %{base: base} do
      transcript =
        base
        |> AuthoringTranscript.append_assistant("读取角色。", [tool_call("call-1")])
        |> AuthoringTranscript.append_observation("call-1", character_observation())
        |> begin_next_turn()

      for {refs, versions} <- [
            {[], %{}},
            {[%{ref: "character:other", version: 2}], %{"character:other" => 2}},
            {[%{ref: "character:1", version: 2}], %{"character:1" => 99}}
          ] do
        assert {:error, :checkpoint_evidence_mismatch} =
                 AuthoringTranscript.compact(
                   transcript,
                   %{call_ids: ["call-1"], message_refs: []},
                   refs,
                   versions,
                   ["省略原始工具细节"],
                   "已读取角色"
                 )
      end
    end

    test "压缩更早的完整交换不会删除后来未完成的交换", %{base: base} do
      transcript =
        base
        |> AuthoringTranscript.append_assistant("读取角色。", [tool_call("call-1")])
        |> AuthoringTranscript.append_observation("call-1", character_observation())
        |> begin_next_turn()
        |> AuthoringTranscript.append_assistant("还有信息缺口。", [
          RequestIR.tool_call_block("read_character", %{}, "pending-call")
        ])

      assert {:ok, compacted} = compact(transcript, ["call-1"])
      assert Enum.take(compacted.messages, length(transcript.messages)) == transcript.messages
      assert {:ok, ir} = AuthoringTranscript.to_request_ir(compacted)
      effective = Compaction.project(ir.messages)

      assert Enum.any?(effective, fn message ->
               Enum.any?(message.blocks, &(Map.get(&1, :call_id) == "pending-call"))
             end)

      assert {:error, {:pending_tool_calls, ["pending-call"]}} = RequestIR.prepare_request(ir)
    end
  end

  defp begin_next_turn(transcript) do
    AuthoringTranscript.append_author_turn(transcript, "继续当前工作回合。", "turn-current")
  end

  defp compact(transcript, call_ids, summary \\ "已读取角色；这不表示候选已获采纳。") do
    AuthoringTranscript.compact(
      transcript,
      %{call_ids: call_ids, message_refs: []},
      [%{ref: "character:1", version: 2}],
      %{"character:1" => 2},
      ["省略工具调用的逐字内容；原始证据仍可回查。"],
      summary
    )
  end

  defp provider_call_ids(body) do
    messages = Map.get(body, :messages, Map.get(body, :input, []))

    block_ids =
      for message <- messages,
          block <- Map.get(message, :tool_calls, []) ++ List.wrap(Map.get(message, :content)),
          is_map(block),
          id = Map.get(block, :id) || Map.get(block, :tool_use_id),
          is_binary(id),
          do: id

    message_ids =
      for message <- messages,
          id = Map.get(message, :tool_call_id) || Map.get(message, :call_id),
          is_binary(id),
          do: id

    block_ids ++ message_ids
  end

  defp character_observation do
    {_call_id, observation} =
      observation("call-1", content: %{"narrative_role" => "ENSEMBLE_POV"})

    Map.merge(observation, %{coverage: %{fields: ["narrative_role"]}, omissions: []})
  end
end
