defmodule NovelApplication.AgentRunJudgmentPlanFlowTest do
  @moduledoc """
  CP4（ADR-0025 决策 2 计划按需）：跨能力真计划执行 flow 的 focused runtime 证明。

  计划由模型基于能力目录制定（plan_drafted 照发——真计划）；机械 cursor 逐步、
  每步过 Orchestrator gate；多产物逐个进待采纳区；完成收束停 S1/S2。
  外部页面级验收由场景 `judgment-plan-multi-step` 驱动。
  """
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution
  alias NovelAgent.Test.Provider.SliceVerify
  alias NovelApplication.AgentRunService
  alias NovelApplication.DialoguePlanningService
  alias NovelCommon.Contracts.ProviderOutput
  alias NovelPersistence.Repo

  test "旧任务的计划耗尽标记不能改写当前问题回复的单产物目标" do
    previous = System.get_env("SLICE_VERIFY_PLAN_EXHAUST")
    System.put_env("SLICE_VERIFY_PLAN_EXHAUST", "1")

    on_exit(fn ->
      if previous,
        do: System.put_env("SLICE_VERIFY_PLAN_EXHAUST", previous),
        else: System.delete_env("SLICE_VERIFY_PLAN_EXHAUST")
    end)

    prompt = """
    本次你承担创作判断器的角色。
    ## 会话摘要
    另一个任务仍在等待：先核对正文再调整大纲，UA01PLANEXHAUST-older-run。
    ## 作者输入
    确认第一卷；当前还没有章节，请先为第一卷生成12章的待采纳章节计划，供后续结构维护使用，暂不采纳。
    """

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %{})
    assert [%{"name" => "judgment_decision", "arguments" => args}] = result.tool_calls
    assert args["action"] == "execute"
    assert args["capability"] == "plot_outline"

    assert {:ok, own} =
             SliceVerify.complete(nil, nil, prompt <> "UA01PLANEXHAUST-current-run", %{})

    assert [%{"arguments" => own_args}] = own.tool_calls
    assert own_args["action"] == "plan"
  end

  test "B31 原生前提原话穿过判断守卫进入计划耗尽等待，而非角色身份纠错" do
    :ok = Sandbox.checkout(Repo)
    :ok = Sandbox.mode(Repo, {:shared, self()})
    previous = System.get_env("SLICE_VERIFY_PLAN_EXHAUST")
    System.put_env("SLICE_VERIFY_PLAN_EXHAUST", "1")

    on_exit(fn ->
      if previous,
        do: System.put_env("SLICE_VERIFY_PLAN_EXHAUST", previous),
        else: System.delete_env("SLICE_VERIFY_PLAN_EXHAUST")
    end)

    parent = self()
    suffix = System.unique_integer([:positive])
    work_id = Ecto.UUID.generate()

    execution = %Execution{
      result_fn: fn prompt ->
        ref = "b31-plan-call-#{System.unique_integer([:positive])}"
        assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %{})

        output = %ProviderOutput{
          provider_run_ref: ref,
          provider_call_ref: ref,
          status: :ok,
          content: %{text: result.content, tool_calls: result.tool_calls}
        }

        {:ok, result |> Map.from_struct() |> Map.put(:provider_output, output)}
      end
    }

    assert {:ok, spec} =
             DialoguePlanningService.plan_agent_run(
               %{
                 text: "先读完第01章正文，再调整章节大纲，最后更新主角当前状态，UA01PLANEXHAUST-T3-1f6aa2bb",
                 workspace_id: work_id,
                 work_id: work_id,
                 session_id: "session-b31-plan-#{suffix}",
                 turn_id: "turn-b31-plan-#{suffix}",
                 chapter_prose_reader: fn _, _ -> "" end,
                 chapter_summary_reader: %{},
                 character_reader: fn _ -> [] end
               },
               nil,
               execution
             )

    assert {:ok, run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               next_step_planner: spec.next_step_planner,
               event_sink: fn event ->
                 send(parent, {:b31_plan_event, event.event_type, event})
               end
             )

    on_exit(fn -> AgentRunService.cancel(run_id) end)
    assert_receive {:b31_plan_event, :plan_drafted, _}, 2_000
    assert_receive {:b31_plan_event, :awaiting_author, awaiting}, 3_000
    assert "plan_exhausted_without_completion" in awaiting.reason_codes
    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.profile_ref == "judgment_plan_v1"
    assert state.run.status == :awaiting_author
    assert state.run.goal.version == 1
    assert state.run.pending_artifact_refs == []
    refute_receive {:b31_plan_event, :run_failed, _}
  end

  for {mode, draft_count, revision_count, total} <- [
        {"同批计划", 0, 0, 3},
        {"另行起草计划", 1, 0, 4},
        {"先核对再补齐计划", 1, 1, 5}
      ] do
    test "#{mode} 从真实判断入口进入同一计划运行，按实际调用计数并保留待采纳边界" do
      parent = self()
      suffix = System.unique_integer([:positive])

      execution = %Execution{
        result_fn: fn prompt ->
          names =
            if is_map(prompt),
              do: Enum.map(Map.get(prompt, :tools, []), &Map.get(&1, :name)),
              else: []

          ref = "plan-call-#{System.unique_integer([:positive])}"
          send(parent, {:plan_request, names, ref})
          {:ok, result} = SliceVerify.complete(nil, nil, prompt, %{})

          output = %ProviderOutput{
            provider_run_ref: ref,
            provider_call_ref: ref,
            status: :ok,
            content: %{text: result.content, tool_calls: result.tool_calls}
          }

          {:ok, result |> Map.from_struct() |> Map.put(:provider_output, output)}
        end
      }

      assert {:ok, spec} =
               DialoguePlanningService.plan_agent_run(
                 %{
                   text: "请按#{unquote(mode)}设计一个角色，再设计相关世界设定。",
                   workspace_id: "ws-plan-#{suffix}",
                   work_id: "work-plan-#{suffix}",
                   session_id: "session-plan-#{suffix}",
                   turn_id: "turn-plan-#{suffix}",
                   chapter_prose_reader: fn _, _ -> "" end,
                   chapter_summary_reader: %{},
                   character_reader: fn _ -> [] end
                 },
                 nil,
                 execution
               )

      assert {:ok, run_id} =
               AgentRunService.start_bounded(spec.run_attrs,
                 next_step_planner: spec.next_step_planner,
                 event_sink: fn event -> send(parent, {:plan_event, event.event_type, event}) end
               )

      on_exit(fn -> AgentRunService.cancel(run_id) end)
      # 2s 在本机并行批次高负载下两次被证伪为时序 flake（事件链已推进，仅超时）；
      # 放宽到 5s 保留同一语义断言（仍要求事件到达），不放宽业务流程断言。
      assert_receive {:plan_event, :plan_drafted, event}, 5_000
      assert_receive {:plan_event, :run_completed, _}, 3_000
      assert {:ok, state} = AgentRunService.state(run_id)
      assert state.run.profile_ref == "judgment_plan_v1"
      assert state.run.status == :completed
      assert length(state.run.pending_artifact_refs) >= 2
      assert state.run.consumed_budget.tool_calls == 2
      assert state.run.consumed_budget.provider_calls == unquote(total)
      assert state.run.consumed_budget.replans == unquote(revision_count)

      requests =
        Enum.map(1..unquote(total), fn _ ->
          assert_receive {:plan_request, names, ref}, 100
          {names, ref}
        end)

      assert Enum.count(requests, fn {names, _} -> names == ["agent_plan_draft"] end) ==
               unquote(draft_count)

      assert Enum.count(requests, fn {names, _} -> names == ["agent_plan_revision"] end) ==
               unquote(revision_count)

      assert event.payload.plan_steps != []

      if unquote(draft_count) == 0 do
        {_, judgment_ref} = hd(requests)
        assert event.payload.author_narrative_source.provider_call_ref == judgment_ref
      end

      refute_receive {:plan_request, _, _}, 30
    end
  end

  test "judgment plan run drafts a model plan and executes capability steps into pending artifacts" do
    parent = self()

    result_fn = fn prompt ->
      text = prompt_text(prompt)

      if plan_draft_prompt?(text) do
        send(parent, :plan_draft_called)

        {:ok,
         %{
           content: "先读取上下文，再完成大纲与正文两步产出。",
           provider_call_id: "pc-jp-plan",
           tool_calls: [
             %{
               "name" => "agent_plan_draft",
               "arguments" => %{
                 "author_reasoning" => "按本轮目标推进计划，所有创作产出均待作者采纳。",
                 "plan" => %{
                   "steps" => [
                     plan_step("s1", "context_assemble", "explore", "读取当前作品上下文。"),
                     plan_step("s2", "plot_outline", "act", "调整章节大纲。"),
                     plan_step("s3", "prose_writing", "act", "重写目标章节正文。")
                   ]
                 },
                 "reason_codes" => ["agent_plan_drafted", "judgment_plan_drafted"],
                 "confidence" => 1.0
               }
             }
           ]
         }}
      else
        send(parent, {:tool_prompt, text})

        {:ok,
         %{
           provider_call_id: "pc-jp-tool",
           content:
             Jason.encode!(%{
               items: [
                 %{
                   item_id: "jp-item-#{System.unique_integer([:positive])}",
                   title: "计划步骤产出",
                   body: "按计划步骤生成的候选内容。",
                   rationale: "多步计划产出。"
                 }
               ]
             })
         }}
      end
    end

    spec =
      DialoguePlanningService.run_spec_for_profile(
        :judgment_plan,
        %{
          text: "把前两章的伏笔梳理一遍，按结果调整大纲并重写第02章结尾。",
          workspace_id: "ws-jp",
          work_id: "work-jp",
          session_id: "session-jp",
          turn_id: "turn-jp",
          chapter_prose_reader: fn _work_id, _chapter -> "" end,
          chapter_summary_reader: %{},
          character_reader: fn _work_id -> [] end
        },
        nil,
        %Execution{result_fn: result_fn}
      )

    assert spec.run_attrs.profile_ref == "judgment_plan_v1"

    assert {:ok, run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               next_step_planner: spec.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive :plan_draft_called, 500

    # 真计划：plan_drafted 照发（模型自产步序，非 app 预制轨道）。
    assert_receive {:agent_event, :plan_drafted, plan_event}, 500

    assert [
             %{target_tool_ref: "context_assemble"},
             %{target_tool_ref: "plot_outline"},
             %{target_tool_ref: "prose_writing"}
           ] = plan_event.payload.plan_steps

    assert_receive {:agent_event, :run_completed, _}, 3_000

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :completed
    # 多产物：两个 act 步各产一个待采纳候选。
    assert length(state.run.pending_artifact_refs) == 2
    assert state.run.consumed_budget.steps == 3
    assert state.run.consumed_budget.tool_calls == 2

    # 单调用起草 1 + 两个 act 步各 1 = 3（runtime 直连，无判断①入场）。
    assert state.run.consumed_budget.provider_calls == 3
  end

  test "judgment plan executes an in-plan retrieval step inline with zero provider calls (CP5b)" do
    parent = self()

    result_fn = fn prompt ->
      text = prompt_text(prompt)

      if plan_draft_prompt?(text) do
        {:ok,
         %{
           content: "先看作品统计，再补写正文。",
           provider_call_id: "pc-jp-explore-plan",
           tool_calls: [
             %{
               "name" => "agent_plan_draft",
               "arguments" => %{
                 "author_reasoning" => "按本轮目标推进计划，所有创作产出均待作者采纳。",
                 "plan" => %{
                   "steps" => [
                     plan_step("s1", "context_assemble", "explore", "读取当前作品上下文。"),
                     %{
                       "step_id" => "s2",
                       "kind" => "explore",
                       "description" => "读取作品统计确认现状。",
                       "success_criteria" => ["统计观察"],
                       "target_tool_ref" => "archive_read",
                       "exploration_query" => "stats"
                     },
                     plan_step("s3", "prose_writing", "act", "补写目标章节正文。")
                   ]
                 },
                 "reason_codes" => ["agent_plan_drafted", "judgment_plan_drafted"],
                 "confidence" => 1.0
               }
             }
           ]
         }}
      else
        {:ok,
         %{
           provider_call_id: "pc-jp-explore-tool",
           content:
             Jason.encode!(%{
               items: [
                 %{
                   item_id: "jp-explore-item-#{System.unique_integer([:positive])}",
                   title: "计划步骤产出",
                   body: "按计划步骤生成的候选内容。",
                   rationale: "检索步之后的产出。"
                 }
               ]
             })
         }}
      end
    end

    spec =
      DialoguePlanningService.run_spec_for_profile(
        :judgment_plan,
        %{
          text: "先确认写作现状，然后补写第02章结尾。",
          workspace_id: "ws-jp-explore",
          work_id: "work-jp-explore",
          session_id: "session-jp-explore",
          turn_id: "turn-jp-explore",
          chapter_prose_reader: fn _work_id, _chapter -> "" end,
          chapter_summary_reader: %{},
          character_reader: fn _work_id -> [] end
        },
        nil,
        %Execution{result_fn: result_fn}
      )

    assert {:ok, run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               next_step_planner: spec.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    # 计划带检索步（模型自产，exploration_query 随步）
    assert_receive {:agent_event, :plan_drafted, plan_event}, 500

    assert [
             %{target_tool_ref: "context_assemble"},
             %{target_tool_ref: "archive_read"},
             %{target_tool_ref: "prose_writing"}
           ] = plan_event.payload.plan_steps

    # 检索步内联执行：author 侧 exploration_observed 阶段事件带 tool/query/观察摘要
    # （stats 面确定性可读，非法 work_id 由档案层按空作品兜底——观察仍是诚实渲染）。
    # 注：runtime 另有 developer 侧同名观察事实回显（agent_observation_fact），按载荷区分。
    explore_event = await_exploration_stage_event()
    assert explore_event.payload.tool == "archive_read"
    assert explore_event.payload.query == "stats"
    assert explore_event.payload.summary =~ "总字数"

    # B28 T4 R10：计划内检索步同样携带结构化观察分类（no_progress 澄清派生同源）
    assert explore_event.payload.outcome == "observed"
    assert is_map(explore_event.payload.facts)

    assert_receive {:agent_event, :run_completed, _}, 3_000

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :completed
    assert length(state.run.pending_artifact_refs) == 1

    # 3 步（context + 检索 + act）；工具 1（仅 act）；调用 = 单调用起草 1 + act 1 = 2
    # ——检索步 0 提供者调用、不经 Toolbox。
    assert state.run.consumed_budget.steps == 3
    assert state.run.consumed_budget.tool_calls == 1
    assert state.run.consumed_budget.provider_calls == 2
  end

  test "judgment plan revises its own plan when exhausted before the goal is met" do
    parent = self()

    result_fn = fn prompt ->
      text = prompt_text(prompt)

      cond do
        revision_prompt?(text) ->
          send(parent, :plan_revision_called)

          {:ok,
           %{
             content: "计划走完但正文还没产出，我补上正文步继续完成。",
             provider_call_id: "pc-jp-revise",
             tool_calls: [
               %{
                 "name" => "agent_plan_revision",
                 "arguments" => %{
                   "author_reasoning" => "按本轮目标推进计划，所有创作产出均待作者采纳。",
                   "plan" => %{
                     "steps" => [
                       plan_step("s1", "context_assemble", "explore", "读取当前作品上下文。"),
                       plan_step("s2", "prose_writing", "act", "补写目标章节正文。")
                     ]
                   },
                   "reason_codes" => ["agent_plan_revised"],
                   "confidence" => 1.0
                 }
               }
             ]
           }}

        plan_draft_prompt?(text) ->
          # CP4b 诱导：起草短计划（只读上下文，漏产出步）。
          {:ok,
           %{
             content: "先读取上下文再看下一步。",
             provider_call_id: "pc-jp-short-plan",
             tool_calls: [
               %{
                 "name" => "agent_plan_draft",
                 "arguments" => %{
                   "author_reasoning" => "按本轮目标推进计划，所有创作产出均待作者采纳。",
                   "plan" => %{
                     "steps" => [
                       plan_step("s1", "context_assemble", "explore", "读取当前作品上下文。")
                     ]
                   },
                   "reason_codes" => ["agent_plan_drafted"],
                   "confidence" => 1.0
                 }
               }
             ]
           }}

        true ->
          {:ok,
           %{
             provider_call_id: "pc-jp-tool2",
             content:
               Jason.encode!(%{
                 items: [
                   %{
                     item_id: "jp-rev-item-#{System.unique_integer([:positive])}",
                     title: "修订后计划产出",
                     body: "按修订后计划生成的正文候选。",
                     rationale: "真计划修订闭环。"
                   }
                 ]
               })
           }}
      end
    end

    spec =
      DialoguePlanningService.run_spec_for_profile(
        :judgment_plan,
        %{
          text: "把伏笔梳理后重写第02章结尾。",
          workspace_id: "ws-jp2",
          work_id: "work-jp2",
          session_id: "session-jp2",
          turn_id: "turn-jp2",
          chapter_prose_reader: fn _work_id, _chapter -> "" end,
          chapter_summary_reader: %{},
          character_reader: fn _work_id -> [] end
        },
        nil,
        %Execution{result_fn: result_fn}
      )

    assert {:ok, run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               next_step_planner: spec.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:agent_event, :plan_drafted, _}, 500
    assert_receive :plan_revision_called, 2_000

    # 真计划修订：plan_revised 照发（模型修订自己的计划——D 系真计划形态）。
    assert_receive {:agent_event, :plan_revised, revised_event}, 500

    assert Enum.any?(
             revised_event.payload.plan_steps,
             &(&1.target_tool_ref == "prose_writing")
           )

    assert_receive {:agent_event, :run_completed, _}, 3_000

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :completed
    assert state.run.consumed_budget.replans == 1
    assert length(state.run.pending_artifact_refs) == 1
  end

  test "plan exhaustion surfaces structural author reasons without provider raw payload (B23 CP3)" do
    parent = self()
    raw_sentinel = "RAW-JP-CP3-#{System.unique_integer([:positive])}"

    result_fn = fn prompt ->
      text = prompt_text(prompt)

      cond do
        revision_prompt?(text) ->
          send(parent, :plan_revision_called)

          {:ok,
           %{
             content: "修订后仍需核对上下文，#{raw_sentinel}-revision。",
             provider_call_id: "pc-b23-cp3-revise",
             tool_calls: [
               %{
                 "name" => "agent_plan_revision",
                 "arguments" => %{
                   "author_reasoning" => "按本轮目标推进计划，所有创作产出均待作者采纳。",
                   "plan" => %{
                     "steps" => [
                       plan_step("r1", "context_assemble", "explore", "复核目标章节上下文。")
                     ]
                   },
                   "reason_codes" => ["agent_plan_revised"],
                   "confidence" => 1.0
                 }
               }
             ]
           }}

        plan_draft_prompt?(text) ->
          {:ok,
           %{
             content: "先只读核对，必要时再修订计划，#{raw_sentinel}-draft。",
             provider_call_id: "pc-b23-cp3-plan",
             tool_calls: [
               %{
                 "name" => "agent_plan_draft",
                 "arguments" => %{
                   "author_reasoning" => "按本轮目标推进计划，所有创作产出均待作者采纳。",
                   "plan" => %{
                     "steps" => [
                       plan_step("s1", "context_assemble", "explore", "读取当前作品上下文。"),
                       plan_step("s2", "context_assemble", "explore", "复核目标章节上下文。")
                     ]
                   },
                   "reason_codes" => ["agent_plan_drafted", "judgment_plan_drafted"],
                   "confidence" => 1.0
                 }
               }
             ]
           }}

        true ->
          flunk("unexpected provider call in plan-exhausted CP3 fixture: #{text}")
      end
    end

    spec =
      DialoguePlanningService.run_spec_for_profile(
        :judgment_plan,
        %{
          text: "先梳理前两章伏笔再重写第02章结尾，但这次只做只读核对。",
          workspace_id: "ws-jp-cp3",
          work_id: "work-jp-cp3",
          session_id: "session-jp-cp3",
          turn_id: "turn-jp-cp3",
          chapter_prose_reader: fn _work_id, _chapter -> "" end,
          chapter_summary_reader: %{},
          character_reader: fn _work_id -> [] end
        },
        nil,
        %Execution{result_fn: result_fn}
      )

    assert {:ok, run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               next_step_planner: spec.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:agent_event, :plan_drafted, _}, 500
    assert_receive :plan_revision_called, 2_000
    assert_receive {:agent_event, :awaiting_author, awaiting}, 2_000

    assert "plan_exhausted_without_completion" in awaiting.reason_codes

    summary = awaiting.summary
    # 五个骨架事实（外部 driver 按同一字面断言页面可见文本）。
    assert summary =~ "计划共 2 步，已完成 2 步"
    assert summary =~ "目标产出尚未完成"
    assert summary =~ "已核对："
    assert summary =~ "下一步："
    # 已核对步骤用模型 plan description 原话（限量），不是机械句。
    assert summary =~ "读取当前作品上下文"
    assert summary =~ "复核目标章节上下文"
    # 缺口：计划里没有产出步。
    assert summary =~ "计划中没有产出步"

    # 零 provider 原文：只有 app 结构词 + plan description；不含模型正文/占位载荷。
    refute summary =~ raw_sentinel
    refute summary =~ "assistant_message"
    refute summary =~ "raw_prompt"
    refute summary =~ "{"

    assert {:ok, %{run: run}} = AgentRunService.state(run_id)
    assert run.status == :awaiting_author
  end

  defp await_exploration_stage_event do
    receive do
      {:agent_event, :exploration_observed, %{payload: %{tool: _}} = event} -> event
      {:agent_event, _type, _event} -> await_exploration_stage_event()
    after
      3_000 -> flunk("no exploration stage event with tool payload received")
    end
  end

  defp plan_step(id, target, kind, description) do
    step = %{
      "step_id" => id,
      "kind" => kind,
      "description" => description,
      "success_criteria" => ["step_completed"],
      "depends_on" => [],
      "target_tool_ref" => target,
      "write_intent" => if(kind == "act", do: "tentative", else: "none"),
      "risk_hint" => "low"
    }

    # D7（2026-08-26）：prose_writing 步必须显式携带 authoring_intent 键（值可为
    # null=写新章）——省略即结构不合法。本 fixture 的写作步语义是「重写/补写目标章」，
    # 按 describe 中的措辞取 rewrite；键存在性才是契约要求的重点。
    if target == "prose_writing",
      do: Map.put(step, "authoring_intent", "rewrite"),
      else: step
  end

  defp plan_draft_prompt?(text), do: String.contains?(text, "agent_plan_draft")

  defp revision_prompt?(text), do: String.contains?(text, "计划修订器")

  defp prompt_text(prompt), do: NovelApplication.TestAgenticLoopFixtures.prompt_text(prompt)
end
