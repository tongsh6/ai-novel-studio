defmodule NovelApplication.ProviderActivityProjectorTest do
  @moduledoc """
  VS-00L §16.12：应用投影器不派发无序后台事实写入；stage 进展只在该批
  run/event/output 已提交后发布。失败时保留真实模型结果，不发布声称已提交
  的进展，也不重发 Provider。
  """

  use ExUnit.Case, async: false

  import ExUnit.CaptureLog

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.{Execution, Result}
  alias NovelApplication.ProviderActivityProjector
  alias NovelCommon.Contracts.{ProviderEvent, ProviderOutput, ProviderRun}
  alias NovelDomain.AgentRun
  alias NovelPersistence.{ProviderRunLog, Repo}

  setup do
    :ok = Sandbox.checkout(Repo)
  end

  test "publishes each stage event only after run, events and output are committed" do
    run_id = unique("run-projector")
    provider_run_id = unique("prun-projector")
    provider_call_ref = unique("pcall-projector")
    run = agent_run(run_id)
    owner = self()

    sink = fn event ->
      send(
        owner,
        {:published, event, ProviderRunLog.list_runs(run_id),
         ProviderRunLog.list_events(provider_run_id), ProviderRunLog.get_output(provider_run_id)}
      )

      :ok
    end

    execution =
      Execution.dependency(
        provider: :stub,
        provider_run_id: provider_run_id,
        provider_call_ref: provider_call_ref
      )
      |> ProviderActivityProjector.with_stage_sink(
        %{run: run, stage_sink: sink},
        purpose: :conversation
      )

    # Gateway.execute/4 只接受 canonical RequestIR（生产请求已统一），测试按真实形状构造。
    assert {:ok, result} =
             Execution.result_fn(execution).(stub_prompt("hello ordered provider facts"))

    assert result.content != ""
    refute result.content =~ "[stub]"

    publications = collect_publications()
    assert length(publications) >= 2

    Enum.each(publications, fn {event, runs, events, _output} ->
      assert event.event_type == :provider_progress
      assert event.payload.provider_run_ref == provider_run_id
      assert event.payload.provider_call_ref == provider_call_ref
      assert [%{id: ^provider_run_id} = run_record] = runs
      assert run_record.status in ["running", "completed"]

      assert Enum.any?(
               events,
               &(to_string(&1.event_type) == to_string(event.payload.provider_event_type))
             )
    end)

    {final_event, [final_run], final_events, final_output} = List.last(publications)
    assert final_event.payload.status == "ok"
    assert final_run.status == "completed"
    assert final_output.status == "ok"

    assert Enum.map(final_events, & &1.sequence) ==
             Enum.sort(Enum.map(final_events, & &1.sequence))
  end

  test "keeps the provider result and suppresses stage progress when the fact transaction fails" do
    run_id = unique("run-projector-conflict")
    provider_run_id = unique("prun-projector-conflict")
    provider_call_ref = unique("pcall-projector-conflict")
    existing_call_ref = unique("pcall-existing")
    run = agent_run(run_id)
    owner = self()

    existing_run =
      provider_run(provider_run_id, existing_call_ref, :completed, %{purpose: :conversation})

    assert :ok =
             ProviderRunLog.record_execution(
               {:ok, %{provider_run: existing_run}},
               provider_context(run)
             )

    sink = fn event -> send(owner, {:published, event}) end

    execution =
      Execution.dependency(
        provider: :stub,
        provider_run_id: provider_run_id,
        provider_call_ref: provider_call_ref
      )
      |> ProviderActivityProjector.with_stage_sink(
        %{run: run, stage_sink: sink},
        purpose: :conversation
      )

    log =
      capture_log(fn ->
        assert {:ok, result} =
                 Execution.result_fn(execution).(stub_prompt("hello provider conflict"))

        assert result.content != ""
        refute result.content =~ "[stub]"
      end)

    refute_received {:published, _}
    assert log =~ "provider activity persistence failed"
    assert log =~ "provider_run_identity_conflict"

    assert [%{provider_call_ref: ^existing_call_ref, status: "completed"}] =
             ProviderRunLog.list_runs(run_id)

    assert ProviderRunLog.list_events(provider_run_id) == []
    assert ProviderRunLog.get_output(provider_run_id) == nil
  end

  test "keeps author narrative deltas and publishes them after the chunk is committed" do
    run_id = unique("run-projector-narrative")
    provider_run_id = unique("prun-projector-narrative")
    provider_call_ref = unique("pcall-projector-narrative")
    run = agent_run(run_id)
    owner = self()

    provider_run =
      provider_run(provider_run_id, provider_call_ref, :completed, %{purpose: :author_reasoning})

    chunk =
      provider_event(provider_run_id, provider_call_ref, "#{provider_run_id}:chunk", 1, :chunk, %{
        visibility: :author,
        summary: "内心推理",
        payload: %{author_narrative_delta: "内心推理"}
      })

    output = provider_output(provider_run_id, provider_call_ref, %{content: %{text: "正文"}})
    result = Result.new("正文")

    facts = {:ok, %{provider_run: provider_run, events: [chunk], output: output, result: result}}

    sink = fn event ->
      send(owner, {:published, event, ProviderRunLog.list_events(provider_run_id)})
    end

    execution =
      %Execution{result_fn: fn _prompt -> facts end, purpose: :author_reasoning}
      |> ProviderActivityProjector.with_stage_sink(
        %{run: run, stage_sink: sink},
        purpose: :author_reasoning,
        content_visibility: :author
      )

    assert {:ok, %Result{content: "正文"}} = Execution.result_fn(execution).("hello narrative")

    assert_receive {:published, event, persisted_events}
    assert event.visibility == :author
    assert event.summary == "provider_event:chunk"
    assert event.payload.author_narrative_delta == "内心推理"
    assert [%{sequence: 1}] = persisted_events
  end

  for {operation, tool_name} <- [
        {:draft_plan_with_meta, "agent_plan_draft"},
        {:revise_plan_with_meta, "agent_plan_revision"}
      ] do
    @plan_operation operation
    @plan_tool_name tool_name

    test "#{tool_name} 冲突正文中的跨片段内部身份不公开，原始 Provider 证据仍完整持久" do
      run = %{
        agent_run(unique("run-plan-narrative"))
        | profile_ref: "judgment_plan_v1",
          authority_scope: %{production_write: false, allowed_tools: ["archive_read"]}
      }

      owner = self()
      chunks = ["准备读取 charac", "ter:e9fe5f90-c939-4f9e-abee-", "da235d1eaa45。"]
      leaked = Enum.join(chunks)

      arguments = %{
        "author_reasoning" => "先读取作品材料，再安排下一步。",
        "plan" => %{
          "steps" => [
            %{
              "step_id" => "read-context",
              "kind" => "explore",
              "description" => "读取作品材料",
              "success_criteria" => ["作品材料已读取"],
              "target_tool_ref" => "context_assemble"
            }
          ]
        },
        "reason_codes" => ["agent_plan_drafted"],
        "confidence" => 0.9
      }

      execution = %Execution{
        result_fn: fn _request ->
          provider_run_id = unique("prun-plan-narrative")
          call_ref = unique("pcall-plan-narrative")

          tool_calls = [
            %{"id" => "tool-#{call_ref}", "name" => @plan_tool_name, "arguments" => arguments}
          ]

          events =
            for {delta, sequence} <- Enum.with_index(chunks, 1) do
              provider_event(provider_run_id, call_ref, unique("chunk"), sequence, :chunk, %{
                payload: %{author_narrative_delta: delta, chunk_index: sequence}
              })
            end

          {:ok,
           %{
             provider_run:
               provider_run(provider_run_id, call_ref, :completed, %{purpose: :planner}),
             events: events,
             output:
               provider_output(provider_run_id, call_ref, %{
                 content: %{text: leaked, tool_calls: tool_calls}
               }),
             result: Result.new(leaked, nil, tool_calls: tool_calls)
           }}
        end
      }

      snapshot = %{
        run: run,
        stage_sink: fn event ->
          send(owner, {
            :plan_progress,
            event,
            ProviderRunLog.list_events(event.payload.provider_run_ref),
            ProviderRunLog.get_output(event.payload.provider_run_ref)
          })
        end
      }

      result =
        apply(NovelApplication.AgenticPlanDraftPlanner, @plan_operation, [
          run,
          execution,
          snapshot
        ])

      for _attempt <- 1..2, _chunk <- chunks do
        assert_receive {:plan_progress, event, stored, output}
        assert event.visibility == :developer
        assert Map.get(event.payload, :author_narrative_delta) == nil
        assert Enum.map(stored, & &1.payload["author_narrative_delta"]) == chunks

        assert output.content_summary["content_sha256"] ==
                 Base.encode16(:crypto.hash(:sha256, leaked), case: :lower)
      end

      refute_receive {:plan_progress, _, _, _}, 10

      assert {:error, {:agent_plan_protocol_violation, :author_narrative_content_conflict}, meta} =
               result

      assert meta.provider_call_count == 2
    end
  end

  test "判断说明接受前只保留开发者进度和原始证据，不把流式片段发布给作者" do
    run = agent_run(unique("run-judgment-narrative"))
    owner = self()
    leaked = "character:e9fe5f90-c939-4f9e-abee-da235d1eaa45"

    execution = %Execution{
      result_fn: fn _request ->
        provider_run_id = unique("prun-judgment-narrative")
        call_ref = unique("pcall-judgment-narrative")

        chunk =
          provider_event(provider_run_id, call_ref, unique("chunk"), 1, :chunk, %{
            payload: %{author_narrative_delta: leaked, chunk_index: 1}
          })

        {:ok,
         %{
           provider_run:
             provider_run(provider_run_id, call_ref, :completed, %{purpose: :planner}),
           events: [chunk],
           output: provider_output(provider_run_id, call_ref, %{content: %{text: leaked}}),
           result: Result.new(leaked)
         }}
      end
    }

    snapshot = %{
      run: run,
      stage_sink: fn event ->
        send(
          owner,
          {:judgment_progress, event, ProviderRunLog.list_events(event.payload.provider_run_ref),
           ProviderRunLog.get_output(event.payload.provider_run_ref)}
        )
      end
    }

    input = %{
      author_text: "核对角色身份",
      source_input_ref: run.parent_turn_ref,
      scope: %{work_id: run.work_id, facts: %{}, context: %{}, coverage: %{}},
      options: [plan_run: run]
    }

    result = NovelApplication.JudgmentProtocol.request_judgment(execution, snapshot, input)

    for _ <- 1..2 do
      assert_receive {:judgment_progress, event, [stored], output}
      assert event.visibility == :developer
      assert Map.get(event.payload, :author_narrative_delta) == nil
      assert stored.payload["author_narrative_delta"] == leaked

      assert output.content_summary["content_sha256"] ==
               Base.encode16(:crypto.hash(:sha256, leaked), case: :lower)
    end

    refute_receive {:judgment_progress, _, _, _}, 10

    assert {:error, {:judgment_protocol_violation, :author_visible_narrative_invalid}, state} =
             result

    assert state.provider_call_count == 2
  end

  test "public chunk bytes do not become the required event summary, including whitespace" do
    run_id = unique("run-projector-whitespace")
    provider_run_id = unique("prun-projector-whitespace")
    provider_call_ref = unique("pcall-projector-whitespace")
    run = agent_run(run_id)
    owner = self()
    chunks = ["# 标题", "\n\n", "  ", "\t", "**中文**"]
    expected = "# 标题\n\n  \t**中文**"

    events =
      chunks
      |> Enum.with_index(1)
      |> Enum.map(fn {text, index} ->
        provider_event(
          provider_run_id,
          provider_call_ref,
          "#{provider_run_id}:#{index}",
          index,
          :chunk,
          %{payload: %{author_narrative_delta: text, chunk_index: index}}
        )
      end)

    facts =
      {:ok,
       %{
         provider_run:
           provider_run(provider_run_id, provider_call_ref, :completed, %{purpose: :conversation}),
         events: events,
         output:
           provider_output(provider_run_id, provider_call_ref, %{content: %{text: expected}}),
         result: Result.new(expected)
       }}

    execution =
      %Execution{result_fn: fn _request -> facts end, purpose: :conversation}
      |> ProviderActivityProjector.with_stage_sink(
        %{run: run, stage_sink: fn event -> send(owner, {:public_chunk, event}) end},
        purpose: :conversation,
        content_visibility: :author
      )

    assert {:ok, %Result{content: ^expected}} = Execution.result_fn(execution).("公开输出")

    received =
      for expected_delta <- chunks do
        assert_receive {:public_chunk, event}
        assert event.visibility == :author
        assert event.summary == "provider_event:chunk"
        assert event.payload.author_narrative_delta == expected_delta
        event.payload.author_narrative_delta
      end

    assert Enum.join(received) == expected
    assert length(ProviderRunLog.list_events(provider_run_id)) == 5
  end

  test "preserves the runtime fact-persistence disable switch" do
    previous = Application.get_env(:novel_application, :agent_run_fact_persistence_enabled)
    Application.put_env(:novel_application, :agent_run_fact_persistence_enabled, false)

    on_exit(fn ->
      if is_nil(previous) do
        Application.delete_env(:novel_application, :agent_run_fact_persistence_enabled)
      else
        Application.put_env(:novel_application, :agent_run_fact_persistence_enabled, previous)
      end
    end)

    run_id = unique("run-projector-disabled")
    provider_run_id = unique("prun-projector-disabled")
    provider_call_ref = unique("pcall-projector-disabled")
    run = agent_run(run_id)
    owner = self()

    execution =
      Execution.dependency(
        provider: :stub,
        provider_run_id: provider_run_id,
        provider_call_ref: provider_call_ref
      )
      |> ProviderActivityProjector.with_stage_sink(
        %{run: run, stage_sink: fn event -> send(owner, {:published, event}) end},
        purpose: :conversation
      )

    assert {:ok, result} =
             Execution.result_fn(execution).(stub_prompt("hello disabled persistence"))

    assert result.content != ""
    refute result.content =~ "[stub]"
    assert_receive {:published, %{event_type: :provider_progress}}
    assert ProviderRunLog.list_runs(run_id) == []
  end

  # Gateway.execute/4 只接受 canonical RequestIR；stub 按 IR 的 canonical 文本识别请求。
  defp stub_prompt(text) do
    NovelTest.TestRequestIR.ir([NovelTest.TestRequestIR.base(text)])
  end

  defp collect_publications(acc \\ []) do
    receive do
      {:published, event, runs, events, output} ->
        collect_publications([{event, runs, events, output} | acc])
    after
      0 -> Enum.reverse(acc)
    end
  end

  defp unique(prefix), do: "#{prefix}-#{System.unique_integer([:positive, :monotonic])}"

  defp agent_run(run_id) do
    {:ok, run} =
      AgentRun.new(%{
        run_id: run_id,
        workspace_id: "ws-provider-projector-test",
        work_id: "work-provider-projector-test",
        session_id: "session-provider-projector-test",
        parent_turn_ref: "turn-provider-projector-test",
        origin_frame_ref: "frame-provider-projector-test",
        profile_ref: "conversation_turn_v1",
        current_step_ref: "step-provider-projector-test",
        status: :running,
        phase: :executing,
        goal: %{text: "验证 Provider 事实提交顺序", version: 1},
        authority_scope: %{production_write: false, allowed_tools: ["conversation"]}
      })

    run
  end

  defp provider_context(run) do
    %{
      agent_run_id: run.run_id,
      workspace_id: run.workspace_id,
      work_id: run.work_id,
      session_id: run.session_id,
      parent_turn_ref: run.parent_turn_ref,
      step_id: run.current_step_ref,
      purpose: :conversation
    }
  end

  defp provider_run(run_id, call_ref, status, attrs) do
    {:ok, run} =
      ProviderRun.new(
        Map.merge(
          %{
            provider_run_id: run_id,
            provider_call_ref: call_ref,
            purpose: :conversation,
            execution_mode: :event_stream,
            status: status
          },
          attrs
        )
      )

    run
  end

  defp provider_event(run_id, call_ref, event_id, sequence, type, attrs) do
    {:ok, event} =
      ProviderEvent.new(
        Map.merge(
          %{
            event_id: event_id,
            provider_run_ref: run_id,
            sequence: sequence,
            event_type: type,
            visibility: :developer,
            summary: "provider fact",
            payload: %{},
            refs: [call_ref]
          },
          attrs
        )
      )

    event
  end

  defp provider_output(run_id, call_ref, attrs) do
    {:ok, output} =
      ProviderOutput.new(
        Map.merge(
          %{
            provider_run_ref: run_id,
            provider_call_ref: call_ref,
            status: :ok,
            output_type: :text,
            content: %{text: "真实响应"},
            refs: [call_ref]
          },
          attrs
        )
      )

    output
  end
end
