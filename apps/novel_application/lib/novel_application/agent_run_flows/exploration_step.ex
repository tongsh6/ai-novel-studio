defmodule NovelApplication.AgentRunFlows.ExplorationStep do
  @moduledoc """
  B39 CP1：共享只读探索步执行（application 层编排，不新增 agent loop）。

  判断计划 flow 与正文 flow 共用同一实现：目录/工具集由调用点传入（分账），
  执行经既有 `ExplorationService`（0 provider 调用、不经写 Toolbox），观察进流并
  产出 author-visible `exploration_observed` 阶段事件、developer `AgentObservation`
  与 `AgentStep`；工具失败归一化为 `:failed` 观察，不硬失败整个 run。
  no-progress 签名 namespace 由调用点给，避免跨 flow/跨步串扰。
  """

  alias NovelApplication.ExplorationService
  alias NovelDomain.AgentObservation
  alias NovelDomain.AgentStep

  @plan_targets ~w(prose_search chapter_read archive_read memory_recall)

  @doc "计划内检索步默认目录（判断计划/正文 flow 目前同集；会话读取另行加目标）。"
  def targets, do: @plan_targets

  @doc """
  执行一个计划内只读探索步。

  opts:
    * :target_set - 允许的目标工具白名单（调用点分账）
    * :namespace - no-progress 签名前缀（如 \"judgment_plan_explore\" / \"prose_explore\"）
    * :observation_suffix - observation_id 后缀，避免与同 flow 其它观察冲突
  """
  def execute(
        run,
        sequence,
        %{target_tool_ref: tool, exploration_query: query},
        snapshot,
        opts \\ []
      ) do
    target_set = Keyword.get(opts, :target_set, @plan_targets)
    namespace = Keyword.get(opts, :namespace, "plan_explore")
    observation_suffix = Keyword.get(opts, :observation_suffix, "tool")

    if tool in target_set do
      do_execute(
        run,
        sequence,
        tool || "",
        query || "",
        snapshot,
        ns(namespace),
        observation_suffix
      )
    else
      {:error, {:invalid_exploration_target, tool}}
    end
  end

  defp do_execute(run, sequence, tool, query, snapshot, namespace, observation_suffix) do
    work_id = run.work_id || run.workspace_id || ""

    observation_data =
      case ExplorationService.run(work_id, tool, query) do
        {:ok, observation} ->
          observation

        {:error, reason} ->
          %{
            tool: tool,
            query: query,
            summary: "检索步执行失败：#{inspect(reason)}",
            refs: [],
            outcome: :failed,
            facts: %{},
            activity_summary: ExplorationService.activity_failure_summary(tool)
          }
      end

    activity = ExplorationService.activity_summary(observation_data)

    emit_stage(
      snapshot,
      :exploration_observed,
      activity,
      ["exploration_observed", tool],
      ["explore:#{tool}:#{sequence}"],
      event_payload(tool, query, observation_data)
    )

    observation_id = "obs_#{run.run_id}_#{sequence}_#{observation_suffix}"

    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: observation_id,
        run_ref: run.run_id,
        step_ref: current_step_ref(run, sequence),
        observation_type: :custom,
        source_ref: "explore:#{tool}:#{sequence}",
        summary: observation_data.summary,
        structured_payload:
          Map.merge(
            %{stage: :exploration_observed},
            ExplorationService.observation_metadata(observation_data)
          ),
        evidence_refs: ["explore:#{tool}:#{sequence}"],
        confidence: 1.0
      })

    {:ok, step} =
      AgentStep.new(%{
        step_id: current_step_ref(run, sequence),
        run_ref: run.run_id,
        sequence: sequence,
        status: :completed,
        goal: activity,
        observation_refs: [observation_id],
        state_snapshot_ref: state_snapshot_ref(run, sequence, "#{namespace}_explore"),
        idempotency_key: "#{run.run_id}:#{sequence}:#{namespace}:goal_v#{run.goal.version}"
      })

    {:ok,
     %{
       step: step,
       observations: [observation],
       provider_call_count: 0,
       progress_signature: "#{run.run_id}:#{namespace}:#{tool}:#{query}"
     }}
  end

  defp event_payload(tool, query, observation) do
    base =
      %{
        stage: :exploration_observed,
        tool: tool,
        query: query,
        refs: observation.refs,
        summary: observation.summary
      }
      |> Map.merge(ExplorationService.observation_metadata(observation))

    [:chapter_ref, :chapter_seq, :next_offset, :prose_total_chars, :prose_range]
    |> Enum.reduce(base, fn key, acc ->
      case Map.get(observation, key) do
        nil -> acc
        value -> Map.put(acc, key, value)
      end
    end)
  end

  defp emit_stage(%{stage_sink: stage_sink}, event_type, summary, reason_codes, refs, payload)
       when is_function(stage_sink, 1) do
    stage_sink.(%{
      event_type: event_type,
      summary: summary,
      reason_codes: reason_codes,
      refs: refs,
      payload: payload
    })

    :ok
  end

  defp emit_stage(_snapshot, _event_type, _summary, _reason_codes, _refs, _payload), do: :ok

  defp current_step_ref(run, sequence),
    do: run.current_step_ref || "step_#{run.run_id}_#{sequence}"

  defp state_snapshot_ref(run, sequence, tool_name) do
    [
      "agent_snapshot",
      run.work_id,
      run.session_id,
      run.run_id,
      "step",
      sequence,
      tool_name,
      "goal_v#{run.goal.version}"
    ]
    |> Enum.map_join(":", &to_string/1)
  end

  defp ns(value) when is_binary(value), do: value
  defp ns(value), do: to_string(value)
end
