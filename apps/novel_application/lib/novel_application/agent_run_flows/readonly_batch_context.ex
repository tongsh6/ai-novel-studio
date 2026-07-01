defmodule NovelApplication.AgentRunFlows.ReadonlyBatchContext do
  @moduledoc """
  Read-only AgentRun profile that batches independent archive/context reads.

  The profile produces observations and a normal TurnResult. It never creates
  tentative artifacts, adoption actions, or production writes.
  """

  alias NovelApplication.AgentFinalizer
  alias NovelApplication.WorkArchiveService
  alias NovelDomain.{AgentObservation, AgentStep}

  @profile_ref "readonly_batch_context_v1"

  @spec profile_ref() :: String.t()
  def profile_ref, do: @profile_ref

  @spec steps(map()) :: [NovelApplication.AgentRunService.step_fun()]
  def steps(spec) when is_map(spec), do: [batch_read_step(spec), finalize_step()]

  defp batch_read_step(spec) do
    fn run, sequence, snapshot ->
      items = readonly_items(spec, run.work_id)

      results =
        NovelApplication.AgentStepTaskSupervisor
        |> Task.Supervisor.async_stream_nolink(items, &read_item/1,
          ordered: true,
          timeout: 5_000
        )
        |> Enum.map(&normalize_task_result/1)

      Enum.each(results, &emit_batch_item(snapshot, &1))

      observations =
        results
        |> Enum.with_index(1)
        |> Enum.map(fn {result, index} -> observation(run, sequence, index, result) end)

      {:ok,
       %{
         step: step(run, sequence, "readonly_batch_read"),
         observations: observations,
         stage_state: %{readonly_batch: results},
         tool_call_count: length(results),
         progress_signature: progress_signature(run, results)
       }}
    end
  end

  defp finalize_step do
    fn run, sequence, snapshot ->
      results =
        snapshot
        |> Map.get(:stage_state, %{})
        |> Map.get(:readonly_batch, [])

      turn_result =
        run
        |> turn_result(results)
        |> AgentFinalizer.attach_run_summary(%{
          run_id: run.run_id,
          run_mode: run.run_mode,
          parent_turn_ref: run.parent_turn_ref,
          profile_ref: run.profile_ref,
          status: :completed
        })

      {:ok,
       %{
         step: step(run, sequence, "readonly_batch_finalize"),
         observations: [],
         turn_result: turn_result,
         progress_signature: "#{run.run_id}:readonly_batch_finalized:#{length(results)}"
       }}
    end
  end

  defp readonly_items(spec, work_id) do
    readers =
      case Map.get(spec, :readers) do
        readers when is_map(readers) -> readers
        _ -> %{}
      end

    [
      %{
        item_ref: "work_profile",
        label: "作品档案概况",
        read: Map.get(readers, :work_profile, fn -> WorkArchiveService.profile(work_id) end)
      },
      %{
        item_ref: "characters",
        label: "角色档案",
        read: Map.get(readers, :characters, fn -> WorkArchiveService.characters(work_id) end)
      },
      %{
        item_ref: "rules",
        label: "规则档案",
        read: Map.get(readers, :rules, fn -> WorkArchiveService.rules(work_id) end)
      },
      %{
        item_ref: "stats",
        label: "作品统计",
        read: Map.get(readers, :stats, fn -> WorkArchiveService.stats(work_id) end)
      }
    ]
  end

  defp read_item(%{read: read} = item) when is_function(read, 0) do
    started = System.monotonic_time(:millisecond)
    data = read.()
    duration = System.monotonic_time(:millisecond) - started

    item
    |> Map.drop([:read])
    |> Map.merge(%{
      status: :ok,
      summary: item_summary(item, data),
      count: item_count(data),
      duration_ms: duration
    })
  rescue
    error ->
      item
      |> Map.drop([:read])
      |> Map.merge(%{
        status: :error,
        summary: "#{item.label}读取失败。",
        count: 0,
        error: Exception.message(error)
      })
  end

  defp normalize_task_result({:ok, result}), do: result

  defp normalize_task_result({:exit, reason}) do
    %{
      item_ref: "unknown",
      label: "未知只读项",
      status: :error,
      summary: "只读项读取失败。",
      count: 0,
      error: inspect(reason)
    }
  end

  defp emit_batch_item(snapshot, result) do
    case Map.get(snapshot, :stage_sink) do
      sink when is_function(sink, 1) ->
        sink.(%{
          event_type: :tool_completed,
          summary: "只读批量已读取#{result.label}。",
          reason_codes: ["readonly_batch_item_read", "readonly_authorized"],
          refs: ["readonly:#{result.item_ref}"],
          payload: %{
            stage: :readonly_batch_item,
            item_ref: result.item_ref,
            status: result.status,
            count: result.count,
            production_write: false
          }
        })

      _ ->
        :ok
    end
  end

  defp observation(run, sequence, index, result) do
    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: "obs_#{run.run_id}_#{sequence}_readonly_#{result.item_ref}",
        run_ref: run.run_id,
        step_ref: current_step_ref(run, sequence),
        observation_type: :tool_fact,
        source_ref: "readonly:#{result.item_ref}",
        summary: result.summary,
        structured_payload: %{
          item_ref: result.item_ref,
          label: result.label,
          status: result.status,
          count: result.count,
          batch_index: index
        },
        evidence_refs: [
          "readonly_authorized:#{result.item_ref}",
          "agent_event:readonly_batch_item_read"
        ]
      })

    observation
  end

  defp step(run, sequence, suffix) do
    {:ok, step} =
      AgentStep.new(%{
        step_id: current_step_ref(run, sequence),
        run_ref: run.run_id,
        sequence: sequence,
        status: :completed,
        goal: step_goal(suffix),
        micro_plan_ref: "mp_#{run.run_id}_#{suffix}_#{sequence}",
        decision_ref: "decision_#{run.run_id}_readonly_authorized_#{sequence}",
        tool_request_ref: "readonly_request_#{run.run_id}_#{sequence}",
        tool_result_ref: "readonly_result_#{run.run_id}_#{sequence}",
        observation_refs: [],
        state_snapshot_ref: "agent_snapshot:#{run.work_id}:#{run.run_id}:#{suffix}",
        idempotency_key: "#{run.run_id}:#{sequence}:#{suffix}:goal_v#{run.goal.version}"
      })

    step
  end

  defp step_goal("readonly_batch_read"), do: "并行读取只读上下文"
  defp step_goal(_suffix), do: "汇总只读上下文"

  defp turn_result(run, results) do
    success_count = Enum.count(results, &(&1.status == :ok))

    %{
      schema_version: "3.0-draft",
      turn_id: "#{run.parent_turn_ref}:agent:readonly_batch",
      parent_turn_id: run.parent_turn_ref,
      phase: "completed",
      status: "completed",
      next_action: "none",
      assistant_message: %{
        text: "已完成 #{success_count}/#{length(results)} 项只读上下文读取，未写入作品事实。"
      },
      frame_summary: %{
        frame_type: "agent_readonly_batch",
        dialogue_goal: "批量读取作品上下文",
        uncertainty: []
      },
      available_actions: [],
      ui_cards: [],
      candidate_directions: [],
      adoption_state: %{pending: [], resolved: []},
      trace_summary: %{
        readonly_batch: true,
        production_write: false,
        replay_policy: %{recall_provider: false},
        item_refs: Enum.map(results, & &1.item_ref)
      },
      produced_at: DateTime.utc_now() |> DateTime.to_iso8601()
    }
  end

  defp item_summary(%{label: label}, data), do: "#{label}读取完成：#{item_count(data)} 项。"

  defp item_count(data) when is_list(data), do: length(data)
  defp item_count(data) when is_map(data), do: map_size(data)
  defp item_count(nil), do: 0
  defp item_count(_data), do: 1

  defp progress_signature(run, results) do
    signature =
      results
      |> Enum.map(&{&1.item_ref, &1.status, &1.count})
      |> :erlang.term_to_binary()
      |> then(&:crypto.hash(:sha256, &1))
      |> Base.encode16(case: :lower)

    "#{run.run_id}:readonly_batch:#{signature}"
  end

  defp current_step_ref(run, sequence),
    do: run.current_step_ref || "step_#{run.run_id}_#{sequence}"
end
