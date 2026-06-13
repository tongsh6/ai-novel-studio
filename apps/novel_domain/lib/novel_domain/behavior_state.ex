defmodule NovelDomain.BehaviorState do
  @moduledoc """
  Durable behavior 状态。只能由 OrchestratorDecision 打开、更新或关闭。
  不是 UI 弹窗——是跨 turn 的系统等待态。

  规格见 docs/design/contracts/VS-03-behavior-lifecycle-contract-pack.md §4。
  """

  alias NovelFoundation.Enums.BehaviorStatus

  @type behavior_type :: :clarification | :confirmation | :recovery
  @type lifecycle ::
          :open | :awaiting_author | :resolving | :resolved | :cancelled | :failed | :superseded
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

  @enforce_keys [
    :behavior_id,
    :behavior_type,
    :lifecycle_status,
    :opened_at_turn_ref,
    :opened_by_decision_ref,
    :frame_ref,
    :required_next_action
  ]
  defstruct [
    :behavior_id,
    :behavior_type,
    :lifecycle_status,
    :opened_at_turn_ref,
    :opened_by_decision_ref,
    :frame_ref,
    :required_next_action,
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

  @doc """
  schema `behavior_state` 快照 `%{active, history}`（30 §6 / ADR-0002 §8 / v3 `00b` §状态字段）。

  这是 behavior → TurnResult `behavior_state` 字段的**唯一**序列化入口；主链
  `TurnResultBuilder` 和采纳确认 `AdoptionWorkflow` 都必须经它，避免两套形状漂移。

  - open behavior（OPEN / WAITING_USER）→ 进 `active`；
  - 已关闭 behavior（终态）→ 进 `history`，`active` 为 nil；
  - `nil`（本 turn 无 behavior 变化）→ `%{active: nil, history: []}`。
  """
  @spec snapshot(t() | nil) :: %{active: map() | nil, history: [map()]}
  def snapshot(nil), do: %{active: nil, history: []}

  def snapshot(%__MODULE__{} = behavior) do
    if open?(behavior),
      do: %{active: summary(behavior), history: []},
      else: %{active: nil, history: [summary(behavior)]}
  end

  @doc """
  behavior 摘要，即 schema `behavior_state.active` / `history[]` item 形状。

  `status` 是冻结的 `BehaviorStatus` 枚举（非内部 `lifecycle_status`）；`behavior_type`
  为字符串。其余 UI 元数据（prompt_contract / available_actions 等）以 additional
  property 形式保留，供前端展示。
  """
  @spec summary(t()) :: map()
  def summary(%__MODULE__{} = behavior) do
    %{
      behavior_id: behavior.behavior_id,
      behavior_type: Atom.to_string(behavior.behavior_type),
      status: status_enum(behavior.lifecycle_status),
      required_next_action: behavior.required_next_action,
      target_ref: behavior.target_ref,
      prompt_contract: behavior.prompt_contract,
      available_actions: behavior.available_actions,
      resolution_ref: resolution_ref(behavior)
    }
  end

  # 内部 lifecycle → 冻结 BehaviorStatus 枚举。active 只能 OPEN / WAITING_USER，
  # 终态进 history。枚举只有 OPEN/WAITING_USER/RESOLVED/CANCELLED/EXPIRED：域 lifecycle
  # 的 :failed / :superseded 无专属枚举值，映射到语义最近的终态（见 behavior_status.json）。
  defp status_enum(:open), do: BehaviorStatus.open()
  defp status_enum(:awaiting_author), do: BehaviorStatus.waiting_user()
  defp status_enum(:resolving), do: BehaviorStatus.open()
  defp status_enum(:resolved), do: BehaviorStatus.resolved()
  defp status_enum(:cancelled), do: BehaviorStatus.cancelled()
  defp status_enum(:superseded), do: BehaviorStatus.cancelled()
  defp status_enum(:failed), do: BehaviorStatus.expired()

  defp resolution_ref(%__MODULE__{resolution: resolution}) when is_map(resolution),
    do: Map.get(resolution, :ref) || Map.get(resolution, "ref")

  defp resolution_ref(_behavior), do: nil
end
