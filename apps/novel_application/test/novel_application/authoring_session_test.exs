defmodule NovelApplication.AgentRunFlows.AuthoringSessionTest do
  use ExUnit.Case, async: true

  alias NovelAgent.AuthorizedToolExecutor
  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.RequestIR
  alias NovelAgent.Provider.RequestIR.Projection
  alias NovelApplication.AgentRunFlows.AuthoringSession
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.TurnExecutionService
  alias NovelCommon.Contracts.{AuthoringTask, ToolRequest, ToolResult}
  alias NovelDomain.AgentRun
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @run %{
    run_id: "run-session",
    work_id: "work-session",
    workspace_id: "workspace-session",
    session_id: "session-session",
    parent_turn_ref: "turn-session",
    goal: %{text: "共用真实会话", version: 1}
  }

  @tool %{
    name: "submit_tentative_artifact",
    description: "提交候选，不采纳",
    input_schema: %{type: "object"}
  }

  # 作者中文、全角空格、制表符、行尾空格都必须逐字保留。
  @author_text "　第一章\t \n  连续  空格与结尾空格  \n"
  @invalid_ir_message "authoring session request IR is invalid"

  defp transcript do
    AuthoringTranscript.new(@run,
      base_text: "角色规则：只在授权边界内提出候选。",
      author_text: @author_text,
      tools: [@tool],
      projection: %{
        target: "chat_completions",
        capability_profile: Map.new(RequestIR.required_capabilities(), &{&1, true})
      }
    )
  end

  defp newer_transcript(older) do
    %{older | messages: older.messages ++ [%{role: "assistant", blocks: []}]}
  end

  defp base_ir do
    {:ok, ir} = AuthoringTranscript.to_request_ir(transcript())
    ir
  end

  defp invalid_ir do
    %{base_ir() | ir_version: "unsupported-authoring-request-ir/v0"}
  end

  defp authoring_task_map do
    %AuthoringTask{
      kind: :revision,
      author_goal: "只改第二段，其余逐字保留",
      author_words: "只改第二段，其余逐字保留",
      operation_effect: :revise_candidate,
      scope: %{refs: ["artifact:one"], coverage: :single, base_ref: "artifact:one"},
      preserve: ["其余逐字保留"],
      output_contract: %{
        kind: :json,
        artifact_type: "prose_fragment",
        required_keys: ["items"]
      },
      source_refs: ["turn-session"]
    }
    |> AuthoringTask.to_map()
  end

  defp revision_snapshot(run) do
    transcript =
      AuthoringTranscript.new(run,
        base_text: "角色规则：按作者要求修订候选。",
        author_text: @author_text,
        tools: [@tool],
        projection: %{
          target: "chat_completions",
          capability_profile: Map.new(RequestIR.required_capabilities(), &{&1, true})
        }
      )

    snapshot = %{
      stage_state: %{judgment_transcript: transcript},
      budget: %{max_provider_calls: 2},
      callback: fn -> :ok end
    }

    {transcript, snapshot}
  end

  defp tool_request do
    %ToolRequest{
      tool_request_id: "tq-session",
      turn_id: "turn-session",
      frame_ref: "frame-session",
      plan_ref: "plan-session",
      decision_ref: "decision-session",
      tool_name: "prose_writing",
      tool_version: "prose/v1",
      input: %{
        "revision" => "只改第二段，其余逐字保留",
        "authoring_task" => authoring_task_map(),
        "context_text" => "原候选全文"
      },
      read_scope_grants: ["author_text", "chapter_structure"],
      write_scope_grants: [],
      idempotency_key: "turn-session:revise:candidate",
      trace_policy: %{level: "standard"},
      created_at: ~U[2026-11-01 00:00:00Z]
    }
  end

  defp execution_frame do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-session",
      turn_id: "turn-session",
      workspace_id: "workspace-session",
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{},
      dialogue_goal: %{summary: "重写本章"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "好的"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  defp execution_plan do
    action = %{
      action_id: "act-session",
      action_type: :capability_invocation,
      summary: "正文",
      target_ref: "prose_writing",
      write_intent: :tentative,
      risk_hint: :low,
      authoring_intent: :rewrite,
      requested_chapter_raw: "第99章",
      target_chapter: nil
    }

    %MicroPlan{
      plan_id: "plan-session",
      turn_id: "turn-session",
      frame_ref: "frame-session",
      plan_goal: %{summary: "正文"},
      risk_hint: :low,
      proposed_actions: [action]
    }
  end

  defp execution_decision do
    %OrchestratorDecision{
      decision_id: "decision-session",
      turn_id: "turn-session",
      frame_ref: "frame-session",
      decision_type: :allow_tool,
      decision_status: :decided,
      reason_codes: ["gates_passed", "tool:prose_writing"]
    }
  end

  defp append_assistant_result(ir, tool_calls) do
    RequestIR.append_assistant_result(ir, %{content: "候选内容。", tool_calls: tool_calls})
  end

  defp validation_blocks(ir) do
    Enum.flat_map(ir.messages, fn message ->
      Enum.filter(message.blocks, &(&1.type == "validation_result"))
    end)
  end

  defp validation_blocks(ir, call_id) do
    Enum.filter(validation_blocks(ir), &(&1.call_id == call_id))
  end

  defp tool_call_block(ir, call_id) do
    ir.messages
    |> Enum.flat_map(& &1.blocks)
    |> Enum.find(&(&1.type == "tool_call" and &1.call_id == call_id))
  end

  defp author_text(ir) do
    ir.messages
    |> Enum.filter(&(&1.role == "user"))
    |> Enum.map_join("", fn message -> Projection.text_of(message.blocks) end)
  end

  defp contains_function?(%{__struct__: _} = value),
    do: value |> Map.from_struct() |> contains_function?()

  defp contains_function?(value) when is_map(value) do
    Enum.any?(value, fn {key, item} ->
      contains_function?(key) or contains_function?(item)
    end)
  end

  defp contains_function?(value) when is_list(value),
    do: Enum.any?(value, &contains_function?/1)

  defp contains_function?(value) when is_tuple(value),
    do: value |> Tuple.to_list() |> contains_function?()

  defp contains_function?(value) when is_function(value), do: true
  defp contains_function?(_value), do: false

  defp agent_run do
    {:ok, run} =
      AgentRun.new(%{
        run_id: "run-bind",
        run_mode: :bounded,
        workspace_id: "workspace-bind",
        work_id: "work-bind",
        session_id: "session-bind",
        parent_turn_ref: "turn-bind",
        origin_frame_ref: "frame-bind",
        profile_ref: "profile-bind",
        goal: %{text: "按作者要求修订候选", version: 1},
        authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]}
      })

    run
  end

  describe "validate_provider_result/4" do
    test "只闭合当前 provider_result 的 call_id，并保留作者字节、arguments、结果与计数" do
      arguments = %{
        "items" => [
          %{"title" => "中文标题", "body" => "第一段\n  第二段"}
        ]
      }

      raw_arguments = "{\"items\":[{\"title\":\"中文标题\",\"body\":\"第一段\\n  第二段\"}]}"

      {ir, result} =
        base_ir()
        |> append_assistant_result([
          %{
            id: "call-current",
            name: "submit_tentative_artifact",
            arguments: arguments,
            raw_arguments: raw_arguments
          }
        ])

      session = %{
        request_ir: ir,
        provider_result: result,
        provider_call_count: 1,
        tool_call_count: 1
      }

      validated =
        AuthoringSession.validate_provider_result(
          session,
          "passed",
          "tentative_artifact_validated",
          %{artifact_refs: ["artifact:one"]}
        )

      assert %RequestIR{} = validated.request_ir
      assert validated.provider_result == result
      assert validated.provider_call_count == 1
      assert validated.tool_call_count == 1
      assert Enum.take(validated.request_ir.messages, length(ir.messages)) == ir.messages
      assert {:ok, []} = RequestIR.pending_call_ids(validated.request_ir)

      assert [validation] = validation_blocks(validated.request_ir, "call-current")
      assert validation.status == "passed"
      assert validation.reason_code == "tentative_artifact_validated"
      assert validation.detail == %{"artifact_refs" => ["artifact:one"]}

      call = tool_call_block(validated.request_ir, "call-current")
      assert call.arguments == arguments
      assert call.raw_arguments == raw_arguments
      assert author_text(validated.request_ir) == @author_text
    end

    test "协议已拒绝的 failed call 不因后续通过校验而重复闭合" do
      {ir, result} =
        base_ir()
        |> append_assistant_result([
          %{
            id: "call-rejected",
            name: "submit_tentative_artifact",
            arguments: %{"items" => []}
          },
          %{
            id: "call-current",
            name: "submit_tentative_artifact",
            arguments: %{"items" => [%{"title" => "有效候选"}]}
          }
        ])

      ir =
        RequestIR.append_validation_result(
          ir,
          "call-rejected",
          "failed",
          "protocol_rejected",
          %{"message" => "参数不符合输出契约"}
        )

      session = %{
        request_ir: ir,
        provider_result: result,
        provider_call_count: 1,
        tool_call_count: 1
      }

      validated =
        AuthoringSession.validate_provider_result(
          session,
          "passed",
          "tentative_artifact_validated",
          %{artifact_refs: ["artifact:one"]}
        )

      assert [rejected] = validation_blocks(validated.request_ir, "call-rejected")
      assert rejected.status == "failed"
      assert rejected.reason_code == "protocol_rejected"
      assert [passed] = validation_blocks(validated.request_ir, "call-current")
      assert passed.status == "passed"
      assert length(validation_blocks(validated.request_ir)) == 2
      assert {:ok, []} = RequestIR.pending_call_ids(validated.request_ir)
      assert validated.provider_call_count == 1
      assert author_text(validated.request_ir) == @author_text
    end

    test "provider_result 为 nil 的零调用不闭合历史 pending" do
      {ir, _result} =
        base_ir()
        |> append_assistant_result([
          %{
            id: "call-awaiting",
            name: "submit_tentative_artifact",
            arguments: %{"items" => [%{"title" => "等待应用结果"}]}
          }
        ])

      session = %{
        request_ir: ir,
        provider_result: nil,
        provider_call_count: 0,
        tool_call_count: 0
      }

      validated =
        AuthoringSession.validate_provider_result(
          session,
          "passed",
          "tentative_artifact_validated",
          %{}
        )

      assert validated.request_ir.messages == ir.messages
      assert {:ok, ["call-awaiting"]} = RequestIR.pending_call_ids(validated.request_ir)
      assert validated.provider_result == nil
      assert validated.provider_call_count == 0
      assert validated.tool_call_count == 0
      assert validation_blocks(validated.request_ir) == []
      assert author_text(validated.request_ir) == @author_text
    end

    test "IR 明确存在但 pending 结构不合法时以固定安全 ArgumentError 拒绝" do
      session = %{
        request_ir: invalid_ir(),
        provider_result: %{tool_calls: []},
        provider_call_count: 1,
        tool_call_count: 0
      }

      assert_raise ArgumentError, @invalid_ir_message, fn ->
        AuthoringSession.validate_provider_result(
          session,
          "passed",
          "tentative_artifact_validated",
          %{}
        )
      end
    end
  end

  describe "failure_state/1 与 inherit_failure/2" do
    test "失败会话只带本次真实调用数与 transcript，不复制 judgment 其余对象" do
      judgment = %{
        transcript: transcript(),
        provider_call_count: 2,
        provider_result: %{secret: "private"},
        stage_state: %{judgment_transcript: :decoy}
      }

      metadata = AuthoringSession.failure_state(judgment)

      assert metadata.judgment_transcript == transcript()
      assert metadata.provider_call_count == 2
      refute Map.has_key?(metadata, :provider_result)
      refute Map.has_key?(metadata, :stage_state)
      refute contains_function?(metadata)
    end

    test "inner 已带更新会话时不被较旧 judgment 覆盖；缺会话时继承" do
      older = transcript()
      newer = %{older | messages: older.messages ++ [%{role: "assistant", blocks: []}]}

      assert {:error, :boom, inherited} =
               AuthoringSession.inherit_failure(
                 {:error, :boom, %{judgment_transcript: newer, provider_call_count: 2}},
                 %{transcript: older, provider_call_count: 1}
               )

      assert inherited.judgment_transcript == newer
      assert inherited.provider_call_count == 2

      assert {:error, :boom, inherited} =
               AuthoringSession.inherit_failure(
                 {:error, :boom, %{judgment_transcript: nil}},
                 %{transcript: older, provider_call_count: 1}
               )

      assert inherited.judgment_transcript == older
      assert inherited.provider_call_count == 1

      assert {:error, :boom, inherited} =
               AuthoringSession.inherit_failure(
                 {:error, :boom},
                 %{transcript: older, provider_call_count: 1}
               )

      assert inherited.judgment_transcript == older
      assert inherited.provider_call_count == 1
    end

    test "inner 的 nested 更新会话搬到唯一 flat canonical，不补较旧 judgment" do
      older = transcript()
      newer = newer_transcript(older)

      state = %{
        stage_state: %{judgment_transcript: newer, context: %{chapter: 1}},
        provider_call_count: 2,
        tool_call_count: 1
      }

      assert {:error, :boom, inherited} =
               AuthoringSession.inherit_failure(
                 {:error, :boom, state},
                 %{transcript: older, provider_call_count: 1}
               )

      assert inherited.judgment_transcript == newer
      refute Map.has_key?(inherited.stage_state, :judgment_transcript)
      assert inherited.stage_state.context == %{chapter: 1}
      assert inherited.provider_call_count == 2
      assert inherited.tool_call_count == 1
    end

    test "显式 nil flat 不覆盖有效 nested 会话" do
      older = transcript()
      newer = newer_transcript(older)

      state = %{
        judgment_transcript: nil,
        stage_state: %{judgment_transcript: newer, context: :kept},
        provider_call_count: 0
      }

      assert {:error, :boom, inherited} =
               AuthoringSession.inherit_failure(
                 {:error, :boom, state},
                 %{transcript: older, provider_call_count: 1}
               )

      assert inherited.judgment_transcript == newer
      refute Map.has_key?(inherited.stage_state, :judgment_transcript)
      assert inherited.stage_state.context == :kept
    end

    test "显式 nil nested 不覆盖有效 flat 会话，并保留其他 nested 字段" do
      older = transcript()
      newer = newer_transcript(older)

      state = %{
        judgment_transcript: newer,
        stage_state: %{judgment_transcript: nil, context: :kept}
      }

      assert {:error, :boom, inherited} =
               AuthoringSession.inherit_failure(
                 {:error, :boom, state},
                 %{transcript: older, provider_call_count: 1}
               )

      assert inherited.judgment_transcript == newer
      refute Map.has_key?(inherited.stage_state, :judgment_transcript)
      assert inherited.stage_state.context == :kept
    end

    test "两个非 nil 别名相同时收敛到唯一 flat canonical" do
      older = transcript()
      newer = newer_transcript(older)

      state = %{
        judgment_transcript: newer,
        stage_state: %{judgment_transcript: newer, context: :kept}
      }

      assert {:error, :boom, inherited} =
               AuthoringSession.inherit_failure(
                 {:error, :boom, state},
                 %{transcript: older, provider_call_count: 1}
               )

      assert inherited.judgment_transcript == newer
      refute Map.has_key?(inherited.stage_state, :judgment_transcript)
      assert inherited.stage_state.context == :kept
    end

    test "两个非 nil 别名不一致时明确拒绝载体，reason 不含私有对象" do
      older = transcript()
      newer = newer_transcript(older)

      state = %{
        judgment_transcript: older,
        stage_state: %{judgment_transcript: newer, context: :kept},
        provider_call_count: 2
      }

      assert {:error, reason, rejected} =
               AuthoringSession.inherit_failure(
                 {:error, :boom, state},
                 %{transcript: older, provider_call_count: 1}
               )

      assert reason == :inconsistent_judgment_transcript_carrier
      refute inspect(reason) =~ older.run.run_id
      refute Map.has_key?(rejected, :judgment_transcript)
      refute Map.has_key?(rejected.stage_state, :judgment_transcript)
      assert rejected.stage_state.context == :kept
      assert rejected.provider_call_count == 2
    end
  end

  describe "provider_metadata/1" do
    test "空会话返回 0/0，且不生成假 transcript" do
      metadata = AuthoringSession.provider_metadata(%{})

      assert metadata.provider_call_count == 0
      assert metadata.tool_call_count == 0
      assert is_nil(Map.get(metadata, :judgment_transcript))
      refute Map.has_key?(metadata, :provider_result)

      nil_session =
        AuthoringSession.provider_metadata(%{
          request_ir: nil,
          provider_result: nil,
          provider_call_count: 0,
          tool_call_count: 0
        })

      assert nil_session.provider_call_count == 0
      assert nil_session.tool_call_count == 0
      assert is_nil(Map.get(nil_session, :judgment_transcript))
    end

    test "没有 IR 的合法 0 次会话不把旧 transcript 当作历史" do
      metadata =
        AuthoringSession.provider_metadata(%{
          request_ir: nil,
          authoring_transcript: transcript(),
          provider_call_count: 0,
          tool_call_count: 0
        })

      assert metadata.provider_call_count == 0
      assert metadata.tool_call_count == 0
      refute Map.has_key?(metadata, :judgment_transcript)
    end

    test "IR 明确存在但结构不合法时以固定安全 ArgumentError 拒绝，不吞掉 transcript" do
      session = %{
        request_ir: invalid_ir(),
        authoring_transcript: transcript(),
        provider_call_count: 1,
        tool_call_count: 1
      }

      assert_raise ArgumentError, @invalid_ir_message, fn ->
        AuthoringSession.provider_metadata(session)
      end
    end

    test "IR 位置出现非 RequestIR 值时同样拒绝，不静默当作缺席" do
      session = %{
        request_ir: :corrupt_ir,
        authoring_transcript: transcript(),
        provider_call_count: 1,
        tool_call_count: 1
      }

      assert_raise ArgumentError, @invalid_ir_message, fn ->
        AuthoringSession.provider_metadata(session)
      end
    end

    test "一次 provider 调用与一次工具调用的计数来自 session" do
      {ir, result} =
        base_ir()
        |> append_assistant_result([
          %{
            id: "call-current",
            name: "submit_tentative_artifact",
            arguments: %{"items" => [%{"title" => "候选"}]}
          }
        ])

      session = %{
        request_ir: ir,
        provider_result: result,
        provider_call_count: 1,
        tool_call_count: 1
      }

      metadata = AuthoringSession.provider_metadata(session)

      assert metadata.provider_call_count == 1
      assert metadata.tool_call_count == 1
      assert metadata.judgment_transcript.messages == ir.messages
      assert author_text(metadata.judgment_transcript) == @author_text
      refute Map.has_key?(metadata, :provider_result)
    end

    test "两次 provider 调用只派发一次工具时，不按 IR 或失败状态猜计数" do
      {ir, _first_result} =
        base_ir()
        |> append_assistant_result([
          %{
            id: "call-first",
            name: "submit_tentative_artifact",
            arguments: %{"items" => []}
          }
        ])

      ir =
        RequestIR.append_validation_result(
          ir,
          "call-first",
          "failed",
          "protocol_rejected",
          %{"message" => "首次调用协议失败"}
        )

      {ir, result} =
        ir
        |> append_assistant_result([
          %{
            id: "call-second",
            name: "submit_tentative_artifact",
            arguments: %{"items" => [%{"title" => "纠正后的候选"}]}
          }
        ])

      session = %{
        request_ir: ir,
        provider_result: result,
        provider_call_count: 2,
        tool_call_count: 1,
        status: :failed
      }

      metadata = AuthoringSession.provider_metadata(session)

      assert metadata.provider_call_count == 2
      assert metadata.tool_call_count == 1
      assert metadata.judgment_transcript.messages == ir.messages
    end

    test "metadata 外层不复制 raw provider_result、stage_state 或函数" do
      {ir, result} =
        base_ir()
        |> append_assistant_result([
          %{
            id: "call-current",
            name: "submit_tentative_artifact",
            arguments: %{"items" => [%{"title" => "候选"}]}
          }
        ])

      session = %{
        request_ir: ir,
        provider_result: result,
        provider_call_count: 1,
        tool_call_count: 1,
        stage_state: %{judgment_transcript: :decoy},
        callback: fn -> :ok end
      }

      metadata = AuthoringSession.provider_metadata(session)

      assert metadata.judgment_transcript.messages == ir.messages
      refute Map.has_key?(metadata, :provider_result)
      refute Map.has_key?(metadata, :stage_state)
      refute Map.has_key?(metadata, :callback)
      refute contains_function?(metadata)
    end

    test "metadata transcript 经 checkpoint JSON 往返保持相同 messages" do
      {ir, result} = RequestIR.append_assistant_result(base_ir(), %{content: "仅叙事，无工具。"})

      session = %{
        request_ir: ir,
        provider_result: result,
        provider_call_count: 1,
        tool_call_count: 0
      }

      metadata = AuthoringSession.provider_metadata(session)
      transcript = metadata.judgment_transcript

      assert metadata.provider_call_count == 1
      assert metadata.tool_call_count == 0

      checkpoint =
        transcript
        |> AuthoringTranscript.checkpoint()
        |> Jason.encode!()
        |> Jason.decode!()

      assert {:ok, restored} = AuthoringTranscript.restore(checkpoint)
      assert restored.messages == transcript.messages
      assert restored.messages == ir.messages

      assert {:ok, restored_ir} = AuthoringTranscript.to_request_ir(restored)
      assert {:ok, restored_body} = Projection.project(restored_ir)
      assert {:ok, body} = Projection.project(ir)
      assert restored_body == body
    end
  end

  describe "bind_tool_request/3" do
    test "只绑定真实 AgentRun 与快照派生的 request_ir，保留业务材料且不改旧 IR" do
      run = agent_run()
      {transcript, snapshot} = revision_snapshot(run)
      request = tool_request()

      derived_ir = AuthoringSession.request_ir(snapshot)
      assert %RequestIR{} = derived_ir

      bound = AuthoringSession.bind_tool_request(request, run, snapshot)

      assert %ToolRequest{} = bound
      assert bound.tool_request_id == request.tool_request_id
      assert bound.turn_id == request.turn_id
      assert bound.frame_ref == request.frame_ref
      assert bound.plan_ref == request.plan_ref
      assert bound.decision_ref == request.decision_ref
      assert bound.tool_name == request.tool_name
      assert bound.tool_version == request.tool_version
      assert bound.read_scope_grants == request.read_scope_grants
      assert bound.write_scope_grants == request.write_scope_grants
      assert bound.idempotency_key == request.idempotency_key
      assert bound.trace_policy == request.trace_policy
      assert bound.created_at == request.created_at

      assert bound.input["revision"] == request.input["revision"]
      assert bound.input["authoring_task"] == request.input["authoring_task"]
      assert bound.input["context_text"] == request.input["context_text"]

      assert %AgentRun{} = bound.input["agent_run"]
      assert bound.input["agent_run"] == run
      assert bound.input["agent_run"].run_id == run.run_id

      assert %RequestIR{} = bound.input["request_ir"]
      assert bound.input["request_ir"] == derived_ir
      assert bound.input["request_ir"].messages == transcript.messages
      assert author_text(bound.input["request_ir"]) == @author_text
      assert Enum.count(bound.input["request_ir"].messages, &(&1.role == "user")) == 1

      refute Map.has_key?(bound.input, "snapshot")
      refute Map.has_key?(bound.input, :snapshot)
      refute Map.has_key?(bound.input, "stage_state")
      refute Map.has_key?(bound.input, :stage_state)
      refute Map.has_key?(bound.input, "callback")
      refute contains_function?(bound.input)

      assert AuthoringSession.request_ir(snapshot) == derived_ir
      assert derived_ir.messages == transcript.messages
    end

    test "绑定后的真实 Common ToolRequest 可被 AuthorizedToolExecutor 识别，0 预算不调模型" do
      run = agent_run()
      {_transcript, snapshot} = revision_snapshot(run)

      bound = AuthoringSession.bind_tool_request(tool_request(), run, snapshot)

      execution = %Execution{
        result_fn: fn _prompt -> flunk("0 预算不得调用模型") end
      }

      {result, session} =
        AuthorizedToolExecutor.execute_with_session(bound, execution, max_provider_calls: 0)

      assert %ToolRequest{} = bound
      assert %ToolResult{status: :failed} = result
      assert result.tool_request_ref == bound.tool_request_id
      assert Enum.map(result.errors, & &1.code) == ["provider_call_budget_exhausted"]
      assert session.tool_call_count == 1
    end
  end

  describe "TurnExecutionService canonical transcript" do
    test "已有但损坏的 IR 不以旧 authoring_transcript 冒充历史" do
      assert_raise ArgumentError, @invalid_ir_message, fn ->
        TurnExecutionService.execute(%{
          frame: execution_frame(),
          plan: execution_plan(),
          decision: execution_decision(),
          context: %DialogueContext{
            workspace_id: "workspace-session",
            current_chapters: ["第一章"]
          },
          author_input: %{text: "重写第99章"},
          request_ir: invalid_ir(),
          authoring_transcript: transcript(),
          provider_execution: %Execution{
            result_fn: fn _prompt -> flunk("hard missing 不得调用模型") end
          }
        })
      end
    end
  end
end
