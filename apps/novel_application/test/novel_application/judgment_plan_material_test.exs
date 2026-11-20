defmodule NovelApplication.JudgmentPlanMaterialTest do
  use NovelPersistence.DataCase, async: false

  import NovelApplication.TestAgenticLoopFixtures,
    only: [
      run_until_turn_result: 3,
      scripted_judgment_execution: 1,
      drain_prompt_maps: 1,
      observation_blocks: 1,
      long_prose: 3,
      seed_chapter_with_prose: 1
    ]

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunService
  alias NovelApplication.AuthoringCheckpoint
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.DialoguePlanningService
  alias NovelApplication.WorkService
  alias NovelCommon.Contracts.ProviderOutput
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelDomain.AgentRun
  alias NovelFoundation.Enums.{MemorySourceType, MemoryStatus, MemoryType}
  alias NovelPersistence.AgentRunLog
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.WorkSessionRepo
  alias NovelTest.TestProviderPrompt

  @first_page_anchor "开篇锚点：陈九斤在这个雨夜第一次数错了灯。"
  @long_tail_anchor "长章末页独有锚点：第七枚手印在灯焰里落定。"

  # ── M17：纯只读计划在判断循环内联执行后收束 ─────────────────

  test "M17 只读计划内联执行后回到判断收束，产生最终作者可见结论" do
    {work_id, chapter_ref} =
      seed_chapter_with_prose(long_prose(7000, @first_page_anchor, @long_tail_anchor))

    {:ok, session} = WorkSessionRepo.ensure_active_for_work(work_id)
    provider = planned_reads_then_reply_execution(self(), chapter_ref)

    fetch =
      context_with_pending_candidates(work_id, [
        %{
          artifact_id: "as_m17_a",
          artifact_type: "prose_fragment",
          adoption_status: "TENTATIVE",
          source_turn_ref: "turn-prev-a",
          payload: %{items: [%{item_id: "a1", title: "候选A", body: "冷峻克制的开头。"}]}
        },
        %{
          artifact_id: "as_m17_b",
          artifact_type: "prose_fragment",
          adoption_status: "TENTATIVE",
          source_turn_ref: "turn-prev-b",
          payload: %{items: [%{item_id: "b1", title: "候选B", body: "热闹外放的开头。"}]}
        }
      ])

    {:ok, spec} =
      DialoguePlanningService.plan_agent_run(
        %{
          text: "比较一下两个候选再给我建议。",
          workspace_id: work_id,
          work_id: work_id,
          session_id: session.id,
          turn_id: "turn-m17"
        },
        fetch,
        provider
      )

    {:ok, run} = AgentRun.new(spec.run_attrs)
    {snapshot, result} = run_until_turn_result(spec, run, 16)

    assert result.turn_result.assistant_message.text =~ "两份候选的真实差异"
    assert result.turn_result.assistant_message.text =~ @long_tail_anchor
    # 检查实际执行结果，内联只读计划不切到 judgment_plan profile。
    refute Enum.any?(
             snapshot.step_results,
             &(get_in(&1, [:run_patch, :profile_ref]) == "judgment_plan_v1")
           )

    # 两次计划分别消耗普通读取和真实续读；后续请求只接收已执行的应用材料。
    assert [initial_prompt, continuation_prompt, final_prompt] = drain_prompt_maps([])
    assert RequestIR.visible_observations(initial_prompt) == []
    assert observation_blocks(continuation_prompt) == []
    assert observation_blocks(final_prompt) == []

    first_leaves = RequestIR.visible_observations(continuation_prompt)
    assert Enum.map(first_leaves, & &1.content["tool"]) == ["archive_read", "chapter_read"]
    assert Enum.all?(first_leaves, &(&1.provenance == "application"))
    first_page = List.last(first_leaves)

    continuation_budget =
      get_in(TestProviderPrompt.scope_content(continuation_prompt), [
        "operation",
        "exploration",
        "budget"
      ])

    assert continuation_budget["continuation_only?"] == true

    assert continuation_budget["continuation"] == %{
             "tool" => "chapter_read",
             "chapter_ref" => chapter_ref,
             "next_offset" => 6000,
             "read_end" => 6000,
             "total" => 7000
           }

    continuation_blocks = Enum.flat_map(continuation_prompt.messages, & &1.blocks)
    assert [first_plan_call] = Enum.filter(continuation_blocks, &(&1.type == "tool_call"))
    assert first_plan_call.name == "agent_plan_draft"
    first_plan_call_id = first_plan_call.call_id

    assert [
             %{
               call_id: ^first_plan_call_id,
               status: "passed",
               reason_code: "agent_plan_validated"
             }
           ] =
             Enum.filter(continuation_blocks, &(&1.type == "validation_result"))

    assert [archive_step, chapter_step] = first_plan_call.arguments["plan"]["steps"]
    assert archive_step["target_tool_ref"] == "archive_read"
    assert chapter_step["target_tool_ref"] == "chapter_read"

    assert Jason.decode!(chapter_step["exploration_query"]) == %{
             "chapter_ref" => chapter_ref,
             "offset" => 0
           }

    blocks = Enum.flat_map(final_prompt.messages, & &1.blocks)
    assert [^first_plan_call, second_plan_call] = Enum.filter(blocks, &(&1.type == "tool_call"))
    assert second_plan_call.name == "agent_plan_draft"
    second_plan_call_id = second_plan_call.call_id
    refute second_plan_call_id == first_plan_call_id

    assert [
             %{
               call_id: ^first_plan_call_id,
               status: "passed",
               reason_code: "agent_plan_validated"
             },
             %{
               call_id: ^second_plan_call_id,
               status: "passed",
               reason_code: "agent_plan_validated"
             }
           ] = Enum.filter(blocks, &(&1.type == "validation_result"))

    assert [continuation_step] = second_plan_call.arguments["plan"]["steps"]
    assert continuation_step["target_tool_ref"] == "chapter_read"

    assert Jason.decode!(continuation_step["exploration_query"]) == %{
             "chapter_ref" => first_page.coverage["chapter_ref"],
             "offset" => first_page.next_offset
           }

    scopes =
      for %{type: "scope", content: %{"operation" => %{"role" => "planned_exploration"}} = scope} <-
            blocks,
          do: scope

    leaves = RequestIR.visible_observations(final_prompt)
    assert length(leaves) == 3
    assert Enum.take(leaves, 2) == first_leaves
    assert length(scopes) == 3
    assert Enum.all?(leaves, &(&1.provenance == "application"))
    refute Enum.any?(leaves, &Map.has_key?(&1, :call_id))

    # 材料身份来自同一次实际执行；操作步必须和真实 AgentObservation 的所属运行步一致。
    planned_actors =
      Enum.filter(snapshot.observations, &String.starts_with?(&1.source_ref, "explore:"))

    assert length(planned_actors) == length(leaves)

    assert Enum.map(leaves, & &1.content["observation_ref"]) ==
             Enum.map(planned_actors, &"observation:#{&1.observation_id}")

    assert Enum.map(scopes, & &1["operation"]["observation_ref"]) ==
             Enum.map(planned_actors, & &1.observation_id)

    assert Enum.map(scopes, & &1["operation"]["step_ref"]) ==
             Enum.map(planned_actors, & &1.step_ref)

    assert Enum.map(scopes, & &1["operation"]["plan_call_id"]) ==
             [first_plan_call_id, first_plan_call_id, second_plan_call_id]

    [archive_actor, first_page_actor, last_page_actor] = planned_actors
    assert archive_actor.step_ref == first_page_actor.step_ref
    refute last_page_actor.step_ref == first_page_actor.step_ref

    leaf_refs = Enum.map(leaves, & &1.content["observation_ref"])
    assert length(Enum.uniq(leaf_refs)) == length(leaf_refs)

    # 同章两页各自保留真实范围、原文与版本；叶子自身是版本/范围真源。
    raw_chapters =
      Enum.filter(snapshot.stage_state.judgment_explorations, &(&1.tool == "chapter_read"))

    chapter_leaves = Enum.filter(leaves, &(&1.content["tool"] == "chapter_read"))
    assert length(chapter_leaves) == 2

    raw_ranges =
      Enum.map(raw_chapters, fn observation ->
        Map.new(observation.prose_range, fn {key, value} -> {to_string(key), value} end)
      end)

    assert Enum.map(chapter_leaves, & &1.coverage["prose_range"]) == raw_ranges
    assert Enum.map(chapter_leaves, & &1.versions) == Enum.map(raw_chapters, & &1.versions)
    assert Enum.all?(chapter_leaves, &(map_size(&1.versions) > 0))

    [page1_leaf, page2_leaf] = chapter_leaves
    assert page1_leaf.coverage["prose_range"] == %{"start" => 1, "end" => 6000}
    assert page2_leaf.coverage["prose_range"] == %{"start" => 6001, "end" => 7000}
    assert page1_leaf.next_offset == 6000
    assert page2_leaf.next_offset == nil
    assert page1_leaf.content["summary"] =~ @first_page_anchor
    assert page2_leaf.content["summary"] =~ @long_tail_anchor

    # 已执行计划材料沿既有 Base 来源登记，不冒充原生工具 Observation。
    assert final_prompt.refs.observation_refs == []
    assert Enum.all?(chapter_leaves, &(chapter_ref in &1.source_refs))
    assert chapter_ref in final_prompt.refs.base_refs
  end

  # M17：首计划只读 archive 与章首页；第二计划依据实际 next_offset 续读，最后收束。
  defp planned_reads_then_reply_execution(test_pid, chapter_ref) do
    scripted_judgment_execution(fn prompt ->
      send(test_pid, {:prompt_map, prompt})

      case RequestIR.visible_observations(prompt) do
        [] ->
          {:plan,
           %{
             "plan" => %{
               "steps" => [
                 %{
                   "step_id" => "s1",
                   "kind" => "explore",
                   "description" => "读取两个候选与作品档案。",
                   "success_criteria" => ["candidates_read"],
                   "target_tool_ref" => "archive_read",
                   "exploration_query" => "profile"
                 },
                 %{
                   "step_id" => "s2",
                   "kind" => "explore",
                   "description" => "读取第01章当前正文首页。",
                   "success_criteria" => ["chapter_read"],
                   "target_tool_ref" => "chapter_read",
                   "exploration_query" => Jason.encode!(%{chapter_ref: chapter_ref, offset: 0})
                 }
               ]
             },
             "author_reasoning" => "先读候选与正文首页，再核对是否需要续读。",
             "reason_codes" => ["agent_plan_drafted"],
             "confidence" => 0.9
           }}

        [
          %{content: %{"tool" => "archive_read"}},
          %{content: %{"tool" => "chapter_read"}, next_offset: offset, coverage: coverage}
        ]
        when is_integer(offset) and offset > 0 ->
          {:plan,
           %{
             "plan" => %{
               "steps" => [
                 %{
                   "step_id" => "s3",
                   "kind" => "explore",
                   "description" => "按已读章页给出的下一位置续读。",
                   "success_criteria" => ["chapter_read"],
                   "target_tool_ref" => "chapter_read",
                   "exploration_query" =>
                     Jason.encode!(%{
                       chapter_ref: Map.fetch!(coverage, "chapter_ref"),
                       offset: offset
                     })
                 }
               ]
             },
             "author_reasoning" => "首页之后仍有未读正文，读完同章下一页再给比较建议。",
             "reason_codes" => ["agent_plan_drafted"],
             "confidence" => 0.9
           }}

        [
          %{content: %{"tool" => "archive_read"}},
          %{content: %{"tool" => "chapter_read"}},
          %{content: %{"tool" => "chapter_read"} = content, next_offset: nil}
        ] ->
          assert content["summary"] =~ @long_tail_anchor

          {:narrative,
           "两份候选的真实差异：A 更冷峻克制，B 更热闹外放；建议先说明取舍再修订。\n\n" <>
             @long_tail_anchor}

        observations ->
          flunk("unexpected M17 planned observations: #{inspect(observations)}")
      end
    end)
  end

  defp context_with_pending_candidates(work_id, pending) do
    fetcher = NovelPersistence.WorkspaceContext.context_fetcher_with_query()

    fn ^work_id, author_text, session_id ->
      {:ok, context} = fetcher.(work_id, author_text, session_id)

      {:ok,
       %{
         context
         | interaction_state: %{pending_adoptions: pending, resolved_adoptions: []},
           source_status: Map.put(context.source_status, :interaction, :ok)
       }}
    end
  end

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
