defmodule NovelApplication.ExportService do
  @moduledoc """
  全书导出用例（P1-export-minimum，docs/product/novel-output-milestones.md §7 #5）。

  从正式作品事实导出完整 Markdown：复用阅读投影的单一作品事实源
  （`ReadingProjectionService.toc/chapter_content`，AU-08 口径——只含已采纳卷/章
  结构与已采纳正文），经 `NovelDomain.ExportDocument` 纯函数渲染后写入导出目录，
  返回文件路径与可验证的目录/字数元信息。未采纳草稿不在该口径内，天然不进导出。

  导出目录：
  - 优先使用调用方通过 `:export_dir` 指定的目录（Tauri 桌面端由用户通过文件对话框选择）；
  - 未指定时回退到 `config :novel_application, :export_dir`（test 环境指向项目 tmp），
    默认 `~/Documents/AI Novel Studio`。

  进度回调：调用方可传入 `:on_progress`（`fn progress, step -> ... end`），在读取结构、
  读取章节、渲染文档、写入文件等阶段收到增量进度，用于前端进度弹窗展示。
  """

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelApplication.ProseQualityValidators
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

  @type progress_callback :: (non_neg_integer(), String.t() -> any())

  @spec export(String.t(), keyword()) :: {:ok, export_result()} | {:error, term()}
  def export(work_id, opts \\ []) when is_binary(work_id) and is_list(opts) do
    toc = ReadingProjectionService.toc(work_id)
    chapters = Enum.flat_map(toc.volumes, & &1.chapters)

    if chapters == [] do
      {:error, :nothing_to_export}
    else
      {:ok, do_export(work_id, toc, chapters, opts)}
    end
  end

  defp do_export(work_id, toc, chapters, opts) do
    export_dir = Keyword.get(opts, :export_dir)
    on_progress = Keyword.get(opts, :on_progress, fn _progress, _step -> :ok end)

    work_title = work_title(work_id)
    exported_at = DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601()

    on_progress.(25, "正在读取章节内容")
    scenes_by_chapter = scenes_by_chapter(work_id, chapters)

    # B9（M2 Q2/Q3 修向）：导出前元泄漏机器检查——正文 body 里的章号自指/工作流程词
    # 与生成期 validator 同一 pattern 源；只留痕不拦导出（导出的是已采纳事实，
    # 拦截点在生成与采纳，导出检查是收口审计信号）。
    leak_hits =
      scenes_by_chapter
      |> Map.values()
      |> List.flatten()
      |> Enum.flat_map(&ProseQualityValidators.meta_leak_hits(&1.content || ""))

    LogEmit.emit(:export, :leak_check, :done, %{
      work_id: work_id,
      hit_count: length(leak_hits),
      samples: leak_hits |> Enum.uniq() |> Enum.take(5)
    })

    on_progress.(60, "正在渲染全书 Markdown")

    markdown =
      ExportDocument.render(work_title, toc.volumes, scenes_by_chapter, %{
        exported_at: exported_at,
        total_word_count: toc.total_word_count
      })

    on_progress.(80, "正在写入文件")
    path = write_export!(work_title, markdown, export_dir)

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

  defp write_export!(work_title, markdown, export_dir) do
    dir = export_dir || export_dir_default()
    File.mkdir_p!(dir)
    path = Path.join(dir, ExportDocument.filename(work_title) <> ".md")
    File.write!(path, markdown)
    Path.expand(path)
  end

  defp export_dir_default do
    Application.get_env(:novel_application, :export_dir) ||
      Path.join(System.user_home!(), "Documents/AI Novel Studio")
  end
end
