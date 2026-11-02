defmodule NovelApplication.TranscriptCompactionTest do
  @moduledoc """
  B71 P2（VS-00L §16.2/§16.4）：显式压缩派生边界的单测。

  只证明「从 canonical 事实派生命中范围/证据/作者安全摘要」的纯函数语义；
  真实 Channel/页面消费者见 `workspace_channel_compaction_test.exs`。
  """

  use ExUnit.Case, async: true

  alias NovelAgent.Provider.RequestIR
  alias NovelAgent.Provider.RequestIR.{Compaction, Projection}
  alias NovelApplication.{AuthoringReplay, AuthoringTranscript, TranscriptCompaction}

  @author_text "先读取沈砚的当前叙事身份，再给出把主角改为顾青的 tentative 候选。"
  @internal_marker ~r/\b(?:RequestIR|request_ir|provider_session|reasoning_content|call_id|tool_call)\b|\b(?:call_|run_|turn_|ctx_|trace_|pc_)[a-z0-9_-]+|\b(?:chapter|work|character):[a-z0-9_-]+/i

  defp full_caps, do: Map.new(RequestIR.required_capabilities(), &{&1, true})

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

  defp base_transcript do
    AuthoringTranscript.new(run(),
      base_text: "run goal: 读取角色事实后给出 tentative 候选",
      author_text: @author_text,
      tools: [%{name: "read_character", description: "读取角色", input_schema: %{type: "object"}}],
      projection: %{target: "chat_completions", capability_profile: full_caps()}
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
       content: %{summary: "已读取角色"}
     }}
  end

  defp append_exchange(transcript, call_id, opts \\ []) do
    {call_id, payload} = observation(call_id, opts)

    transcript
    |> AuthoringTranscript.append_assistant("读取角色。", [tool_call(call_id)])
    |> AuthoringTranscript.append_observation(call_id, payload)
  end

  test "派生命中全部未覆盖的完整交换，并可被机制层接受而只折叠 Provider 投影" do
    transcript =
      base_transcript()
      |> append_exchange("call-1")
      |> AuthoringTranscript.append_scope_update("后续只开放创作。", %{"scope_revision" => 2})
      |> append_exchange("call-2", source_refs: [%{ref: "character:2", version: 5}],
        versions: %{"character:2" => 5}
      )

    before = transcript.messages

    assert {:ok, plan} = TranscriptCompaction.plan(transcript)
    assert plan.covers == %{call_ids: ["call-1", "call-2"]}
    assert plan.source_refs == [%{ref: "character:1", version: 2}, %{ref: "character:2", version: 5}]
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
    assert :ok = Compaction.validate(compacted.messages)

    assert {:ok, ir} = AuthoringTranscript.to_request_ir(compacted)
    assert {:ok, body} = Projection.project(ir)
    # checkpoint 是唯一压缩表达：模型可见覆盖范围，但被覆盖的工具往返不再出现。
    refute Enum.any?(body.messages, &(&1.role == "tool"))
    assert inspect(body) =~ "checkpoint"
    assert inspect(body) =~ "call-1"
    assert inspect(body) =~ "已整理本次任务较早的 2 项已完成操作"
  end

  test "未完成的交换不进入压缩范围，等待真实结果后才可整理" do
    transcript =
      base_transcript()
      |> append_exchange("call-1")
      |> AuthoringTranscript.append_assistant("再次读取。", [tool_call("call-2")])

    assert {:ok, plan} = TranscriptCompaction.plan(transcript)
    assert plan.covers == %{call_ids: ["call-1"]}
  end

  test "已经整理过的交换不重复覆盖；没有剩余交换时报 nothing_to_compact" do
    transcript = base_transcript() |> append_exchange("call-1")

    assert {:ok, plan} = TranscriptCompaction.plan(transcript)
    assert plan.covers == %{call_ids: ["call-1"]}

    assert {:ok, compacted} =
             AuthoringTranscript.compact(
               transcript,
               plan.covers,
               plan.source_refs,
               plan.versions,
               plan.omissions,
               plan.summary
             )

    assert {:ok, :nothing_to_compact} = TranscriptCompaction.plan(compacted)
    assert %{compacted: false, reason: :nothing_to_compact} = TranscriptCompaction.receipt(:nothing_to_compact)
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

    assert {:ok, plan} = TranscriptCompaction.plan(transcript)
    assert plan.covers == %{call_ids: ["call-1", "call-2"]}
    assert plan.source_refs == [%{ref: "character:1", version: 2}]
    assert plan.versions == %{"character:1" => 2}
  end

  test "结果重复或缺失的调用不选，派生结果仍能通过机制校验" do
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

    # call-1 结果重复超过一次，call-9 未完成：两者都不选。
    assert {:ok, :nothing_to_compact} = TranscriptCompaction.plan(transcript)
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

    assert {:ok, plan} = TranscriptCompaction.plan(transcript)
    assert %{compacted: true, covered_exchanges: 2} = TranscriptCompaction.receipt(plan)

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
      |> append_exchange("call-2", source_refs: [%{ref: "character:2", version: 3}],
        versions: %{"character:2" => 3}
      )

    assert TranscriptCompaction.plan(transcript) == TranscriptCompaction.plan(transcript)
  end

  test "nil transcript 如实返回 transcript_not_found，不伪造成功" do
    assert {:error, :transcript_not_found} = TranscriptCompaction.plan(nil)
    assert {:error, :transcript_not_found} = TranscriptCompaction.plan(%{})
  end
end
