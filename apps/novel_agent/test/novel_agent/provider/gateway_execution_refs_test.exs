defmodule NovelAgent.Provider.GatewayExecutionRefsFixtureProvider do
  @behaviour NovelAgent.Provider

  alias NovelAgent.Provider.AdapterExecution
  alias NovelAgent.Provider.Result
  alias NovelCommon.LLMLog
  alias NovelTest.TestProviderPrompt

  defstruct []

  @impl true
  def execute(_state, model, prompt, _params, ctx) do
    text = TestProviderPrompt.text(prompt)

    cond do
      String.contains?(text, "UA01FIXTUREFAIL") ->
        error = %{type: :provider_error, message: "fixture transport failure"}

        log(
          model,
          prompt,
          {:error, error,
           %{
             status: 503,
             usage: %{},
             duration: 0,
             resp_body: %{"error" => %{"message" => error.message}}
           }}
        )

        AdapterExecution.materialize_result({:error, error}, ctx)

      valid_response?(text) ->
        result = valid_result()

        log(
          model,
          prompt,
          {:ok, result,
           %{
             status: 200,
             usage: %{},
             duration: 0,
             resp_body: %{"content" => result.content, "tool_calls" => result.tool_calls}
           }}
        )

        AdapterExecution.materialize_result({:ok, result}, ctx)

      true ->
        result = Result.new("首轮缺少工具调用", nil, tool_calls: [])

        log(
          model,
          prompt,
          {:ok, result,
           %{
             status: 200,
             usage: %{},
             duration: 0,
             resp_body: %{"content" => result.content, "tool_calls" => []}
           }}
        )

        AdapterExecution.materialize_result({:ok, result}, ctx)
    end
  end

  @impl true
  def health_check(_state), do: :ok

  @impl true
  def name, do: "gateway_execution_refs_fixture"

  # 确定性测试替身：模拟完整 AgentRun 响应形态（含原生工具调用），不是真实传输。
  @impl true
  def capabilities(_state) do
    %{
      native_multi_turn: true,
      tool_calls: true,
      tool_results: true,
      streaming: true,
      structured_output: true,
      usage: true
    }
  end

  @impl true
  def projection_target(_state), do: "chat_completions"

  defp valid_response?(text) do
    String.contains?(text, "UA01FIXTUREOK") or
      String.contains?(text, "原生工具响应不符合契约")
  end

  defp valid_result do
    Result.new("重试后的协议响应", nil,
      tool_calls: [
        %{id: "native-1", name: "judgment_decision", arguments: %{"action" => "reply"}}
      ]
    )
  end

  defp log(model, prompt, result) do
    messages = if is_map(prompt), do: Map.get(prompt, :messages, []), else: []

    LLMLog.record(
      "gateway_execution_refs_fixture",
      "fixture://adapter",
      %{model: model, messages: messages},
      result,
      System.monotonic_time(:millisecond)
    )
  end
end

