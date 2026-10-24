defmodule NovelPersistence.AuthorQuestionRepo do
  @moduledoc "B26：复用 Interaction/AgentEvent/Receipt 的问题交付和答复事务。"
  import Ecto.Query
  alias NovelPersistence.{AgentRunLog, AuthorActionReceiptRepo, InteractionLifecycle, Repo}
  alias NovelPersistence.Schemas.{AgentEventRecord, Interaction, WorkSession}

  def results(work, session) do
    from(i in Interaction,
      where: i.workspace_id == ^work and i.session_id == ^session and i.role == "assistant",
      where:
        fragment(
          "json_extract(?, '$.turn_result.author_question.question_ref') IS NOT NULL",
          i.content
        ),
      order_by: [asc: i.inserted_at, asc: i.id]
    )
    |> Repo.all()
    |> Enum.map(& &1.content["turn_result"])
  end

  def source(work, session, turn) do
    from(i in Interaction,
      where:
        i.workspace_id == ^work and i.session_id == ^session and i.turn_id == ^turn and
          i.role == "assistant",
      order_by: [desc: i.updated_at],
      limit: 1
    )
    |> Repo.one()
  end

  def publish(attrs) do
    Repo.transaction(fn ->
      result = attrs.turn_result
      turn = result["turn_id"]

      case source(attrs.workspace_id, attrs.session_id, turn) do
        nil ->
          close_previous(attrs, result["author_question"]["question_ref"])
          unwrap(InteractionLifecycle.call(:result, attrs))
          unwrap(AgentRunLog.upsert_run(attrs.run_record))
          persist_events(attrs.events)
          persist_checkpoint(attrs[:checkpoint])
          persist_trace(attrs[:decision_trace])
          %{turn_result: result, duplicate: false}

        existing ->
          %{turn_result: existing.content["turn_result"], duplicate: true}
      end
    end)
  end

  def receipt(key, digest) do
    case AuthorActionReceiptRepo.get(key) do
      nil ->
        :new

      receipt ->
        if receipt.result["payload_digest"] == digest,
          do: {:ok, receipt.result},
          else: {:error, :submission_conflict}
    end
  end

  def answer(attrs) do
    Repo.transaction(fn ->
      require_active_session(attrs)

      case receipt(attrs.receipt_key, attrs.payload_digest) do
        {:ok, result} -> Map.put(result, "duplicate", true)
        {:error, reason} -> Repo.rollback(reason)
        :new -> commit_answer(attrs)
      end
    end)
    |> case do
      {:error, :input_identity_conflict} -> {:error, :submission_conflict}
      result -> result
    end
  end

  defp commit_answer(attrs) do
    row = source(attrs.workspace_id, attrs.session_id, attrs.source_turn_ref)
    q = row && get_in(row.content, ["turn_result", "author_question"])

    unless q && q["question_ref"] == attrs.question_ref && q["status"] == "open" &&
             q["goal_version"] == attrs.expected_goal_version && q["run_id"] == attrs.run_id,
           do: Repo.rollback(:stale_author_question)

    # 同一 submission 的原文也在事务内验证，不能用新回执键绕过身份冲突。
    unwrap(InteractionLifecycle.call(:receive, attrs.input))

    answered =
      Map.merge(q, %{
        "status" => "answered",
        "close_reason" => "answered",
        "submission_id" => attrs.submission_id
      })

    content = put_in(row.content, ["turn_result", "author_question"], answered)
    row |> Interaction.changeset(%{content: content}) |> Repo.update() |> unwrap()
    unwrap(AgentRunLog.upsert_run(attrs.run_record))
    persist_events(attrs.events)
    persist_checkpoint(attrs[:checkpoint])
    persist_trace(attrs[:decision_trace])
    receipt = unwrap(AuthorActionReceiptRepo.record(attrs.receipt_key, attrs.result))
    Map.put(receipt.result, "duplicate", false)
  end

  defp close_previous(attrs, current) do
    results(attrs.workspace_id, attrs.session_id)
    |> Enum.filter(fn tr ->
      q = tr["author_question"]
      q["run_id"] == attrs.run_id and q["status"] == "open" and q["question_ref"] != current
    end)
    |> Enum.each(fn tr ->
      row = source(attrs.workspace_id, attrs.session_id, tr["turn_id"])

      q =
        Map.merge(tr["author_question"], %{"status" => "closed", "close_reason" => "superseded"})

      row
      |> Interaction.changeset(%{
        content: put_in(row.content, ["turn_result", "author_question"], q)
      })
      |> Repo.update()
      |> unwrap()
    end)
  end

  defp persist_events(events) do
    Enum.each(events, fn attrs ->
      %AgentEventRecord{}
      |> AgentEventRecord.changeset(attrs)
      |> Repo.insert(on_conflict: :nothing)
      |> unwrap()
    end)
  end

  defp persist_checkpoint(nil), do: :ok

  defp persist_checkpoint(%{task_ref: ref, attrs: attrs}) do
    case NovelPersistence.LongRunTaskLog.get(ref) do
      nil -> Repo.rollback(:checkpoint_task_missing)
      task -> NovelPersistence.LongRunTaskLog.update(task, attrs) |> unwrap()
    end
  end

  defp persist_trace(nil), do: :ok

  defp persist_trace(attrs) do
    unless NovelPersistence.TraceRepository.get_by_trace_id(attrs.trace_id),
      do: NovelPersistence.TraceRepository.insert(attrs) |> unwrap()
  end

  defp require_active_session(attrs) do
    unless Repo.get_by(WorkSession,
             id: attrs.session_id,
             work_id: attrs.workspace_id,
             status: "ACTIVE"
           ),
           do: Repo.rollback(:active_session_required)
  end

  defp unwrap({:ok, result}), do: result
  defp unwrap({:error, reason}), do: Repo.rollback(reason)
end
