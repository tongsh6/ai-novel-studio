defmodule NovelApplication.FactInventoryProposal do
  @moduledoc """
  从既有 R5 审读 finding 投影对话流盘点提议；只追加作者动作，不启动运行或写作品事实。
  """

  require NovelCommon.LogEmit, as: LogEmit

  @rule "protagonist_undermaterialized"
  @start_label "fact_inventory.start"
  @dismiss_label "fact_inventory.dismiss"
  @proposal_labels [@start_label, @dismiss_label]

  @spec attach(map(), String.t()) :: map()
  def attach(turn_result, work_id) when is_map(turn_result) and is_binary(work_id) do
    case NovelPersistence.ReconciliationReportRepo.latest(work_id) do
      %{} = report ->
        # 两种去重语义：
        # - 已处置（作者关闭/采纳）→ 不再附加任何提议动作；
        # - 已展示过「发起设定盘点」但未处置 → 重复审读不重复发起，但原提议必须保留
        #   可关闭动作（否则页面按钮消失、作者无法关闭提议）。
        attach_to_report(turn_result, report, %{
          dispositioned?:
            NovelPersistence.ReconciliationReportRepo.finding_dispositioned?(work_id, @rule),
          shown?:
            NovelPersistence.WorkSessionRepo.available_action_present?(work_id, @start_label)
        })

      _ ->
        turn_result
    end
  rescue
    error ->
      LogEmit.emit(:ledger, :inventory_proposal, :error, %{
        work_id: work_id,
        reason_code: :inventory_proposal_read_failed,
        outcome_detail: Exception.message(error)
      })

      turn_result
  end

  @spec attach_if_adopted(map(), String.t() | nil) :: map()
  def attach_if_adopted(turn_result, work_id) when is_map(turn_result) do
    truthfulness = field(turn_result, :truthfulness) || %{}

    if field(truthfulness, :artifact_adopted) == true and is_binary(work_id),
      do: attach(turn_result, work_id),
      else: turn_result
  end

  @spec attach_to_report(map(), map(), boolean() | map()) :: map()
  def attach_to_report(turn_result, report, already_dispositioned? \\ false)

  def attach_to_report(turn_result, report, %{} = opts) do
    if Map.get(opts, :dispositioned?, false),
      do: turn_result,
      else: attach_pending_report(turn_result, report, Map.get(opts, :shown?, false))
  end

  def attach_to_report(turn_result, report, already_dispositioned?)
      when is_boolean(already_dispositioned?) do
    attach_to_report(turn_result, report, %{
      dispositioned?: already_dispositioned?,
      shown?: false
    })
  end

  defp attach_pending_report(turn_result, report, shown?) do
    with true <- field(report, :adoption_status) == "TENTATIVE",
         {finding, index} <- pending_inventory_finding(report),
         target_ref <- target_ref(field(report, :id), index),
         false <- proposal_present?(turn_result, target_ref) do
      if shown?,
        do: append_existing_proposal(turn_result, target_ref),
        else: append_proposal(turn_result, finding, target_ref)
    else
      _ -> turn_result
    end
  end

  defp append_existing_proposal(turn_result, target_ref) do
    dismiss = dismiss_action(target_ref, turn_result)

    turn_result
    |> Map.update(:available_actions, [dismiss], fn existing -> existing ++ [dismiss] end)
    |> Map.update!(:assistant_message, fn message ->
      Map.update!(
        message,
        :text,
        &(&1 <> "\n\n此前的盘点提议仍待处理，你可以继续发起设定盘点或关闭此提议。")
      )
    end)
  end

  defp append_proposal(turn_result, finding, target_ref) do
    actions = actions(target_ref, turn_result)

    turn_result
    |> Map.update(:available_actions, actions, fn existing -> existing ++ actions end)
    |> Map.update!(:assistant_message, fn message ->
      Map.update!(message, :text, &(&1 <> proposal_text(finding)))
    end)
  end

  defp proposal_text(finding) do
    "\n\n审读发现「#{field(finding, :signal)}」。你可以发起设定盘点，从已采纳正文整理角色、规则与伏笔；逐项确认后才会进入作品档案，也可以关闭此提议。"
  end

  @spec revalidate(map() | nil, String.t(), keyword()) :: map() | nil
  def revalidate(turn_result, work_id, opts \\ [])

  def revalidate(nil, _work_id, _opts), do: nil

  def revalidate(turn_result, work_id, opts) when is_map(turn_result) do
    has_proposal? =
      turn_result
      |> field(:available_actions)
      |> List.wrap()
      |> Enum.any?(&(field(&1, :label_key) in @proposal_labels))

    resolved? =
      has_proposal? and
        Keyword.get_lazy(opts, :resolved_rule?, fn ->
          NovelPersistence.ReconciliationReportRepo.finding_dispositioned?(work_id, @rule)
        end)

    if resolved? do
      update_actions(turn_result, fn actions ->
        Enum.reject(actions, &(field(&1, :label_key) in @proposal_labels))
      end)
    else
      turn_result
    end
  rescue
    _ -> turn_result
  end

  @spec author_payload(String.t(), String.t() | nil) :: map() | nil
  def author_payload("start_fact_inventory", target_ref) do
    case parse_target_ref(target_ref) do
      {:ok, report_id, index} ->
        %{
          "trigger_type" => "finding",
          "report_id" => report_id,
          "finding_index" => index,
          "finding_rule" => @rule,
          "proposal_ref" => target_ref
        }

      _ ->
        nil
    end
  end

  def author_payload("adjudicate_finding", target_ref) do
    case parse_target_ref(target_ref) do
      {:ok, report_id, index} ->
        %{
          "report_id" => report_id,
          "finding_index" => index,
          "disposition" => "dismiss",
          "proposal_ref" => target_ref
        }

      _ ->
        nil
    end
  end

  def author_payload(_action_type, _target_ref), do: nil

  @spec rebind_author_payload(String.t(), String.t(), map(), map() | nil) :: map()
  def rebind_author_payload(work_id, action_type, payload, latest_report \\ nil)

  def rebind_author_payload(
        work_id,
        action_type,
        %{"proposal_ref" => proposal_ref} = payload,
        latest
      )
      when action_type in ["start_fact_inventory", "adjudicate_finding"] and
             is_binary(proposal_ref) do
    latest = latest || NovelPersistence.ReconciliationReportRepo.latest(work_id)

    case pending_inventory_finding(latest || %{}) do
      {_finding, index} ->
        payload
        |> Map.put("report_id", field(latest, :id))
        |> Map.put("finding_index", index)

      nil ->
        payload
    end
  end

  def rebind_author_payload(_work_id, _action_type, payload, _latest), do: payload

  defp pending_inventory_finding(report) do
    report
    |> field(:findings)
    |> List.wrap()
    |> Enum.with_index()
    |> Enum.find(fn {finding, _index} ->
      field(finding, :rule) == @rule and
        field(finding, :proposed_disposition) == "revise_design" and
        field(finding, :disposition) in [nil, ""]
    end)
  end

  defp actions(target_ref, turn_result) do
    source_turn_ref = field(turn_result, :turn_id)

    [
      %{
        action_id: "start_fact_inventory:#{target_ref}",
        action_type: "start_fact_inventory",
        target_ref: target_ref,
        source_turn_ref: source_turn_ref,
        label_key: @start_label,
        enabled: true,
        idempotency_key: "idem:#{target_ref}:start_fact_inventory",
        trace_ref: "ledger_report:#{report_id(target_ref)}"
      },
      dismiss_action(target_ref, turn_result)
    ]
  end

  defp dismiss_action(target_ref, turn_result) do
    %{
      action_id: "adjudicate_finding:#{target_ref}:dismiss",
      action_type: "adjudicate_finding",
      target_ref: target_ref,
      source_turn_ref: field(turn_result, :turn_id),
      label_key: @dismiss_label,
      enabled: true,
      idempotency_key: "idem:#{target_ref}:dismiss",
      trace_ref: "ledger_report:#{report_id(target_ref)}"
    }
  end

  defp proposal_present?(turn_result, target_ref) do
    turn_result
    |> field(:available_actions)
    |> List.wrap()
    |> Enum.any?(
      &(field(&1, :label_key) in @proposal_labels and field(&1, :target_ref) == target_ref)
    )
  end

  defp update_actions(turn_result, update) do
    cond do
      Map.has_key?(turn_result, :available_actions) ->
        Map.update!(turn_result, :available_actions, &update.(&1 || []))

      Map.has_key?(turn_result, "available_actions") ->
        Map.update!(turn_result, "available_actions", &update.(&1 || []))

      true ->
        turn_result
    end
  end

  defp target_ref(report_id, index), do: "finding:#{report_id}:#{index}"

  defp parse_target_ref(target_ref) when is_binary(target_ref) do
    case Regex.run(~r/\Afinding:([^:]+):(\d+)\z/, target_ref) do
      [_, report_id, raw_index] -> {:ok, report_id, String.to_integer(raw_index)}
      _ -> :error
    end
  end

  defp parse_target_ref(_target_ref), do: :error

  defp report_id(target_ref) do
    case parse_target_ref(target_ref) do
      {:ok, report_id, _index} -> report_id
      _ -> nil
    end
  end

  defp field(map, key) when is_map(map), do: Map.get(map, key, Map.get(map, Atom.to_string(key)))
  defp field(_map, _key), do: nil
end
