defmodule NovelCommon.Contracts.ToolResult do
  @moduledoc """
  Structured tool fact returned by the toolbox.

  A succeeded tool result is not an adopted artifact and does not imply a
  production write.
  """

  @type result_status :: :succeeded | :failed | :partial | :cancelled

  @type t :: %__MODULE__{
          tool_result_id: String.t(),
          tool_request_ref: String.t(),
          tool_name: String.t(),
          status: result_status(),
          output: map() | nil,
          state_delta: [map()],
          artifact_refs: [String.t()],
          errors: [map()],
          warnings: [map()],
          usage: map(),
          trace_refs: [String.t()],
          completed_at: DateTime.t() | nil
        }

  @enforce_keys [:tool_result_id, :tool_request_ref, :tool_name, :status]
  defstruct [
    :tool_result_id,
    :tool_request_ref,
    :tool_name,
    :status,
    output: nil,
    state_delta: [],
    artifact_refs: [],
    errors: [],
    warnings: [],
    usage: %{},
    trace_refs: [],
    completed_at: nil
  ]

  @statuses [:succeeded, :failed, :partial, :cancelled]

  @doc """
  B45 CP3：工具输出本地契约校验（真实边界 = Toolbox 返回前）。

  只校验结构/类型/必填，不把 succeeded 解释成 adoption 或生产写入。
  """
  @spec validate(t()) :: [String.t()]
  def validate(%__MODULE__{} = result) do
    []
    |> require_id(:tool_result_id, result.tool_result_id)
    |> require_id(:tool_request_ref, result.tool_request_ref)
    |> require_id(:tool_name, result.tool_name)
    |> validate_status(result.status)
    |> validate_output(result.output)
    |> validate_list(:state_delta, result.state_delta, :map)
    |> validate_list(:artifact_refs, result.artifact_refs, :id)
    |> validate_list(:errors, result.errors, :map)
    |> validate_list(:warnings, result.warnings, :map)
    |> validate_map(:usage, result.usage)
    |> validate_list(:trace_refs, result.trace_refs, :id)
    |> validate_completed_at(result.completed_at)
  end

  def validate(_other), do: ["tool_result must be a ToolResult struct"]

  defp require_id(errors, _field, value) when is_binary(value) and value != "", do: errors
  defp require_id(errors, field, _value), do: ["#{field} is required" | errors]

  defp validate_status(errors, status) when status in @statuses, do: errors
  defp validate_status(errors, _status), do: ["status is invalid" | errors]

  defp validate_output(errors, nil), do: errors
  defp validate_output(errors, output) when is_map(output), do: errors
  defp validate_output(errors, _output), do: ["output must be a map or nil" | errors]

  defp validate_list(errors, field, values, kind) when is_list(values) do
    if Enum.all?(values, &valid_list_item?(&1, kind)),
      do: errors,
      else: ["#{field} contains invalid items" | errors]
  end

  defp validate_list(errors, field, _values, _kind), do: ["#{field} must be a list" | errors]

  defp valid_list_item?(value, :map), do: is_map(value)
  defp valid_list_item?(value, :id), do: is_binary(value) and value != ""

  defp validate_map(errors, _field, value) when is_map(value), do: errors
  defp validate_map(errors, field, _value), do: ["#{field} must be a map" | errors]

  defp validate_completed_at(errors, nil), do: errors
  defp validate_completed_at(errors, %DateTime{}), do: errors

  defp validate_completed_at(errors, _value),
    do: ["completed_at must be a DateTime or nil" | errors]
end
