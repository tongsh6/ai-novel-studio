defmodule NovelDomain.BehaviorState do
  @moduledoc """
  Durable behavior 状态。只能由 OrchestratorDecision 打开、更新或关闭。
  不是 UI 弹窗——是跨 turn 的系统等待态。

  规格见 docs/design/contracts/VS-03-behavior-lifecycle-contract-pack.md §4。
  """

  alias NovelFoundation.Enums.BehaviorStatus

  @type behavior_type :: :confirmation | :recovery
  @lifecycles [:open, :awaiting_author, :resolving, :resolved, :cancelled, :failed, :superseded]
  @lifecycle_by_string Map.new(@lifecycles, &{Atom.to_string(&1), &1})
  @type lifecycle ::
          :open | :awaiting_author | :resolving | :resolved | :cancelled | :failed | :superseded
  @type blocking_actor :: :author | :system | :tool | :none
  @type snapshot_read :: :absent | {:ok, t() | nil}

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
  是否是 author-blocking behavior（confirmation / recovery）。

  同一 workstream 至多一个 primary author-blocking behavior（VS-03 §4 规则 1）。
  """
  @spec author_blocking?(t()) :: boolean()
  def author_blocking?(%__MODULE__{behavior_type: type})
      when type in [:confirmation, :recovery],
      do: true

  def author_blocking?(_), do: false

  @doc """
  从 `summary/1` / `behavior_state.active` map（JSON 往返或进程内 atom key 双形态）恢复 struct。

  存在精确 `lifecycle_status` 时必须属于七类域生命周期，且与同时给出的兼容 `status`
  映射一致；显式 nil、非法值、atom/string 双键冲突或新旧状态冲突都返回 nil，不回退
  到 `status`、也不默认成 `awaiting_author`。缺少精确字段的旧快照按可识别的兼容
  `status` 恢复；旧快照只有 `resolution_ref` 时只保留该引用，不补造 resolution 细节。

  用于「新 behavior 打开时读取同 workstream 上一个 primary behavior」的 supersede 决策；
  缺 behavior_id 或不可识别形态返回 nil（不伪造行为）。
  """
  @spec from_map(map() | t() | nil) :: t() | nil
  def from_map(nil), do: nil
  def from_map(%__MODULE__{} = behavior), do: behavior

  def from_map(map) when is_map(map) do
    with {:ok, behavior_id} <- boundary_behavior_id(map),
         {:ok, lifecycle_status} <- boundary_lifecycle_status(map),
         {:ok, constraints} <- boundary_constraints(map),
         {:ok, resolution} <- boundary_resolution(map) do
      %__MODULE__{
        behavior_id: behavior_id,
        behavior_type: behavior_type_from(behavior_type_value(map)),
        lifecycle_status: lifecycle_status,
        blocking_actor: blocking_actor_from(blocking_actor_value(map)),
        opened_at_turn_ref: text_field(map, :opened_at_turn_ref) || "",
        opened_by_decision_ref: text_field(map, :opened_by_decision_ref) || "",
        frame_ref: text_field(map, :frame_ref) || "",
        plan_ref: text_field(map, :plan_ref),
        target_ref: text_field(map, :target_ref),
        required_next_action: text_field(map, :required_next_action) || "",
        available_actions: list_field(map, :available_actions),
        prompt_contract: map_field(map, :prompt_contract),
        constraints: constraints,
        resolution: resolution,
        closed_at_turn_ref: text_field(map, :closed_at_turn_ref),
        trace_ref: text_field(map, :trace_ref)
      }
    else
      _ -> nil
    end
  end

  def from_map(_map), do: nil

  @doc """
  读取一个 TurnResult 中**明确携带**的行为快照（VS-00L §16.13）。

  返回三态，调用方不得把 `:absent` 与 `{:ok, nil}` 混为一谈：

  - `:absent`：本 turn 根本没有 `behavior_state` 字段，当前行为保持上一条明确快照；
  - `{:ok, nil}`：明确 `active: nil`，当前没有开放行为，不向前回退；
  - `{:ok, %__MODULE__{}}`：真实 producer 写入的开放活动行为。

  `active` map 统一走 `from_map/1` 的 §16.11 codec，本函数不另写一套解析。
  """
  @spec read_snapshot(term()) :: snapshot_read()
  def read_snapshot(turn_result) when is_map(turn_result) do
    case field(turn_result, :behavior_state) do
      %{} = snapshot -> read_snapshot_active(snapshot)
      _ -> :absent
    end
  end

  def read_snapshot(_turn_result), do: :absent

  @doc """
  按既有 transcript 顺序（旧→新）读取最后一处明确携带的行为快照。

  普通回复缺少 `behavior_state` 时保留上一条明确快照；明确 `active: nil` 清空。
  输入空列表返回 `:absent`。
  """
  @spec latest_snapshot([map()]) :: snapshot_read()
  def latest_snapshot(turn_results) when is_list(turn_results) do
    Enum.reduce(turn_results, :absent, fn turn_result, last_explicit ->
      case read_snapshot(turn_result) do
        :absent -> last_explicit
        explicit -> explicit
      end
    end)
  end

  def latest_snapshot(_turn_results), do: :absent

  defp read_snapshot_active(snapshot) do
    case field(snapshot, :active) do
      nil -> {:ok, nil}
      %{} = active -> {:ok, from_map(active)}
      _ -> :absent
    end
  end

  # 边界只解析一次：atom/string 双键同值接受，异值视为冲突而不是任选一个。
  # 仅用 trim 判定身份是否全空白；合法身份返回原始字节，不裁剪。
  defp boundary_behavior_id(map) do
    case fetch_field(map, :behavior_id) do
      {:ok, value} when is_binary(value) and value != "" ->
        if String.trim(value) == "", do: :error, else: {:ok, value}

      _ ->
        :error
    end
  end

  defp boundary_lifecycle_status(map) do
    case fetch_field(map, :lifecycle_status) do
      :absent ->
        map |> fetch_field(:status) |> legacy_lifecycle_status()

      {:ok, value} ->
        with {:ok, lifecycle} <- exact_lifecycle_status(value),
             :ok <- compatible_status(map, lifecycle) do
          {:ok, lifecycle}
        end

      :conflict ->
        :error
    end
  end

  defp exact_lifecycle_status(value) when value in @lifecycles, do: {:ok, value}

  defp exact_lifecycle_status(value) when is_binary(value),
    do: Map.fetch(@lifecycle_by_string, value)

  defp exact_lifecycle_status(_value), do: :error

  # 精确 lifecycle 存在时，若同时给出兼容 status，必须映射到同一域事实。
  defp compatible_status(map, lifecycle) do
    case fetch_field(map, :status) do
      :absent ->
        :ok

      {:ok, status} ->
        if BehaviorStatus.valid?(status) and status == status_enum(lifecycle),
          do: :ok,
          else: :error

      :conflict ->
        :error
    end
  end

  defp legacy_lifecycle_status({:ok, value}) when value in @lifecycles, do: {:ok, value}

  defp legacy_lifecycle_status({:ok, value}) when is_binary(value) do
    cond do
      value == BehaviorStatus.open() -> {:ok, :open}
      value == BehaviorStatus.waiting_user() -> {:ok, :awaiting_author}
      value == "RESOLVING" -> {:ok, :resolving}
      value == BehaviorStatus.resolved() -> {:ok, :resolved}
      value == BehaviorStatus.cancelled() -> {:ok, :cancelled}
      value == BehaviorStatus.expired() -> {:ok, :failed}
      true -> :error
    end
  end

  defp legacy_lifecycle_status(_field), do: :error

  defp boundary_constraints(map) do
    case fetch_field(map, :constraints) do
      :absent -> {:ok, %{}}
      {:ok, %{} = constraints} -> {:ok, constraints}
      _ -> :error
    end
  end

  defp boundary_resolution(map) do
    case fetch_field(map, :resolution) do
      :absent -> legacy_resolution(map)
      {:ok, nil} -> nil_resolution(map)
      {:ok, %{} = resolution} -> map_resolution(map, resolution)
      _ -> :error
    end
  end

  defp nil_resolution(map) do
    case reference_presence(map, :resolution_ref) do
      presence when presence in [:absent, :null] -> {:ok, nil}
      _ -> :error
    end
  end

  defp map_resolution(map, resolution) do
    case consistent_resolution_ref(
           reference_presence(resolution, :ref),
           reference_presence(map, :resolution_ref)
         ) do
      :ok -> {:ok, resolution}
      :error -> :error
    end
  end

  # 引用存在性三态在解码边界只解析一次：absent / 显式 null / 值。
  # atom/string 双键冲突或非法类型归入 :invalid，不任选、不补造。
  defp reference_presence(map, key) do
    case fetch_field(map, key) do
      :absent -> :absent
      {:ok, nil} -> :null
      {:ok, ref} when is_binary(ref) and ref != "" -> {:value, ref}
      _ -> :invalid
    end
  end

  # 内层 ref 无值时，外层也只能缺省或显式 nil；内层有值时，外层缺省可接受，
  # 显式 nil 是矛盾，同值接受、异值拒绝。比较只用原字节，不 trim。
  defp consistent_resolution_ref(nested_ref, compat_ref)
       when nested_ref in [:absent, :null] and compat_ref in [:absent, :null],
       do: :ok

  defp consistent_resolution_ref({:value, _ref}, :absent), do: :ok
  defp consistent_resolution_ref({:value, ref}, {:value, ref}), do: :ok
  defp consistent_resolution_ref(_nested_ref, _compat_ref), do: :error

  # 旧快照只有 resolution_ref：只保留原引用，不补造 type/status/id 等丢失字段。
  defp legacy_resolution(map) do
    case reference_presence(map, :resolution_ref) do
      :absent -> {:ok, nil}
      :null -> {:ok, nil}
      {:value, ref} -> {:ok, %{ref: ref}}
      :invalid -> :error
    end
  end

  @doc """
  behavior 摘要，即 schema `behavior_state.active` / `history[]` item 形状。

  `status` 是冻结的 `BehaviorStatus` 枚举（非内部 `lifecycle_status`）；`behavior_type`
  为字符串。兼容 `status` 之外同时保留精确 `lifecycle_status`、`constraints` 与
  `resolution`（nil 原样保留），供 JSON 往返恢复而不折叠域事实。其余 UI 元数据
  （prompt_contract / available_actions 等）以 additional property 形式保留，供前端展示。
  """
  @spec summary(t()) :: map()
  def summary(%__MODULE__{} = behavior) do
    %{
      behavior_id: behavior.behavior_id,
      behavior_type: Atom.to_string(behavior.behavior_type),
      status: status_enum(behavior.lifecycle_status),
      lifecycle_status: Atom.to_string(behavior.lifecycle_status),
      blocking_actor: Atom.to_string(behavior.blocking_actor),
      opened_at_turn_ref: behavior.opened_at_turn_ref,
      opened_by_decision_ref: behavior.opened_by_decision_ref,
      frame_ref: behavior.frame_ref,
      plan_ref: behavior.plan_ref,
      required_next_action: behavior.required_next_action,
      target_ref: behavior.target_ref,
      prompt_contract: behavior.prompt_contract,
      available_actions: behavior.available_actions,
      constraints: behavior.constraints,
      resolution: behavior.resolution,
      closed_at_turn_ref: behavior.closed_at_turn_ref,
      trace_ref: behavior.trace_ref,
      resolution_ref: resolution_ref(behavior)
    }
  end

  defp behavior_type_value(map), do: field(map, :behavior_type)
  defp blocking_actor_value(map), do: field(map, :blocking_actor)

  defp behavior_type_from(value) when value in [:confirmation, :recovery], do: value

  defp behavior_type_from(value) when is_binary(value) do
    Enum.find([:confirmation, :recovery], :confirmation, &(Atom.to_string(&1) == value))
  end

  defp behavior_type_from(_value), do: :confirmation

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

  defp fetch_field(map, key) when is_map(map) do
    case {Map.fetch(map, key), Map.fetch(map, Atom.to_string(key))} do
      {{:ok, value}, :error} -> {:ok, value}
      {:error, {:ok, value}} -> {:ok, value}
      {{:ok, atom_value}, {:ok, string_value}} -> same_boundary_value(atom_value, string_value)
      {:error, :error} -> :absent
    end
  end

  defp same_boundary_value(atom_value, string_value)
       when is_atom(atom_value) and is_binary(string_value) do
    if Atom.to_string(atom_value) == string_value,
      do: {:ok, atom_value},
      else: :conflict
  end

  defp same_boundary_value(value, value), do: {:ok, value}
  defp same_boundary_value(_atom_value, _string_value), do: :conflict

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
