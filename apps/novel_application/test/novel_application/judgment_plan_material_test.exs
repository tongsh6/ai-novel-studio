defmodule NovelApplication.JudgmentPlanMaterialTest do
  use NovelPersistence.DataCase, async: false

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunService
  alias NovelApplication.AuthoringCheckpoint
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.DialoguePlanningService
  alias NovelApplication.WorkService
  alias NovelCommon.Contracts.ProviderOutput
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelFoundation.Enums.{MemorySourceType, MemoryStatus, MemoryType}
  alias NovelPersistence.AgentRunLog
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.WorkSessionRepo

  @tag :r05_mixed_plan_material
  test "单调用混合计划的只读结果进入后续Writer并与原计划调用和持久段绑定" do
    parent = self()
    {:ok, work} = WorkService.create(%{title: "混合计划材料"})
    {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)
    body = "R05MIXEDREAD73" <> String.duplicate("雨", 6_980) <> "尾页未读证据"
    assert String.length(body) == 7_000

    memory =
      %MemoryItem{}
      |> MemoryItem.changeset(%{
        id: Ecto.UUID.generate(),
        work_id: work.id,
        content: body,
        summary: "待核对的设定规则摘要",
        type: MemoryType.style_rule(),
        scope: "WORK",
        status: MemoryStatus.confirmed(),
        source_type: MemorySourceType.author_confirmed(),
        recallable: true,
        version: 7,
        tags: []
      })
      |> Repo.insert!()

    memory_ref = "memory:#{memory.id}"
    execution = mixed_plan_execution(parent, memory_ref)

    assert {:ok, spec} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: "先核对指定资料，再给出一个待采纳世界设定。",
                 workspace_id: work.id,
                 work_id: work.id,
                 session_id: session.id,
                 turn_id: "mixed-plan-author",
                 chapter_prose_reader: fn _, _ -> "" end,
                 chapter_summary_reader: %{},
                 character_reader: fn _ -> [] end
               },
               nil,
               execution
             )

    assert {:ok, run_id} =
             AgentRunService.start_bounded(
               NovelApplication.TestAgentEventRelay.observe(spec.run_attrs, fn event ->
                 send(parent, {:mixed_plan_event, event.event_type, event})
               end),
               interaction_input: spec.interaction_input,
               next_step_planner: spec.next_step_planner
             )

    NovelApplication.TestAgentRunCleanup.register_run(run_id)

    assert_receive {:mixed_plan_request, :writer, writer_request}, 8_000
    assert_receive {:mixed_plan_event, :run_completed, _}, 5_000
    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.profile_ref == "judgment_plan_v1"
    assert state.run.consumed_budget.provider_calls == 2
    assert state.run.consumed_budget.tool_calls == 1
    assert length(state.run.pending_artifact_refs) == 1
    assert :ok = RequestIR.validate(writer_request)

    # 以真实Writer收到的请求为断言边界，不手工调用材料桥或Operation.prepare。
    assert [read] = RequestIR.visible_observations(writer_request)
    assert read.provenance == "application"
    assert read.status == "partial"
    assert read.source_refs == [memory_ref]
    assert read.versions == %{memory_ref => 7}
    assert read.next_offset == 6_000
    assert read.coverage["memory_ref"] == memory_ref
    assert read.coverage["summary"]["offset"] == 0
    assert read.coverage["summary"]["returned_graphemes"] == 6_000
    assert read.coverage["summary"]["total_graphemes"] == 7_000
    assert read.omissions != []
    assert read.content["summary"] == String.slice(body, 0, 6_000)
    refute read.content["summary"] =~ "尾页未读证据"

    [operation] =
      for %{role: "scope_update", provenance: "application", blocks: blocks} <-
            writer_request.messages,
          %{
            type: "scope",
            content: %{"operation" => %{"role" => "planned_exploration"} = operation}
          } <- blocks,
          do: operation

    assert operation["plan_ref"] == state.run.plan_ref
    assert operation["plan_version"] == state.run.plan_version
    assert operation["plan_call_id"] == "inline-plan-call"

    [executed_read] =
      Enum.filter(state.observations, fn observation ->
        observation.structured_payload[:tool] == "memory_recall"
      end)

    assert operation["step_ref"] == executed_read.step_ref
    assert operation["observation_ref"] == executed_read.observation_id

    validations =
      for message <- writer_request.messages,
          %{type: "validation_result"} = block <- message.blocks,
          do: block

    assert Enum.count(validations, &(&1.call_id == "inline-plan-call")) == 1
    assert length(validations) == 1
    plan_validation = Enum.find(validations, &(&1.call_id == "inline-plan-call"))
    assert plan_validation.status == "passed"
    assert plan_validation.reason_code == "agent_plan_validated"
    assert plan_validation.detail["plan_ref"] == state.run.plan_ref
    assert plan_validation.detail["plan_version"] == state.run.plan_version

    assert RequestIR.call_ids(writer_request.messages) == ["inline-plan-call"]

    for target <- ~w(chat_completions responses_api anthropic_messages) do
      assert {:ok, wire} = Projection.project(writer_request, target)
      bytes = Jason.encode!(wire)
      assert length(String.split(bytes, "R05MIXEDREAD73")) == 2
      refute bytes =~ "尾页未读证据"
    end

    # 读叶是durable canonical的既有Scope形状；恢复不能变成伪原生结果或丢失版本。
    record = AgentRunLog.get_run(run_id)
    assert {:ok, restored, :session_segment} = AuthoringCheckpoint.restore(record, nil)
    assert {:ok, restored_request} = AuthoringTranscript.to_request_ir(restored)
    assert [restored_read] = RequestIR.visible_observations(restored_request)
    assert restored_read == read
    assert Repo.get!(MemoryItem, memory.id).version == 7

    assert_receive {:mixed_plan_request, :judgment, _}, 100
    refute_receive {:mixed_plan_request, _, _}, 100
  end

  defp mixed_plan_execution(parent, memory_ref) do
    %Execution{
      result_fn: fn request ->
        names = Enum.map(request.tools, & &1.name)

        cond do
          "judgment_decision" in names ->
            send(parent, {:mixed_plan_request, :judgment, request})

            response(
              "",
              [
                %{
                  id: "inline-plan-call",
                  name: "agent_plan_draft",
                  arguments: %{
                    author_reasoning: "先核对已确认规则，创作产出保持待采纳。",
                    plan: %{
                      steps: [
                        plan_step("context", "context_assemble", "explore", "组装当前作品上下文。"),
                        plan_step("read", "memory_recall", "explore", "读取指定规则。")
                        |> Map.put(
                          :exploration_query,
                          Jason.encode!(%{memory_ref: memory_ref, offset: 0})
                        ),
                        plan_step("write", "world_building", "act", "生成一个世界设定候选。")
                      ]
                    },
                    reason_codes: ["agent_plan_drafted"],
                    confidence: 1.0
                  }
                }
              ],
              "mixed-plan-provider"
            )

          "submit_tentative_artifact" in names ->
            send(parent, {:mixed_plan_request, :writer, request})

            response(
              "",
              [
                %{
                  id: "mixed-writer-call",
                  name: "submit_tentative_artifact",
                  arguments: %{
                    items: [
                      %{
                        item_id: "mixed-world-candidate",
                        title: "候选世界规则",
                        body: "雨季里的钟楼只在涨潮时开放，所有改变都等作者采纳。",
                        rationale: "据实际读取规则拟定，未读取部分不作推断。"
                      }
                    ],
                    self_report: %{
                      assumptions: [],
                      intended_reader_effect: "规则清晰",
                      used_context_refs: [memory_ref],
                      risk_flags: []
                    }
                  }
                }
              ],
              "mixed-writer-provider"
            )

          true ->
            send(parent, {:mixed_plan_request, :unexpected, request})
            {:error, :unexpected_provider_request}
        end
      end
    }
  end

  defp response(text, calls, ref) do
    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: "run-#{ref}",
        provider_call_ref: ref,
        status: :ok,
        output_type: :text,
        content: %{text: text, tool_calls: calls},
        refs: [ref]
      })

    {:ok, %{content: text, tool_calls: calls, provider_output: output}}
  end

  defp plan_step(id, target, kind, description) do
    %{
      step_id: id,
      kind: kind,
      description: description,
      success_criteria: ["step_completed"],
      depends_on: [],
      target_tool_ref: target,
      write_intent: if(kind == "act", do: "tentative", else: "none"),
      risk_hint: "low"
    }
  end
end
