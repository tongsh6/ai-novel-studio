defmodule NovelApplication.PlotOutlineChapterRef do
  @moduledoc """
  Validate outline chapter bindings against the current work's trusted index.

  A missing index cannot authorize an existing chapter. Validation runs inside
  the original native exchange, before the candidate can be published.
  """

  alias NovelCommon.Contracts.CreativeItemAttributes
  alias NovelCommon.Contracts.ToolResult

  @spec validate_result(ToolResult.t(), [map()] | nil) :: :ok | {:error, map()}
  def validate_result(
        %ToolResult{tool_name: "plot_outline", status: :succeeded, output: %{items: items}},
        known_chapters
      ) do
    case validate_work_scope(items, known_chapters) do
      :ok ->
        :ok

      {:error, {code, ref}} ->
        {:error,
         %{
           reason_code: Atom.to_string(code),
           detail: %{chapter_ref: ref},
           message: rejection_message(code, ref)
         }}
    end
  end

  def validate_result(_result, _known_chapters), do: :ok

  @doc "Validate existing chapter refs; nil means the work index was unavailable."
  @spec validate_work_scope([map()], [map()] | nil) :: :ok | {:error, {atom(), term()}}
  def validate_work_scope(items, known_chapters) when is_list(items) do
    refs = chapter_refs(items)

    cond do
      refs == [] ->
        :ok

      Enum.any?(refs, &(not CreativeItemAttributes.valid_chapter_ref?(&1))) ->
        {:error,
         {:invalid_chapter_ref,
          Enum.find(refs, &(not CreativeItemAttributes.valid_chapter_ref?(&1)))}}

      length(refs) != length(Enum.uniq(refs)) ->
        {:error, {:duplicate_chapter_ref, List.first(refs -- Enum.uniq(refs))}}

      true ->
        validate_against_work(refs, known_chapters)
    end
  end

  def validate_work_scope(_items, _known_chapters), do: :ok

  defp validate_against_work(refs, known_chapters) when is_list(known_chapters) do
    known =
      known_chapters
      |> Enum.filter(&is_map/1)
      |> Enum.map(&Map.get(&1, :id))
      |> Enum.filter(&is_binary/1)
      |> MapSet.new()

    case Enum.find(refs, &(not MapSet.member?(known, chapter_id(&1)))) do
      nil -> :ok
      ref -> {:error, {:cross_work_chapter_ref, ref}}
    end
  end

  defp validate_against_work([ref | _], _unavailable),
    do: {:error, {:chapter_index_unavailable, ref}}

  defp chapter_refs(items) do
    items
    |> Enum.map(&Map.get(&1, :chapter_ref, Map.get(&1, "chapter_ref")))
    |> Enum.reject(&(&1 in [nil, ""]))
  end

  defp chapter_id("chapter:" <> id), do: id

  defp rejection_message(:cross_work_chapter_ref, ref),
    do: "plot_outline chapter_ref 不属于当前作品索引，已拒绝该候选：#{ref}"

  defp rejection_message(:chapter_index_unavailable, ref),
    do: "当前作品章节索引不可用，无法核验 chapter_ref，已拒绝该候选：#{ref}"

  defp rejection_message(:invalid_chapter_ref, ref),
    do: "plot_outline chapter_ref 必须形如 chapter:<uuid>：#{inspect(ref)}"

  defp rejection_message(:duplicate_chapter_ref, ref),
    do: "plot_outline 同一章不能被多个条目重复绑定 chapter_ref：#{ref}"
end
