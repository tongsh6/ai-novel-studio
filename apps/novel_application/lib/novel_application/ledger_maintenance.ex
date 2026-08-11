defmodule NovelApplication.LedgerMaintenance do
  @moduledoc """
  五本账增量维护用例（VS-00F §3.1 `hook.UPDATE_LEDGERS` / ADR-0026）。CP1 只落弧光账。

  正文采纳完成、章摘要维护产出后运行（同一后台任务内串行，输入直接吃摘要文本，
  不回读竞态）。提炼为**确定性**规则（I-L4 模型不参与）：在摘要「人物状态与弧光」
  栏（缺栏降级整段）中匹配已采纳角色名/别名 → 出场记账；随后按停滞规则重算全部
  弧光条目。写入走仓储 upsert（系统发起的自动通过，LOW 风险，I-L2）。

  **失败容忍**同章摘要维护先例：任何异常降级为 `{:degraded, reason}` +
  `ledger.update.error` 业务日志（ADR-0018 module=ledger），绝不阻断采纳主链。
  """

  require NovelCommon.LogEmit

  alias NovelCommon.LogEmit
  alias NovelDomain.ChapterSummary
  alias NovelDomain.LedgerEntry

  @default_stall_threshold 8
  @presence_note_max_chars 120

  @typedoc "维护输入：采纳锚点 + 已产出的章摘要文本（+ 可选采纳正文，前指扫描用）。"
  @type input :: %{
          required(:work_id) => String.t(),
          required(:chapter_id) => String.t(),
          required(:summary_text) => String.t(),
          optional(:prose_text) => String.t() | nil,
          optional(:summary_ref) => String.t() | nil
        }

  @typedoc "端口：角色阵容 / 章序号索引 / 作品档案 / 账面仓储。"
  @type deps :: %{
          required(:roster) => (String.t() -> [map()]),
          required(:chapter_index) => (String.t() -> map()),
          optional(:profile) => (String.t() -> map()),
          required(:repo) => %{
            required(:list) => (String.t() -> [map()]),
            required(:upsert) => (map() -> {:ok, map()} | {:error, term()})
          }
        }

  @spec run(input(), deps()) :: {:ok, map()} | {:degraded, term()}
  def run(input, deps) do
    work_id = Map.get(input, :work_id)
    chapter_id = Map.get(input, :chapter_id)

    try do
      do_run(input, deps, work_id, chapter_id)
    rescue
      error -> degrade(work_id, chapter_id, error)
    end
  end

  defp do_run(input, deps, work_id, chapter_id) do
    with :ok <- validate(input),
         index = deps.chapter_index.(work_id),
         {:ok, current} <- fetch_chapter(index, chapter_id) do
      roster = deps.roster.(work_id)
      text = extraction_text(input.summary_text)
      sighted = Enum.filter(roster, &subject_in_text?(&1, text))
      summary_ref = Map.get(input, :summary_ref) || "chapter_summary:#{chapter_id}"

      sighted_count =
        Enum.count(sighted, fn character ->
          record_sighting(deps.repo, work_id, character, chapter_id, current, text, summary_ref)
        end)

      # 停滞窗口锚定本次采纳章的 seq（写作进度），不是章索引最大 seq——索引里
      # 含未写的计划章，用它会把窗口提前拉爆（增量规划先扩章、后逐章写的形态）。
      stalled_count = recompute_stalls(deps.repo, work_id, current.seq)

      # CP2a：genre 承诺条目播种（首次记账时从作品档案立账，OPEN）+ 正文前指
      # 扫描 → 信息账 LEAKED 条目（计划信息泄进实现态是既成事实的记账，非裁决）。
      ensure_genre_promise(deps, work_id)
      leaked_count = record_future_ref_leaks(deps.repo, work_id, input, chapter_id, current)

      # VS00F 刀④（CP1）：本章正文采纳 → 本章计划信息条目机械置 REVEALED
      # （信息释放是本章计划的组成部分，章写完即按计划释放；「写了但没释放」
      # 属质量门层语义判断，不由账面冒充）。
      reveal_plan_info(deps.repo, work_id, current, summary_ref)

      # CP3：情绪曲线记账（intended=章计划 E20 vs realized=摘要情绪栏，机械判定）
      # + 主线冲突记账（设计角色=推进/高潮/转折章的采纳即主线推进，休眠规则同弧光）。
      emotion_status = record_emotion_curve(deps.repo, work_id, input, chapter_id, current)
      record_main_conflict(deps.repo, work_id, chapter_id, current, summary_ref)

      # CP2b 节拍（产品判据 milestones §4.4 每 10-20 章；简版=章 seq 整除节拍值
      # 触发；显式发起与 profile 化归 CP4）：全量对账并物化报告（TENTATIVE，
      # 作者裁决）。失败容忍由 reconcile 端口内部日志承担，不阻断记账。
      maybe_reconcile(deps, work_id, current.seq)

      LogEmit.emit(:ledger, :update, :done, %{
        work_id: work_id,
        chapter_id: chapter_id,
        ledger: "arc",
        sighted: sighted_count,
        stalled: stalled_count,
        leaked: leaked_count,
        emotion: emotion_status,
        roster: length(roster)
      })

      {:ok,
       %{
         sighted: sighted_count,
         stalled: stalled_count,
         leaked: leaked_count,
         emotion: emotion_status
       }}
    else
      {:error, reason} -> degrade(work_id, chapter_id, reason)
    end
  end

  defp validate(%{work_id: work_id, chapter_id: chapter_id, summary_text: text})
       when is_binary(work_id) and work_id != "" and is_binary(chapter_id) and
              chapter_id != "" and is_binary(text) and text != "",
       do: :ok

  defp validate(_input), do: {:error, :missing_ledger_maintenance_input}

  defp fetch_chapter(index, chapter_id) do
    case Map.get(index, chapter_id) do
      %{seq: seq} = chapter when is_integer(seq) -> {:ok, chapter}
      _ -> {:error, :chapter_not_in_index}
    end
  end

  # 提炼文本：优先「人物状态与弧光」栏；缺栏降级「情节推进」栏；再降整段。
  defp extraction_text(summary_text) do
    sections = ChapterSummary.parse_sections(summary_text)
    Map.get(sections, :characters) || Map.get(sections, :plot) || summary_text
  end

  defp subject_in_text?(character, text) do
    names = [character[:name] | character[:aliases] || []]

    Enum.any?(names, fn name ->
      is_binary(name) and String.length(name) >= 2 and String.contains?(text, name)
    end)
  end

  defp record_sighting(repo, work_id, character, chapter_id, current, text, summary_ref) do
    existing =
      repo.list.(work_id)
      |> Enum.find(&(&1.ledger == "arc" and &1.subject_ref == to_string(character[:id])))

    entry_result =
      case existing do
        nil ->
          LedgerEntry.new(%{
            work_id: work_id,
            ledger: "arc",
            subject_kind: "character",
            subject_ref: to_string(character[:id]),
            subject_label: character[:name],
            status: "ON_TRACK",
            source_refs: [summary_ref]
          })

        found ->
          LedgerEntry.new(Map.put(found, :ledger, found.ledger))
      end

    case entry_result do
      {:ok, entry} ->
        entry
        |> LedgerEntry.arc_sighted(%{
          chapter_ref: chapter_id,
          chapter_seq: current.seq,
          source_ref: summary_ref,
          presence_note: presence_note(text)
        })
        |> persist(repo)

      {:error, _reason} ->
        false
    end
  end

  defp presence_note(text) do
    text |> String.trim() |> String.slice(0, @presence_note_max_chars)
  end

  defp recompute_stalls(repo, work_id, current_seq) do
    threshold =
      Application.get_env(:novel_application, :arc_stall_threshold_chapters, @default_stall_threshold)

    repo.list.(work_id)
    |> Enum.filter(&(&1.ledger == "arc"))
    |> Enum.count(fn stored ->
      with {:ok, entry} <- LedgerEntry.new(stored),
           {:changed, changed} <- LedgerEntry.arc_recompute_stall(entry, current_seq, threshold) do
        persist(changed, repo) and changed.status == "STALLED"
      else
        _ -> false
      end
    end)
  end

  defp ensure_genre_promise(deps, work_id) do
    with profile_fn when is_function(profile_fn, 1) <- Map.get(deps, :profile),
         profile when is_map(profile) <- profile_fn.(work_id),
         genre when is_binary(genre) and genre != "" <- profile[:genre],
         false <- genre_promise_exists?(deps.repo, work_id) do
      seed_genre_promise(deps.repo, work_id, genre)
    else
      _ -> :skip
    end
  end

  @conflict_progress_roles ~w(推进章 高潮章 转折章)

  # CP3：情绪曲线记账——每采纳章一条（subject=chapter），全机械（记录性账目）。
  defp record_emotion_curve(repo, work_id, input, chapter_id, current) do
    realized =
      input.summary_text |> ChapterSummary.parse_sections() |> Map.get(:mood)

    status = LedgerEntry.emotion_status(Map.get(current, :emotion), realized)
    summary_ref = Map.get(input, :summary_ref) || "chapter_summary:#{chapter_id}"

    case LedgerEntry.new(%{
           work_id: work_id,
           ledger: "emotion_curve",
           subject_kind: "chapter",
           subject_ref: chapter_id,
           subject_label: "#{current.title || "第#{current.seq}章"}·情绪",
           status: status,
           payload: %{
             "intended" => Map.get(current, :emotion),
             "realized" => realized,
             "seq" => current.seq
           },
           source_refs: [summary_ref],
           last_event_chapter: chapter_id
         }) do
      {:ok, entry} ->
        persist(entry, repo)
        status

      {:error, _} ->
        nil
    end
  end

  # CP3：主线冲突记账——设计角色为推进/高潮/转折章的采纳推进主线；随后休眠重算。
  defp record_main_conflict(repo, work_id, chapter_id, current, summary_ref) do
    if Map.get(current, :chapter_role) in @conflict_progress_roles do
      existing =
        repo.list.(work_id)
        |> Enum.find(&(&1.ledger == "conflict" and &1.subject_ref == "main"))

      entry_result =
        case existing do
          nil ->
            LedgerEntry.new(%{
              work_id: work_id,
              ledger: "conflict",
              subject_kind: "plotline",
              subject_ref: "main",
              subject_label: "主线",
              status: "ACTIVE",
              payload: %{"line_kind" => "main"},
              source_refs: [summary_ref]
            })

          found ->
            LedgerEntry.new(found)
        end

      case entry_result do
        {:ok, entry} ->
          entry
          |> LedgerEntry.conflict_advanced(%{
            chapter_ref: chapter_id,
            chapter_seq: current.seq,
            source_ref: summary_ref
          })
          |> persist(repo)

        {:error, _} ->
          false
      end
    end

    recompute_conflict_dormancy(repo, work_id, current.seq)
  end

  defp recompute_conflict_dormancy(repo, work_id, current_seq) do
    threshold =
      Application.get_env(:novel_application, :arc_stall_threshold_chapters, @default_stall_threshold)

    repo.list.(work_id)
    |> Enum.filter(&(&1.ledger == "conflict"))
    |> Enum.each(fn stored ->
      with {:ok, entry} <- LedgerEntry.new(stored),
           {:changed, changed} <-
             LedgerEntry.conflict_recompute_dormant(entry, current_seq, threshold) do
        persist(changed, repo)
      else
        _ -> :ok
      end
    end)
  end

  @default_reconcile_cadence 10

  defp maybe_reconcile(deps, work_id, current_seq) do
    cadence =
      Application.get_env(:novel_application, :ledger_reconcile_cadence_chapters, @default_reconcile_cadence)

    reconcile = Map.get(deps, :reconcile)

    if is_function(reconcile, 2) and cadence > 0 and rem(current_seq, cadence) == 0 do
      reconcile.(work_id, current_seq)
    end

    :ok
  end

  defp genre_promise_exists?(repo, work_id) do
    repo.list.(work_id)
    |> Enum.any?(&(&1.ledger == "promise" and &1.subject_ref == "genre"))
  end

  defp seed_genre_promise(repo, work_id, genre) do
    case LedgerEntry.new(%{
           work_id: work_id,
           ledger: "promise",
           subject_kind: "promise",
           subject_ref: "genre",
           subject_label: "类型承诺：#{genre}",
           status: "OPEN",
           payload: %{"promise_kind" => "genre", "content" => genre},
           source_refs: ["work_profile:#{work_id}"]
         }) do
      {:ok, entry} -> persist(entry, repo)
      {:error, _} -> false
    end
  end

  defp reveal_plan_info(repo, work_id, current, summary_ref) do
    subject_ref = "plan_info_#{current.seq}"

    repo.list.(work_id)
    |> Enum.find(
      &(&1.ledger == "information" and &1.subject_ref == subject_ref and &1.status == "HIDDEN")
    )
    |> case do
      nil ->
        :ok

      entry ->
        entry
        |> Map.put(:status, "REVEALED")
        |> Map.update(:source_refs, [summary_ref], &Enum.uniq(&1 ++ [summary_ref]))
        |> LedgerEntry.new()
        |> case do
          {:ok, updated} ->
            persist(updated, repo)
            :ok

          {:error, _reason} ->
            :ok
        end
    end
  end

  defp record_future_ref_leaks(repo, work_id, input, chapter_id, current) do
    prose = Map.get(input, :prose_text)
    summary_ref = Map.get(input, :summary_ref) || "chapter_summary:#{chapter_id}"

    prose
    |> NovelDomain.LedgerReconciliation.future_chapter_refs(current.seq)
    |> Enum.count(fn future_seq ->
      case LedgerEntry.new(%{
             work_id: work_id,
             ledger: "information",
             subject_kind: "fact",
             subject_ref: "future_ref_#{future_seq}",
             subject_label: "正文前指第#{future_seq}章",
             status: "LEAKED",
             payload: %{
               "fact" => "第#{current.seq}章正文引用了尚未写作的第#{future_seq}章",
               "leaked_at_seq" => current.seq
             },
             source_refs: [summary_ref],
             last_event_chapter: chapter_id
           }) do
        {:ok, entry} -> persist(entry, repo)
        {:error, _} -> false
      end
    end)
  end

  defp persist(%LedgerEntry{} = entry, repo) do
    attrs = %{
      work_id: entry.work_id,
      ledger: entry.ledger,
      subject_kind: entry.subject_kind,
      subject_ref: entry.subject_ref,
      subject_label: entry.subject_label,
      design_ref: entry.design_ref,
      status: entry.status,
      payload: entry.payload,
      source_refs: entry.source_refs,
      last_event_chapter: entry.last_event_chapter,
      revision: entry.revision
    }

    match?({:ok, _}, repo.upsert.(attrs))
  end

  defp degrade(work_id, chapter_id, reason) do
    LogEmit.emit(:ledger, :update, :error, %{
      work_id: work_id,
      chapter_id: chapter_id,
      reason_code: :ledger_maintenance_failed,
      outcome_detail: inspect(reason)
    })

    {:degraded, reason}
  end
end
