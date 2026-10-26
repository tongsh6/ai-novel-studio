defmodule NovelApplication.NoProgressClarification do
  @moduledoc """
  no_progress（同一 progress_signature 复现）停等时的作者可见具体澄清。

  背景（B28 T4 R10）：真实模型在空作品里重复同一次 `chapter_read`，runtime 以
  「AgentRun 未取得新进展，已停止等待作者回复。」泛化句停等——作者既不知道
  「第一章不存在」是检索已经完成的事实，也不知道缺什么、为何不能执行、能做什么。
  本模块把**最后可用观察**的结构化分类（tool/query/outcome/facts，
  `ExplorationService.observation_metadata/1`）机械翻译成结构事实句：

  - 缺什么：目标章节/正文/记忆是否存在；
  - 为何不能执行：没有可处理的目标，且重复同一次检索不会得到新事实；
  - 可做什么：作者可执行的具体下一步（先写正文、确认章名、补充设定等）。

  边界：

  - 只派生结构事实，不调用 provider、不生成创作内容（ADR-0022 N-NARR：作者过程
    叙述归模型；本句是机械结构事实，与 B23 CP3 plan_exhausted_summary、
    `failure_author_summary` 同族）。
  - 不改变 no_progress 语义本身（ADR-0023）：runtime 仍在 progress_signature
    复现处停等；零写入、零候选、不路由写能力不变。
  - 无可用观察时退化为既有诚实兜底句（不假装知道原因）。
  """

  alias NovelCommon.Contracts.AgentEvent
  alias NovelDomain.AgentObservation

  @generic_summary "AgentRun 未取得新进展，已停止等待作者回复。"
  @repeat_note "重复同一次检索不会得到新事实。"
  @max_query_chars 40

  @type clarification :: %{
          required(:summary) => String.t(),
          required(:reason_codes) => [String.t()],
          required(:source) => :observation | :none,
          optional(:observation) => %{tool: String.t(), outcome: String.t()}
        }

  @doc """
  由最近的探索观察派生作者可见澄清。

  `observations` 优先（当前步返回的 AgentObservation），`events` 是回落来源
  （已持久化的 exploration_observed 事件 payload）。两者都没有可用探索结构时
  退回通用诚实句。
  """
  @spec derive([AgentObservation.t() | map()], [AgentEvent.t() | map()]) :: clarification()
  def derive(observations \\ [], events \\ []) do
    metadata = last_observation_metadata(observations) || last_event_metadata(events)

    case metadata do
      nil ->
        %{summary: @generic_summary, reason_codes: ["no_progress_generic"], source: :none}

      metadata ->
        clarification(metadata)
    end
  end

  # ── 观察/事件 → 机械元数据 ──

  defp last_observation_metadata(observations) when is_list(observations) do
    observations
    |> Enum.reverse()
    |> Enum.find_value(&observation_metadata/1)
  end

  defp last_observation_metadata(_observations), do: nil

  defp observation_metadata(%AgentObservation{} = observation),
    do: payload_metadata(observation.structured_payload)

  defp observation_metadata(observation) when is_map(observation) do
    payload_metadata(Map.get(observation, :structured_payload)) ||
      direct_observation_metadata(observation)
  end

  defp observation_metadata(_observation), do: nil

  # 探索观察本身（ExplorationService.run/3 返回形状）也可直接消费。
  defp direct_observation_metadata(observation) do
    if present?(Map.get(observation, :tool)) do
      payload_metadata(observation)
    end
  end

  defp last_event_metadata(events) when is_list(events) do
    events
    |> Enum.reverse()
    |> Enum.find_value(&event_metadata/1)
  end

  defp last_event_metadata(_events), do: nil

  defp event_metadata(%AgentEvent{event_type: :exploration_observed, payload: payload}),
    do: payload_metadata(payload)

  defp event_metadata(event) when is_map(event) do
    if event_metadata_field(event, :event_type) == :exploration_observed do
      payload_metadata(event_metadata_field(event, :payload))
    end
  end

  defp event_metadata(_event), do: nil

  defp event_metadata_field(event, key) do
    Map.get(event, key) || Map.get(event, Atom.to_string(key))
  end

  # 只认「探索观察」结构化载荷：stage 必须是 exploration_observed 且带 tool。
  defp payload_metadata(payload) when is_map(payload) do
    stage = metadata_field(payload, :stage)

    if normalize_stage(stage) == "exploration_observed" and
         present?(metadata_field(payload, :tool)) do
      %{
        tool: to_string(metadata_field(payload, :tool)),
        query: metadata_field(payload, :query) || "",
        outcome: normalize_outcome(metadata_field(payload, :outcome)),
        facts: metadata_field(payload, :facts) || %{}
      }
    end
  end

  defp payload_metadata(_payload), do: nil

  defp metadata_field(payload, key),
    do: Map.get(payload, key) || Map.get(payload, to_string(key))

  defp normalize_stage(nil), do: "exploration_observed"
  defp normalize_stage(stage) when is_atom(stage), do: Atom.to_string(stage)
  defp normalize_stage(stage) when is_binary(stage), do: stage
  defp normalize_stage(_stage), do: ""

  defp normalize_outcome(nil), do: "observed"
  defp normalize_outcome(outcome) when is_atom(outcome), do: Atom.to_string(outcome)
  defp normalize_outcome(outcome) when is_binary(outcome), do: outcome
  defp normalize_outcome(_outcome), do: "observed"

  # ── 事实 → 具体澄清 ──

  # 空作品缺目标（B28 T4 R10 原场景）：章节目标不存在且作品没有任何章节/正文。
  defp clarification(%{tool: "chapter_read", outcome: "target_not_found", facts: facts} = meta) do
    target = display_target(meta.query)

    case chapter_count(facts) do
      0 ->
        "本轮没有取得新进展：#{chapter_phrase(target)}不存在——作品当前还没有任何章节或正文，" <>
          "没有可整理修订的目标。#{@repeat_note}" <>
          "下一步：先创作第一章正文，或指定已有内容后重试。"

      count when is_integer(count) and count > 0 ->
        "本轮没有取得新进展：#{chapter_phrase(target)}不在当前章索引中" <>
          "（当前作品共 #{count} 章），没有可定位的修订目标。#{@repeat_note}" <>
          "下一步：确认章名，或从作品目录选择具体章节后重试。"

      _ ->
        "本轮没有取得新进展：最近一次章节检索没有找到目标章节，当前没有可定位的修订目标。" <>
          "#{@repeat_note}下一步：确认章名，或从作品目录选择具体章节后重试。"
    end
    |> with_observation(meta)
  end

  defp clarification(%{tool: "chapter_read", outcome: "ambiguous_target"} = meta) do
    target = display_target(meta.query)
    count = matched_count(meta.facts)

    ("本轮没有取得新进展：章名#{target_suffix(target)}匹配到 #{count || "多"} 章、存在歧义，" <>
       "无法确定要处理的目标章节。下一步：说明具体是哪一章（或提供唯一章节标识）后重试。")
    |> with_observation(meta)
  end

  defp clarification(%{tool: "chapter_read", outcome: "invalid_query"} = meta) do
    ("本轮没有取得新进展：章节检索参数无法识别，没能定位目标章节。" <>
       "下一步：提供作品目录中的真实章名后重试。")
    |> with_observation(meta)
  end

  defp clarification(%{tool: "chapter_read", outcome: "empty_content"} = meta) do
    target = display_target(meta.query)

    ("本轮没有取得新进展：#{chapter_phrase(target)}还没有已采纳正文，没有可整理修订的内容。" <>
       "#{@repeat_note}下一步：先写本章正文，或指定其他已有正文的章节后重试。")
    |> with_observation(meta)
  end

  defp clarification(%{tool: "prose_search", outcome: "empty_result"} = meta) do
    target = display_target(meta.query)

    ("本轮没有取得新进展：正文检索#{target_suffix(target)}没有命中任何章节，" <>
       "缺少可引用的正文事实。#{@repeat_note}" <>
       "下一步：确认检索词，或先创作/指定相关正文后重试。")
    |> with_observation(meta)
  end

  defp clarification(%{tool: "memory_recall", outcome: "empty_result"} = meta) do
    target = display_target(meta.query)

    ("本轮没有取得新进展：记忆检索#{target_suffix(target)}没有命中任何已确认记忆，" <>
       "缺少可引用的设定事实。#{@repeat_note}" <>
       "下一步：补充具体设定，或确认检索词后重试。")
    |> with_observation(meta)
  end

  # 其他已完成观察（含 offset 读到末尾/越界、档案读取等）：不猜原因，只诚实说明
  # 最近一次检索没有带来可继续的新事实，并给出可执行下一步。
  defp clarification(%{outcome: outcome} = meta) when is_binary(outcome) do
    ("本轮没有取得新进展：最近一次#{tool_label(meta.tool)}没有带来可用于继续的新事实。" <>
       "#{@repeat_note}下一步：补充具体方向或调整检索目标后重试。")
    |> with_observation(meta)
  end

  defp with_observation(summary, meta) do
    %{
      summary: summary,
      reason_codes: [
        "no_progress_repeated_exploration",
        "exploration_outcome_#{meta.outcome}"
      ],
      source: :observation,
      observation: %{tool: meta.tool, outcome: meta.outcome}
    }
  end

  # ── 文案辅件（只做结构事实排版，不生成叙述内容） ──

  defp chapter_phrase(nil), do: "目标章节"
  defp chapter_phrase(target), do: "章节「#{target}」"

  defp target_suffix(nil), do: ""
  defp target_suffix(target), do: "「#{target}」"

  defp chapter_count(facts) when is_map(facts) do
    integer_fact(facts, :chapter_count)
  end

  defp chapter_count(_facts), do: nil

  defp matched_count(facts) when is_map(facts), do: integer_fact(facts, :matched_count)
  defp matched_count(_facts), do: nil

  defp integer_fact(facts, key) do
    case Map.get(facts, key) || Map.get(facts, Atom.to_string(key)) do
      value when is_integer(value) and value >= 0 -> value
      _ -> nil
    end
  end

  defp tool_label("chapter_read"), do: "章节检索"
  defp tool_label("prose_search"), do: "正文检索"
  defp tool_label("memory_recall"), do: "记忆检索"
  defp tool_label("archive_read"), do: "作品档案读取"
  defp tool_label("session_adoptions"), do: "候选查询"
  defp tool_label(_tool), do: "作品检索"

  # 作者可见澄清不携带 JSON/内部寻址/超长 query（B24 I-EXPLORE-READ-8）。
  defp display_target(query) when is_binary(query) do
    trimmed = String.trim(query)

    cond do
      trimmed == "" -> nil
      String.starts_with?(trimmed, "{") -> nil
      String.length(trimmed) > @max_query_chars -> nil
      true -> trimmed
    end
  end

  defp display_target(_query), do: nil

  defp present?(value) when is_binary(value), do: value != ""
  defp present?(value), do: not is_nil(value)
end
