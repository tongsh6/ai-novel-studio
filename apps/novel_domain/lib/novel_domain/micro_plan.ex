defmodule NovelDomain.MicroPlan do
  @moduledoc """
  Planner 到 Execution Orchestrator 的行动建议 envelope。
  MicroPlan 只是建议，不包含执行批准语义。

  规格见 docs/design/contracts/VS-01-execution-authority-contract-pack.md §2。
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

  @default_fallback %{downgrade_message: "这个请求范围比较大，我们先聚焦一个方向。"}

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
    fallback_strategy: @default_fallback
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

  @doc """
  从序列化形态恢复 MicroPlan（确认 re-gate ADR-0009 的载体反序列化）。

  TurnResult 携带的 plan 必须是 JSON 安全形态（broadcast/持久化都要经 Jason），
  确认时用本函数恢复为 struct 再进 Orchestrator re-gate。兼容三种来源：
  进程内 JSON 安全化后的 map（atom key/atom 枚举）、持久化恢复的 map
  （string key/string 枚举）、以及历史 in-flight 的 struct（原样透传）。
  未知枚举值落最保守分支（不可执行/不写入），不发明新值。
  """
  @spec from_map(t() | map() | nil) :: t() | nil
  def from_map(nil), do: nil
  def from_map(%__MODULE__{} = plan), do: plan

  def from_map(map) when is_map(map) do
    %__MODULE__{
      schema_version: field(map, :schema_version) || "3.0-draft",
      plan_id: field(map, :plan_id),
      turn_id: field(map, :turn_id),
      frame_ref: field(map, :frame_ref),
      primary: field(map, :primary) != false,
      plan_goal: %{summary: goal_summary(map)},
      proposed_actions:
        map |> field(:proposed_actions) |> List.wrap() |> Enum.map(&action_from_map/1),
      state_changes_requested: field(map, :state_changes_requested) || [],
      required_capabilities: field(map, :required_capabilities) || [],
      risk_hint: to_risk_hint(field(map, :risk_hint)),
      requires_confirmation_hint: field(map, :requires_confirmation_hint) == true,
      stop_after_next_action: field(map, :stop_after_next_action) != false,
      fallback_strategy: fallback_from_map(map)
    }
  end

  defp action_from_map(action) when is_map(action) do
    %{
      action_id: field(action, :action_id),
      action_type: to_action_type(field(action, :action_type)),
      summary: field(action, :summary) || "",
      target_ref: field(action, :target_ref),
      write_intent: to_write_intent(field(action, :write_intent)),
      risk_hint: to_risk_hint(field(action, :risk_hint))
    }
    |> put_optional(:authoring_intent, to_authoring_intent(field(action, :authoring_intent)))
    |> put_optional(:target_chapter, field(action, :target_chapter))
    |> put_optional(:target_word_count, field(action, :target_word_count))
  end

  defp action_from_map(_action), do: %{}

  # 取字段：先 atom key（进程内形态，含 false 等 falsy 值），再 string key（持久化形态）。
  defp field(map, key) do
    case map do
      %{^key => value} -> value
      _ -> Map.get(map, Atom.to_string(key))
    end
  end

  defp goal_summary(map) do
    case field(map, :plan_goal) do
      %{} = goal -> field(goal, :summary) || ""
      _ -> ""
    end
  end

  defp fallback_from_map(map) do
    case field(map, :fallback_strategy) do
      %{} = fs ->
        %{downgrade_message: field(fs, :downgrade_message) || @default_fallback.downgrade_message}

      _ ->
        @default_fallback
    end
  end

  defp put_optional(map, _key, nil), do: map
  defp put_optional(map, key, value), do: Map.put(map, key, value)

  defp to_risk_hint(value) when value in [:low, :medium, :high], do: value
  defp to_risk_hint("medium"), do: :medium
  defp to_risk_hint("high"), do: :high
  defp to_risk_hint(_value), do: :low

  @action_types [
    :candidate_generation,
    :tentative_artifact,
    :state_change_request,
    :clarification_request,
    :confirmation_request,
    :capability_invocation
  ]

  defp to_action_type(value) when value in @action_types, do: value

  defp to_action_type(value) when is_binary(value) do
    Enum.find(@action_types, :clarification_request, &(Atom.to_string(&1) == value))
  end

  # 未知 → clarification_request：最保守（不会被当作可执行动作放行）。
  defp to_action_type(_value), do: :clarification_request

  defp to_write_intent(value) when value in [:none, :tentative, :production_candidate], do: value
  defp to_write_intent("tentative"), do: :tentative
  defp to_write_intent("production_candidate"), do: :production_candidate
  defp to_write_intent(_value), do: :none

  defp to_authoring_intent(value) when value in [:continuation, :rewrite], do: value
  defp to_authoring_intent("continuation"), do: :continuation
  defp to_authoring_intent("rewrite"), do: :rewrite
  defp to_authoring_intent(_value), do: nil
end
