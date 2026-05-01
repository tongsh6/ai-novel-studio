defmodule NovelApplication.IntentHandlers.Scan do
  @moduledoc """
  Scan intent handlers — 伏笔扫描与回收检查。
  """

  import Ecto.Query, only: [from: 2]

  alias NovelAgent.Provider.Gateway, as: ProviderGateway
  alias NovelApplication.MemoryService
  alias NovelFoundation.Enums.NextAction
  alias NovelFoundation.Enums.Status
  alias NovelFoundation.Enums.TurnPhase
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Draft
  alias NovelPersistence.Schemas.MemoryItem

  @doc "扫描草稿中的伏笔线索。"
  def build_new_foreshadowing(turn_id, route_result, memory_context, build_turn_result) do
    slots = route_result.extracted_slots
    work_id = Map.get(slots, "work_id") || memory_work_id(memory_context)

    drafts =
      from(d in Draft,
        where: d.work_id == ^work_id and d.status == "ACCEPTED",
        order_by: [asc: d.inserted_at]
      )
      |> Repo.all()

    if drafts == [] do
      build_turn_result.(turn_id, %{
        phase: TurnPhase.completed(), status: Status.done(),
        next_action: NextAction.no_further_action(),
        assistant_text: "暂无已采纳的草稿可供扫描。请先生成并采纳一些草稿。"
      })
    else
      all_content = Enum.map_join(drafts, "\n\n---\n\n", & &1.content)

      prompt = """
      你是一位小说编辑。请阅读以下草稿内容，识别其中的伏笔线索、未解之谜和可发展的剧情暗线。

      草稿内容：
      #{all_content}

      输出格式：返回 JSON 数组，每个元素包含 thread（伏笔描述）、type（类型：character/plot/world/mystery）和 payoff_hint（可能的回收方向）。
      只输出 JSON 数组，不要输出任何其他内容。
      """

      threads = llm_generate_json_list(prompt)

      Enum.each(threads, fn t ->
        MemoryService.create(%{
          work_id: work_id, content: Map.get(t, "thread", ""),
          type: "FORESHADOWING", scope: "WORK", source_type: "AUTHOR_CREATED",
          tags: [Map.get(t, "type", ""), Map.get(t, "payoff_hint", "")]
        })
      end)

      thread_summary = Enum.map_join(threads, "、", & &1["thread"])

      build_turn_result.(turn_id, %{
        phase: TurnPhase.completed(), status: Status.done(),
        next_action: NextAction.no_further_action(),
        assistant_text: "发现 #{length(threads)} 条伏笔线索：#{thread_summary}"
      })
    end
  end

  @doc "检查已有伏笔是否在草稿中回收。"
  def build_foreshadowing_resolution(turn_id, route_result, memory_context, build_turn_result) do
    slots = route_result.extracted_slots
    work_id = Map.get(slots, "work_id") || memory_work_id(memory_context)

    threads =
      from(m in MemoryItem,
        where: m.work_id == ^work_id and m.type == "FORESHADOWING",
        order_by: [desc: m.inserted_at]
      )
      |> Repo.all()

    if threads == [] do
      build_turn_result.(turn_id, %{
        phase: TurnPhase.completed(), status: Status.done(),
        next_action: NextAction.no_further_action(),
        assistant_text: "暂无伏笔线索可供检查。请先用「扫描伏笔」识别草稿中的伏笔。"
      })
    else
      do_scan_resolution(turn_id, work_id, threads, build_turn_result)
    end
  end

  def generation_prompt("intent.SCAN_NEW_FORESHADOWING", _slots) do
    "你是一位小说编辑。请阅读当前已采纳的草稿内容，识别其中的伏笔线索、未解之谜和可发展的剧情暗线，并标记类型和可能的回收方向。"
  end

  def generation_prompt("intent.SCAN_FORESHADOWING_RESOLUTION", _slots) do
    "你是一位小说编辑。请检查已有伏笔线索是否在草稿中得到回收或发展，输出每条伏笔的状态（resolved/developed/unresolved）。"
  end

  # ---- private ----

  defp do_scan_resolution(turn_id, work_id, threads, build_turn_result) do
    drafts =
      from(d in Draft,
        where: d.work_id == ^work_id and d.status == "ACCEPTED",
        order_by: [asc: d.inserted_at]
      )
      |> Repo.all()

    draft_text = Enum.map_join(drafts, "\n\n---\n\n", & &1.content)
    thread_list = Enum.map_join(threads, "\n", fn t -> "  - [ID:#{t.id}] #{t.content}" end)

    prompt = """
    你是一位小说编辑。请检查以下伏笔线索是否在草稿中得到了回收或发展。

    伏笔线索：
    #{thread_list}

    草稿内容：
    #{draft_text}

    输出格式：返回 JSON 数组，每个元素包含 thread_id（伏笔 ID）、status（resolved/developed/unresolved）和 note（简要说明）。
    只输出 JSON 数组，不要输出任何其他内容。
    """

    results = llm_generate_json_list(prompt)
    {resolved, others} = Enum.split_with(results, &(&1["status"] == "resolved"))

    Enum.each(resolved, fn r ->
      id = Map.get(r, "thread_id", "")
      note = Map.get(r, "note", "")
      if id != "" do
        MemoryService.create(%{
          work_id: work_id, content: "伏笔已回收：#{note}",
          type: "PLOT_FACT", scope: "WORK",
          source_type: "AUTHOR_CREATED", tags: ["resolution", id]
        })
      end
    end)

    summary =
      "检查 #{length(threads)} 条伏笔：" <>
      "#{length(resolved)} 条已回收、#{length(others)} 条仍在发展中。"

    build_turn_result.(turn_id, %{
      phase: TurnPhase.completed(), status: Status.done(),
      next_action: NextAction.no_further_action(),
      assistant_text: summary
    })
  end

  defp llm_generate_json_list(prompt) do
    case ProviderGateway.complete(prompt) do
      {:ok, %{content: content}} ->
        case Jason.decode(content) do
          {:ok, list} when is_list(list) -> list
          _ -> []
        end
      {:error, _} -> []
    end
  end

  defp memory_work_id(%{work_id: work_id}) when is_binary(work_id), do: work_id
  defp memory_work_id(_), do: nil
end
