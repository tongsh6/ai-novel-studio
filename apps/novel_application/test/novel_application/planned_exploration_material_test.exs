defmodule NovelApplication.PlannedExplorationMaterialTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AgentRunFlows.AuthoringSession
  alias NovelApplication.AuthoringTranscript
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.MessageCoverage
  alias NovelCommon.RequestIR.Operation
  alias NovelCommon.RequestIR.Projection

  test "已闭合计划的真实部分读取进入下一请求，保持应用来源且不追加第二个工具结果" do
    run = run()
    initial = transcript(run)
    snapshot = %{run: run, stage_state: %{judgment_transcript: initial}}

    assert {:ok, result} =
             AuthoringSession.record_exploration_result(read_result(), run, snapshot)

    request = AuthoringSession.request_ir(result)
    assert :ok = RequestIR.validate(request)
    assert RequestIR.call_ids(request.messages) == ["actual-plan-call"]

    results =
      for message <- request.messages,
          block <- message.blocks,
          block.type in ["validation_result", "observation"],
          do: block.call_id

    assert results == ["actual-plan-call"]
    [scope] = Enum.filter(request.messages, &(&1.role == "scope_update"))
    assert scope.provenance == "application"
    assert [block] = scope.blocks
    assert block.content["operation"]["plan_call_id"] == "actual-plan-call"
    assert block.content["operation"]["step_ref"] == "step:actual-read"

    assert {:ok, next} =
             Operation.prepare(request, run, %{
               role: "creative_execution",
               instructions: "根据本次目标及已供应材料写作。",
               scope: %{work_id: "work:actual", operation: %{role: "creative_execution"}},
               tool: %{name: "submit", description: "提交候选", input_schema: %{type: "object"}}
             })

    assert [read] = RequestIR.visible_observations(next)
    assert read.provenance == "application"
    assert read.status == "partial"
    assert read.source_refs == ["draft:actual"]
    assert read.versions == %{"draft:actual" => 3}
    assert read.next_offset == 6000
    assert read.omissions == ["6000 字之后尚未读取"]
    assert read.content["summary"] == "实际读取的片段 R05READONCE73"
    assert read.content["observation_ref"] == "observation:actual-page"
    refute Enum.any?(next.refs.observation_refs, &(&1 == "draft:actual"))
    assert Enum.any?(next.refs.base_refs, &(&1 == "draft:actual" or &1[:ref] == "draft:actual"))

    for target <- ~w(chat_completions responses_api anthropic_messages) do
      assert {:ok, wire} = Projection.project(next, target)
      assert length(String.split(Jason.encode!(wire), "R05READONCE73")) == 2
    end
  end

  test "普通Scope的关联引用不生成读叶，固定计划不虚构原生调用" do
    run = run()
    snapshot = %{run: run, stage_state: %{}}

    assert {:ok, result} =
             AuthoringSession.record_exploration_result(read_result(), run, snapshot)

    request = AuthoringSession.request_ir(result)

    assert :ok = RequestIR.validate(request)
    assert RequestIR.call_ids(request.messages) == []
    [scope] = Enum.filter(request.messages, &(&1.role == "scope_update"))
    refute Map.has_key?(hd(scope.blocks).content["operation"], "plan_call_id")

    ordinary =
      RequestIR.append_scope_update(
        request,
        %{work_id: "work:actual", facts: %{related: %{source_ref: "draft:not-supplied"}}},
        %{"scope_revision" => 2},
        []
      )

    assert [read] = RequestIR.visible_observations(ordinary)
    assert read.source_refs == ["draft:actual"]
  end

  test "被合法覆盖的计划读取不因累计Base引用复活，未覆盖材料与作者原文仍可见" do
    old_run = Map.put(run(), :status, "completed")
    snapshot = %{run: old_run, stage_state: %{judgment_transcript: transcript(old_run)}}

    assert {:ok, result} =
             AuthoringSession.record_exploration_result(read_result(), old_run, snapshot)

    old_request = AuthoringSession.request_ir(result)
    # 持久段不保存派生坐标；会话视图按真实已完成状态重新标注。
    old_messages =
      old_request.messages
      |> Enum.map(&MessageCoverage.strip/1)
      |> MessageCoverage.annotate(old_run)

    assert List.last(old_messages).canonical_ref.run_sequence == 4

    current_run =
      Map.merge(run(), %{run_id: "run:next", parent_turn_ref: "turn:next", status: "running"})

    current_messages = [
      RequestIR.message(:user, :author, [RequestIR.text_block("继续本轮材料")], %{
        source_refs: [%{ref: "turn:next"}]
      }),
      RequestIR.message(
        :scope_update,
        :application,
        [
          RequestIR.scope_block(%{
            work_id: "work:actual",
            operation: %{role: "planned_exploration"},
            facts: %{
              exploration_result: %{
                status: "partial",
                source_refs: ["memory:current"],
                versions: %{"memory:current" => 7},
                content: %{summary: "本轮实际材料 R05VISIBLECURRENT91"}
              }
            }
          })
        ],
        %{versions: %{"scope_revision" => 1}, source_refs: ["memory:current"]}
      )
    ]

    checkpoint =
      RequestIR.message(:checkpoint, :application, [
        RequestIR.checkpoint_block(
          %{
            call_ids: [],
            message_refs: [
              %{
                run_id: "run:actual",
                run_sequence: 4,
                role: "scope_update",
                source_refs: ["draft:actual"],
                versions: %{"scope_revision" => 1}
              }
            ]
          },
          ["draft:actual", %{ref: "session_message:run:actual:4", version: 1}],
          %{},
          ["旧页仍可按原来源回查，不在本次请求供应全文。"],
          "整理旧读取。"
        )
      ])

    prefix = old_messages ++ MessageCoverage.annotate(current_messages, current_run)

    messages =
      old_messages ++ MessageCoverage.annotate(current_messages ++ [checkpoint], current_run)

    request =
      RequestIR.new(%{
        run: current_run,
        system: old_request.system,
        messages: messages,
        tools: [],
        refs: %{
          base_refs: ["draft:actual", "memory:current"],
          observation_refs: [],
          used_refs: []
        }
      })

    assert :ok = RequestIR.validate(request)
    assert length(RequestIR.visible_observations(%{request | messages: prefix})) == 2
    assert [visible] = RequestIR.visible_observations(request)
    assert visible.source_refs == ["memory:current"]
    assert visible.status == "partial"
    assert visible.versions == %{"memory:current" => 7}
    assert "draft:actual" in request.refs.base_refs
    assert Enum.at(request.messages, 3).blocks == List.last(old_messages).blocks

    assert hd(Enum.at(request.messages, 3).blocks).content["facts"]["exploration_result"][
             "content"
           ]["summary"] ==
             "实际读取的片段 R05READONCE73"

    for target <- ~w(chat_completions responses_api anthropic_messages) do
      assert {:ok, wire} = Projection.project(request, target)
      encoded = Jason.encode!(wire)
      refute encoded =~ "R05READONCE73"
      assert length(String.split(encoded, "R05VISIBLECURRENT91")) == 2
      assert encoded =~ "请先核对原文"
    end
  end

  defp run do
    %{
      run_id: "run:actual",
      workspace_id: "workspace:actual",
      work_id: "work:actual",
      session_id: "session:actual",
      parent_turn_ref: "turn:actual",
      goal: %{text: "核对材料后继续写作", source_ref: "turn:actual", version: 1},
      plan_ref: "plan:actual",
      plan_version: 2
    }
  end

  defp transcript(run) do
    ir =
      RequestIR.new(%{
        run: run,
        system: RequestIR.system_envelope(run_role: "creation_run", instructions: "根据真实材料创作。"),
        messages: [
          RequestIR.message(:user, :author, [RequestIR.text_block("请先核对原文")], %{
            source_refs: [%{ref: "turn:actual"}]
          }),
          RequestIR.message(:assistant, :model, [
            RequestIR.tool_call_block("agent_plan_draft", %{}, "actual-plan-call")
          ]),
          RequestIR.message(:tool, :tool_result, [
            RequestIR.validation_result_block(
              "actual-plan-call",
              "passed",
              "agent_plan_validated",
              %{plan_ref: "plan:actual", plan_version: 2}
            )
          ])
        ],
        tools: [],
        refs: %{base_refs: [], observation_refs: [], used_refs: []}
      })

    assert {:ok, transcript} = AuthoringTranscript.from_request_ir(ir)
    transcript
  end

  defp read_result do
    {:ok,
     %{
       step: %{step_id: "step:actual-read"},
       observations: [
         %{
           observation_id: "observation:actual-execution",
           summary: "实际读取的片段 R05READONCE73",
           structured_payload: %{
             stage: :exploration_observed,
             tool: "chapter_read",
             query: ~s({"chapter_ref":"chapter:actual","offset":0}),
             outcome: "partial",
             source_refs: ["draft:actual"],
             versions: %{"draft:actual" => 3},
             coverage: %{prose: %{status: "partial", start: 0, end: 6000}},
             omissions: ["6000 字之后尚未读取"],
             next_offset: 6000,
             observation_ref: "observation:actual-page",
             source_hash: "actual-version-fingerprint",
             facts: %{}
           }
         }
       ],
       provider_call_count: 0
     }}
  end
end
