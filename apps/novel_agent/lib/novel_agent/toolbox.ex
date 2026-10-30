defmodule NovelAgent.Toolbox do
  @moduledoc """
  Agent-side toolbox runtime.

  The toolbox validates registry/grants and dispatches to adapters. It returns
  ToolResult only; artifact assembly, UI cards, available actions, and adoption
  semantics are application responsibilities.
  """

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelAgent.Provider.Execution
  alias NovelAgent.ToolAdapterRegistry
  alias NovelCommon.CapabilityRegistry
  alias NovelCommon.Contracts.ToolRequest
  alias NovelCommon.Contracts.ToolResult
  alias NovelCommon.LogContext

  @spec execute(ToolRequest.t()) :: ToolResult.t()
  def execute(%ToolRequest{} = req), do: execute_impl(req, nil)

  @spec execute(ToolRequest.t(), Execution.dependency()) :: ToolResult.t()
  def execute(%ToolRequest{} = req, provider_execution) do
    execute_impl(req, provider_execution)
  end

  defp execute_impl(%ToolRequest{} = req, provider_execution) do
    t0 = System.monotonic_time(:millisecond)
    LogContext.put_tool_request(req.tool_request_id)

    LogEmit.emit(:toolbox, :execute, :start, %{
      tool_name: req.tool_name,
      tool_request_id: req.tool_request_id
    })

    result =
      cond do
        is_nil(CapabilityRegistry.get(req.tool_name)) ->
          failed(req, "unknown_tool", "tool not found in production registry")

        not CapabilityRegistry.dispatchable?(req.tool_name) ->
          failed(req, "tool_not_dispatchable", "tool is disabled or deprecated")

        not CapabilityRegistry.grants_valid?(
          req.tool_name,
          req.read_scope_grants,
          req.write_scope_grants
        ) ->
          failed(req, "grant_scope_violation", "requested grants exceed registry scopes")

        true ->
          LogContext.with_step("tool.#{req.tool_name}", fn ->
            dispatch(req, provider_execution)
          end)
      end

    emit_done(req, result, System.monotonic_time(:millisecond) - t0)
    result
  end

  defp dispatch(%ToolRequest{} = req, provider_execution) do
    case ToolAdapterRegistry.adapter_for(req.tool_name) do
      nil ->
        failed(req, "no_handler", "no adapter registered for tool")

      _adapter ->
        req.tool_name
        |> ToolAdapterRegistry.execute(req, provider_execution)
        |> ensure_contract(req)
    end
  end

  # B45 CP3：工具适配器返回后先校验本地契约；不合格转失败结果，绝不把坏 output
  # 当成功事实继续组装/采纳。
  defp ensure_contract(%ToolResult{} = result, req) do
    case ToolResult.validate(result) do
      [] -> result
      errors -> failed(req, "tool_result_contract_invalid", Enum.join(errors, "; "))
    end
  end

  defp ensure_contract(_other, req) do
    failed(req, "tool_result_contract_invalid", "tool_result must be a ToolResult struct")
  end

  defp failed(%ToolRequest{} = req, code, message) do
    %ToolResult{
      tool_result_id: NovelFoundation.ID.unique("tr"),
      tool_request_ref: req.tool_request_id,
      tool_name: req.tool_name,
      status: :failed,
      output: nil,
      errors: [%{code: code, message: message}],
      artifact_refs: [],
      state_delta: [],
      completed_at: DateTime.utc_now()
    }
  end

  defp emit_done(req, %ToolResult{status: :succeeded}, duration) do
    LogEmit.emit(:toolbox, :execute, :done, %{
      tool_name: req.tool_name,
      tool_outcome: :succeeded,
      duration_ms: duration
    })
  end

  defp emit_done(req, %ToolResult{} = result, duration) do
    error_code =
      result.errors
      |> List.wrap()
      |> List.first(%{code: "unknown_error"})
      |> Map.get(:code)

    LogEmit.emit(:toolbox, :execute, :error, %{
      tool_name: req.tool_name,
      tool_outcome: result.status,
      reason_code: error_code,
      duration_ms: duration
    })
  end
end
