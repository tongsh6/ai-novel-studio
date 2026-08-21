defmodule NovelAgent.Tools.CreativeToolAdapter do
  @moduledoc false

  alias NovelAgent.Provider.Execution
  alias NovelCommon.Contracts.CreativeProviderResult
  alias NovelCommon.Contracts.CreativeRequest
  alias NovelCommon.Contracts.ToolOutputContract
  alias NovelCommon.Contracts.ToolRequest
  alias NovelCommon.Contracts.ToolResult

  @companion_artifact_order [
    :character_seed,
    :foreshadowing_seed,
    :world_rule_seed,
    :constraint_seed
  ]

  @spec execute(ToolRequest.t(), atom(), Execution.dependency(), module()) ::
          ToolResult.t()
  def execute(%ToolRequest{} = req, artifact_type, provider_execution, provider_module) do
    result_id = NovelFoundation.ID.unique("tr")
    now = DateTime.utc_now()

    case ToolOutputContract.normalize_artifact_type(artifact_type) do
      {:ok, normalized_type} ->
        request = creative_request(req, normalized_type)

        request
        |> provider_module.generate(provider_execution)
        |> provider_result_to_tool_result(req, result_id, now, normalized_type)

      {:error, %{code: code, message: message}} ->
        failed_tool_result(req, result_id, now, [%{code: code, message: message}])
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
      # VS-00F CP1：账面投影文本（progress_state_packet 传输载体）同型透传。
      progress_state: optional_text(Map.get(req.input, "progress_state")),
      decision_packet: optional_map(Map.get(req.input, "decision_packet")),
      # VS-00E CP3：按质量发现重写的要求文本放入 input["revision"]，同样透传给 provider。
      revision: optional_text(Map.get(req.input, "revision")),
      provider_hints: Map.get(req.input, "provider_hints", %{})
    }
  end

  defp optional_text(value) when is_binary(value) do
    if String.trim(value) == "", do: nil, else: value
  end

  defp optional_text(_value), do: nil

  defp optional_map(value) when is_map(value), do: value
  defp optional_map(_value), do: nil

  defp provider_result_to_tool_result(
         %CreativeProviderResult{
           status: :ok,
           items: items,
           companion_artifacts: companion_artifacts,
           self_report: self_report
         },
         req,
         result_id,
         now,
         artifact_type
       ) do
    case validate_provider_output(req, items, companion_artifacts) do
      {:ok, normalized_items, normalized_companions} ->
        succeeded_tool_result(
          req,
          result_id,
          now,
          artifact_type,
          normalized_items,
          normalized_companions,
          self_report
        )

      {:error, %{code: code, message: message}} ->
        failed_tool_result(req, result_id, now, [%{code: code, message: message}])
    end
  end

  defp provider_result_to_tool_result(
         %CreativeProviderResult{status: :error, errors: errors},
         req,
         result_id,
         now,
         _artifact_type
       ),
       do: failed_tool_result(req, result_id, now, errors)

  defp validate_provider_output(req, items, companion_artifacts) do
    with {:ok, normalized_items} <- ToolOutputContract.validate_creative_items(items),
         {:ok, normalized_companions} <-
           ToolOutputContract.validate_prose_companion_artifacts(companion_artifacts),
         :ok <- validate_companion_scope(req.tool_name, normalized_companions),
         :ok <-
           ToolOutputContract.validate_unique_item_ids(normalized_items, normalized_companions) do
      {:ok, normalized_items, normalized_companions}
    end
  end

  defp validate_companion_scope("prose_writing", _companion_artifacts), do: :ok
  defp validate_companion_scope(_tool_name, []), do: :ok

  defp validate_companion_scope(_tool_name, _companion_artifacts) do
    {:error,
     %{
       code: "unexpected_companion_artifacts",
       message: "companion artifacts are only allowed for prose_writing"
     }}
  end

  defp succeeded_tool_result(
         req,
         result_id,
         now,
         artifact_type,
         items,
         companion_artifacts,
         self_report
       ) do
    companion_groups = companion_groups(companion_artifacts)
    all_items = items ++ companion_artifacts

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
          items: items,
          companion_item_count: length(companion_artifacts),
          companion_artifacts: companion_groups
        }
        |> maybe_put_self_report(self_report),
      state_delta:
        ([%{type: :tentative_artifact, key: req.tool_name, artifact_type: artifact_type}] ++
           Enum.map(companion_groups, fn group ->
             %{
               type: :tentative_artifact,
               key: req.tool_name,
               artifact_type: group.artifact_type
             }
           end))
        |> maybe_add_self_report_delta(self_report),
      artifact_refs: Enum.map(all_items, & &1.item_id),
      warnings: self_report_warnings(self_report),
      usage: %{duration_ms: 0, tool: req.tool_name, version: req.tool_version},
      trace_refs: ["tool_trace:#{result_id}"],
      completed_at: now
    }
  end

  defp companion_groups(items) when is_list(items) do
    grouped = Enum.group_by(items, & &1.artifact_type)

    @companion_artifact_order
    |> Enum.flat_map(fn artifact_type ->
      case Map.get(grouped, artifact_type, []) do
        [] ->
          []

        grouped_items ->
          [
            %{
              artifact_type: artifact_type,
              items: Enum.map(grouped_items, &Map.delete(&1, :artifact_type))
            }
          ]
      end
    end)
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
