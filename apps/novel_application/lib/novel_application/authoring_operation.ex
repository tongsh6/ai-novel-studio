defmodule NovelApplication.AuthoringOperation do
  @moduledoc """
  B71：应用操作的角色、材料与结果统一进入 canonical 会话（VS-00L §16.6）。

  仅构造和校验请求事实，不调用 Provider，也不决定业务执行或采纳。
  已有会话只追加阶段 scope；应用目标不会被当成新的作者消息。
  """

  alias NovelApplication.AgentRunFlows.AuthoringSession
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.ExecutionOrchestrator
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Operation

  @max_exchange_provider_calls 2

  @type specification :: %{
          required(:role) => String.t(),
          required(:instructions) => String.t(),
          required(:scope) => String.t(),
          required(:tool) => map(),
          optional(:source_refs) => [map()],
          optional(:versions) => map(),
          optional(:author_text) => String.t() | nil
        }

  @spec prepare(map() | nil, map(), specification()) :: {:ok, RequestIR.t()} | {:error, term()}
  def prepare(run, snapshot, %{role: role, instructions: rules, scope: scope, tool: tool} = spec)
      when is_binary(role) and is_binary(rules) and is_binary(scope) and is_map(tool) do
    with {:ok, previous} <- previous_ir(snapshot) do
      Operation.prepare(previous, run, %{spec | scope: scope <> runtime_scope(run)})
    end
  end

  def prepare(_run, _snapshot, _spec), do: {:error, :invalid_authoring_operation}

  defp previous_ir(snapshot) do
    case AuthoringSession.transcript(snapshot) do
      nil -> {:ok, nil}
      transcript -> AuthoringTranscript.to_request_ir(transcript)
    end
  end

  defp runtime_scope(run) do
    facts = Map.take(run || %{}, [:authority_scope, :budget, :consumed_budget])

    case map_size(facts) do
      0 -> "\n\n当前运行权限与预算未提供；操作仍须经过应用逐步授权。"
      _ -> "\n\n## 当前运行权限与预算（不是执行批准）\n" <> Jason.encode!(facts)
    end
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
