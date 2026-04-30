defmodule NovelFoundation.TurnResultValidator do
  @moduledoc """
  Runtime validator for TurnResult v2 envelopes (ADR-0001 §1).

  TurnService 在出口处调用 `validate!/1`。任何不符合契约的 emit 立即 raise，
  防止字面量漂移悄悄进入下游 channel / 前端 / 持久化。

  ## 覆盖
  1. 14 个必填字段全部存在
  2. `phase` / `status` / `next_action` 在 Foundation.Enums 内
  3. `behavior_state` / `adoption_state` 形状 + 枚举
  4. `schema_version` semver
  5. `validation.errors[]` 非空时 status != DONE (ADR-0002 §7 规则 4)
  6. task context (`task_id` 存在) 时 phase 同时接受 TaskPhase 枚举
  """

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.BehaviorStatus
  alias NovelFoundation.Enums.NextAction
  alias NovelFoundation.Enums.Status
  alias NovelFoundation.Enums.TaskPhase
  alias NovelFoundation.Enums.TurnPhase
  alias NovelFoundation.PhaseNextActionCompat

  @required_fields [
    :schema_version,
    :turn_id,
    :phase,
    :status,
    :next_action,
    :assistant_message,
    :ui_cards,
    :behavior_state,
    :adoption_state,
    :projection_refs,
    :validation,
    :usage,
    :trace_ref,
    :produced_at
  ]

  defmodule ValidationError do
    @moduledoc "TurnResult 违反 ADR-0001 / ADR-0002 契约时抛出。"
    defexception [:violations, :payload]

    @impl true
    def message(%{violations: violations}) do
      "TurnResult schema violation:\n  - " <> Enum.join(violations, "\n  - ")
    end
  end

  @doc "Validate the assembled TurnResult. Returns the input on success, raises on failure."
  @spec validate!(map()) :: map()
  def validate!(turn_result) when is_map(turn_result) do
    case validate(turn_result) do
      :ok -> turn_result
      {:error, violations} -> raise ValidationError, violations: violations, payload: turn_result
    end
  end

  @doc "Non-raising variant. Returns `:ok` or `{:error, [violation]}`."
  @spec validate(map()) :: :ok | {:error, [String.t()]}
  def validate(turn_result) when is_map(turn_result) do
    violations =
      []
      |> check_required(turn_result)
      |> check_schema_version(turn_result)
      |> check_phase(turn_result)
      |> check_enum(:status, turn_result, &Status.valid?/1)
      |> check_enum(:next_action, turn_result, &NextAction.valid?/1)
      |> check_behavior_state(turn_result)
      |> check_adoption_state(turn_result)
      |> check_validation_envelope(turn_result)
      |> check_errors_status_compat(turn_result)
      |> check_phase_next_action_compat(turn_result)
      |> check_behavior_active_compat(turn_result)
      |> Enum.reverse()

    if violations == [], do: :ok, else: {:error, violations}
  end

  # ---- phase (turn + task context) ----

  defp check_phase(violations, tr) do
    phase = Map.get(tr, :phase)

    if is_binary(phase) do
      valid? = TurnPhase.valid?(phase) or (task_context?(tr) and TaskPhase.valid?(phase))

      if valid?,
        do: violations,
        else: ["phase=#{inspect(phase)} not in canonical set" | violations]
    else
      violations
    end
  end

  # ---- task context detection ----

  defp task_context?(tr) do
    case Map.get(tr, :task_id) do
      nil -> false
      id when is_binary(id) and byte_size(id) > 0 -> true
      _ -> false
    end
  end

  # ---- errors[] / warnings[] (ADR-0002 §7) ----

  defp check_validation_envelope(violations, tr) do
    case Map.get(tr, :validation) do
      nil ->
        violations

      v when is_map(v) ->
        violations
        |> check_validation_errors(v)
        |> check_validation_warnings(v)

      other ->
        ["validation must be a map, got #{inspect(other)}" | violations]
    end
  end

  defp check_validation_errors(violations, validation) do
    case Map.get(validation, :errors) do
      nil -> violations
      errs when is_list(errs) -> violations
      other -> ["validation.errors must be a list, got #{inspect(other)}" | violations]
    end
  end

  defp check_validation_warnings(violations, validation) do
    case Map.get(validation, :warnings) do
      nil -> violations
      warns when is_list(warns) -> violations
      other -> ["validation.warnings must be a list, got #{inspect(other)}" | violations]
    end
  end

  # ADR-0002 §7 rule 4: errors[] non-empty → status != DONE
  defp check_errors_status_compat(violations, tr) do
    errors = get_in(tr, [:validation, :errors])

    if is_list(errors) and errors != [] and Map.get(tr, :status) == Status.done() do
      ["errors[] non-empty but status=DONE — violates ADR-0002 §7 rule 4" | violations]
    else
      violations
    end
  end

  # ---- checks ----

  defp check_required(violations, tr) do
    Enum.reduce(@required_fields, violations, fn key, acc ->
      if Map.has_key?(tr, key),
        do: acc,
        else: ["missing required field `#{key}`" | acc]
    end)
  end

  defp check_schema_version(violations, tr) do
    case Map.get(tr, :schema_version) do
      nil ->
        violations

      v when is_binary(v) ->
        if Regex.match?(~r/^\d+\.\d+\.\d+$/, v),
          do: violations,
          else: ["schema_version `#{v}` not semver" | violations]

      v ->
        ["schema_version must be string, got #{inspect(v)}" | violations]
    end
  end

  defp check_enum(violations, key, tr, validator) do
    case Map.get(tr, key) do
      nil ->
        violations

      v ->
        if validator.(v),
          do: violations,
          else: ["#{key}=#{inspect(v)} not in canonical set" | violations]
    end
  end

  defp check_behavior_state(violations, tr) do
    case Map.get(tr, :behavior_state) do
      nil ->
        violations

      bs when is_map(bs) ->
        violations
        |> require_keys(bs, [:active, :history], "behavior_state")
        |> check_active_behavior(bs)

      other ->
        ["behavior_state must be a map, got #{inspect(other)}" | violations]
    end
  end

  defp check_active_behavior(violations, %{active: nil}), do: violations

  defp check_active_behavior(violations, %{active: active}) when is_map(active) do
    violations
    |> require_keys(active, [:behavior_type, :behavior_id, :status], "behavior_state.active")
    |> validate_active_behavior_status(active)
    |> reject_terminal_active_behavior(active)
  end

  defp check_active_behavior(violations, %{active: other}),
    do: ["behavior_state.active must be map or nil, got #{inspect(other)}" | violations]

  defp check_active_behavior(violations, _), do: violations

  defp validate_active_behavior_status(violations, %{status: nil}), do: violations

  defp validate_active_behavior_status(violations, %{status: status}) do
    if BehaviorStatus.valid?(status) do
      violations
    else
      ["behavior_state.active.status=#{inspect(status)} not in canonical set" | violations]
    end
  end

  defp reject_terminal_active_behavior(violations, %{status: status})
       when status in ["RESOLVED", "CANCELLED", "EXPIRED"] do
    [
      "behavior_state.active.status=#{status} is terminal, must move to history (ADR-0002 §8)"
      | violations
    ]
  end

  defp reject_terminal_active_behavior(violations, _active), do: violations

  defp check_adoption_state(violations, tr) do
    case Map.get(tr, :adoption_state) do
      nil ->
        violations

      as when is_map(as) ->
        violations
        |> require_keys(as, [:pending, :resolved], "adoption_state")
        |> check_artifact_entries(Map.get(as, :pending, []), "adoption_state.pending")
        |> check_artifact_entries(Map.get(as, :resolved, []), "adoption_state.resolved")

      other ->
        ["adoption_state must be a map, got #{inspect(other)}" | violations]
    end
  end

  defp check_artifact_entries(violations, entries, label) when is_list(entries) do
    entries
    |> Enum.with_index()
    |> Enum.reduce(violations, fn {entry, idx}, acc ->
      check_artifact_entry(acc, entry, "#{label}[#{idx}]")
    end)
  end

  defp check_artifact_entries(violations, other, label),
    do: ["#{label} must be a list, got #{inspect(other)}" | violations]

  defp check_artifact_entry(violations, entry, label) when is_map(entry) do
    violations
    |> require_keys(
      entry,
      [:artifact_id, :artifact_type, :adoption_status, :requires_adoption],
      label
    )
    |> validate_adoption_status(entry, label)
  end

  defp check_artifact_entry(violations, other, label),
    do: ["#{label} must be a map, got #{inspect(other)}" | violations]

  defp validate_adoption_status(violations, entry, label) do
    case Map.get(entry, :adoption_status) do
      nil ->
        violations

      status ->
        if AdoptionStatus.valid?(status) do
          violations
        else
          ["#{label}.adoption_status=#{inspect(status)} not in canonical set" | violations]
        end
    end
  end

  defp check_phase_next_action_compat(violations, tr) do
    phase = Map.get(tr, :phase)
    action = Map.get(tr, :next_action)

    if is_binary(phase) and is_binary(action) do
      case PhaseNextActionCompat.allowed?(:turn, phase, action) do
        true ->
          violations

        :not_constrained ->
          violations

        false ->
          [
            "next_action=#{inspect(action)} not allowed in turn phase=#{phase} (ADR-0002 §7)"
            | violations
          ]
      end
    else
      violations
    end
  end

  defp check_behavior_active_compat(violations, tr) do
    with %{active: active} when is_map(active) <- Map.get(tr, :behavior_state),
         action when is_binary(action) <- Map.get(tr, :next_action) do
      allowed = PhaseNextActionCompat.allowed_when_behavior_active()

      if action in allowed do
        violations
      else
        [
          "next_action=#{inspect(action)} not allowed while behavior_state.active is set (ADR-0002 §7 rule 3); allowed: #{inspect(allowed)}"
          | violations
        ]
      end
    else
      _ -> violations
    end
  end

  defp require_keys(violations, map, keys, label) do
    Enum.reduce(keys, violations, fn k, acc ->
      if Map.has_key?(map, k),
        do: acc,
        else: ["#{label}.#{k} missing" | acc]
    end)
  end
end
