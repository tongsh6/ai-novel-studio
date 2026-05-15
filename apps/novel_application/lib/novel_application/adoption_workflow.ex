defmodule NovelApplication.AdoptionWorkflow do
  @moduledoc """
  Application-level adoption workflow for author-triggered artifact adoption.

  This keeps the web channel thin: the frontend submits an artifact action,
  then application code evaluates the current pending artifact through
  `AdoptionBoundary` and returns the observable action/TurnResult payloads.
  """

  alias NovelApplication.AdoptionBoundary
  alias NovelDomain.AdoptionDecision
  alias NovelDomain.CandidateSet

  @spec handle_adopt(map() | nil, map(), function() | nil) ::
          {:ok, map(), map()} | {:error, String.t()}
  def handle_adopt(
        source_turn_result,
        params,
        adoption_writer \\ NovelApplication.persistence_adoption_writer()
      )

  def handle_adopt(nil, _params, _adoption_writer),
    do: {:error, "source_turn_result not available"}

  def handle_adopt(source_turn_result, %{"artifact_id" => artifact_id} = params, adoption_writer)
      when is_binary(artifact_id) do
    with {:ok, artifact} <- find_pending_artifact(source_turn_result, artifact_id),
         :ok <- check_revision_base(artifact, params),
         candidate_set <- candidate_set_from_artifact(source_turn_result, artifact),
         decision <- AdoptionBoundary.evaluate(candidate_set, %{"candidate_id" => artifact_id}),
         true <- AdoptionDecision.adopted?(decision),
         {:ok, persisted} <-
           persist_adoption(adoption_writer, source_turn_result, decision, artifact, params) do
      {:ok, build_action_result(decision, artifact, persisted),
       build_turn_result(source_turn_result, decision, artifact, persisted)}
    else
      {:error, reason} -> {:error, reason}
      false -> {:error, "adoption boundary did not accept artifact"}
    end
  end

  def handle_adopt(_source_turn_result, _params, _adoption_writer),
    do: {:error, "artifact_id is required"}

  @spec handle_discard(map() | nil, map()) :: {:ok, map(), map()} | {:error, String.t()}
  def handle_discard(nil, _params), do: {:error, "source_turn_result not available"}

  def handle_discard(source_turn_result, %{"artifact_id" => artifact_id})
      when is_binary(artifact_id) do
    with {:ok, artifact} <- find_pending_artifact(source_turn_result, artifact_id) do
      {:ok, build_discard_action_result(artifact),
       build_discard_turn_result(source_turn_result, artifact)}
    end
  end

  def handle_discard(_source_turn_result, _params), do: {:error, "artifact_id is required"}

  @spec handle_modify_draft(map() | nil, map(), function() | nil) ::
          {:ok, map(), map()} | {:error, String.t()}
  def handle_modify_draft(
        source_turn_result,
        params,
        adoption_writer \\ NovelApplication.persistence_adoption_writer()
      )

  def handle_modify_draft(nil, _params, _adoption_writer),
    do: {:error, "source_turn_result not available"}

  def handle_modify_draft(source_turn_result, params, adoption_writer) do
    artifact_id = Map.get(params, "artifact_id") || Map.get(params, "draft_id")
    instruction = Map.get(params, "instruction")

    cond do
      not is_binary(artifact_id) ->
        {:error, "draft_id is required"}

      not is_binary(instruction) or String.trim(instruction) == "" ->
        {:error, "instruction is required"}

      true ->
        handle_modify_draft_with_artifact(
          source_turn_result,
          params,
          adoption_writer,
          artifact_id
        )
    end
  end

  defp find_pending_artifact(source_turn_result, artifact_id) do
    pending =
      source_turn_result
      |> get_in_any([:adoption_state, :pending])
      |> List.wrap()

    case Enum.find(pending, &(artifact_field(&1, :artifact_id) == artifact_id)) do
      nil -> {:error, "pending artifact not found"}
      artifact -> {:ok, artifact}
    end
  end

  defp handle_modify_draft_with_artifact(source_turn_result, params, adoption_writer, artifact_id) do
    with {:ok, artifact} <- find_pending_artifact(source_turn_result, artifact_id),
         :ok <- check_revision_base(artifact, params),
         edited_artifact <- edited_artifact(artifact, params),
         candidate_set <- candidate_set_from_artifact(source_turn_result, edited_artifact),
         decision <- AdoptionBoundary.evaluate(candidate_set, %{"candidate_id" => artifact_id}),
         true <- AdoptionDecision.adopted?(decision),
         {:ok, persisted} <-
           persist_adoption(
             adoption_writer,
             source_turn_result,
             decision,
             edited_artifact,
             params
           ) do
      {:ok, build_edit_action_result(decision, edited_artifact, persisted),
       build_edited_turn_result(source_turn_result, decision, edited_artifact, persisted)}
    else
      {:error, reason} -> {:error, reason}
      false -> {:error, "adoption boundary did not accept edited artifact"}
    end
  end

  defp check_revision_base(artifact, params) do
    expected = artifact_field(artifact, :revision_base)
    actual = Map.get(params, "base_revision")

    cond do
      is_nil(expected) or expected == "" ->
        :ok

      to_string(expected) == to_string(actual) ->
        :ok

      true ->
        {:error, "stale artifact revision"}
    end
  end

  defp candidate_set_from_artifact(source_turn_result, artifact) do
    artifact_id = artifact_field(artifact, :artifact_id)
    artifact_type = artifact_field(artifact, :artifact_type)

    %CandidateSet{
      candidate_set_id: "cs_#{artifact_id}",
      turn_id: turn_id(source_turn_result),
      candidate_type: candidate_type(artifact_type),
      source_refs: [turn_id(source_turn_result), artifact_id] |> Enum.reject(&is_nil/1),
      candidates: [
        %{
          candidate_id: artifact_id,
          summary: artifact_summary(artifact),
          content_ref: "artifact:#{artifact_id}",
          origin_ref:
            artifact_field(artifact, :source_tool_result_ref) ||
              "turn:#{turn_id(source_turn_result)}",
          risk_hint: :low,
          adoption_target_ref: "artifact:#{artifact_id}"
        }
      ],
      stability: :tentative,
      trace_ref: trace_ref(source_turn_result)
    }
  end

  defp persist_adoption(nil, _source_turn_result, decision, _artifact, _params) do
    {:ok,
     %{
       mutation_id: decision.adoption_decision_id,
       mutation_status: "APPLIED",
       memory_item_id: decision.adopted_state_ref,
       memory_status: "CONFIRMED",
       source_revision_ref: "decision:#{decision.adoption_decision_id}",
       persisted: false,
       persistence_status: "not_configured"
     }}
  end

  defp persist_adoption(writer, source_turn_result, decision, artifact, params)
       when is_function(writer, 1) do
    attrs = %{
      actor_ref: "author",
      work_id: Map.get(params, "work_id") || map_field(source_turn_result, :work_id),
      source_turn_ref: turn_id(source_turn_result),
      artifact_id: artifact_field(artifact, :artifact_id),
      artifact_type: artifact_field(artifact, :artifact_type),
      base_revision: normalized_base_revision(artifact_field(artifact, :revision_base)),
      content: artifact_content(artifact),
      summary: artifact_summary(artifact),
      decision_id: decision.adoption_decision_id
    }

    case writer.(attrs) do
      {:ok, persisted} -> {:ok, Map.put(persisted, :persisted, true)}
      {:error, reason} -> {:error, "adoption persistence failed: #{inspect(reason)}"}
    end
  end

  defp build_action_result(%AdoptionDecision{} = decision, artifact, persisted) do
    %{
      action_id: "adopt:#{artifact_field(artifact, :artifact_id)}",
      action_type: "adopt",
      status: "accepted",
      artifact_id: artifact_field(artifact, :artifact_id),
      artifact_type: artifact_field(artifact, :artifact_type),
      decision: decision_payload(decision),
      persistence: persisted
    }
  end

  defp build_discard_action_result(artifact) do
    %{
      action_id: "discard:#{artifact_field(artifact, :artifact_id)}",
      action_type: "discard",
      status: "discarded",
      artifact_id: artifact_field(artifact, :artifact_id),
      artifact_type: artifact_field(artifact, :artifact_type)
    }
  end

  defp build_edit_action_result(%AdoptionDecision{} = decision, artifact, persisted) do
    %{
      action_id: "modify_draft:#{artifact_field(artifact, :artifact_id)}",
      action_type: "modify_draft",
      status: "accepted",
      artifact_id: artifact_field(artifact, :artifact_id),
      artifact_type: artifact_field(artifact, :artifact_type),
      decision: decision_payload(decision),
      persistence: persisted
    }
  end

  defp build_turn_result(source_turn_result, %AdoptionDecision{} = decision, artifact, persisted) do
    source_turn_id = turn_id(source_turn_result)
    artifact_id = artifact_field(artifact, :artifact_id)

    %{
      schema_version: "3.0-draft",
      turn_id: "turn_adopt_#{System.unique_integer([:positive, :monotonic])}",
      parent_turn_id: source_turn_id,
      assistant_message: %{text: "已通过采纳边界，采纳内容已进入已决状态。"},
      ui_cards: [],
      trace_summary: %{
        decision_type: to_string(decision.decision_type),
        reason_codes: decision.reason_codes,
        decision_trace_ref: decision.decision_trace_ref,
        state_trace_ref: decision.state_trace_ref
      },
      phase: "completed",
      status: "conversational",
      available_actions: [],
      adoption_state: %{
        pending: [],
        resolved: [
          %{
            artifact_id: artifact_id,
            artifact_type: artifact_field(artifact, :artifact_type),
            adoption_status: "ACCEPTED",
            requires_adoption: false,
            source_artifact_ref: artifact_id,
            adopted_state_ref: persisted[:memory_item_id] || decision.adopted_state_ref,
            state_trace_ref:
              "mutation:#{persisted[:mutation_id] || decision.adoption_decision_id}",
            decision_trace_ref: decision.decision_trace_ref,
            mutation_ref: persisted[:mutation_id],
            payload: artifact_field(artifact, :payload) || %{}
          }
        ]
      },
      projection_refs: projection_refs(decision, persisted, source_turn_id, artifact_id),
      truthfulness: %{
        tool_called: false,
        artifact_adopted: true,
        production_write_performed: persisted[:persisted] == true,
        state_persisted: persisted[:persisted] == true,
        mutation_ref: persisted[:mutation_id],
        adopted_state_ref: persisted[:memory_item_id],
        durable_behavior_opened: false,
        decision_type: decision.decision_type,
        reason_codes: decision.reason_codes
      }
    }
  end

  defp build_discard_turn_result(source_turn_result, artifact) do
    source_turn_id = turn_id(source_turn_result)
    artifact_id = artifact_field(artifact, :artifact_id)

    %{
      schema_version: "3.0-draft",
      turn_id: "turn_discard_#{System.unique_integer([:positive, :monotonic])}",
      parent_turn_id: source_turn_id,
      assistant_message: %{text: "已放弃该待采纳内容。"},
      ui_cards: [],
      trace_summary: %{
        decision_type: "discard_artifact",
        reason_codes: ["author_discarded_pending_artifact"],
        decision_trace_ref: nil,
        state_trace_ref: nil
      },
      phase: "completed",
      status: "conversational",
      available_actions: [],
      adoption_state: %{
        pending: [],
        resolved: [
          %{
            artifact_id: artifact_id,
            artifact_type: artifact_field(artifact, :artifact_type),
            adoption_status: "DISCARDED",
            requires_adoption: false,
            source_artifact_ref: artifact_id,
            payload: artifact_field(artifact, :payload) || %{}
          }
        ]
      },
      projection_refs: [],
      truthfulness: %{
        tool_called: false,
        artifact_adopted: false,
        production_write_performed: false,
        state_persisted: false,
        mutation_ref: nil,
        adopted_state_ref: nil,
        durable_behavior_opened: false,
        decision_type: :discard_artifact,
        reason_codes: ["author_discarded_pending_artifact"]
      }
    }
  end

  defp build_edited_turn_result(
         source_turn_result,
         %AdoptionDecision{} = decision,
         artifact,
         persisted
       ) do
    source_turn_id = turn_id(source_turn_result)
    artifact_id = artifact_field(artifact, :artifact_id)

    %{
      schema_version: "3.0-draft",
      turn_id: "turn_edit_accept_#{System.unique_integer([:positive, :monotonic])}",
      parent_turn_id: source_turn_id,
      assistant_message: %{text: "已按修改意见采纳该内容。"},
      ui_cards: [],
      trace_summary: %{
        decision_type: "edit_then_accept",
        reason_codes: ["author_edited_pending_artifact", "candidate_adopted_as_tentative"],
        decision_trace_ref: decision.decision_trace_ref,
        state_trace_ref: decision.state_trace_ref
      },
      phase: "completed",
      status: "conversational",
      available_actions: [],
      adoption_state: %{
        pending: [],
        resolved: [
          %{
            artifact_id: artifact_id,
            artifact_type: artifact_field(artifact, :artifact_type),
            adoption_status: "EDITED_ACCEPTED",
            requires_adoption: false,
            source_artifact_ref: artifact_id,
            adopted_state_ref: persisted[:memory_item_id] || decision.adopted_state_ref,
            state_trace_ref:
              "mutation:#{persisted[:mutation_id] || decision.adoption_decision_id}",
            decision_trace_ref: decision.decision_trace_ref,
            mutation_ref: persisted[:mutation_id],
            payload: artifact_field(artifact, :payload) || %{}
          }
        ]
      },
      projection_refs: projection_refs(decision, persisted, source_turn_id, artifact_id),
      truthfulness: %{
        tool_called: false,
        artifact_adopted: true,
        production_write_performed: persisted[:persisted] == true,
        state_persisted: persisted[:persisted] == true,
        mutation_ref: persisted[:mutation_id],
        adopted_state_ref: persisted[:memory_item_id],
        durable_behavior_opened: false,
        decision_type: :edit_then_accept,
        reason_codes: ["author_edited_pending_artifact", "candidate_adopted_as_tentative"]
      }
    }
  end

  defp projection_refs(
         %AdoptionDecision{projection_hints: hints},
         persisted,
         source_turn_id,
         artifact_id
       ) do
    source_revision_ref = persisted[:source_revision_ref] || "#{source_turn_id}:#{artifact_id}"
    reading_projection = persisted[:reading_projection]

    if reading_projection do
      Enum.map(hints, fn hint ->
        %{
          projection_type: "reading_projection_toc",
          projection_id: to_string(hint[:projection_ref] || "reading_projection"),
          source_revision_refs: [source_revision_ref],
          refresh_status: "STALE",
          projection_hint_id: hint[:projection_hint_id],
          reason: hint[:reason]
        }
      end)
    else
      []
    end
  end

  defp decision_payload(%AdoptionDecision{} = decision) do
    %{
      adoption_decision_id: decision.adoption_decision_id,
      decision_type: decision.decision_type,
      candidate_ref: decision.candidate_ref,
      target_ref: decision.target_ref,
      adopted_state_ref: decision.adopted_state_ref,
      state_trace_ref: decision.state_trace_ref,
      decision_trace_ref: decision.decision_trace_ref,
      reason_codes: decision.reason_codes,
      projection_hints: decision.projection_hints
    }
  end

  defp artifact_summary(artifact) do
    payload = artifact_field(artifact, :payload) || %{}

    cond do
      meaningful_title?(payload[:title], artifact) -> String.trim(payload[:title])
      meaningful_title?(payload["title"], artifact) -> String.trim(payload["title"])
      is_list(payload[:items]) -> summary_from_items(payload[:items], artifact)
      is_list(payload["items"]) -> summary_from_items(payload["items"], artifact)
      true -> "已采纳内容"
    end
  end

  defp summary_from_items(items, artifact) do
    items
    |> Enum.map(&item_title/1)
    |> Enum.find(&meaningful_title?(&1, artifact))
    |> case do
      nil -> "已采纳内容"
      title -> title |> to_string() |> String.trim()
    end
  end

  defp item_title(item) when is_map(item), do: Map.get(item, :title) || Map.get(item, "title")
  defp item_title(_), do: nil

  defp meaningful_title?(title, artifact) when is_binary(title) do
    trimmed = String.trim(title)
    artifact_id = artifact_field(artifact, :artifact_id)

    trimmed != "" and trimmed != artifact_id and not String.match?(trimmed, ~r/^as_\d+$/)
  end

  defp meaningful_title?(_, _artifact), do: false

  defp artifact_content(artifact) do
    payload = artifact_field(artifact, :payload) || %{}

    cond do
      is_binary(payload[:content]) -> payload[:content]
      is_binary(payload["content"]) -> payload["content"]
      is_list(payload[:items]) -> Enum.map_join(payload[:items], "\n", &item_content/1)
      is_list(payload["items"]) -> Enum.map_join(payload["items"], "\n", &item_content/1)
      true -> artifact_summary(artifact)
    end
  end

  defp edited_artifact(artifact, params) do
    payload = artifact_field(artifact, :payload) || %{}
    instruction = params |> Map.fetch!("instruction") |> String.trim()

    original_content =
      Map.get(params, "content") || payload[:content] || payload["content"] ||
        artifact_summary(artifact)

    edited_payload =
      payload
      |> Map.put(:content, edited_content(original_content, instruction))
      |> Map.put(:original_content, original_content)
      |> Map.put(:edit_instruction, instruction)

    put_artifact_field(artifact, :payload, edited_payload)
  end

  defp edited_content(original_content, instruction) do
    [to_string(original_content), "修改要求：#{instruction}"]
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n\n")
  end

  defp item_content(item) when is_map(item) do
    title = Map.get(item, :title) || Map.get(item, "title")

    body =
      Map.get(item, :body) || Map.get(item, "body") || Map.get(item, :content) ||
        Map.get(item, "content")

    [title, body]
    |> Enum.reject(&(is_nil(&1) or &1 == ""))
    |> Enum.join(": ")
  end

  defp item_content(other), do: to_string(other)

  defp normalized_base_revision(nil), do: 1
  defp normalized_base_revision(value) when is_integer(value) and value > 0, do: value

  defp normalized_base_revision(value) when is_binary(value) do
    case Integer.parse(value) do
      {int, ""} when int > 0 -> int
      _ -> 1
    end
  end

  defp normalized_base_revision(_), do: 1

  defp candidate_type(:plot_direction), do: :direction
  defp candidate_type("plot_direction"), do: :direction
  defp candidate_type(:character_seed), do: :setting
  defp candidate_type("character_seed"), do: :setting
  defp candidate_type(:outline_draft), do: :outline
  defp candidate_type("outline_draft"), do: :outline
  defp candidate_type(_), do: :draft_fragment

  defp trace_ref(source_turn_result) do
    case map_field(source_turn_result, :trace_summary) do
      %{trace_id: trace_id} -> trace_id
      %{"trace_id" => trace_id} -> trace_id
      _ -> nil
    end
  end

  defp turn_id(source_turn_result), do: map_field(source_turn_result, :turn_id)

  defp get_in_any(map, keys) when is_map(map), do: do_get_in_any(map, keys)
  defp get_in_any(_, _), do: nil

  defp do_get_in_any(value, []), do: value

  defp do_get_in_any(map, [key | rest]) when is_map(map) do
    map
    |> map_field(key)
    |> do_get_in_any(rest)
  end

  defp do_get_in_any(_, _), do: nil

  defp map_field(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp artifact_field(map, key) when is_map(map) do
    map_field(map, key)
  end

  defp put_artifact_field(map, key, value) when is_map(map) do
    if Map.has_key?(map, key),
      do: Map.put(map, key, value),
      else: Map.put(map, Atom.to_string(key), value)
  end
end
