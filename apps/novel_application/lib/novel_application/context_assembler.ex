defmodule NovelApplication.ContextAssembler do
  @moduledoc """
  对话上下文组装。从各来源收集上下文片段，组装为 DialogueContext。

  VS-00B 使用可配置的 fetcher 回调（测试中 stub，生产中读 persistence）。
  Planner 只接收已组装好的 DialogueContext，不直接访问 Repo。
  """

  require NovelTelemetry.LogEmit, as: LogEmit

  alias NovelDomain.ChapterPlanDirection
  alias NovelDomain.ContextSourceRef
  alias NovelDomain.DialogueContext
  alias NovelDomain.VolumeBlueprint

  @type fetcher_return :: {:ok, DialogueContext.t()}
  @type fetcher :: (String.t(), String.t() | nil, String.t() | nil -> fetcher_return())

  @doc "组装上下文；唯一 fetch 契约是三参数回调返回 DialogueContext。"
  @spec assemble(String.t(), fetcher() | nil) :: DialogueContext.t()
  def assemble(work_id, fetcher \\ nil),
    do: assemble_for_input(work_id, nil, fetcher, [])

  @spec assemble_for_input(String.t(), String.t() | nil, fetcher() | nil, keyword()) ::
          DialogueContext.t()
  def assemble_for_input(work_id, author_text, fetcher \\ nil, opts \\ []) do
    t0 = System.monotonic_time(:millisecond)
    LogEmit.emit(:context, :assemble, :start, %{})
    session_id = Keyword.get(opts, :session_id)
    context = safe_fetch(fetcher, work_id, author_text, session_id)
    chapters = normalize_structured_chapters(context.structured_chapters)

    refs =
      build_refs(
        context.current_work_snapshot,
        context.conversation_summary,
        context.memory_summary,
        context.open_behavior_summary,
        session_id
      )

    context = %{
      context
      | work_id: work_id,
        structured_chapters: chapters,
        current_chapters: titles_from_structured(chapters),
        source_status: normalize_source_status(context.source_status),
        context_refs: refs,
        assembly_policy:
          Keyword.get(opts, :assembly_policy, NovelDomain.AssemblyPolicy.default()),
        assembled_at: DateTime.utc_now() |> DateTime.to_iso8601()
    }

    LogEmit.emit(:context, :assemble, :done, %{
      context_refs_count: length(refs),
      has_snapshot: context.current_work_snapshot != nil,
      has_conversation: context.conversation_summary != nil,
      has_session_summary: session_summary?(context.conversation_summary),
      has_memory: context.memory_summary != nil,
      source_status:
        Map.new(context.source_status, fn {k, v} -> {to_string(k), to_string(v)} end),
      duration_ms: System.monotonic_time(:millisecond) - t0
    })

    context
  end

  @source_keys [:work, :conversation, :memory, :behavior, :chapters, :interaction]
  @known_statuses [:ok, :empty, :unknown, :unavailable, :partial, :stale]

  defp safe_fetch(nil, work_id, _author_text, _session_id),
    do: %DialogueContext{work_id: work_id}

  defp safe_fetch(fetcher, work_id, author_text, session_id) do
    case fetcher.(work_id, author_text, session_id) do
      {:ok, %DialogueContext{work_id: ^work_id} = context} -> context
      _ -> unavailable_context(work_id, "invalid_context_source")
    end
  rescue
    _error -> unavailable_context(work_id, "source_unavailable")
  catch
    _kind, _reason -> unavailable_context(work_id, "source_unavailable")
  end

  defp unavailable_context(work_id, reason) do
    LogEmit.emit(:context, :assemble, :error, %{
      work_id: work_id,
      reason: reason,
      degraded_to: "unavailable_context"
    })

    %DialogueContext{
      work_id: work_id,
      source_status: Map.new(@source_keys, &{&1, :unavailable})
    }
  end

  defp normalize_structured_chapters(chapters) when is_list(chapters) do
    chapters
    |> Enum.map(&normalize_structured_chapter/1)
    |> Enum.reject(&is_nil/1)
  end

  defp normalize_structured_chapters(_), do: []

  # B11A CP4（VS-00J §4）：卷信息 additive 透传——卷身份/标题/设计态蓝图随结构化章条目
  # 进 DialogueContext，供 planner/prose 的「当前卷蓝图」、写作坐标 volume_ref、使命输入与
  # 探索面消费。只做白名单归一，不渲染/不拼接文本；无卷信息时值为 nil（既有断言不变）。
  defp normalize_structured_chapter(chapter) when is_map(chapter) do
    title = chapter |> get_any([:title, "title"]) |> normalize_text()

    if title == "" do
      nil
    else
      %{
        # B24（I-EXPLORE-READ-9）：章节唯一编码白名单透传——判断/计划章节索引据此
        # 渲染 `[chapter_ref=chapter:<uuid>]`（additive key，既有消费者不受影响）。
        id: chapter |> get_any([:id, "id"]) |> normalize_optional_text(),
        work_id: chapter |> get_any([:work_id, "work_id"]) |> normalize_optional_text(),
        visible_in_reading: get_any(chapter, [:visible_in_reading, "visible_in_reading"]),
        title: title,
        seq: chapter |> get_any([:seq, "seq"]) |> normalize_integer(),
        summary: chapter |> get_any([:summary, "summary"]) |> normalize_text(),
        plan_direction:
          chapter
          |> get_any([:plan_direction, "plan_direction"])
          |> normalize_plan_direction(),
        has_prose:
          chapter
          |> get_any([:has_prose, "has_prose", :word_count, "word_count"])
          |> normalize_has_prose(),
        volume_id: chapter |> get_any([:volume_id, "volume_id"]) |> normalize_optional_text(),
        volume_seq: chapter |> get_any([:volume_seq, "volume_seq"]) |> normalize_integer(),
        volume_title:
          chapter |> get_any([:volume_title, "volume_title"]) |> normalize_optional_text(),
        volume_blueprint:
          chapter
          |> get_any([:volume_blueprint, "volume_blueprint"])
          |> normalize_volume_blueprint(),
        # B27 CP4 retest2 根因修复（task-22）：作品事实白名单透传——生产 fetcher
        # （WorkspaceContext.fetch_structured_chapters）按章并入的持久化只读事实
        # 必须穿过归一化，否则判断 prompt 的「作品事实」块只剩 0/未知。
        # additive keys：既有消费者按 title/seq/plan 读取不受影响。
        word_count: chapter |> get_any([:word_count, "word_count"]) |> normalize_integer(),
        char_count: chapter |> get_any([:char_count, "char_count"]) |> normalize_integer(),
        accepted_draft_count:
          chapter
          |> get_any([:accepted_draft_count, "accepted_draft_count"])
          |> normalize_integer(),
        scene_count: chapter |> get_any([:scene_count, "scene_count"]) |> normalize_integer(),
        superseded_draft_count:
          chapter
          |> get_any([:superseded_draft_count, "superseded_draft_count"])
          |> normalize_integer(),
        current_draft_refs:
          chapter
          |> get_any([:current_draft_refs, "current_draft_refs"])
          |> normalize_string_list(),
        chapter_status:
          chapter |> get_any([:chapter_status, "chapter_status"]) |> normalize_optional_text(),
        summary_status:
          chapter |> get_any([:summary_status, "summary_status"]) |> normalize_optional_text(),
        summary_revision_base:
          chapter
          |> get_any([:summary_revision_base, "summary_revision_base"])
          |> normalize_optional_text()
      }
    end
  end

  defp normalize_structured_chapter(_), do: nil

  defp titles_from_structured(entries), do: Enum.map(entries, & &1.title)

  defp normalize_plan_direction(value), do: ChapterPlanDirection.to_storage(value)

  defp get_any(map, keys) do
    Enum.reduce_while(keys, nil, fn key, _acc ->
      if Map.has_key?(map, key), do: {:halt, Map.get(map, key)}, else: {:cont, nil}
    end)
  end

  defp normalize_text(value) when is_binary(value), do: value
  defp normalize_text(_), do: ""

  defp normalize_optional_text(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      _text -> value
    end
  end

  defp normalize_optional_text(_value), do: nil

  defp normalize_volume_blueprint(value), do: VolumeBlueprint.to_storage(value)

  defp normalize_integer(value) when is_integer(value), do: value

  defp normalize_integer(value) when is_binary(value) do
    case Integer.parse(value) do
      {n, _} -> n
      :error -> nil
    end
  end

  defp normalize_integer(_), do: nil

  defp normalize_string_list(values) when is_list(values) do
    values
    |> Enum.filter(&is_binary/1)
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
  end

  defp normalize_string_list(_), do: []

  defp normalize_has_prose(value) when is_boolean(value), do: value
  defp normalize_has_prose(value) when is_integer(value), do: value > 0
  defp normalize_has_prose(_), do: nil

  defp session_summary?(summary) when is_binary(summary),
    do: String.contains?(summary, "会话早期摘要")

  defp session_summary?(_summary), do: false

  defp normalize_source_status(statuses) do
    Map.new(@source_keys, fn key ->
      value = Map.get(statuses, key) || Map.get(statuses, to_string(key))
      status = Enum.find(@known_statuses, :unknown, &(to_string(&1) == to_string(value)))
      {key, status}
    end)
  end

  defp build_refs(snapshot, conv_summary, mem_summary, behavior_summary, session_id) do
    {conversation_type, conversation_id} = conversation_ref_identity(session_id)

    []
    |> maybe_add_ref(snapshot, :current_work, "current_work_snapshot")
    |> maybe_add_ref(conv_summary, conversation_type, conversation_id)
    |> maybe_add_ref(mem_summary, :memory, "memory_summary")
    |> maybe_add_ref(behavior_summary, :behavior, "behavior_summary")
  end

  # B81 CP6：旧 `:session_transcript` 材料类型退役（ADR-0035 决策 9）——会话 canonical
  # 历史已由 CP2 作为消息进入请求派生，不再以「会话记录材料」摘要进入判断上下文。
  defp conversation_ref_identity(_session_id), do: {:conversation, "conversation_summary"}

  defp maybe_add_ref(refs, nil, _type, _id), do: refs

  defp maybe_add_ref(refs, value, type, id) do
    case summarize_context(value, type) do
      nil ->
        refs

      "" ->
        refs

      summary ->
        ref = %ContextSourceRef{
          context_ref: NovelFoundation.ID.unique("ctx"),
          source_type: type,
          source_id: id,
          summary: summary,
          redaction_level: :author_safe
        }

        [ref | refs]
    end
  end

  defp summarize_context(value, :current_work) when is_map(value) do
    title = Map.get(value, "title") || Map.get(value, :title)
    context_parts = current_work_context_parts(value)
    current_work_summary(title, context_parts)
  end

  defp summarize_context(value, :conversation) when is_binary(value) do
    summarize_conversation(value) || normalize_summary(value)
  end

  defp summarize_context(value, :memory) when is_binary(value) do
    value
    |> String.split("\n")
    |> Enum.map_join("\n", &String.replace(&1, ~r/^\s*-\s*\[[^\]]+\]\s*/, ""))
    |> normalize_summary()
  end

  defp summarize_context(value, _type) when is_binary(value) do
    normalize_summary(value)
  end

  defp summarize_context(_value, :current_work), do: nil
  defp summarize_context(_value, :memory), do: "已确认设定"
  defp summarize_context(_value, :conversation), do: "近期对话"
  defp summarize_context(_value, :behavior), do: "当前待处理动作"

  defp current_work_context_parts(value) do
    [
      :genre,
      :premise,
      :theme,
      :main_goal,
      :core_selling_point,
      :target_reader,
      :tone_preference,
      :protagonist,
      :protagonist_goal,
      :current_chapter,
      :world_setting
    ]
    |> Enum.map(&map_get_text(value, &1))
    |> Enum.map(&normalize_part/1)
    |> Enum.reject(&is_nil/1)
  end

  defp map_get_text(value, key) do
    Map.get(value, key) || Map.get(value, Atom.to_string(key))
  end

  defp current_work_summary(title, context_parts) do
    title = normalize_part(title)

    cond do
      context_parts == [] ->
        nil

      unnamed_work_title?(title) ->
        context_parts
        |> Enum.take(3)
        |> Enum.join(" / ")
        |> normalize_summary()

      true ->
        [title | context_parts]
        |> Enum.reject(&is_nil/1)
        |> Enum.take(4)
        |> Enum.join(" / ")
        |> normalize_summary()
    end
  end

  defp summarize_conversation(value) do
    normalized = normalize_summary(value)
    author_text = latest_role_text(normalized, "user")
    assistant_text = latest_role_text(normalized, "assistant")

    cond do
      author_text && assistant_text ->
        "上一轮围绕「#{author_text}」展开，AI 已给出回应。"

      author_text ->
        "上一轮作者提到「#{author_text}」。"

      assistant_text ->
        "上一轮 AI 已给出回应。"

      true ->
        nil
    end
  end

  defp latest_role_text(nil, _role), do: nil

  defp latest_role_text(value, role) do
    pattern = ~r/(?:^|\s)#{role}:\s*(.*?)(?=\s(?:user|assistant):|$)/u

    pattern
    |> Regex.scan(value)
    |> List.last()
    |> case do
      [_, text] ->
        text
        |> String.trim()
        |> String.slice(0, 48)

      _ ->
        nil
    end
  end

  defp normalize_part(value) when is_binary(value) do
    value
    |> String.replace(~r/\s+/, " ")
    |> String.trim()
    |> case do
      "" -> nil
      normalized -> normalized
    end
  end

  defp normalize_part(_value), do: nil

  defp unnamed_work_title?(nil), do: true

  defp unnamed_work_title?(title) do
    title in ["未命名作品", "Unnamed Work", "Untitled", "untitled"]
  end

  defp normalize_summary(value) do
    value
    |> String.replace(~r/\s+/, " ")
    |> String.trim()
    |> String.slice(0, 180)
    |> case do
      "" -> nil
      summary -> summary
    end
  end
end
