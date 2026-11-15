defmodule NovelApplication.AuthoringOperation do
  @moduledoc """
  B71：应用操作的角色、材料与结果统一进入 canonical 会话（VS-00L §16.6）。

  仅构造和校验请求事实，不调用 Provider，也不决定业务执行或采纳。
  已有会话只追加阶段 scope；应用目标不会被当成新的作者消息。
  """

  alias NovelApplication.AgentRunFlows.AuthoringSession
  alias NovelApplication.AuthoringSessionHistory
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.ExecutionOrchestrator
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Operation

  @max_exchange_provider_calls 2

  @type specification :: %{
          required(:role) => String.t(),
          required(:instructions) => String.t(),
          required(:scope) => map(),
          required(:tool) => map(),
          optional(:source_refs) => [map()],
          optional(:base_refs) => [map()],
          optional(:versions) => map(),
          optional(:author_text) => String.t() | nil,
          optional(:source_input_ref) => String.t() | nil
        }

  @spec prepare(map() | nil, map(), specification()) :: {:ok, RequestIR.t()} | {:error, term()}
  def prepare(run, snapshot, %{role: role, instructions: rules, scope: scope, tool: tool} = spec)
      when is_binary(role) and is_binary(rules) and is_map(scope) and is_map(tool) do
    with {:ok, previous} <- previous_ir(snapshot),
         {:ok, previous} <-
           AuthoringSession.record_author_input(
             previous,
             explicit_author_input(spec),
             Map.get(run || %{}, :author_turn)
           ),
         {:ok, ir} <-
           Operation.prepare(previous, run, %{spec | scope: runtime_scope(scope, run)}) do
      include_initial_history(ir, snapshot)
    end
  end

  def prepare(_run, _snapshot, _spec), do: {:error, :invalid_authoring_operation}

  defp explicit_author_input(%{author_text: text, source_input_ref: ref})
       when is_binary(text) and text != "" and is_binary(ref) and ref != "",
       do: %{turn_id: ref, text: text}

  defp explicit_author_input(_spec), do: nil

  defp include_initial_history(ir, %{initial_session_history: history}) do
    with {:ok, segment} <- AuthoringTranscript.from_request_ir(ir) do
      segment
      |> AuthoringSessionHistory.compose(history)
      |> AuthoringTranscript.to_request_ir()
    end
  end

  defp include_initial_history(ir, _snapshot), do: {:ok, ir}

  defp previous_ir(snapshot) do
    case AuthoringSession.transcript(snapshot) do
      nil -> {:ok, nil}
      transcript -> AuthoringTranscript.to_request_ir(transcript)
    end
  end

  defp runtime_scope(scope, run) do
    scope = RequestIR.json_value(scope)
    operation = Map.get(scope, "operation", %{})

    runtime =
      run
      |> then(&Map.take(&1 || %{}, [:authority_scope, :budget, :consumed_budget]))
      |> RequestIR.json_value()

    if is_map(operation),
      do: Map.put(scope, "operation", Map.put(operation, "runtime", runtime)),
      else: scope
  end

  @doc """
  记录已经完成的应用校验，闭合当前真实响应的原生调用；这不是执行批准。
  """
  @spec complete(map(), String.t(), map()) :: map()
  def complete(session, reason_code, detail) when is_map(detail) do
    detail = Map.merge(detail, %{execution_authorized: false, canon_written: false})

    session
    |> AuthoringSession.validate_provider_result("passed", reason_code, detail)
    |> metadata()
  end

  @doc "成功和失败都携带同一会话与实际调用数，供下一步、终局和 durable checkpoint 消费。"
  @spec metadata(map()) :: map()
  def metadata(session), do: AuthoringSession.provider_metadata(session)

  @doc """
  把现有 gate context 的剩余 provider 预算转成原生交换上限。

  缺失或不可观察的预算保守为 0，整数剩余 clamp 到 0..2；复用
  `ExecutionOrchestrator.gate_context_for_run/1` 的 atom/string 预算读取，不另立公式。
  """
  @spec tool_execution_options(map()) :: keyword()
  def tool_execution_options(run) when is_map(run) do
    remaining =
      run
      |> ExecutionOrchestrator.gate_context_for_run()
      |> get_in([:budget, :remaining, :provider_calls])

    [max_provider_calls: clamp_exchange_provider_calls(remaining)]
  end

  defp clamp_exchange_provider_calls(remaining) when is_integer(remaining) do
    remaining
    |> max(0)
    |> min(@max_exchange_provider_calls)
  end

  defp clamp_exchange_provider_calls(_remaining), do: 0
end
