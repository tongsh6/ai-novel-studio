defmodule NovelDomain.OrchestratorDecision do
  @moduledoc """
  Execution Orchestrator 的裁决记录。Planner 不能批准自己的 MicroPlan。

  规格见 docs/design-v3/contracts/VS-01-execution-authority-contract-pack.md §5。
  """

  @type decision_type :: :downgrade_to_dialogue | :require_confirmation |
                         :require_clarification | :reject | :fail_with_recovery | :allow_tool
  @type decision_status :: :decided | :failed | :emitted

  @type action_ref :: %{
    action_id: String.t(),
    action_type: atom(),
    summary: String.t()
  }

  @type t :: %__MODULE__{
    decision_id: String.t(),
    turn_id: String.t(),
    frame_ref: String.t(),
    plan_ref: String.t() | nil,
    decision_type: decision_type(),
    decision_status: decision_status(),
    approved_actions: [action_ref()],
    rejected_actions: [action_ref()],
    downgraded_actions: [action_ref()],
    required_author_action: map() | nil,
    first_blocking_gate: String.t() | nil,
    reason_codes: [String.t()],
    turn_result_policy: %{truthfulness_constraints: [String.t()]},
    decision_trace_ref: String.t()
  }

  @enforce_keys [:decision_id, :turn_id, :frame_ref, :decision_type, :decision_status, :reason_codes]
  defstruct [
    :decision_id,
    :turn_id,
    :frame_ref,
    :decision_type,
    :decision_status,
    :reason_codes,
    plan_ref: nil,
    approved_actions: [],
    rejected_actions: [],
    downgraded_actions: [],
    required_author_action: nil,
    first_blocking_gate: nil,
    turn_result_policy: %{truthfulness_constraints: []},
    decision_trace_ref: nil
  ]

  @doc """
  Whether this decision blocks execution.
  """
  @spec blocks_execution?(t()) :: boolean()
  def blocks_execution?(%__MODULE__{decision_type: :downgrade_to_dialogue}), do: true
  def blocks_execution?(%__MODULE__{decision_type: :require_confirmation}), do: true
  def blocks_execution?(%__MODULE__{decision_type: :require_clarification}), do: true
  def blocks_execution?(%__MODULE__{decision_type: :reject}), do: true
  def blocks_execution?(%__MODULE__{decision_type: :fail_with_recovery}), do: true
  def blocks_execution?(_), do: false

  @doc """
  Truthfulness constraints for TurnResult Builder.
  """
  @spec truthfulness_constraints(t()) :: [String.t()]
  def truthfulness_constraints(%__MODULE__{} = decision) do
    case decision.decision_type do
      :downgrade_to_dialogue ->
        ["no_action_executed", "downgraded_to_conversation"]

      :require_confirmation ->
        ["no_action_executed", "author_confirmation_required", "confirmation_not_satisfied"]

      :require_clarification ->
        ["no_action_executed", "scope_or_target_missing"]

      :reject ->
        ["no_action_executed", "blocked_by_policy"]

      :fail_with_recovery ->
        ["no_action_executed", "system_recovery_needed"]

      :allow_tool ->
        ["tool_dispatched", "result_not_adoption"]

      _ ->
        []
    end
  end
end
