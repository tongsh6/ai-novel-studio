defmodule NovelApplication.ExplorationService do
  @moduledoc """
  CP5 探索内部翼：判断循环的按需只读检索面（ADR-0025 §5a）。

  原子工具按**数据面**组织（组合归模型，app 不预制用途）：

  - `prose_search`  已采纳正文全文检索（唯一新建，FTS5 trigram；选型证据
    `spikes/fts_chinese_search/`）
  - `chapter_read`  按章名读已采纳正文（阅读投影同源）
  - `archive_read`  作品档案面读取（profile/characters/foreshadowing/rules/stats）
  - `memory_recall` 治理记忆检索

  全部包既有服务 API（`ProseSearchRepo` / `ReadingProjectionService` /
  `WorkArchiveService` / `MemoryManagementService`），不建平行读路径。观察
  summary 是检索结果的机械渲染（结构词家族 + 出处 refs），不产生系统代笔叙述。
  """

  alias NovelApplication.{MemoryManagementService, ReadingProjectionService, WorkArchiveService}
  alias NovelDomain.ChapterPlanDirection
  alias NovelPersistence.{ChapterSummaryRepo, ProseSearchRepo}

  @type observation :: %{
          tool: String.t(),
          query: String.t(),
          summary: String.t(),
          refs: [String.t()]
        }

  # ledgers 面为 VS-00F CP1（ADR-0026）第 9 面：五本账进度视图（探索面同步律，08 §8）。
  @archive_facets ~w(profile characters foreshadowing rules stats current_state relationships preferences ledgers)
  @summary_max_chars 1500
  @chapter_clip_chars 1200

  @catalog [
    %{
      tool: "prose_search",
      query_help: "检索词（人物、物件、事件等正文用语）",
      description: "全文检索已采纳正文，返回命中章节与原文片段"
    },
    %{
      tool: "chapter_read",
      query_help: "章节名（可只给编号如「第02章」）",
      description: "读取某一章的设计计划、章摘要与已采纳正文"
    },
    %{
      tool: "archive_read",
      query_help:
        "档案面之一：profile｜characters｜foreshadowing｜rules｜stats｜current_state｜relationships｜preferences",
      description: "读取作品档案（简介/角色/伏笔/规则/统计/当前状态/人物关系/作者偏好）"
    },
    %{
      tool: "memory_recall",
      query_help: "检索词",
      description: "检索治理记忆（已确认的设定、约束、方向）"
    }
  ]

  @spec catalog() :: [map()]
  def catalog, do: @catalog

  @spec tool_names() :: [String.t()]
  def tool_names, do: Enum.map(@catalog, & &1.tool)

  @doc "判断 prompt 的探索目录段（与能力目录同段机械渲染，真源单点）。"
  @spec catalog_section() :: String.t()
  def catalog_section do
    lines =
      Enum.map_join(@catalog, "\n", fn entry ->
        "- #{entry.tool}：#{entry.description}（query 填#{entry.query_help}）"
      end)

    "## 探索目录（explore 时 explore_request.tool 从此列表选择）\n" <> lines
  end

  @spec run(String.t(), String.t(), String.t()) :: {:ok, observation()} | {:error, term()}
  def run(work_id, tool, query) when is_binary(work_id) and is_binary(tool) do
    query = String.trim(query || "")

    case tool do
      "prose_search" -> prose_search(work_id, query)
      "chapter_read" -> chapter_read(work_id, query)
      "archive_read" -> archive_read(work_id, query)
      "memory_recall" -> memory_recall(work_id, query)
      other -> {:error, {:unknown_exploration_tool, other}}
    end
  end

  def run(_work_id, tool, _query), do: {:error, {:unknown_exploration_tool, tool}}

  # ── prose_search ──

  defp prose_search(_work_id, ""), do: {:error, :empty_query}

  defp prose_search(work_id, query) do
    case ProseSearchRepo.search(work_id, query) do
      {:ok, []} ->
        {:ok, observation("prose_search", query, "正文中未检索到「#{query}」。", [])}

      {:ok, hits} ->
        summary =
          Enum.map_join(hits, "\n", fn hit ->
            "「#{hit.chapter_title}」#{hit.snippet}"
          end)

        {:ok,
         observation(
           "prose_search",
           query,
           "正文检索「#{query}」命中 #{length(hits)} 章：\n" <> summary,
           Enum.map(hits, &"chapter:#{&1.chapter_id}")
         )}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # ── chapter_read ──

  defp chapter_read(_work_id, ""), do: {:error, :empty_query}

  defp chapter_read(work_id, query) do
    chapters =
      work_id
      |> ReadingProjectionService.toc()
      |> Map.get(:volumes, [])
      |> Enum.flat_map(&Map.get(&1, :chapters, []))

    case Enum.find(chapters, &chapter_match?(&1, query)) do
      nil ->
        titles = Enum.map_join(chapters, "、", & &1.title)
        {:ok, observation("chapter_read", query, "没有找到「#{query}」。现有章节：#{titles}", [])}

      chapter ->
        sections =
          [chapter_plan_section(chapter), chapter_summary_section(work_id, chapter)] ++
            chapter_prose_sections(work_id, chapter)

        {:ok,
         observation(
           "chapter_read",
           query,
           "「#{chapter.title}」\n" <> Enum.join(sections, "\n"),
           ["chapter:#{chapter.id}"]
         )}
    end
  end

  # 设计态（E18-E22 结构化计划；ADR-0025 CP5b 探索补面 A）：无结构化计划时
  # 回退 chapters.summary（大纲采纳的单行方向），两者皆无则诚实说明。
  defp chapter_plan_section(chapter) do
    plan = ChapterPlanDirection.from_storage(Map.get(chapter, :plan_direction))

    rendered =
      case plan do
        nil ->
          case Map.get(chapter, :summary) do
            summary when is_binary(summary) and summary != "" -> summary
            _ -> "（本章尚无设计计划）"
          end

        direction ->
          [
            {"功能定位", direction.chapter_role},
            {"情节推进", direction.plot_progress},
            {"人物变化", direction.character_change},
            {"信息释放", direction.information_release},
            {"伏笔动作", direction.foreshadowing_action},
            {"情绪定位", direction.emotion},
            {"章首拉力", direction.opening_hook},
            {"章尾断章", direction.ending_hook},
            {"篇幅与场次", direction.word_count_and_scenes}
          ]
          |> Enum.reject(fn {_label, value} -> value in [nil, ""] end)
          |> Enum.map_join("；", fn {label, value} -> "#{label}：#{value}" end)
      end

    "【计划】#{rendered}"
  end

  # 实现态压缩层（chapter_summaries 治理摘要；CP5b 探索补面 B）。
  defp chapter_summary_section(work_id, chapter) do
    case ChapterSummaryRepo.current_accepted(work_id, chapter.id) do
      %{summary_text: text} when is_binary(text) and text != "" ->
        "【摘要】#{text}"

      _ ->
        "【摘要】（尚无章摘要）"
    end
  end

  defp chapter_prose_sections(work_id, chapter) do
    case ReadingProjectionService.chapter_content(chapter.id, work_id) do
      {:ok, content} ->
        text = content.scenes |> Enum.map_join("\n", & &1.content) |> clip(@chapter_clip_chars)
        ["【正文】（有效字数 #{content.word_count}）\n#{text}"]

      {:error, :not_found} ->
        ["【正文】还没有已采纳正文。"]
    end
  end

  defp chapter_match?(chapter, query) do
    title = chapter.title || ""
    String.contains?(title, query) or String.contains?(query, title)
  end

  # ── archive_read ──

  defp archive_read(work_id, facet) when facet in @archive_facets do
    {:ok, observation("archive_read", facet, facet_summary(facet, work_id), ["archive:#{facet}"])}
  end

  defp archive_read(_work_id, facet),
    do: {:error, {:unknown_archive_facet, facet, @archive_facets}}

  defp facet_summary("profile", work_id), do: render_profile(WorkArchiveService.profile(work_id))

  defp facet_summary("characters", work_id),
    do: render_characters(WorkArchiveService.characters(work_id))

  defp facet_summary("foreshadowing", work_id),
    do: render_memory_items("伏笔", WorkArchiveService.foreshadowing(work_id))

  defp facet_summary("rules", work_id),
    do: render_memory_items("规则", WorkArchiveService.rules(work_id))

  defp facet_summary("stats", work_id), do: render_stats(WorkArchiveService.stats(work_id))

  defp facet_summary("current_state", work_id),
    do: render_memory_items("当前状态", WorkArchiveService.current_states(work_id))

  defp facet_summary("relationships", work_id),
    do: render_memory_items("人物关系", WorkArchiveService.relationships(work_id))

  defp facet_summary("preferences", work_id),
    do: render_memory_items("作者偏好", WorkArchiveService.preferences(work_id))

  defp facet_summary("ledgers", work_id) do
    render_ledgers(WorkArchiveService.ledgers(work_id)) <>
      render_reconciliation_report(WorkArchiveService.latest_reconciliation_report(work_id))
  end

  defp render_profile(profile) when map_size(profile) == 0, do: "作品档案暂无简介。"

  defp render_profile(profile) do
    [
      {"书名", profile[:title]},
      {"类型", profile[:genre]},
      {"核心卖点", profile[:core_selling_point]},
      {"目标读者", profile[:target_reader]},
      {"基调", profile[:tone_preference]}
    ]
    |> Enum.reject(fn {_label, value} -> value in [nil, ""] end)
    |> Enum.map_join("\n", fn {label, value} -> "#{label}：#{value}" end)
    |> case do
      "" -> "作品档案暂无简介。"
      text -> text
    end
  end

  defp render_characters([]), do: "档案中还没有已采纳角色。"

  defp render_characters(characters) do
    Enum.map_join(characters, "\n", fn character ->
      role = character[:narrative_role] || character[:role]
      summary = character[:summary] || ""
      "#{character[:name]}（#{role}）：#{summary}"
    end)
  end

  defp render_memory_items(label, []), do: "档案中还没有#{label}条目。"

  defp render_memory_items(_label, items) do
    Enum.map_join(items, "\n", fn item ->
      title = item[:summary] || ""
      body = item[:content] || ""
      String.trim("#{title}：#{body}", "：")
    end)
  end

  # VS-00F 账面机械渲染（不代笔、不伪造）。CP2a 起含弧光/承诺/信息账；无数据诚实说明。
  defp render_ledgers([]), do: "账面暂无条目（账本随正文采纳自动记账；未落地账本诚实缺席）。"

  # 情绪曲线账每章一条，逐条呈现会淹没观察——聚合为一行统计 + 最近偏差章；
  # 其余账逐条机械呈现。
  defp render_ledgers(entries) do
    {emotion, rest} = Enum.split_with(entries, &(&1.ledger == "emotion_curve"))

    [Enum.map_join(rest, "\n", &render_ledger_entry/1), render_emotion_aggregate(emotion)]
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n")
  end

  defp render_emotion_aggregate([]), do: ""

  defp render_emotion_aggregate(entries) do
    counts = Enum.frequencies_by(entries, & &1.status)

    deviated =
      entries
      |> Enum.filter(&(&1.status == "DEVIATED"))
      |> Enum.sort_by(&(-(Map.get(&1.payload || %{}, "seq") || 0)))
      |> Enum.take(3)
      |> Enum.map_join("、", & &1.subject_label)

    "情绪曲线账：符合 #{counts["MATCHED"] || 0} / 偏差 #{counts["DEVIATED"] || 0} / 无设计 #{counts["UNPLANNED"] || 0}" <>
      if(deviated == "", do: "", else: "；最近偏差：#{deviated}")
  end

  defp render_ledger_entry(%{ledger: "arc"} = entry) do
    seen = Map.get(entry.payload || %{}, "last_seen_seq")
    seen_text = if is_integer(seen), do: "最近出场第#{seen}章", else: "尚无出场记录"
    "弧光账·#{entry.subject_label}：#{entry.status}，#{seen_text}"
  end

  defp render_ledger_entry(%{ledger: "promise"} = entry),
    do: "承诺账·#{entry.subject_label}：#{entry.status}"

  defp render_ledger_entry(%{ledger: "information"} = entry) do
    fact = Map.get(entry.payload || %{}, "fact") || entry.subject_label
    "信息账·#{entry.subject_label}：#{entry.status}（#{fact}）"
  end

  defp render_ledger_entry(%{ledger: "conflict"} = entry) do
    seq = Map.get(entry.payload || %{}, "last_advanced_seq")
    advanced = if is_integer(seq), do: "最近推进第#{seq}章", else: "尚无推进记录"
    "冲突账·#{entry.subject_label}：#{entry.status}，#{advanced}"
  end

  defp render_ledger_entry(entry), do: "#{entry.ledger}·#{entry.subject_label}：#{entry.status}"

  # CP2b：最新对账报告（TENTATIVE 裁决材料）随账面机械呈现；无报告不虚构。
  defp render_reconciliation_report(nil), do: ""

  defp render_reconciliation_report(report) do
    items =
      report.findings
      |> Enum.map_join("\n", fn finding ->
        severity = finding["severity"] || finding[:severity]
        signal = finding["signal"] || finding[:signal]
        "- [#{severity}] #{signal}"
      end)

    "\n对账报告（待作者裁决，#{report.finding_count} 项偏离）：\n#{items}"
  end

  defp render_stats(stats) do
    "已采纳正文总字数 #{stats[:words_total] || 0}；章节数 #{stats[:chapters] || 0}；" <>
      "已采纳角色 #{stats[:characters] || 0}；确认记忆 #{stats[:memory_items] || 0}。"
  end

  # ── memory_recall ──

  defp memory_recall(_work_id, ""), do: {:error, :empty_query}

  defp memory_recall(work_id, query) do
    case MemoryManagementService.recall(work_id, %{"query" => query}) do
      {:ok, %{text: text, candidate_count: count}} when count > 0 and text != "" ->
        {:ok,
         observation("memory_recall", query, "记忆检索「#{query}」命中 #{count} 条：\n#{text}", [
           "memory:#{count}"
         ])}

      {:ok, _empty} ->
        {:ok, observation("memory_recall", query, "记忆中未检索到「#{query}」。", [])}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # ── 公共 ──

  defp observation(tool, query, summary, refs) do
    %{tool: tool, query: query, summary: clip(summary, @summary_max_chars), refs: refs}
  end

  defp clip(text, max) do
    if String.length(text) > max do
      String.slice(text, 0, max) <> "…（截断）"
    else
      text
    end
  end
end
