# I-CACHE prefix-sharing driver (VS-00I §6.1)
#
# Run:
#   MIX_ENV=test mix run scripts/scenario_invariants/run_icache_prefix.exs
#
# 每个样本都走生产 prompt 构造器 → 真实 Gateway 边界（L0 身份注入）→ 测试捕获
# provider，再按固定序列化做字节级公共前缀比较。三类 pair_kind：
#   - cross_run      ：同一调用点跨 run（CP-D：共享前缀须覆盖 L1）
#   - consecutive    ：同一调用点连续两轮（CP-C：共享前缀须覆盖 L0–L2）
#
# I-CACHE-1 在 CP-C 完成后升 CI 阻断；本脚本自 CP-D 起对已迁移调用点做
# `covers_required_prefix` 硬断言（enforce=true 行）。

defmodule ICachePrefixDriver do
  @moduledoc false

  alias NovelAgent.Provider.Gateway

  alias NovelAgent.CreativeProvider.Real
  alias NovelAgent.Provider.Execution

  alias NovelApplication.{
    AgenticPlanDraftPlanner,
    AuthoringTaskBuilder,
    ChapterMissionService,
    DialoguePlanningService,
    JudgmentProtocol
  }

  alias NovelCommon.Contracts.{CreativeRequest, QualityEvaluationRequest}
  alias NovelDomain.{AgentRun, ChapterMissionInputs, DialogueContext}
  alias NovelAgent.ProseQualityEvaluator

  @chapter_titles [
    "第01章：底层灵气账单",
    "第02章：旧服务器里的残诀",
    "第03章：黑市调频师",
    "第04章：巡检队的诱捕"
  ]

  defmodule CaptureProvider do
    @behaviour NovelAgent.Provider

    alias NovelAgent.Provider.{AdapterExecution, Result}

    defstruct []

    @impl true
    def execute(_state, _model, prompt, params, ctx) do
      send(self(), {:icache_prompt, prompt, params})
      AdapterExecution.materialize_result({:ok, Result.new("captured")}, ctx)
    end

    @impl true
    def complete(_state, _model, _prompt, _params), do: raise("use execute/5")

    @impl true
    def health_check(_state), do: :ok

    @impl true
    def name, do: "icache_capture"
  end

  def run do
    File.mkdir_p!("artifacts/scenario-invariants")
    restore = install_capture_provider()

    try do
      rows = single_call_rows() ++ cp_d_rows() ++ cp_c_rows() ++ professional_rows()
      assert_enforced_rows!(rows)

      markdown = render_markdown(rows)
      File.write!("artifacts/scenario-invariants/icache.md", markdown)
      File.write!("artifacts/scenario-invariants/icache.json", Jason.encode!(rows, pretty: true))

      IO.puts("\nI-CACHE prefix sharing (VS-00I §6.1 measurement):")

      Enum.each(rows, fn row ->
        IO.puts(format_row(row) <> coverage_suffix(row))
      end)
    after
      restore.()
    end
  end

  # B26：同 profile 连续请求保持 auto 与固定工具 schema，旧调用对不再存在。
  defp single_call_rows do
    a = %{goal_text: "写第一章", deviation_summary: "尚缺结尾", observation_block: "已有前半章"}
    b = %{a | goal_text: "写第二章", observation_block: "新观察"}
    shared = "所有动作均须经系统门禁放行。"

    row =
      shared_prefix_row(
        "continuation",
        "consecutive",
        JudgmentProtocol.prompt(a, :continuation),
        JudgmentProtocol.prompt(b, :continuation),
        "## 当前目标",
        [shared],
        true
      )

    [row]
  end

  # ── CP-D：起草 / 修订 / 章节使命跨 run ────────────────

  defp cp_d_rows do
    run_a = agent_run("run_icache_cp_d_a", "接着第01章往下写一段正文", 1)
    run_b = agent_run("run_icache_cp_d_b", "接着第02章往下写，并保持既有文风", 2)

    snapshot_a = %{stage_state: %{"planning" => %{}}}
    snapshot_b = %{stage_state: %{"planning" => %{}, "quality" => %{}}}

    revision_a =
      agent_run("run_icache_cp_d_rev_a", "接着第01章往下写一段正文", 1,
        plan_version: 1,
        plan: plan_fixture(1)
      )

    revision_b =
      agent_run("run_icache_cp_d_rev_b", "接着第02章往下写，并保持既有文风", 2,
        plan_version: 2,
        plan: plan_fixture(2)
      )

    revision_reason_a = "质量复核发现第01章段落节奏偏慢，需要补一个推进步骤。"
    revision_reason_b = "执行观察显示上下文读取完成但缺少质量复核步骤，需要补足。"

    mission_a = mission_inputs(3, "第03章：巡检收网", "伏笔：旧账牌")
    mission_b = mission_inputs(4, "第04章：霓虹地牢试炼", "伏笔：断链标记")

    [
      shared_prefix_row(
        "draft",
        "cross_run",
        AgenticPlanDraftPlanner.draft_prompt(run_a, snapshot_a, @chapter_titles),
        AgenticPlanDraftPlanner.draft_prompt(run_b, snapshot_b, @chapter_titles),
        "## 本轮目标",
        ["普通路径应覆盖完成目标所需最少步骤；不要添加纯收束模型调用。", "- 第04章：巡检队的诱捕"],
        true
      ),
      shared_prefix_row(
        "revision",
        "cross_run",
        AgenticPlanDraftPlanner.revision_prompt(
          revision_a,
          revision_snapshot(revision_reason_a),
          @chapter_titles,
          revision_reason_a
        ),
        AgenticPlanDraftPlanner.revision_prompt(
          revision_b,
          revision_snapshot(revision_reason_b),
          @chapter_titles,
          revision_reason_b
        ),
        "## 本轮目标",
        ["如果计划已走完但完成条件未满足，必须补足能够让运行继续取得真实进展的最少步骤。", "- 第04章：巡检队的诱捕"],
        true
      ),
      shared_prefix_row(
        "chapter_mission",
        "cross_run",
        ChapterMissionService.mission_prompt(mission_a, "把这一章写得更紧凑", :prose),
        ChapterMissionService.mission_prompt(mission_b, "保持文风继续推进", :prose),
        "材料（每条以 [ref] 开头",
        ["- must_avoid：0 到 3 条，后续章计划信息的保密与全书进度守则优先，basis_ref 同上。"],
        true
      )
    ]
  end

  defp cp_c_rows do
    author_a = "接着第02章往下写一段正文"
    author_b = "把第02章写得更紧凑些"

    context_a = dialogue_context("上一轮采纳了第01章草稿，作者准备继续推进正文。")
    context_b = dialogue_context("上一轮采纳了第02章草稿，作者要求回头把第02章写紧。")

    input_a = %{
      author_text: author_a,
      context_block: DialoguePlanningService.judgment_context_block(context_a, author_a),
      options: []
    }

    input_b = %{
      author_text: author_b,
      context_block: DialoguePlanningService.judgment_context_block(context_b, author_b),
      options: []
    }

    [
      shared_prefix_row(
        "judgment_consecutive",
        "consecutive",
        JudgmentProtocol.prompt(input_a),
        JudgmentProtocol.prompt(input_b),
        "## 会话摘要",
        [
          "所有动作均须经系统门禁放行。",
          "（回答写作进度时以「已写」计数为准；标注（计划中）的章尚无正文。各章正文细节不在本段内；作者点名章见下段。）"
        ],
        # CP-C 重排完成：连续两轮共享前缀必须覆盖 L0–L2（能力目录 L1 + 稳定章节 L2）。
        true
      )
    ]
  end

  # ── CP3：writer / evaluator 专业调用连续轮前缀 ────────────────
  # 生产渲染路径：CreativeRequest.task → Real/Evaluator 渲染 → Gateway L0 注入边界捕获，
  # 静态段（角色句+shared/operation/output 规则）必须在连续轮字节恒定，L3 动态段随后变化。
  defp professional_rows do
    writer_a = writer_prompt(writer_task("接着第01章往下写一段正文", "chapter:one", "第01章：底层灵气账单"))
    writer_b = writer_prompt(writer_task("接着第02章往下写，并保持既有文风", "chapter:two", "第02章：旧服务器里的残诀"))

    evaluator_a = evaluator_prompt(evaluator_task("biz_icache_eval_a", "chapter:one"))
    evaluator_b = evaluator_prompt(evaluator_task("biz_icache_eval_b", "chapter:two"))

    [
      shared_prefix_row(
        "writer",
        "consecutive",
        writer_a,
        writer_b,
        "## 本轮作者目标",
        ["## 创作协作共同规则", "## 本轮任务语义"],
        true
      ),
      shared_prefix_row(
        "evaluator",
        "consecutive",
        evaluator_a,
        evaluator_b,
        "## 对象与范围",
        ["## 创作协作共同规则", "## 输出契约纪律"],
        true
      )
    ]
  end

  defp writer_task(goal, chapter_ref, chapter_title) do
    {:ok, task} =
      AuthoringTaskBuilder.new(:continuation, %{
        author_goal: goal,
        author_words: goal,
        scope:
          AuthoringTaskBuilder.scope([chapter_ref],
            coverage: :chapter,
            target_chapter_ref: chapter_ref
          ),
        materials: [
          AuthoringTaskBuilder.material(:prior_prose, chapter_ref, complete?: true, version: 1),
          AuthoringTaskBuilder.material(:target_structure, "#{chapter_ref}:structure",
            complete?: true
          )
        ],
        output_contract:
          AuthoringTaskBuilder.output_contract(:json,
            required_keys: ["items", "companion_artifacts", "self_report"],
            allow_companions: true
          )
      })

    {task, chapter_title}
  end

  defp writer_prompt({task, chapter_title}) do
    request = %CreativeRequest{
      request_id: "icache_writer_#{task.author_goal}",
      tool_name: "prose_writing",
      artifact_type: :prose_fragment,
      creative_brief: task.author_goal,
      context_text: "目标章：#{chapter_title}",
      source_turn_ref: "turn_icache_writer",
      task: task
    }

    parent = self()

    execution = %Execution{
      result_fn: fn prompt ->
        {:ok, _} = Gateway.execute(prompt, "capture-model", purpose: :writer)

        captured =
          receive do
            {:icache_prompt, captured, _params} -> captured
          after
            5_000 -> raise "writer capture provider did not receive prompt"
          end

        send(parent, {:icache_professional_prompt, normalize_captured_prompt(captured)})

        {:ok,
         %{
           content:
             Jason.encode!(%{
               "items" => [
                 %{"item_id" => "i1", "title" => "片段", "body" => "正文", "rationale" => nil}
               ],
               "companion_artifacts" => [],
               "self_report" => %{
                 "assumptions" => [],
                 "intended_reader_effect" => nil,
                 "used_context_refs" => [],
                 "risk_flags" => []
               }
             }),
           tool_calls: []
         }}
      end
    }

    case Real.generate(request, execution) do
      %NovelCommon.Contracts.CreativeProviderResult{status: :ok} -> :ok
      other -> raise "writer generate failed for I-CACHE capture: #{inspect(other)}"
    end

    receive do
      {:icache_professional_prompt, captured} -> captured
    after
      5_000 -> raise "writer prompt not captured"
    end
  end

  defp evaluator_task(request_id, chapter_ref) do
    {:ok, task} =
      AuthoringTaskBuilder.new(:quality_evaluation, %{
        author_goal: nil,
        author_words: nil,
        source: %{kind: :author_action, ref: "act_icache_eval"},
        scope: AuthoringTaskBuilder.scope([chapter_ref], coverage: :single),
        materials: [
          AuthoringTaskBuilder.material(:prose, "#{chapter_ref}:fragment",
            complete?: false,
            omission_note: "仅本轮生成片段"
          )
        ],
        output_contract: AuthoringTaskBuilder.output_contract(:json, required_keys: ["findings"])
      })

    {request_id, task}
  end

  defp evaluator_prompt({request_id, task}) do
    request = %QualityEvaluationRequest{
      request_id: request_id,
      source_turn_ref: "turn_icache_eval",
      source_ref: "as_icache",
      prose_text: "巷口的灯在雨里晃，他把账牌塞进袖口。",
      task: task
    }

    parent = self()

    execution = %Execution{
      result_fn: fn prompt ->
        {:ok, _} = Gateway.execute(prompt, "capture-model", purpose: :evaluator)

        captured =
          receive do
            {:icache_prompt, captured, _params} -> captured
          after
            5_000 -> raise "evaluator capture provider did not receive prompt"
          end

        send(parent, {:icache_professional_prompt, normalize_captured_prompt(captured)})

        {:ok, %{content: Jason.encode!(%{"findings" => []}), tool_calls: []}}
      end
    }

    case ProseQualityEvaluator.evaluate(request, execution) do
      %NovelCommon.Contracts.QualityEvaluationResult{status: :ok} -> :ok
      other -> raise "evaluator failed for I-CACHE capture: #{inspect(other)}"
    end

    receive do
      {:icache_professional_prompt, captured} -> captured
    after
      5_000 -> raise "evaluator prompt not captured"
    end
  end

  # Gateway 对 binary prompt 会以 message list 形式交给 provider；统一成 prompt map 供
  # capture/2 复用（identity 已注入，二次 inject 会识别并保持）。
  defp normalize_captured_prompt(messages) when is_list(messages),
    do: %{messages: messages, tools: []}

  defp normalize_captured_prompt(prompt), do: prompt

  defp shared_prefix_row(
         call_site,
         pair_kind,
         prompt_a,
         prompt_b,
         boundary_marker,
         required_tails,
         enforce?
       ) do
    {first, tools_a} = capture(prompt_a, call_site <> "-a")
    {second, tools_b} = capture(prompt_b, call_site <> "-b")
    if tools_a != tools_b, do: raise("I-CACHE profile schema drift at #{call_site}")

    # 有 tool_choice 的判断/计划类调用必须是单调用 auto；writer/evaluator 无工具选择字段。
    if call_site != "chapter_mission" and Map.has_key?(prompt_a, :tool_choice) and
         (Map.get(prompt_a, :tool_choice) != "auto" or Map.get(prompt_b, :tool_choice) != "auto"),
       do: raise("I-CACHE single-call auto required at #{call_site}")

    shared = shared_prefix_bytes(first, second)
    total = min(byte_size(first), byte_size(second))
    boundary = marker_offset!(first, boundary_marker, call_site)

    required_tail_ends =
      Enum.map(required_tails, fn tail ->
        marker_offset!(first, tail, call_site) + byte_size(tail)
      end)

    covers = shared >= boundary and Enum.all?(required_tail_ends, &(shared >= &1))

    %{
      call_site: call_site,
      pair_kind: pair_kind,
      shared_prefix_bytes: shared,
      total_bytes: total,
      ratio: ratio(shared, total),
      boundary_marker: boundary_marker,
      boundary_bytes: boundary,
      covers_required_prefix: covers,
      enforce: enforce?,
      tools_equal: true
    }
  end

  defp marker_offset!(text, marker, call_site) do
    case :binary.matches(text, marker) do
      [match | _] -> elem(match, 0)
      [] -> raise "I-CACHE marker not found for #{call_site}: #{inspect(marker)}"
    end
  end

  defp assert_enforced_rows!(rows) do
    failures =
      rows
      |> Enum.filter(& &1.enforce)
      |> Enum.reject(& &1.covers_required_prefix)

    if failures != [] do
      details =
        Enum.map_join(failures, "\n", fn row ->
          "  #{row.call_site}: shared=#{row.shared_prefix_bytes} " <>
            "boundary=#{row.boundary_bytes}/marker=#{inspect(row.boundary_marker)}"
        end)

      raise "I-CACHE-1 coverage violation:\n" <> details
    end
  end

  defp ratio(_shared, 0), do: 0.0
  defp ratio(shared, total), do: Float.round(shared / total, 4)

  # ── 样本上下文（生产构造器输入） ───────────────────────

  defp agent_run(run_id, goal_text, goal_version, opts \\ []) do
    {:ok, run} =
      AgentRun.new(%{
        run_id: run_id,
        workspace_id: "ws_icache_prefix",
        work_id: "work_icache_prefix",
        session_id: "session_icache_prefix",
        parent_turn_ref: "turn_icache_prefix",
        origin_frame_ref: "frame_icache_prefix",
        profile_ref: "prose_drafting_with_quality_v1",
        goal: %{text: goal_text, version: goal_version},
        authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]}
      })

    Enum.reduce(opts, run, fn {key, value}, acc -> Map.put(acc, key, value) end)
  end

  defp plan_fixture(version) do
    %{
      plan_id: "plan_icache",
      version: version,
      steps: [
        %{
          step_id: "s1",
          kind: "explore",
          description: "读取正文写作上下文",
          success_criteria: ["上下文观察"],
          depends_on: [],
          target_tool_ref: "context_assemble",
          write_intent: "none",
          risk_hint: "low"
        }
      ]
    }
  end

  defp revision_snapshot(observation_summary) do
    %{
      stage_state: %{"planning" => %{}, "quality" => %{}},
      observations: [
        %{
          observation_id: "obs_icache",
          observation_type: "quality_review",
          summary: observation_summary
        }
      ]
    }
  end

  defp mission_inputs(seq, title, subject_label) do
    ChapterMissionInputs.build(%{
      chapter: %{
        seq: seq,
        title: title,
        plan_direction: %{"chapter_role" => "推进章", "plot_progress" => "推进当前卷主线"}
      },
      entries: [
        %{
          ledger: "information",
          subject_ref: "foreshadow_#{seq}",
          subject_label: subject_label,
          status: "HIDDEN",
          payload: %{"planned_reveal" => %{"kind" => "chapter", "seq" => seq - 1}}
        }
      ],
      written_progress: %{chapter_seq: seq - 1, volume_seq: 1}
    })
  end

  defp dialogue_context(conversation_summary) do
    %DialogueContext{
      workspace_id: "ws_icache_prefix",
      current_work_snapshot: %{
        title: "前缀度量样书",
        revision: 1,
        genre: "赛博修仙",
        tone_preference: "克制、紧张、具象"
      },
      conversation_summary: conversation_summary,
      interaction_state: %{},
      current_chapters: @chapter_titles,
      structured_chapters: Enum.map(@chapter_titles, &%{title: &1, has_prose: true}),
      assembled_at: DateTime.utc_now() |> DateTime.to_iso8601()
    }
  end

  # ── 捕获与序列化 ───────────────────────────────────────

  defp capture(prompt, label) do
    assert_ok(Gateway.execute(prompt, "capture-model", purpose: :planner), label)

    receive do
      {:icache_prompt, captured, _params} ->
        {serialize(captured), canonical(Map.get(captured, :tools, []))}
    after
      5_000 -> raise "capture provider did not receive #{label}"
    end
  end

  defp assert_ok({:ok, _}, _label), do: :ok
  defp assert_ok(other, label), do: raise("gateway failed for #{label}: #{inspect(other)}")

  # Fixed serialization from VS-00I §6.1: role + "\n" + content in order, then
  # canonical JSON tools at the end (map keys sorted).
  defp serialize(%{messages: messages} = prompt) do
    Enum.map_join(messages, "", fn message ->
      "#{message.role}\n#{message.content}"
    end) <> canonical(Map.get(prompt, :tools, []))
  end

  defp serialize(messages) when is_list(messages) do
    Enum.map_join(messages, "", fn message -> "#{message.role}\n#{message.content}" end)
  end

  defp canonical(map) when is_map(map) do
    keys = map |> Map.keys() |> Enum.sort_by(&to_string/1)

    "{" <>
      Enum.map_join(keys, ",", fn key ->
        Jason.encode!(to_string(key)) <> ":" <> canonical(Map.get(map, key))
      end) <> "}"
  end

  defp canonical(list) when is_list(list),
    do: "[" <> Enum.map_join(list, ",", &canonical/1) <> "]"

  defp canonical(value), do: Jason.encode!(value)

  defp shared_prefix_bytes(left, right) do
    left
    |> :binary.bin_to_list()
    |> Enum.zip(:binary.bin_to_list(right))
    |> Enum.take_while(fn {a, b} -> a == b end)
    |> length()
  end

  # ── 报告 ───────────────────────────────────────────────

  defp render_markdown(rows) do
    lines = [
      "# I-CACHE prefix sharing (VS-00I §6.1 measurement)",
      "",
      "Generated: #{DateTime.utc_now() |> DateTime.to_iso8601()}",
      "Provider: test-only capture at Gateway boundary (identity injected)",
      "",
      "| call_site | pair_kind | shared_prefix_bytes | total_bytes | ratio | boundary_bytes | required_covered |",
      "|---|---|---:|---:|---:|---:|---|"
    ]

    rows_md =
      Enum.map(rows, fn row ->
        "| #{row.call_site} | #{row.pair_kind} | #{row.shared_prefix_bytes} | " <>
          "#{row.total_bytes} | #{row.ratio} | #{row.boundary_bytes || "-"} | " <>
          "#{row.covers_required_prefix || "-"} |"
      end)

    Enum.join(lines ++ rows_md, "\n") <> "\n"
  end

  defp format_row(row) do
    "#{row.call_site} #{row.pair_kind}: #{row.shared_prefix_bytes}/#{row.total_bytes} (#{row.ratio})"
  end

  defp coverage_suffix(%{pair_kind: "call_pair", boundary_bytes: nil}), do: ""

  defp coverage_suffix(row) do
    " boundary=#{row.boundary_bytes} covered=#{row.covers_required_prefix} enforced=#{row.enforce}"
  end

  defp install_capture_provider do
    old_extra = Application.get_env(:novel_agent, :extra_providers)
    old_provider = Application.get_env(:novel_agent, :provider)

    extra =
      (old_extra || %{})
      |> Map.put(:icache_capture, CaptureProvider)

    Application.put_env(:novel_agent, :extra_providers, extra)
    Application.put_env(:novel_agent, :provider, default: :icache_capture)
    NovelAgent.Provider.RuntimeConfig.reset()

    fn ->
      NovelAgent.Provider.RuntimeConfig.reset()

      if old_extra,
        do: Application.put_env(:novel_agent, :extra_providers, old_extra),
        else: Application.delete_env(:novel_agent, :extra_providers)

      if old_provider,
        do: Application.put_env(:novel_agent, :provider, old_provider),
        else: Application.delete_env(:novel_agent, :provider)
    end
  end
end

ICachePrefixDriver.run()
