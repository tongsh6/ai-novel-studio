defmodule NovelAgent.AuthorizedToolExecutor do
  @moduledoc """
  Executes ToolRequest values that already crossed the application orchestrator.

  This module keeps production tool dispatch behind an explicit authorized request
  boundary. It is intentionally small: application code owns OrchestratorDecision
  creation, while agent code owns the toolbox runtime.
  """

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Toolbox
  alias NovelCommon.Contracts.ToolRequest
  alias NovelCommon.Contracts.ToolResult

  @spec execute(ToolRequest.t()) :: ToolResult.t()
  def execute(%ToolRequest{} = req), do: execute(req, nil)

  @spec execute(ToolRequest.t(), Execution.dependency()) :: ToolResult.t()
  def execute(%ToolRequest{} = req, provider_execution) do
    if authorized_request?(req) do
      Toolbox.execute(req, provider_execution)
    else
      failed(req)
    end
  end

  defp authorized_request?(%ToolRequest{} = req) do
    present?(req.decision_ref) and present?(req.frame_ref) and present?(req.tool_request_id)
  end

  defp present?(value), do: is_binary(value) and String.trim(value) != ""

  defp failed(%ToolRequest{} = req) do
    %ToolResult{
      tool_result_id: "tr_#{System.unique_integer([:positive, :monotonic])}",
      tool_request_ref: req.tool_request_id,
      tool_name: req.tool_name,
      status: :failed,
      errors: [
        %{
          code: "missing_orchestrator_authorization",
          message: "ToolRequest is missing orchestrator authorization refs"
        }
      ],
      completed_at: DateTime.utc_now()
    }
  end
end
