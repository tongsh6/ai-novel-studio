defmodule NovelApplication.ExportService do
  @moduledoc """
  全书导出用例（P1-export-minimum，docs/product/novel-output-milestones.md §7 #5）。

  从正式作品事实导出完整 Markdown：复用阅读投影的单一作品事实源
  （`ReadingProjectionService.toc/chapter_content`，AU-08 口径——只含已采纳卷/章
  结构与已采纳正文），经 `NovelDomain.ExportDocument` 纯函数渲染后写入导出目录，
  返回文件路径与可验证的目录/字数元信息。未采纳草稿不在该口径内，天然不进导出。

  导出目录：`config :novel_application, :export_dir`（test 环境指向项目 tmp），
  默认 `~/Documents/AI Novel Studio`（Tauri 桌面阶段后端 sidecar 与作者同机）。
  """

  alias NovelApplication.ReadingProjectionService
  alias NovelApplication.WorkService
  alias NovelDomain.ExportDocument

  @type export_result :: %{
          path: String.t(),
          format: String.t(),
          work_title: String.t(),
          chapter_count: non_neg_integer(),
          total_word_count: non_neg_integer(),
          exported_at: String.t()
        }

  @spec export(String.t()) :: {:ok, export_result()} | {:error, term()}
  def export(work_id) when is_binary(work_id) do
    toc = ReadingProjectionService.toc(work_id)
    chapters = Enum.flat_map(toc.volumes, & &1.chapters)

    if chapters == [] do
      {:error, :nothing_to_export}
    else
      {:ok, do_export(work_id, toc, chapters)}
    end
  end

  defp do_export(work_id, toc, chapters) do
    work_title = work_title(work_id)
    exported_at = DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601()

    markdown =
      ExportDocument.render(work_title, toc.volumes, scenes_by_chapter(work_id, chapters), %{
        exported_at: exported_at,
        total_word_count: toc.total_word_count
      })

    path = write_export!(work_title, markdown)

    %{
      path: path,
      format: "markdown",
      work_title: work_title,
      chapter_count: length(chapters),
      total_word_count: toc.total_word_count,
      exported_at: exported_at
    }
  end

  defp scenes_by_chapter(work_id, chapters) do
    Map.new(chapters, fn chapter ->
      case ReadingProjectionService.chapter_content(chapter.id, work_id) do
        {:ok, content} -> {chapter.id, content.scenes}
        {:error, _} -> {chapter.id, []}
      end
    end)
  end

  defp work_title(work_id) do
    case WorkService.get(work_id) do
      %{title: title} when is_binary(title) and title != "" -> title
      _ -> "未命名作品"
    end
  end

  defp write_export!(work_title, markdown) do
    dir = export_dir()
    File.mkdir_p!(dir)
    path = Path.join(dir, ExportDocument.filename(work_title) <> ".md")
    File.write!(path, markdown)
    Path.expand(path)
  end

  defp export_dir do
    Application.get_env(:novel_application, :export_dir) ||
      Path.join(System.user_home!(), "Documents/AI Novel Studio")
  end
end
