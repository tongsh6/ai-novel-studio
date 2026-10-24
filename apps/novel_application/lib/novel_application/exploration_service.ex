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

  alias NovelApplication.{
    ChapterDisplay,
    MemoryManagementService,
    ReadingProjectionService,
    WorkArchiveService
  }

  alias NovelDomain.ChapterPlanDirection
  alias NovelDomain.VolumeBlueprint
  alias NovelFoundation.Enums.ChapterMissionStatus
  alias NovelPersistence.{ChapterSummaryRepo, ProseSearchRepo, WorkSessionRepo}

  # 观察 v2（B24）：基础形状不变（tool/query/summary/refs），chapter_read 观察
  # additive 携带续读/身份元数据（I-EXPLORE-READ-3/7/9）。
  @type observation :: %{
          required(:tool) => String.t(),
          required(:query) => String.t(),
          required(:summary) => String.t(),
          required(:refs) => [String.t()],
          optional(:activity_summary) => String.t(),
          optional(:chapter_ref) => String.t(),
          optional(:chapter_seq) => integer() | nil,
          optional(:next_offset) => non_neg_integer() | nil,
          optional(:prose_total_chars) => non_neg_integer(),
          optional(:prose_range) => %{start: pos_integer(), end: non_neg_integer()} | nil
        }

  # ledgers 面为 VS-00F CP1（ADR-0026）第 9 面：五本账进度视图（探索面同步律，08 §8）。
  @archive_facets ~w(profile characters foreshadowing rules stats current_state relationships preferences ledgers)
  @summary_max_chars 1500
  # B24（I-EXPLORE-READ-2）：观察 v2 分段预算——设计态材料另计上限，正文单页 6000
  # 字符。旧口径把三段拼成一条 1500 clip，设计态材料加料后正文只剩 216/4398 字
  # （2026-10-23 stage 实锤），故计划/摘要不再与正文共享同一条预算。
  @chapter_plan_max_chars 500
  @chapter_summary_max_chars 400
  @chapter_page_chars 6000
  @section_ellipsis "…（略）"
  @adoption_page_size 3
  @chapter_mission_confirmed ChapterMissionStatus.confirmed()
  @chapter_mission_author_edited ChapterMissionStatus.author_edited()

  @catalog [
    %{
      tool: "prose_search",
      query_help: "检索词（人物、物件、事件等正文用语）",
      description: "全文检索已采纳正文，返回命中章节与原文片段"
    },
    %{
      tool: "chapter_read",
      # I-EXPLORE-READ-7：章标识作品无关——query 是作品目录里的真实章标题，不假设
      # 任何编号格式；长章分页，续读用 JSON offset（I-EXPLORE-READ-3）。
      query_help: ~s(作品目录中的真实章标题，原样复制；续读用 JSON {"chapter":"<章标题>","offset":<下页起点>}),
      description: "读取某一章的设计计划、章摘要与已采纳正文（长章分页，按观察内【续读】继续）"
    },
    %{
      tool: "archive_read",
      query_help:
        "档案面之一：profile｜characters｜foreshadowing｜rules｜stats｜current_state｜relationships｜preferences",
      description: "读取作品档案（简介/角色/伏笔/规则/统计/当前状态/人物关系/作者偏好）"
    },
    %{
      tool: "session_adoptions",
      query_help: ~s(关键词或 artifact_ref；空串查全部；翻页用 JSON {"query":"关键词","offset":3}),
      description: "查询当前会话完整待采纳/已处置候选，返回实际数量、来源和下一页，不受聊天窗口限制"
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

  @doc "会话探索使用本轮可信 session 作用域，不接受模型指定其它会话。"
  def run(work_id, "session_adoptions", query, session_id) when is_binary(session_id) do
    with session when not is_nil(session) <- WorkSessionRepo.get_by_work(work_id, session_id),
         "ACTIVE" <- session.status,
         {:ok, search, offset} <- adoption_query(query) do
      state = WorkSessionRepo.adoption_state(work_id, session_id)
      all = state.pending_adoptions ++ state.resolved_adoptions
      matches = matching_adoptions(all, search)
      page = Enum.slice(matches, offset, @adoption_page_size)
      next = offset + length(page)

      summary = %{
        pending_count: length(state.pending_adoptions),
        resolved_count: length(state.resolved_adoptions),
        matched_count: length(matches),
        offset: offset,
        next_offset: if(next < length(matches), do: next, else: nil),
        items: Enum.map(page, &adoption_observation/1)
      }

      {:ok,
       %{
         tool: "session_adoptions",
         query: query || "",
         summary: Jason.encode!(summary),
         refs: Enum.map(page, & &1["artifact_id"]),
         activity_summary: activity_text("session_adoptions", query || "")
       }}
    else
      {:error, reason} -> {:error, reason}
      _ -> {:error, :active_session_not_found}
    end
  end

  def run(_work_id, "session_adoptions", _query, _session_id),
    do: {:error, :active_session_not_found}

  def run(work_id, tool, query, _session_id), do: run(work_id, tool, query)

  defp adoption_query(query) do
    text = String.trim(query || "")

    if String.starts_with?(text, "{") do
      case Jason.decode(text) do
        {:ok, %{"query" => search, "offset" => offset}}
        when is_binary(search) and is_integer(offset) and offset >= 0 ->
          {:ok, search, offset}

        _ ->
          {:error, :invalid_adoption_query}
      end
    else
      {:ok, text, 0}
    end
  end

  defp matching_adoptions(entries, query) do
    case Enum.find(entries, &(&1["artifact_id"] == query)) do
      nil -> Enum.filter(entries, &adoption_matches?(&1, query))
      entry -> [entry]
    end
  end

  defp adoption_matches?(entry, query) do
    String.contains?(String.downcase(Jason.encode!(entry)), String.downcase(query))
  end

  defp adoption_observation(entry) do
    payload = entry["payload"] || %{}
    item = List.first(payload["items"] || []) || %{}

    %{
      artifact_ref: entry["artifact_id"],
      status: entry["adoption_status"],
      artifact_type: entry["artifact_type"],
      source_turn_ref: entry["source_turn_ref"],
      source_ref: NovelApplication.TurnInteractionService.author_source_ref(entry),
      content_source_ref: entry["source_tool_result_ref"],
      title: String.slice(to_string(payload["summary"] || item["title"] || ""), 0, 100),
      body_preview:
        String.slice(NovelApplication.TurnInteractionService.artifact_body(entry), 0, 600),
      revision_of: payload["revision_of"],
      available_operations: NovelApplication.PendingArtifactWorkflow.operations(entry)
    }
  end

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

  # ── chapter_read（B24 观察 v2：分段预算 + JSON offset 续读） ──
  #
  # 契约：tasks/slices/B24-exploration-chapter-full-read.md §1.1。旧观察把
  # 【计划】【摘要】【正文】拼成一条 1500 字符 clip——设计态材料持续加料把正文挤到
  # 4.9%（2026-10-23 stage 实锤）。v2 分段预算：设计态材料另计上限、正文单页
  # 6000 字符、续读页不重复计划/摘要，并在 footer 给出下一页 query。
  #
  # query 语法（B24 CP0 §1.1(a)，I-EXPLORE-READ-7 唯一编码寻址）：
  #   - 规范     JSON {"chapter_ref":"chapter:<uuid>","offset":<n>}（唯一寻址）
  #   - 便利别名 JSON {"chapter_seq":<n>,"offset":<n>}（必须 work 内唯一命中）
  #   - 旧兼容   纯章标题 / JSON {"chapter":<TOC 真实标题>,"offset":<n>}
  #              （必须唯一命中；歧义即错误并列出候选 ref，禁止 first-match）
  # 分页续读必须复用同一 chapter_ref（footer 给出的正是它）。

  defp chapter_read(_work_id, ""), do: {:error, :empty_query}

  defp chapter_read(work_id, query) do
    volumes = work_id |> ReadingProjectionService.toc() |> Map.get(:volumes, [])
    chapters = Enum.flat_map(volumes, &Map.get(&1, :chapters, []))
    index = chapter_index_lines(chapters)

    case chapter_query(query) do
      {:ok, spec, offset} ->
        case resolve_chapter(chapters, spec) do
          {:ok, chapter} ->
            volume = chapter_volume(volumes, chapter)
            chapter_read_page(work_id, chapter, volume, query, offset)

          {:error, {:ambiguous, candidates}} ->
            {:ok, ambiguous_chapter_observation(query, spec, candidates)}

          {:error, :not_found} ->
            {:ok, not_found_chapter_observation(query, spec, index)}
        end

      :error ->
        {:ok, invalid_chapter_query_observation(query, index)}
    end
  end

  defp chapter_query(query) do
    text = String.trim(query)

    if String.starts_with?(text, "{") do
      decode_chapter_query(text)
    else
      chapter_query_from_text(text)
    end
  end

  defp chapter_query_from_text(text) do
    case bare_chapter_ref(text) do
      nil -> {:ok, {:title, text}, 0}
      uuid -> {:ok, {:ref, uuid}, 0}
    end
  end

  defp decode_chapter_query(text) do
    with {:ok, %{} = payload} <- Jason.decode(text),
         {:ok, offset} <- chapter_query_offset(payload),
         {:ok, spec} <- chapter_query_spec(payload) do
      {:ok, spec, offset}
    else
      _ -> :error
    end
  end

  defp chapter_query_offset(payload) do
    case Map.get(payload, "offset", 0) do
      offset when is_integer(offset) and offset >= 0 -> {:ok, offset}
      _ -> :error
    end
  end

  defp chapter_query_spec(payload) do
    cond do
      Map.has_key?(payload, "chapter_ref") -> chapter_ref_query_spec(payload)
      Map.has_key?(payload, "chapter_seq") -> chapter_seq_query_spec(payload)
      Map.has_key?(payload, "chapter") -> chapter_title_query_spec(payload)
      true -> :error
    end
  end

  defp chapter_ref_query_spec(payload) do
    case bare_chapter_ref(Map.get(payload, "chapter_ref")) do
      nil -> :error
      uuid -> {:ok, {:ref, uuid}}
    end
  end

  defp chapter_seq_query_spec(payload) do
    case Map.get(payload, "chapter_seq") do
      seq when is_integer(seq) and seq >= 0 -> {:ok, {:seq, seq}}
      _ -> :error
    end
  end

  defp chapter_title_query_spec(payload) do
    case Map.get(payload, "chapter") do
      title when is_binary(title) ->
        case String.trim(title) do
          "" -> :error
          trimmed -> {:ok, {:title, trimmed}}
        end

      _ ->
        :error
    end
  end

  # `chapter:<uuid>`（或裸 UUID）→ 小写规范 UUID 字符串；格式非法返回 nil。
  # 不引入 Ecto 依赖（application 层不直接依赖持久化库），用 UUID 形态校验。
  @uuid_pattern ~r/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

  defp bare_chapter_ref(value) when is_binary(value) do
    candidate =
      case String.trim(value) do
        "chapter:" <> uuid -> String.trim(uuid)
        uuid -> uuid
      end

    if Regex.match?(@uuid_pattern, candidate), do: String.downcase(candidate), else: nil
  end

  defp bare_chapter_ref(_value), do: nil

  # 解析顺序固定（I-EXPLORE-READ-7）：ref（唯一）→ seq（work 内唯一）→ 标题
  # （精确优先、唯一子串；任何多候选都返回歧义，禁止按 TOC 顺序 first-match）。
  defp resolve_chapter(chapters, {:ref, uuid}) do
    case Enum.find(chapters, &(chapter_uuid(&1) == uuid)) do
      nil -> {:error, :not_found}
      chapter -> {:ok, chapter}
    end
  end

  defp resolve_chapter(chapters, {:seq, seq}) do
    case Enum.filter(chapters, &(Map.get(&1, :seq) == seq)) do
      [chapter] -> {:ok, chapter}
      [] -> {:error, :not_found}
      many -> {:error, {:ambiguous, many}}
    end
  end

  # B30 CP3-P（Q06/Q07）：标题/展示名只是唯一命中时的别名，按当前 seq + title core 解析；
  # 历史「第NN章：」前缀不参与身份匹配（数字以当前 seq 为准，多候选不猜）。
  defp resolve_chapter(chapters, {:title, title}) do
    exact = Enum.filter(chapters, &chapter_exact_title_match?(&1, title))

    cond do
      length(exact) == 1 -> {:ok, hd(exact)}
      length(exact) > 1 -> {:error, {:ambiguous, exact}}
      true -> resolve_chapter_by_display(chapters, title)
    end
  end

  defp chapter_exact_title_match?(chapter, title) do
    raw = chapter_title(chapter)
    core = ChapterDisplay.core_title(raw)

    title in [raw, core, ChapterDisplay.display_title(chapter)]
  end

  defp resolve_chapter_by_display(chapters, title) do
    case Enum.filter(chapters, &ChapterDisplay.text_matches?(&1, title)) do
      [chapter] -> {:ok, chapter}
      [] -> {:error, :not_found}
      many -> {:error, {:ambiguous, many}}
    end
  end

  defp chapter_title(chapter) do
    case Map.get(chapter, :title) do
      title when is_binary(title) -> String.trim(title)
      _ -> ""
    end
  end

  defp chapter_uuid(chapter) do
    case Map.get(chapter, :id) do
      nil -> ""
      id -> id |> to_string() |> String.downcase()
    end
  end

  defp chapter_ref(chapter), do: "chapter:#{chapter_uuid(chapter)}"

  # 章索引（模型面，I-EXPLORE-READ-9）：与判断/计划章节索引同格式。
  defp chapter_index_lines([]), do: "（当前作品还没有章节）"

  defp chapter_index_lines(chapters) do
    Enum.map_join(chapters, "\n", fn chapter ->
      NovelApplication.ChapterListBudget.entry_line(%{
        title: chapter_title(chapter),
        seq: Map.get(chapter, :seq),
        id: chapter_uuid(chapter),
        has_prose: Map.get(chapter, :word_count, 0) > 0
      })
    end)
  end

  defp ambiguous_chapter_observation(query, spec, candidates) do
    observation(
      "chapter_read",
      query,
      "章节「#{chapter_query_label(spec)}」匹配到 #{length(candidates)} 章，存在歧义；" <>
        "请从章索引复制 chapter_ref 后重试：\n" <> chapter_index_lines(candidates),
      Enum.map(candidates, &chapter_ref/1),
      activity_summary: activity_failure_summary("chapter_read")
    )
  end

  defp not_found_chapter_observation(query, spec, index) do
    observation(
      "chapter_read",
      query,
      "没有找到「#{chapter_query_label(spec)}」。现有章索引：\n" <> index,
      [],
      activity_summary: activity_failure_summary("chapter_read")
    )
  end

  defp invalid_chapter_query_observation(query, index) do
    observation(
      "chapter_read",
      query,
      "章节检索参数无法识别：请优先复制章索引里的 chapter_ref（章节唯一标识）；" <>
        ~s(续读时用观察 footer 给出的 JSON {"chapter_ref":"chapter:<uuid>","offset":<下页起点>}；) <>
        "标题/序号只是唯一命中时的别名。\n现有章索引：\n" <> index,
      [],
      activity_summary: activity_failure_summary("chapter_read")
    )
  end

  defp chapter_query_label({:ref, uuid}), do: "chapter:#{uuid}"
  defp chapter_query_label({:seq, seq}), do: "第 #{seq} 章"
  defp chapter_query_label({:title, title}), do: title

  defp chapter_read_page(work_id, chapter, volume, query, offset) do
    case ReadingProjectionService.chapter_content(chapter.id, work_id) do
      {:ok, content} ->
        prose = content.scenes |> Enum.map_join("\n", & &1.content)
        total = String.length(prose)

        cond do
          total == 0 and offset == 0 ->
            empty_chapter_observation(work_id, chapter, volume, query)

          offset > total ->
            out_of_range_observation(chapter, query, total)

          offset == total ->
            end_of_chapter_observation(chapter, query, offset, total)

          true ->
            paged_chapter_observation(
              work_id,
              chapter,
              volume,
              query,
              offset,
              prose,
              total,
              content.word_count
            )
        end

      {:error, :not_found} when offset > 0 ->
        out_of_range_observation(chapter, query, 0)

      {:error, :not_found} ->
        {:ok, empty_chapter_observation(work_id, chapter, volume, query)}
    end
  end

  defp empty_chapter_observation(work_id, chapter, volume, query) do
    sections =
      [chapter_plan_section(chapter, volume), chapter_summary_section(work_id, chapter)] ++
        ["【正文】还没有已采纳正文。"]

    {:ok,
     observation(
       "chapter_read",
       query,
       chapter_title_line(chapter) <> "\n" <> Enum.join(sections, "\n"),
       [chapter_ref(chapter)],
       activity_summary:
         "已阅读章节正文「#{chapter_title(chapter)}」#{chapter_seq_text(chapter)}（本章尚无已采纳正文）。",
       extra: chapter_identity_keys(chapter)
     )}
  end

  defp out_of_range_observation(chapter, query, total) do
    {:ok,
     observation(
       "chapter_read",
       query,
       chapter_title_line(chapter) <>
         "\noffset 超出正文范围（共 #{total} 字符）；" <>
         ~s(从头读用 offset=0，或使用上一页给出的 next_offset。),
       [chapter_ref(chapter)],
       activity_summary: "已尝试阅读章节正文「#{chapter_title(chapter)}」，但读取位置超出正文范围。",
       extra: chapter_identity_keys(chapter)
     )}
  end

  defp end_of_chapter_observation(chapter, query, offset, total) do
    range = if offset > 0, do: "（第 #{offset} 字符之后）", else: ""

    {:ok,
     observation(
       "chapter_read",
       query,
       chapter_title_line(chapter) <>
         "\noffset 到达正文末尾（共 #{total} 字符）#{range}，已无更多内容。",
       [chapter_ref(chapter)],
       activity_summary:
         "已阅读章节正文「#{chapter_title(chapter)}」#{chapter_seq_text(chapter)}（已到正文末尾，共 #{total} 字符）。",
       extra: chapter_identity_keys(chapter)
     )}
  end

  defp paged_chapter_observation(
         work_id,
         chapter,
         volume,
         query,
         offset,
         prose,
         total,
         word_count
       ) do
    {page_text, page_end, next_offset} = chapter_page(prose, offset, total)

    sections =
      header_sections(work_id, chapter, volume, offset) ++
        [prose_page_section(offset, page_end, total, word_count, page_text)] ++
        continue_section(chapter, next_offset, total, page_end)

    {:ok,
     observation(
       "chapter_read",
       query,
       chapter_title_line(chapter) <> "\n" <> Enum.join(sections, "\n"),
       [chapter_ref(chapter)],
       clip: false,
       activity_summary: chapter_activity_summary(chapter, offset, page_end, total, word_count),
       extra:
         Map.merge(chapter_identity_keys(chapter), %{
           next_offset: next_offset,
           prose_total_chars: total,
           prose_range: %{start: offset + 1, end: page_end}
         })
     )}
  end

  # 【计划】【摘要】只在首页（offset=0）返回；续读页不重复（I-EXPLORE-READ-3 的
  # 省流约定，D4）。
  defp header_sections(work_id, chapter, volume, 0),
    do: [chapter_plan_section(chapter, volume), chapter_summary_section(work_id, chapter)]

  defp header_sections(_work_id, _chapter, _volume, _offset), do: []

  # I-EXPLORE-READ-1：页范围首尾相接、无重叠、无缺口；优先在 ≤ offset+6000 内最靠后
  # 的 "\n\n" 段落边界切页（不把段落劈开），无段落边界按 6000 硬切。
  defp chapter_page(prose, offset, total) do
    hard_end = min(offset + @chapter_page_chars, total)

    page_end =
      if hard_end < total,
        do: paragraph_boundary(prose, offset, hard_end) || hard_end,
        else: hard_end

    page_text = String.slice(prose, offset, page_end - offset)
    next_offset = if page_end < total, do: page_end, else: nil

    {page_text, page_end, next_offset}
  end

  defp paragraph_boundary(prose, offset, hard_end) do
    window = String.slice(prose, offset, hard_end - offset)

    case String.split(window, "\n\n") do
      [_single] ->
        nil

      parts ->
        boundary = String.length(window) - String.length(List.last(parts)) - 2
        # boundary == 0 会让本页为空，退回硬切（页从 offset 开始）。
        if boundary > 0, do: offset + boundary, else: nil
    end
  end

  defp prose_page_section(offset, page_end, total, word_count, page_text) do
    "【正文】第 #{offset + 1}–#{page_end} 字符 / 共 #{total} 字符（有效字数 #{word_count}）\n#{page_text}"
  end

  defp continue_section(_chapter, nil, _total, _page_end), do: []

  defp continue_section(chapter, next_offset, total, page_end) do
    # 逐字冻结 footer 形状（contract §1.1(b)）：分页必须复用同一 chapter_ref，
    # JSON 键序固定为 chapter_ref → offset，便于模型照抄与外部验收断言。
    query =
      "{\"chapter_ref\":\"" <>
        chapter_ref(chapter) <> "\",\"offset\":" <> Integer.to_string(next_offset) <> "}"

    ["【续读】剩余 #{total - page_end} 字符；用 #{query} 继续。"]
  end

  defp chapter_activity_summary(chapter, 0, _page_end, _total, word_count) do
    "已阅读章节正文「#{chapter_title(chapter)}」#{chapter_seq_text(chapter)}（有效字数 #{word_count}）。"
  end

  defp chapter_activity_summary(chapter, offset, page_end, total, _word_count) do
    detail = "第 #{offset + 1}–#{page_end} 字符 / 共 #{total} 字符"

    "已阅读章节正文「#{chapter_read_display_title(chapter)}」" <>
      chapter_detail_text(chapter, detail) <> "。"
  end

  # 作者可见标题行（模型面）：seq + title 双面身份；作者面只从 activity_summary 取。
  defp chapter_title_line(chapter) do
    core = ChapterDisplay.core_title(chapter_title(chapter))
    core = if core == "", do: chapter_title(chapter), else: core

    case Map.get(chapter, :seq) do
      seq when is_integer(seq) -> "「#{core}」（第 #{seq} 章）"
      _ -> "「#{chapter_title(chapter)}」"
    end
  end

  defp chapter_read_display_title(chapter) do
    raw = chapter_title(chapter)
    core = ChapterDisplay.core_title(raw)
    if core == "", do: raw, else: core
  end

  defp chapter_seq_text(chapter) do
    case Map.get(chapter, :seq) do
      seq when is_integer(seq) -> "（第 #{seq} 章）"
      _ -> ""
    end
  end

  defp chapter_detail_text(chapter, detail) do
    case Map.get(chapter, :seq) do
      seq when is_integer(seq) -> "（第 #{seq} 章；#{detail}）"
      _ -> "（#{detail}）"
    end
  end

  defp chapter_identity_keys(chapter) do
    %{chapter_ref: chapter_ref(chapter), chapter_seq: Map.get(chapter, :seq)}
  end

  # 设计态（E18-E22 结构化计划；ADR-0025 CP5b 探索补面 A）：无结构化计划时
  # 回退 chapters.summary（大纲采纳的单行方向），两者皆无则诚实说明。
  # B11A CP4（VS-00J §4 消费面 4 / 08 §8 探索面同步律）：所属卷与当前卷蓝图摘要
  # 同批可读；卷无设计态蓝图时整段不渲染（I-VOL-4：与今天逐字节一致）。
  defp chapter_plan_section(chapter, volume) do
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
            {"篇幅与场次", direction.word_count_and_scenes},
            {"场次计划", scene_plans_text(direction.scene_plans)},
            {"本章使命", chapter_mission_text(direction.chapter_mission)}
          ]
          |> Enum.reject(fn {_label, value} -> value in [nil, ""] end)
          |> Enum.map_join("；", fn {label, value} -> "#{label}：#{value}" end)
      end

    "【计划】#{clip_section(append_volume_text(rendered, volume), @chapter_plan_max_chars)}"
  end

  # 本章所属卷（按 TOC 卷节点反查：章的 volume_id / 章 id 归组）。
  defp chapter_volume(volumes, chapter) do
    Enum.find(volumes, fn volume ->
      Enum.any?(Map.get(volume, :chapters, []), &(&1.id == Map.get(chapter, :id)))
    end)
  end

  defp append_volume_text(rendered, volume) do
    case volume_blueprint_text(volume) do
      "" -> rendered
      text -> rendered <> "；" <> text
    end
  end

  defp volume_blueprint_text(nil), do: ""

  defp volume_blueprint_text(volume) do
    blueprint = volume |> Map.get(:blueprint) |> VolumeBlueprint.to_storage()

    if VolumeBlueprint.empty?(blueprint) do
      ""
    else
      summary = blueprint |> VolumeBlueprint.summary_lines() |> Enum.join("；")

      [
        volume_title_text(Map.get(volume, :title)),
        if(summary == "", do: nil, else: "当前卷蓝图：#{summary}")
      ]
      |> Enum.reject(&is_nil/1)
      |> Enum.join("；")
    end
  end

  defp volume_title_text(title) when is_binary(title) do
    case String.trim(title) do
      "" -> nil
      trimmed -> "所属卷：#{trimmed}"
    end
  end

  defp volume_title_text(_title), do: nil

  # 场次计划（NEM04 刀③，探索面同步律）：规划落库的逐场三槽在判断循环内可读。
  # B11C CP1：VS-00E §1 场级结构子槽（因果/信息差/对白/感官）同批可读；缺子槽不渲染。
  defp scene_plans_text([]), do: nil

  defp scene_plans_text(plans) when is_list(plans) do
    Enum.map_join(plans, " / ", fn plan ->
      slots = plan |> ChapterPlanDirection.scene_slot_lines() |> Enum.join("；")

      if slots == "", do: plan["title"], else: "#{plan["title"]}（#{slots}）"
    end)
  end

  # 本章使命（WR01b，探索面同步律）：落章计划的使命与裁决状态在判断循环内可读。
  defp chapter_mission_text(nil), do: nil

  defp chapter_mission_text(mission) do
    case NovelDomain.ChapterMission.from_map(mission) do
      %NovelDomain.ChapterMission{statement: statement} = m when is_binary(statement) ->
        items =
          Enum.map(m.must_advance, &"必须推进：#{&1["text"]}") ++
            Enum.map(m.must_avoid, &"不得：#{&1["text"]}")

        status = mission_status_label(m.status)
        Enum.join(["#{statement}（#{status}）" | items], "；")

      _ ->
        nil
    end
  end

  defp mission_status_label(@chapter_mission_confirmed), do: "作者已确认"
  defp mission_status_label(@chapter_mission_author_edited), do: "作者改写"
  defp mission_status_label(_), do: "暂定"

  # 实现态压缩层（chapter_summaries 治理摘要；CP5b 探索补面 B）。
  defp chapter_summary_section(work_id, chapter) do
    case ChapterSummaryRepo.current_accepted(work_id, chapter.id) do
      %{summary_text: text} when is_binary(text) and text != "" ->
        "【摘要】#{clip_section(text, @chapter_summary_max_chars)}"

      _ ->
        "【摘要】（尚无章摘要）"
    end
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

  # B24（I-EXPLORE-READ-8）：作者可见活动文案集中映射。内部工具 id、原始 query
  # JSON、offset 字段只留在 payload / trace / developer 面，作者面只看到人话。
  # 页面（agentic loop 时间线）与 app 事件 summary 都从 observation.activity_summary 取。
  @spec activity_summary(map()) :: String.t()
  def activity_summary(%{activity_summary: text}) when is_binary(text), do: text

  def activity_summary(%{tool: tool, query: query}),
    do: activity_text(to_string(tool), query || "")

  def activity_summary(_observation), do: "已完成一次作品检索。"

  @doc "探索工具失败时给作者的诚实人话（不含内部工具 id / inspect 结构）。"
  @spec activity_failure_summary(String.t() | nil) :: String.t()
  def activity_failure_summary("chapter_read"), do: "章节检索未完成，可换个章名再试。"
  def activity_failure_summary(_tool), do: "作品检索未完成，可换个检索词再试。"

  defp activity_text("chapter_read", query) do
    text = to_string(query)

    if String.starts_with?(String.trim(text), "{") do
      "已阅读章节正文。"
    else
      "已阅读章节正文「#{text}」。"
    end
  end

  defp activity_text("prose_search", query), do: "已检索正文「#{query}」。"
  defp activity_text("session_adoptions", _query), do: "已查询当前会话候选。"
  defp activity_text("memory_recall", query), do: "已检索记忆「#{query}」。"

  defp activity_text("archive_read", facet),
    do: "已查阅作品档案：#{archive_facet_label(facet)}。"

  defp activity_text(_tool, _query), do: "已完成一次作品检索。"

  defp archive_facet_label("profile"), do: "作品简介"
  defp archive_facet_label("characters"), do: "角色档案"
  defp archive_facet_label("foreshadowing"), do: "伏笔"
  defp archive_facet_label("rules"), do: "写作规则"
  defp archive_facet_label("stats"), do: "作品统计"
  defp archive_facet_label("current_state"), do: "当前状态"
  defp archive_facet_label("relationships"), do: "人物关系"
  defp archive_facet_label("preferences"), do: "作者偏好"
  defp archive_facet_label("ledgers"), do: "脉络账本"
  defp archive_facet_label(_facet), do: "作品档案"

  defp observation(tool, query, summary, refs, opts \\ []) do
    summary = observation_summary(summary, Keyword.get(opts, :clip, true))

    base = %{
      tool: tool,
      query: query,
      summary: summary,
      refs: refs,
      activity_summary: observation_activity_value(tool, query, opts)
    }

    observation_extra(base, Keyword.get(opts, :extra))
  end

  defp observation_summary(summary, false), do: summary
  defp observation_summary(summary, _clip), do: clip(summary, @summary_max_chars)

  defp observation_activity_value(tool, query, opts) do
    case Keyword.get(opts, :activity_summary) do
      activity when is_binary(activity) -> activity
      _ -> activity_text(tool, query)
    end
  end

  defp observation_extra(base, extra) when is_map(extra), do: Map.merge(base, extra)
  defp observation_extra(base, _extra), do: base

  defp clip(text, max) do
    if String.length(text) > max do
      String.slice(text, 0, max) <> "…（截断）"
    else
      text
    end
  end

  # B24 分段预算的段内截断：截断后总长不超过 max（含「…（略）」标记）。
  defp clip_section(text, max) do
    if String.length(text) > max do
      String.slice(text, 0, max - String.length(@section_ellipsis)) <> @section_ellipsis
    else
      text
    end
  end
end
