defmodule NovelApplication.PlotOutlineChapterRef do
  @moduledoc """
  B30 CP3-P2：plot_outline 可选 `chapter_ref` 的应用侧机械校验。

  provider/adapter 已保证形状（`chapter:<uuid>`）与重复绑定；本模块补 work 范围校验：
  - 有 ref 的条目必须指向当前作品已有章（用上下文 structured chapters 的 id 集校验）；
  - 上下文没有章节索引时诚实降级为「无法校验」而不静默丢弃 ref；
  - 任何非法/跨作品 → 可解释拒绝，不静默丢 ref 退回 title 新建。
  """

  @ref_regex ~r/^chapter:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

  @doc "校验 items 里的 chapter_ref 是否属于当前 work（structured_chapters 为空时跳过范围校验）。"
  @spec validate_work_scope([map()], [map()]) :: :ok | {:error, {atom(), String.t()}}
  def validate_work_scope(items, structured_chapters) when is_list(items) do
    refs = chapter_refs(items)

    cond do
      refs == [] ->
        :ok

      Enum.any?(refs, &(not valid_ref?(&1))) ->
        {:error, {:invalid_chapter_ref, Enum.find(refs, &(not valid_ref?(&1)))}}

      length(refs) != length(Enum.uniq(refs)) ->
        {:error, {:duplicate_chapter_ref, List.first(refs -- Enum.uniq(refs))}}

      true ->
        validate_against_work(refs, List.wrap(structured_chapters))
    end
  end

  def validate_work_scope(_items, _structured_chapters), do: :ok

  @doc "把 succeeded tool_result 转为可解释失败结果（保留 error_code/message，不静默丢字段）。"
  def failed_result(tool_result, {code, ref}) do
    message =
      case code do
        :cross_work_chapter_ref ->
          "plot_outline chapter_ref 不属于当前作品，已拒绝该候选：#{ref}"

        :invalid_chapter_ref ->
          "plot_outline chapter_ref 形状非法，已拒绝该候选：#{inspect(ref)}"

        :duplicate_chapter_ref ->
          "plot_outline 同一章被多个条目重复绑定 chapter_ref，已拒绝该候选：#{ref}"

        _ ->
          "plot_outline chapter_ref 校验失败，已拒绝该候选：#{ref}"
      end

    %{
      tool_result
      | status: :failed,
        output: %{error_code: Atom.to_string(code), message: message},
        artifact_refs: []
    }
  end

  defp validate_against_work(_refs, []), do: :ok

  defp validate_against_work(refs, structured_chapters) do
    known =
      structured_chapters
      |> Enum.map(&Map.get(&1, :id))
      |> Enum.filter(&is_binary/1)
      |> MapSet.new()

    case Enum.find(refs, &(not MapSet.member?(known, chapter_id(&1)))) do
      nil -> :ok
      ref -> {:error, {:cross_work_chapter_ref, ref}}
    end
  end

  defp chapter_refs(items) do
    items
    |> Enum.map(fn item ->
      Map.get(item, :chapter_ref) || Map.get(item, "chapter_ref")
    end)
    |> Enum.filter(&is_binary/1)
    |> Enum.reject(&(&1 == ""))
  end

  defp valid_ref?(ref), do: Regex.match?(@ref_regex, ref)
  defp chapter_id("chapter:" <> id), do: id
  defp chapter_id(_ref), do: nil
end
