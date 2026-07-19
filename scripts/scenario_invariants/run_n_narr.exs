# N-NARR 作者过程叙事来源绑定 driver
#
# 不变量定义：docs/design/adr/ADR-0022-agentic-loop-plan-reasoning-authorship-v3.md §决策3
#
# 运行：
#   MIX_ENV=test mix run scripts/scenario_invariants/run_n_narr.exs
#
# 设计：
# - 通过真实 AgentRunService + conversation_turn_v1 跑一条 AgentRun。
# - 注入 provider execution dependency，并记录同 run ProviderOutput 的原始输出字节。
# - 对所有作者可见 reasoning event 的 author_narrative 做字节级 source binding 验证：
#     source_type == provider_output
#     source_hash == sha256(provider output text)
#     narrative_hash == sha256(author_narrative)
#     source_byte_range 指向的 provider output bytes == author_narrative
# - 对 provider chunk 投影出的 author_narrative_delta 做同 run/call 累计前缀验证。
# - 明确拒绝 agent_observation / AgentEvent.summary / ProviderEvent.summary 等 app 模板来源。
#
# 报告输出：
#   artifacts/scenario-invariants/n_narr.md
#   artifacts/scenario-invariants/n_narr.json

defmodule NNarrDriver do
  @moduledoc false

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.Result
  alias NovelApplication.{AgentNarrativeSource, AgentRunService, DialoguePlanningService}
  alias NovelCommon.Contracts.{ProviderEvent, ProviderOutput, ProviderRun}

  @reasoning_types [:judgment_decided, :plan_drafted, :plan_revised, :exploration_observed, :evaluation_made]

  def run do
    File.mkdir_p!("artifacts/scenario-invariants")
    Application.put_env(:novel_application, :agent_run_fact_persistence_enabled, false)

    result =
      try do
        run_case()
      rescue
        error ->
          %{
            outcome: :error,
            detail: "exception: #{Exception.message(error)}"
          }
      end

    write_markdown("artifacts/scenario-invariants/n_narr.md", result)
    write_json("artifacts/scenario-invariants/n_narr.json", result)

    IO.puts("\nN-NARR #{String.upcase(to_string(result.outcome))}: #{result.detail}")

    if result.outcome == :pass, do: :ok, else: System.halt(1)
  end

  defp run_case do
    {:ok, outputs} = Agent.start_link(fn -> %{} end)
    provider_execution = provider_execution(outputs)

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
        provider_execution
      )

    {:ok, events_agent} = Agent.start_link(fn -> [] end)
    parent = self()

    try do
      {:ok, run_id} =
        AgentRunService.start_bounded(spec.run_attrs,
          next_step_planner: spec.next_step_planner,
          event_sink: fn event ->
            Agent.update(events_agent, &[event | &1])
            send(parent, {:agent_event, event})
          end
        )

      case wait_until_terminal() do
        :ok ->
          :ok

        {:error, reason} ->
          events = Agent.get(events_agent, &Enum.reverse/1)

          %{
            run_id: run_id,
            outcome: :error,
            detail: "AgentRun did not complete: #{inspect(reason)}",
            events: summarize_events(events),
            provider_output_count: map_size(Agent.get(outputs, & &1))
          }
          |> then(&throw({:n_narr_terminal_error, &1}))
      end

      events = Agent.get(events_agent, &Enum.reverse/1)
      provider_outputs = Agent.get(outputs, & &1)

      evaluate(run_id, events, provider_outputs)
    after
      Agent.stop(events_agent)
      Agent.stop(outputs)
    end
  end

  defp provider_execution(outputs) do
    %Execution{
      purpose: :conversation,
      execute_fn: fn prompt ->
        {content, tool_calls} =
          cond do
            # 判断①第二段：强制 judgment_decision（reply 直答，本轮不动用创作能力）
            judgment_decision_prompt?(prompt) ->
              {"", [judgment_decision_tool_call()]}

            # 判断①第一段：自由叙事流（作者可见 reasoning 的绑定来源）
            judgment_narrative_prompt?(prompt) ->
              {judgment_narrative(), []}

            # 两段式第二段：强制 tool call 的结构化调用
            agent_plan_structure_prompt?(prompt) ->
              packet = plan_draft_packet(prompt)
              {Map.fetch!(packet, :reasoning), [agent_plan_tool_call("agent_plan_draft", packet)]}

            # 两段式第一段：无 tools 的流式 reasoning 调用（author_narrative_delta 来源）
            agent_plan_draft_prompt?(prompt) ->
              packet = plan_draft_packet(prompt)
              {Map.fetch!(packet, :reasoning), []}

            agent_next_step_prompt?(prompt) ->
              {reasoning_tail(next_step_decision(prompt)), []}

            true ->
              {conversation_frame_json(), []}
          end

        execution_result(prompt, content, tool_calls, provider_purpose(prompt), outputs)
      end
    }
  end

  defp execution_result(_prompt, content, tool_calls, purpose, outputs) do
    run_ref = "prun-nnarr-#{purpose}-#{System.unique_integer([:positive, :monotonic])}"
    call_ref = "pcall-nnarr-#{purpose}-#{System.unique_integer([:positive, :monotonic])}"

    {:ok, run} =
      ProviderRun.new(%{
        provider_run_id: run_ref,
        provider_call_ref: call_ref,
        purpose: purpose,
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

    reasoning_delta = author_reasoning_delta(purpose, content)

    {:ok, chunk} =
      ProviderEvent.new(%{
        event_id: "#{run_ref}:chunk",
        provider_run_ref: run_ref,
        sequence: 2,
        event_type: :chunk,
        visibility: :author,
        summary: "provider_event:chunk",
        refs: [call_ref],
        payload:
          %{
            output_type: :text,
            chunk_index: 1,
            content_length: String.length(reasoning_delta || content),
            accumulated_content_length: String.length(reasoning_delta || content),
            author_narrative_delta: reasoning_delta
          }
          |> Enum.reject(fn {_key, value} -> is_nil(value) end)
          |> Map.new()
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
        content: provider_output_content(content, tool_calls),
        usage: %{total_tokens: 1},
        refs: [call_ref]
      })

    Agent.update(outputs, &Map.put(&1, output.provider_run_ref, content))

    {:ok,
     %{
       provider_run: run,
       events: [started, chunk, final],
       output: output,
       result: Result.new(content, nil, tool_calls: tool_calls)
     }}
  end

  defp evaluate(run_id, events, provider_outputs) do
    reasoning_events =
      Enum.filter(events, fn event ->
        event.visibility == :author and event.event_type in @reasoning_types
      end)

    checked =
      reasoning_events
      |> Enum.filter(&author_narrative?/1)
      |> Enum.map(&check_event(&1, provider_outputs))

    forbidden_sources =
      events
      |> Enum.filter(fn event ->
        source_type = get_in(event.payload || %{}, [:author_narrative_source, :source_type])
        source_type == "agent_observation"
      end)
      |> Enum.map(& &1.event_type)

    stream_checks = check_stream_deltas(events, provider_outputs)

    invalid_provider_author_events =
      events
      |> Enum.filter(&(&1.event_type == :provider_progress and &1.visibility == :author))
      |> Enum.reject(&valid_author_reasoning_delta_event?/1)

    cond do
      checked == [] ->
        %{
          run_id: run_id,
          outcome: :fail,
          detail: "no author-visible reasoning narratives were emitted",
          checked: checked,
          provider_output_count: map_size(provider_outputs)
        }

      Enum.any?(checked, &(&1.outcome == :fail)) ->
        %{
          run_id: run_id,
          outcome: :fail,
          detail: "one or more author narratives failed provider-output byte binding",
          checked: checked,
          provider_output_count: map_size(provider_outputs)
        }

      stream_checks == [] ->
        %{
          run_id: run_id,
          outcome: :fail,
          detail: "no streamed author reasoning deltas were emitted",
          checked: checked,
          stream_checks: stream_checks,
          provider_output_count: map_size(provider_outputs)
        }

      Enum.any?(stream_checks, &(&1.outcome == :fail)) ->
        %{
          run_id: run_id,
          outcome: :fail,
          detail:
            "one or more streamed author reasoning deltas failed provider-output prefix binding",
          checked: checked,
          stream_checks: stream_checks,
          provider_output_count: map_size(provider_outputs)
        }

      forbidden_sources != [] ->
        %{
          run_id: run_id,
          outcome: :fail,
          detail: "agent_observation was used as author_narrative_source",
          forbidden_sources: forbidden_sources,
          checked: checked,
          provider_output_count: map_size(provider_outputs)
        }

      invalid_provider_author_events != [] ->
        %{
          run_id: run_id,
          outcome: :fail,
          detail: "non-reasoning provider_progress leaked into author visibility",
          checked: checked,
          stream_checks: stream_checks,
          provider_output_count: map_size(provider_outputs)
        }

      true ->
        %{
          run_id: run_id,
          outcome: :pass,
          detail:
            "#{length(checked)} author narratives byte-bound and #{length(stream_checks)} streamed reasoning prefixes verified",
          checked: checked,
          stream_checks: stream_checks,
          provider_output_count: map_size(provider_outputs)
        }
    end
  end

  defp check_event(event, provider_outputs) do
    narrative = event.payload.author_narrative
    source = event.payload.author_narrative_source || %{}

    case AgentNarrativeSource.verify(narrative, source, provider_outputs) do
      :ok ->
        %{
          event_type: event.event_type,
          sequence: event.sequence,
          outcome: :pass,
          provider_output_ref: source.provider_output_ref,
          byte_range: source.source_byte_range
        }

      {:error, reason} ->
        %{
          event_type: event.event_type,
          sequence: event.sequence,
          outcome: :fail,
          reason: inspect(reason),
          source: source
        }
    end
  end

  defp author_narrative?(event) do
    is_binary(event.payload[:author_narrative]) and event.payload[:author_narrative] != ""
  end

  defp check_stream_deltas(events, provider_outputs) do
    events
    |> Enum.filter(&valid_author_reasoning_delta_event?/1)
    |> Enum.group_by(& &1.payload.provider_run_ref)
    |> Enum.map(fn {provider_run_ref, delta_events} ->
      narrative =
        delta_events
        |> Enum.sort_by(& &1.sequence)
        |> Enum.map_join("", & &1.payload.author_narrative_delta)

      case Map.get(provider_outputs, provider_run_ref) do
        source_text when is_binary(source_text) ->
          if String.starts_with?(source_text, narrative) do
            %{
              provider_run_ref: provider_run_ref,
              outcome: :pass,
              streamed_byte_length: byte_size(narrative)
            }
          else
            %{
              provider_run_ref: provider_run_ref,
              outcome: :fail,
              reason: :streamed_delta_not_provider_output_prefix
            }
          end

        _ ->
          %{
            provider_run_ref: provider_run_ref,
            outcome: :fail,
            reason: :provider_output_not_found
          }
      end
    end)
  end

  defp valid_author_reasoning_delta_event?(event) do
    event.event_type == :provider_progress and
      get_in(event.payload || %{}, [:purpose]) == "author_reasoning" and
      is_binary(get_in(event.payload || %{}, [:author_narrative_delta])) and
      get_in(event.payload || %{}, [:author_narrative_delta]) != "" and
      is_binary(get_in(event.payload || %{}, [:provider_run_ref]))
  end

  defp wait_until_terminal do
    receive do
      {:agent_event, %{event_type: :run_completed}} -> :ok
      {:agent_event, %{event_type: :run_failed} = event} -> {:error, summarize_event(event)}
      {:agent_event, %{event_type: :run_cancelled} = event} -> {:error, summarize_event(event)}
      {:agent_event, _event} -> wait_until_terminal()
    after
      3_000 -> {:error, :timeout}
    end
  end

  defp provider_purpose(prompt) do
    cond do
      # 结构化调用是 :planner，叙事 delta 只来自第一段流式 reasoning
      judgment_decision_prompt?(prompt) -> :planner
      judgment_narrative_prompt?(prompt) -> :author_reasoning
      agent_plan_structure_prompt?(prompt) -> :planner
      author_reasoning_prompt?(prompt) -> :author_reasoning
      true -> :conversation
    end
  end

  defp author_reasoning_prompt?(prompt),
    do: agent_plan_draft_prompt?(prompt) or agent_next_step_prompt?(prompt)

  # ── 判断纪元（2026-07 帧退役批次 2）：conversation_turn_v1 随帧纪元退役，
  # 简单对话经 :profile_routing 判断循环 reply 直答。叙事绑定语义不变：
  # 判断①call1 的流式叙事是作者可见 reasoning 的唯一合法来源。

  @judgment_narrative "作者想直接讨论下一步创作方向；当前作品摘要已经覆盖回答所需的信息，我直接在本轮回复，不动用创作能力。"

  defp judgment_narrative, do: @judgment_narrative

  defp judgment_prompt?(prompt), do: prompt |> prompt_text() |> String.contains?("创作判断器")

  defp judgment_decision_prompt?(prompt) when is_map(prompt) do
    judgment_prompt?(prompt) and NovelAgent.Provider.tool_call_prompt?(prompt) and
      NovelAgent.Provider.tool_choice(prompt) == "judgment_decision"
  end

  defp judgment_decision_prompt?(_prompt), do: false

  defp judgment_narrative_prompt?(prompt) when is_map(prompt) do
    judgment_prompt?(prompt) and not NovelAgent.Provider.tool_call_prompt?(prompt)
  end

  defp judgment_narrative_prompt?(_prompt), do: false

  defp judgment_decision_tool_call do
    %{
      "name" => "judgment_decision",
      "arguments" => %{
        "action" => "reply",
        "capability" => nil,
        "reply_included" => true,
        "reason" => "context_sufficient_for_direct_reply",
        "candidate_directions" => []
      }
    }
  end

  defp agent_plan_structure_prompt?(prompt) when is_map(prompt) do
    NovelAgent.Provider.tool_call_prompt?(prompt) and
      NovelAgent.Provider.tool_choice(prompt) in ["agent_plan_draft", "agent_plan_revision"]
  end

  defp agent_plan_structure_prompt?(_prompt), do: false

  defp agent_plan_draft_prompt?(prompt) when is_binary(prompt),
    do: String.contains?(prompt, "AgentRun 计划起草器") or String.contains?(prompt, "AgentRun 计划修订器")

  defp agent_plan_draft_prompt?(prompt) when is_map(prompt) do
    prompt |> prompt_text() |> agent_plan_draft_prompt?()
  end

  defp agent_plan_draft_prompt?(_prompt), do: false

  defp agent_next_step_prompt?(prompt) when is_binary(prompt),
    do: String.contains?(prompt, "AgentRun 下一步规划器")

  defp agent_next_step_prompt?(_prompt), do: false

  defp plan_draft_packet(prompt) do
    prompt_text = prompt_text(prompt)

    packet =
      if String.contains?(prompt_text, "profile_ref: conversation_turn_v1") do
        %{
          reasoning: "模型先读取当前作品上下文，再形成对话认知帧，完成系统裁决后生成本轮回应。",
          steps: [
            plan_step("context_assemble", "explore", "组装当前作品上下文。", [
              "context_observation_created"
            ]),
            plan_step("dialogue_frame", "explore", "形成对话认知帧。", [
              "dialogue_frame_created"
            ]),
            plan_step("strategy_gate", "explore", "制定执行策略并完成系统裁决。", [
              "strategy_decision_created"
            ]),
            plan_step("response_finalize", "explore", "生成本轮回应并写入可回放留痕。", [
              "turn_result_emitted"
            ])
          ],
          reason_codes: ["agent_plan_drafted", "conversation_plan_drafted"]
        }
      else
        %{
          reasoning: "模型为当前目标起草一条最小执行计划。",
          steps: [
            plan_step("context_assemble", "explore", "读取当前上下文。", [
              "context_observation_created"
            ])
          ],
          reason_codes: ["agent_plan_drafted"]
        }
      end

    packet
  end

  defp plan_step(target_tool_ref, kind, description, success_criteria) do
    %{
      step_id: target_tool_ref,
      kind: kind,
      description: description,
      success_criteria: success_criteria,
      depends_on: [],
      target_tool_ref: target_tool_ref,
      write_intent: "none",
      risk_hint: "low",
      authoring_intent: nil,
      target_chapter: nil,
      requested_chapter_raw: nil
    }
  end

  defp agent_plan_tool_call(tool_name, packet) do
    %{
      "name" => tool_name,
      "arguments" => %{
        "plan" => %{"steps" => Map.fetch!(packet, :steps)},
        "reason_codes" => Map.get(packet, :reason_codes, ["agent_plan_drafted"]),
        "confidence" => Map.get(packet, :confidence, 1.0)
      }
    }
  end

  defp provider_output_content(content, []), do: %{text: content}
  defp provider_output_content(content, tool_calls), do: %{text: content, tool_calls: tool_calls}

  defp prompt_text(prompt) when is_binary(prompt), do: prompt

  defp prompt_text(%{messages: messages}) when is_list(messages), do: messages_text(messages)
  defp prompt_text(%{"messages" => messages}) when is_list(messages), do: messages_text(messages)
  defp prompt_text(_prompt), do: ""

  defp messages_text(messages) do
    messages
    |> Enum.map(fn
      %{content: content} when is_binary(content) -> content
      %{"content" => content} when is_binary(content) -> content
      _message -> ""
    end)
    |> Enum.join("\n")
  end

  defp next_step_decision(prompt) do
    cond do
      observation_present?(prompt, "已生成本轮回应") ->
        done_next("模型确认本轮回应已经生成，目标已满足。", [
          "goal_satisfied",
          "n_narr_response_created"
        ])

      observation_present?(prompt, ["无需工具", "工具执行授权", "执行策略"]) ->
        continue_next("根据模型看到的系统裁决生成本轮回应。", "response_finalize", [
          "conversation_strategy_consumed"
        ])

      observation_present?(prompt, "对话认知帧") ->
        continue_next("模型基于对话认知帧继续判断执行策略。", "strategy_gate", [
          "dialogue_frame_consumed"
        ])

      observation_present?(prompt, "已组装本轮创作上下文") ->
        continue_next("模型已看到上下文，下一步形成对话认知帧。", "dialogue_frame", [
          "conversation_context_consumed"
        ])

      true ->
        continue_next("模型先读取当前作品上下文，再判断如何回应作者。", "context_assemble", [
          "missing_conversation_context"
        ])
    end
  end

  defp continue_next(reasoning, target_tool_ref, reason_codes) do
    %{
      reasoning: reasoning,
      decision: %{type: "continue"},
      next_action: %{target_tool_ref: target_tool_ref, write_intent: "none", risk_hint: "low"},
      plan_revision: nil,
      reason_codes: ["agentic_next_step" | reason_codes],
      confidence: 1.0
    }
  end

  defp done_next(reasoning, reason_codes) do
    %{
      reasoning: reasoning,
      decision: %{type: "done"},
      next_action: %{target_tool_ref: nil, write_intent: "none", risk_hint: "low"},
      plan_revision: nil,
      reason_codes: reason_codes,
      confidence: 1.0
    }
  end

  defp reasoning_tail(packet) do
    tail = %{
      evaluation_of_last: %{
        advanced: Map.get(Map.fetch!(packet, :decision), :type) != "no_progress",
        plan_holds: true,
        new_constraint: nil
      },
      decision: Map.fetch!(packet, :decision),
      next_action: Map.fetch!(packet, :next_action),
      plan_revision: Map.get(packet, :plan_revision),
      reason_codes: Map.get(packet, :reason_codes, []),
      confidence: Map.get(packet, :confidence, 1.0)
    }

    Map.fetch!(packet, :reasoning) <> "\n" <> Jason.encode!(tail)
  end

  defp author_reasoning_delta(:author_reasoning, content) when is_binary(content) do
    content
    |> String.split("{", parts: 2)
    |> hd()
    |> case do
      "" -> nil
      delta -> delta
    end
  end

  defp author_reasoning_delta(_purpose, _content), do: nil

  defp observation_present?(prompt, values) when is_list(values),
    do: Enum.any?(values, &observation_present?(prompt, &1))

  defp observation_present?(prompt, value) when is_binary(prompt) and is_binary(value),
    do: String.contains?(existing_observation_section(prompt), value)

  defp existing_observation_section(prompt) do
    prompt
    |> String.split("## 决策规则", parts: 2)
    |> hd()
  end

  defp conversation_frame_json do
    Jason.encode!(%{
      frame_type: "casual_reply",
      dialogue_goal_summary: "回应作者测试输入",
      needs_tool: false,
      no_tool_reason: "no_tool_needed",
      execution_readiness: "not_applicable",
      assistant_message: "可以先补一段承接上一章的冲突，再把新线索放在结尾。",
      candidate_directions: [],
      context_used: true,
      uncertainty: []
    })
  end

  defp write_json(path, result), do: File.write!(path, Jason.encode!(result, pretty: true))

  defp write_markdown(path, result) do
    lines = [
      "# N-NARR AgentRun Narrative Binding",
      "",
      "- outcome: #{result.outcome}",
      "- detail: #{result.detail}",
      "- provider_output_count: #{Map.get(result, :provider_output_count, 0)}",
      "",
      "## Checked Events",
      ""
    ]

    checked =
      result
      |> Map.get(:checked, [])
      |> Enum.map(fn item ->
        "- #{item.event_type}##{item.sequence}: #{item.outcome}"
      end)

    stream_checks =
      result
      |> Map.get(:stream_checks, [])
      |> Enum.map(fn item ->
        "- stream #{item.provider_run_ref}: #{item.outcome}"
      end)

    File.write!(
      path,
      Enum.join(lines ++ checked ++ ["", "## Stream Checks", ""] ++ stream_checks, "\n") <> "\n"
    )
  end

  defp summarize_events(events) do
    Enum.map(events, &summarize_event/1)
  end

  defp summarize_event(event) do
    %{
      event_type: event.event_type,
      sequence: event.sequence,
      visibility: event.visibility,
      summary: event.summary,
      reason_codes: event.reason_codes,
      payload: json_safe(event.payload)
    }
  end

  defp json_safe(%_{} = struct), do: struct |> Map.from_struct() |> json_safe()

  defp json_safe(map) when is_map(map) do
    map
    |> Enum.map(fn {key, value} -> {to_string(key), json_safe(value)} end)
    |> Map.new()
  end

  defp json_safe(list) when is_list(list), do: Enum.map(list, &json_safe/1)
  defp json_safe(atom) when is_atom(atom), do: to_string(atom)
  defp json_safe(value), do: value
end

try do
  NNarrDriver.run()
catch
  {:n_narr_terminal_error, result} ->
    File.write!("artifacts/scenario-invariants/n_narr.md", """
    # N-NARR AgentRun Narrative Binding

    - outcome: #{result.outcome}
    - detail: #{result.detail}
    - provider_output_count: #{Map.get(result, :provider_output_count, 0)}

    ## Events

    #{Enum.map_join(Map.get(result, :events, []), "\n", fn event -> "- #{event.event_type}##{event.sequence}: #{event.summary}" end)}
    """)

    File.write!("artifacts/scenario-invariants/n_narr.json", Jason.encode!(result, pretty: true))
    IO.puts("\nN-NARR #{String.upcase(to_string(result.outcome))}: #{result.detail}")
    System.halt(1)
end
