defmodule NovelPersistence.InteractionLifecycle do
  @moduledoc """
  ADR-0027：在现有 Interaction 上保存消息处置与运行结果。
  接收身份和结果身份稳定，原文与运行状态分开；不新增义务或作品事实。
  """

  import Ecto.Query

  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Interaction, WorkSession}

  @history_limit 80
  @author_limit 10

  def call(:receive, attrs) do
    Repo.transaction(fn -> receive_input(attrs) end)
  end

  def call(:result, attrs) do
    Repo.transaction(fn ->
      result = attrs.turn_result
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
      :recorded
    end)
  end

  def call(:status, attrs) do
    Repo.transaction(fn ->
      update_inputs(attrs, nil)
      :recorded
    end)
  end

  @doc "同作品、同活动会话的有界状态投影；原文只作为引用源，不由模型重建。"
  def context(work_id, session_id) when is_binary(work_id) and is_binary(session_id) do
    with {:ok, _} <- Ecto.UUID.cast(session_id),
         %WorkSession{status: "ACTIVE"} <-
           Repo.get_by(WorkSession, id: session_id, work_id: work_id) do
      Interaction
      |> where([i], i.workspace_id == ^work_id and i.session_id == ^session_id)
      |> order_by([i], desc: i.inserted_at, desc: i.id)
      |> limit(@history_limit)
      |> Repo.all()
      |> project_context()
    else
      _ -> %{}
    end
  end

  def context(_work_id, _session_id), do: %{}

  defp receive_input(attrs) do
    content = %{
      text: attrs.text,
      agent_run_id: attrs.run_id,
      candidate_selection: Map.get(attrs, :candidate_selection),
      message_handling: %{status: "created", processed_at: nil, result_turn_refs: []}
    }

    entry = entry(attrs, attrs.turn_id, "user", content)
    existing = Repo.get(Interaction, entry.id)

    if is_nil(existing) do
      entry |> changeset() |> Repo.insert(on_conflict: :nothing) |> unwrap!()
    end

    stored = Repo.get!(Interaction, entry.id)

    if stored.content["text"] != attrs.text or
         stored.content["candidate_selection"] != jsonable(Map.get(attrs, :candidate_selection)) do
      Repo.rollback(:input_identity_conflict)
    end

    %{
      run_id: stored.content["agent_run_id"],
      duplicate?: not is_nil(existing) or stored.content["agent_run_id"] != attrs.run_id
    }
  end

  defp entry(attrs, turn_ref, role, content) do
    %{
      id:
        identity(
          attrs.workspace_id,
          attrs.session_id,
          turn_ref,
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
    resolved = adoption_entries(results, "resolved")
    resolved_ids = MapSet.new(resolved, & &1["artifact_id"])

    pending =
      results
      |> adoption_entries("pending")
      |> Enum.reject(&MapSet.member?(resolved_ids, &1["artifact_id"]))

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
      pending_adoptions: pending,
      resolved_adoptions: resolved,
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

  defp adoption_entries(entries, key) do
    entries
    |> Enum.flat_map(fn entry ->
      entry.content |> get_in(["turn_result", "adoption_state", key]) |> List.wrap()
    end)
    |> Enum.uniq_by(& &1["artifact_id"])
  end

  defp unwrap!({:ok, value}), do: value
  defp unwrap!({:error, reason}), do: Repo.rollback(reason)
  defp value(map, key), do: Map.get(map, key) || Map.get(map, Atom.to_string(key))
  defp jsonable(value), do: value |> Jason.encode!() |> Jason.decode!()
end
