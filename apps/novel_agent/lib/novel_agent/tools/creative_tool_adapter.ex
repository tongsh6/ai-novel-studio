defmodule NovelAgent.Tools.CreativeToolAdapter do
  @moduledoc false

  alias NovelCommon.Contracts.CreativeProviderResult
  alias NovelCommon.Contracts.CreativeRequest
  alias NovelCommon.Contracts.ToolOutputContract
  alias NovelCommon.Contracts.ToolRequest
  alias NovelCommon.Contracts.ToolResult

  @spec execute(ToolRequest.t(), atom(), (String.t() -> tuple()) | nil, module()) ::
          ToolResult.t()
  def execute(%ToolRequest{} = req, artifact_type, complete_fn, provider_module) do
    result_id = "tr_#{System.unique_integer([:positive, :monotonic])}"
    now = DateTime.utc_now()

    with {:ok, normalized_type} <- ToolOutputContract.normalize_artifact_type(artifact_type),
         true <- is_function(complete_fn, 1) do
      request = creative_request(req, normalized_type)

      case provider_module.generate(request, complete_fn) do
        %CreativeProviderResult{status: :ok, items: items} ->
          succeeded_tool_result(req, result_id, now, normalized_type, items)

        %CreativeProviderResult{status: :error, errors: errors} ->
          failed_tool_result(req, result_id, now, errors)
      end
    else
      {:error, %{code: code, message: message}} ->
        failed_tool_result(req, result_id, now, [%{code: code, message: message}])

      false ->
        failed_tool_result(req, result_id, now, [
          %{code: "complete_fn_required", message: "LLM-dependent tool requires provider"}
        ])
    end
  end

  defp creative_request(%ToolRequest{} = req, artifact_type) do
    %CreativeRequest{
      request_id: "cr_#{req.tool_request_id}",
      tool_name: req.tool_name,
      artifact_type: artifact_type,
      creative_brief: Map.get(req.input, "creative_brief") || Map.get(req.input, "text", ""),
      context_text: Map.get(req.input, "context_text", ""),
      source_turn_ref: req.turn_id,
      provider_hints: Map.get(req.input, "provider_hints", %{})
    }
  end

  defp succeeded_tool_result(req, result_id, now, artifact_type, items) do
    %ToolResult{
      tool_result_id: result_id,
      tool_request_ref: req.tool_request_id,
      tool_name: req.tool_name,
      status: :succeeded,
      output: %{
        output_contract_ref: "tentative_artifact_v1",
        artifact_type: artifact_type,
        item_count: length(items),
        items: items
      },
      state_delta: [
        %{type: :tentative_artifact, key: req.tool_name, artifact_type: artifact_type}
      ],
      artifact_refs: Enum.map(items, & &1.item_id),
      usage: %{duration_ms: 0, tool: req.tool_name, version: req.tool_version},
      trace_refs: ["tool_trace:#{result_id}"],
      completed_at: now
    }
  end

  defp failed_tool_result(req, result_id, now, errors) do
    %ToolResult{
      tool_result_id: result_id,
      tool_request_ref: req.tool_request_id,
      tool_name: req.tool_name,
      status: :failed,
      output: nil,
      errors: errors,
      artifact_refs: [],
      state_delta: [],
      completed_at: now
    }
  end
end
