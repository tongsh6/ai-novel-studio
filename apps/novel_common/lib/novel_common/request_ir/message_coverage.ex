defmodule NovelCommon.RequestIR.MessageCoverage do
  @moduledoc """
  R03 以现有 run/message 坐标解析消息覆盖；只消费可信会话视图，不读库。

  canonical_ref 是派生定位事实，持久化前移除。选择器只引用旧 Scope 或已结束
  run 的纯模型讨论；作者、当前范围、活动 run 和工具组由各自契约保护。
  """
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelCommon.RequestIR.Scope

  @selector_keys ~w(run_id run_sequence role source_refs versions)a
  @identity_keys ~w(run_id workspace_id work_id session_id parent_turn_ref)a
  @execution_ref_keys ~w(provider_call_ref provider_run_ref)a
  @response_result_keys ~w(type status reason_code detail retryable budget_after)a

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

  def eligible?(%{message: message, index: index}, messages, owner) do
    discussion?(message, messages, index) and
      get_in(message, [:canonical_ref, :run_status]) == "completed" and
      get_in(message, [:canonical_ref, :run_id]) != owner
  end

  def discussion?(%{role: "assistant", provenance: "model", blocks: [_ | _] = blocks}),
    do: Enum.all?(blocks, &match?(%{type: "text", text: text} when is_binary(text), &1))

  def discussion?(_message), do: false

  def discussion?(message, messages, index),
    do: discussion?(message) and response_validation(messages, index) == {:ok, nil}

  @doc "无工具响应拒收的唯一绑定判据；缺回执保持未知，坏回执明确失败。"
  def response_validation(messages, index, run \\ %{})

  def response_validation(messages, index, run)
      when is_list(messages) and is_integer(index) and index >= 0 do
    with true <- index < length(messages),
         :ok <- validate_response_validations(messages, run) do
      case Enum.at(messages, index + 1) do
        %{role: "application_notice", blocks: [%{type: "validation_result"} = block]} ->
          {:ok, block}

        _ ->
          {:ok, nil}
      end
    else
      false -> {:error, :response_validation_source_missing}
      error -> error
    end
  end

  def response_validation(_messages, _index, _run),
    do: {:error, :response_validation_source_missing}

  @doc "仅检测作者槽位是否存在；不据此授予作者来源资格。"
  def author_input_present?(messages),
    do: Enum.any?(messages, &(&1.role == "user" or &1.provenance == "author"))

  @doc "当前可执行历史仅接受结构化拒收；旧自由文字仍可原样审计。"
  def validate_execution_history(messages) do
    valid? =
      Enum.all?(messages, fn
        %{role: "application_notice"} = notice -> valid_response_notice?(notice)
        _ -> true
      end)

    if valid?, do: :ok, else: {:error, :retired_application_notice}
  end

  @doc "RequestIR 与原文回查共用结构回执校验，不从自由文字推断接收状态。"
  def validate_response_validations(messages, run) do
    messages
    |> Enum.with_index()
    |> Enum.reduce_while(:ok, fn {message, index}, :ok ->
      validation =
        if response_result?(message),
          do: bind_response_validation(messages, index, run),
          else: :ok

      case validation do
        :ok -> {:cont, :ok}
        error -> {:halt, error}
      end
    end)
  end

  @doc "收集现有执行引用；保持缺失未知及原字段错误，不修剪或制造身份。"
  def execution_refs(map) when is_map(map) do
    Enum.reduce_while(@execution_ref_keys, {:ok, %{}}, fn key, {:ok, refs} ->
      ref = Map.get(map, key, Map.get(map, to_string(key)))

      cond do
        is_nil(ref) -> {:cont, {:ok, refs}}
        valid_identity?(ref) -> {:cont, {:ok, Map.put(refs, key, ref)}}
        true -> {:halt, {:error, {:invalid_execution_ref, key}}}
      end
    end)
  end

  defp bind_response_validation(_messages, 0, _run),
    do: {:error, :response_validation_source_missing}

  defp bind_response_validation(messages, index, run) do
    source = Enum.at(messages, index - 1)
    notice = Enum.at(messages, index)

    with true <- pure_response?(source) and valid_response_notice?(notice),
         {:ok, refs} <- execution_refs(source),
         true <- map_size(refs) == 2,
         {:ok, ^refs} <- execution_refs(notice),
         true <- unique_response_refs?(messages, refs),
         true <- current_tail?(messages, index - 1),
         {:ok, owner} <- response_owner(source, run),
         {:ok, ^owner} <- response_owner(notice, run),
         true <- follows_source?(source, notice),
         true <- response_context?(messages, index - 1, owner, source, run) do
      :ok
    else
      {:error, _} = error -> error
      _ -> {:error, :invalid_response_validation_binding}
    end
  end

  defp pure_response?(%{role: "assistant", provenance: "model", blocks: blocks})
       when is_list(blocks) do
    Enum.all?(
      blocks,
      &match?(%{type: "text", text: text} when is_binary(text) and text != "", &1)
    )
  end

  defp pure_response?(_message), do: false

  defp response_result?(message) do
    Enum.any?(Map.get(message, :blocks, []), fn block ->
      Map.get(block, :type) == "validation_result" and
        (message.role != "tool" or not valid_identity?(Map.get(block, :call_id)))
    end)
  end

  defp valid_response_notice?(
         %{
           role: "application_notice",
           provenance: "application",
           blocks: [%{type: "validation_result", status: "failed", reason_code: reason} = block]
         } = notice
       ) do
    Enum.sort(Map.keys(block)) == Enum.sort(@response_result_keys) and
      valid_identity?(reason) and is_map(block.detail) and
      valid_identity?(field(block.detail, :message)) and
      (is_nil(block.retryable) or is_boolean(block.retryable)) and
      (is_nil(block.budget_after) or is_map(block.budget_after)) and
      not Map.has_key?(notice, :call_id)
  end

  defp valid_response_notice?(_message), do: false

  defp unique_response_refs?(messages, refs) do
    Enum.all?(@execution_ref_keys, fn key ->
      value = Map.fetch!(refs, key)

      responses =
        Enum.count(messages, &(Map.get(&1, :role) == "assistant" and field(&1, key) == value))

      receipts =
        Enum.count(messages, fn message ->
          message.role == "application_notice" and response_result?(message) and
            field(message, key) == value
        end)

      responses == 1 and receipts == 1
    end)
  end

  # 当前 IR 的新响应可以位于已注解历史之后；缺坐标不能借外 run 身份。
  defp current_tail?(messages, source_index) do
    messages
    |> Enum.drop(source_index)
    |> Enum.reduce_while(false, fn message, unannotated ->
      if Map.has_key?(message, :canonical_ref) and unannotated,
        do: {:halt, :invalid_tail},
        else: {:cont, unannotated or not Map.has_key?(message, :canonical_ref)}
    end)
    |> Kernel.!=(:invalid_tail)
  end

  defp response_owner(message, run) do
    case Map.fetch(message, :canonical_ref) do
      {:ok, ref} when is_map(ref) ->
        if Enum.all?(@identity_keys, &valid_identity?(field(ref, &1))) and
             is_integer(field(ref, :run_sequence)) and field(ref, :run_sequence) > 0,
           do: {:ok, Map.new(@identity_keys, &{&1, field(ref, &1)})},
           else: {:error, :response_validation_owner_invalid}

      :error ->
        if valid_identity?(field(run, :run_id)),
          do: {:ok, Map.new(@identity_keys, &{&1, field(run, &1)})},
          else: {:error, :response_validation_owner_missing}

      _ ->
        {:error, :response_validation_owner_invalid}
    end
  end

  defp follows_source?(source, notice) do
    case {Map.get(source, :canonical_ref), Map.get(notice, :canonical_ref)} do
      {%{run_sequence: first}, %{run_sequence: second}} -> second == first + 1
      _ -> true
    end
  end

  defp response_context?(messages, source_index, owner, source, run) do
    author =
      messages
      |> Enum.take(source_index)
      |> Enum.filter(fn message ->
        message.role == "user" and message.provenance == "author" and
          response_owner(message, run) == {:ok, owner}
      end)
      |> List.last()

    case author do
      %{source_refs: [ref]} ->
        valid_identity?(field(ref, :ref)) and earlier_in_run?(author, source)

      nil ->
        application_task?(messages, source_index, owner, source, run)

      _ ->
        false
    end
  end

  defp application_task?(messages, source_index, owner, source, run) do
    prior = Enum.take(messages, source_index)
    indexed = Enum.with_index(prior)

    with false <- author_input_present?(prior),
         {%{provenance: "application", blocks: [%{type: "scope"} = block]} = scope, scope_index} <-
           indexed
           |> Enum.reverse()
           |> Enum.find(fn {message, _} ->
             message.role == "scope_update" and response_owner(message, run) == {:ok, owner}
           end),
         {%{provenance: "application", blocks: [_ | _]} = base, base_index} <-
           indexed
           |> Enum.reverse()
           |> Enum.find(fn {message, _} ->
             message.role == "application_base" and response_owner(message, run) == {:ok, owner}
           end),
         true <- base_index < scope_index,
         true <-
           Enum.all?(
             base.blocks,
             &match?(%{type: "text", text: text} when is_binary(text) and text != "", &1)
           ),
         true <- valid_identity?(Projection.text_of(base.blocks)),
         true <- task_metadata?(base) and task_metadata?(scope),
         :ok <- Scope.validate_block(block),
         true <- field(block.content, :work_id) == owner.work_id,
         true <- earlier_in_run?(base, scope) and earlier_in_run?(scope, source),
         true <- current_tail?(messages, base_index) do
      true
    else
      _ -> false
    end
  end

  defp task_metadata?(%{source_refs: refs, versions: versions} = message)
       when is_list(refs) and is_map(versions) do
    Enum.all?(refs, &is_map/1) and
      Scope.validate_owner(message) == :ok and
      Scope.validate_scope_metadata(message, %{base_refs: Map.get(message, :base_refs, [])}) ==
        :ok
  end

  defp task_metadata?(_message), do: false

  defp earlier_in_run?(author, source) do
    case {Map.get(author, :canonical_ref), Map.get(source, :canonical_ref)} do
      {%{run_sequence: first}, %{run_sequence: second}} -> first < second
      _ -> true
    end
  end

  defp valid_identity?(value) when is_binary(value),
    do: String.valid?(value) and String.trim(value) != ""

  defp valid_identity?(_value), do: false

  def discussion_sources(messages, selected) do
    selected
    |> Enum.filter(&discussion?(&1.message, messages, &1.index))
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
