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
        %CreativeProviderResult{status: :ok, items: items, self_report: self_report} ->
          succeeded_tool_result(req, result_id, now, normalized_type, items, self_report)

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
      # VS-00E：application 把已渲染的场级执行简述文本放入 input["execution_brief"]，
      # 透传给 provider；缺省 nil 时 provider message 不变（兼容三锚点）。
      execution_brief: optional_text(Map.get(req.input, "execution_brief")),
      provider_hints: Map.get(req.input, "provider_hints", %{})
    }
  end

  defp optional_text(value) when is_binary(value) do
    if String.trim(value) == "", do: nil, else: value
  end

  defp optional_text(_value), do: nil

  defp succeeded_tool_result(req, result_id, now, artifact_type, items, self_report) do
    %ToolResult{
      tool_result_id: result_id,
      tool_request_ref: req.tool_request_id,
      tool_name: req.tool_name,
      status: :succeeded,
      output:
        %{
          output_contract_ref: "tentative_artifact_v1",
          artifact_type: artifact_type,
          item_count: length(items),
          items: items
        }
        |> maybe_put_self_report(self_report),
      state_delta:
        [%{type: :tentative_artifact, key: req.tool_name, artifact_type: artifact_type}]
        |> maybe_add_self_report_delta(self_report),
      artifact_refs: Enum.map(items, & &1.item_id),
      warnings: self_report_warnings(self_report),
      usage: %{duration_ms: 0, tool: req.tool_name, version: req.tool_version},
      trace_refs: ["tool_trace:#{result_id}"],
      completed_at: now
    }
  end

  defp maybe_put_self_report(output, nil), do: output
  defp maybe_put_self_report(output, self_report), do: Map.put(output, :self_report, self_report)

  defp maybe_add_self_report_delta(state_delta, nil), do: state_delta

  defp maybe_add_self_report_delta(state_delta, self_report) do
    state_delta ++
      [%{type: :observation, key: "creative_output_self_report", value: self_report}]
  end

  defp self_report_warnings(nil), do: []

  defp self_report_warnings(%{risk_flags: []}), do: []

  defp self_report_warnings(%{risk_flags: flags, quality_action: action}) do
    [
      %{
        code: "creative_output_self_report",
        message: "creative output self_report contains non-authoritative risk flags",
        quality_action: action,
        risk_flags: flags
      }
    ]
  end

  defp self_report_warnings(_self_report), do: []

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
