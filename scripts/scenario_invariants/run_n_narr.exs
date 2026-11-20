# N-NARR：当前判断入口的接受后作者叙述与来源绑定。
#
# 运行前先复用 scripts/lib/test_env.sh 的 novel_test_db_prepare 创建隔离测试库：
#   MIX_ENV=test mix run scripts/scenario_invariants/run_n_narr.exs
#
# 真实链路：profile_routing → judgment_loop_v1 → JP → judgment_decided。
# 固定原文在执行前声明；实际 ProviderOutput 与全部运行事件原样收集。
# 输入 chunk 故意带 author 标记和叙述 delta，挑战真实生产投影的接受边界；
# driver 不清洗它。接受前必须 developer，接受后的固定原文必须恰好交付一次。
# 坏来源样本只挑战本 driver 的证据审计，不冒称生产 JP 执行过这些拒绝路径。
# 本入口不覆盖 Planner/Writer、UI 来源交接或真实模型的自然语言质量。
#
# 报告：artifacts/scenario-invariants/n_narr.{md,json}

defmodule NNarrDriver do
  @moduledoc false

  alias NovelAgent.Provider.{Execution, Result}
  alias NovelApplication.{AgentNarrativeSource, AgentRunService, DialoguePlanningService}
  alias NovelCommon.Contracts.{ProviderEvent, ProviderOutput, ProviderRun}

  @narrative "先明确本章主角必须完成的目标，再检查冲突是否迫使他作出选择。\n对照标记：青石-NNARR-7C42。"
  @template "系统已经自动整理了创作过程，请继续下一步。"

  def run do
    File.mkdir_p!("artifacts/scenario-invariants")
    Application.put_env(:novel_application, :agent_run_fact_persistence_enabled, false)

    result =
      try do
        run_case()
      rescue
        error ->
          %{outcome: :error, detail: "exception: #{Exception.message(error)}"}
      catch
        {:n_narr_terminal_error, result} -> result
      end

    write_markdown("artifacts/scenario-invariants/n_narr.md", result)
    write_json("artifacts/scenario-invariants/n_narr.json", result)

    IO.puts("\nN-NARR #{String.upcase(to_string(result.outcome))}: #{result.detail}")
    if result.outcome == :pass, do: :ok, else: System.halt(1)
  end

  defp run_case do
    {:ok, outputs} = Agent.start_link(fn -> %{} end)

    spec =
      DialoguePlanningService.run_spec_for_profile(
        :profile_routing,
        %{
          text: "请根据当前作品状态回复下一步创作建议。",
          workspace_id: "n-narr-workspace",
          work_id: "n-narr-work",
          session_id: "n-narr-session",
          turn_id: "n-narr-turn"
        },
        nil,
        provider_execution(outputs)
      )

    try do
      :ok = AgentRunService.subscribe_events(spec.run_attrs.work_id, spec.run_attrs.session_id)

      {:ok, run_id} =
        AgentRunService.start_bounded(spec.run_attrs, next_step_planner: spec.next_step_planner)

      case wait_until_terminal([]) do
        {:ok, events} ->
          evaluate(run_id, events, Agent.get(outputs, & &1))

        {:error, reason, events} ->
          throw(
            {:n_narr_terminal_error,
             %{
               run_id: run_id,
               outcome: :error,
               detail: "AgentRun did not complete: #{inspect(reason)}",
               events: events,
               provider_outputs: Agent.get(outputs, & &1)
             }}
          )
      end
    after
      Agent.stop(outputs)
    end
  end

  defp provider_execution(outputs) do
    %Execution{purpose: :planner, execute_fn: fn _prompt -> execution_result(outputs) end}
  end

  defp execution_result(outputs) do
    run_ref = "prun-nnarr-#{System.unique_integer([:positive, :monotonic])}"
    call_ref = "pcall-nnarr-#{System.unique_integer([:positive, :monotonic])}"

    {:ok, run} =
      ProviderRun.new(%{
        provider_run_id: run_ref,
        provider_call_ref: call_ref,
        purpose: :planner,
        execution_mode: :event_stream,
        status: :completed,
        provider_id: "n-narr-driver",
        model: "deterministic"
      })

    {:ok, started} =
      ProviderEvent.new(%{
        event_id: "#{run_ref}:started",
        provider_run_ref: run_ref,
        sequence: 1,
        event_type: :started,
        visibility: :developer,
        summary: "provider_event:started",
        refs: [call_ref],
        payload: %{}
      })

    # 故意保留未接受的作者片段：必须由 JP 的真实 stage 投影隔离，
    # 不能在 fixture 或事件收集处先改成 developer 或删掉 delta。
    {:ok, chunk} =
      ProviderEvent.new(%{
        event_id: "#{run_ref}:chunk",
        provider_run_ref: run_ref,
        sequence: 2,
        event_type: :chunk,
        visibility: :author,
        summary: "provider_event:chunk",
        refs: [call_ref],
        payload: %{
          output_type: :text,
          chunk_index: 1,
          content_length: String.length(@narrative),
          accumulated_content_length: String.length(@narrative),
          author_narrative_delta: @narrative
        }
      })

    {:ok, final} =
      ProviderEvent.new(%{
        event_id: "#{run_ref}:final_output",
        provider_run_ref: run_ref,
        sequence: 3,
        event_type: :final_output,
        visibility: :developer,
        summary: "provider_event:final_output",
        refs: [call_ref],
        payload: %{}
      })

    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: run_ref,
        provider_call_ref: call_ref,
        status: :ok,
        output_type: :text,
        content: %{text: @narrative},
        usage: %{total_tokens: 1},
        refs: [call_ref]
      })

    Agent.update(outputs, &Map.put(&1, output.provider_run_ref, output))

    {:ok,
     %{
       provider_run: run,
       events: [started, chunk, final],
       output: output,
       result: Result.new(@narrative)
     }}
  end

  defp evaluate(run_id, events, provider_outputs) do
    narratives =
      Enum.filter(events, fn event ->
        event.visibility == :author and is_binary(event.payload[:author_narrative])
      end)

    checked = Enum.map(narratives, &check_event(&1, run_id, provider_outputs))
    progress = Enum.filter(events, &(&1.event_type == :provider_progress))
    chunks = Enum.filter(progress, &(&1.payload[:provider_event_type] == :chunk))
    counterexamples = check_counterexamples(run_id, provider_outputs)

    accepted_once? =
      case narratives do
        [%{event_type: :judgment_decided, payload: %{author_narrative: @narrative}}] -> true
        _ -> false
      end

    progress_private? =
      Enum.all?(progress, fn event ->
        event.visibility == :developer and
          event.payload[:author_narrative_delta] in [nil, ""]
      end)

    chunks_before_acceptance? =
      case narratives do
        [%{sequence: accepted_sequence}] ->
          Enum.all?(chunks, &(&1.sequence < accepted_sequence))

        _ ->
          false
      end

    chunk_identity? =
      Enum.all?(chunks, fn event ->
        output = Map.get(provider_outputs, event.payload[:provider_run_ref])

        match?(%ProviderOutput{}, output) and event.run_ref == run_id and
          event.payload[:provider_call_ref] == output.provider_call_ref
      end)

    checks = %{
      one_provider_output: map_size(provider_outputs) == 1,
      provider_chunk_observed: chunks != [],
      provider_progress_is_developer: progress_private?,
      provider_chunk_identity: chunk_identity?,
      chunks_precede_accepted_narrative: chunks_before_acceptance?,
      accepted_fixed_narrative_once: accepted_once?,
      accepted_source_bound: checked != [] and Enum.all?(checked, &(&1.outcome == :pass)),
      bad_evidence_rejected: Enum.all?(counterexamples, &(&1.outcome == :pass))
    }

    failed = for {name, false} <- checks, do: name

    %{
      run_id: run_id,
      outcome: if(failed == [], do: :pass, else: :fail),
      detail:
        if(failed == [],
          do: "accepted narrative byte-bound once; unaccepted provider chunks remain developer",
          else: "failed checks: #{Enum.join(failed, ", ")}"
        ),
      expected_narrative: @narrative,
      checks: checks,
      checked: checked,
      evidence_counterexamples: counterexamples,
      counterexample_scope: "evidence audit only; not production JP rejection-path coverage",
      coverage: "profile_routing → judgment_loop_v1; not Planner/Writer or UI ownership",
      provider_output_count: map_size(provider_outputs),
      provider_outputs: provider_outputs,
      events: events
    }
  end

  # AgentNarrativeSource 负责原件的 hash/range 校验；本证据审计另外核对实际
  # AgentRun 和捕获原件的 run/call/output 身份，不替代产品的接受与纠错。
  defp check_event(event, run_id, provider_outputs) do
    narrative = event.payload[:author_narrative]
    source = event.payload[:author_narrative_source] || %{}
    output = Map.get(provider_outputs, source[:provider_output_ref])

    identity =
      cond do
        event.run_ref != run_id ->
          {:error, :agent_run_mismatch}

        not match?(%ProviderOutput{}, output) ->
          {:error, :provider_output_not_found}

        source[:provider_output_ref] != output.provider_run_ref ->
          {:error, :provider_output_identity_mismatch}

        source[:provider_run_ref] != output.provider_run_ref ->
          {:error, :provider_run_mismatch}

        source[:provider_call_ref] != output.provider_call_ref ->
          {:error, :provider_call_mismatch}

        true ->
          :ok
      end

    result =
      with :ok <- identity do
        AgentNarrativeSource.verify(narrative, source, provider_outputs)
      end

    %{
      event_type: event.event_type,
      sequence: event.sequence,
      outcome: if(result == :ok, do: :pass, else: :fail),
      reason: if(result == :ok, do: nil, else: inspect(result)),
      narrative: narrative,
      source: source
    }
  end

  # 反例基线由事先声明的固定原文和注入边界捕获的原件独立建立，
  # 不从实际 accepted 事件或被测 source constructor 生成期望。
  defp check_counterexamples(run_id, provider_outputs) when map_size(provider_outputs) == 1 do
    [{output_ref, output}] = Map.to_list(provider_outputs)
    hash = :crypto.hash(:sha256, @narrative) |> Base.encode16(case: :lower)

    source = %{
      source_type: "provider_output",
      provider_run_ref: output.provider_run_ref,
      provider_call_ref: output.provider_call_ref,
      provider_output_ref: output_ref,
      source_hash: hash,
      narrative_hash: hash,
      source_byte_range: %{start: 0, length: byte_size(@narrative)}
    }

    evidence = %{
      run_ref: run_id,
      event_type: :judgment_decided,
      sequence: 1,
      payload: %{author_narrative: @narrative, author_narrative_source: source}
    }

    # 先确认独立合法样本能够通过，避免“一律拒绝”让全部反例虚假通过。
    control = check_event(evidence, run_id, provider_outputs)

    bad_sources = [
      {:agent_observation, %{source | source_type: "agent_observation"}},
      {:wrong_provider_run, %{source | provider_run_ref: "prun-nnarr-foreign"}},
      {:wrong_provider_call, %{source | provider_call_ref: "pcall-nnarr-foreign"}},
      {:missing_provider_output, %{source | provider_output_ref: "prun-nnarr-missing"}},
      {:wrong_source_hash, %{source | source_hash: String.duplicate("0", 64)}},
      {:wrong_narrative_hash, %{source | narrative_hash: String.duplicate("0", 64)}},
      {:wrong_range, %{source | source_byte_range: %{start: 1, length: byte_size(@narrative)}}}
    ]

    bad_evidence =
      Enum.map(bad_sources, fn {name, bad_source} ->
        {name, put_in(evidence, [:payload, :author_narrative_source], bad_source)}
      end) ++
        [
          {:wrong_agent_run, %{evidence | run_ref: "run-nnarr-foreign"}},
          {:template_substitution, put_in(evidence, [:payload, :author_narrative], @template)}
        ]

    [
      %{
        name: :independent_valid_evidence,
        expected: :accepted,
        actual: control.outcome,
        outcome: control.outcome,
        reason: control.reason
      }
      | Enum.map(bad_evidence, fn {name, sample} ->
          result = check_event(sample, run_id, provider_outputs)

          %{
            name: name,
            expected: :rejected,
            actual: result.outcome,
            outcome: if(result.outcome == :fail, do: :pass, else: :fail),
            reason: result.reason
          }
        end)
    ]
  end

  defp check_counterexamples(_run_id, _provider_outputs),
    do: [%{name: :captured_provider_output_required, outcome: :fail}]

  defp wait_until_terminal(events) do
    receive do
      {:agent_event, %{event_type: :run_completed} = event} ->
        {:ok, Enum.reverse([event | events])}

      {:agent_event, %{event_type: type} = event} when type in [:run_failed, :run_cancelled] ->
        {:error, type, Enum.reverse([event | events])}

      {:agent_event, event} ->
        wait_until_terminal([event | events])
    after
      3_000 -> {:error, :timeout, Enum.reverse(events)}
    end
  end

  defp write_json(path, result),
    do: File.write!(path, Jason.encode!(json_safe(result), pretty: true))

  defp write_markdown(path, result) do
    checks =
      result
      |> Map.get(:checks, %{})
      |> Enum.sort()
      |> Enum.map(fn {name, passed} -> "- #{name}: #{passed}" end)

    counterexamples =
      result
      |> Map.get(:evidence_counterexamples, [])
      |> Enum.map(fn item -> "- #{item.name}: #{item.outcome}" end)

    File.write!(
      path,
      Enum.join(
        [
          "# N-NARR Accepted Narrative Binding",
          "",
          "- outcome: #{result.outcome}",
          "- detail: #{result.detail}",
          "- provider_output_count: #{Map.get(result, :provider_output_count, 0)}",
          "- scope: profile_routing → judgment_loop_v1",
          "- bad evidence cases audit evidence only; they do not prove production JP rejection paths",
          "- Planner/Writer, UI ownership and real-model language quality are not covered",
          "",
          "## Runtime Checks",
          ""
        ] ++ checks ++ ["", "## Evidence Counterexamples", ""] ++ counterexamples,
        "\n"
      ) <> "\n"
    )
  end

  defp json_safe(%DateTime{} = timestamp), do: timestamp
  defp json_safe(%_{} = struct), do: struct |> Map.from_struct() |> json_safe()

  defp json_safe(map) when is_map(map) do
    Map.new(map, fn {key, value} -> {to_string(key), json_safe(value)} end)
  end

  defp json_safe(list) when is_list(list), do: Enum.map(list, &json_safe/1)
  defp json_safe(value), do: value
end

NNarrDriver.run()
