defmodule NovelApplication.ExplorationPolicy do
  @moduledoc """
  判断探索与只读计划共用的纯读取资格政策。

  从真实已完成观察派生普通额度与下一页资格，不读取作品、不持有状态，
  也不把计划包装或预计分页视为授权。工具定义与查询坐标比较仍归实际读口。
  """

  alias NovelApplication.ExplorationService

  # 判断探索共用配额；纯只读计划中的机械准备步不重复读取、不消耗该配额。
  @max_explore_rounds 2
  @max_page_continuation_rounds 8
  @read_only_plan_targets ~w(context_assemble character_roster prose_search chapter_read archive_read memory_recall)
  @exploration_plan_targets ~w(prose_search chapter_read archive_read memory_recall)

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
  def allowed_tools(%{open?: true}), do: ExplorationService.tool_names()
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
            not ExplorationService.continuation_request?(
              request.tool,
              request.query,
              Map.get(budget, :continuation)
            )
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
end
