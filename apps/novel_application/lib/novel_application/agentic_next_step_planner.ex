defmodule NovelApplication.AgenticNextStepPlanner do
  @moduledoc """
  AgentRun next-step 结果的 provider 调用元数据挂载工具。

  帧纪元退役（2026-07-18 回顾 B-2）：原"模型逐步选步"决策器（`next_decision` 族，
  ADR-0023 逐步选步模式）随判断纪元被机械 cursor + 判断②取代，生产零消费后删除；
  本模块只保留各 flow next_step_planner 出口共用的 `with_provider_call_meta`
  管道（provider_call_count 合并语义）。
  """

  @spec with_provider_call_meta(term(), map() | nil) :: term()
  def with_provider_call_meta({:execute, step_fun, decision}, meta),
    do: {:execute, step_fun, decision, planner_meta(meta)}

  def with_provider_call_meta({:execute, step_fun, decision, existing_meta}, meta),
    do: {:execute, step_fun, decision, merge_meta(existing_meta, meta)}

  def with_provider_call_meta({:complete, decision}, meta),
    do: {:complete, decision, planner_meta(meta)}

  def with_provider_call_meta({:complete, decision, existing_meta}, meta),
    do: {:complete, decision, merge_meta(existing_meta, meta)}

  def with_provider_call_meta({:await_author, decision}, meta),
    do: {:await_author, decision, planner_meta(meta)}

  def with_provider_call_meta({:await_author, decision, existing_meta}, meta),
    do: {:await_author, decision, merge_meta(existing_meta, meta)}

  def with_provider_call_meta(result, _meta), do: result

  defp planner_meta(meta) when is_map(meta) do
    Map.put(meta, :provider_call_count, provider_call_count(meta, 1))
  end

  defp planner_meta(_meta), do: %{provider_call_count: 1}

  defp merge_meta(existing_meta, planner_meta) when is_map(existing_meta) do
    Map.merge(existing_meta, planner_meta(planner_meta), fn
      :provider_call_count, existing, planner -> provider_call_count(existing, 0) + planner
      _key, _existing, planner -> planner
    end)
  end

  defp merge_meta(_existing_meta, planner_meta), do: planner_meta(planner_meta)

  defp provider_call_count(meta, default) when is_map(meta) do
    case Map.get(meta, :provider_call_count) || Map.get(meta, "provider_call_count") do
      value when is_integer(value) and value >= 0 -> value
      _ -> default
    end
  end

  defp provider_call_count(value, _default) when is_integer(value) and value >= 0, do: value
  defp provider_call_count(_meta, default), do: default
end
