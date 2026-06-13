defmodule NovelDomain.ToolResult do
  @moduledoc """
  工具返回的结构化事实。不是作者消息，不是生产写入。
  status=succeeded 不代表 production state 已写入。

  规格见 docs/design/contracts/VS-02-tool-provenance-contract-pack.md §4。
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
          completed_at: DateTime.t()
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
