defmodule NovelApplication.WorkArchiveService do
  @moduledoc """
  作品档案的应用读取边界：面板 DTO 与按需探索材料共用真实持久读口。

  本模块只读取/投影档案材料、来源与分页范围；探索预算与 AgentObservation
  仍由 ExplorationService 编排，不生成模型事实或角色采纳授权。
  """

  alias NovelApplication.{CharacterProfile, ReadingProjectionService, WorkArchiveDirectory}
  alias NovelPersistence.WorkArchiveRepo

  @spec profile(String.t()) :: map()
  def profile(work_id) when is_binary(work_id), do: WorkArchiveRepo.profile(work_id)

  @spec characters(String.t()) :: [map()]
  def characters(work_id) when is_binary(work_id), do: WorkArchiveRepo.characters(work_id)

  @spec foreshadowing(String.t()) :: [map()]
  def foreshadowing(work_id) when is_binary(work_id), do: WorkArchiveRepo.foreshadowing(work_id)

  @spec rules(String.t()) :: [map()]
  def rules(work_id) when is_binary(work_id), do: WorkArchiveRepo.rules(work_id)

  @spec stats(String.t()) :: map()
  def stats(work_id) when is_binary(work_id), do: WorkArchiveRepo.stats(work_id)

  @spec current_states(String.t()) :: [map()]
  def current_states(work_id) when is_binary(work_id), do: WorkArchiveRepo.current_states(work_id)

  @spec relationships(String.t()) :: [map()]
  def relationships(work_id) when is_binary(work_id), do: WorkArchiveRepo.relationships(work_id)

  @spec preferences(String.t()) :: [map()]
  def preferences(work_id) when is_binary(work_id), do: WorkArchiveRepo.preferences(work_id)

  @doc "五本账进度视图（VS-00F CP1/CP2a：弧光/承诺/信息账）。"
  @spec ledgers(String.t()) :: [map()]
  def ledgers(work_id) when is_binary(work_id),
    do: NovelPersistence.LedgerRepository.list_all(work_id)

  @doc "当前活跃对账报告（TENTATIVE，作者裁决材料；无则 nil。VS-00F CP2b）。"
  @spec latest_reconciliation_report(String.t()) :: map() | nil
  def latest_reconciliation_report(work_id) when is_binary(work_id),
    do: NovelPersistence.ReconciliationReportRepo.latest(work_id)

  @archive_facets ~w(profile chapters characters foreshadowing rules stats current_state relationships preferences ledgers)
  @memory_facets ~w(foreshadowing rules current_state relationships preferences)
  # 与现役章节/会话原文读取同一分页尺度；目录按完整条目装入，不截断对象标识。
  @page_chars 6000
  @chapter_mission_confirmed NovelFoundation.Enums.ChapterMissionStatus.confirmed()
  @chapter_mission_author_edited NovelFoundation.Enums.ChapterMissionStatus.author_edited()

  @doc """
  按显式 facet/ref/offset 返回有界档案材料。目录供定位与轻量身份查询；详情携带真实
  持久指纹及所需字段覆盖。返回材料 DTO，不构造探索观察或感知模型调用。
  """
  @spec read(String.t(), String.t()) :: {:ok, map()} | {:error, term()}
  def read(work_id, query) when is_binary(work_id) and is_binary(query) do
    with {:ok, selector} <- selector(String.trim(query)) do
      read_selected(work_id, selector)
    end
  end

  def read(_work_id, _query), do: {:error, :invalid_archive_query}

  @doc "档案读口与续读门禁共用的 facet/ref/offset 解析；不读取材料或授予修订资格。"
  @spec selector(String.t()) :: {:ok, map()} | {:error, term()}
  def selector("{" <> _ = query) do
    with {:ok, %{"facet" => facet} = decoded} <- Jason.decode(query),
         true <- Enum.all?(Map.keys(decoded), &(&1 in ["facet", "ref", "offset"])),
         true <- facet in @archive_facets,
         offset = Map.get(decoded, "offset", 0),
         true <- is_integer(offset) and offset >= 0,
         ref = Map.get(decoded, "ref"),
         true <-
           is_nil(ref) or (facet in ["characters", "chapters"] and is_binary(ref) and ref != "") do
      {:ok, %{facet: facet, ref: ref, offset: offset}}
    else
      _ -> {:error, :invalid_archive_query}
    end
  end

  def selector(facet) when facet in @archive_facets,
    do: {:ok, %{facet: facet, ref: nil, offset: 0}}

  def selector(facet), do: {:error, {:unknown_archive_facet, facet, @archive_facets}}

  defp read_selected(work_id, %{facet: "characters", ref: nil, offset: offset}) do
    with {:ok, characters} <- CharacterProfile.targets(work_id) do
      items =
        Enum.map(characters, fn character ->
          %{
            ref: character.character_ref,
            name: character.name,
            aliases: character.aliases,
            narrative_role: character.narrative_role,
            status: character.status,
            version: character.base_fingerprint
          }
        end)

      directory(work_id, "characters", items, offset)
    end
  end

  defp read_selected(work_id, %{facet: "chapters", ref: nil, offset: offset}) do
    items =
      work_id
      |> ReadingProjectionService.toc()
      |> Map.fetch!(:volumes)
      |> Enum.flat_map(fn volume ->
        Enum.map(volume.chapters, fn chapter ->
          %{
            ref: "chapter:#{chapter.id}",
            seq: chapter.seq,
            title: chapter.title,
            volume: volume.title,
            has_prose: chapter.word_count > 0
          }
        end)
      end)

    directory(work_id, "chapters", items, offset)
  end

  defp read_selected(work_id, %{facet: "characters", ref: ref, offset: offset}) do
    with {:ok, target} <- CharacterProfile.target(work_id, ref),
         {:ok, page} <- text_page(target.summary || "", offset) do
      baseline = Map.delete(target, :summary)

      coverage = %{
        kind: "detail",
        facet: "characters",
        work_id: work_id,
        ref: ref,
        complete_fields: baseline |> Map.keys() |> Enum.map(&Atom.to_string/1) |> Enum.sort(),
        summary: page.range
      }

      {:ok,
       material(page, [ref], %{ref => target.base_fingerprint}, coverage, %{character: baseline})}
    end
  end

  defp read_selected(work_id, %{facet: "chapters", ref: ref} = selector) do
    with {:ok, %{volume: volume, chapter: chapter, accepted_summary: accepted}} <-
           ReadingProjectionService.chapter_design(work_id, ref) do
      plan = %{
        ref: ref,
        text: "【章计划】" <> Jason.encode!(Map.take(chapter, [:summary, :plan_direction]))
      }

      blueprint =
        if volume.blueprint,
          do: [%{ref: "volume:#{volume.id}", text: "【卷蓝图】" <> Jason.encode!(volume.blueprint)}],
          else: []

      summary =
        Enum.map(List.wrap(accepted), fn item ->
          %{
            ref: "chapter_summary:#{item.id}",
            status: item.status,
            content_source_ref: item.source_ref,
            text: "【章摘要】" <> item.summary_text
          }
        end)

      sourced_material(work_id, selector, [plan] ++ blueprint ++ summary, %{
        chapter_prose: "not_read"
      })
    end
  end

  defp read_selected(work_id, %{facet: facet} = selector) when facet in @memory_facets do
    sources =
      Enum.map(memory_facet_items(facet, work_id), fn item ->
        %{
          ref: "memory:#{item.id}",
          version: item.version,
          status: item.status,
          source_type: item.source_type,
          text: render_memory_item(item)
        }
      end)

    sourced_material(work_id, selector, sources, %{})
  end

  defp read_selected(work_id, %{facet: facet, offset: offset}) do
    with {:ok, page} <- text_page(facet_summary(facet, work_id), offset) do
      coverage = %{kind: "facet", facet: facet, work_id: work_id, summary: page.range}
      {:ok, material(page, ["archive:#{facet}"], %{}, coverage, %{})}
    end
  end

  defp sourced_material(work_id, selector, sources, extra_coverage) do
    {spans, _} =
      Enum.map_reduce(sources, 0, fn source, offset ->
        stop = offset + String.length(source.text)
        {Map.merge(Map.delete(source, :text), %{start: offset, stop: stop}), stop + 1}
      end)

    text = if sources == [], do: "此档案面暂无可读条目。", else: Enum.map_join(sources, "\n", & &1.text)

    with {:ok, page} <- text_page(text, selector.offset) do
      stop = selector.offset + page.range.returned_graphemes
      visible = Enum.filter(spans, &(&1.start < stop and &1.stop > selector.offset))
      refs = Enum.map(visible, & &1.ref)
      versions = for %{ref: ref, version: version} <- visible, into: %{}, do: {ref, version}

      ranges = Enum.map(visible, &source_range(&1, selector.offset, stop))

      coverage =
        Map.merge(
          %{
            kind: if(selector.ref, do: "detail", else: "facet"),
            facet: selector.facet,
            ref: selector.ref,
            work_id: work_id,
            summary: page.range,
            sources: ranges
          },
          extra_coverage
        )

      result = material(page, refs, versions, coverage, %{})
      {:ok, if(sources == [], do: %{result | outcome: :empty_result}, else: result)}
    end
  end

  defp source_range(source, offset, stop) do
    source
    |> Map.drop([:start, :stop])
    |> Map.merge(%{
      offset: max(offset - source.start, 0),
      returned_graphemes: min(stop, source.stop) - max(offset, source.start),
      total_graphemes: source.stop - source.start,
      offset_unit: "unicode_grapheme",
      version_status: if(Map.has_key?(source, :version), do: "known", else: "unavailable")
    })
  end

  defp directory(work_id, facet, items, offset) do
    total = length(items)

    with :ok <- valid_offset(offset, total),
         {:ok, page, material} <-
           WorkArchiveDirectory.page(Enum.drop(items, offset), facet, total, @page_chars) do
      next = next_offset(offset + length(page), total)
      versions = for %{ref: ref, version: version} <- page, into: %{}, do: {ref, version}
      omissions = ["目录只含所列身份字段，未读取对象正文或完整角色修订基线。"]

      fields =
        case page do
          [] ->
            []

          [item | _] ->
            item
            |> Map.delete(:version)
            |> Map.keys()
            |> Enum.map(&Atom.to_string/1)
            |> Enum.sort()
        end

      {:ok,
       %{
         summary: material.summary,
         refs: Enum.map(page, & &1.ref),
         versions: versions,
         coverage: %{
           kind: "directory",
           facet: facet,
           work_id: work_id,
           offset: offset,
           offset_unit: "item",
           returned_items: length(page),
           total_items: total,
           complete_fields: fields
         },
         omissions: if(next, do: omissions ++ ["目录尚有后续条目。"], else: omissions),
         facts: material.facts,
         next_offset: next,
         outcome:
           cond do
             total == 0 -> :empty_result
             next -> :partial
             true -> :observed
           end
       }}
    end
  end

  defp text_page(text, offset) do
    total = String.length(text)

    with :ok <- valid_offset(offset, total) do
      body = String.slice(text, offset, @page_chars)
      returned = String.length(body)

      {:ok,
       %{
         body: body,
         next_offset: next_offset(offset + returned, total),
         range: %{
           offset: offset,
           returned_graphemes: returned,
           total_graphemes: total,
           offset_unit: "unicode_grapheme"
         }
       }}
    end
  end

  defp valid_offset(0, 0), do: :ok
  defp valid_offset(offset, total) when offset >= 0 and offset < total, do: :ok
  defp valid_offset(_offset, _total), do: {:error, :archive_offset_out_of_range}
  defp next_offset(position, total) when position < total, do: position
  defp next_offset(_position, _total), do: nil

  defp material(page, refs, versions, coverage, facts) do
    partial = page.range.offset > 0 or not is_nil(page.next_offset)

    %{
      summary: page.body,
      refs: refs,
      versions: versions,
      coverage: coverage,
      omissions: if(partial, do: ["只返回所列正文范围，其余正文尚未读取。"], else: []),
      facts: facts,
      next_offset: page.next_offset,
      outcome: if(partial, do: :partial, else: :observed)
    }
  end

  defp facet_summary("profile", work_id), do: render_profile(profile(work_id))

  defp facet_summary("stats", work_id), do: render_stats(stats(work_id))

  defp facet_summary("ledgers", work_id) do
    render_ledgers(ledgers(work_id)) <>
      render_reconciliation_report(latest_reconciliation_report(work_id))
  end

  defp planning_mission_line(%{"planning_mission" => %{} = mission}) do
    case mission["statement"] do
      statement when is_binary(statement) and statement != "" ->
        status =
          case mission["status"] do
            @chapter_mission_confirmed -> "已确认"
            @chapter_mission_author_edited -> "作者改写"
            _ -> "暂定"
          end

        "#{statement}（#{status}）"

      _ ->
        nil
    end
  end

  defp planning_mission_line(_), do: nil

  defp render_profile(profile) when map_size(profile) == 0, do: "作品档案暂无简介。"

  defp render_profile(profile) do
    [
      {"书名", profile[:title]},
      {"类型", profile[:genre]},
      {"核心卖点", profile[:core_selling_point]},
      # CA01（NEM-GAP-01 要素物化 + 08 §8 探索面同步律）：创作锚三字段同批可达
      {"前提", profile[:premise]},
      {"主题", profile[:theme]},
      {"主线目标", profile[:main_goal]},
      # VS-00G CP3（NEM-GAP-08 全书骨架 + 探索面同步律）：目标体量/卷数/连载形态同批可达
      {"目标体量（字）", profile[:target_length]},
      {"预计卷数", profile[:planned_volumes]},
      {"连载形态", profile[:serial_form]},
      {"目标读者", profile[:target_reader]},
      {"基调", profile[:tone_preference]},
      # WR01c（探索面同步律）：工作级规划使命同批可达
      {"当前规划使命", planning_mission_line(profile[:planning_direction])}
    ]
    |> Enum.reject(fn {_label, value} -> value in [nil, ""] end)
    |> Enum.map_join("\n", fn {label, value} -> "#{label}：#{value}" end)
    |> case do
      "" -> "作品档案暂无简介。"
      text -> text
    end
  end

  defp memory_facet_items("foreshadowing", work_id), do: foreshadowing(work_id)
  defp memory_facet_items("rules", work_id), do: rules(work_id)
  defp memory_facet_items("current_state", work_id), do: current_states(work_id)
  defp memory_facet_items("relationships", work_id), do: relationships(work_id)
  defp memory_facet_items("preferences", work_id), do: preferences(work_id)

  defp render_memory_item(item) do
    title = item[:summary] || ""
    body = item[:content] || ""
    if title == "", do: body, else: title <> "：" <> body
  end

  # VS-00F 账面机械渲染（不代笔、不伪造）。CP2a 起含弧光/承诺/信息账；无数据诚实说明。
  defp render_ledgers([]), do: "脉络暂无记录（脉络随正文采纳自动维护；未落地脉络诚实缺席）。"

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

    "情绪曲线：相符 #{counts["MATCHED"] || 0} / 偏离 #{counts["DEVIATED"] || 0} / 计划外 #{counts["UNPLANNED"] || 0}" <>
      if(deviated == "", do: "", else: "；最近偏离：#{deviated}")
  end

  defp render_ledger_entry(%{ledger: "arc"} = entry) do
    seen = Map.get(entry.payload || %{}, "last_seen_seq")
    seen_text = if is_integer(seen), do: "最近出场第#{seen}章", else: "尚无出场记录"
    "角色弧光·#{entry.subject_label}：#{entry.status}，#{seen_text}"
  end

  defp render_ledger_entry(%{ledger: "promise"} = entry),
    do: "题材承诺·#{entry.subject_label}：#{entry.status}"

  defp render_ledger_entry(%{ledger: "information"} = entry) do
    fact = Map.get(entry.payload || %{}, "fact") || entry.subject_label
    "信息与伏笔·#{entry.subject_label}：#{entry.status}（#{fact}）"
  end

  defp render_ledger_entry(%{ledger: "conflict"} = entry) do
    seq = Map.get(entry.payload || %{}, "last_advanced_seq")
    advanced = if is_integer(seq), do: "最近推进第#{seq}章", else: "尚无推进记录"
    "主线冲突·#{entry.subject_label}：#{entry.status}，#{advanced}"
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

    "\n审读报告（待作者处置，#{report.finding_count} 处偏离）：\n#{items}"
  end

  defp render_stats(stats) do
    "已采纳正文总字数 #{stats[:words_total] || 0}；卷数 #{stats[:volumes] || 0}；" <>
      "章节数 #{stats[:chapters] || 0}；" <>
      "已采纳角色 #{stats[:characters] || 0}；确认记忆 #{stats[:memory_items] || 0}。"
  end
end