defmodule NovelAgent.Provider.GatewayExecutionRefsTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.NativeToolExchange
  alias NovelCommon.LLMLog
  alias NovelCommon.LogFileDate
  alias NovelCommon.RequestIR

  @tool "judgment_decision"
  @provider_opts [provider: :execution_refs_fixture, model: "fixture-model"]

  setup do
    old_extra = Application.get_env(:novel_agent, :extra_providers)
    old_dir = Application.get_env(:novel_common, :llm_log_dir)
    dir = Path.join(System.tmp_dir!(), "gateway-execution-refs-#{unique_integer()}")

    Application.put_env(:novel_agent, :extra_providers, %{
      execution_refs_fixture: NovelAgent.Provider.GatewayExecutionRefsFixtureProvider
    })

    Application.put_env(:novel_common, :llm_log_dir, dir)
    Logger.reset_metadata([])

    on_exit(fn ->
      Logger.reset_metadata([])
      restore_app_env(:novel_agent, :extra_providers, old_extra)
      restore_app_env(:novel_common, :llm_log_dir, old_dir)
      File.rm_rf!(dir)
    end)

    %{dir: dir}
  end

  test "真实 Execution.dependency 自动引用经 NativeToolExchange 与 LLMLog 配对逐次一致，协议失败重试保留两次",
       %{dir: dir} do
    result_fn = Execution.result_fn(dependency())
    assert is_function(result_fn, 1)

    assert {%{status: :ok, value: %{attempt: 2}}, session} =
             NativeToolExchange.run(
               ir("创作判断器\n## 作者输入\n请先给出创作判断。"),
               result_fn,
               @tool,
               &parse_judgment/2,
               &exchange_error/2
             )

    assert session.provider_call_count == 2
    assert {:ok, first_execution} = await_execution()
    assert {:ok, second_execution} = await_execution()

    assert [first_assistant, second_assistant] = assistants(session.request_ir)
    assert refs(first_assistant) == execution_refs(first_execution)
    assert refs(second_assistant) == execution_refs(second_execution)
    assert execution_refs(first_execution) != execution_refs(second_execution)
    assert result_refs(session.provider_result) == execution_refs(second_execution)
    assert output_refs(first_execution) == execution_refs(first_execution)
    assert output_refs(second_execution) == execution_refs(second_execution)

    [first_record, second_record] = read_llm_records(dir)

    assert llm_refs(first_record) == execution_refs(first_execution)
    assert llm_refs(second_record) == execution_refs(second_execution)
    assert first_record["response"]["status"] == 200
    assert second_record["response"]["status"] == 200
    assert first_record["response"]["body"]["content"] == assistant_text(first_assistant)
    assert second_record["response"]["body"]["content"] == assistant_text(second_assistant)
    assert first_record["response"]["body"]["tool_calls"] == []

    assert [%{"id" => "native-1", "name" => @tool}] =
             second_record["response"]["body"]["tool_calls"]

    [canonical_call] = Enum.filter(second_assistant.blocks, &(&1.type == "tool_call"))
    assert canonical_call.call_id == "native-1"
    refute Map.has_key?(canonical_call, :provider_call_id)

    {first_call, first_run} = execution_refs(first_execution)
    assert is_binary(first_call) and first_call != ""
    assert is_binary(first_run) and first_run != ""
    refute first_call == first_run
    assert :ok = RequestIR.validate(session.request_ir)
  end

  test "传输失败没有 response 时不追加 assistant 或假原生 id，错误日志绑定同一失败 ProviderRun", %{
    dir: dir
  } do
    assert {%{status: :ok}, success_session} =
             NativeToolExchange.run(
               ir("创作判断器\n## 作者输入\nUA01FIXTUREOK"),
               Execution.result_fn(dependency()),
               @tool,
               &parse_judgment/2,
               &exchange_error/2
             )

    assert {:ok, success_execution} = await_execution()

    assert {%{status: :error, error: %{code: "provider_error"}}, failed_session} =
             NativeToolExchange.run(
               ir("创作判断器\n## 作者输入\nUA01FIXTUREFAIL"),
               Execution.result_fn(dependency()),
               @tool,
               &parse_judgment/2,
               &exchange_error/2
             )

    assert {:error, failed_execution} = await_execution()
    failed_run = failed_execution.provider_run

    assert assistants(failed_session.request_ir) == []
    assert failed_session.provider_result == nil
    assert only_user_ir(failed_session.request_ir)

    assert refs(List.last(assistants(success_session.request_ir))) ==
             execution_refs(success_execution)

    [success_record, failed_record] = read_llm_records(dir)

    assert success_record["response"]["status"] == 200
    assert failed_record["response"]["status"] == 503
    refute Map.has_key?(failed_record["response"]["body"], "content")
    refute Map.has_key?(failed_record["response"]["body"], "tool_calls")
    refute Map.has_key?(failed_record["response"]["body"], "id")

    assert failed_run.status == :failed
    assert llm_refs(failed_record) == execution_refs(failed_execution)
    assert llm_refs(failed_record) == output_refs(failed_execution)
    assert output_refs(failed_execution) == execution_refs(failed_execution)

    assert llm_refs(failed_record) != llm_refs(success_record)
    refute llm_refs(failed_record) == execution_refs(success_execution)
  end

  # 只经生产 Execution.dependency → Execution.result_fn 进入 NativeToolExchange；
  # 仅用真实 event_sink 抓 terminal facts 作期望值，不在测试里重放 Gateway 结果或
  # 手工构造 pcall/prun 引用。
  defp dependency do
    test_pid = self()

    event_sink = fn
      {:ok, %{events: events}} = execution ->
        if Enum.any?(events, &(&1.event_type == :final_output)) do
          send(test_pid, {:gateway_terminal, execution})
        end

      {:error, %{events: events}} = execution ->
        if Enum.any?(events, &(&1.event_type == :error)) do
          send(test_pid, {:gateway_terminal, execution})
        end
    end

    Execution.dependency(@provider_opts ++ [event_sink: event_sink])
  end

  defp await_execution do
    assert_receive {:gateway_terminal, execution}
    execution
  end

  defp parse_judgment(_result, attempt), do: %{status: :ok, value: %{attempt: attempt}}

  defp exchange_error(code, reason), do: %{status: :error, error: %{code: code, reason: reason}}

  defp ir(author_text) do
    RequestIR.new(%{
      run: %{
        run_id: "run-gateway-execution-refs",
        work_id: "work-gateway-execution-refs",
        workspace_id: "workspace-gateway-execution-refs",
        session_id: "session-gateway-execution-refs",
        parent_turn_ref: "turn-gateway-execution-refs"
      },
      system: RequestIR.system_envelope(),
      messages: [RequestIR.message(:user, :author, [RequestIR.text_block(author_text)])],
      tools: [%{name: @tool, input_schema: %{type: "object"}}],
      projection: %{}
    })
  end

  defp assistants(ir), do: Enum.filter(ir.messages, &(&1.role == "assistant"))

  defp only_user_ir(ir) do
    roles = Enum.map(ir.messages, & &1.role)
    encoded = Jason.encode!(ir.messages)

    roles == ["user"] and
      not String.contains?(encoded, "tool_call") and
      not String.contains?(encoded, "pcall") and
      not String.contains?(encoded, "prun")
  end

  defp refs(message),
    do: {Map.get(message, :provider_call_ref), Map.get(message, :provider_run_ref)}

  defp result_refs(result), do: {result.provider_call_ref, result.provider_run_ref}

  defp execution_refs(execution),
    do: {execution.provider_run.provider_call_ref, execution.provider_run.provider_run_id}

  defp output_refs(execution),
    do: {execution.output.provider_call_ref, execution.output.provider_run_ref}

  defp assistant_text(assistant) do
    Enum.find_value(assistant.blocks, fn
      %{type: "text", text: text} -> text
      _block -> nil
    end)
  end

  defp llm_refs(record), do: {record["provider_call_ref"], record["provider_run_ref"]}

  defp read_llm_records(dir) do
    dir
    |> Path.join("#{LogFileDate.today_iso8601()}.jsonl")
    |> File.read!()
    |> String.split("\n", trim: true)
    |> Enum.map(fn line ->
      [_prefix, json] = String.split(line, "] ", parts: 2)
      Jason.decode!(json)
    end)
  end

  defp unique_integer, do: System.unique_integer([:positive, :monotonic])

  defp restore_app_env(app, key, nil), do: Application.delete_env(app, key)

  defp restore_app_env(app, key, value), do: Application.put_env(app, key, value)
end
