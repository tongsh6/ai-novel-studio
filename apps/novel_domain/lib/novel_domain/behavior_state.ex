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
  一次 behavior 迁移的快照：`active` + 本轮关闭/被替代的 history。

  VS-03 §4 规则 3：`superseded` 必须引用替代 behavior。同一 turn 里「旧 behavior
  被新 behavior 显式替代」不能只丢进 active——必须把旧 behavior 以 superseded 终态
  放进 history，前端/replay 才能看到替代链（8-2 显式 supersede）。
  """
  @spec snapshot(t() | nil, [t()]) :: %{active: map() | nil, history: [map()]}
  def snapshot(active, history) when is_list(history) do
    %{
      active: if(open?(active), do: summary(active), else: nil),
      history: Enum.map(history, &summary/1)
    }
  end

  @doc """
  把旧 behavior 显式标记为 `:superseded`，resolution 引用替代 behavior（VS-03 §4 规则 3）。

  `closed_at_turn_ref` 默认取替代 behavior 的 `opened_at_turn_ref`（替代发生在同一 turn）。
  """
  @spec supersede(t(), t(), keyword()) :: t()
  def supersede(%__MODULE__{} = behavior, %__MODULE__{} = replacement, opts \\ []) do
    # 已是终态的 behavior 不重复关闭：保留首个关闭事实（幂等）。
    if closed?(behavior) do
      behavior
    else
      do_supersede(behavior, replacement, opts)
    end
  end

  defp do_supersede(behavior, replacement, opts) do
    closed_turn_ref =
      Keyword.get(opts, :closed_at_turn_ref) || replacement.opened_at_turn_ref

    resolution_ref = "behavior_superseded:#{behavior.behavior_id}:#{replacement.behavior_id}"

    %{
      behavior
      | lifecycle_status: :superseded,
        closed_at_turn_ref: closed_turn_ref,
        resolution: %{
          ref: resolution_ref,
          type: "superseded",
          superseded_by: replacement.behavior_id,
          superseded_by_ref: "behavior:#{replacement.behavior_id}",
          reason_code: Keyword.get(opts, :reason_code, "new_author_blocking_behavior_opened"),
          closed_at_turn_ref: closed_turn_ref
        }
    }
  end

  @doc """
  是否是 author-blocking behavior（clarification / confirmation / recovery）。

  同一 workstream 至多一个 primary author-blocking behavior（VS-03 §4 规则 1）。
  """
  @spec author_blocking?(t()) :: boolean()
  def author_blocking?(%__MODULE__{behavior_type: type})
      when type in [:clarification, :confirmation, :recovery],
      do: true

  def author_blocking?(_), do: false

  @doc """
  从 `summary/1` / `behavior_state.active` map（JSON 往返或进程内 atom key 双形态）恢复 struct。

  用于「新 behavior 打开时读取同 workstream 上一个 primary behavior」的 supersede 决策；
  缺 behavior_id 或不可识别形态返回 nil（不伪造行为）。
  """
  @spec from_map(map() | t() | nil) :: t() | nil
  def from_map(nil), do: nil
  def from_map(%__MODULE__{} = behavior), do: behavior

  def from_map(map) when is_map(map) do
    case behavior_id(map) do
      nil ->
        nil

      behavior_id ->
        %__MODULE__{
          behavior_id: behavior_id,
          behavior_type: behavior_type_from(behavior_type_value(map)),
          lifecycle_status: lifecycle_from(lifecycle_value(map)),
          blocking_actor: blocking_actor_from(blocking_actor_value(map)),
          opened_at_turn_ref: text_field(map, :opened_at_turn_ref) || "",
          opened_by_decision_ref: text_field(map, :opened_by_decision_ref) || "",
          frame_ref: text_field(map, :frame_ref) || "",
          plan_ref: text_field(map, :plan_ref),
          target_ref: text_field(map, :target_ref),
          required_next_action: text_field(map, :required_next_action) || "",
          available_actions: list_field(map, :available_actions),
          prompt_contract: map_field(map, :prompt_contract),
          constraints: map_field(map, :constraints),
          resolution: map_field(map, :resolution),
          closed_at_turn_ref: text_field(map, :closed_at_turn_ref),
          trace_ref: text_field(map, :trace_ref)
        }
    end
  end

  def from_map(_map), do: nil

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
      blocking_actor: Atom.to_string(behavior.blocking_actor),
      opened_at_turn_ref: behavior.opened_at_turn_ref,
      opened_by_decision_ref: behavior.opened_by_decision_ref,
      frame_ref: behavior.frame_ref,
      plan_ref: behavior.plan_ref,
      required_next_action: behavior.required_next_action,
      target_ref: behavior.target_ref,
      prompt_contract: behavior.prompt_contract,
      available_actions: behavior.available_actions,
      closed_at_turn_ref: behavior.closed_at_turn_ref,
      trace_ref: behavior.trace_ref,
      resolution_ref: resolution_ref(behavior)
    }
  end

  defp behavior_id(map) do
    case field(map, :behavior_id) do
      value when is_binary(value) and value != "" -> value
      _ -> nil
    end
  end

  defp behavior_type_value(map), do: field(map, :behavior_type)
  defp lifecycle_value(map), do: field(map, :lifecycle_status) || field(map, :status)
  defp blocking_actor_value(map), do: field(map, :blocking_actor)

  defp behavior_type_from(value) when value in [:clarification, :confirmation, :recovery],
    do: value

  defp behavior_type_from(value) when is_binary(value) do
    Enum.find(
      [:clarification, :confirmation, :recovery],
      :confirmation,
      &(Atom.to_string(&1) == value)
    )
  end

  defp behavior_type_from(_value), do: :confirmation

  # summary/1 的 status 是冻结 BehaviorStatus 枚举；也兼容内部 lifecycle atom/字符串。
  defp lifecycle_from(value)
       when value in [
              :open,
              :awaiting_author,
              :resolving,
              :resolved,
              :cancelled,
              :failed,
              :superseded
            ],
       do: value

  defp lifecycle_from(value) when is_binary(value) do
    cond do
      value == BehaviorStatus.open() -> :open
      value == BehaviorStatus.waiting_user() -> :awaiting_author
      value == "RESOLVING" -> :resolving
      value == BehaviorStatus.resolved() -> :resolved
      value == BehaviorStatus.cancelled() -> :cancelled
      value == BehaviorStatus.expired() -> :failed
      true -> lifecycle_atom(value)
    end
  end

  defp lifecycle_from(_value), do: :awaiting_author

  defp lifecycle_atom(value)
       when value in [
              "open",
              "awaiting_author",
              "resolving",
              "resolved",
              "cancelled",
              "failed",
              "superseded"
            ],
       do: String.to_existing_atom(value)

  defp lifecycle_atom(_value), do: :awaiting_author

  defp blocking_actor_from(value) when value in [:author, :system, :tool, :none], do: value

  defp blocking_actor_from(value) when is_binary(value),
    do: Enum.find([:author, :system, :tool, :none], :author, &(Atom.to_string(&1) == value))

  defp blocking_actor_from(_value), do: :author

  defp text_field(map, key) do
    case field(map, key) do
      value when is_binary(value) -> value
      nil -> nil
      value when is_atom(value) -> Atom.to_string(value)
      _ -> nil
    end
  end

  defp list_field(map, key) do
    map |> field(key) |> List.wrap()
  end

  defp map_field(map, key) do
    case field(map, key) do
      %{} = value -> value
      _ -> %{}
    end
  end

  defp field(map, key) when is_map(map) do
    case map do
      %{^key => value} -> value
      _ -> Map.get(map, Atom.to_string(key))
    end
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
