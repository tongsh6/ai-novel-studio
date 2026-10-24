defmodule NovelApplication.AuthorQuestionService do
  @moduledoc "B26：明确问题的回复、作用域校验和恢复；一般自由输入由原入口处理。"
  alias NovelApplication.{ActionValidator, AgentRunServer, AgentRunService, AuthorQuestion}
  alias NovelPersistence.{AgentRunLog, AuthorQuestionRepo, WorkSessionRepo}

  def open_results(work, session) do
    AuthorQuestionRepo.results(work, session)
    |> Enum.map(&project(&1, work, session))
    |> Enum.filter(&(field(field(&1, :author_question), :status) == "open"))
  end

  def project(result, work, session) do
    q = field(result, :author_question)
    id = field(q, :run_id)
    {run, live?} = runtime(id, work, session)

    read_only? =
      case WorkSessionRepo.get_by_work(work, session) do
        %{status: "ACTIVE"} -> false
        _ -> true
      end

    AuthorQuestion.project(result, run, live?, read_only?)
  end

  def reply(work, session, input) do
    with :ok <- validate_input(work, session, input),
         %{status: "ACTIVE"} <- WorkSessionRepo.get_by_work(work, session),
         %{content: %{"turn_result" => source}} <-
           AuthorQuestionRepo.source(work, session, input.source_turn_ref),
         :ok <- ActionValidator.validate(input, source),
         {:ok, request} <- request(work, session, input, source) do
      case AuthorQuestionRepo.receipt(request.receipt_key, request.payload_digest) do
        {:ok, result} -> {:ok, current_ack(result, work, session, true)}
        {:error, reason} -> {:error, reason}
        :new -> submit(request)
      end
    else
      {:error, reason} -> {:error, reason}
      _ -> {:error, :author_question_source_unavailable}
    end
  end

  defp validate_input(work, session, input) do
    refs = [
      work,
      session,
      input.source_turn_ref,
      input.action_id,
      input.target_ref,
      input.idempotency_key
    ]

    if Enum.all?(refs, &(is_binary(&1) and String.trim(&1) != "")) and is_map(input.payload),
      do: :ok,
      else: {:error, :invalid_author_question_input}
  end

  defp request(work, session, input, source) do
    q = field(source, :author_question)

    action =
      Enum.find(
        field(source, :available_actions) || [],
        &(field(&1, :action_id) == input.action_id)
      )

    payload = input.payload
    submission = field(payload, :submission_id)

    text = answer_text(action, payload)

    cond do
      not nonblank?(submission) ->
        {:error, :submission_id_required}

      not nonblank?(text) ->
        {:error, :author_reply_text_required}

      field(q, :question_ref) != field(payload, :question_ref) ->
        {:error, :question_ref_mismatch}

      field(q, :goal_version) != field(payload, :expected_goal_version) ->
        {:error, :goal_version_mismatch}

      field(q, :run_id) != input.target_ref ->
        {:error, :run_scope_mismatch}

      not exact_action_binding?(input, action) ->
        {:error, :source_action_binding_mismatch}

      true ->
        ref = field(q, :question_ref)

        key = %{
          work_id: work,
          session_id: session,
          source_turn_ref: input.source_turn_ref,
          action_id: input.action_id,
          action_type: "author_choice",
          idempotency_key:
            AuthorQuestion.hash(
              {work, session, ref, input.action_id, input.idempotency_key, submission}
            )
        }

        {:ok,
         %{
           workspace_id: work,
           session_id: session,
           run_id: input.target_ref,
           source_turn_ref: input.source_turn_ref,
           question_ref: ref,
           expected_goal_version: field(q, :goal_version),
           submission_id: submission,
           text: text,
           choice_value: field(action, :candidate_ref),
           action_input: input,
           receipt_key: key,
           payload_digest:
             AuthorQuestion.hash({ref, input.action_id, input.candidate_ref, text, input.payload})
         }}
    end
  end

  defp answer_text(action, payload) do
    case field(action, :response_kind) do
      "free_text" -> field(payload, :text)
      _ -> field(action, :label)
    end
  end

  defp exact_action_binding?(input, action) do
    input.candidate_ref == field(action, :candidate_ref) and
      input.idempotency_key == field(action, :idempotency_key)
  end

  defp submit(request) do
    case Registry.lookup(NovelApplication.AgentRunRegistry, request.run_id) do
      [{pid, _}] ->
        case AgentRunServer.steer_submission(
               pid,
               %{author_question_reply: request},
               request.submission_id
             ) do
          {:ok, result} ->
            {:ok, current_ack(result, request.workspace_id, request.session_id, false)}

          error ->
            error
        end

      [] ->
        {:error, :author_question_runtime_unavailable}
    end
  catch
    :exit, _ -> {:error, :author_question_delivery_unknown}
  end

  def current_ack(result, work, session, duplicate) do
    id = field(result, :run_id)
    {run, live?} = runtime(id, work, session)

    %{
      status: field(result, :status),
      question_ref: field(result, :question_ref),
      submission_id: field(result, :submission_id),
      run_id: id,
      goal_version:
        if(run,
          do: field(run, :goal_version) || field(field(run, :goal), :version),
          else: field(result, :goal_version)
        ),
      duplicate: duplicate or field(result, :duplicate) == true,
      runtime_live: live?,
      agent_run_state:
        if(run, do: %{run_id: id, status: to_string(field(run, :status)), runtime_live: live?})
    }
  end

  defp runtime(id, work, session) do
    case AgentRunService.state(id) do
      {:ok, %{run: run}} when run.work_id == work and run.session_id == session ->
        {run, true}

      _ ->
        case AgentRunLog.get_run(id) do
          %{work_id: ^work, session_id: ^session} = record -> {record, false}
          _ -> {nil, false}
        end
    end
  end

  defp nonblank?(text), do: is_binary(text) and String.trim(text) != ""

  defp field(map, key) when is_map(map), do: Map.get(map, key, Map.get(map, to_string(key)))
  defp field(_, _), do: nil
end
