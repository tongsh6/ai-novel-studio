defmodule NovelPersistence.AuthorContentRegistration do
  @moduledoc "B26：在结果提交事务内重验作者来源的物化状态，避免过期上下文重复登记。"
  alias NovelPersistence.WorkSessionRepo

  def resolve(%{turn_result: %{"outcome" => "author_content_registration"} = result} = attrs) do
    source = get_in(result, ["trace_summary", "registration_source_ref"])
    state = WorkSessionRepo.adoption_state(attrs.workspace_id, attrs.session_id)

    existing =
      state.pending_adoptions ++
        Enum.filter(
          state.resolved_adoptions,
          &(&1["adoption_status"] in NovelDomain.AdoptionStatus.canon_statuses())
        )

    matches = Enum.filter(existing, &(source_ref(&1) == source and is_binary(source)))

    current_ids =
      Enum.map(get_in(result, ["adoption_state", "pending"]) || [], & &1["artifact_id"])

    reusable = Enum.reject(matches, &(&1["artifact_id"] in current_ids))
    if reusable == [], do: {result, false}, else: {reused_result(result, source, reusable), true}
  end

  def resolve(attrs), do: {attrs.turn_result, false}

  defp reused_result(result, source, entries) do
    registration = %{
      source_ref: source,
      outcome: "already_materialized",
      artifacts: Enum.map(entries, &Map.take(&1, ~w(artifact_id adoption_status source_turn_ref)))
    }

    result
    |> Map.merge(%{
      "outcome" => "already_materialized",
      "adoption_state" => %{"pending" => [], "resolved" => []},
      "available_actions" => [],
      "ui_cards" => [],
      "phase" => "dialogue",
      "status" => "conversational"
    })
    |> Map.update!("trace_summary", &Map.put(&1, "registration", registration))
  end

  defp source_ref(entry) do
    payload = entry["payload"] || %{}
    item = List.first(payload["items"] || []) || %{}

    payload["registration_source_ref"] || entry["source_tool_result_ref"] ||
      item["provider_call_ref"]
  end
end
