defmodule NovelDomain.ReplayReport do
  @moduledoc """
  结构化回放报告。默认不重新调用 LLM——只基于 trace 和 contract refs 解释系统决策。
  """

  @type t :: %__MODULE__{
    replay_case_id: String.t(), trace_ref: String.t(),
    turn_id: String.t(), replay_level: :structural,
    contract_versions: map(), registry_snapshots: [map()],
    decision_explanation: map(), tool_chain: [map()],
    behavior_lifecycle: [map()], state_changes: [map()],
    provider_calls_avoided: boolean(), generated_at: String.t()
  }

  @enforce_keys [:replay_case_id, :trace_ref, :turn_id, :replay_level]
  defstruct [:replay_case_id, :trace_ref, :turn_id, :replay_level,
    contract_versions: %{}, registry_snapshots: [],
    decision_explanation: %{}, tool_chain: [],
    behavior_lifecycle: [], state_changes: [],
    provider_calls_avoided: true, generated_at: nil]
end
