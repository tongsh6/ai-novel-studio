defmodule NovelDomain.OrchestratorDecision do
  @moduledoc """
  Execution Orchestrator 的裁决记录。Planner 不能批准自己的 MicroPlan。

  规格见 docs/design/contracts/VS-01-execution-authority-contract-pack.md §5。
  """

  @type decision_type ::
          :downgrade_to_dialogue
          | :require_confirmation
          | :require_clarification
          | :reject
          | :fail_with_recovery
          | :allow_tool
          | :allow_agent_run
          | :reply_only
          | :exploration
          | :capability_gap
          | :replay_existing
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
          decision_trace_ref: String.t() | nil,
          gate_order_version: String.t() | nil,
          gate_results: [NovelDomain.GateResult.t()]
        }

  @enforce_keys [
    :decision_id,
    :turn_id,
    :frame_ref,
    :decision_type,
    :decision_status,
    :reason_codes
  ]
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
    decision_trace_ref: nil,
    gate_order_version: nil,
    gate_results: []
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

  # 幂等 replay 不执行新动作（复用已有 decision）；对「本轮是否可执行新动作」而言等价阻断。
  def blocks_execution?(%__MODULE__{decision_type: :replay_existing}), do: true
  def blocks_execution?(_), do: false

  @truthfulness_by_type %{
    downgrade_to_dialogue: ["no_action_executed", "downgraded_to_conversation"],
    require_confirmation: [
      "no_action_executed",
      "author_confirmation_required",
      "confirmation_not_satisfied"
    ],
    require_clarification: ["no_action_executed", "scope_or_target_missing"],
    reject: ["no_action_executed", "blocked_by_policy"],
    fail_with_recovery: ["no_action_executed", "system_recovery_needed"],
    allow_tool: ["tool_dispatched", "result_not_adoption"],
    allow_agent_run: ["agent_run_created", "internal_steps_require_regate"],
    reply_only: ["no_action_executed", "no_behavior_opened", "no_write"],
    exploration: ["no_action_executed", "no_write", "read_only_evidence_preserved"],
    capability_gap: ["no_action_executed", "no_write", "goal_unfulfilled"],
    replay_existing: ["no_action_executed", "reuse_recorded_decision"]
  }

  @doc """
  Truthfulness constraints for TurnResult Builder.
  """
  @spec truthfulness_constraints(t()) :: [String.t()]
  def truthfulness_constraints(%__MODULE__{} = decision) do
    Map.get(@truthfulness_by_type, decision.decision_type, [])
  end

  @doc "B43 CP2：只读探索回复裁决（不批准执行，探索观察仍由 observation 事实承载）。"
  @spec exploration(String.t(), String.t(), [String.t()]) :: t()
  def exploration(turn_id, frame_ref, reason_codes \\ ["exploration_no_execution"]) do
    reply_only(turn_id, frame_ref, reason_codes)
    |> Map.put(:decision_type, :exploration)
    |> update_truthfulness()
  end

  @doc "B43 CP2：能力缺口回复裁决（无执行/写入，目标未完成）。"
  @spec capability_gap(String.t(), String.t(), [String.t()]) :: t()
  def capability_gap(turn_id, frame_ref, reason_codes \\ ["capability_gap_unfulfilled"]) do
    reply_only(turn_id, frame_ref, reason_codes)
    |> Map.put(:decision_type, :capability_gap)
    |> update_truthfulness()
  end

  @doc "B43 CP2：等待作者回答的裁决；不执行、不写入，明确需要作者动作。"
  @spec require_clarification(String.t(), String.t(), map() | nil, [String.t()]) :: t()
  def require_clarification(
        turn_id,
        frame_ref,
        required_author_action \\ nil,
        reason_codes \\ ["author_question_required"]
      ) do
    reply_only(turn_id, frame_ref, reason_codes)
    |> Map.put(:decision_type, :require_clarification)
    |> Map.put(:required_author_action, required_author_action)
    |> update_truthfulness()
  end

  defp update_truthfulness(decision) do
    Map.put(decision, :turn_result_policy, %{
      truthfulness_constraints: Map.fetch!(@truthfulness_by_type, decision.decision_type)
    })
  end

  @doc """
  B43 CP2：无业务执行的普通回复统一裁决（ADR-0031 R2=A）。

  确定性构造，不调用模型、不产生 MicroPlan/批准动作/gate 通过记录；DecisionTrace
  由调用方关联（decision_trace_ref）。作者可见回复本身仍来自真实判断响应。
  """
  @spec reply_only(String.t(), String.t(), [String.t()]) :: t()
  def reply_only(turn_id, frame_ref, reason_codes \\ ["reply_only_no_execution"])
      when is_binary(turn_id) and is_binary(frame_ref) do
    %__MODULE__{
      decision_id: NovelFoundation.ID.unique("decision"),
      turn_id: turn_id,
      frame_ref: frame_ref,
      decision_type: :reply_only,
      decision_status: :decided,
      approved_actions: [],
      rejected_actions: [],
      downgraded_actions: [],
      required_author_action: nil,
      first_blocking_gate: nil,
      reason_codes: reason_codes,
      turn_result_policy: %{
        truthfulness_constraints: Map.fetch!(@truthfulness_by_type, :reply_only)
      },
      gate_results: []
    }
  end
end
