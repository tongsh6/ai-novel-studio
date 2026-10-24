defmodule NovelPersistence.InteractionLifecycle do
  @moduledoc """
  ADR-0027：在现有 Interaction 上保存消息处置与运行结果。
  接收身份和结果身份稳定，原文与运行状态分开；不新增义务或作品事实。
  """

  import Ecto.Query

  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Interaction, WorkSession}
  alias NovelPersistence.TraceRepository
  alias NovelPersistence.WorkSessionRepo

  @history_limit 80
  @author_limit 10

  def call(:question_delivery, attrs), do: NovelPersistence.AuthorQuestionRepo.publish(attrs)
  def call(:question_answer, attrs), do: NovelPersistence.AuthorQuestionRepo.answer(attrs)

  def call(:receive, attrs) do
    Repo.transaction(fn -> receive_input(attrs) end)
  end

  def call(:result, attrs) do
    Repo.transaction(fn ->
      {result, reused?} =
        NovelPersistence.AuthorContentRegistration.resolve(%{
          attrs
          | turn_result: jsonable(attrs.turn_result)
        })

      turn_ref = value(result, :turn_id)

      content = %{
        text: value(value(result, :assistant_message) || %{}, :text) || "",
        turn_result: result,
        agent_run_id: attrs.run_id
      }

      entry = entry(attrs, turn_ref, "assistant", content)

      entry
      |> changeset()
      |> Repo.insert(
        on_conflict: {:replace, [:content, :updated_at]},
        conflict_target: [:id]
      )
      |> unwrap!()

      update_inputs(attrs, turn_ref)
      persist_decision_trace(attrs[:decision_trace])
      if reused?, do: %{turn_result: result}, else: :recorded
    end)
  end

  def call(:status, attrs) do
    Repo.transaction(fn ->
      update_inputs(attrs, nil)
      :recorded
    end)
  end

  defp persist_decision_trace(nil), do: :ok

  defp persist_decision_trace(attrs) do
    case TraceRepository.get_by_trace_id(attrs.trace_id) do
      nil ->
        TraceRepository.insert(attrs) |> unwrap!()

      existing ->
        unless existing.workspace_id == attrs.workspace_id and
                 existing.session_id == attrs.session_id and existing.turn_id == attrs.turn_id,
               do: Repo.rollback(:trace_identity_conflict)
    end
  end

  @doc "同作品、同活动会话的状态投影；消息摘要有界，采纳状态完整。"
  def context(work_id, session_id) when is_binary(work_id) and is_binary(session_id) do
    with {:ok, _} <- Ecto.UUID.cast(session_id),
         %WorkSession{status: "ACTIVE"} <-
           Repo.get_by(WorkSession, id: session_id, work_id: work_id) do
      Interaction
      |> where([i], i.workspace_id == ^work_id and i.session_id == ^session_id)
      |> order_by([i], desc: i.inserted_at, desc: i.id)
      |> limit(@history_limit)
      |> Repo.all()
      |> Enum.map(&NovelPersistence.MemoryLog.canonical_interaction/1)
      |> project_context()
      |> Map.merge(
        Map.take(WorkSessionRepo.adoption_state(work_id, session_id), [
          :pending_adoptions,
          :resolved_adoptions
        ])
      )
    else
      _ -> %{}
    end
  end

  def context(_work_id, _session_id), do: %{}

  @doc "按可信作品/会话和原运行身份读取已接收输入及其处置，不推断新的运行。"
  def receipt_input(work_id, session_id, run_id) do
    case receipt_rows(work_id, session_id, run_id, "user") do
      [entry | _] -> {:ok, %{turn_id: entry.turn_id, content: entry.content}}
      [] -> {:error, :received_input_not_found}
    end
  end

  def submission_input(work_id, session_id, submission_id) do
    case Repo.get(Interaction, identity(work_id, session_id, submission_id, "user", nil)) do
      nil -> nil
      entry -> %{turn_id: entry.turn_id, content: entry.content}
    end
  end

  @doc "仅从同作用域、同 trace 的已提交结果恢复作者可见来源元数据，不生成模型认知。"
  def trace_metadata(work, session, turn, trace) do
    row =
      from(i in Interaction,
        where:
          i.workspace_id == ^work and i.session_id == ^session and i.turn_id == ^turn and
            i.role == "assistant",
        where:
          fragment("json_extract(?, '$.turn_result.trace_summary.trace_ref')", i.content) ==
            ^trace,
        order_by: [desc: i.updated_at],
        limit: 1
      )
      |> Repo.one()

    case row do
      nil -> %{}
      row -> author_trace_metadata(row.content["turn_result"])
    end
  end

  defp author_trace_metadata(result) do
    summary =
      Map.merge(
        result["trace_summary"] || %{},
        Map.take(
          result["frame_summary"] || %{},
          ~w(frame_origin goal_origin model_interpretation_status)
        )
      )

    [
      :reply_record,
      :frame_type,
      :dialogue_goal,
      :context_refs,
      :has_context,
      :frame_origin,
      :goal_origin,
      :model_interpretation_status
    ]
    |> Enum.flat_map(fn key ->
      case Map.fetch(summary, Atom.to_string(key)) do
        {:ok, value} -> [{key, value}]
        :error -> []
      end
    end)
    |> Map.new()
  end

  def received_user_run(attrs) do
    case submission_input(attrs.workspace_id, attrs.session_id, attrs.turn_id) do
      nil ->
        :new

      %{content: content} ->
        if same_input?(content, attrs),
          do: {:ok, content["agent_run_id"]},
          else: {:error, :input_identity_conflict}
    end
  end

  def receipt_results(work_id, session_id, run_id) do
    receipt_rows(work_id, session_id, run_id, "assistant")
    |> Enum.map(&NovelPersistence.MemoryLog.canonical_interaction/1)
    |> Enum.map(& &1.content["turn_result"])
    |> Enum.reject(&is_nil/1)
    |> Enum.reverse()
    |> Enum.uniq_by(& &1["turn_id"])
    |> Enum.reverse()
  end

  defp receipt_rows(work_id, session_id, run_id, role) do
    Interaction
    |> where([i], i.workspace_id == ^work_id and i.role == ^role)
    |> receipt_session(session_id)
    |> where([i], fragment("json_extract(?, '$.agent_run_id')", i.content) == ^run_id)
    |> order_by([i], asc: i.inserted_at, asc: i.id)
    |> Repo.all()
  end

  defp receipt_session(query, nil), do: where(query, [i], is_nil(i.session_id))
  defp receipt_session(query, session_id), do: where(query, [i], i.session_id == ^session_id)

  defp receive_input(attrs) do
    content = %{
      text: attrs.text,
      agent_run_id: attrs.run_id,
      candidate_selection: Map.get(attrs, :candidate_selection),
      generate_micro_plan: Map.get(attrs, :generate_micro_plan, false),
      submission_id: Map.get(attrs, :submission_id, attrs.turn_id),
      message_kind: Map.get(attrs, :message_kind, "user_message"),
      author_question_ref: Map.get(attrs, :author_question_ref),
      author_action_ref: Map.get(attrs, :author_action_ref),
      author_choice_value: Map.get(attrs, :author_choice_value),
      source_question_turn_ref: Map.get(attrs, :source_question_turn_ref),
      goal_version: Map.get(attrs, :goal_version, 1),
      message_handling: %{status: "created", processed_at: nil, result_turn_refs: []}
    }

    entry = entry(attrs, attrs.turn_id, "user", content)
    existing = Repo.get(Interaction, entry.id)

    if is_nil(existing) do
      entry |> changeset() |> Repo.insert(on_conflict: :nothing) |> unwrap!()
    end

    stored = Repo.get!(Interaction, entry.id)

    if not same_input?(stored.content, attrs) do
      Repo.rollback(:input_identity_conflict)
    end

    %{
      run_id: stored.content["agent_run_id"],
      goal_version: stored.content["goal_version"] || 1,
      source_turn_ref: stored.turn_id,
      duplicate?: not is_nil(existing) or stored.content["agent_run_id"] != attrs.run_id
    }
  end

  defp same_input?(content, attrs) do
    content["text"] == attrs.text and
      content["author_question_ref"] == Map.get(attrs, :author_question_ref) and
      content["author_action_ref"] == Map.get(attrs, :author_action_ref) and
      content["author_choice_value"] == Map.get(attrs, :author_choice_value) and
      content["source_question_turn_ref"] == Map.get(attrs, :source_question_turn_ref) and
      content["candidate_selection"] == jsonable(Map.get(attrs, :candidate_selection)) and
      Map.get(content, "message_kind", "user_message") ==
        Map.get(attrs, :message_kind, "user_message") and
      Map.get(content, "generate_micro_plan", false) ==
        Map.get(attrs, :generate_micro_plan, false)
  end

  defp entry(attrs, turn_ref, role, content) do
    %{
      id:
        identity(
          attrs.workspace_id,
          attrs.session_id,
          if(role == "user", do: Map.get(attrs, :submission_id) || turn_ref, else: turn_ref),
          role,
          result_version(role, attrs)
        ),
      workspace_id: attrs.workspace_id,
      session_id: attrs.session_id,
      turn_id: turn_ref,
      role: role,
      content: jsonable(content),
      source_ref: turn_ref,
      scope_ref: attrs.workspace_id,
      freshness_score: 1.0,
      importance_score: 0.5,
      replayable: true,
      retrievable: true
    }
  end

  defp changeset(attrs),
    do: Interaction.changeset(%Interaction{id: attrs.id}, Map.delete(attrs, :id))

  defp result_version("assistant", attrs), do: Map.get(attrs, :goal_version, 1)
  defp result_version(_role, _attrs), do: nil

  defp identity(work, session, turn, role, version) do
    bytes =
      :crypto.hash(
        :sha256,
        :erlang.term_to_binary({:interaction_lifecycle, work, session, turn, role, version})
      )

    {:ok, id} = Ecto.UUID.load(binary_part(bytes, 0, 16))
    id
  end

  defp update_inputs(attrs, result_ref) do
    Interaction
    |> where([i], i.workspace_id == ^attrs.workspace_id and i.session_id == ^attrs.session_id)
    |> where([i], i.role == "user")
    |> where([i], fragment("json_extract(?, '$.agent_run_id')", i.content) == ^attrs.run_id)
    |> Repo.all()
    |> Enum.each(&update_input(&1, attrs, result_ref))
  end

  defp update_input(entry, attrs, result_ref) do
    handling = entry.content["message_handling"] || %{}
    refs = Enum.uniq(List.wrap(handling["result_turn_refs"]) ++ List.wrap(result_ref))
    status = to_string(Map.get(attrs, :status, "running"))

    processed? =
      not is_nil(result_ref) or status in ~w(completed failed cancelled awaiting_author)

    handling =
      handling
      |> Map.put("status", status)
      |> Map.put("result_turn_refs", refs)
      |> Map.put("processed_at", handling["processed_at"] || processed_at(processed?))

    entry
    |> Interaction.changeset(%{content: Map.put(entry.content, "message_handling", handling)})
    |> Repo.update()
    |> unwrap!()
  end

  defp processed_at(true), do: DateTime.utc_now() |> DateTime.to_iso8601()
  defp processed_at(false), do: nil

  defp project_context(entries) do
    results = Enum.filter(entries, &(&1.role == "assistant"))

    %{
      author_inputs:
        entries
        |> Enum.filter(&(&1.role == "user"))
        |> Enum.uniq_by(& &1.turn_id)
        |> Enum.take(@author_limit)
        |> Enum.map(fn entry ->
          %{
            turn_ref: entry.turn_id,
            text: entry.content["text"] || "",
            run_ref: entry.content["agent_run_id"],
            handling: entry.content["message_handling"] || %{}
          }
        end),
      recent_results: results |> Enum.take(@author_limit) |> Enum.map(&result_summary/1)
    }
  end

  defp result_summary(entry) do
    result = entry.content["turn_result"] || %{}

    %{
      turn_ref: entry.turn_id,
      run_ref: entry.content["agent_run_id"],
      text: String.slice(entry.content["text"] || "", 0, 400),
      truthfulness: result["truthfulness"] || %{}
    }
  end

  defp unwrap!({:ok, value}), do: value
  defp unwrap!({:error, reason}), do: Repo.rollback(reason)
  defp value(map, key), do: Map.get(map, key) || Map.get(map, Atom.to_string(key))
  defp jsonable(value), do: value |> Jason.encode!() |> Jason.decode!()
end
