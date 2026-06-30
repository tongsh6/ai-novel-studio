defmodule NovelApplication.AgentRunFlows.ProviderProgress do
  @moduledoc """
  AgentRun flow that exposes unified provider execution progress through
  author-safe AgentEvent records.
  """

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.Gateway
  alias NovelAgent.Provider.Result, as: ProviderResult
  alias NovelApplication.AgentFinalizer
  alias NovelDomain.{AgentObservation, AgentStep}

  @profile_ref "provider_progress_v1"

  @spec profile_ref() :: String.t()
  def profile_ref, do: @profile_ref

  @spec steps(map()) :: [NovelApplication.AgentRunService.step_fun()]
  def steps(spec) when is_map(spec), do: [provider_step(spec)]

  defp provider_step(spec) do
    fn run, sequence, snapshot ->
      text = Map.get(spec, :text) || run.goal.text
      capabilities = provider_capabilities(spec)

      emit_provider_progress(snapshot, "供应商请求已开始。", ["provider_call_started"], %{
        stage: :provider_call_started,
        provider_capabilities: capabilities,
        stream_mode: stream_mode(capabilities)
      })

      emit_provider_progress(
        snapshot,
        "Provider execution stream 已进入执行中。",
        ["provider_execution_stream_active"],
        %{
          stage: :provider_execution_stream_active,
          provider_capabilities: capabilities,
          stream_mode: stream_mode(capabilities)
        }
      )

      case provider_complete(spec).(provider_prompt(text)) do
        {:ok, result} ->
          content = provider_content(result)

          emit_provider_progress(
            snapshot,
            "供应商已返回完整结果。",
            [
              "provider_call_completed"
            ],
            %{
              stage: :provider_call_completed,
              provider_capabilities: capabilities,
              output_chars: String.length(content)
            }
          )

          turn_result =
            run
            |> turn_result(content, capabilities)
            |> AgentFinalizer.attach_run_summary(%{
              run_id: run.run_id,
              run_mode: run.run_mode,
              profile_ref: run.profile_ref,
              status: :completed
            })

          {:ok,
           %{
             step: step(run, sequence),
             observations: [observation(run, sequence, capabilities)],
             turn_result: turn_result,
             provider_call_count: 1,
             progress_signature: "#{run.run_id}:provider_progress:#{run.goal.version}"
           }}

        {:error, reason} ->
          {:error, {:provider_progress_failed, reason}}
      end
    end
  end

  defp emit_provider_progress(snapshot, summary, reason_codes, payload) do
    case Map.get(snapshot, :stage_sink) do
      sink when is_function(sink, 1) ->
        sink.(%{
          event_type: :provider_progress,
          summary: summary,
          reason_codes: reason_codes,
          payload: payload
        })

      _ ->
        :ok
    end
  end

  defp provider_capabilities(spec) do
    case Map.get(spec, :provider_capabilities_fn) do
      fun when is_function(fun, 0) -> fun.()
      _ -> Gateway.provider_capabilities()
    end
  end

  defp stream_mode(%{supports_streaming: true}), do: :provider_stream
  defp stream_mode(_capabilities), do: :provider_execution_stream

  defp provider_complete(spec) do
    spec
    |> provider_execution()
    |> Execution.complete_fn()
  end

  defp provider_execution(spec) do
    Map.get(spec, :provider_execution) ||
      Execution.dependency(purpose: :other)
  end

  defp provider_prompt(text) do
    """
    请基于作者请求生成一个简短、安全、可展示的创作执行摘要。

    作者请求：
    #{text}
    """
  end

  defp provider_content(%ProviderResult{content: content}) when is_binary(content), do: content
  defp provider_content(%{content: content}) when is_binary(content), do: content
  defp provider_content(%{"content" => content}) when is_binary(content), do: content
  defp provider_content(content) when is_binary(content), do: content
  defp provider_content(_result), do: ""

  defp step(run, sequence) do
    {:ok, step} =
      AgentStep.new(%{
        step_id: current_step_ref(run, sequence),
        run_ref: run.run_id,
        sequence: sequence,
        status: :completed,
        goal: "调用 provider 并记录进度边界",
        micro_plan_ref: "mp_#{run.run_id}_provider_progress_#{sequence}",
        decision_ref: "decision_#{run.run_id}_provider_progress_#{sequence}",
        tool_request_ref: "provider_request_#{run.run_id}_#{sequence}",
        tool_result_ref: "provider_result_#{run.run_id}_#{sequence}",
        observation_refs: ["obs_#{run.run_id}_#{sequence}_provider_progress"],
        state_snapshot_ref: "agent_snapshot:#{run.work_id}:#{run.run_id}:provider_progress",
        idempotency_key: "#{run.run_id}:#{sequence}:provider_progress:goal_v#{run.goal.version}"
      })

    step
  end

  defp observation(run, sequence, capabilities) do
    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: "obs_#{run.run_id}_#{sequence}_provider_progress",
        run_ref: run.run_id,
        step_ref: current_step_ref(run, sequence),
        observation_type: :custom,
        source_ref: "provider_capability:#{run.run_id}",
        summary: "已记录 provider 进度与取消能力边界。",
        structured_payload: %{
          provider_capabilities: capabilities,
          stream_mode: stream_mode(capabilities)
        },
        evidence_refs: [
          "agent_event:provider_progress",
          "provider_capability:#{capability_ref(capabilities)}"
        ]
      })

    observation
  end

  defp turn_result(run, content, capabilities) do
    %{
      schema_version: "3.0-draft",
      turn_id: "#{run.parent_turn_ref}:agent:provider_progress",
      parent_turn_id: run.parent_turn_ref,
      phase: "completed",
      status: "completed",
      next_action: "none",
      assistant_message: %{
        text: "模型调用已完成，进度事件已记录；当前 provider 的取消策略为 #{cancel_strategy_text(capabilities)}。"
      },
      frame_summary: %{
        frame_type: "agent_provider_progress",
        dialogue_goal: "展示 provider 进度与取消能力边界",
        uncertainty: []
      },
      available_actions: [],
      ui_cards: [],
      candidate_directions: [],
      trace_summary: %{
        provider_progress: true,
        provider_output_chars: String.length(content),
        provider_capabilities: capabilities,
        raw_prompt_stored: false
      },
      produced_at: DateTime.utc_now() |> DateTime.to_iso8601()
    }
  end

  defp cancel_strategy_text(%{cancel_strategy: strategy}) do
    case strategy do
      :provider_execution_cancel -> "ProviderExecution 取消"
      "provider_execution_cancel" -> "ProviderExecution 取消"
      _ -> "ProviderExecution 取消"
    end
  end

  defp cancel_strategy_text(_capabilities), do: "ProviderExecution 取消"

  defp capability_ref(%{provider: provider}), do: provider
  defp capability_ref(_capabilities), do: "unknown"

  defp current_step_ref(run, sequence),
    do: run.current_step_ref || "step_#{run.run_id}_#{sequence}"
end
