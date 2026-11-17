defmodule NovelCommon.RequestIR.MessageCoverage do
  @moduledoc """
  R03 以现有 run/message 坐标解析消息覆盖；只消费可信会话视图，不读库。

  canonical_ref 是派生定位事实，持久化前移除。选择器只引用旧 Scope 或已结束
  run 的纯模型讨论；作者、当前范围、活动 run 和工具组由各自契约保护。
  """
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection

  @selector_keys ~w(run_id run_sequence role source_refs versions)a
  @identity_keys ~w(run_id workspace_id work_id session_id parent_turn_ref)a

  def annotate(messages, run) do
    owner = field(run, :run_id)

    {annotated, _sequence} =
      Enum.map_reduce(messages, 0, fn message, sequence ->
        case identity(message) do
          %{run_id: ^owner, run_sequence: position} ->
            {message, max(sequence, position)}

          %{run_id: _foreign} ->
            {message, sequence}

          nil ->
            position = sequence + 1
            reference = Map.new(@identity_keys, &{&1, field(run, &1)})

            reference =
              Map.merge(reference, %{run_sequence: position, run_status: field(run, :status)})

            {Map.put(message, :canonical_ref, reference), position}
        end
      end)

    annotated
  end

  def strip(message) when is_map(message), do: Map.delete(message, :canonical_ref)
  def strip(message), do: message

  @doc "当前段坐标按原序重建；有效外 run 坐标仅在同一步请求视图中保留。"
  def strip(message, current_run_id) do
    case identity(message) do
      %{run_id: id} when id != current_run_id -> message
      _ -> strip(message)
    end
  end

  def identity(%{canonical_ref: %{run_id: id, run_sequence: sequence}})
      when is_binary(id) and id != "" and is_integer(sequence) and sequence > 0,
      do: %{run_id: id, run_sequence: sequence}

  def identity(_message), do: nil

  def key(%{run_id: id, run_sequence: sequence}), do: {id, sequence}
  def key(_reference), do: nil

  def selector(message) do
    case identity(message) do
      nil ->
        nil

      reference ->
        Map.merge(reference, %{
          role: message.role,
          source_refs: Map.get(message, :source_refs, []),
          versions: Map.get(message, :versions, %{})
        })
    end
  end

  def valid_selector?(reference) when is_map(reference) do
    Enum.sort(Map.keys(reference)) == Enum.sort(@selector_keys) and
      is_binary(reference.run_id) and String.trim(reference.run_id) != "" and
      is_integer(reference.run_sequence) and reference.run_sequence > 0 and
      reference.role in ["scope_update", "assistant"] and
      is_list(reference.source_refs) and is_map(reference.versions)
  end

  def valid_selector?(_reference), do: false

  def resolve(messages, references) do
    indexed = Enum.with_index(messages)

    Enum.reduce_while(references, {:ok, []}, fn reference, {:ok, found} ->
      matches =
        Enum.filter(indexed, fn {message, _} -> key(identity(message)) == key(reference) end)

      with [{message, index}] <- matches,
           true <- same_evidence?(message, reference) do
        {:cont, {:ok, found ++ [%{message: message, index: index, reference: reference}]}}
      else
        [] -> {:halt, {:error, :checkpoint_unknown_message}}
        false -> {:halt, {:error, :checkpoint_message_evidence_mismatch}}
        [_ | _] -> {:halt, {:error, :checkpoint_ambiguous_message}}
      end
    end)
  end

  def eligible?(%{message: %{role: "scope_update"} = message, index: index}, messages, owner) do
    source_run = get_in(message, [:canonical_ref, :run_id])
    completed = get_in(message, [:canonical_ref, :run_status]) == "completed"

    replacement_run =
      cond do
        source_run == owner -> owner
        completed -> owner
        true -> nil
      end

    not is_nil(replacement_run) and
      Enum.any?(Enum.drop(messages, index + 1), fn candidate ->
        candidate.role == "scope_update" and
          get_in(candidate, [:canonical_ref, :run_id]) == replacement_run
      end)
  end

  def eligible?(%{message: message}, _messages, owner) do
    discussion?(message) and
      get_in(message, [:canonical_ref, :run_status]) == "completed" and
      get_in(message, [:canonical_ref, :run_id]) != owner
  end

  def discussion?(%{role: "assistant", provenance: "model", blocks: [_ | _] = blocks}),
    do: Enum.all?(blocks, &match?(%{type: "text", text: text} when is_binary(text), &1))

  def discussion?(_message), do: false

  def discussion_sources(messages, selected) do
    selected
    |> Enum.filter(&discussion?(&1.message))
    |> Enum.with_index()
    |> Enum.map(fn {%{message: message, index: index}, source_index} ->
      author = author_for(messages, message, index)

      %{
        source_index: source_index,
        source: identity(message),
        text: Projection.text_of(message.blocks),
        author_text: if(author, do: Projection.text_of(elem(author, 0).blocks), else: "")
      }
    end)
  end

  @doc "在调用方给定历史时点定位本 run 当前作者回合；不能借后续消息追溯授权。"
  def current_turn_position(messages, owner) do
    messages |> authors_for(owner) |> List.last() |> author_position()
  end

  @doc "所有选中来源必须有真实作者归属，且不能属于 checkpoint 当时的当前回合。"
  def validate_turn_coverage(messages, selected, owner) do
    with {:ok, {current_index, _}} <- current_turn_position(messages, owner),
         {:ok, turns} <- turn_positions(messages, selected) do
      if Enum.any?(turns, &(elem(&1, 0) == current_index)),
        do: {:error, :checkpoint_current_turn_protected},
        else: :ok
    end
  end

  def turn_positions(messages, selected) do
    Enum.reduce_while(selected, {:ok, []}, fn %{message: message, index: index}, {:ok, turns} ->
      case messages |> author_for(message, index) |> author_position() do
        {:ok, turn} -> {:cont, {:ok, [turn | turns]}}
        {:error, _} = error -> {:halt, error}
      end
    end)
  end

  defp author_position({%{source_refs: [ref]} = author, index}) do
    id = field(ref, :ref)

    if identity(author) != nil and is_binary(id) and String.trim(id) != "",
      do: {:ok, {index, id}},
      else: {:error, :checkpoint_turn_range_unavailable}
  end

  defp author_position(_author), do: {:error, :checkpoint_turn_range_unavailable}

  def source_ref(reference),
    do: %{ref: "session_message:#{reference.run_id}:#{reference.run_sequence}", version: 1}

  defp same_evidence?(message, reference) do
    actual = Map.take(selector(message), @selector_keys)
    RequestIR.json_value(actual) == RequestIR.json_value(reference)
  end

  defp author_for(messages, message, index) do
    authors = authors_for(messages, get_in(message, [:canonical_ref, :run_id]))
    preceding = Enum.filter(authors, &(elem(&1, 1) < index))
    List.last(preceding) || if(message.role == "scope_update", do: List.first(authors))
  end

  defp authors_for(messages, owner) when is_binary(owner) and owner != "" do
    messages
    |> Enum.with_index()
    |> Enum.filter(fn {candidate, _} ->
      candidate.role == "user" and candidate.provenance == "author" and
        get_in(candidate, [:canonical_ref, :run_id]) == owner
    end)
  end

  defp authors_for(_messages, _owner), do: []

  defp field(map, key) when is_map(map), do: Map.get(map, key) || Map.get(map, to_string(key))
  defp field(_map, _key), do: nil
end
