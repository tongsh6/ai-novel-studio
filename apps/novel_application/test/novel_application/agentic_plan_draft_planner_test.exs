defmodule NovelApplication.AgenticPlanDraftPlannerTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Test.Provider.SliceVerify
  alias NovelCommon.RequestIR

  alias NovelApplication.{
    AgenticPlanDraftPlanner,
    AgentPlanToolContract,
    AuthoringTranscript,
    JudgmentToolContract
  }

  alias NovelCommon.Contracts.ProviderOutput
  alias NovelDomain.AgentRun

  @narrative "作者要求接着第01章继续写，先读取正文上下文，再生成续写草稿并质量复核。"

  defp probe_run do
    {:ok, run} =
      AgentRun.new(%{
        run_id: "run_plan_draft_test",
        workspace_id: "ws_plan_draft",
        work_id: "work_plan_draft",
        session_id: "session_plan_draft",
        parent_turn_ref: "turn_plan_draft",
        origin_frame_ref: "frame_plan_draft",
        profile_ref: "prose_drafting_with_quality_v1",
        goal: %{text: "接着第01章往下写一段正文", version: 1},
        authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]}
      })

    run
  end

  defp plan_arguments do
    %{
      "author_reasoning" => @narrative,
      "plan" => %{
        "steps" => [
          %{
            "step_id" => "s1",
            "kind" => "explore",
            "description" => "读取正文写作上下文",
            "success_criteria" => ["上下文观察"],
            "target_tool_ref" => "context_assemble"
          },
          %{
            "step_id" => "s2",
            "kind" => "act",
            "description" => "生成续写草稿并质量复核",
            "success_criteria" => ["待采纳 prose_fragment"],
            "target_tool_ref" => "prose_writing",
            "write_intent" => "tentative",
            "authoring_intent" => "continuation",
            "target_chapter" => "第01章：开端",
            "requested_chapter_raw" => "第01章"
          }
        ]
      },
      "reason_codes" => ["agent_plan_drafted"],
      "confidence" => 0.9
    }
  end

  defp provider_result(content), do: provider_result_with_arguments(content, plan_arguments())

  defp provider_result_with_arguments(content, arguments, tool_name \\ "agent_plan_draft") do
    tool_calls = [%{"name" => tool_name, "arguments" => arguments}]

    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: "prun_plan_draft",
        provider_call_ref: "pcall_plan_draft",
        status: :ok,
        output_type: :text,
        content: %{text: content, tool_calls: tool_calls},
        refs: ["pcall_plan_draft"]
      })

    %{content: content, tool_calls: tool_calls, provider_output: output}
  end

  @tag :b71_canonical
  test "B71 独立起草纠错与计划修订沿同一 canonical 历史，作者原话保持独立" do
    run = probe_run()
    prior = prior_transcript(run)
    broken = Map.put(plan_arguments(), "plan", "not-an-object")

    responses = [
      {:ok, provider_result_with_arguments("需要纠正计划结构。", broken)},
      {:ok, provider_result(@narrative)},
      {:ok,
       provider_result_with_arguments("保留已有步骤，更新计划。", plan_arguments(), "agent_plan_revision")}
    ]

    execution = sequence_execution(responses)

    assert {:ok, plan, draft_meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(run, execution, snapshot(prior))

    assert draft_meta.provider_call_count == 2
    draft = draft_meta.judgment_transcript
    assert Enum.take(draft.messages, length(prior.messages)) == prior.messages

    assert Enum.filter(draft.messages, &(&1.role == "user")) ==
             Enum.filter(prior.messages, &(&1.role == "user"))

    assert validation_statuses(draft) == ["failed", "passed"]
    assert {:ok, draft_ir} = AuthoringTranscript.to_request_ir(draft)
    assert {:ok, _} = RequestIR.prepare_request(draft_ir)

    assert_received {:canonical_plan_prompt, first}
    assert_received {:canonical_plan_prompt, corrected}
    assert first.ir_version == RequestIR.ir_version()
    assert Enum.take(corrected.messages, length(first.messages)) == first.messages

    assert Enum.any?(corrected.messages, fn message ->
             Enum.any?(
               message.blocks,
               &(&1.type == "validation_result" and &1.status == "failed")
             )
           end)

    revision_run = %{run | plan: plan, plan_ref: plan.plan_id, plan_version: plan.version}

    assert {:ok, revised, revision_meta} =
             AgenticPlanDraftPlanner.revise_plan_with_meta(
               revision_run,
               execution,
               snapshot(draft),
               revision_reason: "已有候选尚未满足目标，需要继续推进。"
             )

    assert revised.version == plan.version + 1
    assert revision_meta.provider_call_count == 1
    transcript = revision_meta.judgment_transcript
    assert Enum.take(transcript.messages, length(draft.messages)) == draft.messages
    assert validation_statuses(transcript) == ["failed", "passed", "passed"]

    assert tool_names(transcript) == [
             "read_character",
             "agent_plan_draft",
             "agent_plan_draft",
             "agent_plan_revision"
           ]

    assert Enum.count(transcript.messages, &(&1.role == "user")) == 1
    assert Process.get(:canonical_plan_responses) == []
  end

  @tag :b71_canonical
  test "B71 末次规划校验失败仍返回两次真实调用与闭合的失败历史" do
    run = probe_run()
    prior = prior_transcript(run)
    broken = Map.put(plan_arguments(), "plan", "not-an-object")

    execution =
      sequence_execution(
        List.duplicate({:ok, provider_result_with_arguments("结构仍不合法。", broken)}, 2)
      )

    assert {:error, {:agent_plan_protocol_violation, :invalid_plan_tool_arguments}, meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(run, execution, snapshot(prior))

    assert meta.provider_call_count == 2
    assert validation_statuses(meta.judgment_transcript) == ["failed", "failed"]
    assert Enum.take(meta.judgment_transcript.messages, length(prior.messages)) == prior.messages
    assert {:ok, ir} = AuthoringTranscript.to_request_ir(meta.judgment_transcript)
    assert {:ok, _} = RequestIR.prepare_request(ir)
    assert Process.get(:canonical_plan_responses) == []
  end

  @tag :b71_canonical
  test "B71 transport 两次失败也返回准确开销与可恢复会话，不伪造模型回复" do
    prior = prior_transcript(probe_run())
    execution = sequence_execution(List.duplicate({:error, %{type: :timeout}}, 2))

    assert {:error, %{type: :timeout}, meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), execution, snapshot(prior))

    assert meta.provider_call_count == 2
    assert tool_names(meta.judgment_transcript) == ["read_character"]
    assert Enum.take(meta.judgment_transcript.messages, length(prior.messages)) == prior.messages
    assert Process.get(:canonical_plan_responses) == []
  end

  defp prior_transcript(run) do
    AuthoringTranscript.new(Map.take(run, [:run_id, :work_id, :workspace_id, :session_id]),
      base_text: "同一运行内保留真实证据与作者授权。",
      author_text: "  请先核对人物，再续写第01章。\n",
      author_turn_ref: run.parent_turn_ref,
      tools: [%{name: "read_character", input_schema: %{type: "object"}}]
    )
    |> AuthoringTranscript.append_assistant("先核对人物。", [
      RequestIR.tool_call_block("read_character", %{}, "prior-read")
    ])
    |> AuthoringTranscript.append_observation("prior-read", %{
      status: "ok",
      source_refs: [%{ref: "character:1", version: 2}],
      versions: %{"character:1" => 2},
      content: %{name: "沈砚"}
    })
  end

  defp snapshot(transcript), do: %{stage_state: %{judgment_transcript: transcript}}

  defp sequence_execution(responses) do
    Process.put(:canonical_plan_responses, responses)
    parent = self()

    %Execution{
      result_fn: fn prompt ->
        send(parent, {:canonical_plan_prompt, prompt})
        [response | rest] = Process.get(:canonical_plan_responses)
        Process.put(:canonical_plan_responses, rest)
        response
      end
    }
  end

  defp validation_statuses(transcript) do
    for message <- transcript.messages,
        block <- message.blocks,
        Map.get(block, :type) == "validation_result",
        do: block.status
  end

  defp tool_names(transcript) do
    for message <- transcript.messages,
        block <- message.blocks,
        Map.get(block, :type) == "tool_call",
        do: block.name
  end

  test "empty assistant content falls back to author_reasoning tool argument with tool-narrative source binding" do
    execution = %Execution{result_fn: fn _prompt -> {:ok, provider_result("")} end}

    assert {:ok, plan, meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), execution)

    assert length(plan.steps) == 2
    assert meta.summary == @narrative
    assert meta.author_narrative_source.source_type == "provider_output_tool_narrative"
    assert meta.author_narrative_source.tool_call_name == "agent_plan_draft"
    assert meta.author_narrative_source.narrative_hash == meta.author_narrative_source.source_hash

    # 写作坐标随 PlanStep 透传
    act = Enum.at(plan.steps, 1)
    assert act.authoring_intent == :continuation
    assert act.target_chapter == "第01章：开端"
  end

  test "non-empty assistant content stays the preferred narrative source" do
    execution = %Execution{result_fn: fn _prompt -> {:ok, provider_result(@narrative)} end}

    assert {:ok, _plan, meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), execution)

    assert meta.summary == @narrative
    assert meta.author_narrative_source.source_type == "provider_output"
  end

  test "单调用 auto 同时携计划与说明，不再请求前置叙事" do
    parent = self()

    execution = %Execution{
      result_fn: fn prompt ->
        send(parent, {:prompt, prompt})
        {:ok, provider_result(@narrative)}
      end
    }

    assert {:ok, plan, meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), execution)

    # 生产请求已是 canonical IR：单调用 auto + 只暴露计划工具直接读 IR 事实。
    assert_received {:prompt, %RequestIR{} = prompt}
    assert prompt.projection[:tool_choice] == "auto"
    assert Enum.map(prompt.tools, & &1.name) == ["agent_plan_draft"]
    refute_receive {:prompt, _}, 10
    assert length(plan.steps) == 2
    assert meta.provider_call_count == 1
    assert meta.author_narrative_source.provider_run_ref == "prun_plan_draft"
  end

  test "plan with out-of-catalog tool as standalone step is rejected at draft time" do
    test_pid = self()

    {:ok, run} =
      NovelDomain.AgentRun.new(%{
        run_id: "run_plan_target_test",
        workspace_id: "ws_plan_target",
        work_id: "work_plan_target",
        session_id: "session_plan_target",
        parent_turn_ref: "turn_plan_target",
        origin_frame_ref: "frame_plan_target",
        profile_ref: "prose_drafting_with_quality_v1",
        # prose profile 的 authority_scope 允许 world_building 语汇出现，但它不在
        # 该 profile 的起草步目录里——不是合法的独立 PlanStep 目标（通用目录校验）。
        goal: %{text: "写一段正文草稿", version: 1},
        authority_scope: %{
          production_write: false,
          allowed_tools: ["world_building", "prose_writing"]
        }
      })

    bad_arguments = %{
      "author_reasoning" => @narrative,
      "plan" => %{
        "steps" => [
          %{
            "step_id" => "s1",
            "kind" => "explore",
            "description" => "读取上下文",
            "success_criteria" => [],
            "target_tool_ref" => "context_assemble"
          },
          %{
            "step_id" => "s2",
            "kind" => "act",
            "description" => "调用 world_building 推演设定",
            "success_criteria" => [],
            "target_tool_ref" => "world_building"
          }
        ]
      },
      "reason_codes" => ["agent_plan_drafted"],
      "confidence" => 0.9
    }

    bad_tool_calls = [%{"name" => "agent_plan_draft", "arguments" => bad_arguments}]

    result_fn = fn prompt ->
      send(test_pid, {:plan_prompt, prompt})
      {:ok, %{content: "", tool_calls: bad_tool_calls}}
    end

    assert {:error,
            {:agent_plan_protocol_violation, {:plan_step_target_not_allowed, ["world_building"]}},
            %{provider_call_count: 2}} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(run, %Execution{result_fn: result_fn})

    # 起草被拒后走了一次纠错重试（第二个单调用 prompt 是纠错 prompt）
    assert_received {:plan_prompt, _first}
    assert_received {:plan_prompt, retry_prompt}

    retry_text = feedback_text(retry_prompt)
    assert retry_text =~ "无法被系统解析"
  end

  test "planning prompts carry the work chapter list so target_chapter contract is satisfiable" do
    test_pid = self()

    result_fn = fn prompt ->
      send(test_pid, {:prompt, prompt})
      {:ok, provider_result("")}
    end

    titles_reader = fn "ws_plan_draft" -> ["第01章：开端", "第02章：矿区追击战"] end

    assert {:ok, _plan, _meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(
               probe_run(),
               %Execution{result_fn: result_fn},
               %{},
               chapter_titles_reader: titles_reader
             )

    assert_received {:prompt, plan_prompt}

    # 单调用 prompt 必须携带「作品章节」列表：target_chapter 契约要求模型精确复制列表全名，
    # 缺了列表点名章请求只能填 null → 被缺失策略误判"点名了不存在的章"（本回归的根因）。
    text = prompt_text(plan_prompt)
    assert text =~ "## 作品章节"
    assert text =~ "- 第02章：矿区追击战"
    assert text =~ "精确复制全名"
  end

  test "planning prompts omit the chapter section when the work has no chapters" do
    test_pid = self()

    result_fn = fn prompt ->
      send(test_pid, {:prompt, prompt})
      {:ok, provider_result("")}
    end

    assert {:ok, _plan, _meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(
               probe_run(),
               %Execution{result_fn: result_fn},
               %{},
               chapter_titles_reader: fn _workspace_id -> [] end
             )

    assert_received {:prompt, plan_prompt}
    refute prompt_text(plan_prompt) =~ "## 作品章节"
  end

  # 写作坐标解析（自帧纪元 Planner.form_micro_plan 载体迁移，2026-07 帧退役批次 2）：
  # 判断纪元坐标载体是 plan 步骤（AgenticPlanDraftPlanner 归一 + AgentPlan 步骤白名单）。
  describe "写作坐标解析（plan 步骤载体）" do
    test "act 步携带作者篇幅诉求 target_word_count" do
      step = drafted_act_step(Map.put(base_act_step(), "target_word_count", 800))
      assert step.target_word_count == 800
    end

    test "未携带篇幅诉求时为 nil" do
      step = drafted_act_step(base_act_step())
      assert step.target_word_count == nil
    end

    test "字符串形式的篇幅诉求违反整数 schema，不静默转换" do
      execution = %Execution{
        result_fn: fn _ ->
          {:ok, act_provider_result(Map.put(prose_act_step(), "target_word_count", "1200"))}
        end
      }

      assert {:error, {:agent_plan_protocol_violation, :invalid_plan_tool_arguments},
              %{provider_call_count: 2}} =
               AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), execution)
    end

    test "离谱篇幅诉求钳制到上限" do
      step = drafted_act_step(Map.put(base_act_step(), "target_word_count", 999_999))
      assert step.target_word_count == 20_000
    end

    test "target_chapter_ref 随步骤解析：合法 ref 保留，标题/坏 uuid 归 nil（B25 CP2b）" do
      ref = "chapter:44444444-4444-4444-8444-444444444444"

      step = drafted_act_step(Map.put(base_act_step(), "target_chapter_ref", ref))
      assert step.target_chapter_ref == ref
      assert step.target_chapter == "第01章：开端"

      for invalid <- ["灰烬中的手印", "chapter:not-a-uuid", "", nil] do
        invalid_step = drafted_act_step(Map.put(base_act_step(), "target_chapter_ref", invalid))
        assert invalid_step.target_chapter_ref == nil
        # title 坐标不受坏 ref 影响（旧路径兼容）。
        assert invalid_step.target_chapter == "第01章：开端"
      end
    end

    test "rewrite authoring_intent 随步骤解析" do
      step = drafted_act_step(Map.put(base_act_step(), "authoring_intent", "rewrite"))
      assert step.authoring_intent == :rewrite
      assert step.target_chapter == "第01章：开端"
    end

    # D7（2026-08-26）：显式 null 是写新章的正当取值，仍须放行；「省略键」则不再
    # 放行（见下一例）——两者解析后都是 nil，只能靠键存在性区分。
    test "显式 authoring_intent=null 合法（新章语义）" do
      step =
        base_act_step()
        |> Map.merge(%{"authoring_intent" => nil})
        |> Map.drop(["target_chapter", "requested_chapter_raw"])
        |> drafted_act_step()

      assert step.authoring_intent == nil
      assert step.target_chapter == nil
    end
  end

  # D7：prose_writing 步省略 authoring_intent 键 → 结构不合法 → 携带原因重试一次。
  # 缺陷背景：省略时采纳分流曾落 :overwrite（覆盖作者已采纳正文），M6/M9 对照实锤
  # qwen 推理正确但常省略此键。
  test "prose_writing 步省略 authoring_intent 键触发结构纠正重试" do
    {:ok, counter} = Agent.start_link(fn -> 0 end)

    missing_step =
      base_act_step()
      |> Map.drop(["authoring_intent"])

    result_fn = fn _prompt ->
      n = Agent.get_and_update(counter, &{&1 + 1, &1 + 1})
      step = if n == 1, do: missing_step, else: base_act_step()

      {:ok, act_provider_result(step)}
    end

    assert {:ok, plan, _meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(
               probe_run(),
               %Execution{result_fn: result_fn}
             )

    assert [step] = plan.steps
    assert step.authoring_intent == :continuation
    assert Agent.get(counter, & &1) == 2, "缺键首稿应触发恰一次结构纠正重试"
  end

  # D7 M10 校准：模型重试后仍省略该键时**带痕放行**，不让作者的 run 失败——
  # adoption_mode 已把缺失默认成安全侧 append，缺这个键不再有破坏性后果。
  # 实锤：硬失败版让 qwen 连续三次 agent_run.run_failed、作者一个字都拿不到。
  test "重试后仍缺 authoring_intent 键则带痕放行而非 run 失败" do
    {:ok, counter} = Agent.start_link(fn -> 0 end)
    missing_step = Map.drop(base_act_step(), ["authoring_intent"])

    result_fn = fn _prompt ->
      Agent.update(counter, &(&1 + 1))
      {:ok, act_provider_result(missing_step)}
    end

    assert {:ok, plan, _meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(
               probe_run(),
               %Execution{result_fn: result_fn}
             )

    assert [step] = plan.steps
    assert step.authoring_intent == nil
    assert Agent.get(counter, & &1) == 2, "应恰好 nudge 一次后放行，不再无限重试"
  end

  test "planning prompts do not list the removed generic creative capability" do
    removed_capability = "creative_" <> "generation"
    test_pid = self()

    result_fn = fn prompt ->
      send(test_pid, {:prompt, prompt})
      {:ok, provider_result("")}
    end

    assert {:ok, _plan, _meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(
               probe_run(),
               %Execution{result_fn: result_fn}
             )

    assert_received {:prompt, plan_prompt}

    text = prompt_text(plan_prompt)
    refute text =~ removed_capability
  end

  defp base_act_step do
    %{
      "step_id" => "s1",
      "kind" => "act",
      "description" => "生成续写草稿并质量复核",
      "success_criteria" => ["待采纳 prose_fragment"],
      "target_tool_ref" => "prose_writing",
      "write_intent" => "tentative",
      "authoring_intent" => "continuation",
      "target_chapter" => "第01章：开端",
      "requested_chapter_raw" => "第01章"
    }
  end

  defp drafted_act_step(act) do
    arguments = %{
      "author_reasoning" => @narrative,
      "plan" => %{"steps" => [act]},
      "reason_codes" => ["agent_plan_drafted"],
      "confidence" => 0.9
    }

    tool_calls = [%{"name" => "agent_plan_draft", "arguments" => arguments}]

    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: "prun_act_step",
        provider_call_ref: "pcall_act_step",
        status: :ok,
        output_type: :text,
        content: %{text: "", tool_calls: tool_calls},
        refs: ["pcall_act_step"]
      })

    result = %{content: "", tool_calls: tool_calls, provider_output: output}
    execution = %Execution{result_fn: fn _prompt -> {:ok, result} end}

    assert {:ok, plan, _meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), execution)

    assert [step] = plan.steps
    step
  end

  test "套娃信封 arguments 被封闭协议拒绝，不自行修补（M0 空计划根因回归）" do
    wrapped = %{
      "name" => "agent_plan_draft",
      "arguments" => %{
        "author_reasoning" => @narrative,
        "plan" => %{"steps" => [Map.put(prose_act_step(), "authoring_intent", "continuation")]},
        "reason_codes" => ["agent_plan_drafted"],
        "confidence" => 0.9
      }
    }

    tool_calls = [%{"name" => "agent_plan_draft", "arguments" => wrapped}]

    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: "prun_envelope",
        provider_call_ref: "pcall_envelope",
        status: :ok,
        output_type: :text,
        content: %{text: "", tool_calls: tool_calls},
        refs: []
      })

    # 单调用实锤形态：同一次响应的 tool call 参数被套一层信封。
    execution = %Execution{
      result_fn: fn _prompt ->
        {:ok, %{content: "", tool_calls: tool_calls, provider_output: output}}
      end
    }

    assert {:error, {:agent_plan_protocol_violation, :invalid_plan_tool_arguments},
            %{provider_call_count: 2}} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), execution)
  end

  # ── D4：provider 瞬态错误单次重试 ──────────────────────

  test "provider 首调超时 → 原样重试成功（D4 瞬态族）" do
    test_pid = self()
    {:ok, counter} = Agent.start_link(fn -> 0 end)

    result_fn = fn _prompt ->
      n = Agent.get_and_update(counter, &{&1 + 1, &1 + 1})
      send(test_pid, {:plan_call, n})

      if n == 1 do
        {:error, %{type: :timeout, message: "transient"}}
      else
        {:ok, act_provider_result(Map.put(prose_act_step(), "authoring_intent", "continuation"))}
      end
    end

    assert {:ok, plan, meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), %Execution{
               result_fn: result_fn
             })

    assert_received {:plan_call, 1}
    assert_received {:plan_call, 2}
    assert [_step] = plan.steps
    # 单调用协议：原样重发共 2 次调用，如实计数
    assert meta.provider_call_count == 2
  end

  test "provider 两次都失败 → 诚实上抛（单次额度不无限重试）" do
    result_fn = fn _prompt ->
      {:error, %{type: :timeout, message: "persistent"}}
    end

    assert {:error, %{type: :timeout}, %{provider_call_count: 2}} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), %Execution{
               result_fn: result_fn
             })
  end

  test "plan 键二次编码（JSON 字符串）被封闭协议拒绝，不自行修补（M5 空计划根因回归）" do
    plan_json =
      Jason.encode!(%{
        "steps" => [Map.put(prose_act_step(), "authoring_intent", "continuation")],
        "summary" => "先读上下文再写第03章正文。"
      })

    wrapped = %{
      "plan" => plan_json,
      "author_reasoning" => @narrative,
      "reason_codes" => ["agent_plan_drafted"],
      "confidence" => 0.9
    }

    tool_calls = [%{"name" => "agent_plan_draft", "arguments" => wrapped}]

    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: "prun_plan_key",
        provider_call_ref: "pcall_plan_key",
        status: :ok,
        output_type: :text,
        content: %{text: "", tool_calls: tool_calls},
        refs: []
      })

    execution = %Execution{
      result_fn: fn _prompt ->
        {:ok, %{content: "", tool_calls: tool_calls, provider_output: output}}
      end
    }

    assert {:error, {:agent_plan_protocol_violation, :invalid_plan_tool_arguments},
            %{provider_call_count: 2}} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), execution)
  end

  test "自由文本 authoring_intent 被拒并携带原因重试（M0 狗粮缺陷回归）；重试合法后成功" do
    test_pid = self()

    bad_step = Map.put(prose_act_step(), "authoring_intent", "自然衔接前文，推进本章情节")
    good_step = Map.put(prose_act_step(), "authoring_intent", "continuation")

    result_fn = fn prompt ->
      correction? =
        feedback_text(prompt) |> String.contains?("无法被系统解析")

      send(test_pid, {:plan_call, correction?})
      step = if correction?, do: good_step, else: bad_step
      {:ok, act_provider_result(step)}
    end

    assert {:ok, plan, meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), %Execution{
               result_fn: result_fn
             })

    assert_received {:plan_call, false}
    assert_received {:plan_call, true}

    # 重试成功：单调用协议首调 + 一次纠错 = 2 次调用；intent 按枚举落 plan
    assert meta.provider_call_count == 2
    assert [step] = plan.steps
    assert step.authoring_intent == :continuation
  end

  test "重试仍是自由文本 authoring_intent 则诚实失败（不静默吞成新章语义）" do
    bad_step = Map.put(prose_act_step(), "authoring_intent", "衔接前文继续推进")

    result_fn = fn _prompt ->
      {:ok, act_provider_result(bad_step)}
    end

    assert {:error, {:agent_plan_protocol_violation, :invalid_plan_tool_arguments},
            %{provider_call_count: 2}} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), %Execution{
               result_fn: result_fn
             })
  end

  defp prose_act_step do
    %{
      "step_id" => "s1",
      "kind" => "act",
      "description" => "接着第01章续写正文。",
      "success_criteria" => ["待采纳 prose_fragment"],
      "target_tool_ref" => "prose_writing",
      "write_intent" => "tentative",
      "target_chapter" => "第01章：开端",
      "requested_chapter_raw" => "第01章"
    }
  end

  defp act_provider_result(act) do
    arguments = %{
      "author_reasoning" => @narrative,
      "plan" => %{"steps" => [act]},
      "reason_codes" => ["agent_plan_drafted"],
      "confidence" => 0.9
    }

    tool_calls = [%{"name" => "agent_plan_draft", "arguments" => arguments}]

    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: "prun_intent_#{System.unique_integer([:positive])}",
        provider_call_ref: "pcall_intent_#{System.unique_integer([:positive])}",
        status: :ok,
        output_type: :text,
        content: %{text: "", tool_calls: tool_calls},
        refs: []
      })

    %{content: "", tool_calls: tool_calls, provider_output: output}
  end

  test "empty content and missing author_reasoning still fails honestly after retry" do
    arguments = Map.delete(plan_arguments(), "author_reasoning")
    tool_calls = [%{"name" => "agent_plan_draft", "arguments" => arguments}]

    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: "prun_plan_draft",
        provider_call_ref: "pcall_plan_draft",
        status: :ok,
        output_type: :text,
        content: %{text: "", tool_calls: tool_calls},
        refs: ["pcall_plan_draft"]
      })

    execution = %Execution{
      result_fn: fn _prompt ->
        {:ok, %{content: "", tool_calls: tool_calls, provider_output: output}}
      end
    }

    assert {:error, {:agent_plan_protocol_violation, :invalid_plan_tool_arguments},
            %{provider_call_count: 2}} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), execution)
  end

  # B71：角色、规则、输出协议先于动态 scope，目标和章节不得改写稳定前缀。
  test "B71 起草请求把稳定输出契约与动态章节目标分层" do
    prompt =
      captured_draft_prompt(["第01章：开端"])

    text = prompt_text(prompt)

    assert_ordered(text, [
      "## 计划要求",
      "## 输出契约",
      "## 可用能力说明",
      "## 作品章节",
      "## 本轮目标"
    ])

    refute text =~ "## 当前 AgentRun"
  end

  # B25 CP2b：计划协议把章节 ref 暴露为 prose 步坐标，并在 schema/prompt 中要求逐字复制。
  test "B25：计划 schema 含 target_chapter_ref 且 prompt 要求逐字复制 chapter_ref" do
    chapters = %{
      titles: ["灰烬中的手印"],
      entries: [
        %{
          title: "灰烬中的手印",
          seq: 2,
          id: "11111111-1111-4111-8111-111111111111",
          has_prose: true
        }
      ]
    }

    reasoning_prompt = captured_draft_prompt(chapters)
    text = prompt_text(reasoning_prompt)

    assert text =~ "target_chapter_ref"
    assert text =~ "逐字复制该条索引里的 chapter_ref"

    structure_prompt =
      captured_draft_prompt(chapters)

    [tool] = structure_prompt.tools

    step_properties =
      tool.input_schema.properties
      |> Map.fetch!(:plan)
      |> Map.fetch!(:properties)
      |> Map.fetch!(:steps)
      |> Map.fetch!(:items)
      |> Map.fetch!(:properties)

    assert Map.has_key?(step_properties, :target_chapter_ref)
  end

  # B24 CP2（I-EXPLORE-READ-9）：计划章节段同批渲染 chapter_ref（探索寻址）+
  # seq/title（target_chapter 仍精确复制标题）。
  test "B24：计划章节段渲染 chapter_ref + seq/title 双面身份" do
    chapters = %{
      titles: ["灰烬中的手印"],
      entries: [
        %{
          title: "灰烬中的手印",
          seq: 2,
          id: "11111111-1111-4111-8111-111111111111",
          has_prose: true
        }
      ]
    }

    text =
      captured_draft_prompt(chapters)
      |> prompt_text()

    assert text =~
             "- 第 2 章「灰烬中的手印」[chapter_ref=chapter:11111111-1111-4111-8111-111111111111]"

    assert text =~ "target_chapter 精确复制标题；chapter_read 优先复制 chapter_ref"

    # 无 seq/id 的旧标题列表仍退回旧行格式（兼容手工上下文/测试夹具）。
    legacy = captured_draft_prompt(["第01章：开端"])

    legacy_text = prompt_text(legacy)
    assert legacy_text =~ "- 第01章：开端"
    refute legacy_text =~ "[chapter_ref="
  end

  test "B24：draft_plan_with_meta 通过 chapter_index_reader 注入带 ref 的章节索引" do
    parent = self()

    result_fn = fn prompt ->
      send(parent, {:planner_prompt, prompt_text(prompt)})
      {:ok, act_provider_result(prose_act_step())}
    end

    chapters = [
      %{
        id: "22222222-2222-4222-8222-222222222222",
        seq: 1,
        title: "灰烬中的手印",
        has_prose: true
      }
    ]

    assert {:ok, _plan, _meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(
               probe_run(),
               %Execution{result_fn: result_fn},
               %{},
               chapter_index_reader: fn _workspace_id -> chapters end
             )

    assert_received {:planner_prompt, text}
    assert text =~ "[chapter_ref=chapter:22222222-2222-4222-8222-222222222222]"
    assert text =~ "第 1 章「灰烬中的手印」"
  end

  defp feedback_text(%RequestIR{messages: messages}) do
    messages
    |> Enum.reverse()
    |> Enum.find_value("", &feedback_from_message/1)
  end

  defp feedback_from_message(%{role: "tool", blocks: blocks}) do
    Enum.find_value(blocks, fn
      %{type: "validation_result", detail: detail} ->
        Map.get(detail, "correction") || Map.get(detail, "message")

      _block ->
        nil
    end)
  end

  # 无原生 tool_call 时纠错回执就是 application_notice 的文本块（现役注入形态）；
  # 只读实际请求里的消息字节，不再依赖旧桥标记字符串。
  defp feedback_from_message(%{role: "application_notice"} = message) do
    case NovelApplication.TestAgenticLoopFixtures.message_text(message) do
      "" -> nil
      text -> text
    end
  end

  defp feedback_from_message(_message), do: nil

  defp prompt_text(prompt), do: NovelApplication.TestAgenticLoopFixtures.prompt_text(prompt)

  defp captured_draft_prompt(chapters) do
    capture_plan_prompt(:draft, %{}, chapter_opts(chapters))
  end

  defp captured_revision_prompt(chapters, snapshot, reason) do
    capture_plan_prompt(:revision, snapshot, [revision_reason: reason] ++ chapter_opts(chapters))
  end

  defp chapter_opts(chapters) when is_list(chapters) do
    [chapter_titles_reader: fn _workspace_id -> chapters end]
  end

  defp chapter_opts(%{entries: entries}) when is_list(entries) do
    [chapter_index_reader: fn _workspace_id -> entries end]
  end

  defp chapter_opts(%{titles: titles}) when is_list(titles) do
    [chapter_titles_reader: fn _workspace_id -> titles end]
  end

  defp capture_plan_prompt(kind, snapshot, opts) do
    parent = self()
    ref = make_ref()

    execution = %Execution{
      result_fn: fn prompt ->
        unless Process.get({:captured_plan_prompt, ref}) do
          Process.put({:captured_plan_prompt, ref}, true)
          send(parent, {ref, prompt})
        end

        {:error, :capture_only}
      end
    }

    case kind do
      :draft ->
        AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), execution, snapshot, opts)

      :revision ->
        AgenticPlanDraftPlanner.revise_plan_with_meta(probe_run(), execution, snapshot, opts)
    end

    assert_receive {^ref, prompt}, 1_000
    prompt
  end

  test "B71 修订请求把稳定协议与动态计划观察分层" do
    prompt =
      captured_revision_prompt(["第01章：开端"], %{}, "质量复核要求补足步骤")

    text = prompt_text(prompt)

    assert_ordered(text, [
      "## 修订要求",
      "## 输出契约",
      "## 可用能力说明",
      "## 作品章节",
      "## 本轮目标",
      "## 修订触发原因",
      "## 当前计划",
      "## 最近观察"
    ])
  end

  test "T4 修订 prompt 渲染 finding 的 gate/severity/summary，超限显式标省略" do
    findings =
      for index <- 1..7 do
        %{
          quality_gate_ref: "quality_gate.style_fit",
          severity: :warn,
          summary: "第#{index}项：对白推进不足，需补充人物反应。"
        }
      end

    observations = [
      %{
        observation_id: "obs_finding_group",
        observation_type: :quality_review,
        summary: "质量复核已完成，记录 7 项需关注问题。",
        structured_payload: %{findings: findings}
      }
    ]

    prompt =
      captured_revision_prompt(["第01章：开端"], %{observations: observations}, "质量复核要求补足步骤")

    text = prompt_text(prompt)

    assert text =~ "finding [quality_gate.style_fit, severity=warn]"
    assert text =~ "第1项：对白推进不足"
    assert text =~ "finding …(+2)"
    # summary-only 不能冒充完整 observation：finding 明细必须出现。
    assert text =~ "## 最近观察"
  end

  defp assert_ordered(text, markers) do
    offsets =
      Enum.map(markers, fn marker ->
        case :binary.match(text, marker) do
          {offset, _} -> offset
          :nomatch -> flunk("prompt 缺少段落: #{inspect(marker)}")
        end
      end)

    assert offsets == Enum.sort(offsets),
           "prompt 段落顺序不符: #{inspect(markers)}"
  end

  test "原生页面替身的全部计划 profile 在起草与修订时都满足同一固定 schema" do
    profiles =
      ~w(prose_drafting_with_quality_v1 character_design_with_context_v1 plot_outline_with_context_v1 character_evolution_with_context_v1 world_building_with_context_v1 readonly_batch_context_v1 ledger_reconciliation_v1 fact_inventory_v1 judgment_plan_v1 prose_revision_from_findings_v1)

    for profile <- profiles,
        {title, tool} <- [
          {"AgentRun 计划起草器", "agent_plan_draft"},
          {"AgentRun 计划修订器", "agent_plan_revision"}
        ] do
      prompt =
        RequestIR.new(%{
          run: %{run_id: "run-plan-profile"},
          system: %{identity_ref: "identity:authoring/v1"},
          messages: [
            RequestIR.message(:application_base, :application, [
              RequestIR.text_block("#{title}\nprofile_ref: #{profile}\n作者目标：推进当前创作请求")
            ])
          ],
          tools: [AgentPlanToolContract.tool(tool)],
          projection: %{tool_choice: "auto"}
        })

      {:ok, result} = SliceVerify.complete(nil, nil, prompt, %{})
      assert [%{"name" => ^tool, "arguments" => args}] = result.tool_calls

      assert JudgmentToolContract.valid?(args, AgentPlanToolContract.schema()),
             "#{profile} #{tool}"

      assert args.author_reasoning == result.content
    end
  end

  # task-30：计划参数结构错误时，纠错回执必须给出字段级问题 + 合法骨架，一次纠正可修复。
  test "invalid plan tool arguments 纠错回执携带具体字段错误与合法骨架，一次纠正可修复" do
    test_pid = self()
    valid = plan_arguments()
    [s1, s2] = valid["plan"]["steps"]

    invalid =
      valid
      |> Map.put("status", "drafting")
      |> Map.put("plan", %{"steps" => [Map.delete(s1, "success_criteria"), s2]})

    {:ok, counter} = Agent.start_link(fn -> 0 end)

    result_fn = fn prompt ->
      n = Agent.get_and_update(counter, &{&1 + 1, &1 + 1})
      send(test_pid, {:plan_prompt, n, prompt})

      case n do
        1 -> {:ok, provider_result_with_arguments("第一次计划。", invalid)}
        _ -> {:ok, provider_result("第二次计划。")}
      end
    end

    assert {:ok, _plan, _meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), %Execution{
               result_fn: result_fn
             })

    assert_received {:plan_prompt, 1, _first}
    assert_received {:plan_prompt, 2, correction}
    correction_text = feedback_text(correction)

    assert correction_text =~ "plan.steps[0] 缺少必填字段 success_criteria"
    assert correction_text =~ "含未允许字段 status"
    assert correction_text =~ "合法最小骨架"
    assert correction_text =~ "kind 只能取"
    assert correction_text =~ "顶层只能是四个字段"
    assert correction_text =~ "本任务可用 plan_step_targets"
    assert correction_text =~ "context_assemble"
  end

  test "上次未返回 native tool call 时纠错回执明确要求 tool_calls/JSON object，一次纠正可修复" do
    test_pid = self()
    {:ok, counter} = Agent.start_link(fn -> 0 end)

    result_fn = fn prompt ->
      n = Agent.get_and_update(counter, &{&1 + 1, &1 + 1})
      send(test_pid, {:plan_prompt, n, prompt})

      case n do
        1 -> {:ok, %{content: "这是文本而不是工具调用。", tool_calls: [], provider_output: nil}}
        _ -> {:ok, provider_result("第二次计划。")}
      end
    end

    assert {:ok, _plan, _meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), %Execution{
               result_fn: result_fn
             })

    assert_received {:plan_prompt, 2, correction}
    correction_text = feedback_text(correction)
    assert correction_text =~ "没有返回 native tool call"
    assert correction_text =~ "arguments 是 JSON object"
  end

  test "invalid plan tool arguments 两次仍非法 → 终局 reason 保持原子并对日志保留字段细节" do
    valid = plan_arguments()
    [s1, s2] = valid["plan"]["steps"]
    invalid = Map.put(valid, "plan", %{"steps" => [Map.delete(s1, "target_tool_ref"), s2]})

    result_fn = fn _prompt -> {:ok, provider_result_with_arguments("仍非法。", invalid)} end

    assert {:error, {:agent_plan_protocol_violation, :invalid_plan_tool_arguments},
            %{provider_call_count: 2}} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), %Execution{
               result_fn: result_fn
             })
  end

  test "AgentPlanToolContract.validation_errors 精确指出缺失必填与非法枚举值" do
    assert AgentPlanToolContract.validation_errors(plan_arguments()) == []

    errors =
      AgentPlanToolContract.validation_errors(%{
        "author_reasoning" => "x",
        "plan" => %{
          "steps" => [
            %{
              "step_id" => "s1",
              "kind" => "write",
              "description" => "d",
              "success_criteria" => []
            }
          ]
        },
        "reason_codes" => [],
        "confidence" => 1.5
      })

    assert Enum.any?(errors, &(&1 =~ "plan.steps[0] 缺少必填字段 target_tool_ref"))
    assert Enum.any?(errors, &(&1 =~ "plan.steps[0].kind 只能是 explore｜act"))
    assert Enum.any?(errors, &(&1 =~ "arguments.confidence 不能大于 1"))
  end

  test "P1 可达性：draft/revision prompt 显式声明 arguments 顶层四字段骨架与 plan.steps 最小示例" do
    draft =
      captured_draft_prompt(["第01章：开端"])

    draft_text = prompt_text(draft)

    assert draft_text =~ "arguments JSON 骨架"
    assert draft_text =~ "plan / author_reasoning / reason_codes / confidence"
    assert draft_text =~ "plan 不是唯一包裹"
    assert draft_text =~ ~s("author_reasoning":"...")
    assert draft_text =~ ~s("confidence":0.9)
    assert draft_text =~ "只返回"
    assert draft_text =~ ~s({"plan":{...}})
    assert draft_text =~ "plan.steps 每步必须含"

    revision =
      captured_revision_prompt(
        ["第01章：开端"],
        %{},
        "计划步骤已走完但完成条件未满足"
      )

    revision_text = prompt_text(revision)
    assert revision_text =~ "arguments JSON 骨架"
    assert revision_text =~ "顶层同时包含 plan / author_reasoning / reason_codes / confidence"
  end

  test "P1 可达性：模型只返回只有 plan 顶层字段时纠错回执含具体缺失字段与骨架，一次纠正成功" do
    test_pid = self()
    valid = plan_arguments()
    only_plan = %{"plan" => valid["plan"]}

    {:ok, counter} = Agent.start_link(fn -> 0 end)

    result_fn = fn prompt ->
      n = Agent.get_and_update(counter, &{&1 + 1, &1 + 1})
      send(test_pid, {:plan_prompt, n, prompt})

      case n do
        1 -> {:ok, provider_result_with_arguments("第一次只给了 plan。", only_plan)}
        _ -> {:ok, provider_result("第二次补齐顶层字段。")}
      end
    end

    assert {:ok, _plan, _meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), %Execution{
               result_fn: result_fn
             })

    assert_received {:plan_prompt, 1, _first}
    assert_received {:plan_prompt, 2, correction}
    correction_text = feedback_text(correction)

    assert correction_text =~ "缺少必填字段 author_reasoning"
    assert correction_text =~ "缺少必填字段 reason_codes"
    assert correction_text =~ "缺少必填字段 confidence"
    assert correction_text =~ "plan 只是其中一个顶层字段"
    assert correction_text =~ "不能只返回"
    assert correction_text =~ "合法最小骨架"
    assert correction_text =~ ~s("author_reasoning":"...")
  end

  test "P1 复验：draft/revision 骨架含 prose_writing 的 authoring_intent（写新章也显式 null/值）" do
    draft =
      captured_draft_prompt(["第01章：开端"])

    draft_text = prompt_text(draft)

    assert draft_text =~ ~s("authoring_intent":"continuation")
    assert draft_text =~ "prose_writing 步必须在 step 对象里显式写"
    assert draft_text =~ "写新章也要有该键"
    assert draft_text =~ ~s("target_tool_ref":"prose_writing")

    revision =
      captured_revision_prompt(["第01章：开端"], %{}, "补足正文产出步")

    revision_text = prompt_text(revision)
    assert revision_text =~ ~s("authoring_intent":"continuation")
    assert revision_text =~ "写新章也要有该键"
  end

  test "P1 复验：纠错请求 tools 仍暴露 agent_plan_draft（不是 auto），骨架含 authoring_intent" do
    test_pid = self()
    valid = plan_arguments()
    only_plan = %{"plan" => valid["plan"]}

    {:ok, counter} = Agent.start_link(fn -> 0 end)

    result_fn = fn prompt ->
      n = Agent.get_and_update(counter, &{&1 + 1, &1 + 1})
      send(test_pid, {:plan_prompt, n, prompt})

      case n do
        1 -> {:ok, provider_result_with_arguments("第一次只给 plan。", only_plan)}
        _ -> {:ok, provider_result("第二次补齐。")}
      end
    end

    assert {:ok, _plan, _meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), %Execution{
               result_fn: result_fn
             })

    assert_received {:plan_prompt, 2, correction}

    tool_names =
      correction.tools
      |> Enum.map(&Map.get(&1, :name))
      |> Enum.reject(&is_nil/1)

    assert "agent_plan_draft" in tool_names
    refute "auto" in tool_names
    # tool_choice 是 IR projection 上的真实请求选择事实。
    assert correction.projection[:tool_choice] == "auto"

    correction_text = feedback_text(correction)
    assert correction_text =~ "必须调用 agent_plan_draft"
    refute correction_text =~ "必须调用 auto"
    assert correction_text =~ "function name 必须是 agent_plan_draft"
    assert correction_text =~ ~s("authoring_intent":"continuation")
    assert correction_text =~ ~s("target_tool_ref":"prose_writing")
  end

  test "P1 复验：revision 纠错请求 tools 暴露 agent_plan_revision（不是 auto）" do
    test_pid = self()
    valid = plan_arguments()
    only_plan = %{"plan" => valid["plan"]}

    {:ok, counter} = Agent.start_link(fn -> 0 end)

    result_fn = fn prompt ->
      n = Agent.get_and_update(counter, &{&1 + 1, &1 + 1})
      send(test_pid, {:plan_prompt, n, prompt})

      case n do
        1 -> {:ok, provider_result_with_arguments("修订只给 plan。", only_plan, "agent_plan_revision")}
        _ -> {:ok, provider_result_with_arguments("修订补齐。", valid, "agent_plan_revision")}
      end
    end

    assert {:ok, _plan, _meta} =
             AgenticPlanDraftPlanner.revise_plan_with_meta(
               probe_run(),
               %Execution{result_fn: result_fn},
               %{},
               revision_reason: "补足正文产出步"
             )

    assert_received {:plan_prompt, 2, correction}
    tool_names = correction.tools |> Enum.map(&Map.get(&1, :name)) |> Enum.reject(&is_nil/1)
    assert "agent_plan_revision" in tool_names
    refute "auto" in tool_names

    correction_text = feedback_text(correction)
    assert correction_text =~ "必须调用 agent_plan_revision"
    refute correction_text =~ "必须调用 auto"
  end

  # T3（UA01）T3′：修订计划已完成前缀的确定性校验（只校验，不合并）。
  describe "T3′ 修订前缀确定性校验" do
    alias NovelDomain.AgentPlan

    defp step(id, kind, target) do
      %{
        step_id: id,
        kind: kind,
        status: :completed,
        description: "步骤 #{id}",
        success_criteria: [],
        depends_on: [],
        target_tool_ref: target,
        write_intent: :none,
        risk_hint: :low
      }
    end

    defp run_with(completed_refs, steps) do
      base = probe_run()

      {:ok, plan} =
        AgentPlan.new(%{
          plan_id: "ap_#{base.run_id}",
          run_ref: base.run_id,
          version: 1,
          goal_version: 1,
          steps: steps
        })

      %{base | plan: plan, completed_step_refs: completed_refs}
    end

    defp revised_plan(steps) do
      {:ok, plan} =
        AgentPlan.new(%{
          plan_id: "ap_revised",
          run_ref: "run_plan_draft_test",
          version: 2,
          goal_version: 1,
          steps: steps
        })

      plan
    end

    test "完整计划保留已完成前缀 → :ok" do
      current = [step("s1", :explore, "context_assemble"), step("s2", :act, "prose_writing")]
      run = run_with(["step_s1"], current)

      revised =
        revised_plan([
          step("s1", :explore, "context_assemble"),
          step("s2b", :act, "prose_writing")
        ])

      assert :ok = AgenticPlanDraftPlanner.validate_completed_prefix(run, revised)
    end

    test "改写已完成前缀 → 结构错误（走既有纠错重试）" do
      current = [step("s1", :explore, "context_assemble"), step("s2", :act, "prose_writing")]
      run = run_with(["step_s1"], current)

      revised =
        revised_plan([
          step("renamed", :explore, "chapter_read"),
          step("s3", :act, "prose_writing")
        ])

      assert {:error, :completed_prefix_changed} =
               AgenticPlanDraftPlanner.validate_completed_prefix(run, revised)
    end

    test "只给尾部（无已完成前缀）→ 结构错误（现行 prompt 契约要求完整计划）" do
      current = [step("s1", :explore, "context_assemble"), step("s2", :act, "prose_writing")]
      run = run_with(["step_s1", "step_s2"], current)

      assert {:error, :completed_prefix_changed} =
               AgenticPlanDraftPlanner.validate_completed_prefix(
                 run,
                 revised_plan([step("tail1", :act, "quality_review")])
               )
    end

    test "无当前 plan 或无已完成步骤 → 不适用（draft 不受影响）" do
      run = probe_run()
      revised = revised_plan([step("s1", :explore, "context_assemble")])

      assert :ok = AgenticPlanDraftPlanner.validate_completed_prefix(run, revised)
    end
  end
end
