defmodule NovelDomain.BehaviorState do
  @moduledoc """
  Durable behavior 状态。只能由 OrchestratorDecision 打开、更新或关闭。
  不是 UI 弹窗——是跨 turn 的系统等待态。

  规格见 docs/design-v3/contracts/VS-03-behavior-lifecycle-contract-pack.md §4。
  """

  @type behavior_type :: :clarification | :confirmation | :recovery
  @type lifecycle :: :open | :awaiting_author | :resolving | :resolved |
                     :cancelled | :failed | :superseded
  @type blocking_actor :: :author | :system | :tool | :none

  @type t :: %__MODULE__{
    behavior_id: String.t(),
    behavior_type: behavior_type(),
    lifecycle_status: lifecycle(),
    blocking_actor: blocking_actor(),
    opened_at_turn_ref: String.t(),
    opened_by_decision_ref: String.t(),
    frame_ref: String.t(),
    plan_ref: String.t() | nil,
    target_ref: String.t() | nil,
    required_next_action: String.t(),
    available_actions: [map()],
    prompt_contract: map(),
    constraints: map(),
    resolution: map() | nil,
    closed_at_turn_ref: String.t() | nil,
    trace_ref: String.t() | nil
  }

  @enforce_keys [:behavior_id, :behavior_type, :lifecycle_status, :opened_at_turn_ref,
                 :opened_by_decision_ref, :frame_ref, :required_next_action]
  defstruct [
    :behavior_id, :behavior_type, :lifecycle_status, :opened_at_turn_ref,
    :opened_by_decision_ref, :frame_ref, :required_next_action,
    blocking_actor: :author,
    plan_ref: nil,
    target_ref: nil,
    available_actions: [],
    prompt_contract: %{},
    constraints: %{},
    resolution: nil,
    closed_at_turn_ref: nil,
    trace_ref: nil
  ]

  @doc "Whether this behavior is open (awaiting author input)."
  @spec open?(t()) :: boolean()
  def open?(%__MODULE__{lifecycle_status: :open}), do: true
  def open?(%__MODULE__{lifecycle_status: :awaiting_author}), do: true
  def open?(_), do: false

  @doc "Whether this behavior is closed."
  @spec closed?(t()) :: boolean()
  def closed?(%__MODULE__{lifecycle_status: :resolved}), do: true
  def closed?(%__MODULE__{lifecycle_status: :cancelled}), do: true
  def closed?(%__MODULE__{lifecycle_status: :failed}), do: true
  def closed?(%__MODULE__{lifecycle_status: :superseded}), do: true
  def closed?(_), do: false
end
