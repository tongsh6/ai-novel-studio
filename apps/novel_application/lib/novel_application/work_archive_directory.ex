defmodule NovelApplication.WorkArchiveDirectory do
  @moduledoc """
  档案目录完整条目的纯预算与事实投影。

  只按给定材料预算选择章节或角色条目；真实读取、来源、版本、
  offset、覆盖范围和观察状态仍由 WorkArchiveService 编排。
  """

  @spec page([map()], String.t(), non_neg_integer(), pos_integer()) ::
          {:ok, [map()], map()} | {:error, :archive_directory_entry_too_large}
  def page(items, facet, total, max_chars) do
    Enum.reduce_while(items, [], fn item, page ->
      candidate = [item | page]
      material = directory_material(facet, Enum.reverse(candidate), total)

      cond do
        String.length(Jason.encode!(material)) <= max_chars -> {:cont, candidate}
        page == [] -> {:halt, {:error, :archive_directory_entry_too_large}}
        true -> {:halt, page}
      end
    end)
    |> case do
      {:error, _} = error ->
        error

      page ->
        page = Enum.reverse(page)
        {:ok, page, directory_material(facet, page, total)}
    end
  end

  defp directory_material(facet, page, total) do
    {key, label, unit} =
      case facet do
        "characters" -> {:characters, "角色", "个角色"}
        "chapters" -> {:chapters, "章节", "章"}
      end

    returned = length(page)

    summary =
      if total == 0,
        do: "#{label}目录暂无条目。",
        else: "#{label}目录：本页列出 #{returned} #{unit}，共 #{total} #{unit}；仅提供目录信息。"

    %{
      summary: summary,
      facts: %{
        key => Enum.map(page, &Map.delete(&1, :version)),
        :total_count => total,
        :returned_count => returned
      }
    }
  end
end
