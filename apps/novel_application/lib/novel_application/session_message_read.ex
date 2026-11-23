defmodule NovelApplication.SessionMessageRead do
  @moduledoc """
  当前可信会话的原文读取适配器。

  模型只提供已知消息的 run/段内序号与 Unicode grapheme offset；作品和会话
  作用域由调用方提供。持久身份、版本和顺序统一由 AuthoringSessionLog 校验，
  本模块只选择作者原话或纯模型答复并分页，不读取摘要或改写 canonical 内容。
  """

  alias NovelApplication.AuthoringTranscript.Codec
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.MessageCoverage
  alias NovelPersistence.{AuthoringSessionLog, WorkSessionRepo}

  @page_graphemes 6000

  @spec run(String.t(), String.t(), String.t()) :: {:ok, map()} | {:error, term()}
  def run(work_id, query, session_id) when is_binary(work_id) and is_binary(session_id) do
    with {:ok, locator} <- parse_query(query),
         :ok <- validate_session(work_id, session_id),
         {:ok, %{rows: rows}} <- AuthoringSessionLog.fetch_session(session_id),
         {:ok, row, index} <- find_message(rows, work_id, session_id, locator),
         {:ok, validation} <- response_validation(rows, index),
         {:ok, text} <- visible_text(row),
         :ok <- validate_offset(locator.offset, text) do
      {:ok, observation(row, text, query, locator.offset, validation)}
    end
  end

  def run(_work_id, _query, _session_id), do: {:error, :session_message_session_not_found}

  @doc "原文读取与续读门禁共用的严格消息坐标解析；不访问持久层。"
  @spec parse_query(term()) :: {:ok, map()} | {:error, :invalid_session_message_query}
  def parse_query(query) when is_binary(query) do
    case Jason.decode(query) do
      {:ok, %{"run_id" => run_id, "run_sequence" => sequence, "offset" => offset} = decoded}
      when map_size(decoded) == 3 and is_binary(run_id) and byte_size(run_id) > 0 and
             is_integer(sequence) and sequence > 0 and is_integer(offset) and offset >= 0 ->
        {:ok, %{run_id: run_id, run_sequence: sequence, offset: offset}}

      _ ->
        {:error, :invalid_session_message_query}
    end
  end

  def parse_query(_query), do: {:error, :invalid_session_message_query}

  defp validate_session(work_id, session_id) do
    case WorkSessionRepo.get_by_work(work_id, session_id) do
      nil -> {:error, :session_message_session_not_found}
      _session -> :ok
    end
  end

  defp find_message(rows, work_id, session_id, locator) do
    case Enum.find(
           Enum.with_index(rows),
           fn {row, _index} ->
             row.run_id == locator.run_id and row.run_sequence == locator.run_sequence
           end
         ) do
      nil ->
        {:error, :session_message_not_found}

      {%{work_id: ^work_id, session_id: ^session_id} = row, index} ->
        {:ok, row, index}

      _row ->
        {:error, :session_message_scope_mismatch}
    end
  end

  # 坐标和顺序来自同一 fetch_session 的原行；共同 binding owner 核拒收身份，
  # 不从 run 状态、通知文字或当前页面反推响应是否曾经发布。
  defp response_validation(rows, index) do
    messages =
      rows
      |> Enum.map(& &1.message)
      |> Codec.normalize_messages()
      |> Enum.zip(rows)
      |> Enum.map(fn {message, row} ->
        owner =
          Map.take(row, [
            :run_id,
            :run_sequence,
            :workspace_id,
            :work_id,
            :session_id,
            :parent_turn_ref,
            :run_status
          ])

        Map.put(message, :canonical_ref, owner)
      end)

    MessageCoverage.response_validation(messages, index)
  end

  defp visible_text(%{
         role: role,
         message: %{"role" => role, "provenance" => provenance, "blocks" => blocks}
       })
       when (role == "user" and provenance == "author") or
              (role == "assistant" and provenance == "model") do
    if is_list(blocks) and blocks != [] and
         Enum.all?(blocks, &match?(%{"type" => "text", "text" => text} when is_binary(text), &1)) do
      {:ok, Enum.map_join(blocks, "", &Map.fetch!(&1, "text"))}
    else
      {:error, :session_message_not_readable}
    end
  end

  defp visible_text(_row), do: {:error, :session_message_not_readable}

  defp validate_offset(offset, text) do
    if offset <= String.length(text),
      do: :ok,
      else: {:error, :session_message_offset_out_of_range}
  end

  defp observation(row, text, query, offset, validation) do
    page = String.slice(text, offset, @page_graphemes)
    total = String.length(text)
    stop = offset + String.length(page)
    byte_start = text |> String.slice(0, offset) |> byte_size()
    %{ref: source_ref, version: source_version} = MessageCoverage.source_ref(row)
    omissions = omissions(offset, stop, total)

    %{
      tool: "session_message_read",
      query: query,
      summary: page,
      refs: [source_ref],
      versions: %{source_ref => source_version},
      source_hash: :crypto.hash(:sha256, text) |> Base.encode16(case: :lower),
      outcome: if(omissions == [], do: :observed, else: :partial),
      coverage: %{
        offset_unit: "unicode_grapheme",
        range: %{start: offset, end_exclusive: stop},
        total_graphemes: total,
        byte_range: %{start: byte_start, end_exclusive: byte_start + byte_size(page)},
        total_bytes: byte_size(text)
      },
      omissions: omissions,
      next_offset: if(stop < total, do: stop, else: nil),
      facts: %{
        run_id: row.run_id,
        run_sequence: row.run_sequence,
        session_sequence: row.sequence,
        parent_turn_ref: row.parent_turn_ref,
        run_status: row.run_status,
        role: row.role,
        provenance: row.message["provenance"],
        source_refs: row.message["source_refs"] || [],
        workspace_id: row.workspace_id,
        work_id: row.work_id,
        session_id: row.session_id,
        format_version: row.format_version
      },
      activity_summary: "已回查会话原文。"
    }
    |> put_validation_result(validation)
  end

  defp put_validation_result(observation, nil), do: observation

  defp put_validation_result(observation, validation),
    do: put_in(observation, [:facts, :validation_result], RequestIR.json_value(validation))

  defp omissions(offset, stop, total) do
    prefix =
      if offset > 0,
        do: ["原文 Unicode grapheme 区间 [0, #{offset}) 未包含在本页；可用 offset=0 回查。"],
        else: []

    suffix =
      if stop < total,
        do: ["原文 Unicode grapheme 区间 [#{stop}, #{total}) 未包含在本页；按 next_offset 续读。"],
        else: []

    prefix ++ suffix
  end
end
