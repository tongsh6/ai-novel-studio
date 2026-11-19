defmodule NovelApplication.ProfessionalWriterRequestTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.TurnExecutionService
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @author_text "  继续当前章节。\r\n"
  @run %{
    run_id: "run-session",
    work_id: "work-session",
    workspace_id: "workspace-session",
    session_id: "session-session",
    parent_turn_ref: "turn-session",
    goal: %{text: "生成本章候选", version: 1}
  }

  defp execution_frame do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-session",
      turn_id: "turn-session",
      workspace_id: "workspace-session",
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{},
      dialogue_goal: %{summary: "重写本章"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "好的"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  defp execution_plan do
    action = %{
      action_id: "act-session",
      action_type: :capability_invocation,
      summary: "正文",
      target_ref: "prose_writing",
      write_intent: :tentative,
      risk_hint: :low,
      authoring_intent: :rewrite,
      requested_chapter_raw: "第99章",
      target_chapter: nil
    }

    %MicroPlan{
      plan_id: "plan-session",
      turn_id: "turn-session",
      frame_ref: "frame-session",
      plan_goal: %{summary: "正文"},
      risk_hint: :low,
      proposed_actions: [action]
    }
  end

  defp execution_decision do
    %OrchestratorDecision{
      decision_id: "decision-session",
      turn_id: "turn-session",
      frame_ref: "frame-session",
      decision_type: :allow_tool,
      decision_status: :decided,
      reason_codes: ["gates_passed", "tool:prose_writing"]
    }
  end

  defp execute_r05_creative(tool, goal, words, opts \\ []) do
    parent = self()

    action =
      execution_plan().proposed_actions
      |> hd()
      |> Map.merge(%{
        target_ref: tool,
        summary: "生成本轮候选",
        authoring_intent: nil,
        requested_chapter_raw: nil,
        target_chapter: "第01章"
      })

    plan = %{execution_plan() | proposed_actions: [action]}

    provider =
      %Execution{
        result_fn: fn prompt ->
          send(parent, {:r05_creative_prompt, tool, prompt})

          {:ok,
           NovelApplication.TestAgenticLoopFixtures.native_artifact_result(
             [
               %{
                 item_id: "r05-creative-item",
                 title: "候选",
                 body: "雨停后，她合上了账本。",
                 rationale: nil
               }
             ],
             provider_call_id: "pc-r05-" <> tool
           )
           |> update_in([:tool_calls, Access.at(0), :arguments], fn arguments ->
             Map.put(arguments, :self_report, %{
               used_context_refs: Keyword.get(opts, :used_refs, [])
             })
           end)}
        end
      }

    {result, _trace, _transcript} =
      TurnExecutionService.execute(
        Map.merge(
          %{
            frame: execution_frame(),
            plan: plan,
            decision: execution_decision(),
            candidates: [],
            context: %DialogueContext{
              work_id: "workspace-session",
              current_chapters: ["第01章"],
              structured_chapters: [
                %{id: "chapter-r05", title: "第01章", seq: 1, summary: nil, has_prose: false}
              ]
            },
            author_input: %{text: words, turn_id: "turn-session", author_goal_text: goal},
            provider_execution: provider
          },
          Keyword.get(opts, :input, %{})
        )
      )

    assert_receive {:r05_creative_prompt, ^tool, prompt}
    {result, prompt}
  end

  describe "TurnExecutionService canonical transcript" do
    test "R05: 专业任务使用已绑定目标，机械动作摘要不覆盖卷级边界" do
      goal = "只生成第一卷蓝图，不新建章节。"
      {result, prompt} = execute_r05_creative("plot_outline", goal, "先讨论卷的目标。")
      assert result.tool_result.status == :succeeded
      task = NovelTest.TestProviderPrompt.scope_content(prompt)["authoring_task"]
      assert task["kind"] == "outline"
      assert task["scope"]["object_kind"] == "outline"
      assert task["author_goal"] == goal
    end

    test "R05: 真实目标等于作者原文时使用受理来源，三 wire 原字节仍只有一份" do
      words = "  只规划第一卷 R05GOALSOURCE91。\r\n\n"

      {result, prompt} =
        execute_r05_creative("plot_outline", words, words,
          input: %{
            author_input: %{
              text: words,
              turn_id: "turn-session",
              author_goal_text: words,
              author_goal_source_ref: "turn-session"
            }
          }
        )

      assert result.tool_result.status == :succeeded
      assert NovelTest.TestProviderPrompt.author_text(prompt) == words
      scope = NovelTest.TestProviderPrompt.scope_content(prompt)

      assert scope["authoring_task"]["author_goal"] == %{
               "source_input_ref" => "turn-session"
             }

      refute Jason.encode!(scope) =~ "R05GOALSOURCE91"

      for wire <- ~w(chat_completions responses_api anthropic_messages) do
        assert {:ok, body} = Projection.project(prompt, wire)
        assert length(String.split(Jason.encode!(body), "R05GOALSOURCE91")) == 2
      end
    end

    test "R05: 当前作者原字节只从 author 消息进入三 wire，无方向时不复制到执行简述" do
      words = "  请保持克制 R05AUTHORONLY91\r\n\n"
      {result, prompt} = execute_r05_creative("prose_writing", "生成第一章首稿候选", words)
      assert result.tool_result.status == :succeeded
      assert NovelTest.TestProviderPrompt.author_text(prompt) == words
      scope = NovelTest.TestProviderPrompt.scope_content(prompt)
      refute Jason.encode!(scope) =~ "R05AUTHORONLY91"

      for wire <- ~w(chat_completions responses_api anthropic_messages) do
        assert {:ok, body} = Projection.project(prompt, wire)
        assert length(String.split(Jason.encode!(body), "R05AUTHORONLY91")) == 2
      end
    end
  end

  test "R05: writer 材料只来自本次可见读叶，partial 与隐藏或仅引用分开" do
    ir = observation_ir()
    assert :ok = RequestIR.validate(ir)

    {result, prompt} =
      execute_r05_creative("prose_writing", "生成本章候选", @author_text,
        input: %{request_ir: ir, agent_run: @run, observations: [raw_observation()]}
      )

    assert result.tool_result.status == :succeeded
    task = NovelTest.TestProviderPrompt.scope_content(prompt)["authoring_task"]
    materials = task["materials"]
    partial = Enum.find(materials, &(&1["ref"] == "chapter:visible-page"))
    assert partial
    assert partial["complete?"] == false
    assert Enum.any?(materials, &(&1["ref"] == "memory:application-read"))

    for excluded <- [
          "chapter:hidden-page",
          "chapter:ref-only",
          "chapter:raw-only",
          "observation:raw-only"
        ] do
      refute Enum.any?(materials, &(&1["ref"] == excluded))
    end

    for wire <- ~w(chat_completions responses_api anthropic_messages) do
      assert {:ok, body} = Projection.project(prompt, wire)
      bytes = Jason.encode!(body)
      assert length(String.split(bytes, "VISIBLEPAGE91")) == 2
      assert length(String.split(bytes, "APPLICATIONPAGE91")) == 2
      refute bytes =~ "HIDDENPAGE91"
      refute bytes =~ "RAWSNAPSHOT91"
    end
  end

  test "R05: writer 自报只按请求中可见来源授信，application 与 native 不混归" do
    claims = [
      "chapter:visible-page",
      "memory:application-read",
      "chapter:hidden-page",
      "chapter:ref-only",
      "chapter:raw-only",
      "lineage:only",
      "turn:turn-session"
    ]

    {result, _prompt} =
      execute_r05_creative("prose_writing", "生成本章候选", @author_text,
        input: %{
          request_ir: observation_ir(),
          agent_run: @run,
          observations: [raw_observation()],
          source_turn_ref: "lineage:only"
        },
        used_refs: claims
      )

    trace = result.trace_summary
    assert "memory:application-read" in trace.request_base_refs
    assert "chapter:visible-page" in trace.request_observation_refs
    refute "chapter:visible-page" in trace.request_base_refs
    refute "memory:application-read" in trace.request_observation_refs

    assert Enum.sort(trace.used_context_refs) == [
             "chapter:visible-page",
             "memory:application-read"
           ]

    assert Enum.sort(trace.unbound_context_refs) ==
             Enum.sort(claims -- ["chapter:visible-page", "memory:application-read"])

    assert trace.used_context_refs_validation == "partial"
  end

  test "R05: 写前使命只绑定本次可见读叶，隐藏和纯引用不成为依据" do
    parent = self()
    {:ok, transcript} = NovelApplication.AuthoringTranscript.from_request_ir(observation_ir())
    inputs = NovelDomain.ChapterMissionInputs.build(%{mode: :planning})

    provider = %Execution{
      result_fn: fn prompt ->
        send(parent, {:r05_visible_mission, prompt})

        {:ok,
         %{
           provider_call_id: "pc-r05-visible-mission",
           content: "只依照本次实际可见的材料安排推进。",
           tool_calls:
             NovelApplication.TestAgenticLoopFixtures.native_tool_calls("planning_mission", %{
               author_reasoning: "只依照本次实际可见的材料安排推进。",
               statement: "沿已读材料推进当前冲突。",
               must_advance: [
                 %{text: "推进当前已读页的冲突", basis_ref: "chapter:visible-page"},
                 %{text: "保留真实读取的设定", basis_ref: "memory:application-read"},
                 %{text: "隐藏原页不得作为依据", basis_ref: "chapter:hidden-page"},
                 %{text: "纯索引不得作为正文依据", basis_ref: "chapter:ref-only"}
               ],
               must_avoid: [],
               confidence: 0.9
             })
         }}
      end
    }

    assert {:ok, mission, meta} =
             NovelApplication.ChapterMissionService.derive(inputs, provider,
               kind: :planning,
               run: @run,
               snapshot: %{stage_state: %{judgment_transcript: transcript}},
               author_text: @author_text,
               source_input_ref: "turn-session"
             )

    assert Enum.map(mission.must_advance, & &1["basis_ref"]) ==
             ["chapter:visible-page", "memory:application-read"]

    assert length(mission.dropped) == 2
    assert meta.provider_call_count == 1
    assert_receive {:r05_visible_mission, prompt}
    scope = NovelTest.TestProviderPrompt.scope_content(prompt)
    assert get_in(scope, ["operation", "mission_inputs", "items"]) == []

    for wire <- ~w(chat_completions responses_api anthropic_messages) do
      assert {:ok, body} = Projection.project(prompt, wire)
      bytes = Jason.encode!(body)
      assert length(String.split(bytes, "VISIBLEPAGE91")) == 2
      assert length(String.split(bytes, "APPLICATIONPAGE91")) == 2
      refute bytes =~ "HIDDENPAGE91"
    end
  end

  defp observation_ir do
    hidden = %{
      status: "ok",
      source_refs: [%{ref: "chapter:hidden-page"}],
      content: %{summary: "HIDDENPAGE91", tool: "chapter_read", facts: %{}}
    }

    visible = %{
      status: "partial",
      source_refs: [%{ref: "chapter:visible-page"}],
      coverage: %{complete?: false},
      omissions: ["只读取本页"],
      next_offset: 80,
      content: %{summary: "VISIBLEPAGE91", tool: "chapter_read", facts: %{}}
    }

    ref_only = %{
      status: "ok",
      source_refs: [%{ref: "chapter:ref-only"}],
      content: %{tool: "chapter_read", query: "仅索引", facts: %{}}
    }

    application = %{
      status: "ok",
      source_refs: [%{ref: "memory:application-read"}],
      coverage: %{complete?: true},
      content: %{summary: "APPLICATIONPAGE91", tool: "memory_recall", facts: %{}}
    }

    messages =
      [
        RequestIR.message(:application_base, :application, [RequestIR.text_block("应用材料按真实来源供应。")]),
        author_message("prior-run", 1, "turn-prior", "之前读取过一页。", "completed")
      ] ++
        read_messages("prior-run", 2, "call-hidden", hidden, "completed") ++
        [author_message("run-session", 1, "turn-session", @author_text, "running")] ++
        read_messages("run-session", 2, "call-visible", visible, "running") ++
        read_messages("run-session", 4, "call-ref-only", ref_only, "running") ++
        [
          RequestIR.message(
            :scope_update,
            :application,
            [
              RequestIR.scope_block(%{
                work_id: @run.work_id,
                operation: %{
                  role: "planned_exploration",
                  plan_ref: "plan-session",
                  plan_version: 1,
                  step_ref: "read-application",
                  observation_ref: "application-read"
                },
                facts: %{exploration_result: application}
              })
            ],
            %{
              source_refs: application.source_refs,
              versions: %{"scope_revision" => 1},
              canonical_ref: coordinate("run-session", 6, "running")
            }
          ),
          RequestIR.message(
            :checkpoint,
            :application,
            [
              RequestIR.checkpoint_block(
                %{call_ids: ["call-hidden"], message_refs: []},
                [%{ref: "chapter:hidden-page"}],
                %{},
                ["旧页已压缩，原文可回查。"],
                "旧读取摘要"
              )
            ],
            %{canonical_ref: coordinate("run-session", 7, "running")}
          )
        ]

    RequestIR.new(%{
      run: RequestIR.run_envelope(@run),
      system: RequestIR.system_envelope(instructions: "按当前作者目标生成候选。"),
      messages: messages,
      tools: [],
      refs: %{
        base_refs: [%{ref: "memory:application-read"}, %{ref: "lineage:only"}],
        observation_refs: [
          %{ref: "chapter:hidden-page"},
          %{ref: "chapter:visible-page"},
          %{ref: "chapter:ref-only"}
        ],
        used_refs: []
      }
    })
  end

  defp author_message(run_id, sequence, turn, text, status) do
    RequestIR.message(:user, :author, [RequestIR.text_block(text)], %{
      source_refs: [%{ref: turn}],
      canonical_ref: coordinate(run_id, sequence, status)
    })
  end

  defp read_messages(run_id, sequence, call_id, payload, status) do
    [
      RequestIR.message(
        :assistant,
        :model,
        [RequestIR.tool_call_block("chapter_read", %{}, call_id)],
        %{canonical_ref: coordinate(run_id, sequence, status)}
      ),
      RequestIR.message(:tool, :tool_result, [RequestIR.observation_block(call_id, payload)], %{
        canonical_ref: coordinate(run_id, sequence + 1, status)
      })
    ]
  end

  defp coordinate(run_id, sequence, status) do
    %{
      run_id: run_id,
      run_sequence: sequence,
      run_status: status,
      work_id: @run.work_id,
      workspace_id: @run.workspace_id,
      session_id: @run.session_id,
      parent_turn_ref: if(run_id == "run-session", do: "turn-session", else: "turn-prior")
    }
  end

  defp raw_observation do
    %NovelDomain.AgentObservation{
      observation_id: "raw-only",
      run_ref: @run.run_id,
      step_ref: "step-raw-only",
      observation_type: :tool_fact,
      source_ref: "step-raw-only",
      summary: "RAWSNAPSHOT91",
      structured_payload: %{source_refs: ["chapter:raw-only"]}
    }
  end
end
