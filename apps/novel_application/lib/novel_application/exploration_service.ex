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
    AuthorContentRegistration,
    ChapterDisplay,
    MemoryManagementService,
    ReadingProjectionService,
    SessionMessageRead,
    WorkArchiveService
  }

  alias NovelDomain.ProseFormatting

  alias NovelPersistence.{
    ChapterSummaryRepo,
    LocalizedRevision,
    ProseSearchRepo,
    ReadingProjectionRepo,
    WorkSessionRepo
  }

  # 观察 v2（B24）：基础形状不变（tool/query/summary/refs），chapter_read 观察
  # additive 携带续读/身份元数据（I-EXPLORE-READ-3/7/9）。
  #
  # B28 T4 R10（观察分类）：`outcome` 区分「检索完成的观察」与「工具失败」——
  # target_not_found / ambiguous_target / invalid_query / empty_content / empty_result
  # 都是**已完成**的只读检索结果（informational），不得渲染为「检索未完成」；
  # `:failed` 只由调用方在工具执行出错时标记。`facts` 是澄清派生用的机械事实
  # （章数/命中数/字符数），只进 developer 面，作者面仍只用 activity_summary。
  @type observation_outcome ::
          :observed
          | :partial
          | :empty_result
          | :target_not_found
          | :ambiguous_target
          | :invalid_query
          | :empty_content
          | :out_of_range
          | :end_of_content
          | :failed

  @type observation :: %{
          required(:tool) => String.t(),
          required(:query) => String.t(),
          required(:summary) => String.t(),
          required(:refs) => [String.t()],
          optional(:versions) => %{String.t() => pos_integer() | String.t()},
          optional(:coverage) => map(),
          optional(:omissions) => [String.t()],
          required(:outcome) => observation_outcome(),
          required(:facts) => map(),
          optional(:activity_summary) => String.t(),
          optional(:chapter_ref) => String.t(),
          optional(:chapter_seq) => integer() | nil,
          optional(:next_offset) => non_neg_integer() | nil,
          optional(:prose_total_chars) => non_neg_integer(),
          optional(:prose_range) => %{start: pos_integer(), end: non_neg_integer()} | nil,
          optional(:source_hash) => String.t(),
          optional(:prose_byte_range) => %{start: non_neg_integer(), end: non_neg_integer()},
          optional(:target_segments) => [map()]
        }

  @observation_statuses %{
    "failed" => "unavailable",
    "partial" => "partial",
    "truncated" => "truncated",
    "stale" => "stale"
  }
  @summary_max_chars 1500
  # B24（I-EXPLORE-READ-2）：观察 v2 分段预算——设计态材料另计上限，正文单页 6000
  # 字符。旧口径把三段拼成一条 1500 clip，设计态材料加料后正文只剩 216/4398 字
  # （2026-10-23 stage 实锤），故计划/摘要不再与正文共享同一条预算。
  @chapter_plan_max_chars 500
  @chapter_summary_max_chars 400
  @chapter_page_chars 6000
  @section_ellipsis "…（略）"
  @adoption_page_size 3

  # 判断探索共用配额；纯只读计划中的机械准备步不重复读取、不消耗该配额。
  @max_explore_rounds 2
  @max_page_continuation_rounds 8
  @read_only_plan_targets ~w(context_assemble character_roster prose_search chapter_read archive_read memory_recall)
  @exploration_plan_targets ~w(prose_search chapter_read archive_read memory_recall)

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
      query_help:
        ~s(先经 archive_read 的 chapters 目录发现章节；复制真实标题，或 JSON {"chapter_ref":"<ref>","offset":0}；续读采用 next_offset),
      description: "读取某一章的设计计划、章摘要与已采纳正文（长章分页，按观察内【续读】继续）"
    },
    %{
      tool: "archive_read",
      query_help:
        ~s(档案面 profile｜chapters｜characters｜foreshadowing｜rules｜stats｜current_state｜relationships｜preferences｜ledgers；chapters/characters 无 ref 时返回目录；详情用 JSON {"facet":"chapters","ref":"<目录ref>","offset":0}（角色详情改用 characters），chapters 详情读取完整计划/卷蓝图/已采纳章摘要；按 next_offset 续读，目录用 {"facet":"<目录面>","offset":<next_offset>}),
      description: "按需发现对象并读取作品档案；目录不等于已读正文或角色修订基线"
    },
    %{
      tool: "session_adoptions",
      query_help:
        ~s(关键词或 artifact_ref 查目录，空串查全部；目录翻页 {"query":"关键词","offset":3}；全文详情 {"artifact_ref":"<真实ref>","offset":0}，按 next_offset 续读),
      description: "查询当前会话完整待采纳/已处置候选，返回实际数量、来源和下一页，不受聊天窗口限制"
    },
    %{
      tool: "session_message_read",
      query_help:
        ~s(JSON {"run_id":"<来源 run_id>","run_sequence":<来源消息序号>,"offset":0}；续读采用 next_offset，offset 单位为 Unicode grapheme),
      description: "按整理记录中的消息来源回查当前会话的作者原话或模型纯文本答复；保留原文、来源与分页范围"
    },
    %{
      tool: "memory_recall",
      query_help:
        ~s(检索词返回有界摘要和真实 memory_ref；完整正文用 {"memory_ref":"memory:<id>","offset":0}，按 next_offset 续读),
      description: "检索治理记忆（已确认的设定、约束、方向），摘要与完整正文覆盖分开"
    }
  ]

  @spec catalog() :: [map()]
  def catalog, do: @catalog

  @spec tool_names() :: [String.t()]
  def tool_names, do: Enum.map(@catalog, & &1.tool)

  @doc "判断循环的实际读取上界；普通读取与真实下一页共用。"
  def max_steps, do: @max_explore_rounds + @max_page_continuation_rounds

  # 分页续读额度：普通探索 2 轮后，只对上一真实只读来源的精确下一页开放。
  # 所有读取共用 @max_page_continuation_rounds 上界，不另建探索循环。
  def budget(explorations) do
    total = length(explorations)
    normal_open? = total < @max_explore_rounds
    continuation = continuation_target(List.last(explorations))
    extra = max(total - @max_explore_rounds, 0)
    continuation_open? = continuation != nil and extra < @max_page_continuation_rounds

    %{
      open?: normal_open? or continuation_open?,
      normal_open?: normal_open?,
      continuation_open?: continuation_open?,
      continuation_only?: not normal_open? and continuation_open?,
      continuation: continuation,
      total: total
    }
  end

  defp continuation_target(%{
         tool: "session_message_read",
         next_offset: offset,
         facts: %{run_id: run_id, run_sequence: sequence},
         coverage: %{total_graphemes: total, range: %{end_exclusive: stop}}
       })
       when is_integer(offset) do
    %{
      tool: "session_message_read",
      run_id: run_id,
      run_sequence: sequence,
      next_offset: offset,
      total: total,
      read_end: stop
    }
  end

  defp continuation_target(%{tool: "chapter_read"} = observation) do
    next_offset = Map.get(observation, :next_offset)

    if is_integer(next_offset) do
      %{
        tool: "chapter_read",
        chapter_ref: Map.get(observation, :chapter_ref),
        next_offset: next_offset,
        total: Map.get(observation, :prose_total_chars),
        read_end: get_in(observation, [:prose_range, :end]) || next_offset
      }
    end
  end

  defp continuation_target(%{
         tool: "archive_read",
         next_offset: offset,
         coverage: %{
           kind: "directory",
           facet: facet,
           offset: start,
           returned_items: returned,
           total_items: total
         }
       })
       when is_integer(offset) and offset == start + returned and offset > start and
              offset < total do
    %{
      tool: "archive_read",
      kind: "directory",
      facet: facet,
      ref: nil,
      next_offset: offset,
      total: total,
      read_end: offset,
      offset_unit: "item"
    }
  end

  defp continuation_target(%{
         tool: "archive_read",
         next_offset: offset,
         coverage:
           %{
             kind: kind,
             facet: facet,
             summary: %{offset: start, returned_graphemes: returned, total_graphemes: total}
           } = coverage
       })
       when kind in ["detail", "facet"] and is_integer(offset) and
              offset == start + returned and offset > start and offset < total do
    %{
      tool: "archive_read",
      kind: kind,
      facet: facet,
      ref: Map.get(coverage, :ref),
      next_offset: offset,
      total: total,
      read_end: offset,
      offset_unit: "unicode_grapheme"
    }
  end

  defp continuation_target(%{
         tool: "session_adoptions",
         next_offset: offset,
         coverage: %{
           kind: "directory",
           query: query,
           offset: start,
           returned_items: returned,
           total_items: total
         }
       })
       when is_integer(offset) and offset == start + returned and offset > start and
              offset < total do
    %{
      tool: "session_adoptions",
      kind: "directory",
      query: query,
      next_offset: offset,
      total: total,
      read_start: start,
      read_end: offset,
      offset_unit: "item"
    }
  end

  defp continuation_target(%{
         tool: tool,
         next_offset: offset,
         coverage:
           %{
             kind: "detail",
             summary: %{offset: start, returned_graphemes: returned, total_graphemes: total}
           } = coverage
       })
       when tool in ["session_adoptions", "memory_recall"] and is_integer(offset) and
              offset == start + returned and offset > start and offset < total do
    coverage
    |> Map.take([:artifact_ref, :memory_ref])
    |> Map.merge(%{
      tool: tool,
      kind: "detail",
      next_offset: offset,
      total: total,
      read_start: start,
      read_end: offset,
      offset_unit: "unicode_grapheme"
    })
  end

  defp continuation_target(_observation), do: nil

  def allowed_tools(%{continuation_only?: true, continuation: %{tool: tool}}), do: [tool]
  def allowed_tools(%{open?: true}), do: tool_names()
  def allowed_tools(_budget), do: []

  @doc "返回纯只读计划将实际读取的步骤；上下文和阵容已经准备，不重复执行。"
  def inline_plan_steps(%{steps: steps}) when is_list(steps) do
    if steps != [] and Enum.all?(steps, &(&1.target_tool_ref in @read_only_plan_targets)) do
      Enum.filter(steps, &(&1.target_tool_ref in @exploration_plan_targets))
    end
  end

  @doc "计划内联与单次探索复用当前 Scope 的同一读取资格，不把计划当授权。"
  def validate_inline_plan(plan, options) do
    case inline_plan_steps(plan) do
      nil ->
        :ok

      steps ->
        steps
        |> Enum.map(&%{tool: &1.target_tool_ref, query: &1.exploration_query || ""})
        |> validate_requests(options)
    end
  end

  @doc "在任何读取前校验整组请求；未来观察尚未授予的续页不能预支。"
  def validate_requests([], _options), do: :ok

  def validate_requests(requests, options) when is_list(requests) do
    budget = Keyword.get(options, :exploration_budget, %{})
    continuation_only? = Map.get(budget, :continuation_only?, false)

    remaining =
      if continuation_only?,
        do: 1,
        else: max(@max_explore_rounds - Map.get(budget, :total, 0), 0)

    cond do
      continuation_only? and
          Enum.any?(requests, fn request ->
            not continuation_request?(request.tool, request.query, Map.get(budget, :continuation))
          end) ->
        {:error, :exploration_continuation_mismatch}

      not Keyword.get(options, :explore, false) or not Map.get(budget, :open?, true) or
          Enum.any?(requests, &(&1.tool not in Keyword.get(options, :explore_tools, []))) ->
        {:error, :exploration_not_available}

      length(requests) > remaining ->
        {:error, :exploration_budget_exceeded}

      true ->
        :ok
    end
  end

  @doc "只认上一真实页的同源下一坐标；复用各读口解析规则，不执行读取或推断目标。"
  @spec continuation_request?(String.t(), String.t(), map() | nil) :: boolean()
  def continuation_request?(
        "chapter_read",
        query,
        %{tool: "chapter_read", chapter_ref: ref, next_offset: offset}
      )
      when is_binary(query) and is_integer(offset) and offset > 0 do
    case chapter_query(query) do
      {:ok, {:ref, uuid}, ^offset} -> bare_chapter_ref(ref) == uuid
      _ -> false
    end
  end

  def continuation_request?(
        "session_message_read",
        query,
        %{
          tool: "session_message_read",
          run_id: run_id,
          run_sequence: sequence,
          next_offset: offset
        }
      )
      when is_integer(offset) and offset > 0 do
    SessionMessageRead.parse_query(query) ==
      {:ok, %{run_id: run_id, run_sequence: sequence, offset: offset}}
  end

  def continuation_request?(
        "archive_read",
        query,
        %{tool: "archive_read", facet: facet, ref: ref, next_offset: offset}
      )
      when is_binary(query) and is_integer(offset) and offset > 0 do
    WorkArchiveService.selector(String.trim(query)) ==
      {:ok, %{facet: facet, ref: ref, offset: offset}}
  end

  def continuation_request?("session_adoptions", query, %{
        tool: "session_adoptions",
        kind: "directory",
        query: search,
        next_offset: offset
      })
      when is_integer(offset) and offset > 0 do
    adoption_query(query) == {:ok, %{kind: "directory", query: search, offset: offset}}
  end

  def continuation_request?("session_adoptions", query, %{
        tool: "session_adoptions",
        kind: "detail",
        artifact_ref: ref,
        next_offset: offset
      })
      when is_integer(offset) and offset > 0 do
    adoption_query(query) == {:ok, %{kind: "detail", artifact_ref: ref, offset: offset}}
  end

  def continuation_request?("memory_recall", query, %{
        tool: "memory_recall",
        memory_ref: ref,
        next_offset: offset
      })
      when is_integer(offset) and offset > 0 do
    MemoryManagementService.recall_selector(query) ==
      {:ok, %{kind: "detail", memory_ref: ref, offset: offset}}
  end

  def continuation_request?(_tool, _query, _continuation), do: false

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
         {:ok, selector} <- adoption_query(query) do
      state = WorkSessionRepo.adoption_state(work_id, session_id)
      adoption_read(state, selector, %{work_id: work_id, session_id: session_id}, query || "")
    else
      {:error, reason} -> {:error, reason}
      _ -> {:error, :active_session_not_found}
    end
  end

  def run(_work_id, "session_adoptions", _query, _session_id),
    do: {:error, :active_session_not_found}

  def run(work_id, "session_message_read", query, session_id),
    do: SessionMessageRead.run(work_id, query, session_id)

  def run(work_id, tool, query, _session_id), do: run(work_id, tool, query)

  defp adoption_query(query) do
    text = String.trim(query || "")

    if String.starts_with?(text, "{") do
      text |> Jason.decode() |> adoption_selector()
    else
      {:ok, %{kind: "directory", query: text, offset: 0}}
    end
  end

  defp adoption_selector({:ok, %{"query" => search, "offset" => offset} = decoded})
       when map_size(decoded) == 2 and is_binary(search) and is_integer(offset) and offset >= 0,
       do: {:ok, %{kind: "directory", query: search, offset: offset}}

  defp adoption_selector({:ok, %{"artifact_ref" => ref, "offset" => offset} = decoded})
       when map_size(decoded) == 2 and is_binary(ref) and ref != "" and is_integer(offset) and
              offset >= 0,
       do: {:ok, %{kind: "detail", artifact_ref: ref, offset: offset}}

  defp adoption_selector(_decoded), do: {:error, :invalid_adoption_query}

  defp adoption_read(state, %{kind: "directory", query: search, offset: offset}, scope, query) do
    matches = matching_adoptions(state.pending_adoptions ++ state.resolved_adoptions, search)

    with :ok <- read_offset(offset, length(matches), :adoption_offset_out_of_range) do
      page = Enum.slice(matches, offset, @adoption_page_size)
      next = offset + length(page)
      next_offset = if next < length(matches), do: next, else: nil

      summary = %{
        pending_count: length(state.pending_adoptions),
        resolved_count: length(state.resolved_adoptions),
        matched_count: length(matches),
        offset: offset,
        next_offset: next_offset,
        items: Enum.map(page, &adoption_observation/1)
      }

      coverage =
        Map.merge(scope, %{
          kind: "directory",
          query: search,
          offset: offset,
          returned_items: length(page),
          total_items: length(matches),
          offset_unit: "item"
        })

      {:ok,
       observation(
         "session_adoptions",
         query,
         Jason.encode!(summary),
         Enum.map(page, & &1["artifact_id"]),
         clip: false,
         outcome:
           if(matches == [],
             do: :empty_result,
             else: if(next_offset, do: :partial, else: :observed)
           ),
         facts: Map.take(summary, [:matched_count, :pending_count]),
         extra: %{
           versions: %{},
           coverage: coverage,
           next_offset: next_offset,
           omissions: ["目录仅供定位、状态与来源，未读取候选正文；全文使用 artifact_ref/offset 详情。"]
         }
       )}
    end
  end

  defp adoption_read(state, %{artifact_ref: ref, offset: offset}, scope, query) do
    entry =
      Enum.find(state.pending_adoptions ++ state.resolved_adoptions, &(&1["artifact_id"] == ref))

    with entry when not is_nil(entry) <- entry,
         {:ok, page} <-
           source_page(
             NovelApplication.TurnInteractionService.artifact_body(entry),
             offset,
             :adoption_offset_out_of_range
           ) do
      coverage = Map.merge(scope, %{kind: "detail", artifact_ref: ref, summary: page.range})

      {:ok,
       observation("session_adoptions", query, page.text, [ref],
         clip: false,
         outcome: page.outcome,
         facts: %{artifact: adoption_observation(entry)},
         extra:
           Map.merge(Map.drop(page, [:text, :range, :outcome]), %{
             versions: %{},
             coverage: coverage
           })
       )}
    else
      nil -> {:error, :adoption_not_found}
      {:error, reason} -> {:error, reason}
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
      source_ref: AuthorContentRegistration.author_source_ref(entry),
      content_source_ref: entry["source_tool_result_ref"],
      title: String.slice(to_string(payload["summary"] || item["title"] || ""), 0, 100),
      revision_of: payload["revision_of"],
      available_operations: NovelApplication.PendingArtifactWorkflow.operations(entry)
    }
  end

  # ── prose_search ──

  defp prose_search(_work_id, ""), do: {:error, :empty_query}

  defp prose_search(work_id, query) do
    case ProseSearchRepo.search(work_id, query) do
      {:ok, []} ->
        {:ok,
         observation("prose_search", query, "正文中未检索到「#{query}」。", [],
           outcome: :empty_result,
           facts: %{hit_count: 0},
           activity_summary: "已检索正文「#{query}」：没有命中任何章节。"
         )}

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
           Enum.map(hits, &"chapter:#{&1.chapter_id}"),
           facts: %{hit_count: length(hits)}
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

    case chapter_query(query) do
      {:ok, spec, offset} ->
        case resolve_chapter(chapters, spec) do
          {:ok, chapter} ->
            volume = chapter_volume(volumes, chapter)
            chapter_read_page(work_id, chapter, volume, query, offset)

          {:error, {:ambiguous, candidates}} ->
            {:ok, ambiguous_chapter_observation(query, spec, candidates)}

          {:error, :not_found} ->
            {:ok, not_found_chapter_observation(query, spec, chapters)}
        end

      :error ->
        {:ok, invalid_chapter_query_observation(query, chapters)}
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

  # 三种解析失败都是**已完成检索**的观察（informational）：检索确实执行完并得到
  # 了「不存在/有歧义/参数不可识别」的事实，不是工具失败。失败类文案只由调用方在
  # `{:error, _}` 时使用（activity_failure_summary/1）。
  defp ambiguous_chapter_observation(query, spec, candidates) do
    observation(
      "chapter_read",
      query,
      "章节「#{chapter_query_label(spec)}」匹配到 #{length(candidates)} 章，存在歧义；" <>
        "请从章索引复制 chapter_ref 后重试：\n" <> chapter_index_lines(candidates),
      Enum.map(candidates, &chapter_ref/1),
      outcome: :ambiguous_target,
      facts: %{matched_count: length(candidates)},
      activity_summary:
        "已检索章节#{chapter_activity_target(spec)}：匹配到 #{length(candidates)} 章，需要先确定唯一章节。"
    )
  end

  defp not_found_chapter_observation(query, spec, chapters) do
    observation(
      "chapter_read",
      query,
      "没有找到「#{chapter_query_label(spec)}」。现有章索引：\n" <> chapter_index_lines(chapters),
      [],
      outcome: :target_not_found,
      facts: %{chapter_count: length(chapters)},
      activity_summary: chapter_not_found_activity(spec, length(chapters))
    )
  end

  defp invalid_chapter_query_observation(query, chapters) do
    observation(
      "chapter_read",
      query,
      "章节检索参数无法识别：请优先复制章索引里的 chapter_ref（章节唯一标识）；" <>
        ~s(续读时用观察 footer 给出的 JSON {"chapter_ref":"chapter:<uuid>","offset":<下页起点>}；) <>
        "标题/序号只是唯一命中时的别名。\n现有章索引：\n" <> chapter_index_lines(chapters),
      [],
      outcome: :invalid_query,
      facts: %{chapter_count: length(chapters)},
      activity_summary: "已检索章节：检索参数无法识别，没能定位到章节。"
    )
  end

  # 作者面章节指代只用人话（章名/序号）；内部 ref 形态不进入 activity（B24
  # I-EXPLORE-READ-8：作者面不含内部 id）。
  defp chapter_activity_target({:title, title}), do: "「#{title}」"
  defp chapter_activity_target({:seq, seq}), do: "「第 #{seq} 章」"
  defp chapter_activity_target({:ref, _uuid}), do: ""

  defp chapter_not_found_activity({:ref, _uuid}, 0), do: "已检索指定章节：作品当前还没有章节。"

  defp chapter_not_found_activity({:ref, _uuid}, chapter_count),
    do: "已检索指定章节：当前作品有 #{chapter_count} 章，但该章节标识没有匹配到章节。"

  defp chapter_not_found_activity(spec, 0),
    do: "已检索章节#{chapter_activity_target(spec)}：作品当前还没有章节。"

  defp chapter_not_found_activity(spec, chapter_count) do
    "已检索章节#{chapter_activity_target(spec)}：当前作品有 #{chapter_count} 章，但没有这个章名。"
  end

  defp chapter_query_label({:ref, uuid}), do: "chapter:#{uuid}"
  defp chapter_query_label({:seq, seq}), do: "第 #{seq} 章"
  defp chapter_query_label({:title, title}), do: title

  defp chapter_read_page(work_id, chapter, volume, query, offset) do
    case ReadingProjectionService.chapter_content(chapter.id, work_id) do
      {:ok, content} ->
        # 与阅读投影/B28/B36 同一 canonical 正文（双 LF、剔除未写/空场），
        # 分页与版本选择都基于这份正文及其字节区间，不新增 DB 查询。
        {prose, spans} = ReadingProjectionRepo.assemble_chapter_prose(content.scenes)
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
              {prose, spans},
              total,
              content.word_count
            )
        end

      {:error, :not_found} when offset > 0 ->
        out_of_range_observation(chapter, query, 0)

      {:error, :not_found} ->
        empty_chapter_observation(work_id, chapter, volume, query)
    end
  end

  defp empty_chapter_observation(work_id, chapter, volume, query) do
    header = header_sections(work_id, chapter, volume, 0)
    sections = header.sections ++ ["【正文】还没有已采纳正文。"]

    {:ok,
     observation(
       "chapter_read",
       query,
       chapter_title_line(chapter) <> "\n" <> Enum.join(sections, "\n"),
       [chapter_ref(chapter) | header.refs],
       clip: false,
       outcome: :empty_content,
       facts: %{prose_chars: 0},
       activity_summary: "已核查章节#{chapter_title_line(chapter)}：本章尚无已采纳正文。",
       extra: Map.merge(chapter_identity_keys(chapter), Map.take(header, [:coverage, :omissions]))
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
       outcome: :out_of_range,
       facts: %{prose_chars: total},
       activity_summary: "已核查章节#{chapter_title_line(chapter)}：读取位置超出正文范围（共 #{total} 字符）。",
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
       outcome: :end_of_content,
       facts: %{prose_chars: total},
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
         {prose, spans},
         total,
         word_count
       ) do
    {page_text, page_end, next_offset} = chapter_page(prose, offset, total)
    start_byte = byte_size(String.slice(prose, 0, offset))
    page_byte_end = start_byte + byte_size(page_text)

    versions = chapter_page_versions(spans, start_byte, page_byte_end)

    header = header_sections(work_id, chapter, volume, offset)

    sections =
      header.sections ++
        [prose_page_section(offset, page_end, total, word_count, page_text)] ++
        continue_section(chapter, next_offset, total, page_end)

    {:ok,
     observation(
       "chapter_read",
       query,
       chapter_title_line(chapter) <> "\n" <> Enum.join(sections, "\n"),
       [chapter_ref(chapter) | header.refs],
       clip: false,
       facts: %{prose_chars: total},
       activity_summary: chapter_activity_summary(chapter, offset, page_end, total, word_count),
       extra:
         Map.merge(chapter_identity_keys(chapter), %{
           versions: versions,
           coverage: header.coverage,
           omissions: header.omissions,
           next_offset: next_offset,
           prose_total_chars: total,
           prose_range: %{start: offset + 1, end: page_end},
           source_hash: ProseFormatting.source_hash(prose),
           prose_byte_range: %{start: start_byte, end: page_byte_end},
           target_segments: LocalizedRevision.page_segments(prose, start_byte, page_byte_end)
         })
     )}
  end

  # 只有实际写入 canonical 正文的段才有 span：空/未写场没有字节，也不贡献版本。
  # 以页面字节半开区间与段区间实际相交选版本；双 LF 分隔符不属于任何段。
  defp chapter_page_versions(spans, page_start, page_end) do
    Enum.reduce(spans, %{}, fn
      {start_byte, end_byte, {ref, revision}}, versions
      when start_byte < page_end and end_byte > page_start ->
        Map.put(versions, ref, revision)

      _no_version_or_outside_page, versions ->
        versions
    end)
  end

  # 【计划】【摘要】只在首页（offset=0）返回；续读页不重复（I-EXPLORE-READ-3 的
  # 省流约定，D4）。
  defp header_sections(work_id, chapter, volume, 0) do
    plan = ReadingProjectionService.chapter_plan_preview(chapter, volume)
    accepted = ChapterSummaryRepo.current_accepted(work_id, chapter.id)
    summary = if accepted, do: accepted.summary_text, else: ""
    read_query = Jason.encode!(%{facet: "chapters", ref: chapter_ref(chapter), offset: 0})
    summary_ref = if accepted, do: "chapter_summary:#{accepted.id}"

    %{
      sections: [
        "【计划】#{clip_section(plan, @chapter_plan_max_chars)}",
        if(accepted,
          do: "【摘要】#{clip_section(summary, @chapter_summary_max_chars)}",
          else: "【摘要】（尚无章摘要）"
        )
      ],
      refs: if(summary_ref, do: [summary_ref], else: []),
      coverage: %{
        chapter_plan:
          preview_coverage(plan, @chapter_plan_max_chars, chapter_ref(chapter), read_query),
        chapter_summary:
          if(accepted,
            do: preview_coverage(summary, @chapter_summary_max_chars, summary_ref, read_query),
            else: %{status: "unavailable", read_query: read_query}
          )
      },
      omissions: ["本页计划/摘要是预览；完整设计材料经 archive_read #{read_query} 读取，预览不证明全文已读。"]
    }
  end

  defp header_sections(_work_id, _chapter, _volume, _offset),
    do: %{sections: [], refs: [], coverage: %{}, omissions: []}

  defp preview_coverage(text, limit, ref, query) do
    total = String.length(text)
    returned = if total > limit, do: limit - String.length(@section_ellipsis), else: total

    %{
      status: "partial",
      representation: "preview",
      source_ref: ref,
      offset: 0,
      returned_graphemes: returned,
      total_graphemes: total,
      offset_unit: "unicode_grapheme",
      read_query: query
    }
  end

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

  # 所有成功正文页都从本页实际分页范围给作者可辨认读证；首页额外保留整章
  # 有效字数，续页沿用同一范围格式（与 prose_page_section 一致），不做首页特判。
  defp chapter_activity_summary(chapter, offset, page_end, total, word_count) do
    detail = "第 #{offset + 1}–#{page_end} 字符 / 共 #{total} 字符"
    detail = if offset == 0, do: detail <> "；有效字数 #{word_count}", else: detail

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

  # 本章所属卷（按 TOC 卷节点反查：章的 volume_id / 章 id 归组）。
  defp chapter_volume(volumes, chapter) do
    Enum.find(volumes, fn volume ->
      Enum.any?(Map.get(volume, :chapters, []), &(&1.id == Map.get(chapter, :id)))
    end)
  end

  # ── archive_read ──

  defp archive_read(work_id, query) do
    with {:ok, material} <- WorkArchiveService.read(work_id, query) do
      {:ok,
       observation("archive_read", query, material.summary, material.refs,
         clip: false,
         facts: material.facts,
         outcome: material.outcome,
         activity_summary: activity_text("archive_read", material.coverage.facet),
         extra: Map.drop(material, [:summary, :refs, :facts, :outcome])
       )}
    end
  end

  # ── memory_recall ──

  defp memory_recall(_work_id, ""), do: {:error, :empty_query}

  defp memory_recall(work_id, query) do
    with {:ok, selector} <- MemoryManagementService.recall_selector(query) do
      params =
        case selector do
          %{kind: "recall", query: search} -> %{"query" => search}
          %{memory_ref: "memory:" <> id} -> %{"memory_id" => id}
        end

      with {:ok, %{items: items}} <- MemoryManagementService.recall(work_id, params) do
        memory_observation(items, selector, work_id, query)
      end
    end
  end

  defp memory_observation(items, %{kind: "recall"}, work_id, query) do
    rows = Enum.map(items, &MemoryManagementService.recall_preview/1)
    refs = Enum.map(items, &"memory:#{&1.id}")
    versions = Map.new(items, &{"memory:#{&1.id}", &1.version})

    summary =
      if items == [],
        do: "记忆中未检索到「#{query}」。",
        else: Jason.encode!(%{returned_count: length(items), items: rows})

    {:ok,
     observation("memory_recall", query, summary, refs,
       clip: false,
       outcome: if(items == [], do: :empty_result, else: :observed),
       activity_summary: if(items == [], do: "已检索记忆「#{query}」：没有命中任何记忆条目。"),
       facts: %{hit_count: length(items)},
       extra: %{
         versions: versions,
         next_offset: nil,
         coverage: %{
           kind: "recall",
           work_id: work_id,
           returned_items: length(items),
           exhaustive: false,
           items: Enum.map(rows, &Map.drop(&1, [:text]))
         },
         omissions: ["本次仅供应有界召回摘要/预览，不代表全部记忆；完整正文请按 memory_ref/offset 读取。"]
       }
     )}
  end

  defp memory_observation([], %{kind: "detail"}, _work_id, _query),
    do: {:error, :memory_not_found}

  defp memory_observation([item], %{memory_ref: ref, offset: offset}, work_id, query) do
    with {:ok, page} <- source_page(item.content, offset, :memory_offset_out_of_range) do
      coverage = %{kind: "detail", work_id: work_id, memory_ref: ref, summary: page.range}

      {:ok,
       observation("memory_recall", query, page.text, [ref],
         clip: false,
         outcome: page.outcome,
         facts: %{
           memory:
             Map.take(item, [
               :id,
               :work_id,
               :version,
               :type,
               :scope,
               :status,
               :source_type,
               :source_id
             ])
         },
         extra:
           Map.merge(Map.drop(page, [:text, :range, :outcome]), %{
             versions: %{ref => item.version},
             coverage: coverage
           })
       )}
    end
  end

  defp source_page(text, offset, error) do
    total = String.length(text)

    with :ok <- read_offset(offset, total, error) do
      body = String.slice(text, offset, @chapter_page_chars)
      stop = offset + String.length(body)
      next = if stop < total, do: stop, else: nil
      partial = offset > 0 or not is_nil(next)

      {:ok,
       %{
         text: body,
         next_offset: next,
         source_hash: ProseFormatting.source_hash(text),
         range: %{
           offset: offset,
           returned_graphemes: String.length(body),
           total_graphemes: total,
           offset_unit: "unicode_grapheme"
         },
         omissions:
           if(partial,
             do: ["本页仅含原文 [#{offset}, #{stop}) / #{total} grapheme；其余范围未在本页供应。"],
             else: []
           ),
         outcome: if(partial, do: :partial, else: :observed)
       }}
    end
  end

  defp read_offset(0, 0, _error), do: :ok
  defp read_offset(offset, total, _error) when offset >= 0 and offset < total, do: :ok
  defp read_offset(_offset, _total, error), do: {:error, error}

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
  def activity_failure_summary("session_message_read"), do: "会话原文回查未完成，请核对消息来源后重试。"
  def activity_failure_summary(_tool), do: "作品检索未完成，可换个检索词再试。"

  @doc """
  探索观察的结构化分类元数据（developer face）。

  进 `AgentObservation.structured_payload` 与 `exploration_observed` 事件 payload，
  供 no_progress 终止澄清机械派生「缺什么/为何不能执行/可做什么」；作者面仍只用
  activity_summary，不直接渲染本元数据（B24 I-EXPLORE-READ-8）。

  `outcome` 的 `:failed` 只由调用方在工具执行出错时标记；其余取值都是已完成观察。
  """
  @spec observation_metadata(map()) :: map()
  def observation_metadata(observation) when is_map(observation) do
    %{
      tool: observation |> Map.get(:tool) |> normalize_metadata_text(),
      query: observation |> Map.get(:query) |> normalize_metadata_text(),
      outcome: observation |> Map.get(:outcome) |> normalize_metadata_outcome(),
      facts: Map.get(observation, :facts) || %{},
      source_refs: Map.get(observation, :refs) || []
    }
    |> Map.merge(
      Map.take(observation, [
        :versions,
        :coverage,
        :omissions,
        :next_offset,
        :prose_range,
        :prose_byte_range,
        :prose_total_chars,
        :chapter_ref,
        :observation_ref,
        :source_hash,
        :target_segments,
        :coverage_note,
        :continue_hint
      ])
    )
  end

  @doc "同次真实读取进入 RequestIR 的唯一观察投影；来源、覆盖与可选身份保持原值。"
  @spec request_observation(map()) :: map()
  def request_observation(observation) do
    %{
      status:
        Map.get(@observation_statuses, to_string(observation_field(observation, :outcome)), "ok"),
      source_refs: observation_field(observation, :refs) || [],
      versions: observation_field(observation, :versions) || %{},
      coverage:
        observation
        |> Map.take([:prose_range, :prose_byte_range, :prose_total_chars, :chapter_ref])
        |> Map.merge(observation_field(observation, :coverage) || %{})
        |> Map.merge(%{
          coverage_note: observation_field(observation, :coverage_note),
          continuation_hint: observation_field(observation, :continue_hint)
        }),
      omissions: observation_field(observation, :omissions) || [],
      next_offset: observation_field(observation, :next_offset),
      content:
        %{
          summary: observation_field(observation, :summary),
          tool: observation_field(observation, :tool),
          query: observation_field(observation, :query),
          facts: observation_field(observation, :facts) || %{}
        }
        |> put_present(:observation_ref, observation_field(observation, :observation_ref))
        |> put_present(:source_hash, observation_field(observation, :source_hash))
        |> put_present(:target_segments, observation_field(observation, :target_segments))
    }
  end

  defp put_present(map, _key, nil), do: map
  defp put_present(map, key, value), do: Map.put(map, key, value)
  defp observation_field(map, key), do: Map.get(map, key, Map.get(map, to_string(key)))

  defp normalize_metadata_text(nil), do: ""
  defp normalize_metadata_text(value) when is_binary(value), do: value
  defp normalize_metadata_text(value), do: to_string(value)

  defp normalize_metadata_outcome(nil), do: "observed"
  defp normalize_metadata_outcome(value) when is_atom(value), do: Atom.to_string(value)
  defp normalize_metadata_outcome(value) when is_binary(value), do: value
  defp normalize_metadata_outcome(_value), do: "observed"

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
  defp archive_facet_label("chapters"), do: "章节目录"
  defp archive_facet_label("foreshadowing"), do: "伏笔"
  defp archive_facet_label("rules"), do: "写作规则"
  defp archive_facet_label("stats"), do: "作品统计"
  defp archive_facet_label("current_state"), do: "当前状态"
  defp archive_facet_label("relationships"), do: "人物关系"
  defp archive_facet_label("preferences"), do: "作者偏好"
  defp archive_facet_label("ledgers"), do: "脉络账本"
  defp archive_facet_label(_facet), do: "作品档案"

  defp observation(tool, query, summary, refs, opts) do
    summary = observation_summary(summary, Keyword.get(opts, :clip, true))

    base = %{
      tool: tool,
      query: query,
      summary: summary,
      refs: refs,
      outcome: Keyword.get(opts, :outcome, :observed),
      facts: Keyword.get(opts, :facts) || %{},
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
