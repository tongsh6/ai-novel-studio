defmodule NovelApplication.ApprovalAudit do
  @moduledoc """
  B58 CP2：作者动作批准审计的 additive 投影。

  `approval_record` 不新建实体；这里把既有 author_action 结果补上 32 §11.1 冻结的
  approval_policy_ref/risk_class/target_type/decision/decided_by/... 字段，随
  `author_action_receipts.result` 持久化。未知动作/未知风险不补默认值，避免伪造完整
  批准记录。
  """

  alias NovelDomain.AuthorActionInput

  @canon_actions ~w(accept adopt discard edit_then_accept modify_draft)
  @confirmation_actions ~w(confirm_before_execute confirm cancel reject_or_cancel_confirmation)

  @canon_policy "approval_policy.high_risk_canon_change"
  @confirmation_policy "approval_policy.long_run_budget_gate"

  @spec enrich(AuthorActionInput.t(), map()) :: map()
  def enrich(%AuthorActionInput{} = input, result) when is_map(result) do
    case policy_for(input.action_type) do
      nil ->
        result

      policy ->
        result
        |> put(:approval_policy_ref, policy.ref)
        |> put(:risk_class, policy.risk_class)
        |> put_target_type(result)
        |> put_decision(input.action_type, result)
        |> put_source_task_ref(result)
        |> put_base_revision(result)
    end
  end

  defp policy_for(action_type) when action_type in @canon_actions,
    do: %{ref: @canon_policy, risk_class: "HIGH"}

  defp policy_for(action_type) when action_type in @confirmation_actions,
    do: %{ref: @confirmation_policy, risk_class: "HIGH"}

  defp policy_for(_), do: nil

  defp put_target_type(acc, result) do
    case map_value(result, :artifact_type) || map_value(result, :target_type) do
      value when is_binary(value) and value != "" -> Map.put(acc, :target_type, value)
      _ -> acc
    end
  end

  defp put_decision(acc, action_type, result) do
    case decision_for(action_type, result) do
      nil ->
        acc

      decision ->
        acc
        |> Map.put(:decision, decision)
        |> Map.put(:decided_by, "author")
    end
  end

  defp put_source_task_ref(acc, result) do
    case map_value(result, :run_id) || map_value(result, :long_run_task_ref) do
      value when is_binary(value) and value != "" -> Map.put(acc, :source_task_ref, value)
      _ -> acc
    end
  end

  defp put_base_revision(acc, result) do
    case map_value(result, :base_revision) || map_value(result, :revision_base) do
      %{} = revision -> Map.put(acc, :base_revision, revision)
      value when is_binary(value) and value != "" -> Map.put(acc, :base_revision, value)
      _ -> acc
    end
  end

  defp decision_for(action_type, result) when action_type in @canon_actions do
    case status(result) do
      "accepted" when action_type in ["edit_then_accept", "modify_draft"] -> "EDITED_ACCEPTED"
      "accepted" -> "ACCEPTED"
      "discarded" -> "DISCARDED"
      "rejected" -> "REJECTED"
      "cancelled" -> "CANCELLED"
      _ -> nil
    end
  end

  defp decision_for(action_type, result) when action_type in @confirmation_actions do
    case status(result) do
      "accepted" -> "CONFIRMED"
      "confirmed" -> "CONFIRMED"
      "rejected" -> "REJECTED"
      "cancelled" -> "CANCELLED"
      _ -> nil
    end
  end

  defp status(result) do
    map_value(result, :status) || map_value(result, :action_status)
  end

  defp map_value(map, key), do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp put(acc, key, value), do: Map.put(acc, key, value)
end
