defmodule NovelDomain.ProseFormatting do
  @moduledoc "ADR-0029：只改变换行的分段计划，所有非换行字节来自原文。"

  @newlines ~r/\r\n|\r|\n/u
  @sentence_end ~r/[。！？!?；;][」』”’"）】]*/u

  def source_hash(text), do: :crypto.hash(:sha256, text) |> Base.encode16(case: :lower)

  def non_newline_text(text), do: Regex.replace(@newlines, text, "")

  def view(text) when is_binary(text) do
    {plain, existing} = decompose(text)
    hash = source_hash(text)

    sentence_offsets =
      @sentence_end
      |> Regex.scan(plain, return: :index)
      |> Enum.map(fn [{start, size}] -> start + size end)
      |> Enum.filter(&(&1 > 0 and &1 < byte_size(plain)))

    boundaries =
      (sentence_offsets ++ Map.keys(existing))
      |> Enum.uniq()
      |> Enum.sort()
      |> Enum.map(fn offset ->
        prefix = binary_part(plain, 0, offset)
        suffix = binary_part(plain, offset, byte_size(plain) - offset)

        %{
          boundary_id:
            "break_#{offset}_#{String.slice(source_hash(hash <> ":#{offset}"), 0, 12)}",
          offset: offset,
          before: String.slice(prefix, -24, 24),
          after: String.slice(suffix, 0, 24),
          lines: length(Regex.scan(@newlines, Map.get(existing, offset, "")))
        }
      end)

    %{source_hash: hash, source: text, boundaries: boundaries}
  end

  def apply_plan(text, expected_hash, changes) when is_binary(text) and is_list(changes) do
    with true <- source_hash(text) == expected_hash,
         {:ok, normalized} <- validate_changes(changes, view(text).boundaries) do
      {plain, existing} = decompose(text)

      breaks =
        Enum.reduce(normalized, existing, fn change, acc ->
          Map.put(acc, change.offset, String.duplicate("\n", change.lines))
        end)

      result = render(plain, breaks)

      cond do
        result == text ->
          {:error, :no_formatting_changes}

        non_newline_text(result) != plain ->
          {:error, :format_only_violation}

        true ->
          {:ok,
           %{
             text: result,
             source_hash: expected_hash,
             result_hash: source_hash(result),
             non_newline_hash: source_hash(plain),
             changed_boundaries:
               Enum.filter(normalized, fn change ->
                 Map.get(existing, change.offset, "") != String.duplicate("\n", change.lines)
               end)
           }}
      end
    else
      false -> {:error, :stale_base_version}
      error -> error
    end
  end

  def apply_plan(_text, _hash, _changes), do: {:error, :invalid_formatting_plan}

  defp validate_changes(changes, boundaries) do
    by_id = Map.new(boundaries, &{&1.boundary_id, &1})

    changes
    |> Enum.reduce_while({:ok, []}, fn change, {:ok, acc} ->
      with true <- is_map(change) and map_size(change) == 2,
           id when is_binary(id) <- field(change, :boundary_id),
           lines when lines in [0, 1, 2] <- field(change, :lines),
           %{offset: offset} <- Map.get(by_id, id),
           false <- Enum.any?(acc, &(&1.boundary_id == id)) do
        {:cont, {:ok, [%{boundary_id: id, offset: offset, lines: lines} | acc]}}
      else
        _ -> {:halt, {:error, :invalid_formatting_plan}}
      end
    end)
    |> case do
      {:ok, items} -> {:ok, Enum.reverse(items)}
      error -> error
    end
  end

  defp decompose(text) do
    {parts, breaks, _offset} =
      @newlines
      |> Regex.split(text, include_captures: true, trim: false)
      |> Enum.reduce({[], %{}, 0}, fn part, {parts, breaks, offset} ->
        if part in ["\r\n", "\r", "\n"] do
          {parts, Map.update(breaks, offset, part, &(&1 <> part)), offset}
        else
          {[part | parts], breaks, offset + byte_size(part)}
        end
      end)

    {parts |> Enum.reverse() |> Enum.join(), breaks}
  end

  defp render(plain, breaks) do
    {pieces, offset} =
      breaks
      |> Enum.sort_by(&elem(&1, 0))
      |> Enum.map_reduce(0, fn {position, newline}, cursor ->
        {binary_part(plain, cursor, position - cursor) <> newline, position}
      end)

    Enum.join(pieces) <> binary_part(plain, offset, byte_size(plain) - offset)
  end

  defp field(map, key), do: Map.get(map, key, Map.get(map, Atom.to_string(key)))
end
