defmodule NovelDomain.ToolRequest do
  @moduledoc """
  Execution Orchestrator 批准后形成的工具调用请求。
  没有 decision_ref 的 ToolRequest 不能存在——这是 Planner 不能直接调工具的硬约束。

  规格见 docs/design/contracts/VS-02-tool-provenance-contract-pack.md §3。
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
          idempotency_key: String.t(),
          trace_policy: map(),
          created_at: DateTime.t()
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
