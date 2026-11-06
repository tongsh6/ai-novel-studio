defmodule NovelAgent.ToolboxSessionTest do
  use ExUnit.Case, async: true

  alias NovelAgent.AuthorizedToolExecutor
  alias NovelAgent.Provider.Execution
  alias NovelAgent.TestSupport.AuthoringTaskFixtures
  alias NovelAgent.Toolbox
  alias NovelCommon.Contracts.AuthoringTask
  alias NovelCommon.Contracts.ToolRequest
  alias NovelCommon.Contracts.ToolResult
  alias NovelCommon.RequestIR

  test "execute_with_session/2 returns tuple for unknown tool without calling provider" do
    counter = :counters.new(1, [])
    execution = provider_execution(counter)

    assert {%ToolResult{status: :failed, errors: [%{code: "unknown_tool"}]},
            %{tool_call_count: 0}} =
             Toolbox.execute_with_session(request(tool_name: "nonexistent"), execution)

    assert provider_calls(counter) == 0
  end

  test "execute_with_session/2 returns tuple for disabled/deprecated tools without calling provider" do
    for tool_name <- ["disabled_tool", "deprecated_tool"] do
      counter = :counters.new(1, [])
      execution = provider_execution(counter)

      assert {%ToolResult{status: :failed, errors: [%{code: "tool_not_dispatchable"}]},
              %{tool_call_count: 0}} =
               Toolbox.execute_with_session(request(tool_name: tool_name), execution)

      assert provider_calls(counter) == 0
    end
  end

  test "execute_with_session/2 returns tuple for grant violation without calling provider" do
    counter = :counters.new(1, [])
    execution = provider_execution(counter)

    req =
      request(
        tool_name: "text_analysis",
        read_scope_grants: ["admin_access"]
      )

    assert {%ToolResult{status: :failed, errors: [%{code: "grant_scope_violation"}]},
            %{tool_call_count: 0}} =
             Toolbox.execute_with_session(req, execution)

    assert provider_calls(counter) == 0
  end

  test "execute_with_session/2 preserves the successful provider session" do
    counter = :counters.new(1, [])
    execution = provider_execution(counter)

    assert {%ToolResult{status: :succeeded, tool_name: "prose_writing"} = result, session} =
             Toolbox.execute_with_session(request(), execution)

    assert result.tool_request_ref == "tq-toolbox-session"
    assert session.tool_call_count == 1
    assert session.provider_call_count == 1
    assert is_map(session.request_ir)
    assert provider_calls(counter) == 1
  end

  test "execute/1 still returns a bare failed ToolResult with the legacy error semantics" do
    assert %ToolResult{status: :failed, errors: [%{code: "unknown_tool"}]} =
             Toolbox.execute(request(tool_name: "nonexistent"))
  end

  test "execute/2 still returns a bare succeeded ToolResult" do
    counter = :counters.new(1, [])
    execution = provider_execution(counter)

    assert %ToolResult{status: :succeeded, tool_name: "prose_writing"} =
             Toolbox.execute(request(), execution)

    assert provider_calls(counter) == 1
  end

  test "execute_with_session/2 returns tuple when orchestrator authorization is missing" do
    counter = :counters.new(1, [])
    execution = provider_execution(counter)

    assert {%ToolResult{
              status: :failed,
              errors: [%{code: "missing_orchestrator_authorization"}]
            }, %{tool_call_count: 0}} =
             AuthorizedToolExecutor.execute_with_session(
               request(decision_ref: nil),
               execution
             )

    assert provider_calls(counter) == 0
  end

  test "execute/2 projects the same ToolResult without a second dispatch path" do
    counter = :counters.new(1, [])
    execution = provider_execution(counter)

    assert %ToolResult{status: :succeeded, tool_name: "prose_writing"} =
             AuthorizedToolExecutor.execute(request(), execution)

    assert provider_calls(counter) == 1

    assert %ToolResult{
             status: :failed,
             errors: [%{code: "missing_orchestrator_authorization"}]
           } = AuthorizedToolExecutor.execute(request(decision_ref: ""), execution)

    assert provider_calls(counter) == 1
  end

  test "AuthorizedToolExecutor.execute_with_session/2 preserves the successful session" do
    counter = :counters.new(1, [])
    execution = provider_execution(counter)

    assert {%ToolResult{status: :succeeded, tool_name: "prose_writing"}, session} =
             AuthorizedToolExecutor.execute_with_session(request(), execution)

    assert session.provider_call_count == 1
    assert is_map(session.request_ir)
    assert provider_calls(counter) == 1
  end

  test "公开 execute_with_session 在一次 Toolbox 派发内完成应用拒绝与重试，共两次 provider 调用" do
    parent = self()

    {execution, calls, prompts} =
      scripted_execution([
        native_success("call-1", "first body"),
        native_success("call-2", "second body")
      ])

    validator = fn %ToolResult{} = result ->
      send(parent, {:validated, result})
      body = result.output.items |> hd() |> Map.fetch!(:body)

      if body == "first body" do
        {:error,
         %{
           reason_code: "revision_scope_mismatch",
           detail: %{target: "chapter:1"},
           message: "修订范围不匹配"
         }}
      else
        :ok
      end
    end

    assert {%ToolResult{
              status: :succeeded,
              output: %{items: [%{body: "second body"}]}
            } = final, session} =
             AuthorizedToolExecutor.execute_with_session(request(), execution,
               validate_result: validator
             )

    assert session.tool_call_count == 1
    assert session.provider_call_count == 2
    assert calls.() == 2
    assert_receive {:validated, %ToolResult{} = first}
    assert_receive {:validated, %ToolResult{} = second}
    refute_receive {:validated, _}, 10

    assert first.tool_result_id == final.tool_result_id
    assert second == final
    assert first.output.items |> hd() |> Map.fetch!(:body) == "first body"

    [first_prompt, retry_prompt] = prompts.()

    assert Enum.take(retry_prompt.messages, length(first_prompt.messages)) ==
             first_prompt.messages

    assert Enum.count(session.request_ir.messages, &(&1.role == "user")) == 1
    assert {:ok, ["call-2"]} = RequestIR.pending_call_ids(session.request_ir)

    assert Enum.any?(retry_prompt.messages, fn message ->
             message.role == "tool" and
               Enum.any?(message.blocks, fn block ->
                 block.type == "validation_result" and block.call_id == "call-1" and
                   block.reason_code == "revision_scope_mismatch"
               end)
           end)

    refute contains_function?(session)
  end

  test "公开入口应用拒绝后协议错：两次调用且协议错不执行应用校验" do
    parent = self()

    {execution, calls, _prompts} =
      scripted_execution([
        native_success("call-1", "first body"),
        native_invalid_multi()
      ])

    validator = fn %ToolResult{} = result ->
      send(parent, {:validated, result})

      {:error, %{reason_code: "scope_rejected", detail: %{}, message: "范围不匹配"}}
    end

    assert {%ToolResult{status: :failed, errors: [%{code: "unexpected_tool_calls"}]}, session} =
             AuthorizedToolExecutor.execute_with_session(request(), execution,
               validate_result: validator
             )

    assert session.tool_call_count == 1
    assert session.provider_call_count == 2
    assert calls.() == 2
    assert_receive {:validated, %ToolResult{}}
    refute_receive {:validated, _}, 10
    assert {:ok, []} = RequestIR.pending_call_ids(session.request_ir)

    assert Enum.any?(session.request_ir.messages, fn message ->
             message.role == "tool" and
               Enum.any?(
                 message.blocks,
                 &(&1.call_id == "call-1" and &1.status == "failed")
               )
           end)
  end

  test "公开入口协议错后应用拒绝：两次调用且应用校验只对成功解析执行" do
    parent = self()

    {execution, calls, _prompts} =
      scripted_execution([
        native_invalid_multi(),
        native_success("call-2", "second body")
      ])

    validator = fn %ToolResult{} = result ->
      send(parent, {:validated, result})

      {:error, %{reason_code: "scope_rejected", detail: %{}, message: "范围不匹配"}}
    end

    assert {%ToolResult{status: :failed, errors: [%{code: "scope_rejected"}]}, session} =
             AuthorizedToolExecutor.execute_with_session(request(), execution,
               validate_result: validator
             )

    assert session.tool_call_count == 1
    assert session.provider_call_count == 2
    assert calls.() == 2

    assert_receive {:validated, %ToolResult{output: %{items: [%{body: "second body"}]}}}

    refute_receive {:validated, _}, 10
    assert {:ok, []} = RequestIR.pending_call_ids(session.request_ir)
  end

  test "阶段/companion 校验在交换内拒绝，不调用应用校验且重试一次" do
    parent = self()
    companion = native_companion()

    {execution, calls, _prompts} =
      scripted_execution([
        native_success("call-1", "first body", [companion]),
        native_success("call-2", "second body", [companion])
      ])

    req =
      request(
        tool_name: "character_design",
        input: %{
          "creative_brief" => "设计一个角色",
          "context_text" => "上下文",
          "authoring_task" => AuthoringTask.to_map(AuthoringTaskFixtures.task(:character_design))
        }
      )

    validator = fn %ToolResult{} = result ->
      send(parent, {:validated, result})
      :ok
    end

    assert {%ToolResult{
              status: :failed,
              errors: [%{code: "unexpected_companion_artifacts"}]
            }, session} =
             AuthorizedToolExecutor.execute_with_session(req, execution,
               validate_result: validator
             )

    assert session.tool_call_count == 1
    assert session.provider_call_count == 2
    assert calls.() == 2
    refute_receive {:validated, _}, 10
    assert {:ok, []} = RequestIR.pending_call_ids(session.request_ir)
  end

  test "公开入口 max_provider_calls=0 零调用并保留初始 IR 与预算错误" do
    parent = self()
    {execution, calls, _prompts} = scripted_execution([native_success("unused", "unused")])

    validator = fn %ToolResult{} = result ->
      send(parent, {:validated, result})
      :ok
    end

    assert {%ToolResult{status: :failed, errors: [%{code: "provider_call_budget_exhausted"}]},
            session} =
             AuthorizedToolExecutor.execute_with_session(request(), execution,
               validate_result: validator,
               max_provider_calls: 0
             )

    assert session.tool_call_count == 1
    assert session.provider_call_count == 0
    assert session.provider_result == nil
    assert calls.() == 0
    refute_receive {:validated, _}, 10

    refute Enum.any?(session.request_ir.messages, &(&1.role in ["assistant", "tool"]))
  end

  test "公开入口 max_provider_calls=1 拒绝后不再重试且末次闭合" do
    {execution, calls, _prompts} =
      scripted_execution([
        native_success("call-1", "first body"),
        native_success("call-2", "second body")
      ])

    validator = fn %ToolResult{} ->
      {:error, %{reason_code: "scope_rejected", detail: %{}, message: "范围不匹配"}}
    end

    assert {%ToolResult{status: :failed, errors: [%{code: "scope_rejected"}]}, session} =
             AuthorizedToolExecutor.execute_with_session(request(), execution,
               validate_result: validator,
               max_provider_calls: 1
             )

    assert session.provider_call_count == 1
    assert calls.() == 1
    assert {:ok, []} = RequestIR.pending_call_ids(session.request_ir)
    assert Enum.map(validation_call_ids(session.request_ir), & &1) == ["call-1"]
  end

  test "公开入口 max_provider_calls 大于 2 时仍最多两次" do
    {execution, calls, _prompts} =
      scripted_execution([
        native_success("call-1", "first body"),
        native_success("call-2", "second body"),
        native_success("call-3", "third body")
      ])

    validator = fn %ToolResult{} ->
      {:error, %{reason_code: "scope_rejected", detail: %{}, message: "范围不匹配"}}
    end

    assert {%ToolResult{status: :failed, errors: [%{code: "scope_rejected"}]}, session} =
             AuthorizedToolExecutor.execute_with_session(request(), execution,
               validate_result: validator,
               max_provider_calls: 99
             )

    assert session.tool_call_count == 1
    assert session.provider_call_count == 2
    assert calls.() == 2
  end

  test "公开入口 max_provider_calls 负数或坏类型明确拒绝且零调用" do
    for bad <- [-1, "2", 2.5] do
      {execution, calls, _prompts} =
        scripted_execution([native_success("unused", "unused")])

      assert {%ToolResult{status: :failed, errors: [%{code: "invalid_max_provider_calls"}]},
              session} =
               AuthorizedToolExecutor.execute_with_session(request(), execution,
                 max_provider_calls: bad
               )

      assert session == %{tool_call_count: 0}
      assert calls.() == 0
    end
  end

  test "非 creative 工具传 validate_result 明确失败且不派发" do
    parent = self()
    {execution, calls, _prompts} = scripted_execution([native_success("unused", "unused")])

    validator = fn %ToolResult{} = result ->
      send(parent, {:validated, result})
      :ok
    end

    assert {%ToolResult{status: :failed, errors: [%{code: "unsupported_validator_option"}]},
            session} =
             AuthorizedToolExecutor.execute_with_session(
               request(tool_name: "text_analysis"),
               execution,
               validate_result: validator
             )

    assert session == %{tool_call_count: 0}
    assert calls.() == 0
    refute_receive {:validated, _}, 10
  end

  test "未授权/未知/grant 拒绝在带选项时仍零 provider 且不调用校验" do
    parent = self()

    validator = fn %ToolResult{} = result ->
      send(parent, {:validated, result})
      :ok
    end

    cases = [
      {request(tool_name: "nonexistent"), "unknown_tool"},
      {request(tool_name: "text_analysis", read_scope_grants: ["admin_access"]),
       "grant_scope_violation"},
      {request(decision_ref: nil), "missing_orchestrator_authorization"}
    ]

    for {req, code} <- cases do
      {execution, calls, _prompts} = scripted_execution([native_success("unused", "unused")])

      assert {%ToolResult{status: :failed, errors: [%{code: ^code}]}, session} =
               AuthorizedToolExecutor.execute_with_session(req, execution,
                 validate_result: validator
               )

      assert session == %{tool_call_count: 0}
      assert calls.() == 0
    end

    refute_receive {:validated, _}, 10
  end

  test "公开入口 validate_result 坏类型或错误 arity 在派发前拒绝且零 provider" do
    initial = request()

    for bad <- [:not_a_function, fn _a, _b -> :ok end] do
      {execution, calls, _prompts} =
        scripted_execution([native_success("unused", "unused")])

      assert {%ToolResult{
                status: :failed,
                errors: [%{code: "invalid_validate_result_option"}]
              }, %{tool_call_count: 0} = session} =
               AuthorizedToolExecutor.execute_with_session(initial, execution,
                 validate_result: bad
               )

      assert calls.() == 0
      refute Map.has_key?(session, :request_ir)
      refute Map.has_key?(session, :provider_result)
      refute Map.has_key?(session, :provider_call_count)
    end
  end

  test "公开入口 validator 返回坏形状：保响应、闭合 call、固定安全原因且不重试" do
    real = native_success("call-1", "first body")
    retry = native_success("call-2", "second body")
    {execution, calls, _prompts} = scripted_execution([real, retry])

    validator = fn _tool_result -> fn -> :private_state end end

    assert {%ToolResult{
              status: :failed,
              errors: [%{code: "invalid_validation_callback_result", message: reason}]
            }, session} =
             AuthorizedToolExecutor.execute_with_session(request(), execution,
               validate_result: validator
             )

    assert reason =~ "validate_result callback returned an unsupported result"
    refute reason =~ "#Function"
    assert session.tool_call_count == 1
    assert session.provider_call_count == 1
    assert calls.() == 1
    assert Enum.count(session.request_ir.messages, &(&1.role == "assistant")) == 1
    assert {:ok, []} = RequestIR.pending_call_ids(session.request_ir)

    assert [
             %{
               call_id: "call-1",
               status: "failed",
               reason_code: "invalid_validation_callback_result",
               detail: detail
             }
           ] =
             for(
               %{role: "tool", blocks: blocks} <- session.request_ir.messages,
               %{type: "validation_result", call_id: "call-1"} = block <- blocks,
               do: block
             )

    assert detail["message"] == "validate_result callback returned an unsupported result"
    refute detail["message"] =~ "#Function"
    refute Map.has_key?(detail, "returned")
    refute contains_function?(session)
  end

  test "非 creative 工具成功只记录一次真实 adapter 派发且不消耗 Provider" do
    {execution, calls, _prompts} = scripted_execution([])

    assert {%ToolResult{status: :succeeded, tool_name: "text_analysis"},
            %{tool_call_count: 1} = session} =
             AuthorizedToolExecutor.execute_with_session(
               request(tool_name: "text_analysis"),
               execution
             )

    assert calls.() == 0
    refute Map.has_key?(session, :provider_call_count)
  end

  test "非 creative 工具显式 max_provider_calls 在派发前拒绝且零调用" do
    for value <- [0, 1, 2] do
      {execution, calls, _prompts} = scripted_execution([])

      assert {%ToolResult{
                status: :failed,
                errors: [%{code: "unsupported_provider_call_option"}]
              }, %{tool_call_count: 0}} =
               AuthorizedToolExecutor.execute_with_session(
                 request(tool_name: "text_analysis"),
                 execution,
                 max_provider_calls: value
               )

      assert calls.() == 0
    end
  end

  test "非 creative 工具显式 validate_result: nil 不构成限制并正常派发" do
    {execution, calls, _prompts} = scripted_execution([])

    assert {%ToolResult{status: :succeeded}, %{tool_call_count: 1}} =
             AuthorizedToolExecutor.execute_with_session(
               request(tool_name: "text_analysis"),
               execution,
               validate_result: nil
             )

    assert calls.() == 0
  end

  defp request(overrides \\ []) do
    base = %ToolRequest{
      tool_request_id: "tq-toolbox-session",
      turn_id: "turn-1",
      frame_ref: "frame-1",
      decision_ref: "decision-1",
      tool_name: "prose_writing",
      tool_version: "1.0.0",
      input: %{
        "creative_brief" => "写第一章开篇",
        "context_text" => "上下文",
        "authoring_task" => AuthoringTask.to_map(AuthoringTaskFixtures.prose_task())
      },
      read_scope_grants: [],
      write_scope_grants: [],
      idempotency_key: "idem-toolbox-session",
      created_at: DateTime.utc_now()
    }

    struct!(base, overrides)
  end

  defp provider_execution(counter) do
    AuthoringTaskFixtures.provider_execution(
      fn _prompt ->
        :counters.add(counter, 1, 1)

        {:ok,
         %{
           content:
             Jason.encode!([
               %{
                 item_id: "prose-session-item",
                 title: "第一章 开篇",
                 body: "夜色压在账单上。",
                 rationale: nil
               }
             ])
         }}
      end,
      "submit_tentative_artifact"
    )
  end

  defp provider_calls(counter), do: :counters.get(counter, 1)

  defp scripted_execution(responses) do
    agent = start_supervised!({Agent, fn -> {responses, []} end}, id: make_ref())

    execution = %Execution{
      result_fn: fn prompt ->
        Agent.get_and_update(agent, fn
          {[response | rest], prompts} ->
            {response, {rest, prompts ++ [prompt]}}

          {[], prompts} ->
            {{:error, :unexpected_extra_call}, {[], prompts}}
        end)
      end
    }

    {execution, fn -> Agent.get(agent, fn {_responses, prompts} -> length(prompts) end) end,
     fn -> Agent.get(agent, fn {_responses, prompts} -> prompts end) end}
  end

  defp native_success(call_id, body, companions \\ []) do
    {:ok,
     %{
       content: "",
       tool_calls: [
         %{
           id: call_id,
           name: "submit_tentative_artifact",
           arguments: %{
             items: [
               %{
                 item_id: "item-#{call_id}",
                 title: "标题",
                 body: body,
                 rationale: nil
               }
             ],
             companion_artifacts: companions
           }
         }
       ]
     }}
  end

  defp native_invalid_multi do
    {:ok,
     %{
       content: "",
       tool_calls: [
         %{
           id: "invalid-a",
           name: "submit_tentative_artifact",
           arguments: %{items: []}
         },
         %{id: "invalid-b", name: "canon_write", arguments: %{}}
       ]
     }}
  end

  defp native_companion do
    %{
      artifact_type: "world_rule_seed",
      item_id: "rule-1",
      title: "规则",
      body: "规则内容",
      rationale: nil
    }
  end

  defp validation_call_ids(ir) do
    for %{role: "tool", blocks: blocks} <- ir.messages,
        %{type: "validation_result", call_id: call_id} <- blocks,
        do: call_id
  end

  defp contains_function?(term) when is_function(term), do: true

  defp contains_function?(term) when is_map(term) do
    Enum.any?(Map.to_list(term), fn {key, value} ->
      contains_function?(key) or contains_function?(value)
    end)
  end

  defp contains_function?(term) when is_list(term), do: Enum.any?(term, &contains_function?/1)

  defp contains_function?(term) when is_tuple(term),
    do: term |> Tuple.to_list() |> contains_function?()

  defp contains_function?(_term), do: false
end
