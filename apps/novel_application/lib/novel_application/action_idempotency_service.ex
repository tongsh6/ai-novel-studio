defmodule NovelApplication.ActionIdempotencyService do
  @moduledoc """
  Application boundary for author action idempotency.

  It combines the pure key rules with the persistence receipt repository when
  real persistence is enabled. Callers still keep an in-process ledger for fast
  duplicate suppression inside the same Channel process.
  """

  alias NovelApplication.ActionIdempotencyLedger
  alias NovelApplication.AgentRunService
  alias NovelDomain.AuthorActionInput

  @type scope :: ActionIdempotencyLedger.scope()

  @spec lookup(AuthorActionInput.t(), scope()) ::
          {:duplicate, map()} | {:conflict, map()} | {:error, term()} | :miss
  def lookup(%AuthorActionInput{} = input, scope) do
    with true <- inject_persistence?(),
         {:ok, attrs} <- ActionIdempotencyLedger.key_attrs(input, scope) do
      case NovelPersistence.AuthorActionReceiptRepo.get(attrs) do
        nil -> :miss
        receipt -> classify_receipt(receipt, input, scope)
      end
    else
      _ -> :miss
    end
  end

  @doc """
  把已持久 receipt 投影为调用方可见回执；新记录按真实 run/child 结果读取，
  旧记录保留 payload-only 历史边界。
  """
  @spec project(struct(), AuthorActionInput.t(), scope()) ::
          {:duplicate, map()} | {:conflict, map()} | {:error, term()}
  def project(receipt, %AuthorActionInput{} = input, scope),
    do: classify_receipt(receipt, input, scope)

  defp classify_receipt(receipt, input, scope) do
    result = receipt.result || %{}

    case ActionIdempotencyLedger.admission_version(result) do
      :legacy ->
        legacy_receipt(receipt, input)

      {:supported, _version} ->
        project_admitted_receipt(receipt, input, scope)

      {:unsupported, version} ->
        {:error, {:unsupported_admission_version, version}}
    end
  end

  # 旧记录只有 payload-only 摘要：保留历史回放边界，不投影/补造运行事实。
  defp legacy_receipt(receipt, input) do
    result = receipt.result || %{}

    entry =
      receipt |> NovelPersistence.AuthorActionReceiptRepo.entry_from_record() |> sanitize_entry()

    stored_digest = result["payload_digest"] || result[:payload_digest]

    cond do
      is_nil(stored_digest) -> {:duplicate, entry}
      stored_digest == ActionIdempotencyLedger.payload_digest(input) -> {:duplicate, entry}
      true -> {:conflict, entry}
    end
  end

  defp project_admitted_receipt(receipt, input, scope) do
    stored = receipt.result || %{}
    digest = stored["semantic_digest"]

    if digest == ActionIdempotencyLedger.action_semantic_digest(input) do
      project_current_run(receipt, input, scope)
    else
      entry =
        receipt
        |> NovelPersistence.AuthorActionReceiptRepo.entry_from_record()
        |> sanitize_entry()

      {:conflict, entry}
    end
  end

  defp project_current_run(receipt, input, scope) do
    stored = receipt.result || %{}
    run_id = stored["run_id"]

    with true <- is_binary(run_id) and run_id != "",
         {:ok, run_state} <-
           AgentRunService.receipt_run_facts(run_id, scope[:work_id], scope[:session_id]),
         run = run_state.run,
         :ok <- ensure_run_scope(run, scope, input),
         :ok <- ensure_trigger_binding(run, receipt, input),
         {:ok, child} <- committed_child_facts(run, input, stored) do
      entry = NovelPersistence.AuthorActionReceiptRepo.entry_from_record(receipt)

      result =
        entry.result
        |> Map.put(:status, to_string(run.status))
        |> Map.put(:run_id, run.run_id)
        |> Map.put(:receipt_id, receipt.id)
        |> Map.put(:run_mode, to_string(run.run_mode))
        |> Map.put(:long_run_task_ref, run.long_run_task_ref)
        |> Map.put(:profile_ref, run.profile_ref)
        |> Map.put(:goal, atomize_map(run.goal))
        |> Map.put(:trigger, atomize_map(run.trigger))
        |> Map.put(:behavior_ref, receipt.behavior_ref)
        |> put_child_turn(child.turn_id)
        |> drop_private_result_keys()

      {:duplicate,
       entry
       |> Map.put(:result, result)
       |> Map.put(:run_state, run_state)
       |> Map.put(:turn_results, child.turn_results)}
    else
      nil -> {:error, :receipt_run_missing}
      false -> {:error, :receipt_run_missing}
      {:error, _reason} = error -> error
    end
  end

  defp sanitize_entry(entry), do: %{entry | result: drop_private_result_keys(entry.result)}

  defp drop_private_result_keys(result) do
    Map.drop(result, [
      :semantic_digest,
      :admission_version,
      :source_agent_run_id,
      "semantic_digest",
      "admission_version",
      "source_agent_run_id"
    ])
  end

  defp ensure_run_scope(run, scope, input) do
    if run.work_id == scope[:work_id] and run.session_id == scope[:session_id] and
         run.parent_turn_ref == input.source_turn_ref do
      :ok
    else
      {:error, :receipt_run_scope_mismatch}
    end
  end

  defp ensure_trigger_binding(run, receipt, input) do
    trigger = run.trigger || %{}

    cond do
      trigger_value(trigger, :receipt_id) != receipt.id ->
        {:error, :receipt_run_receipt_mismatch}

      trigger_value(trigger, :action_id) != input.action_id ->
        {:error, :receipt_run_action_mismatch}

      trigger_value(trigger, :action_type) != input.action_type ->
        {:error, :receipt_run_action_mismatch}

      trigger_value(trigger, :source_turn_ref) != input.source_turn_ref ->
        {:error, :receipt_run_source_mismatch}

      is_binary(receipt.behavior_ref) and
          trigger_value(trigger, :behavior_ref) != receipt.behavior_ref ->
        {:error, :receipt_run_behavior_mismatch}

      true ->
        :ok
    end
  end

  defp committed_child_facts(run, input, stored) do
    entries =
      NovelPersistence.WorkSessionRepo.assistant_entries_by_run(
        run.work_id,
        run.session_id,
        run.run_id
      )

    with {:ok, rows} <- child_turn_rows(entries, run.run_id) do
      rows = Enum.reject(rows, &(&1.turn_id == input.source_turn_ref))
      turns = rows |> Enum.map(& &1.turn_id) |> Enum.uniq()
      anchor = child_turn_anchor(stored, turns)

      results =
        rows
        |> Enum.reverse()
        |> Enum.uniq_by(& &1.turn_id)
        |> Enum.reverse()
        |> Enum.map(& &1.turn_result)

      {:ok, %{turn_id: anchor, turn_results: results}}
    end
  end

  # receipt 的 turn_id 只指向已提交的子结果；新确认 run 在受理时先提交作者决定
  # 结果，后续创作结果追加到同一 run，不能因多个子 turn 把回执判成歧义。
  defp child_turn_anchor(stored, turns) do
    stored_turn = Map.get(stored, "turn_id") || Map.get(stored, :turn_id)

    cond do
      is_binary(stored_turn) and stored_turn in turns -> stored_turn
      turns == [] -> nil
      true -> List.first(turns)
    end
  end

  defp child_turn_rows(entries, run_id) do
    Enum.reduce_while(entries, {:ok, []}, fn entry, {:ok, rows} ->
      content = Map.get(entry, :content, %{})
      turn_result = field(content, :turn_result)
      explicit_run_id = field(content, :agent_run_id)
      result_run_id = turn_result |> field(:agent_run) |> field(:run_id)
      turn_id = field(turn_result, :turn_id)

      cond do
        explicit_run_id != run_id ->
          {:halt, {:error, :receipt_child_binding_conflict}}

        is_binary(result_run_id) and result_run_id != run_id ->
          {:halt, {:error, :receipt_child_binding_conflict}}

        not is_binary(turn_id) or String.trim(turn_id) == "" ->
          {:halt, {:error, :receipt_child_turn_missing}}

        true ->
          {:cont,
           {:ok,
            [
              %{turn_id: turn_id, turn_result: author_safe_turn_result(turn_result)}
              | rows
            ]}}
      end
    end)
    |> case do
      {:ok, rows} -> {:ok, Enum.reverse(rows)}
      {:error, _reason} = error -> error
    end
  end

  @private_turn_result_keys [
    :stage_state,
    :judgment_transcript,
    :authoring_transcript,
    :execution_counts,
    "stage_state",
    "judgment_transcript",
    "authoring_transcript",
    "execution_counts"
  ]

  defp author_safe_turn_result(turn_result) when is_map(turn_result),
    do: Map.drop(turn_result, @private_turn_result_keys)

  defp author_safe_turn_result(_turn_result), do: nil

  defp put_child_turn(result, nil), do: Map.delete(result, :turn_id)
  defp put_child_turn(result, turn_id), do: Map.put(result, :turn_id, turn_id)

  defp trigger_value(map, key) when is_map(map), do: field(map, key)
  defp trigger_value(_map, _key), do: nil

  defp field(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, Atom.to_string(key))
  end

  defp field(_map, _key), do: nil

  defp atomize_map(nil), do: nil

  defp atomize_map(map) when is_map(map) do
    Map.new(map, fn
      {key, value} when is_binary(key) ->
        {existing_atom(key), atomize_map(value)}

      {key, value} ->
        {key, atomize_map(value)}
    end)
  end

  defp atomize_map(values) when is_list(values), do: Enum.map(values, &atomize_map/1)
  defp atomize_map(value), do: value

  defp existing_atom(key) do
    String.to_existing_atom(key)
  rescue
    ArgumentError -> key
  end

  @spec record(AuthorActionInput.t(), scope(), map()) :: :ok | {:error, term()}
  def record(%AuthorActionInput{} = input, scope, result) when is_map(result) do
    persisted_result =
      result
      |> Map.put(:payload_digest, ActionIdempotencyLedger.payload_digest(input))
      |> then(&NovelApplication.ApprovalAudit.enrich(input, &1))

    with true <- inject_persistence?(),
         {:ok, attrs} <- ActionIdempotencyLedger.key_attrs(input, scope),
         {:ok, _receipt} <-
           NovelPersistence.AuthorActionReceiptRepo.record(attrs, persisted_result) do
      :ok
    else
      false -> :ok
      :skip -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  defp inject_persistence? do
    Application.get_env(:novel_web, :persistence, [])
    |> Keyword.get(:inject_real_persistence, false)
  end
end
