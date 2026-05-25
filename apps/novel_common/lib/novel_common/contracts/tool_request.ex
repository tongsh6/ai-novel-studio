defmodule NovelCommon.Contracts.ToolRequest do
  @moduledoc """
  Tool call request approved by the execution orchestrator.

  Planner output is not authority. A request exists only after an orchestrator
  decision has approved a capability boundary.
  """

  @type t :: %__MODULE__{
          tool_request_id: String.t(),
          turn_id: String.t(),
          frame_ref: String.t(),
          plan_ref: String.t() | nil,
          decision_ref: String.t(),
          tool_name: String.t(),
          tool_version: String.t(),
          input: map(),
          read_scope_grants: [String.t()],
          write_scope_grants: [String.t()],
          idempotency_key: String.t() | nil,
          trace_policy: map(),
          created_at: DateTime.t() | nil
        }

  @enforce_keys [:tool_request_id, :turn_id, :frame_ref, :decision_ref, :tool_name, :tool_version]
  defstruct [
    :tool_request_id,
    :turn_id,
    :frame_ref,
    :decision_ref,
    :tool_name,
    :tool_version,
    plan_ref: nil,
    input: %{},
    read_scope_grants: [],
    write_scope_grants: [],
    idempotency_key: nil,
    trace_policy: %{},
    created_at: nil
  ]
end
