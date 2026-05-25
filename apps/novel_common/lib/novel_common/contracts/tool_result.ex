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
end
