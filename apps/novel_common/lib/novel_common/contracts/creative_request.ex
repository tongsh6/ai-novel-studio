defmodule NovelCommon.Contracts.CreativeRequest do
  @moduledoc """
  Provider-facing creative generation request.

  This envelope carries creative brief and context only. It does not carry UI
  card text, adoption semantics, or authoritative artifact type chosen by the
  planner.
  """

  @type t :: %__MODULE__{
          request_id: String.t(),
          tool_name: String.t(),
          artifact_type: atom(),
          creative_brief: String.t(),
          context_text: String.t(),
          source_turn_ref: String.t(),
          decision_packet: map() | nil,
          execution_brief: String.t() | nil,
          progress_state: String.t() | nil,
          revision: String.t() | nil,
          provider_hints: map()
        }

  @enforce_keys [:request_id, :tool_name, :artifact_type, :creative_brief, :source_turn_ref]
  defstruct [
    :request_id,
    :tool_name,
    :artifact_type,
    :creative_brief,
    :source_turn_ref,
    context_text: "",
    # VS-00E：execution_brief 为已渲染的场级执行简述文本（进 provider message），
    # decision_packet 为决策包摘要（trace 用）。默认 nil，向后兼容现有 provider /
    # stub / slice_verify 与「用户创作简述：/上下文：/重要：」三锚点解析。
    decision_packet: nil,
    execution_brief: nil,
    # VS-00F CP1（ADR-0026）：progress_state 为账面投影文本（progress_state_packet
    # 的传输载体，VS-00C §3.0 既有槽），仅 prose_writing 路径非空。默认 nil 不变。
    progress_state: nil,
    # VS-00E CP3：revision 为已渲染的“按质量发现重写”要求文本（进 provider message），
    # 追加在三锚点之后，仅 revise_from_findings 路径非空。默认 nil 时 prose prompt 不变。
    revision: nil,
    provider_hints: %{}
  ]
end
