defmodule NovelDomain.ReplayReport do
  @moduledoc """
  结构化回放报告。默认不重新调用 LLM——只基于 trace 和 contract refs 解释系统决策。

  字段规格见 docs/design-v3/contracts/VS-06-replay-surface-contract-pack.md §4。
  """

  @type result_status :: :complete | :partial | :invalid_trace
  @type redaction_profile :: :author_safe | :developer_summary

  @type t :: %__MODULE__{
          replay_report_id: String.t(),
          replay_case_ref: String.t(),
          trace_ref: String.t(),
          replay_level: :structural,
          chain_summary: [map()],
          decision_explanations: [map()],
          state_explanations: [map()],
          missing_trace_refs: [String.t()],
          redaction_profile: redaction_profile(),
          provider_called: boolean(),
          result_status: result_status(),
          generated_at: String.t()
        }

  @enforce_keys [
    :replay_report_id,
    :replay_case_ref,
    :trace_ref,
    :replay_level,
    :redaction_profile,
    :provider_called,
    :result_status
  ]
  defstruct [
    :replay_report_id,
    :replay_case_ref,
    :trace_ref,
    :replay_level,
    :redaction_profile,
    :provider_called,
    :result_status,
    chain_summary: [],
    decision_explanations: [],
    state_explanations: [],
    missing_trace_refs: [],
    generated_at: nil
  ]
end
