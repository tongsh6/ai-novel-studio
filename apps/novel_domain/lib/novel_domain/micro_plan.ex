defmodule NovelDomain.MicroPlan do
  @moduledoc """
  Planner 到 Execution Orchestrator 的行动建议 envelope。
  MicroPlan 只是建议，不包含执行批准语义。

  规格见 docs/design-v3/contracts/VS-01-execution-authority-contract-pack.md §2。
  """

  @type action_type ::
          :candidate_generation
          | :tentative_artifact
          | :state_change_request
          | :clarification_request
          | :confirmation_request
          | :capability_invocation
  @type write_intent :: :none | :tentative | :production_candidate
  @type risk_hint :: :low | :medium | :high
  # 生成意图 provenance（续写/重写 + 目标章），由 Planner 识别填充，经 ArtifactAssembler
  # 流到 artifact provenance → 采纳分流。VS-01 §2 之上的可选扩展，默认不填（非续写/重写）。
  @type authoring_intent :: :continuation | :rewrite | nil

  @type proposed_action :: %{
          required(:action_id) => String.t(),
          required(:action_type) => action_type(),
          required(:summary) => String.t(),
          required(:target_ref) => String.t() | nil,
          required(:write_intent) => write_intent(),
          required(:risk_hint) => risk_hint(),
          optional(:authoring_intent) => authoring_intent(),
          optional(:target_chapter) => String.t() | nil,
          optional(:target_word_count) => pos_integer() | nil
        }

  @type state_change :: %{
          target: String.t(),
          change: String.t(),
          write_intent: write_intent()
        }

  @type t :: %__MODULE__{
          schema_version: String.t(),
          plan_id: String.t(),
          turn_id: String.t(),
          frame_ref: String.t(),
          primary: boolean(),
          plan_goal: %{summary: String.t()},
          proposed_actions: [proposed_action()],
          state_changes_requested: [state_change()],
          required_capabilities: [String.t()],
          risk_hint: risk_hint(),
          requires_confirmation_hint: boolean(),
          stop_after_next_action: boolean(),
          fallback_strategy: %{downgrade_message: String.t()}
        }

  @enforce_keys [:plan_id, :turn_id, :frame_ref, :plan_goal, :risk_hint]
  defstruct [
    :plan_id,
    :turn_id,
    :frame_ref,
    :plan_goal,
    :risk_hint,
    schema_version: "3.0-draft",
    primary: true,
    proposed_actions: [],
    state_changes_requested: [],
    required_capabilities: [],
    requires_confirmation_hint: false,
    stop_after_next_action: true,
    fallback_strategy: %{downgrade_message: "这个请求范围比较大，我们先聚焦一个方向。"}
  ]

  @forbidden_semantics [
    "approved",
    "ready_to_execute",
    "execution_approved",
    "tool_dispatched",
    "production_write_allowed",
    "adopted",
    "behavior_opened",
    "behavior_closed",
    "confirmation_satisfied",
    "gate_passed",
    "budget_approved",
    "authority_granted"
  ]

  @doc """
  Check for forbidden planner semantics in the plan.
  Returns :ok or {:error, [forbidden_terms_found]}.
  """
  @spec check_forbidden(t()) :: :ok | {:error, [String.t()]}
  def check_forbidden(%__MODULE__{} = plan) do
    # Serialize the plan to a string for forbidden term scanning
    text = inspect_plan(plan)

    forbidden =
      Enum.filter(@forbidden_semantics, fn term ->
        String.contains?(String.downcase(text), term)
      end)

    case forbidden do
      [] -> :ok
      terms -> {:error, terms}
    end
  end

  defp inspect_plan(plan) do
    "#{inspect(plan.plan_goal)} #{inspect(plan.proposed_actions)} #{inspect(plan.state_changes_requested)}"
  end

  @doc """
  Count actions with production_candidate write intent.
  """
  @spec production_candidate_count(t()) :: non_neg_integer()
  def production_candidate_count(%__MODULE__{} = plan) do
    Enum.count(plan.proposed_actions, &(&1[:write_intent] == :production_candidate))
  end

  @doc """
  Whether the plan has more than one action (multi-step).
  """
  @spec multi_step?(t()) :: boolean()
  def multi_step?(%__MODULE__{} = plan) do
    length(plan.proposed_actions) > 1
  end

  @doc """
  Whether the plan has high risk.
  """
  @spec high_risk?(t()) :: boolean()
  def high_risk?(%__MODULE__{} = plan) do
    plan.risk_hint == :high
  end
end
