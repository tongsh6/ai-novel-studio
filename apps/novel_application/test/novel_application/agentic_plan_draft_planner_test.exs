defmodule NovelApplication.AgenticPlanDraftPlannerTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgenticPlanDraftPlanner
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

  defp provider_result(content) do
    tool_calls = [%{"name" => "agent_plan_draft", "arguments" => plan_arguments()}]

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

  test "empty assistant content falls back to author_reasoning tool argument with tool-narrative source binding" do
    execution = %Execution{result_fn: fn _prompt -> {:ok, provider_result("")} end}

    assert {:ok, plan, meta} = AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), execution)

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

  test "two-stage protocol: free-form reasoning call first, forced tool call second, narrative binds to reasoning call" do
    test_pid = self()

    {:ok, reasoning_output} =
      ProviderOutput.new(%{
        provider_run_ref: "prun_reasoning",
        provider_call_ref: "pcall_reasoning",
        status: :ok,
        output_type: :text,
        content: %{text: @narrative},
        refs: ["pcall_reasoning"]
      })

    result_fn = fn prompt ->
      send(test_pid, {:prompt, prompt})

      if NovelAgent.Provider.tool_call_prompt?(prompt) do
        # 第二段：强制 tool call，content 系统性为空（LM Studio 形态）
        {:ok, provider_result("")}
      else
        {:ok,
         %{content: @narrative, tool_calls: [], provider_output: reasoning_output}}
      end
    end

    execution = %Execution{result_fn: result_fn}

    assert {:ok, plan, meta} = AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), execution)

    assert_received {:prompt, first_prompt}
    assert_received {:prompt, second_prompt}
    refute NovelAgent.Provider.tool_call_prompt?(first_prompt)
    assert NovelAgent.Provider.tool_choice(second_prompt) == "agent_plan_draft"

    # 第二段 prompt 内嵌第一段 reasoning
    assert second_prompt.messages |> hd() |> Map.fetch!(:content) =~ @narrative

    assert length(plan.steps) == 2
    assert meta.provider_call_count == 2
    assert meta.summary == @narrative
    # 叙事绑定第一段（流式 reasoning）的 provider output，而不是结构调用
    assert meta.author_narrative_source.source_type == "provider_output"
    assert meta.author_narrative_source.provider_run_ref == "prun_reasoning"
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
      if NovelAgent.Provider.tool_call_prompt?(prompt) do
        send(test_pid, {:structure_prompt, prompt})
        {:ok, %{content: "", tool_calls: bad_tool_calls}}
      else
        {:ok, %{content: @narrative, tool_calls: []}}
      end
    end

    assert {:error, {:plan_step_target_not_allowed, ["world_building"]}} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(run, %Execution{result_fn: result_fn})

    # 起草被拒后走了一次纠错重试（第二个结构 prompt 是纠错 prompt）
    assert_received {:structure_prompt, _first}
    assert_received {:structure_prompt, retry_prompt}

    retry_text = retry_prompt.messages |> hd() |> Map.fetch!(:content)
    assert retry_text =~ "无法被系统解析"
  end

  defp reasoning_provider_result do
    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: "prun_reasoning",
        provider_call_ref: "pcall_reasoning",
        status: :ok,
        output_type: :text,
        content: %{text: @narrative},
        refs: ["pcall_reasoning"]
      })

    %{content: @narrative, tool_calls: [], provider_output: output}
  end

  test "planning prompts carry the work chapter list so target_chapter contract is satisfiable" do
    test_pid = self()

    result_fn = fn prompt ->
      send(test_pid, {:prompt, prompt})

      if NovelAgent.Provider.tool_call_prompt?(prompt) do
        {:ok, provider_result("")}
      else
        {:ok, reasoning_provider_result()}
      end
    end

    titles_reader = fn "ws_plan_draft" -> ["第01章：开端", "第02章：矿区追击战"] end

    assert {:ok, _plan, _meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(
               probe_run(),
               %Execution{result_fn: result_fn},
               %{},
               chapter_titles_reader: titles_reader
             )

    assert_received {:prompt, reasoning_prompt}
    assert_received {:prompt, structure_prompt}

    # 两段 prompt 都必须携带「作品章节」列表：target_chapter 契约要求模型精确复制列表全名，
    # 缺了列表点名章请求只能填 null → 被缺失策略误判"点名了不存在的章"（本回归的根因）。
    for prompt <- [reasoning_prompt, structure_prompt] do
      text = prompt.messages |> hd() |> Map.fetch!(:content)
      assert text =~ "## 作品章节"
      assert text =~ "- 第02章：矿区追击战"
      assert text =~ "精确复制全名"
    end
  end

  test "planning prompts omit the chapter section when the work has no chapters" do
    test_pid = self()

    result_fn = fn prompt ->
      send(test_pid, {:prompt, prompt})

      if NovelAgent.Provider.tool_call_prompt?(prompt) do
        {:ok, provider_result("")}
      else
        {:ok, reasoning_provider_result()}
      end
    end

    assert {:ok, _plan, _meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(
               probe_run(),
               %Execution{result_fn: result_fn},
               %{},
               chapter_titles_reader: fn _workspace_id -> [] end
             )

    assert_received {:prompt, reasoning_prompt}
    refute reasoning_prompt.messages |> hd() |> Map.fetch!(:content) =~ "## 作品章节"
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

    test "字符串形式的篇幅诉求解析为整数" do
      step = drafted_act_step(Map.put(base_act_step(), "target_word_count", "600"))
      assert step.target_word_count == 600
    end

    test "离谱篇幅诉求钳制到上限" do
      step = drafted_act_step(Map.put(base_act_step(), "target_word_count", 999_999))
      assert step.target_word_count == 20_000
    end

    test "rewrite authoring_intent 随步骤解析" do
      step = drafted_act_step(Map.put(base_act_step(), "authoring_intent", "rewrite"))
      assert step.authoring_intent == :rewrite
      assert step.target_chapter == "第01章：开端"
    end

    test "省略 authoring_intent 默认 nil（新章语义）" do
      step =
        base_act_step()
        |> Map.drop(["authoring_intent", "target_chapter", "requested_chapter_raw"])
        |> drafted_act_step()

      assert step.authoring_intent == nil
      assert step.target_chapter == nil
    end
  end

  test "planning prompts do not list the removed generic creative capability" do
    removed_capability = "creative_" <> "generation"
    test_pid = self()

    result_fn = fn prompt ->
      send(test_pid, {:prompt, prompt})

      if NovelAgent.Provider.tool_call_prompt?(prompt) do
        {:ok, provider_result("")}
      else
        {:ok, reasoning_provider_result()}
      end
    end

    assert {:ok, _plan, _meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(
               probe_run(),
               %Execution{result_fn: result_fn}
             )

    assert_received {:prompt, reasoning_prompt}
    assert_received {:prompt, structure_prompt}

    for prompt <- [reasoning_prompt, structure_prompt] do
      text = prompt.messages |> hd() |> Map.fetch!(:content)
      refute text =~ removed_capability
    end
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

    assert {:ok, plan, _meta} = AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), execution)
    assert [step] = plan.steps
    step
  end

  test "套娃信封 arguments 被确定性解套（M0 空计划根因回归）" do
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

    # 两段式镜像实锤形态：call1 有叙事内容（正常流式），call2 结构调用被套娃。
    execution = %Execution{
      result_fn: fn prompt ->
        if NovelAgent.Provider.tool_call_prompt?(prompt) do
          {:ok, %{content: "", tool_calls: tool_calls, provider_output: output}}
        else
          {:ok, reasoning_provider_result()}
        end
      end
    }

    assert {:ok, plan, _meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), execution)

    assert [step] = plan.steps
    assert step.target_tool_ref == "prose_writing"
    assert step.authoring_intent == :continuation
  end

  # ── D4：provider 瞬态错误单次重试 ──────────────────────

  test "结构段 provider 首调超时 → 原样重试成功（D4 瞬态族）" do
    test_pid = self()
    {:ok, counter} = Agent.start_link(fn -> 0 end)

    result_fn = fn prompt ->
      if NovelAgent.Provider.tool_call_prompt?(prompt) do
        n = Agent.get_and_update(counter, &{&1 + 1, &1 + 1})
        send(test_pid, {:structure_call, n})

        if n == 1 do
          {:error, %{type: :timeout, message: "transient"}}
        else
          {:ok, act_provider_result(Map.put(prose_act_step(), "authoring_intent", "continuation"))}
        end
      else
        {:ok, reasoning_provider_result()}
      end
    end

    assert {:ok, plan, meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), %Execution{
               result_fn: result_fn
             })

    assert_received {:structure_call, 1}
    assert_received {:structure_call, 2}
    assert [_step] = plan.steps
    # reasoning 1 + 结构 2 = 3 次调用如实计数
    assert meta.provider_call_count == 3
  end

  test "结构段两次都失败 → 诚实上抛（单次额度不无限重试）" do
    result_fn = fn prompt ->
      if NovelAgent.Provider.tool_call_prompt?(prompt) do
        {:error, %{type: :timeout, message: "persistent"}}
      else
        {:ok, reasoning_provider_result()}
      end
    end

    assert {:error, %{type: :timeout}} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), %Execution{
               result_fn: result_fn
             })
  end

  test "叙事段首调失败 → 原样重试成功（D4 双段覆盖）" do
    {:ok, counter} = Agent.start_link(fn -> 0 end)

    result_fn = fn prompt ->
      if NovelAgent.Provider.tool_call_prompt?(prompt) do
        {:ok, act_provider_result(Map.put(prose_act_step(), "authoring_intent", "continuation"))}
      else
        n = Agent.get_and_update(counter, &{&1 + 1, &1 + 1})
        if n == 1, do: {:error, %{type: :provider_error, message: "empty"}}, else: {:ok, reasoning_provider_result()}
      end
    end

    assert {:ok, plan, _meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), %Execution{
               result_fn: result_fn
             })

    assert [_step] = plan.steps
  end

  test "plan 键二次编码（JSON 字符串）被确定性解套（M5 空计划根因回归）" do
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
      result_fn: fn prompt ->
        if NovelAgent.Provider.tool_call_prompt?(prompt) do
          {:ok, %{content: "", tool_calls: tool_calls, provider_output: output}}
        else
          {:ok, reasoning_provider_result()}
        end
      end
    }

    assert {:ok, plan, _meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), execution)

    assert [step] = plan.steps
    assert step.target_tool_ref == "prose_writing"
    assert step.authoring_intent == :continuation
  end

  test "自由文本 authoring_intent 被拒并携带原因重试（M0 狗粮缺陷回归）；重试合法后成功" do
    test_pid = self()

    bad_step = Map.put(prose_act_step(), "authoring_intent", "自然衔接前文，推进本章情节")
    good_step = Map.put(prose_act_step(), "authoring_intent", "continuation")

    result_fn = fn prompt ->
      if NovelAgent.Provider.tool_call_prompt?(prompt) do
        correction? =
          prompt.messages |> hd() |> Map.fetch!(:content) |> String.contains?("无法被系统解析")

        send(test_pid, {:structure_call, correction?})
        step = if correction?, do: good_step, else: bad_step
        {:ok, act_provider_result(step)}
      else
        {:ok, reasoning_provider_result()}
      end
    end

    assert {:ok, plan, meta} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), %Execution{
               result_fn: result_fn
             })

    assert_received {:structure_call, false}
    assert_received {:structure_call, true}

    # 重试成功：reasoning 1 + 结构 2 = 3 次调用；intent 按枚举落 plan
    assert meta.provider_call_count == 3
    assert [step] = plan.steps
    assert step.authoring_intent == :continuation
  end

  test "重试仍是自由文本 authoring_intent 则诚实失败（不静默吞成新章语义）" do
    bad_step = Map.put(prose_act_step(), "authoring_intent", "衔接前文继续推进")

    result_fn = fn prompt ->
      if NovelAgent.Provider.tool_call_prompt?(prompt) do
        {:ok, act_provider_result(bad_step)}
      else
        {:ok, reasoning_provider_result()}
      end
    end

    assert {:error, {:invalid_authoring_intent, message}} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), %Execution{
               result_fn: result_fn
             })

    assert message =~ "衔接前文继续推进"
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

    assert {:error, :reasoning_text_required} =
             AgenticPlanDraftPlanner.draft_plan_with_meta(probe_run(), execution)
  end
end
