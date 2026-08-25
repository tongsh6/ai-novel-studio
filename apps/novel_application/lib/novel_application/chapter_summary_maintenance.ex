defmodule NovelApplication.ChapterSummaryMaintenance do
  @moduledoc """
  章摘要 maintenance 用例（VS-00C CP2.1 / contract §5.3）。

  正文采纳完成后产出该章的写后内容压缩摘要：
  旧 ACCEPTED 摘要 → SUPERSEDED，新 tentative → 自动 ACCEPTED（契约 §6.2 采纳档位=自动采纳）。

  **失败容忍**是硬不变量：生成器异常、持久化失败、任何 raise 都降级为
  `{:degraded, reason}` + `chapter_summary_maintenance.run.error` 业务日志（ADR-0018），
  **绝不抛错、绝不阻断正文采纳主链**（契约 §5.3）。

  生成器与仓储均为注入端口（house style：与 `adoption_writer` 同型），
  领域状态机 `NovelDomain.ChapterSummary` 是转换 SSOT，本用例只编排。
  """

  require NovelCommon.LogEmit

  alias NovelCommon.LogEmit
  alias NovelDomain.ChapterSummary

  @typedoc "maintenance 输入：本次采纳的章锚点与正文。"
  @type input :: %{
          required(:work_id) => String.t(),
          required(:chapter_id) => String.t(),
          required(:prose_text) => String.t(),
          optional(:chapter_title) => String.t() | nil,
          optional(:source_ref) => String.t() | nil,
          optional(:revision_base) => String.t() | nil
        }

  @typedoc "生成器：拿到正文，产出四栏 map（推荐）或整段文本。"
  @type generator :: (input() -> {:ok, map() | String.t()} | {:error, term()})

  @typedoc "仓储端口（注入持久化时由 NovelApplication 提供，对应 ChapterSummaryRepo）。"
  @type repo :: %{
          required(:supersede) => (String.t(), String.t() -> {:ok, non_neg_integer()}),
          required(:insert) => (map() -> {:ok, term()} | {:error, term()}),
          required(:update_status) => (term(), String.t() -> {:ok, term()} | {:error, term()})
        }

  @doc """
  产章摘要：supersede 旧 ACCEPTED → 生成 tentative（四栏）→ insert → 自动 accept。

  返回 `{:ok, ChapterSummary.t()}`（已 ACCEPTED）或 `{:degraded, reason}`。任何路径都不抛错。
  """
  @spec run(input(), generator(), repo()) :: {:ok, ChapterSummary.t()} | {:degraded, term()}
  def run(input, generator, repo) when is_function(generator, 1) and is_map(repo) do
    work_id = Map.get(input, :work_id)
    chapter_id = Map.get(input, :chapter_id)

    try do
      do_run(input, generator, repo, work_id, chapter_id)
    rescue
      error -> degrade(work_id, chapter_id, error)
    end
  end

  defp do_run(input, generator, repo, work_id, chapter_id) do
    with :ok <- validate_anchor(work_id, chapter_id),
         {:ok, summary_text} <- generate(generator, input),
         {:ok, _superseded} <- repo.supersede.(work_id, chapter_id),
         tentative <- build_tentative(input, summary_text),
         {:ok, persisted} <- repo.insert.(to_attrs(tentative)),
         {:ok, accepted} <- ChapterSummary.accept(tentative),
         {:ok, _updated} <- repo.update_status.(persisted, accepted.status) do
      LogEmit.emit(:chapter_summary_maintenance, :run, :done, %{
        work_id: work_id,
        chapter_id: chapter_id,
        status: accepted.status,
        four_column: ChapterSummary.four_column?(summary_text)
      })

      {:ok, accepted}
    else
      {:error, reason} -> degrade(work_id, chapter_id, reason)
    end
  end

  defp validate_anchor(work_id, chapter_id)
       when is_binary(work_id) and is_binary(chapter_id),
       do: :ok

  defp validate_anchor(_work_id, _chapter_id), do: {:error, :missing_chapter_anchor}

  # 生成器既可返回四栏 map（推荐，render 保证四栏齐全），也可返回整段文本（兜底）。
  defp generate(generator, input) do
    case generator.(input) do
      {:ok, sections} when is_map(sections) ->
        {:ok, ChapterSummary.render_sections(sections)}

      {:ok, text} when is_binary(text) ->
        if ChapterSummary.four_column?(text) do
          {:ok, text}
        else
          {:ok, ChapterSummary.render_sections(%{plot: text})}
        end

      {:error, reason} ->
        {:error, reason}

      other ->
        {:error, {:bad_generator_output, other}}
    end
  end

  defp build_tentative(input, summary_text) do
    ChapterSummary.new(%{
      work_id: Map.get(input, :work_id),
      chapter_id: Map.get(input, :chapter_id),
      summary_text: summary_text,
      source_ref: Map.get(input, :source_ref),
      revision_base: Map.get(input, :revision_base)
    })
  end

  defp to_attrs(%ChapterSummary{} = summary) do
    %{
      work_id: summary.work_id,
      chapter_id: summary.chapter_id,
      status: summary.status,
      summary_text: summary.summary_text,
      source_ref: summary.source_ref,
      revision_base: summary.revision_base
    }
  end

  defp degrade(work_id, chapter_id, reason) do
    LogEmit.emit(:chapter_summary_maintenance, :run, :error, %{
      work_id: work_id,
      chapter_id: chapter_id,
      # D3 排查判例：此前所有失败一律标 :persistence_failed（provider 错也算），
      # 直接误导归因——按失败层诚实分类。
      reason_code: degrade_reason_code(reason),
      outcome_detail: inspect(reason)
    })

    {:degraded, reason}
  end

  defp degrade_reason_code(%{type: :provider_error}), do: :generation_failed
  defp degrade_reason_code(%{type: :timeout}), do: :generation_failed
  defp degrade_reason_code(:empty_prose), do: :empty_prose
  defp degrade_reason_code(_reason), do: :persistence_failed
end
