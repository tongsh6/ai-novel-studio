defmodule NovelAgent.Test.Provider.SliceVerify do
  @moduledoc """
  Deterministic provider for local slice verification.

  It returns planner-compatible deterministic outputs so Tauri slice journeys
  can verify the product chain without depending on an external LLM or the
  echo-only stub.
  """

  @behaviour NovelAgent.Provider

  alias NovelAgent.Provider.AdapterExecution
  alias NovelAgent.Provider.Result
  alias NovelAgent.Provider.StubChapterSummary
  alias NovelAgent.Provider.SystemIdentity
  alias NovelAgent.Provider.Usage

  @slow_work_switch_delay_ms 2_500
  @slow_work_switch_marker "SU02SLOW"
  # AU-12 档案并发读取：让一次普通对话 turn 故意慢，使外部 driver 能在执行期间打开作品档案。
  # 仅 test-support 慢延迟（不改生产 provider runtime），产出普通回复、不触发 slow_work_switch 语义。
  @archive_slow_delay_ms 6_000
  @archive_slow_marker "AU12SLOW"
  @agent_cancel_slow_delay_ms 3_000
  @agent_cancel_slow_marker "UA01CP6SLOW"
  @author_reasoning_chunk_delay_ms 25
  @garbage_json_marker "AU01GARBAGE"
  @invalid_frame_marker "AU01BADFRAME"
  @malformed_candidates_marker "AU02BADCANDIDATES"
  @candidate_context_marker "AU02CTX"
  @tool_failure_marker "AU04FAILTOOL"
  @provider_failure_marker "UA01PROVIDERFAIL"
  @awaiting_author_steer_marker "UA01AWAITSTEER"
  # B17 真实页面短验收：仅测试替身读取 harness env，令正文 writer 连续超时；
  # 作者点「先写第一场（500 字）」后 steer prompt 含缩小范围措辞，替身恢复成功。
  @writer_timeout_env "SLICE_VERIFY_WRITER_TIMEOUT"
  # B23 CP5 真实页面场景：仅测试替身读取 harness env，令判断循环判 plan、计划起草与
  # 首轮修订都只排只读步（无产出步）→ replan 预算耗尽后机械停等
  # `plan_exhausted_without_completion`；作者 steer 文本带「按已核对结果先出方案」
  # 时修订返回带产出步的正常计划，使同一 run 恢复完成。仅依据 env + prompt 文本，
  # 不识别 slice id；env 关闭时既有替身行为逐字节不变。
  @plan_exhaust_env "SLICE_VERIFY_PLAN_EXHAUST"
  @plan_exhaust_marker "UA01PLANEXHAUST"
  @plan_exhaust_steer_marker "按已核对结果先出方案"
  # B24 CP3 真实页面场景（判断循环内部翼全章可读）：仅当作者请求同时点名本场景
  # 章标题与「全章/核对/重复」措辞时启用。寻址必须复制判断 prompt 章节索引里的
  # 唯一 chapter_ref（seed 故意放了一章同名标题——标题查询只会歧义）；续读 query
  # 逐字取上一页观察 footer 的 JSON。仅依据 prompt 文本，不识别 slice id/env，
  # 其它场景 prompt 不命中时行为逐字节不变。
  @full_read_chapter_title "灰烬中的手印"
  @full_read_request_probes ["全章", "核对", "重复"]
  @full_read_last_page_anchor_marker "末页锚点"
  @full_read_footer_pattern ~r/【续读】剩余 \d+ 字符；用 (\{"chapter_ref":"chapter:[0-9a-f-]{36}","offset":\d+\}) 继续。/u

  defstruct []

  @impl true
  def complete(_state, _model, prompt, _params) do
    prompt_text = prompt_text(prompt)

    # D1 CP2：替身把收到的 prompt 落到 llm 日志目录（HTTP 层记录器在替身场景不落盘）——
    # 场景化验收由此获得 prompt 级外部证据（守则文案/阵容段是否真进 prompt）。
    # 仅 test/support 行为，产品零感知。
    log_received_prompt(prompt_text, prompt)
    maybe_delay_su02_slow_work_switch(prompt_text)
    maybe_delay_archive_slow(prompt_text)
    maybe_delay_agent_cancel(prompt_text)

    with :ok <- maybe_fail_provider_execution_prompt(prompt_text),
         :ok <- maybe_fail_tool_failure_prompt(prompt_text),
         :ok <- maybe_fail_summary_prompt(prompt_text),
         :ok <- maybe_fail_writer_timeout_prompt(prompt_text) do
      maybe_fail_plan_draft_prompt(prompt_text)
    end
    |> case do
      :ok ->
        {:ok, response_result(prompt, prompt_text)}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @impl true
  def execute(state, model, prompt, params, ctx) do
    initial_events = AdapterExecution.initial_events(ctx)
    AdapterExecution.emit_events(ctx, initial_events, :running)

    case complete(state, model, prompt, params) do
      {:ok, %Result{content: content} = result} ->
        chunk_events =
          AdapterExecution.text_chunk_events(ctx, content, length(initial_events) + 1)

        emit_chunk_events(ctx, chunk_events)

        {:ok, result}
        |> AdapterExecution.materialize_result(
          ctx,
          initial_events: initial_events ++ chunk_events,
          emit: :terminal
        )

      {:error, reason} ->
        {:error, reason}
        |> AdapterExecution.materialize_result(ctx,
          initial_events: initial_events,
          emit: :terminal
        )
    end
  end

  @impl true
  def health_check(_state), do: :ok

  @impl true
  def name, do: "slice_verify"

  defp emit_chunk_events(ctx, events) do
    Enum.each(events, fn event ->
      AdapterExecution.emit_events(ctx, [event], :running)
      maybe_delay_author_reasoning_chunk(ctx, event)
    end)
  end

  defp maybe_delay_author_reasoning_chunk(ctx, event) do
    if (Map.get(ctx, :purpose) in [:author_reasoning, "author_reasoning"] or
          ctx[:content_visibility] == :author) and
         is_binary(event.payload[:author_narrative_delta]) do
      Process.sleep(@author_reasoning_chunk_delay_ms)
    end
  end

  defp plan_prompt?(prompt) do
    String.contains?(prompt, "plan_goal_summary") or String.contains?(prompt, "proposed_actions")
  end

  defp agent_next_step_decision_prompt?(prompt) do
    String.contains?(prompt, "AgentRun 下一步规划器")
  end

  defp agent_plan_draft_prompt?(prompt) do
    String.contains?(prompt, "AgentRun 计划起草器")
  end

  defp agent_plan_revision_prompt?(prompt) do
    String.contains?(prompt, "AgentRun 计划修订器")
  end

  defp profile_routing_prompt?(prompt) do
    String.contains?(prompt, "AgentRun profile router") and
      String.contains?(prompt, "\"profile_ref\"")
  end

  defp creative_items_prompt?(prompt) do
    String.contains?(prompt, "JSON 数组") and String.contains?(prompt, "artifact_type：")
  end

  defp fact_inventory_prompt?(prompt) do
    String.contains?(prompt, "小说设定盘点助手") and
      String.contains?(prompt, "\"artifact_type\"") and
      String.contains?(prompt, "正文摘录")
  end

  defp tool_narration_prompt?(prompt) do
    String.contains?(prompt, "## 工具执行结果") and
      String.contains?(prompt, "请用 1-2 句自然中文")
  end

  defp maybe_fail_tool_failure_prompt(prompt_text) do
    if tool_failure_prompt?(prompt_text) and creative_items_prompt?(prompt_text) do
      {:error,
       %{
         type: :provider_error,
         message: "AU04FAILTOOL fixture provider failure"
       }}
    else
      :ok
    end
  end

  # 豁免内部机械准备类调用（路由/决策/计划起草/修订）：失败标记的设计缝是
  # 对话自身的回应（frame）调用——「作者消息正常进入运行，创作引擎调用失败，
  # 被吸收为安全回复」。路由是 Order 62 引入的 run 内第一调用，同类豁免。
  # D3：摘要生成定向失败注入——正文含 D3SUMFAIL（经章标题→创作主语进正文第二句）时
  # 仅摘要调用失败，writer/评审不受影响；断供自愈场景以此制造缺口。
  defp maybe_fail_summary_prompt(prompt_text) do
    if StubChapterSummary.prompt?(prompt_text) and String.contains?(prompt_text, "D3SUMFAIL") and
         not :persistent_term.get({__MODULE__, :d3_summary_failed_once}, false) do
      # 一次性失败（瞬态故障语义）：正文里的标记是永久的，若每次都失败，补做也会
      # 永远失败——真实病像（思考模型超时/退化）本就是瞬态的，补做正是它的解药。
      :persistent_term.put({__MODULE__, :d3_summary_failed_once}, true)
      {:error, %{type: :provider_error, message: "D3SUMFAIL summary generation failure"}}
    else
      :ok
    end
  end

  # D4：计划起草定向一次性失败（瞬态语义，D3 判例）——用户消息带 D4PLANFAIL 时
  # agent_plan_draft 首调失败、重试成功；其余调用族不受影响。
  defp maybe_fail_plan_draft_prompt(prompt_text) do
    if agent_plan_draft_prompt?(prompt_text) and String.contains?(prompt_text, "D4PLANFAIL") and
         not :persistent_term.get({__MODULE__, :d4_plan_failed_once}, false) do
      :persistent_term.put({__MODULE__, :d4_plan_failed_once}, true)
      {:error, %{type: :timeout, message: "D4PLANFAIL transient planner failure"}}
    else
      :ok
    end
  end

  defp maybe_fail_provider_execution_prompt(prompt_text) do
    if String.contains?(prompt_text, @provider_failure_marker) and
         not profile_routing_prompt?(prompt_text) and
         not agent_next_step_decision_prompt?(prompt_text) and
         not agent_plan_draft_prompt?(prompt_text) and
         not agent_plan_revision_prompt?(prompt_text) do
      {:error,
       %{
         type: :provider_error,
         message: "UA01PROVIDERFAIL raw provider failure payload"
       }}
    else
      :ok
    end
  end

  defp usage_for(prompt_text, content) do
    input_tokens = prompt_text |> String.length() |> div(8) |> max(1)
    output_tokens = content |> String.length() |> div(6) |> max(1)

    Usage.new(input_tokens, output_tokens, "slice-verify-model", 0)
  end

  @quality_eval_fail_marker "VS00EEVALFAIL"
  # 中文降级标记：放进章节摘要时不会被 opening_body 的随机标识符回显（random_identifier_tokens
  # 只取字母数字混合 token），因此能进入 evaluator prompt 触发降级，却不污染用户可见正文。
  @quality_eval_fail_marker_cn "评审故障演练"

  defp quality_evaluator_prompt?(prompt) do
    String.contains?(prompt, "质量评审") and String.contains?(prompt, "findings")
  end

  # 默认空 findings（评审完成、无语义问题）；形式分析器召回 action-beat 候选时，由本
  # test-support evaluator 确认为机械重复；prompt 含 fail-marker 时返回非法 JSON →
  # evaluator 两次解析失败 → review_status unavailable（复现诚实降级）。
  defp quality_evaluator_response(prompt) do
    cond do
      String.contains?(prompt, @quality_eval_fail_marker) or
          String.contains?(prompt, @quality_eval_fail_marker_cn) ->
        "evaluator 故意返回的非 JSON 文本 #{@quality_eval_fail_marker}"

      # 判断②改进闭环（CP3b）：writer 修正稿带修正指纹——复评放行（确定性改进语义）。
      String.contains?(prompt, "已为规则变化补上对应代价") ->
        Jason.encode!(%{"findings" => []})

      quality_confirm_prompt?(prompt) ->
        Jason.encode!(%{
          "findings" => [
            %{
              "quality_finding_id" => "qf_slice_rule_conflict",
              "quality_gate_ref" => "quality_gate.rule_consistency",
              "validator_ref" => "slice_verify.rule_conflict_confirm",
              "severity" => "high",
              "action" => "confirm",
              "summary" => "正文包含违反既有规则且需要作者确认的设定变化。",
              "reasoning" => "正文明确取消了已确认规则要求的代价。",
              "evidence_spans" => [
                %{
                  "text" => "无需代价，违反既有规则",
                  "location" => "规则变化所在句",
                  "sentence_start" => 1,
                  "sentence_end" => 1
                }
              ],
              "impact_scope" => "paragraph",
              "revision_scope" => "paragraph",
              "brief_field_refs" => [],
              "confidence" => 0.91,
              "suggested_revision" => %{"instruction" => "补回规则代价或交由作者确认。"}
            }
          ]
        })

      intentional_rhetoric_candidate_prompt?(prompt) ->
        Jason.encode!(%{"findings" => []})

      narrative_pacing_mismatch_prompt?(prompt) ->
        Jason.encode!(%{
          "findings" => [
            %{
              "quality_finding_id" => "qf_slice_narrative_pacing",
              "quality_gate_ref" => "quality_gate.pacing",
              "validator_ref" => "validator.narrative_pacing_fit",
              "severity" => "warn",
              "action" => "adoption_review",
              "summary" => "本章承担主线推进，但正文停留在静态环境与重复动作，缺少计划要求的证据争夺。",
              "reasoning" => "章节方向要求夺回黑账证据并推动主线；正文四句都没有发生选择、阻力、信息释放或局面变化，实际叙事密度与章功能不匹配。",
              "evidence_spans" => [
                %{
                  "text" => "雨落在窗沿。灯影缓慢地移过旧墙。他反复擦拭那枚已经干净的杯子。钟声响过三次，房间里仍然没有新的决定。",
                  "sentence_start" => 1,
                  "sentence_end" => 4
                }
              ],
              "impact_scope" => "chapter",
              "revision_scope" => "chapter",
              "brief_field_refs" => [
                "chapter_direction.chapter_role",
                "chapter_direction.plot_progress",
                "reader_effect_brief"
              ],
              "confidence" => 0.9,
              "suggested_revision" => %{
                "instruction" => "重排整章，使证据争夺、人物选择和信息释放形成可见推进。"
              }
            }
          ]
        })

      mechanical_form_candidate_prompt?(prompt) ->
        candidate_id = form_candidate_id(prompt)

        Jason.encode!(%{
          "findings" => [
            %{
              "quality_finding_id" => "qf_#{candidate_id}",
              "candidate_id" => candidate_id,
              "quality_gate_ref" => "quality_gate.style_fit",
              "validator_ref" => "validator.sentence_rhythm_uniformity",
              "severity" => "warn",
              "action" => "warn",
              "summary" => "连续动作句使用相同句首和标点骨架，且没有形成强度或后果递进。",
              "reasoning" => "这些句子都只陈述一个动作；重复没有承担排比、仪式感或情绪升级功能。",
              "evidence_spans" => [
                %{
                  "text" => "他猛地侧身。他一刀劈下。他反手格挡。",
                  "sentence_start" => 1,
                  "sentence_end" => 3
                }
              ],
              "impact_scope" => "local",
              "revision_scope" => "local",
              # B11D（质量场粒度）：指向本章计划第 2 场（矿区撤退）的情绪迁移；
              # 服务端按 brief scene_N 白名单归因，不采信自造场 id。
              "brief_field_refs" => ["scene_2.emotion_transition"],
              "confidence" => 0.88,
              "suggested_revision" => %{
                "instruction" => "只改命中句段，让动作在风险、后果或视角上形成递进。"
              }
            }
          ]
        })

      true ->
        Jason.encode!(%{"findings" => []})
    end
  end

  defp mechanical_form_candidate_prompt?(prompt) do
    String.contains?(prompt, "detector.sentence_structure_uniformity") and
      String.contains?(prompt, "他猛地侧身")
  end

  defp intentional_rhetoric_candidate_prompt?(prompt) do
    String.contains?(prompt, "刻意排比演练") and
      String.contains?(prompt, "detector.sentence_structure_uniformity") and
      String.contains?(prompt, "他要活着")
  end

  defp narrative_pacing_mismatch_prompt?(prompt) do
    String.contains?(prompt, "章节节奏错配演练") and
      String.contains?(prompt, "\"chapter_role\":\"主线推进章\"") and
      String.contains?(prompt, "雨落在窗沿")
  end

  defp form_candidate_id(prompt) do
    case Regex.run(~r/"candidate_id":"([^"]+)"/u, prompt) do
      [_, candidate_id] -> candidate_id
      _ -> "fc_slice_action"
    end
  end

  defp quality_confirm_prompt?(prompt) do
    String.contains?(prompt, "无需代价") and String.contains?(prompt, "违反既有规则")
  end

  defp response_result(prompt, prompt_text) do
    cond do
      continuation_prompt?(prompt_text) ->
        continuation_result(prompt, prompt_text)

      judgment_prompt?(prompt_text) ->
        judgment_result(prompt, prompt_text)

      StubChapterSummary.prompt?(prompt_text) ->
        Result.new(StubChapterSummary.body(prompt_text))

      true ->
        non_judgment_response_result(prompt, prompt_text)
    end
  end

  # VS-00F CP1（AU-13）+ B27 CP3d：章摘要确定性四栏唯一真源在
  # `NovelAgent.Provider.StubChapterSummary`（stub 与 SliceVerify 共用，避免双份漂移）。
  # B26 判断①：一次 auto 响应同时给出公开文本与可选原生工具。
  defp judgment_result(_prompt, prompt_text) do
    input = judgment_author_input(prompt_text)

    cond do
      plan_protocol_mode(input) != nil ->
        plan_protocol_judgment(input)

      String.contains?(input, "把已有角色的叙事身份从配角改为主角") ->
        narrative = "当前工具没有修改已有角色主档案叙事身份的能力；角色演化只写演化记录，不能代替身份修改。可以先讨论调整方案，原档案保持不变。"

        Result.new(narrative, nil,
          tool_calls: [
            %{
              name: "report_capability_gap",
              arguments: %{
                dialogue_goal: input,
                missing_effect: "修改已有角色主档案的叙事身份",
                author_reasoning: narrative
              }
            }
          ]
        )

      String.contains?(input, "结尾有两个方向，先让我选择") ->
        Result.new("结尾要保留悬念，还是当章收束？", nil,
          tool_calls: [
            %{
              name: "ask_author",
              arguments: %{
                question: "结尾要保留悬念，还是当章收束？",
                options: [
                  %{value: "keep", label: "保留悬念", recommended: true},
                  %{value: "close", label: "当章收束"},
                  %{value: "custom", label: "自行补充", kind: "free_text"}
                ]
              }
            }
          ]
        )

      String.contains?(input, "结尾还没想清楚，请先问我一个问题") ->
        Result.new("你希望读者在结尾留下怎样的感受？", nil,
          tool_calls: [
            %{
              name: "ask_author",
              arguments: %{
                question: "你希望读者在结尾留下怎样的感受？",
                options: []
              }
            }
          ]
        )

      true ->
        regular_judgment_result(prompt_text)
    end
  end

  # B26：三种模型计划响应仅由外部验收替身提供，产品不识别这些措辞。
  defp plan_protocol_mode(text) do
    Enum.find(["同批计划", "另行起草计划", "先核对再补齐计划"], &String.contains?(text, &1))
  end

  defp plan_protocol_judgment(input) do
    packet = plan_protocol_packet(:complete)

    decision = %{
      name: "judgment_decision",
      arguments: %{action: "plan", dialogue_goal: input, reason: packet.reasoning}
    }

    calls =
      if plan_protocol_mode(input) == "同批计划",
        do: [decision, agent_plan_tool_call("agent_plan_draft", packet)],
        else: [decision]

    Result.new(packet.reasoning, nil, tool_calls: calls)
  end

  defp plan_protocol_packet(stage) do
    context =
      plan_step("context_assemble", "explore", "核对已有作品材料。", ["context_observation_created"])

    creative = [
      plan_step("character_design", "act", "提出角色设计候选。", ["tentative_character_created"]),
      plan_step("world_building", "act", "围绕角色提出世界设定候选。", ["tentative_setting_created"])
    ]

    %{
      reasoning: "先核对作品材料，再设计角色和相关世界设定，全部产出留待作者采纳。",
      steps: if(stage == :short, do: [context], else: [context | creative]),
      reason_codes: [if(stage == :revision, do: "agent_plan_revised", else: "agent_plan_drafted")]
    }
  end

  defp regular_judgment_result(prompt_text) do
    result = judgment_decision_result(prompt_text)
    narrative = judgment_narrative_result(prompt_text).content

    case result.tool_calls do
      [call] -> single_judgment_output(call["arguments"], narrative, result)
      _ -> result
    end
  end

  # 验收替身按既有场景的语义裁决构造新协议，一次调用返回全部字节。
  defp single_judgment_output(args, text, result) do
    {name, payload} = single_fixture_operation(args, text)

    calls =
      if name, do: [%{"id" => "call_#{name}", "name" => name, "arguments" => payload}], else: []

    calls = fixture_conflicting_calls(calls, args)
    %{result | content: text, tool_calls: calls}
  end

  defp fixture_conflicting_calls(
         calls,
         %{"author_content_registration" => true, "action" => "execute"} = args
       ) do
    {name, payload} = single_fixture_decision(args)
    calls ++ [%{"id" => "conflicting-execute", "name" => name, "arguments" => payload}]
  end

  defp fixture_conflicting_calls(calls, %{"record_only" => true}) when calls != [],
    do: calls ++ calls

  defp fixture_conflicting_calls(calls, _), do: calls

  defp single_fixture_operation(args, text) do
    cond do
      args["author_content_registration"] == true ->
        {"register_author_content",
         %{
           author_content_source_ref: args["author_content_source_ref"],
           dialogue_goal: args["dialogue_goal"] || "登记原文",
           author_reasoning: text
         }}

      args["action"] == "await_author" ->
        {"ask_author", %{question: text, options: []}}

      args["action"] == "reply" ->
        single_fixture_reply(args, text)

      true ->
        single_fixture_decision(args)
    end
  end

  defp single_fixture_reply(args, text) do
    cond do
      args["candidate_directions"] not in [nil, []] ->
        {"propose_creative_directions",
         %{
           candidate_directions:
             Enum.map(
               args["candidate_directions"],
               &fixture_direction/1
             ),
           author_reasoning: text
         }}

      args["frame_type"] == "capability_gap" ->
        {"report_capability_gap",
         %{
           dialogue_goal: args["dialogue_goal"] || "当前创作请求",
           missing_effect: text,
           author_reasoning: text
         }}

      true ->
        {nil, %{}}
    end
  end

  defp fixture_direction(direction) do
    direction
    |> Map.new(fn {key, value} -> {to_string(key), value} end)
    |> Map.take(["title", "pitch", "tone_tags"])
  end

  defp single_fixture_decision(args) do
    filtered =
      Map.take(
        args,
        ~w(action reason dialogue_goal capability explore_request pending_artifact_ref adopted_content_ref)
      )

    filtered =
      if args["action"] != "execute", do: Map.delete(filtered, "capability"), else: filtered

    {"judgment_decision", Map.put_new(filtered, "dialogue_goal", "推进当前创作请求")}
  end

  # 判断②（ADR-0025 CP3a）：单调用续行——计划耗尽（D6 语义）判 continue
  # 补产出步；其余偏离（质量/门禁/缺章/工具故障）裁决权在作者，判 await_author。
  defp maybe_fail_writer_timeout_prompt(prompt_text) do
    if System.get_env(@writer_timeout_env) == "1" and prose_fragment_prompt?(prompt_text) and
         not writer_timeout_retry_prompt?(prompt_text) do
      {:error, %{type: :timeout, message: "fixture writer timeout"}}
    else
      :ok
    end
  end

  defp writer_timeout_retry_prompt?(text) do
    String.contains?(text, "先只写当前章的第一个场景") or
      String.contains?(text, "500 字以内；写完就停")
  end

  defp continuation_prompt?(text),
    do: String.contains?(text, "你的两种续行方式") or String.contains?(text, "continuation_decision")

  defp continuation_result(_prompt, text) do
    if String.contains?(continuation_goal(text), "同步到发布平台") and
         String.contains?(text, "工具 prose_writing 执行失败") do
      narrative = "本次正文生成未完成，当前也没有同步到发布平台的能力。可以先保留现有作品，在支持的范围内重新调整目标。"

      Result.new(narrative, nil,
        tool_calls: [
          %{
            name: "report_capability_gap",
            arguments: %{
              dialogue_goal: continuation_goal(text),
              missing_effect: "同步到发布平台",
              author_reasoning: narrative
            }
          }
        ]
      )
    else
      regular_continuation_result(text)
    end
  end

  defp continuation_goal(text) do
    case Regex.run(~r/## 当前目标\s*\n(.*?)\n## 偏离事实/su, text) do
      [_, goal] -> goal
      _ -> ""
    end
  end

  defp continuation_retry_requested?(text),
    do: String.contains?(continuation_goal(text), "按原目标重试一次")

  defp regular_continuation_result(text) do
    {action, guidance} =
      if writer_timeout_fixture?(),
        do: {"continue", "先拆成场景，缩小单次范围后再生成。"},
        else: continuation_decision(text)

    narrative = continuation_narrative(text)

    {name, args} =
      if action == "continue",
        do:
          {"continuation_decision", %{action: "continue", guidance: guidance, reason: narrative}},
        else: {"ask_author", %{question: narrative, options: []}}

    Result.new(narrative, nil, tool_calls: [%{name: name, arguments: args}])
  end

  defp writer_timeout_fixture?, do: System.get_env(@writer_timeout_env) == "1"

  defp plan_exhaust_fixture?, do: System.get_env(@plan_exhaust_env) == "1"

  defp continuation_decision(text) do
    cond do
      continuation_retry_requested?(text) ->
        {"continue", "按作者刚给出的回复，保持原目标和范围重试一次。"}

      String.contains?(text, "计划步骤已走完") ->
        {"continue", "补足正文产出步，按原目标继续生成草稿。"}

      # 工具故障 / 门禁 / 缺章等：裁决权在作者。必须优先于泛化的
      # “质量复核”字样——D4 门禁 summary 也可能带计划步描述里的质量复核。
      String.contains?(text, "Orchestrator 未允许执行") or
          String.contains?(text, "工具 prose_writing 执行失败") ->
        {"await_author", ""}

      # 质量复核 finding 可由指引修正 → 改进闭环（中间稿将被替代）。
      String.contains?(text, "质量复核") ->
        {"continue", "按质量意见修正后重新产出草稿。"}

      true ->
        {"await_author", ""}
    end
  end

  defp continuation_narrative(text) do
    cond do
      continuation_retry_requested?(text) ->
        "你已要求按原目标重试，我会保持原范围再执行一次。"

      String.contains?(text, "工具 prose_writing 执行失败") ->
        "正文生成失败，还没有可采纳的正文草稿。你希望重试，还是调整这次目标？"

      String.contains?(text, "计划步骤已走完") ->
        "计划走完但正文还没有产出，我会补上产出步继续完成这轮草稿。"

      String.contains?(text, "质量复核") ->
        "质量复核提出了需要处理的意见，我会按意见修正后重新交付这轮草稿。"

      true ->
        "这个情况需要你裁决，我先停下来，草稿与说明都保留在这轮记录里。"
    end
  end

  # WR01 写前推理步：forced tool call 产本章使命；依据只取 prompt 材料里列名的 ref，
  # 并刻意多给一条越界依据（模型常见失误形态），由 app 侧绑定过滤机械丢弃。
  defp non_judgment_response_result(prompt, prompt_text) do
    if chapter_mission_prompt?(prompt_text) and NovelAgent.Provider.tool_call_prompt?(prompt) do
      chapter_mission_result(prompt, prompt_text)
    else
      plan_or_default_response_result(prompt, prompt_text)
    end
  end

  defp plan_or_default_response_result(prompt, prompt_text) do
    cond do
      agent_plan_revision_prompt?(prompt_text) and NovelAgent.Provider.tool_call_prompt?(prompt) ->
        agent_plan_revision_result(prompt_text)

      agent_plan_draft_prompt?(prompt_text) and NovelAgent.Provider.tool_call_prompt?(prompt) ->
        agent_plan_draft_result(prompt_text)

      true ->
        content = response_content(prompt, prompt_text)
        Result.new(content, usage_for(prompt_text, content))
    end
  end

  # ── WR01 写前推理替身 ──
  # 按真实 prompt 材料中列名的 [ref] 产本章使命（不发明依据；材料为空时只给 statement）。
  defp chapter_mission_prompt?(text),
    do: String.contains?(text, "写前推理器") or String.contains?(text, "规划前推理器")

  defp chapter_mission_result(prompt, text) do
    refs =
      ~r/\[([a-z_]+:[^\]\s]+)\]/u
      |> Regex.scan(text)
      |> Enum.map(fn [_, ref] -> ref end)
      |> Enum.uniq()

    foreshadow = Enum.find(refs, &String.contains?(&1, ":foreshadow_"))
    arc = Enum.find(refs, &String.starts_with?(&1, "ledger:arc:"))
    plan = Enum.find(refs, &String.starts_with?(&1, "plan:"))
    secrecy = Enum.find(refs, &String.contains?(&1, ":plan_info_"))

    must_advance = mission_must_advance(foreshadow, arc, plan)

    must_avoid =
      [
        secrecy && %{"text" => "不得提前揭示后续章的计划信息。", "basis_ref" => secrecy},
        # 越界依据（材料里没有这个 ref）：app 侧 ChapterMission.bind/2 必须机械丢弃。
        %{"text" => "不得回收一条并不存在的伏笔。", "basis_ref" => "ledger:information:foreshadow_unlisted"}
      ]
      |> Enum.reject(&(&1 in [nil, false]))

    planning? = String.contains?(text, "规划前推理器")
    reasoning = mission_reasoning(planning?, foreshadow, arc)
    statement = mission_statement(planning?, foreshadow)

    Result.new(reasoning, nil,
      tool_calls: [
        %{
          "name" => NovelAgent.Provider.tool_choice(prompt) || "chapter_mission",
          "arguments" => %{
            "author_reasoning" => reasoning,
            "statement" => statement,
            "must_advance" => must_advance,
            "must_avoid" => must_avoid,
            "confidence" => 0.9
          }
        }
      ]
    )
  end

  defp mission_must_advance(foreshadow, arc, plan) do
    [
      foreshadow && %{"text" => "推进这条到期伏笔的回收线，让线索在本章兑现。", "basis_ref" => foreshadow},
      arc && %{"text" => "让停滞角色在本章重新入场并推动其弧光。", "basis_ref" => arc},
      plan && %{"text" => "按本章计划完成既定情节推进。", "basis_ref" => plan}
    ]
    |> Enum.reject(&(&1 in [nil, false]))
    |> Enum.take(3)
  end

  defp mission_reasoning(planning?, foreshadow, arc) do
    "[stub] 我核对了#{if planning?, do: "账面与全书进度", else: "本章计划与作品脉络"}：" <>
      if(foreshadow, do: "有一条到期未回收的伏笔；", else: "没有到期的伏笔压力；") <>
      if(arc, do: "有角色弧光停滞待回归；", else: "弧光无停滞；") <>
      if(planning?,
        do: "这批章先安排回收与回归，不提前收官。",
        else: "本章只推进上述线索，不提前揭示后续计划。"
      )
  end

  defp mission_statement(true, foreshadow) when not is_nil(foreshadow),
    do: "接下来的章节必须给到期伏笔安排回收，并让停滞角色重新入场。"

  defp mission_statement(true, _foreshadow),
    do: "接下来的章节按既有计划推进，不引入新的主导冲突。"

  defp mission_statement(false, foreshadow) when not is_nil(foreshadow),
    do: "本章必须推进到期伏笔的回收，并让停滞角色回到情节中。"

  defp mission_statement(false, _foreshadow),
    do: "本章按计划推进，不引入新的主导冲突。"

  defp response_content(prompt, prompt_text) do
    cond do
      # VS-00E：独立质量 evaluator 的 prompt（含「质量评审」+「findings」，无正文三锚点）。
      # 默认返回空 findings；局部形式候选需由本 evaluator 明确确认后才能进入 finding。
      # 带 fail-marker 时返回非法 JSON 以复现 evaluator 降级。仅 test-support，不进生产 runtime。
      quality_evaluator_prompt?(prompt_text) ->
        quality_evaluator_response(prompt_text)

      garbage_json_prompt?(prompt) ->
        "not valid json {{{ AU01GARBAGE raw provider payload"

      invalid_frame_prompt?(prompt) ->
        invalid_frame_response() |> Jason.encode!()

      malformed_candidates_prompt?(prompt) ->
        malformed_candidates_response() |> Jason.encode!()

      true ->
        structured_response_content(prompt, prompt_text)
    end
  end

  defp structured_response_content(prompt, prompt_text) do
    cond do
      fact_inventory_prompt?(prompt_text) ->
        fact_inventory_response(prompt_text) |> Jason.encode!()

      creative_items_prompt?(prompt_text) ->
        creative_items_response(prompt_text) |> Jason.encode!()

      profile_routing_prompt?(prompt_text) ->
        profile_routing_response(prompt_text) |> Jason.encode!()

      agent_next_step_decision_prompt?(prompt_text) ->
        agent_next_step_decision_response(prompt_text)

      plan_prompt?(prompt_text) ->
        plan_response(prompt_text) |> Jason.encode!()

      tool_narration_prompt?(prompt_text) ->
        tool_narration_response(prompt_text)

      true ->
        frame_response(prompt) |> Jason.encode!()
    end
  end

  # SC-AU14-B1：test-support provider 只根据真实盘点 prompt 返回确定性 canonical items；
  # 产品 runtime 不识别 slice id，也不自动触发/采纳。外部 driver 仍需从真实档案入口点击，
  # 并让 production FactInventoryService 完成校验、分组与逐项采纳边界。
  # CP4d：prompt 请求全书规划建议（只列缺位字段）时，按请求附带对应建议——
  # 与真实模型同语义：只响应 prompt 中列出的缺位字段。
  defp fact_inventory_response(prompt_text) do
    cond do
      foreshadow_resolution_prompt?(prompt_text) ->
        foreshadow_resolution_proposal(prompt_text)

      known_character_reproposal_prompt?(prompt_text) ->
        duplicate_character_reproposal()

      alias_reproposal_prompt?(prompt_text) ->
        alias_character_reproposal()

      true ->
        fact_inventory_base_response() ++ skeleton_suggestions(prompt_text)
    end
  end

  # VS00F 刀④ CP3：桩按真实 prompt 的「未回收伏笔核对」段产回收提案——
  # resolution_target 原样取自段内账面引用（不认 slice id）；模型只提议，
  # 采纳边界与落账由 production 完成。
  defp foreshadow_resolution_prompt?(prompt_text) do
    String.contains?(prompt_text, "未回收伏笔核对") and
      String.contains?(prompt_text, "[foreshadow_")
  end

  defp foreshadow_resolution_proposal(prompt_text) do
    case Regex.run(~r/- \[(foreshadow_[^\]]+)\] (?:伏笔：)?([^\n]+)/u, prompt_text) do
      [_, ref, label] ->
        [
          %{
            artifact_type: "foreshadowing_resolution",
            item_id: "inventory-resolution-1",
            title: String.trim(label),
            body: "第2章正文中该伏笔已当面兑现，线索完成回收。",
            rationale: "依据第02章",
            resolution_target: ref,
            resolved_at_seq: 2
          }
        ]

      _ ->
        fact_inventory_base_response()
    end
  end

  # M4 实锤的真实模型行为：盘点 prompt 已列出「作品档案中已登记的角色（不要重复提案）」，
  # 模型仍会把已在档角色当成「新发现」重新提案。此处照抄该行为，让采纳边界的同名裁决
  # （require_confirmation）成为可被外部验收的后果。分支只看真实产品状态（prompt 里
  # 是否出现已在档角色段），不认识任何 slice id。
  defp known_character_reproposal_prompt?(prompt_text) do
    String.contains?(prompt_text, "作品档案中已登记的角色") and
      String.contains?(prompt_text, "沈砚")
  end

  defp duplicate_character_reproposal do
    [
      %{
        artifact_type: "character_seed",
        item_id: "inventory-shenyan-repropose",
        title: "沈砚",
        body: "城西旧机房的老维修工，与追查账单的年轻人同名，两人此前从未照面。",
        rationale: "依据第02章",
        narrative_role: "MINOR"
      }
    ]
  end

  # AU12 CP3：M4 同名重提行为的别名变体——已在档名单里明确列了别名，模型仍把
  # 别名当新人物重提。分支只看真实产品状态（prompt 已在档段落里出现该别名），
  # 让采纳边界的别名命中确认（点名「它是谁的别名」）成为可被外部验收的后果。
  defp alias_reproposal_prompt?(prompt_text) do
    String.contains?(prompt_text, "作品档案中已登记的角色") and
      String.contains?(prompt_text, "洛公子")
  end

  defp alias_character_reproposal do
    [
      %{
        artifact_type: "character_seed",
        item_id: "inventory-luogongzi-repropose",
        title: "洛公子",
        body: "黑市情报线上活跃的神秘人物，与账单追查者关系密切。",
        rationale: "依据第01章",
        narrative_role: "SUPPORTING"
      }
    ]
  end

  # 只对 prompt 里真正列为缺位的规划字段产建议（与真实模型同语义）；未列出的字段
  # 不越权建议。这里回应其中两条，足以让候选组形态（多条建议单选）成立。
  defp skeleton_suggestions(prompt_text) do
    if String.contains?(prompt_text, "work_skeleton_suggestion") do
      [
        {"target_length：目标总字数",
         %{
           artifact_type: "work_skeleton_suggestion",
           item_id: "inventory-skeleton-target-length",
           title: "目标体量",
           body: "按前两章的叙事节奏与单章体量推断，全书目标约 30 万字。",
           rationale: "依据第01-02章体量",
           skeleton_field: "target_length",
           skeleton_value: 300_000
         }},
        {"planned_volumes：预计卷数",
         %{
           artifact_type: "work_skeleton_suggestion",
           item_id: "inventory-skeleton-planned-volumes",
           title: "预计卷数",
           body: "按账单线与残诀线的两段结构推断，全书预计 6 卷。",
           rationale: "依据第01-02章结构",
           skeleton_field: "planned_volumes",
           skeleton_value: 6
         }}
      ]
      |> Enum.filter(fn {field_line, _suggestion} ->
        String.contains?(prompt_text, field_line)
      end)
      |> Enum.map(fn {_field_line, suggestion} -> suggestion end)
    else
      []
    end
  end

  defp fact_inventory_base_response do
    [
      %{
        artifact_type: "character_seed",
        item_id: "inventory-shenyan",
        title: "沈砚",
        body: "追查灵气账单异常的核心视角人物。",
        rationale: "依据第01章",
        narrative_role: "PROTAGONIST",
        role: "底层灵气缴费者出身的调查者",
        aliases: ["砚哥"]
      },
      %{
        artifact_type: "character_seed",
        item_id: "inventory-yunqi",
        title: "云栖",
        body: "把残诀交给沈砚并提示旧服务器线索的关键配角。",
        rationale: "依据第02章",
        narrative_role: "SUPPORTING"
      },
      %{
        artifact_type: "world_rule_seed",
        item_id: "inventory-frequency-billing",
        title: "灵气按频段计费",
        body: "城市灵气由公司按频段计费，欠费后会被停灵。",
        rationale: "依据第01章"
      },
      %{
        artifact_type: "foreshadowing_seed",
        item_id: "inventory-missing-manual",
        title: "残诀后半卷",
        body: "旧服务器里的残诀缺失后半卷，去向尚未揭示。",
        rationale: "依据第02章"
      }
    ]
  end

  defp agent_plan_draft_result(prompt) do
    packet = agent_plan_draft_packet(prompt)
    reasoning = Map.fetch!(packet, :reasoning)

    Result.new(reasoning, usage_for(prompt, reasoning),
      tool_calls: [agent_plan_tool_call("agent_plan_draft", packet)]
    )
  end

  defp agent_plan_revision_result(prompt) do
    packet = agent_plan_revision_packet(prompt)
    reasoning = Map.fetch!(packet, :reasoning)

    Result.new(reasoning, usage_for(prompt, reasoning),
      tool_calls: [agent_plan_tool_call("agent_plan_revision", packet)]
    )
  end

  defp agent_plan_revision_packet(prompt) do
    profile_ref = agent_plan_profile_ref(prompt)

    cond do
      plan_protocol_mode(agent_plan_author_goal(prompt)) != nil ->
        plan_protocol_packet(:revision)

      plan_exhaust_revision?(profile_ref, prompt) ->
        plan_exhaust_revision_packet(prompt)

      profile_ref == "prose_drafting_with_quality_v1" and
          String.contains?(prompt, "UA01NOPROGRESS") ->
        prose_no_progress_agent_plan_packet(:revision)

      true ->
        prompt
        |> String.replace("UA01D6REPLAN", "")
        |> agent_plan_draft_packet()
        |> Map.update!(:reasoning, &String.replace(&1, "起草", "修订"))
        |> Map.update!(:reason_codes, fn codes ->
          ["agent_plan_revised" | Enum.reject(codes, &(&1 == "agent_plan_drafted"))]
          |> Enum.uniq()
        end)
    end
  end

  # B23 CP5 fixture：判断循环计划修订的两个确定性样本（同一 env+marker 门的两种
  # 形态）——首轮修订仍全只读；作者 steer（目标里带补充标记）后保留只读前缀并
  # 追加产出步，让 cursor 从 3 继续到产出步并真正完成（仍是同一 run）。
  defp plan_exhaust_revision?(profile_ref, prompt) do
    profile_ref == "judgment_plan_v1" and plan_exhaust_fixture?() and
      String.contains?(prompt, @plan_exhaust_marker)
  end

  defp plan_exhaust_revision_packet(prompt) do
    if String.contains?(prompt, @plan_exhaust_steer_marker) do
      plan_exhaust_resume_packet()
    else
      plan_exhaust_readonly_packet(:revision)
    end
  end

  defp agent_plan_draft_packet(prompt) do
    profile_ref = agent_plan_profile_ref(prompt)

    case plan_protocol_mode(agent_plan_author_goal(prompt)) do
      "先核对再补齐计划" -> plan_protocol_packet(:short)
      nil -> agent_plan_draft_packet_for_fixture(profile_ref, prompt)
      _ -> plan_protocol_packet(:complete)
    end
  end

  # fixture 分支拆出主函数，避免协议模式判断与夹具判定混在一个 cond 里（复杂度门禁）。
  defp agent_plan_draft_packet_for_fixture(profile_ref, prompt) do
    cond do
      # B23 CP5 fixture：判断①判 plan 后的首次计划起草只排只读步（无产出步）。
      profile_ref == "judgment_plan_v1" and plan_exhaust_fixture?() and
          String.contains?(prompt, @plan_exhaust_marker) ->
        plan_exhaust_readonly_packet(:draft)

      profile_ref == "prose_drafting_with_quality_v1" and
          String.contains?(prompt, "UA01D6REPLAN") ->
        prose_d6_agent_plan_packet()

      profile_ref == "prose_drafting_with_quality_v1" and
          String.contains?(prompt, "UA01NOPROGRESS") ->
        prose_no_progress_agent_plan_packet(:draft)

      true ->
        agent_plan_draft_packet_for_profile(profile_ref, prompt)
    end
  end

  # B23 CP5：只读计划（context_assemble + 2 个探索步，无产出步）。计划走完后
  # completion_ready? 为假 → 修订一次（仍只读）→ 修订预算耗尽 → 机械停等作者。
  defp plan_exhaust_readonly_packet(stage) do
    {reasoning, reason_codes} =
      case stage do
        :draft ->
          {"先把第01章正文、章节大纲与主角状态相关的材料读一遍，核对清楚再决定产出。",
           ["agent_plan_drafted", "judgment_plan_drafted"]}

        :revision ->
          {"上一轮只完成只读核对，目标产出还未生成；我再核对一遍目标章节的材料，避免在信息不足时产出。",
           ["agent_plan_revised", "judgment_plan_drafted"]}
      end

    %{
      reasoning: reasoning,
      steps: [
        plan_step("context_assemble", "explore", "读取当前作品上下文与第01章正文线索。", [
          "context_observation_created"
        ]),
        exploration_plan_step(
          "prose_search",
          "检索第01章正文的既有内容。",
          "第01章"
        ),
        exploration_plan_step(
          "chapter_read",
          "读取第01章的设计计划、摘要与正文。",
          "第01章"
        )
      ],
      reason_codes: reason_codes
    }
  end

  # B23 CP5：作者 steer 后的修订计划——保留已完成的 3 个只读前缀步（cursor=3 已
  # 越过），追加 1 个产出步（plot_outline）让同一 run 继续并完成；不重新读取、不
  # 新建 run、不自动采纳。
  defp plan_exhaust_resume_packet do
    %{
      reasoning: "按已核对结果先出方案：保留已完成的只读核对，追加章节大纲产出步。",
      steps: [
        plan_step("context_assemble", "explore", "读取当前作品上下文与第01章正文线索。", [
          "context_observation_created"
        ]),
        exploration_plan_step(
          "prose_search",
          "检索第01章正文的既有内容。",
          "第01章"
        ),
        exploration_plan_step(
          "chapter_read",
          "读取第01章的设计计划、摘要与正文。",
          "第01章"
        ),
        plan_step("plot_outline", "act", "按已核对结果先出章节大纲方案。", [
          "tentative_outline_draft_created"
        ])
      ],
      reason_codes: ["agent_plan_revised", "judgment_plan_drafted"]
    }
  end

  defp exploration_plan_step(target_tool_ref, description, query) do
    target_tool_ref
    |> plan_step("explore", description, ["exploration_observation_created"])
    |> Map.put(:exploration_query, query)
  end

  # 无进展空转（真实弱模型失败形态的确定性复刻）：起草只排"读上下文"一步；计划走完
  # 回应未生成触发修订后，修订没有补足新步骤，只是把同一件事再排一遍。runtime 应以
  # progress_signature 重复判停（awaiting_author + no_progress），而不是无限空转。
  # 无进展空转（判断纪元：诱导于 prose 创作 profile——真实弱模型失败形态的确定性
  # 复刻）：起草只排"读上下文"一步；计划走完正文未产出触发修订，修订没有补足正文
  # 步、只是把同一读步再排一遍。runtime 应以 progress_signature 重复判停
  # （awaiting_author + no_progress），而不是无限空转。
  defp prose_no_progress_agent_plan_packet(:draft) do
    %{
      reasoning: "先只读取正文写作上下文，确认现状后再决定下一步。",
      steps: [
        plan_step("context_assemble", "explore", "先读取正文写作上下文。", [
          "prose_context_observation_created"
        ])
      ],
      reason_codes: ["agent_plan_drafted", "prose_no_progress_probe"]
    }
  end

  defp prose_no_progress_agent_plan_packet(:revision) do
    repeated_step =
      "context_assemble"
      |> plan_step("explore", "再次读取正文写作上下文。", ["prose_context_observation_created"])
      |> Map.put(:step_id, "context_assemble_again")

    %{
      reasoning: "上一轮只读取了上下文还没有生成正文；我再读取一次写作上下文补足信息。",
      steps: [
        plan_step("context_assemble", "explore", "先读取正文写作上下文。", [
          "prose_context_observation_created"
        ]),
        repeated_step
      ],
      reason_codes: ["agent_plan_revised", "prose_no_progress_probe"]
    }
  end

  defp agent_plan_profile_ref(prompt) do
    case Regex.run(~r/profile_ref:\s*([a-z0-9_]+)/, prompt, capture: :all_but_first) do
      [profile_ref] -> profile_ref
      _ -> nil
    end
  end

  # D6 短计划（判断纪元：诱导于 prose 创作 profile——对话 chat 判 reply 终结，
  # 计划路径只在创作 profile 内可达）：起草只排读上下文一步、漏正文步；计划走完
  # 正文未产出 → runtime 修订（revision 剥 marker 后出全量两步计划）→ 继续完成。
  defp prose_d6_agent_plan_packet do
    %{
      reasoning: "先只读取正文写作上下文，再观察是否需要继续。",
      steps: [
        plan_step("context_assemble", "explore", "先读取正文写作上下文。", [
          "prose_context_observation_created"
        ])
      ],
      reason_codes: ["agent_plan_drafted", "prose_d6_short_plan"]
    }
  end

  defp agent_plan_draft_packet_for_profile("prose_drafting_with_quality_v1", prompt) do
    %{
      reasoning: "先读取正文写作上下文，再基于该上下文生成正文草稿并完成质量复核。",
      steps: [
        plan_step("context_assemble", "explore", "先读取正文写作上下文。", [
          "prose_context_observation_created"
        ]),
        plan_step("chapter_mission", "explore", "按本章计划与作品脉络推导本章使命。", [
          "chapter_mission_derived"
        ]),
        prose_writing_plan_step(prompt)
      ],
      reason_codes: ["agent_plan_drafted", "prose_plan_drafted"]
    }
  end

  defp agent_plan_draft_packet_for_profile(profile_ref, _prompt),
    do: agent_plan_draft_packet_for_profile(profile_ref)

  defp agent_plan_draft_packet_for_profile("character_design_with_context_v1") do
    %{
      reasoning: "先读取当前角色阵容，再基于阵容设计待采纳角色候选。",
      steps: [
        plan_step("character_roster", "explore", "读取当前作品已确认角色阵容。", [
          "character_roster_observation_exists"
        ]),
        plan_step("character_design", "act", "基于已读取的角色阵容设计新的角色候选。", [
          "tentative_character_seed_created"
        ])
      ],
      reason_codes: ["agent_plan_drafted", "character_design_plan_drafted"]
    }
  end

  defp agent_plan_draft_packet_for_profile("plot_outline_with_context_v1") do
    %{
      reasoning: "先读取章节大纲规划上下文，再基于该上下文生成章节大纲草稿。",
      steps: [
        plan_step("context_assemble", "explore", "先读取章节大纲规划上下文。", [
          "outline_context_observation_created"
        ]),
        plan_step("plot_outline", "act", "基于已读取的章节上下文生成章节大纲草稿。", [
          "tentative_outline_draft_created"
        ])
      ],
      reason_codes: ["agent_plan_drafted", "plot_outline_plan_drafted"]
    }
  end

  defp agent_plan_draft_packet_for_profile("character_evolution_with_context_v1") do
    %{
      reasoning: "先读取角色演化上下文，再基于该上下文生成角色演化记忆草稿。",
      steps: [
        plan_step("context_assemble", "explore", "先读取角色演化上下文。", [
          "character_evolution_context_observation_created"
        ]),
        plan_step("character_evolution", "act", "基于已读取的角色上下文生成角色演化记忆草稿。", [
          "tentative_character_evolution_seed_created"
        ])
      ],
      reason_codes: ["agent_plan_drafted", "character_evolution_plan_drafted"]
    }
  end

  defp agent_plan_draft_packet_for_profile("world_building_with_context_v1") do
    %{
      reasoning: "先读取世界设定上下文，再基于该上下文生成世界设定、伏笔或规则草稿。",
      steps: [
        plan_step("context_assemble", "explore", "先读取世界设定上下文。", [
          "world_building_context_observation_created"
        ]),
        plan_step("world_building", "act", "基于已读取的世界设定上下文生成世界设定、伏笔或规则草稿。", [
          "tentative_world_building_seed_created"
        ])
      ],
      reason_codes: ["agent_plan_drafted", "world_building_plan_drafted"]
    }
  end

  defp agent_plan_draft_packet_for_profile("readonly_batch_context_v1") do
    %{
      reasoning: "先并行读取只读上下文，再汇总给作者，不写入作品也不生成候选。",
      steps: [
        plan_step("readonly_batch", "explore", "并行读取作品、角色、规则和统计上下文。", [
          "readonly_batch_observations_exist"
        ]),
        plan_step("readonly_batch", "explore", "汇总只读上下文并声明未写入作品事实。", [
          "readonly_batch_turn_result_emitted",
          "production_write_false"
        ])
      ],
      reason_codes: ["agent_plan_drafted", "readonly_batch_plan_drafted"]
    }
  end

  defp agent_plan_draft_packet_for_profile("ledger_reconciliation_v1") do
    %{
      reasoning: "机械执行一次全书审读并物化审读报告；规则判定由系统完成，不改设定或正文。",
      steps: [
        plan_step("ledger_reconcile", "act", "机械执行全书审读并物化审读报告。", [
          "ledger_reconcile_observation_exists"
        ]),
        plan_step("ledger_reconcile", "act", "汇总审读结论并声明未改动设定或正文。", [
          "ledger_reconcile_turn_result_emitted",
          "production_write_false"
        ])
      ],
      reason_codes: ["agent_plan_drafted", "ledger_reconcile_plan_drafted"]
    }
  end

  defp agent_plan_draft_packet_for_profile("fact_inventory_v1") do
    %{
      reasoning: "读取当前作品已采纳材料，提炼事实上已经存在的角色、规则和伏笔候选。",
      steps: [
        plan_step("fact_inventory", "act", "读取作品材料并整理待采纳设定提案。", [
          "fact_inventory_artifacts_created"
        ])
      ],
      reason_codes: ["agent_plan_drafted", "fact_inventory_plan_drafted"]
    }
  end

  # CP4：跨能力真计划样本（判断①判"复杂"后的模型自产计划）。
  defp agent_plan_draft_packet_for_profile("judgment_plan_v1") do
    %{
      reasoning: "先读取作品上下文，再依次完成大纲调整、正文重写与角色演化更新。",
      steps: [
        plan_step("context_assemble", "explore", "读取当前作品上下文与伏笔线索。", [
          "context_observation_created"
        ]),
        plan_step("plot_outline", "act", "按伏笔梳理结果调整章节大纲。", [
          "tentative_outline_draft_created"
        ]),
        plan_step("prose_writing", "act", "基于调整后的大纲重写目标章节正文。", [
          "tentative_prose_fragment_created"
        ]),
        plan_step("character_evolution", "act", "按新剧情推进相关角色的演化记忆。", [
          "tentative_character_evolution_seed_created"
        ])
      ],
      reason_codes: ["agent_plan_drafted", "judgment_plan_drafted"]
    }
  end

  defp agent_plan_draft_packet_for_profile("prose_revision_from_findings_v1") do
    %{
      reasoning: "先读取待修订草稿和质量发现，再完成授权、生成并汇总修订候选。",
      steps: [
        plan_step("revision_prepare", "explore", "读取待修订草稿和质量发现。", [
          "revision_source_loaded"
        ]),
        plan_step("revision_plan", "explore", "制定修订执行策略并重新经过系统裁决。", [
          "revision_micro_plan_exists",
          "allow_tool_decision_exists"
        ]),
        plan_step("prose_writing", "act", "基于修订计划生成正文修订候选。", [
          "tentative_revision_fragment_created"
        ]),
        plan_step("revision_finalize", "explore", "汇总修订候选给作者确认。", [
          "turn_result_emitted"
        ])
      ],
      reason_codes: ["agent_plan_drafted", "prose_revision_plan_drafted"]
    }
  end

  defp agent_plan_draft_packet_for_profile(_profile_ref) do
    %{
      reasoning: "为当前目标起草一条最小执行计划。",
      steps: [
        plan_step("allowed_tool", "act", "执行一个允许能力。", ["goal_progress"])
      ],
      reason_codes: ["agent_plan_drafted"]
    }
  end

  defp agent_plan_tool_call(tool_name, packet) do
    %{
      "id" => "call_#{tool_name}",
      "name" => tool_name,
      "arguments" => agent_plan_tool_arguments(packet)
    }
  end

  defp agent_plan_tool_arguments(packet) do
    %{
      author_reasoning: Map.fetch!(packet, :reasoning),
      plan: %{steps: Map.fetch!(packet, :steps)},
      reason_codes: Map.get(packet, :reason_codes, ["agent_plan_drafted"]),
      confidence: Map.get(packet, :confidence, 1.0)
    }
  end

  defp plan_step(target_tool_ref, kind, description, success_criteria) do
    %{
      step_id: target_tool_ref,
      kind: kind,
      description: description,
      success_criteria: success_criteria,
      depends_on: [],
      target_tool_ref: target_tool_ref,
      write_intent: if(kind == "act", do: "tentative", else: "none"),
      risk_hint: "low",
      authoring_intent: nil,
      target_chapter: nil,
      requested_chapter_raw: nil
    }
  end

  defp prose_writing_plan_step(prompt) do
    author_goal = agent_plan_author_goal(prompt)
    chapters = accepted_chapters_in_prompt(prompt)

    {authoring_intent, target_chapter, requested_chapter_raw} =
      prose_plan_authoring_coordinate(author_goal, chapters)

    risk_hint = if prose_plan_high_risk_goal?(author_goal), do: "high", else: "low"

    "prose_writing"
    |> plan_step("act", "基于已读取的正文上下文生成正文草稿并完成质量复核。", [
      "tentative_prose_fragment_created",
      "quality_review_completed"
    ])
    |> Map.merge(%{
      write_intent: "tentative",
      risk_hint: risk_hint,
      authoring_intent: authoring_intent,
      target_chapter: target_chapter,
      requested_chapter_raw: requested_chapter_raw,
      # 作者篇幅诉求（CP0 坐标族）：起草样本从原话解析"约 N 字"，无诉求为 nil。
      target_word_count: author_target_word_count(author_goal)
    })
  end

  defp author_target_word_count(author_goal) do
    case Regex.run(~r/约?\s*(\d{2,5})\s*字/u, author_goal) do
      [_, n] -> String.to_integer(n)
      _ -> cn_target_word_count(author_goal)
    end
  end

  @cn_digits %{
    "一" => 1,
    "二" => 2,
    "三" => 3,
    "四" => 4,
    "五" => 5,
    "六" => 6,
    "七" => 7,
    "八" => 8,
    "九" => 9
  }
  defp cn_target_word_count(author_goal) do
    case Regex.run(~r/([一二三四五六七八九])(百|千)字/u, author_goal) do
      [_, d, "百"] -> Map.fetch!(@cn_digits, d) * 100
      [_, d, "千"] -> Map.fetch!(@cn_digits, d) * 1000
      _ -> nil
    end
  end

  defp agent_plan_author_goal(prompt) do
    case Regex.run(~r/- author_goal:\s*(.*?)\n\s*-/su, prompt, capture: :all_but_first) do
      [text] -> String.trim(text)
      _ -> author_input_text(prompt)
    end
  end

  # 与真实 LLM 的计划契约对称：「作者点名的章按『作品章节』列表精确复制全名填 target_chapter，
  # 列表中没有对应章或无法确定时填 null」。点名章按**章条目**的 seq（新格式索引行）
  # 或标题内嵌章号（旧兼容行）对到 prompt 列表的**真实 title**；对不上 → null
  # （block 信号，作者点名了不存在的章）；未点名 → null（由执行层按意图兜底解析）。
  defp prose_plan_authoring_coordinate(author_goal, chapters) do
    intent =
      cond do
        contains_any?(author_goal, ["推翻", "重写", "改写", "重新写"]) -> "rewrite"
        contains_any?(author_goal, ["接着", "继续", "续写", "往下写", "再写", "补一段", "补写"]) -> "continuation"
        true -> nil
      end

    case named_chapter_token(author_goal) do
      nil ->
        {intent, nil, nil}

      token ->
        num = chapter_num(token)
        matched = num && chapter_title_for_num(chapters, num)
        {intent, matched, token}
    end
  end

  defp prose_plan_high_risk_goal?(author_goal) do
    contains_any?(author_goal, [
      "高风险",
      "需要确认",
      "确认后",
      "覆盖主线",
      "推翻",
      "重写",
      "改写",
      "生产写入"
    ])
  end

  defp frame_response(prompt) do
    flags = frame_flags(prompt)

    %{
      frame_type: frame_type(flags),
      dialogue_goal_summary: dialogue_goal_summary(flags),
      needs_tool:
        flags.readonly_character_query or flags.character_design_request or
          flags.character_evolution_request,
      no_tool_reason: no_tool_reason(flags),
      execution_readiness: execution_readiness(flags),
      assistant_message:
        frame_message(
          flags.slow_work_switch,
          flags.quality_diagnosis,
          flags.meta_discussion,
          flags.exploratory,
          prompt
        ),
      candidate_directions:
        candidate_directions(
          flags.exploratory and not flags.candidate_context_followup and
            not flags.readonly_character_query,
          prompt
        ),
      context_used: context_provided?(prompt),
      uncertainty: []
    }
  end

  defp frame_flags(prompt) do
    quality_diagnosis = quality_diagnosis_prompt?(prompt)
    meta_discussion = meta_discussion_prompt?(prompt)

    %{
      quality_diagnosis: quality_diagnosis,
      meta_discussion: meta_discussion,
      exploratory: exploratory_prompt?(prompt) and not quality_diagnosis and not meta_discussion,
      slow_work_switch: slow_work_switch_prompt?(prompt),
      candidate_context_followup: candidate_context_followup_prompt?(prompt),
      readonly_character_query: readonly_character_query_prompt?(prompt),
      character_design_request: character_design_request_prompt?(prompt),
      character_evolution_request: character_evolution_request_prompt?(prompt)
    }
  end

  defp frame_type(%{readonly_character_query: true}), do: "execution_candidate"
  defp frame_type(%{character_design_request: true}), do: "execution_candidate"
  defp frame_type(%{character_evolution_request: true}), do: "execution_candidate"
  defp frame_type(%{slow_work_switch: true}), do: "casual_reply"
  defp frame_type(%{candidate_context_followup: true}), do: "casual_reply"
  defp frame_type(%{quality_diagnosis: true}), do: "question_answer"
  defp frame_type(%{meta_discussion: true}), do: "meta_discussion"
  defp frame_type(%{exploratory: true}), do: "creative_exploration"
  defp frame_type(_flags), do: "casual_reply"

  defp dialogue_goal_summary(%{readonly_character_query: true}), do: "查看当前作品角色列表"
  defp dialogue_goal_summary(%{character_design_request: true}), do: "按作者意图设计新角色"
  defp dialogue_goal_summary(%{character_evolution_request: true}), do: "记录已有角色的演化事件"
  defp dialogue_goal_summary(%{slow_work_switch: true}), do: "验证慢回复跨作品归属"
  defp dialogue_goal_summary(%{candidate_context_followup: true}), do: "围绕已选候选方向继续探索"
  defp dialogue_goal_summary(%{quality_diagnosis: true}), do: "诊断章节爽感不足和胜利过轻"
  defp dialogue_goal_summary(%{meta_discussion: true}), do: "约定创作协作流程"
  defp dialogue_goal_summary(_flags), do: "验证工作台对话主链"

  defp no_tool_reason(%{readonly_character_query: true}), do: "tool_needed"
  defp no_tool_reason(%{character_design_request: true}), do: "tool_needed"
  defp no_tool_reason(%{character_evolution_request: true}), do: "tool_needed"
  defp no_tool_reason(%{exploratory: true}), do: "exploratory_only"
  defp no_tool_reason(_flags), do: "no_tool_needed"

  defp execution_readiness(%{readonly_character_query: true}), do: "ready"
  defp execution_readiness(%{character_design_request: true}), do: "ready"
  defp execution_readiness(%{character_evolution_request: true}), do: "ready"
  defp execution_readiness(_flags), do: "not_applicable"

  defp maybe_delay_su02_slow_work_switch(prompt_text) do
    if String.contains?(prompt_text, @slow_work_switch_marker) do
      Process.sleep(@slow_work_switch_delay_ms)
    end
  end

  defp maybe_delay_archive_slow(prompt_text) do
    if String.contains?(prompt_text, @archive_slow_marker) do
      Process.sleep(@archive_slow_delay_ms)
    end
  end

  defp maybe_delay_agent_cancel(prompt_text) do
    if String.contains?(prompt_text, @agent_cancel_slow_marker) do
      Process.sleep(@agent_cancel_slow_delay_ms)
    end
  end

  defp slow_work_switch_prompt?(prompt) do
    prompt |> author_input_text() |> String.contains?(@slow_work_switch_marker)
  end

  defp garbage_json_prompt?(prompt) do
    prompt |> author_input_text() |> String.contains?(@garbage_json_marker)
  end

  defp invalid_frame_prompt?(prompt) do
    prompt |> author_input_text() |> String.contains?(@invalid_frame_marker)
  end

  defp malformed_candidates_prompt?(prompt) do
    prompt |> author_input_text() |> String.contains?(@malformed_candidates_marker)
  end

  defp tool_failure_prompt?(prompt), do: String.contains?(prompt, @tool_failure_marker)

  defp invalid_frame_response do
    %{
      frame_type: "casual_reply",
      dialogue_goal_summary: "验证 frame validation 禁止语义边界",
      needs_tool: false,
      no_tool_reason: "no_tool_needed",
      execution_readiness: "not_applicable",
      assistant_message:
        "slice_verify raw provider payload: approved and ready_to_execute should be blocked.",
      candidate_directions: [],
      context_used: false,
      uncertainty: []
    }
  end

  defp malformed_candidates_response do
    %{
      frame_type: "creative_exploration",
      dialogue_goal_summary: "验证候选方向坏格式 fallback",
      needs_tool: false,
      no_tool_reason: "exploratory_only",
      execution_readiness: "not_applicable",
      assistant_message: "上游候选结构不可用时，也应该继续给作者可选方向。",
      candidate_directions: %{title: "", pitch: ""},
      context_used: false,
      uncertainty: []
    }
  end

  defp quality_diagnosis_prompt?(prompt) do
    text = author_input_text(prompt)
    contains_any?(text, ["不够爽", "赢得太轻", "爽点", "张力不够", "质量诊断", "不成立"])
  end

  defp meta_discussion_prompt?(prompt) do
    text = author_input_text(prompt)

    contains_any?(text, [
      "协作方式",
      "创作流程",
      "先讨论方案",
      "再决定是否生成",
      "下一步怎么合作"
    ])
  end

  defp readonly_character_query_prompt?(prompt) do
    text = author_input_text(prompt)

    roster_query =
      contains_any?(text, ["查看", "列出", "查询", "看看", "展示"]) and
        contains_any?(text, ["当前角色列表", "角色列表", "已有角色", "人物表", "角色清单"])

    roster_query or protagonist_query?(text)
  end

  # "主角是谁/谁是主角/主角叫啥/有没有主角" 是只读查询；"设计/设定主角" 是创建，不在此命中。
  defp protagonist_query?(text) do
    String.contains?(text, "主角") and
      contains_any?(text, ["是谁", "谁是", "叫啥", "叫什么", "有没有", "有无", "是不是", "有谁"]) and
      not contains_any?(text, ["设计", "设定", "创建", "新增", "塑造", "加个", "加一个"])
  end

  # "设计/设定/创建一个主角/反派/配角/角色" 是创建意图，需要 character_design 工具。
  defp character_design_request_prompt?(prompt) do
    text = author_input_text(prompt)

    contains_any?(text, ["设计", "设定", "创建", "新增", "塑造", "加个", "加一个", "写一个"]) and
      contains_any?(text, ["主角", "反派", "配角", "角色", "人物"]) and
      not protagonist_query?(text) and
      not character_evolution_request?(text)
  end

  # "更新/演化/推进已有角色的成长/当前状态/关系变化" 是演化意图，需要 character_evolution 工具。
  defp character_evolution_request_prompt?(prompt) do
    prompt |> author_input_text() |> character_evolution_request?()
  end

  defp character_evolution_request?(text) do
    contains_any?(text, [
      "更新",
      "演化",
      "推进",
      "黑化",
      "觉醒",
      "蜕变",
      "成长转变",
      "当前状态",
      "现状",
      "结盟",
      "反目",
      "决裂",
      "关系变化"
    ]) and contains_any?(text, ["角色", "人物", "主角", "林烬", "他", "她"])
  end

  defp candidate_context_followup_prompt?(prompt) do
    author_text = author_input_text(prompt)

    contains_any?(author_text, ["开场冲突", "继续沿着这个方向", "沿着这个方向"]) and
      candidate_context_nonce(prompt) != nil
  end

  defp exploratory_prompt?(prompt) do
    text = author_input_text(prompt)
    Enum.any?(["生成", "角色", "方向", "怎么切入", "小说创作"], &String.contains?(text, &1))
  end

  defp frame_message(true, _quality_diagnosis, _meta_discussion, _exploratory, prompt) do
    nonce =
      prompt
      |> author_input_text()
      |> random_identifier_tokens()
      |> Enum.find(&String.starts_with?(&1, @slow_work_switch_marker))

    "慢回复归属校验完成：#{nonce || @slow_work_switch_marker} 只属于原作品。"
  end

  defp frame_message(false, true, _meta_discussion, _exploratory, prompt) do
    if quality_context_missing_prompt?(prompt) do
      "我还缺少当前章节摘要或正文，只能先按通用质量原则判断：需要补充目标章材料，再对冲突压力、代价和读者回报做具体诊断；这轮不会改写正文或写入作品事实。"
    else
      "这一章的问题不是主角赢，而是阻力、代价和读者回报没有层层加压。可以让林烬赢下局部却失去关键线索，或让胜利暴露更大的矿区代价；这轮只给诊断和结构修订建议，不会改写正文或写入作品事实。"
    end
  end

  defp frame_message(false, false, true, _exploratory, _prompt) do
    "可以。之后我会先和你讨论方案、取舍与风险；只有你明确要求生成时，才进入创作执行。"
  end

  defp frame_message(false, false, false, true, prompt) do
    case candidate_context_nonce(prompt) do
      nil ->
        "可以先从人物动机、核心冲突和世界规则三个方向拆开看。"

      nonce ->
        "可以先从人物动机 #{nonce}、核心冲突和世界规则三个方向拆开看。"
    end
  end

  defp frame_message(false, false, false, false, prompt) do
    if candidate_context_followup_prompt?(prompt) do
      nonce = candidate_context_nonce(prompt)
      "沿着人物动机 #{nonce} 这个方向，开场冲突可以从主角想要突破规则、却必须先承受代价开始。"
    else
      "可以，我们先围绕小说创作方向聊下去。"
    end
  end

  defp quality_context_missing_prompt?(prompt) do
    prompt
    |> prompt_text()
    |> String.contains?("缺章节摘要")
  end

  defp context_provided?(prompt) do
    text = prompt_text(prompt)

    String.contains?(text, "当前作品上下文") and
      not String.contains?(text, "（无——这是新对话或尚未创建作品）")
  end

  defp candidate_directions(true, prompt) do
    author_text = author_input_text(prompt)
    high_risk? = contains_any?(author_text, ["高风险", "覆盖主线", "重写设定", "推翻设定"])

    context_nonce =
      author_text
      |> random_identifier_tokens()
      |> Enum.find(&String.starts_with?(&1, @candidate_context_marker))

    first =
      if high_risk? do
        %{
          title: "高风险主线覆盖",
          pitch: "直接覆盖既有主线设定，需要作者再次确认后才能采用。",
          tone_tags: ["主线", "高风险"],
          risk_hint: "high"
        }
      else
        %{
          title: if(context_nonce, do: "人物动机 #{context_nonce}", else: "人物动机"),
          pitch: "从主角最想得到但最难承受的东西切入。",
          tone_tags: ["人物", "冲突"],
          risk_hint: "low"
        }
      end

    [
      first,
      %{
        title: "世界规则",
        pitch: "先确定一个会持续制造选择压力的规则。",
        tone_tags: ["设定", "推进"],
        risk_hint: "low"
      }
    ]
  end

  defp candidate_directions(false, _prompt), do: []

  defp candidate_context_nonce(prompt) do
    prompt
    |> prompt_text()
    |> random_identifier_tokens()
    |> Enum.find(&String.starts_with?(&1, @candidate_context_marker))
  end

  defp tool_narration_response(prompt) do
    cond do
      String.contains?(prompt, "character_design") ->
        "已生成角色设定草案，你可以查看内容后选择采纳、放弃或修改。"

      String.contains?(prompt, "world_building") ->
        "已生成世界设定草案，你可以查看内容后决定是否保存到作品档案。"

      String.contains?(prompt, "prose_writing") ->
        "已生成正文草稿，请先审阅，采纳后才会进入阅读模式。"

      String.contains?(prompt, "plot_outline") ->
        "已生成大纲草案，你可以审阅后决定是否纳入作品结构。"

      true ->
        "已生成创作草稿，你可以继续查看、采纳或修改。"
    end
  end

  # 章节计划主题（确定性、稳定、可支撑长篇），用于 outline_draft 多章生成。
  @outline_chapter_themes ~w(觉醒 试炼 盟约 裂隙 暗流 突围 真相 背叛 抉择 决战 余烬 新生)

  # 分卷卷名：仅在真实规划 prompt 里出现分卷要求时按顺序取用（见 outline_volume_assignments/2）。
  @outline_volume_titles ["第一卷·觉醒", "第二卷·裂变", "第三卷·归墟", "第四卷·长夜"]

  # B11A CP2：卷蓝图行的确定性设计槽内容（VS-00J §2.1）。只由桩在真实 prompt 的
  # 「卷蓝图要求」文本出现时取用，两卷内容不同；高潮章/缓冲章在取值时替换为该卷内
  # 真实章标题（见 volume_blueprint_slots/2）——桩不产章号引用。
  @outline_volume_blueprint_slots [
    %{
      goal_conflict: "查清灵气账单被篡改的第一条线索",
      arc_stage: "从旁观者变成愿意下场的调查者",
      map_boundary: "下城区的旧灯街与地下账房",
      subplots_start: "旧友重逢",
      subplots_advance: "账房线人交易",
      subplots_close: "灯街守夜人倒戈",
      payoff_density: "每两章一次当面交锋",
      new_characters: "灯街守夜人",
      new_settings: "灵气配额账本",
      new_maps: "地下账房"
    },
    %{
      goal_conflict: "在频段封锁前夺回被抽走的城市灵气",
      arc_stage: "从被追捕的证人变成公开对抗的发起者",
      map_boundary: "贯穿全城的中继塔与废弃调度站",
      subplots_start: "官方调查组内部线人",
      subplots_advance: "中继塔潜入行动",
      subplots_close: "旧灯街盟友的债务清偿",
      payoff_density: "卷末连续三章升级",
      new_characters: "调度站退役工程师",
      new_settings: "灵气频段契约",
      new_maps: "废弃调度站"
    }
  ]

  defp creative_items_response(prompt) do
    {brief, context} = creative_prompt_parts(prompt)

    cond do
      # B28 CP1.5：章级修订任务（chapter-scoped）确定性产出覆盖顺序完整稿。
      # format_only：返回整章基线原文（允许的空白归一后等价）；content_revision：
      # 只落实作者原话里明确写出的“X 改成/改为/→ Y”，其余逐字保留。
      chapter_revision_prompt?(prompt) ->
        chapter_revision_items(prompt, brief, context)

      String.starts_with?(brief, "修订下面已有候选") ->
        original = context |> String.split("：\n", parts: 2) |> List.last()
        body = String.replace(original, "沈砚", "林渡")

        [
          %{
            item_id: "revision_#{:erlang.phash2(prompt)}",
            title: "旧书铺修订稿",
            body: body,
            rationale: "按作者要求修改名字，原稿保留。"
          }
        ]

      # Q1c：已采纳设定的修订候选。只替换作者点名的年龄，保留原文其余字节与 nonce；
      # revision_of / supersedes_ref 由 application 绑定，provider 不伪造链字段。
      String.starts_with?(brief, "修订下面已采纳的作品内容") ->
        original = context |> String.split("：\n", parts: 2) |> List.last()

        [
          %{
            item_id: "adopted_revision_#{:erlang.phash2(prompt)}",
            title: "岑舟与青云宗 · 年龄修订稿",
            body: String.replace(original, "二十五岁", "三十岁"),
            rationale: "按作者要求把岑舟年龄从二十五岁改为三十岁，其他内容保持不变。"
          }
        ]

      # 章节计划（plot_outline -> outline_draft）确定性产出多章，让 plan-minimum 等 slice
      # 在离线 provider 下也能演练「生成结构化章节计划」。
      outline_plan_prompt?(prompt) ->
        outline_chapter_items(brief, context)

      # AU-09：作者明确要多个角色候选（“两个/几个/候选/不同方向”）时确定性产出 2 条独立候选，
      # 让逐候选采纳 slice 在离线 provider 下也能演练；普通“设计一个角色”仍单条。
      multi_character_candidate_prompt?(prompt, brief) ->
        character_candidate_items(brief, context)

      # AU-09：角色演化记忆草稿（采纳后写角色记忆，非主档案）。
      character_evolution_seed_prompt?(prompt) ->
        [character_evolution_item(brief, context)]

      true ->
        text = [brief, context] |> Enum.reject(&(&1 == "")) |> Enum.join("\n")
        fingerprint = text |> :erlang.phash2() |> Integer.to_string(36)

        item =
          %{
            item_id: "slice_item_#{fingerprint}_1",
            title: creative_title(prompt, brief, fingerprint),
            body: creative_body(prompt, brief, context),
            rationale: creative_rationale(prompt, brief)
          }
          |> maybe_put_narrative_role(prompt, brief)

        if prose_fragment_prompt?(prompt) do
          %{
            items: [item],
            companion_artifacts: prose_companion_artifacts(brief, fingerprint),
            self_report: creative_self_report(context)
          }
        else
          [item]
        end
    end
  end

  defp chapter_revision_prompt?(prompt) do
    String.contains?(prompt, "整章仅排版修订（format_only）") or
      String.contains?(prompt, "整章正文修订") or
      String.contains?(prompt, "整章内容修订") or
      String.contains?(prompt, "指定片段/段落内容修订")
  end

  defp chapter_revision_items(prompt, brief, context) do
    base = chapter_revision_base_text(context)

    body =
      if String.contains?(prompt, "整章仅排版修订（format_only）"),
        do: base,
        else: apply_explicit_changes(base, brief)

    [
      %{
        item_id: "chapter_revision_#{:erlang.phash2(prompt)}",
        title:
          if(String.contains?(prompt, "整章仅排版修订（format_only）"),
            do: "整章排版修订稿",
            else: "整章内容修订稿"
          ),
        body: body,
        rationale: "确定性 fixture：按 task 覆盖范围与作者原话输出完整稿。"
      }
    ]
  end

  defp chapter_revision_base_text(context) do
    case String.split(context, "：\n", parts: 2) do
      [_prefix, rest] -> String.trim_trailing(rest)
      _ -> String.trim(context)
    end
  end

  defp apply_explicit_changes(text, brief) do
    ~r/((?:[0-9]+|[一二三四五六七八九十百千两]+)[^\s，。；：]{0,4})(?:改成|改为|→)([^，。；：\s]{1,16})/u
    |> Regex.scan(brief)
    |> Enum.reduce(text, fn
      [_, from, to], acc -> String.replace(acc, from, to)
      _, acc -> acc
    end)
  end

  defp log_received_prompt(prompt_text, prompt) do
    case Application.get_env(:novel_common, :llm_log_dir) do
      dir when is_binary(dir) and dir != "" ->
        File.mkdir_p!(dir)
        file = Path.join(dir, "#{Date.utc_today()}.jsonl")

        line =
          Jason.encode!(%{
            ts: DateTime.utc_now() |> DateTime.to_iso8601(),
            provider: "slice_verify",
            prompt: prompt_text,
            tools: if(is_map(prompt), do: Map.get(prompt, :tools, []), else: []),
            tool_choice: if(is_map(prompt), do: Map.get(prompt, :tool_choice), else: nil),
            work_id: Logger.metadata()[:work_id],
            session_id: Logger.metadata()[:session_id],
            turn_id: Logger.metadata()[:turn_id]
          })

        File.write!(file, line <> "\n", [:append])

      _ ->
        :ok
    end
  rescue
    _error -> :ok
  end

  defp character_evolution_seed_prompt?(prompt),
    do: String.contains?(prompt, "artifact_type：character_evolution_seed")

  # 角色演化记忆草稿：从 brief 派生 memory_subtype（关系/当前状态/演化），采纳后写对应角色 MemoryType。
  defp character_evolution_item(brief, context) do
    fingerprint = [brief, context] |> Enum.join("\n") |> :erlang.phash2() |> Integer.to_string(36)
    text = to_string(brief)

    subtype =
      cond do
        contains_any?(text, ["关系", "结盟", "反目", "决裂", "敌对", "背叛", "联手"]) -> "RELATIONSHIP"
        contains_any?(text, ["当前状态", "现状", "此刻", "目前", "伤势", "处境", "所在"]) -> "CURRENT_STATE"
        true -> "CHARACTER_PROFILE"
      end

    # 保留 user 输入中的随机标识符（nonce），证明采纳的角色记忆来自本轮输入而非 fixture。
    nonces =
      (random_identifier_tokens(text) ++ random_identifier_tokens(context))
      |> Enum.take(2)
      |> Enum.join("、")

    body_nonce = if nonces == "", do: "", else: "（线索：#{nonces}）"

    %{
      item_id: "slice_evo_#{fingerprint}_1",
      title: "林烬：演化事件 #{String.slice(fingerprint, 0, 4)}",
      body: "林烬随剧情发生演化#{body_nonce}。本条只记录该演化事实，不重写角色主档案。",
      rationale: "记录角色随剧情的连续性变化，供后续创作召回。",
      memory_subtype: subtype
    }
  end

  defp multi_character_candidate_prompt?(prompt, brief) do
    character_seed_prompt?(prompt) and
      contains_any?(to_string(brief), [
        "两个",
        "二个",
        "两位",
        "几个",
        "多个",
        "数个",
        "多位",
        "候选",
        "不同方向"
      ])
  end

  # 两条取向明显不同、各自独立可采纳的角色候选（item_id/标题各不相同，便于逐项采纳断言）。
  defp character_candidate_items(brief, context) do
    fingerprint = [brief, context] |> Enum.join("\n") |> :erlang.phash2() |> Integer.to_string(36)
    suffix = String.slice(fingerprint, 0, 4)

    [
      %{
        item_id: "slice_char_#{fingerprint}_1",
        title: "沈砚 #{suffix}",
        body: character_body(brief, context),
        rationale: "候选一：冷峻克制的稽查官方向。"
      },
      %{
        item_id: "slice_char_#{fingerprint}_2",
        title: "云栖 #{suffix}",
        body: character_body(brief, context),
        rationale: "候选二：游离于秩序之外的线人方向。"
      }
    ]
  end

  defp outline_plan_prompt?(prompt), do: String.contains?(prompt, "artifact_type：outline_draft")

  defp character_seed_prompt?(prompt),
    do: String.contains?(prompt, "artifact_type：character_seed")

  # character_seed 草稿按 user brief 中的角色类型词派生结构化叙事角色（确定性 fixture）。
  defp maybe_put_narrative_role(item, prompt, brief) do
    if character_seed_prompt?(prompt) do
      case brief_narrative_role(to_string(brief)) do
        nil -> item
        role -> Map.put(item, :narrative_role, role)
      end
    else
      item
    end
  end

  defp brief_narrative_role(text) do
    cond do
      String.contains?(text, "反派") -> "ANTAGONIST"
      String.contains?(text, "配角") -> "SUPPORTING"
      String.contains?(text, "次要") or String.contains?(text, "龙套") -> "MINOR"
      String.contains?(text, "群像") -> "ENSEMBLE_POV"
      String.contains?(text, "主角") or String.contains?(text, "主人公") -> "PROTAGONIST"
      true -> nil
    end
  end

  defp world_setting_prompt?(prompt),
    do:
      contains_any?(prompt, [
        "artifact_type：world_setting",
        "artifact_type：foreshadowing_seed",
        "artifact_type：world_rule_seed",
        "artifact_type：style_rule_seed",
        "artifact_type：constraint_seed"
      ])

  defp prose_fragment_prompt?(prompt),
    do: String.contains?(prompt, "artifact_type：prose_fragment")

  # P1 R2：仅 test/support provider 的确定性语义 fixture。真实作者请求同时明确新角色、
  # 伏笔、世界规则和后续约束时，正文调用按生产 contract 同轮返回四类 companion seed；
  # 普通正文请求保持 []，不为凑数伪造设定。
  defp prose_companion_artifacts(brief, fingerprint) do
    if contains_any?(brief, ["岑雾", "灯禁", "前三章不揭示"]) do
      [
        %{
          artifact_type: "character_seed",
          item_id: "slice_companion_character_#{fingerprint}",
          title: "岑雾",
          body: "巡夜人，负责追查城中违规点灯者。",
          rationale: "作者要求在本轮正文中新引入岑雾。",
          narrative_role: "SUPPORTING",
          role: "巡夜人"
        },
        %{
          artifact_type: "foreshadowing_seed",
          item_id: "slice_companion_foreshadow_#{fingerprint}",
          title: "第三盏灯的蓝灰",
          body: "第三盏灯熄灭后留下无法擦除的蓝灰。",
          rationale: "正文中新埋且尚未回收的线索。"
        },
        %{
          artifact_type: "world_rule_seed",
          item_id: "slice_companion_rule_#{fingerprint}",
          title: "夜间灯禁",
          body: "日落后点亮第三盏灯会引来巡夜人。",
          rationale: "本轮正文建立、会持续约束人物行动的世界规则。"
        },
        %{
          artifact_type: "constraint_seed",
          item_id: "slice_companion_constraint_#{fingerprint}",
          title: "前三章不揭示灯禁源头",
          body: "前三章不得解释灯禁与蓝灰的真正来源。",
          rationale: "作者在本轮创作简述中明确提出的后续约束。"
        }
      ]
    else
      []
    end
  end

  defp creative_self_report(context) do
    %{
      assumptions: ["按目标章结构和 ReaderEffectBrief 生成正文草稿"],
      intended_reader_effect: reader_effect_from_context(context),
      used_context_refs: ["target_structure", "reader_effect_brief"],
      risk_flags: ["WARN: 章尾钩子强度需作者审阅"]
    }
  end

  defp reader_effect_from_context(context) do
    case Regex.run(~r/目标情绪[:：]\s*([^\n]+)/u, context) do
      [_, emotion] -> String.trim(emotion)
      _ -> "按 ReaderEffectBrief 制造紧张和期待"
    end
  end

  # 章节计划生成具备增量感知（与真实 LLM 行为对称）：上下文里已有 N 章时，
  # 新计划从第 N+1 章接续编号（标题不与既有章相撞 → 采纳物化按 title 幂等追加）。
  defp outline_chapter_items(brief, context) do
    case scoped_planning_scope(context) do
      nil -> unscoped_outline_chapter_items(brief, context)
      scope -> scoped_outline_chapter_items(brief, context, scope)
    end
  end

  # B11A CP3：开新卷动作的 scope-aware 产出——真实 context_text 里出现产品
  # 「本轮规划范围（机械给定，不得改）」段时，本轮只产下一卷：一条卷蓝图行 + 该卷
  # 开篇 3 章（章号从 scope 的下一章号起、逐章标注所属卷）。无该段时走既有全量产出，
  # 与今天逐字节等价。桩只认真实产品 prompt 文本，不认 slice id / env。
  defp scoped_planning_scope(context) do
    text = to_string(context)

    with true <- String.contains?(text, "本轮规划范围（机械给定，不得改）"),
         [_, next_seq_digits] <- Regex.run(~r/本轮只规划下一卷：第\s*(\d+)\s*卷/u, text),
         [_, next_chapter_digits] <- Regex.run(~r/下一章号从\s*(\d+)\s*开始/u, text),
         {next_seq, ""} <- Integer.parse(next_seq_digits),
         {next_chapter, ""} <- Integer.parse(next_chapter_digits),
         true <- next_seq > 0 and next_chapter > 0 do
      %{
        next_seq: next_seq,
        next_chapter_seq: next_chapter,
        volume_title: volume_title(next_seq - 1)
      }
    else
      _ -> nil
    end
  end

  defp scoped_outline_chapter_items(brief, context, scope) do
    fingerprint =
      [brief, context]
      |> Enum.reject(&(&1 == ""))
      |> Enum.join("\n")
      |> :erlang.phash2()
      |> Integer.to_string(36)

    chapters =
      @outline_chapter_themes
      |> Enum.take(3)
      |> Enum.with_index()
      |> Enum.map(fn {theme, index} ->
        n = scope.next_chapter_seq + index
        seq = n |> Integer.to_string() |> String.pad_leading(2, "0")

        %{
          item_id: "slice_outline_#{fingerprint}_#{n}",
          title: "第#{seq}章：#{theme}",
          body: outline_chapter_body(theme, n, scope.volume_title),
          rationale: nil
        }
      end)

    chapter_titles = Enum.map(chapters, & &1.title)
    blueprint_line = volume_blueprint_line(scope.volume_title, scope.next_seq, chapter_titles)

    append_volume_blueprint_lines(chapters, [blueprint_line])
  end

  defp unscoped_outline_chapter_items(brief, context) do
    fingerprint =
      [brief, context]
      |> Enum.reject(&(&1 == ""))
      |> Enum.join("\n")
      |> :erlang.phash2()
      |> Integer.to_string(36)

    start = existing_chapter_count(context) + 1
    volume_titles = outline_volume_assignments(context, length(@outline_chapter_themes))

    @outline_chapter_themes
    |> Enum.with_index()
    |> Enum.map(fn {theme, index} ->
      n = start + index
      seq = n |> Integer.to_string() |> String.pad_leading(2, "0")

      %{
        item_id: "slice_outline_#{fingerprint}_#{n}",
        title: "第#{seq}章：#{theme}",
        body: outline_chapter_body(theme, n, Enum.at(volume_titles, index)),
        rationale: nil
      }
    end)
    |> append_volume_blueprint_lines(outline_volume_blueprint_lines(context, start))
  end

  # 卷蓝图行必须落在 content 的独立行上：`items_to_content/2` 把 item 渲染为
  # `title: body` 再按行交给 `ChapterPlanParser`。塞进 title 同行会被当成章标题的
  # 一部分而解析不到；若把行放在 body **最前面**，则 `title: \n卷蓝图…` 会让首行
  # 止于 `title:`（ASCII 冒号后无内容），章标题被解析成「第01章：觉醒:」带尾冒号。
  # 因此把行追加到第一个 item body 末尾：解析器先抽离卷蓝图行再解析章块，章标题/
  # 章正文/逐章卷归属全部不受影响。
  defp append_volume_blueprint_lines(items, []), do: items

  defp append_volume_blueprint_lines([first | rest], lines) do
    [%{first | body: first.body <> "\n" <> Enum.join(lines, "\n")} | rest]
  end

  # B11A CP2（VS-00J §3.1）：只在**真实规划 prompt 里出现卷蓝图要求**时产出卷蓝图行。
  # 该要求由 `NovelDomain.WorkSkeleton.volume_directive/1` 多卷时渲染，只有作品立了
  # `planned_volumes > 1` 才出现在上下文段。桩只认这段真实产品文本，不认 slice
  # id / 环境变量：没有要求就不产蓝图行，单卷/旧路径逐字节等价（I-VOL-4）。
  defp outline_volume_blueprint_lines(context, start) do
    context = to_string(context)

    with true <- String.contains?(context, "卷蓝图要求"),
         volume_count when is_integer(volume_count) and volume_count > 1 <-
           requested_volume_count(context) do
      volume_count
      |> outline_volume_chapter_titles(start)
      |> Enum.with_index()
      |> Enum.map(fn {chapter_titles, index} ->
        volume_blueprint_line(volume_title(index), index + 1, chapter_titles)
      end)
    else
      _ -> []
    end
  end

  # 每卷在本次规划批次里的真实章标题（与卷分组同源：volume_chunk_sizes/2），供
  # 卷蓝图的高潮章/缓冲章只写章标题（VS-00J §2.1 引用口径）。
  defp outline_volume_chapter_titles(volume_count, start) do
    chapter_titles =
      @outline_chapter_themes
      |> Enum.with_index()
      |> Enum.map(fn {theme, index} ->
        n = start + index
        "第#{n |> Integer.to_string() |> String.pad_leading(2, "0")}章：#{theme}"
      end)

    volume_chunk_sizes(length(chapter_titles), volume_count)
    |> Enum.map_reduce(chapter_titles, fn size, rest ->
      {Enum.take(rest, size), Enum.drop(rest, size)}
    end)
    |> elem(0)
  end

  defp volume_blueprint_line(title, seq, chapter_titles) do
    slots = volume_blueprint_slots(seq, chapter_titles)

    [
      {"目标冲突", slots.goal_conflict},
      {"弧光阶段", slots.arc_stage},
      {"地图边界", slots.map_boundary},
      {"支线启动", slots.subplots_start},
      {"支线推进", slots.subplots_advance},
      {"支线收束", slots.subplots_close},
      {"高潮章", slots.climaxes},
      {"爽点密度", slots.payoff_density},
      {"缓冲章", slots.buffers},
      {"新人物", slots.new_characters},
      {"新设定", slots.new_settings},
      {"新地图", slots.new_maps}
    ]
    |> Enum.map_join("｜", fn {label, value} -> "#{label}：#{value}" end)
    |> then(&"卷蓝图：#{title}｜序号：#{seq}｜#{&1}")
  end

  defp volume_blueprint_slots(seq, chapter_titles) do
    content =
      Enum.at(@outline_volume_blueprint_slots, seq - 1, default_volume_blueprint_slots(seq))

    content
    |> Map.put(:climaxes, List.last(chapter_titles) || "待定")
    |> Map.put(:buffers, Enum.at(chapter_titles, div(length(chapter_titles), 2)) || "待定")
  end

  # 第 3 卷及以后的规划（其它场景的 planned_volumes > 2）也要每卷一行蓝图；
  # 内容诚实派生自序号，不伪造具体情节。
  defp default_volume_blueprint_slots(seq) do
    %{
      goal_conflict: "推进第#{seq}卷的核心冲突",
      arc_stage: "人物弧光进入第#{seq}阶段",
      map_boundary: "第#{seq}卷舞台",
      subplots_start: "第#{seq}卷新支线",
      subplots_advance: "第#{seq}卷主线推进",
      subplots_close: "第#{seq}卷旧支线收束",
      payoff_density: "每三章一个爽点",
      new_characters: "第#{seq}卷新角色",
      new_settings: "第#{seq}卷新设定",
      new_maps: "第#{seq}卷新地图"
    }
  end

  # 场次逐场标注（NEM04 刀③）：真实 prompt 已要求逐场计划，桩按同格式产两场，
  # 复刻真实模型行为；解析/简报多场展开由 production 完成，桩不感知任何 slice。
  defp outline_chapter_body(theme, n, volume_title) do
    """
    章功能定位：#{outline_chapter_role(n)}
    情节推进：围绕「#{theme}」推进主线第 #{n} 阶段。
    人物变化：视角人物在「#{theme}」压力下完成一次选择升级。
    信息释放：释放与「#{theme}」相关的新线索。
    伏笔动作：埋下「#{theme}」后续回收点。
    情绪定位：紧张、期待。
    章首拉力：以「#{theme}」相关异常开场。
    章尾断章：在「#{theme}」线索刚要揭晓时切断。
    场次：#{theme}对峙｜目标：把「#{theme}」的冲突推到当面摊牌｜议程：主角要真相、对手要脱身｜情绪：紧张
    场次：#{theme}收线｜目标：拿到「#{theme}」的关键线索并付出代价｜情绪：期待
    字数与场次：约 3000 字，2 场。
    """
    |> String.trim()
    |> append_volume_line(volume_title)
  end

  defp append_volume_line(body, nil), do: body
  defp append_volume_line(body, title), do: body <> "\n所属卷：#{title}"

  # AU08 CP2：卷归属逐章标注只在**真实规划 prompt 里出现分卷要求**时产出。
  # 该要求由 `NovelDomain.WorkSkeleton.volume_directive/1` 渲染，只有作品立了
  # `planned_volumes > 1`（且骨架有目标体量）才会出现在上下文段里。桩只认这段真实
  # 产品文本，不认 slice id / 环境变量：没有要求就不标注，与单卷书逐字节等价。
  defp outline_volume_assignments(context, chapter_count) do
    case requested_volume_count(context) do
      nil ->
        List.duplicate(nil, chapter_count)

      volume_count ->
        chapter_count
        |> volume_chunk_sizes(volume_count)
        |> Enum.with_index()
        |> Enum.flat_map(fn {size, index} -> List.duplicate(volume_title(index), size) end)
    end
  end

  defp requested_volume_count(context) do
    with [_, digits] <- Regex.run(~r/分卷规划要求：全书分\s*(\d+)\s*卷/u, to_string(context)),
         {count, ""} <- Integer.parse(digits),
         true <- count > 1 do
      count
    else
      _ -> nil
    end
  end

  # 故意不均分：首卷让出 1 章给末卷。卷内章数只能从逐章标注读出，验收断言不可能靠
  # 「按章数均分」猜中，从而证明分组来自标注而非事后平均。
  defp volume_chunk_sizes(total, count) do
    base = div(total, count)
    rest = rem(total, count)
    sizes = Enum.map(0..(count - 1), fn i -> base + if(i < rest, do: 1, else: 0) end)

    if count > 1 and hd(sizes) > 1 do
      sizes |> List.update_at(0, &(&1 - 1)) |> List.update_at(count - 1, &(&1 + 1))
    else
      sizes
    end
  end

  defp volume_title(index) do
    Enum.at(@outline_volume_titles, index) || "第#{index + 1}卷·未名"
  end

  defp outline_chapter_role(n) when rem(n, 5) == 0, do: "高潮章"
  defp outline_chapter_role(n) when rem(n, 3) == 0, do: "转折章"
  defp outline_chapter_role(_n), do: "推进章"

  # creative 上下文（DialogueContext.to_prompt_text）的「## 已采纳章节」段行数。
  defp existing_chapter_count(context) do
    case Regex.run(~r/##\s*已采纳章节[^\n]*\n(.*?)(?:\n##|\z)/su, context) do
      [_, block] ->
        block |> String.split("\n") |> Enum.count(&String.match?(&1, ~r/^\s*-\s+/))

      _ ->
        0
    end
  end

  defp plan_response(prompt) do
    author_text = author_input_text(prompt)

    if multi_step_downgrade_prompt?(author_text) do
      multi_step_plan_response()
    else
      single_action_plan_response(prompt, author_text)
    end
  end

  defp profile_routing_response(prompt) do
    author_text = author_input_text_from_profile_route_prompt(prompt)
    normalized = String.downcase(author_text)

    # B23 CP5 fixture：profile routing 步骤若存在，env 开启且作者请求带标记时直接
    # 选跨能力计划工作流（judgment_plan_v1）；否则走既有规则表。仅依据 env + prompt
    # 文本，不识别 slice id。
    {profile_ref, summary, reason_codes} =
      if plan_exhaust_fixture?() and String.contains?(prompt, @plan_exhaust_marker) do
        {"judgment_plan_v1", "模型选择跨能力计划工作流。",
         ["model_profile_selected", "judgment_plan_text_match"]}
      else
        profile_route_match(normalized)
      end

    profile_route_response(profile_ref, summary, reason_codes, author_text)
  end

  # ── 判断①（ADR-0025 CP1 方案 B）：复用路由规则表判形态，复用帧机器产内联回复/候选 ──

  defp judgment_prompt?(prompt), do: String.contains?(prompt, "创作判断器")

  @judgment_capability_for_profile %{
    "character_design_with_context_v1" => "character_design",
    "prose_drafting_with_quality_v1" => "prose_writing",
    "plot_outline_with_context_v1" => "plot_outline",
    "character_evolution_with_context_v1" => "character_evolution",
    "world_building_with_context_v1" => "world_building",
    "readonly_batch_context_v1" => "work_archive_read"
  }

  defp judgment_verdict(prompt) do
    author_text = judgment_author_input(prompt)
    normalized = String.downcase(author_text)

    # 讨论保护先行（与生产判断 prompt 的判别规则、planner 的 explicit_discussion_only
    # 同语义）：作者显式说"先聊/只聊/不写"时不得进入创作能力，按直接回复处理。
    cond do
      adopted_revision_request?(prompt) ->
        {"execute", "revise_adopted_content", false}

      message_state_request?(prompt) ->
        {"reply", nil, false}

      String.contains?(author_text, @awaiting_author_steer_marker) ->
        {"await_author", nil, false}

      # B23 CP5 fixture：仅 test-support env 开启且作者请求带标记时，判断①判 plan
      # → judgment_plan_v1（全只读计划起草/修订由下方 packet 分支给出）。
      plan_exhaust_plan_verdict?(prompt) ->
        {"plan", nil, false}

      conversation_only_text?(normalized) ->
        judgment_verdict_for_profile("conversation_turn_v1", author_text, prompt)

      # Q3b 能力缺口出口：作者要求把内容写入/存进档案——系统当前无直接写入能力，
      # 判诚实缺口回复（capability_gap 子型），路径经 candidate_directions 给出。
      archive_write_text?(normalized) ->
        {"reply", nil, false}

      # CP4（ADR-0025 决策 2）：请求本身包含多个相互依赖的创作阶段 → 制定计划
      # （与生产判断 prompt 的判别规则同语义：单产物即单动作，多阶段才开计划）。
      multi_stage_plan_text?(normalized) ->
        {"plan", nil, false}

      true ->
        {ref, _summary, _reason_codes} = profile_route_match(normalized)
        judgment_verdict_for_profile(ref, author_text, prompt)
    end
  end

  # B23 CP5 fixture：env 开启 + 作者请求带标记时判断①判 plan；env 关闭零行为变化。
  defp plan_exhaust_plan_verdict?(prompt) do
    plan_exhaust_fixture?() and String.contains?(prompt, @plan_exhaust_marker)
  end

  # 多阶段判定：命中 ≥2 个不同创作能力域即视为多阶段复合请求。
  @plan_stage_probes [
    ["大纲", "章节规划", "梳理"],
    ["重写", "续写", "正文"],
    ["角色档案", "角色演化", "更新相关角色", "人物小传"],
    ["世界观", "伏笔", "门派设定"]
  ]

  defp multi_stage_plan_text?(normalized) do
    @plan_stage_probes
    |> Enum.count(fn probes -> contains_any?(normalized, probes) end)
    |> Kernel.>=(2)
  end

  defp judgment_verdict_for_profile(profile_ref, author_text, prompt) do
    case Map.get(@judgment_capability_for_profile, profile_ref) do
      nil ->
        exploratory =
          not explicit_no_candidate_text?(String.downcase(author_text)) and
            exploratory_prompt_text?(author_text) and
            not candidate_context_followup_prompt?(prompt)

        {"reply", nil, exploratory}

      capability ->
        {"execute", capability, false}
    end
  end

  defp judgment_author_input(prompt) do
    case Regex.run(~r/##\s*作者输入\s*\n(.*?)(?:\n##|\z)/su, prompt) do
      [_, author_text] -> String.trim(author_text)
      _ -> prompt
    end
  end

  defp judgment_narrative_result(prompt) do
    narrative =
      cond do
        # B23-FOLLOWUP：真 no-progress 诱导——两轮都选同一个只读探索（观察字节相同）。
        no_progress_probe_request?(prompt) ->
          no_progress_narrative(prompt)

        # B24 CP3：全章分页读取——首页后按 footer 继续，末页后给引用观察字节的回复。
        full_read_request?(prompt) ->
          full_read_narrative(prompt)

        String.contains?(prompt, "## 探索观察") ->
          exploration_reply_narrative(prompt)

        explore_request_for(prompt) != nil ->
          term = explore_quoted_term(judgment_author_input(prompt))
          "回答这个问题需要正文里的具体事实；我先检索「#{term}」相关的段落再回复你。"

        true ->
          {action, _capability, exploratory} = judgment_verdict(prompt)
          exploratory = exploratory or String.contains?(prompt, @malformed_candidates_marker)
          judgment_narrative_text(action, exploratory, prompt)
      end

    Result.new(narrative, usage_for(prompt, narrative))
  end

  # ── B23-FOLLOWUP：判断循环「真 no-progress」确定性替身 ────────────────────
  # 作者文本含标记时，两轮判断都选择同一个只读探索（archive_read/profile，字节稳定）
  # → 两次 observation 逐字相同 → 第二次 progress_signature 与第一次相同（B24 CP2
  # 已去 sequence）→ runtime 既有 apply_progress_signature 命中 no_progress，
  # 停等 awaiting_author 且丢弃空转步产物。
  @no_progress_marker "UA01NOPROGRESS"
  @no_progress_query "profile"

  defp no_progress_probe_request?(prompt) do
    String.contains?(judgment_author_input(prompt), @no_progress_marker)
  end

  defp no_progress_narrative(prompt) do
    if String.contains?(prompt, "## 探索观察") do
      "同一份档案再看一遍也不会有新信息，我先停下等作者补充方向。"
    else
      "我需要先查阅作品档案的简介面，确认已有事实再回答。"
    end
  end

  # ── B24 CP3：判断循环内部翼「全章可读」确定性替身 ────────────────────────
  # 场景：作者怀疑某章有重复，要求核对全章。替身只做三件机械事：
  #   1) 首轮从判断 prompt 的章节索引复制唯一 chapter_ref，query offset=0；
  #   2) 拿到观察后逐字使用页面 footer 里的续读 JSON（不自己拼 offset）；
  #   3) 末页（无 footer）后回复字节引用观察里含末页锚点的行（N-NARR：不伪造内容）。
  # 触发条件用本场景章标题 + 「全章/核对/重复」唯一锚定，其它场景 prompt 不命中。
  defp full_read_request?(prompt) do
    author_text = judgment_author_input(prompt)

    String.contains?(author_text, @full_read_chapter_title) and
      contains_any?(author_text, @full_read_request_probes)
  end

  # 判断 prompt 的章节索引行（模型可见，B24 I-READ-9 双面身份）：
  #   - 第 N 章「<title>」[chapter_ref=chapter:<uuid>]（计划中）
  # 复制**有已采纳正文**那个章（索引行无「（计划中）」= 目标章 B）的 ref；
  # 同名干扰章 A 带「（计划中）」被排除。绝不按标题直接当查询（会命中歧义观察）。
  defp full_read_chapter_ref(prompt) do
    entries =
      prompt
      |> String.split("\n")
      |> Enum.flat_map(&parse_chapter_entry_line/1)
      |> Enum.filter(&(&1.chapter_ref != nil and &1.title == @full_read_chapter_title))

    case Enum.find(entries, & &1.has_prose) || List.first(entries) do
      nil -> nil
      entry -> entry.chapter_ref
    end
  end

  # 判断 prompt 里已渲染的观察段（`### 观察 N（tool「query」）\n<observation.summary>`）。
  # 观察 summary 内无空行（seed 正文不含 "\n\n"），因此每条观察以空行/文末为界；
  # 用惰性匹配逐条切出，避免观察正文里的换行干扰分界。
  defp full_read_observation_summaries(prompt) do
    ~r/### 观察 \d+（[^\n]*）\n(.*?)(?:\n\n|\z)/su
    |> Regex.scan(prompt, capture: :all_but_first)
    |> Enum.map(fn
      [summary] -> summary
      _ -> ""
    end)
  end

  defp full_read_last_observation(prompt) do
    case full_read_observation_summaries(prompt) do
      [] -> nil
      summaries -> List.last(summaries)
    end
  end

  defp full_read_continuation_query(summary) do
    case Regex.run(@full_read_footer_pattern, summary) do
      [_, query] -> query
      _ -> nil
    end
  end

  # 末页观察里「含末页锚点的行」——回复按字节引用它，保持 N-NARR。
  defp full_read_cited_excerpt(summary) do
    summary
    |> String.split("\n")
    |> Enum.find(&String.contains?(&1, @full_read_last_page_anchor_marker))
    |> case do
      nil -> String.slice(summary, 0, 80)
      line -> String.trim(line)
    end
  end

  defp full_read_narrative(prompt) do
    case full_read_last_observation(prompt) do
      nil ->
        "要核对全章是否有重复，需要先把整章读完。我先按章节唯一编号读取「#{@full_read_chapter_title}」的完整正文。"

      summary ->
        if full_read_continuation_query(summary) do
          "首页只返回了前 6000 字符，剩余部分还没读到；我接着往后读完整章。"
        else
          "我逐页读完了整章正文，依据如下：\n\n#{full_read_cited_excerpt(summary)}\n\n" <>
            "以上就是第二页正文里关于手印的原文。"
        end
    end
  end

  defp full_read_decision_result(prompt) do
    case full_read_last_observation(prompt) do
      nil ->
        # 首轮：从章节索引复制唯一 chapter_ref，纯 ref 寻址（不用标题）。
        case full_read_chapter_ref(prompt) do
          nil ->
            judgment_cited_reply_decision_result(prompt)

          ref ->
            judgment_explore_decision_result(prompt, %{
              "tool" => "chapter_read",
              "query" => "{\"chapter_ref\":\"#{ref}\",\"offset\":0}"
            })
        end

      summary ->
        # 第二轮：footer 里的续读 JSON 逐字作为下一次 explore query。
        case full_read_continuation_query(summary) do
          nil ->
            judgment_cited_reply_decision_result(prompt)

          query ->
            judgment_explore_decision_result(prompt, %{
              "tool" => "chapter_read",
              "query" => query
            })
        end
    end
  end

  # 回环第二判的回复：字节透传观察段命中行（含引用词的行），保持"回复引用检索
  # 事实"的产品语义可被外部验收（不由桩代答产品内容——引用行来自观察=检索结果）。
  defp exploration_reply_narrative(prompt) do
    term = explore_quoted_term(judgment_author_input(prompt))

    cited_line =
      prompt
      |> String.split("## 探索观察", parts: 2)
      |> List.last()
      |> String.split("\n")
      |> cited_observation_line(term)

    if explore_tool_for(judgment_author_input(prompt)) == "session_adoptions" do
      case Jason.decode(String.trim(cited_line)) do
        {:ok, %{"items" => items}} ->
          body =
            Enum.map_join(items, "\n", &"#{&1["title"]}：#{&1["body_preview"]}（#{&1["status"]}）")

          "我查询了当前会话的候选，依据如下：\n\n" <> body

        _ ->
          "查询没有返回可核对的候选，依据如下：未找到匹配项。"
      end
    else
      "我检索了正文中与「#{term}」相关的段落，依据如下：\n\n#{String.trim(cited_line)}\n\n" <>
        "以上就是正文里关于「#{term}」的既有事实。"
    end
  end

  defp explore_quoted_term(author_text) do
    case Regex.run(~r/「([^」]+)」/u, author_text) do
      [_, quoted] -> quoted
      _ -> ""
    end
  end

  # 优先取带章名出处的命中行（「第0X章…」片段行）；段头（### 观察 N）含查询词
  # 但不是引用，排除。命中行连同后续至多 2 行非空行成块（chapter_read 的
  # 【计划】/【摘要】紧随标题行，引用块才携带设计态内容）。
  defp cited_observation_line(_lines, ""), do: ""

  defp cited_observation_line(lines, term) do
    hit_line = fn line ->
      String.contains?(line, term) and not String.starts_with?(line, "###")
    end

    index =
      Enum.find_index(lines, fn line -> hit_line.(line) and line =~ ~r/「第[^」]*」/u end) ||
        Enum.find_index(lines, hit_line)

    case index do
      nil ->
        ""

      index ->
        lines
        |> Enum.drop(index)
        |> Enum.take(3)
        |> Enum.take_while(fn line ->
          trimmed = String.trim(line)
          trimmed != "" and not String.starts_with?(trimmed, "###")
        end)
        |> Enum.join("\n")
    end
  end

  # 判断结构不可用诱导（ADR-0025 判断纪元语义）：garbage = 单次判断响应返回原始垃圾
  # payload（无合法 tool call）；bad-frame = 结构完整但 action 非法（模型仍说帧
  # 语言）。两者都应触发协议携带片段重试一次 → 仍坏 → S7 安全失败终局。
  defp judgment_decision_result(prompt) do
    cond do
      String.contains?(prompt, @garbage_json_marker) ->
        garbage = "not valid json {{{ AU01GARBAGE raw provider payload"
        Result.new(garbage, usage_for(prompt, garbage))

      String.contains?(prompt, @invalid_frame_marker) ->
        judgment_invalid_action_result(prompt)

      true ->
        judgment_decision_result_for(prompt)
    end
  end

  defp judgment_invalid_action_result(prompt) do
    reasoning = "structure_complete_but_action_invalid"

    Result.new(reasoning, usage_for(prompt, reasoning),
      tool_calls: [
        %{
          "id" => "call_judgment_decision",
          "name" => "judgment_decision",
          "arguments" => %{
            "action" => "creative_exploration_frame",
            "reason" => "model_still_speaks_frame_language",
            "reply_included" => false
          }
        }
      ]
    )
  end

  defp judgment_decision_result_for(prompt) do
    request = explore_request_for(prompt)

    cond do
      # B23-FOLLOWUP：两轮都探索同一个只读面（archive_read/profile），第二次观察
      # 字节与第一次完全相同 → progress_signature 重复 → runtime 既有 no_progress 停等。
      no_progress_probe_request?(prompt) ->
        judgment_explore_decision_result(prompt, %{
          "tool" => "archive_read",
          "query" => @no_progress_query
        })

      # B24 CP3：全章分页读取的决策（首轮 ref 寻址 → footer JSON 续读 → reply）。
      full_read_request?(prompt) ->
        full_read_decision_result(prompt)

      # 单次判断响应内嵌引用回复叙事（依据如下）→ 回环收束 reply
      String.contains?(prompt, "依据如下") ->
        judgment_cited_reply_decision_result(prompt)

      request != nil ->
        judgment_explore_decision_result(prompt, request)

      true ->
        judgment_decision_verdict_result(prompt)
    end
  end

  defp judgment_cited_reply_decision_result(prompt) do
    arguments = %{
      "action" => "reply",
      "reason" => "context_sufficient_for_direct_reply",
      "reply_included" => true,
      "frame_type" => "question_answer",
      "dialogue_goal" => judgment_dialogue_goal(prompt)
    }

    reasoning = "judgment_reply_after_exploration"

    Result.new(reasoning, usage_for(prompt, reasoning),
      tool_calls: [
        %{
          "id" => "call_judgment_decision",
          "name" => "judgment_decision",
          "arguments" => Map.put_new(arguments, "record_only", false)
        }
      ]
    )
  end

  # CP5a 内部翼：作者点名查正文事实（「」引用词 + 查/检索类动词）且判断 prompt
  # 开放「探索目录」时判 explore（explore_request 点名 prose_search + 引用词）；
  # prompt 已带「探索观察」段则不再探索（回环第二判），由 reply 引用观察收束。
  defp explore_request_for(prompt) do
    author_text = judgment_author_input(prompt)

    # 单调用判断：探索目录开放且尚无观察段；或 content 回声（先检索「）标记本轮已判探索。
    explore_context? =
      (String.contains?(prompt, "## 探索目录") and
         not String.contains?(prompt, "## 探索观察")) or
        String.contains?(prompt, "我先检索「")

    with true <- explore_context?,
         tool when is_binary(tool) <- explore_tool_for(author_text),
         query when is_binary(query) <- explore_query_for(tool, author_text) do
      %{"tool" => tool, "query" => query}
    else
      _ -> nil
    end
  end

  # archive_read 的 query 是档案面名（VS-00F CP1：账面问句固定读 ledgers 面）；
  # 其余工具沿用引用词。
  defp explore_query_for("archive_read", _author_text), do: "ledgers"

  defp explore_query_for(_tool, author_text) do
    case Regex.run(~r/「([^」]+)」/u, author_text) do
      [_, term] -> term
      _ -> nil
    end
  end

  # 账面问句 → archive_read(ledgers)（VS-00F CP1，优先于泛检索词）；设计态问句
  # （按计划/大纲/要写什么）→ chapter_read；正文事实问句 → prose_search。
  defp explore_tool_for(author_text) do
    cond do
      String.contains?(author_text, "会话待采纳") -> "session_adoptions"
      contains_any?(author_text, ["改写", "重写", "续写", "正文草稿"]) -> nil
      contains_any?(author_text, ["账面", "账本", "进度账", "脉络", "审读"]) -> "archive_read"
      contains_any?(author_text, ["按计划", "计划要写", "大纲里", "计划里"]) -> "chapter_read"
      contains_any?(author_text, ["查一下", "检索", "出现过", "正文里"]) -> "prose_search"
      true -> nil
    end
  end

  defp judgment_explore_decision_result(prompt, request) do
    arguments = %{
      "action" => "explore",
      "reason" => "missing_work_facts_require_retrieval",
      "reply_included" => false,
      "frame_type" => nil,
      "dialogue_goal" => judgment_dialogue_goal(prompt),
      "explore_request" => request
    }

    reasoning = "judgment_explore"

    Result.new(reasoning, usage_for(prompt, reasoning),
      tool_calls: [
        %{
          "id" => "call_judgment_decision",
          "name" => "judgment_decision",
          "arguments" => Map.put_new(arguments, "record_only", false)
        }
      ]
    )
  end

  defp judgment_decision_verdict_result(prompt) do
    {action, capability, exploratory} = judgment_verdict(prompt)

    directions = judgment_verdict_directions(exploratory, prompt)

    arguments =
      %{
        "action" => action,
        "reason" => judgment_reason_code(action),
        "reply_included" => action == "reply"
      }
      |> then(fn args ->
        if capability, do: Map.put(args, "capability", capability), else: args
      end)
      |> then(fn args ->
        if directions in [[], nil],
          do: args,
          else: Map.put(args, "candidate_directions", directions)
      end)
      |> then(fn args ->
        # Q3c：存档意图消息本身携带内容原文——注册信号置真（与生产判别规则同语义）。
        if archive_write_prompt?(prompt),
          do:
            Map.merge(args, %{
              "author_content_registration" => true,
              "author_content_source_ref" => "current"
            }),
          else: args
      end)
      |> then(fn args ->
        case judgment_reply_frame(action, exploratory, prompt) do
          {nil, goal} ->
            args
            |> Map.put("frame_type", nil)
            |> Map.put("dialogue_goal", goal)

          {frame_type, goal} ->
            args
            |> Map.put("frame_type", frame_type)
            |> Map.put("dialogue_goal", goal)
        end
      end)

    arguments =
      arguments
      |> message_state_arguments(prompt)
      |> candidate_semantics_arguments(prompt)
      |> pending_lifecycle_arguments(prompt)
      |> adopted_revision_arguments(prompt)
      |> chapter_revision_arguments(prompt)

    reasoning = judgment_reason_code(action)

    Result.new(reasoning, usage_for(prompt, reasoning),
      tool_calls: [
        %{
          "id" => "call_judgment_decision",
          "name" => "judgment_decision",
          "arguments" => Map.put_new(arguments, "record_only", false)
        }
      ]
    )
  end

  # BIZ-05 外部页面故障注入：模型理解与输出冲突，覆盖一次纠正及持续拒绝。
  defp candidate_semantics_arguments(arguments, prompt) do
    input = judgment_author_input(prompt)
    corrected? = String.contains?(prompt, "本次响应未通过契约校验：")

    cond do
      String.contains?(input, "仅记录纠正样例") ->
        args =
          Map.merge(arguments, %{
            "action" => "reply",
            "record_only" => true,
            "frame_type" => "meta_discussion",
            "author_content_registration" => false,
            "candidate_directions" => []
          })

        if corrected?,
          do: args,
          else:
            Map.put(args, "candidate_directions", [%{"title" => "角色展开", "pitch" => "展开旧书铺主人"}])

      String.contains?(input, "仅记录持续矛盾样例") ->
        Map.merge(arguments, %{
          "action" => "reply",
          "record_only" => true,
          "frame_type" => "creative_exploration",
          "candidate_directions" => [%{"title" => "角色展开", "pitch" => "不应擅自展开"}]
        })

      String.contains?(input, "流程建议持续矛盾样例") or
          (String.contains?(input, "流程建议纠正样例") and not corrected?) ->
        Map.merge(arguments, %{
          "action" => "reply",
          "record_only" => false,
          "frame_type" => "capability_gap",
          "candidate_directions" => [%{"title" => "丢弃候选", "pitch" => "放弃这份资料"}]
        })

      true ->
        arguments
    end
  end

  # 判定候选构造（从 verdict_result 抽出降圈复杂度；语义原样）。
  defp judgment_verdict_directions(exploratory, prompt) do
    cond do
      String.contains?(prompt, @malformed_candidates_marker) ->
        # 坏候选结构（与旧帧路径同款诱导）：对象而非数组——消费层应降级兜底候选。
        %{"title" => "", "pitch" => ""}

      exploratory ->
        candidate_directions(true, prompt)

      true ->
        []
    end
  end

  defp judgment_narrative_text("reply", exploratory, prompt) do
    cond do
      String.contains?(judgment_author_input(prompt), "岑舟今年多少岁") ->
        if String.contains?(prompt, "三十岁") do
          "根据当前已保存的作品设定，岑舟今年三十岁。二十五岁是已被替代的历史版本。"
        else
          "我当前没有读到已保存的岑舟年龄。"
        end

      message_state_request?(prompt) ->
        message_state_narrative(prompt)

      archive_write_prompt?(prompt) ->
        "你要把这份内容直接写入作品档案；我现在没有直接写入档案的能力，做不到这一步。" <>
          "最近的路径是：我先把内容整理成待采纳的设定候选，你在候选卡上采纳后它才会进入档案。"

      true ->
        judgment_reply_body_narrative(exploratory, prompt)
    end
  end

  defp judgment_narrative_text("execute", _exploratory, prompt) do
    if adopted_revision_request?(prompt) do
      "我会生成一份修订候选，保留旧版本；你确认替代后新版本才成为当前作品事实。"
    else
      "你要的是一个明确的创作动作，一步就能完成；我准备直接执行，产出待采纳候选。"
    end
  end

  defp judgment_narrative_text("await_author", _exploratory, _prompt) do
    "我理解你希望增加第一章的篇幅，但还需要你明确扩写方式；请补充具体方向后，我再继续。"
  end

  defp judgment_narrative_text(_action, _exploratory, _prompt) do
    "这件事需要多个相互依赖的步骤；我会先制定一份可预览的计划再逐步推进。"
  end

  # 外部多轮场景的确定性提供者：从实际上下文选来源与状态，生产 provider 不含此逻辑。
  defp message_state_request?(prompt) do
    input = judgment_author_input(prompt)

    contains_any?(input, [
      "先只记录这份资料",
      "上一条资料原文",
      "资料处理进度",
      "读取结果回顾",
      "会话候选数量",
      "请修改现有候选",
      "请放弃原候选",
      "请放弃修订稿",
      "没说是哪份"
    ])
  end

  defp message_state_facts(prompt) do
    prompt
    |> String.split("\n")
    |> Enum.find_value(%{}, fn line ->
      case Jason.decode(String.trim(line)) do
        {:ok, %{"author_inputs" => _} = facts} -> facts
        _ -> nil
      end
    end)
  end

  defp message_state_arguments(arguments, prompt) do
    if message_state_request?(prompt) do
      source = registration_source(message_state_facts(prompt))

      facts = message_state_facts(prompt)

      existing? = materialized_message_source?(facts, source)

      registration? =
        String.contains?(judgment_author_input(prompt), "上一条资料原文") and
          (not existing? or String.contains?(judgment_author_input(prompt), "重复登记同源样例"))

      Map.merge(arguments, %{
        "frame_type" => if(registration?, do: "capability_gap", else: "question_answer"),
        "author_content_registration" => registration? and not is_nil(source),
        "record_only" => String.starts_with?(judgment_author_input(prompt), "先只记录这份资料"),
        "author_content_source_ref" =>
          if(registration? and source, do: source["turn_ref"], else: nil)
      })
      |> author_registration_boundary_arguments(prompt)
    else
      arguments
    end
  end

  defp registration_source(facts) do
    facts
    |> Map.get("author_inputs", [])
    |> Enum.find(&String.starts_with?(&1["text"] || "", "先只记录这份资料"))
  end

  defp registration_adoptions(facts) do
    source = registration_source(facts)
    ref = if source, do: "author_input:#{source["turn_ref"]}"

    ((facts["pending_adoptions"] || []) ++ (facts["resolved_adoptions"] || []))
    |> Enum.filter(&(is_binary(ref) and &1["source_ref"] == ref))
  end

  defp materialized_message_source?(facts, source) do
    is_map(source) and
      Enum.any?(
        (facts["pending_adoptions"] || []) ++ (facts["resolved_adoptions"] || []),
        &(&1["source_ref"] == "author_input:#{source["turn_ref"]}" and
            &1["status"] in ["TENTATIVE", "ACCEPTED", "EDITED_ACCEPTED"])
      )
  end

  defp pending_lifecycle_arguments(arguments, prompt) do
    input = judgment_author_input(prompt)
    pending = message_state_facts(prompt)["pending_adoptions"] || []

    operation = lifecycle_operation(input)
    target = lifecycle_target(pending, input)

    cond do
      String.contains?(input, "没说是哪份") ->
        Map.merge(arguments, %{
          "action" => "await_author",
          "frame_type" => "meta_discussion",
          "candidate_directions" => []
        })

      operation ->
        Map.merge(arguments, %{
          "action" => "execute",
          "capability" => operation,
          "dialogue_goal" =>
            if(operation == "revise_pending_artifact",
              do: "把沈砚改成林渡，保留其余内容和校验标识，只生成修订候选。",
              else: "放弃指定候选，不写入作品事实。"
            ),
          "frame_type" => nil,
          "pending_artifact_ref" => target && target["artifact_ref"],
          "author_content_registration" => false,
          "record_only" => false,
          "candidate_directions" => []
        })

      true ->
        arguments
    end
  end

  defp lifecycle_operation(input) do
    cond do
      String.contains?(input, "请修改现有候选") -> "revise_pending_artifact"
      String.contains?(input, "请放弃原候选") -> "discard_pending_artifact"
      String.contains?(input, "请放弃修订稿") -> "discard_pending_artifact"
      true -> nil
    end
  end

  defp lifecycle_target(pending, input) do
    Enum.find(pending, fn entry ->
      if String.starts_with?(input, "请放弃修订稿"),
        do: entry["revision_of"] != nil,
        else: entry["revision_of"] == nil and String.contains?(entry["body_preview"] || "", "沈砚")
    end)
  end

  @doc """
  B28 CP1.5/CP2：从判断 prompt 的「可选章级修订目标」段与作者原话解析章级修订参数。
  返回 %{capability/adopted_content_ref/modification_scope/dialogue_goal}；
  无章级意图/无可用章目标返回 nil。仅 test-support，不参与产品协议字段（judgment
  schema 不接受 modification_scope；产品按 dialogue_goal/作者原话确定性推导范围）。
  """
  def chapter_revision_arguments(prompt) when is_binary(prompt) or is_map(prompt) do
    prompt_text = prompt_to_text(prompt)
    targets = chapter_revision_targets_from_prompt(prompt_text)
    author_text = judgment_author_input(prompt_text)

    if targets != [] and chapter_revision_intent?(author_text) do
      %{
        capability: "revise_adopted_content",
        adopted_content_ref: chapter_revision_target_ref(targets, author_text),
        modification_scope: chapter_revision_scope(author_text),
        dialogue_goal: author_text
      }
    else
      nil
    end
  end

  def chapter_revision_arguments(_prompt), do: nil

  defp prompt_to_text(prompt) when is_binary(prompt), do: prompt

  defp prompt_to_text(%{messages: messages}) do
    messages
    |> List.wrap()
    |> Enum.map_join("\n", fn
      %{content: content} when is_binary(content) -> content
      _ -> ""
    end)
  end

  defp chapter_revision_targets_from_prompt(prompt) do
    ~r/^\s*-\s*(chapter:[0-9a-fA-F-]+)｜([^｜\n]+)｜片段数\s*(\d+)｜覆盖\s*([^\s｜]+)/mu
    |> Regex.scan(prompt)
    |> Enum.map(fn [_, ref, title, count, coverage] ->
      %{
        ref: String.trim(ref),
        title: String.trim(title),
        fragment_count: String.to_integer(count),
        coverage: String.trim(coverage)
      }
    end)
  end

  defp chapter_revision_intent?(author_text) do
    text = to_string(author_text)

    String.contains?(text, ["正文", "章节", "章", "已保存", "已采纳"]) and
      contains_any?(text, ["整理", "修订", "调整", "排版", "分段", "标点", "通读", "改"])
  end

  defp chapter_revision_scope(author_text) do
    text = to_string(author_text)

    cond do
      Regex.match?(
        ~r/(只|仅).{0,10}(调整|调|改|整理).{0,10}(分段|排版|标点)|不改字句|不要改字句|别改字句|字句.{0,6}(不变|别动)/u,
        text
      ) ->
        "format_only"

      Regex.match?(~r/(整章|全章|整篇|全文|通读)/u, text) ->
        "whole_chapter"

      true ->
        "target_segments"
    end
  end

  # 目标章选择只用唯一证据：原话章序号/标题唯一匹配；否则单目标；多目标不猜（nil 交产品守卫）。
  defp chapter_revision_target_ref([], _author_text), do: nil

  defp chapter_revision_target_ref([target], _author_text), do: target.ref

  defp chapter_revision_target_ref(targets, author_text) do
    text = to_string(author_text)

    seq = chapter_seq_from_text(text)
    title_matches = Enum.filter(targets, &chapter_title_matches?(&1.title, text))

    cond do
      seq != nil and Enum.count(targets, &(chapter_seq(&1.title) == seq)) == 1 ->
        Enum.find(targets, &(chapter_seq(&1.title) == seq)).ref

      length(title_matches) == 1 ->
        hd(title_matches).ref

      true ->
        nil
    end
  end

  defp chapter_seq_from_text(text) do
    case Regex.run(~r/第\s*([0-9一二三四五六七八九十]+)\s*章/u, text) do
      [_, raw] ->
        case Integer.parse(raw) do
          {n, ""} -> n
          _ -> cn_chapter_seq(raw)
        end

      _ ->
        nil
    end
  end

  @cn_chapter_digits %{
    "一" => 1,
    "二" => 2,
    "三" => 3,
    "四" => 4,
    "五" => 5,
    "六" => 6,
    "七" => 7,
    "八" => 8,
    "九" => 9,
    "十" => 10
  }

  defp cn_chapter_seq(raw), do: Map.get(@cn_chapter_digits, raw)

  defp chapter_seq(title) do
    case Regex.run(~r/第\s*([0-9一二三四五六七八九十]+)\s*章/u, to_string(title)) do
      [_, raw] ->
        case Integer.parse(raw) do
          {n, ""} -> n
          _ -> cn_chapter_seq(raw)
        end

      _ ->
        nil
    end
  end

  defp chapter_title_matches?(title, text) do
    title = to_string(title)
    core = title |> String.split(["：", ":"], parts: 2) |> List.last() |> String.trim()

    (String.length(core) >= 2 and String.contains?(text, core)) or
      String.contains?(text, title)
  end

  defp chapter_revision_arguments(arguments, prompt) do
    case chapter_revision_arguments(prompt) do
      nil ->
        arguments

      revision ->
        Map.merge(arguments, %{
          "action" => "execute",
          "capability" => revision.capability,
          "adopted_content_ref" => revision.adopted_content_ref,
          "pending_artifact_ref" => nil,
          "frame_type" => nil,
          "dialogue_goal" => revision.dialogue_goal,
          "candidate_directions" => [],
          "author_content_registration" => false,
          "record_only" => false
        })
    end
  end

  # Q1c 已采纳设定修订：判断 prompt 在「已采纳可修订对象」段落列出真实 accepted ref。
  # 这里只消费目录，不猜目标；目标缺失时保持原 verdict（生产会走 await/拒绝路径）。
  defp adopted_revision_arguments(arguments, prompt) do
    ref = accepted_revision_ref(prompt)

    if adopted_revision_request?(prompt) do
      Map.merge(arguments, %{
        "action" => "execute",
        "capability" => "revise_adopted_content",
        "adopted_content_ref" => ref,
        "pending_artifact_ref" => nil,
        "frame_type" => nil,
        "dialogue_goal" => "把已保存设定中岑舟的年龄从二十五岁改成三十岁，其他内容保持不变。",
        "candidate_directions" => [],
        "author_content_registration" => false,
        "record_only" => false
      })
    else
      arguments
    end
  end

  defp adopted_revision_request?(prompt) do
    input = judgment_author_input(prompt)

    accepted_revision_ref(prompt) != nil and String.contains?(input, "已保存") and
      contains_any?(input, ["年龄", "改成", "修订"])
  end

  # 单调用判断 prompt 同时携带「已采纳可修订对象」目录与消息处置事实；两处都必须能
  # 取到真实 accepted ref，不能靠猜最新一条。
  defp accepted_revision_ref(prompt) do
    case Regex.run(
           ~r/##\s*已采纳可修订对象[^\n]*\n\s*-\s*([^：\n]+)：revise_adopted_content/u,
           prompt
         ) do
      [_, ref] -> String.trim(ref)
      _ -> accepted_revision_ref_from_facts(prompt)
    end
  end

  defp accepted_revision_ref_from_facts(prompt) do
    prompt
    |> message_state_facts()
    |> Map.get("resolved_adoptions", [])
    |> Enum.find(fn entry ->
      entry["status"] in ["ACCEPTED", "EDITED_ACCEPTED"] and
        "revise_adopted_content" in (entry["available_operations"] || [])
    end)
    |> case do
      nil -> nil
      entry -> entry["artifact_ref"]
    end
  end

  # 仅在 test/support 注入错误模型决定，供外部真实页面验证业务拒绝与纠正路径。
  defp author_registration_boundary_arguments(arguments, prompt) do
    input = judgment_author_input(prompt)

    cond do
      String.contains?(input, "来源缺失样例") ->
        Map.put(arguments, "author_content_source_ref", nil)

      String.contains?(input, "越界来源样例") ->
        Map.put(arguments, "author_content_source_ref", "unavailable-author-source")

      String.contains?(input, "矛盾动作样例") ->
        Map.merge(arguments, %{"action" => "execute", "capability" => "world_building"})

      String.contains?(input, "一次纠正样例") and
          not String.contains?(prompt, "本次响应未通过契约校验：") ->
        Map.put(arguments, "author_content_source_ref", nil)

      true ->
        arguments
    end
  end

  defp message_state_narrative(prompt) do
    input = judgment_author_input(prompt)
    facts = message_state_facts(prompt)

    source_adoptions = registration_adoptions(facts)

    lifecycle_narrative(input, facts) ||
      cond do
        String.contains?(input, "会话候选数量") ->
          "当前待采纳 #{facts["pending_adoption_count"]} 份，已处置 #{facts["resolved_adoption_count"]} 份，摘要省略 #{facts["omitted_adoptions"]} 份。"

        String.contains?(input, "读取结果回顾") ->
          readonly_result_narrative(facts)

        String.starts_with?(input, "先只记录这份资料") ->
          "已收到这份资料原文，本轮只记录，不生成候选。"

        Enum.any?(
          source_adoptions,
          &(&1["status"] in ["ACCEPTED", "EDITED_ACCEPTED"])
        ) ->
          "这份资料已经采纳入档，已有采纳结果可核对。"

        Enum.any?(source_adoptions, &(&1["status"] == "TENTATIVE")) ->
          "这份资料尚未采纳，请在已有候选卡上采纳。运行结束不代表已经入档。"

        true ->
          "我会引用上一条资料的原文生成待采纳候选，作者采纳后才会入档。"
      end
  end

  defp lifecycle_narrative(input, facts) do
    cond do
      String.contains?(input, "资料处理进度") ->
        "待采纳 #{facts["pending_adoption_count"]} 份，已处置 #{facts["resolved_adoption_count"]} 份。" <>
          Enum.map_join(
            (facts["pending_adoptions"] || []) ++ (facts["resolved_adoptions"] || []),
            "；",
            &"#{&1["status"]}：#{&1["body_preview"]}"
          )

      String.contains?(input, "请修改现有候选") ->
        "我会按要求生成独立修订候选，保留原稿，不自动入档。"

      String.contains?(input, "请放弃") ->
        "我会放弃你指定的待采纳候选，不删除已保存的作品事实。"

      String.contains?(input, "没说是哪份") ->
        "请说明要修改哪份候选，当前不会执行修改。"

      true ->
        nil
    end
  end

  defp readonly_result_narrative(facts) do
    case Enum.find(
           Map.get(facts, "recent_results", []),
           &String.contains?(&1["text"] || "", "项只读上下文读取")
         ) do
      nil -> "没有可核对的读取结果。"
      result -> result["text"]
    end
  end

  defp judgment_reply_body_narrative(exploratory, prompt) do
    reply_body =
      if exploratory do
        "围绕你的方向我给出两个可选切入，见下方候选；你可以直接采纳或继续聊。"
      else
        frame_message(
          slow_work_switch_prompt?(prompt),
          quality_diagnosis_prompt?(prompt),
          meta_discussion_prompt?(prompt),
          false,
          prompt
        )
      end

    "你想直接和我讨论这个话题；当前信息足够，我直接回应你。\n\n" <> reply_body
  end

  defp judgment_reply_frame(action, _exploratory, prompt) when action != "reply",
    do: {nil, judgment_dialogue_goal(prompt)}

  defp judgment_reply_frame("reply", true, prompt),
    do: {"creative_exploration", judgment_dialogue_goal(prompt)}

  defp judgment_reply_frame("reply", false, prompt) do
    cond do
      archive_write_prompt?(prompt) ->
        {"capability_gap", "把作者提供的内容登记进作品档案"}

      quality_diagnosis_prompt?(prompt) ->
        {"question_answer", "诊断章节胜利过轻削弱张力的原因"}

      meta_discussion_prompt?(prompt) ->
        {"meta_discussion", "约定先讨论方案再决定是否生成的协作方式"}

      true ->
        {"casual_reply", judgment_dialogue_goal(prompt)}
    end
  end

  defp judgment_dialogue_goal(prompt) do
    prompt
    |> judgment_author_input()
    |> String.replace(~r/\s+/u, " ")
    |> String.trim()
    |> String.slice(0, 80)
  end

  defp judgment_reason_code("reply"), do: "context_sufficient_for_direct_reply"
  defp judgment_reason_code("execute"), do: "single_capability_satisfies_request"
  defp judgment_reason_code("await_author"), do: "author_direction_required"
  defp judgment_reason_code(_action), do: "multi_step_dependencies_require_plan"

  # Q3b：档案写入类措辞（与生产判断 prompt 的 capability_gap 判别规则同语义）。
  defp archive_write_text?(normalized) do
    contains_any?(normalized, [
      "存档",
      "保存进档案",
      "写入档案",
      "登记进档案",
      "存进档案",
      "登记为作品设定"
    ])
  end

  defp archive_write_prompt?(prompt) do
    prompt |> judgment_author_input() |> String.downcase() |> archive_write_text?()
  end

  # 与帧机器 exploratory_prompt? 同一 terms（判断循环下 S2 候选判定不收窄），
  # 外加候选类显式词；创作产出类输入已被路由规则表先行截获。
  defp exploratory_prompt_text?(author_text) do
    contains_any?(author_text, [
      "生成",
      "角色",
      "方向",
      "怎么切入",
      "小说创作",
      "候选",
      "头脑风暴"
    ])
  end

  defp profile_route_match(normalized) do
    Enum.find_value(profile_route_rules(), default_profile_route(), fn
      {:contains, terms, route} ->
        if contains_any?(normalized, terms), do: route

      {:conversation_only, route} ->
        if conversation_only_text?(normalized), do: route
    end)
  end

  defp profile_route_rules do
    [
      # B11A CP3：开新卷动作（plan_next_volume）由服务端生成的真实作者文本——
      # 「请规划下一卷（第N卷）的卷蓝图与该卷开篇章节大纲。」→ 必定进入章节大纲 profile。
      # 只认产品文本，不认 slice id / 环境变量。
      {:contains, ["规划下一卷", "下一卷的卷蓝图"],
       {"plot_outline_with_context_v1", "模型选择章节大纲工作流。",
        ["model_profile_selected", "plot_outline_text_match"]}},
      {:contains, ["只读批量", "批量读取", "read-only batch", "readonly batch"],
       {"readonly_batch_context_v1", "模型选择只读批量上下文工作流。",
        ["model_profile_selected", "readonly_batch_text_match"]}},
      {:contains, ["正文草稿", "写下一章", "续写", "正文"],
       {"prose_drafting_with_quality_v1", "模型选择正文写作工作流。",
        ["model_profile_selected", "prose_drafting_text_match"]}},
      {:contains, ["章节大纲", "章节计划", "分章大纲", "卷纲", "outline"],
       {"plot_outline_with_context_v1", "模型选择章节大纲工作流。",
        ["model_profile_selected", "plot_outline_text_match"]}},
      {:contains, ["角色演化", "角色成长", "当前状态", "关系变化", "受伤", "黑化"],
       {"character_evolution_with_context_v1", "模型选择角色演化工作流。",
        ["model_profile_selected", "character_evolution_text_match"]}},
      {:contains, ["世界观", "世界设定", "世界规则", "伏笔", "悬念", "线索", "写作规则", "风格规则", "文风"],
       {"world_building_with_context_v1", "模型选择世界设定工作流。",
        ["model_profile_selected", "world_building_text_match"]}},
      {:conversation_only, default_profile_route()},
      {:contains, ["角色阵容", "现有角色", "已有角色", "反派"],
       {"character_design_with_context_v1", "模型选择角色设计工作流。",
        ["model_profile_selected", "character_design_context_text_match"]}}
    ]
  end

  defp default_profile_route do
    {"conversation_turn_v1", "模型选择普通对话回应工作流。",
     ["model_profile_selected", "default_conversation_turn"]}
  end

  defp profile_route_response(profile_ref, summary, reason_codes, author_text) do
    %{
      profile_ref: profile_ref,
      summary: summary,
      reason_codes: reason_codes,
      matched_terms: profile_route_matched_terms(author_text),
      confidence: 1.0
    }
  end

  defp agent_next_step_decision_response(prompt) do
    profile_decision = profile_next_step_decision(prompt)

    decision =
      cond do
        observation_present?(prompt, "artifact_created") ->
          agent_done_packet(prompt)

        not is_nil(profile_decision) ->
          profile_decision

        observation_present?(prompt, "character_roster") and
            String.contains?(prompt, "重复读取角色阵容") ->
          continue_next("再次读取当前角色阵容，检查是否有新增信息。", "character_roster", "none", [
            "agentic_next_step",
            "repeat_roster_probe"
          ])

        observation_present?(prompt, "character_roster") ->
          continue_next("基于已读取的角色阵容设计新的主要反派。", "character_design", "tentative", [
            "agentic_next_step",
            "roster_observation_consumed"
          ])

        true ->
          continue_next("先读取当前作品已确认角色阵容。", "character_roster", "none", [
            "agentic_next_step",
            "missing_roster_observation"
          ])
      end

    structured_next_step_decision(decision, prompt)
  end

  defp structured_next_step_decision(packet, prompt) when is_map(packet) do
    {advanced, plan_holds, new_constraint} = next_step_evaluation(packet, prompt)

    tail = %{
      evaluation_of_last: %{
        advanced: advanced,
        plan_holds: plan_holds,
        new_constraint: new_constraint
      },
      decision: decision_for_plan_holds(packet, plan_holds),
      next_action: Map.fetch!(packet, :next_action),
      plan_revision: plan_revision_for(plan_holds, new_constraint, prompt),
      reason_codes: Map.get(packet, :reason_codes, []),
      confidence: Map.get(packet, :confidence, 1.0)
    }

    Map.fetch!(packet, :reasoning) <> "\n" <> Jason.encode!(tail)
  end

  defp next_step_evaluation(packet, prompt) do
    plan_holds = not String.contains?(prompt, "NNARR_REPLAN_PLAN_HOLDS_FALSE")
    advanced = Map.get(Map.fetch!(packet, :decision), :type) != "no_progress"
    new_constraint = if plan_holds, do: nil, else: "现有计划前提不成立，需要重排下一步。"

    {advanced, plan_holds, new_constraint}
  end

  defp decision_for_plan_holds(packet, false) do
    case Map.fetch!(packet, :decision) do
      %{type: "continue"} -> %{type: "replan"}
      %{"type" => "continue"} -> %{type: "replan"}
      decision -> decision
    end
  end

  defp decision_for_plan_holds(packet, _plan_holds), do: Map.fetch!(packet, :decision)

  defp continue_next(reasoning, target_tool_ref, write_intent, reason_codes) do
    %{
      reasoning: reasoning,
      decision: %{type: "continue"},
      next_action: %{
        target_tool_ref: target_tool_ref,
        write_intent: write_intent,
        risk_hint: "low"
      },
      plan_revision: nil,
      reason_codes: reason_codes,
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

  defp plan_revision_for(false, revision_reason, prompt) do
    %{
      plan_version: prompt_plan_version(prompt) + 1,
      revision_reason: revision_reason
    }
  end

  defp plan_revision_for(_plan_holds, _revision_reason, _prompt), do: nil

  defp prompt_plan_version(prompt) do
    case Regex.run(~r/plan_version:\s*(\d+)/, prompt) do
      [_, value] -> String.to_integer(value)
      _ -> 1
    end
  end

  defp profile_next_step_decision(prompt) do
    cond do
      String.contains?(prompt, "profile_ref: plot_outline_with_context_v1") ->
        plot_outline_next_step_decision(prompt)

      String.contains?(prompt, "profile_ref: prose_drafting_with_quality_v1") ->
        prose_drafting_next_step_decision(prompt)

      String.contains?(prompt, "profile_ref: character_evolution_with_context_v1") ->
        character_evolution_next_step_decision(prompt)

      String.contains?(prompt, "profile_ref: world_building_with_context_v1") ->
        world_building_next_step_decision(prompt)

      String.contains?(prompt, "profile_ref: prose_revision_from_findings_v1") ->
        prose_revision_next_step_decision(prompt)

      true ->
        nil
    end
  end

  defp agent_done_packet(prompt) do
    {summary, reason_code} =
      cond do
        String.contains?(prompt, "profile_ref: plot_outline_with_context_v1") ->
          {"已生成待采纳大纲候选，本轮目标已经满足。", "tentative_outline_draft_created"}

        String.contains?(prompt, "profile_ref: character_evolution_with_context_v1") ->
          {"已生成待采纳角色演化候选，本轮目标已经满足。", "tentative_character_evolution_seed_created"}

        String.contains?(prompt, "profile_ref: world_building_with_context_v1") ->
          {"已生成待采纳世界设定候选，本轮目标已经满足。", "tentative_world_building_seed_created"}

        String.contains?(prompt, "profile_ref: prose_drafting_with_quality_v1") ->
          {"已生成待采纳正文草稿并完成质量复核，本轮目标已经满足。", "tentative_prose_fragment_created"}

        String.contains?(prompt, "profile_ref: prose_revision_from_findings_v1") ->
          {"已生成待采纳修订草稿，本轮目标已经满足。", "tentative_revision_fragment_created"}

        true ->
          {"已生成待采纳角色候选，本轮目标已经满足。", "tentative_character_seed_created"}
      end

    done_next(summary, ["goal_satisfied", reason_code])
  end

  defp plot_outline_next_step_decision(prompt) do
    if observation_present?(prompt, "outline_context") do
      continue_next("基于已读取的章节上下文生成章节大纲草稿。", "plot_outline", "tentative", [
        "agentic_next_step",
        "outline_context_consumed"
      ])
    else
      context_assemble_decision("先读取章节大纲规划上下文。", "missing_outline_context")
    end
  end

  defp prose_drafting_next_step_decision(prompt) do
    if observation_present?(prompt, "prose_context") do
      continue_next("基于已读取的正文上下文生成正文草稿并完成质量复核。", "prose_writing", "tentative", [
        "agentic_next_step",
        "prose_context_consumed"
      ])
    else
      context_assemble_decision("先读取正文写作上下文。", "missing_prose_context")
    end
  end

  defp character_evolution_next_step_decision(prompt) do
    if observation_present?(prompt, "character_evolution_context") do
      continue_next("基于已读取的角色上下文生成角色演化草稿。", "character_evolution", "tentative", [
        "agentic_next_step",
        "character_evolution_context_consumed"
      ])
    else
      context_assemble_decision("先读取角色演化上下文。", "missing_character_evolution_context")
    end
  end

  defp world_building_next_step_decision(prompt) do
    if observation_present?(prompt, "custom") and String.contains?(prompt, "世界设定上下文") do
      continue_next("基于已读取的作品设定上下文生成世界设定草稿。", "world_building", "tentative", [
        "agentic_next_step",
        "world_building_context_consumed"
      ])
    else
      context_assemble_decision("先读取作品设定上下文。", "missing_world_building_context")
    end
  end

  defp prose_revision_next_step_decision(prompt) do
    observations = existing_observation_section(prompt)

    cond do
      String.contains?(observations, "已生成新的修订候选") ->
        continue_next("汇总修订候选给作者确认。", "revision_finalize", "none", [
          "agentic_next_step",
          "revision_candidate_ready"
        ])

      String.contains?(observations, "重新经过 Orchestrator") ->
        continue_next("基于修订计划生成正文修订候选。", "prose_writing", "tentative", [
          "agentic_next_step",
          "revision_plan_consumed"
        ])

      String.contains?(observations, "已读取待修订草稿") ->
        continue_next("制定修订执行策略并重新经过系统裁决。", "revision_plan", "none", [
          "agentic_next_step",
          "revision_source_consumed"
        ])

      true ->
        continue_next("读取待修订草稿和质量发现。", "revision_prepare", "none", [
          "agentic_next_step",
          "missing_revision_source"
        ])
    end
  end

  defp existing_observation_section(prompt) do
    prompt
    |> String.split("## 决策规则", parts: 2)
    |> hd()
  end

  defp context_assemble_decision(summary, reason_code) do
    continue_next(summary, "context_assemble", "none", ["agentic_next_step", reason_code])
  end

  defp observation_present?(prompt, type) do
    String.contains?(prompt, "/ #{type}:") or String.contains?(prompt, "#{type} /")
  end

  defp single_action_plan_response(prompt, author_text) do
    tool_name = tool_name_for_prompt(author_text)

    {authoring_intent, target_chapter, requested_chapter_raw} =
      authoring_intent_for(prompt, author_text)

    target_word_count = target_word_count_from_text(author_text)
    rewrite? = authoring_intent == "rewrite"

    action =
      %{
        action_id: "act-slice-verify",
        action_type: "capability_invocation",
        summary: action_summary(tool_name, author_text),
        target_ref: tool_name,
        write_intent: if(rewrite?, do: "production_candidate", else: "tentative"),
        risk_hint: if(rewrite?, do: "high", else: "low")
      }
      |> maybe_put_authoring(authoring_intent, target_chapter)
      |> maybe_put_requested_chapter_raw(requested_chapter_raw)
      |> maybe_put_target_word_count(target_word_count)

    %{
      plan_goal_summary: "验证工作台 micro plan 入口",
      risk_hint: if(rewrite?, do: "high", else: "low"),
      requires_confirmation_hint: false,
      proposed_actions: [action],
      state_changes_requested: [],
      required_capabilities: [tool_name],
      fallback_message: "如果暂时不能生成，就先继续用对话收束方向。"
    }
  end

  defp multi_step_downgrade_prompt?(text) do
    contains_any?(text, ["同时重写", "多个操作", "多步推进"]) and
      contains_any?(text, ["主角动机", "角色动机"]) and
      String.contains?(text, "伏笔")
  end

  defp multi_step_plan_response do
    %{
      plan_goal_summary: "拆解作者提出的多项创作操作",
      risk_hint: "medium",
      requires_confirmation_hint: false,
      proposed_actions: [
        %{
          action_id: "act-slice-downgrade-prose",
          action_type: "capability_invocation",
          summary: "重写第一章正文草稿",
          target_ref: "prose_writing",
          write_intent: "tentative",
          risk_hint: "medium",
          authoring_intent: "rewrite",
          target_chapter: nil,
          requested_chapter_raw: "第一章",
          target_word_count: nil
        },
        %{
          action_id: "act-slice-downgrade-character",
          action_type: "capability_invocation",
          summary: "更新主角动机设定",
          target_ref: "character_design",
          write_intent: "tentative",
          risk_hint: "medium",
          authoring_intent: "none",
          target_chapter: nil,
          requested_chapter_raw: nil,
          target_word_count: nil
        },
        %{
          action_id: "act-slice-downgrade-foreshadowing",
          action_type: "capability_invocation",
          summary: "整理伏笔清单",
          target_ref: "world_building",
          write_intent: "tentative",
          risk_hint: "medium",
          authoring_intent: "none",
          target_chapter: nil,
          requested_chapter_raw: nil,
          target_word_count: nil
        }
      ],
      state_changes_requested: [],
      required_capabilities: ["prose_writing", "character_design", "world_building"],
      fallback_message: "这个请求包含多项独立创作操作，建议先拆成单个步骤逐步推进。"
    }
  end

  defp maybe_put_authoring(action, nil, _chapter), do: action

  defp maybe_put_authoring(action, intent, chapter) do
    action
    |> Map.put(:authoring_intent, intent)
    |> Map.put(:target_chapter, chapter)
  end

  defp maybe_put_requested_chapter_raw(action, nil), do: action

  defp maybe_put_requested_chapter_raw(action, raw),
    do: Map.put(action, :requested_chapter_raw, raw)

  defp maybe_put_target_word_count(action, nil), do: action
  defp maybe_put_target_word_count(action, n), do: Map.put(action, :target_word_count, n)

  # 目标字数识别（确定性）：作者文本里的"约 N 字 / N 字"。与真实 LLM 的篇幅识别对称。
  defp target_word_count_from_text(text) do
    case Regex.run(~r/(\d+)\s*字/u, text) do
      [_, n] -> String.to_integer(n)
      _ -> nil
    end
  end

  # 续写/重写意图识别（确定性）：仅当 plan prompt 已带「作品章节」列表时才可能续写/重写。
  # 作者「接着/继续/续写/往下写」→ continuation；「推翻/重写/改写」→ rewrite。
  # target_chapter 精确取自 prompt 的作品章节列表（与真实 LLM「精确复制」规则一致）。
  defp authoring_intent_for(prompt, author_text) do
    case accepted_chapters_in_prompt(prompt) do
      [] ->
        {nil, nil, nil}

      chapters ->
        intent =
          cond do
            contains_any?(author_text, ["推翻", "重写", "改写", "重新写"]) ->
              "rewrite"

            contains_any?(author_text, ["接着", "继续", "续写", "往下写", "再写", "补一段", "补写"]) ->
              "continuation"

            true ->
              nil
          end

        resolve_chapter_refs(intent, author_text, chapters)
    end
  end

  # 返回 {intent, target_chapter（planner 匹配到列表的全名，未匹配为 nil）, requested_chapter_raw（作者点名原文）}。
  # 与真实 LLM「精确匹配列表标题或置空」对称：按章号把作者点名的章对到列表全名。
  defp resolve_chapter_refs(nil, _author_text, _chapters), do: {nil, nil, nil}

  defp resolve_chapter_refs(intent, author_text, chapters) do
    case named_chapter_token(author_text) do
      nil ->
        # 未点名具体章（如"接着往下写"）：维持既有"默认归首章"行为，不报缺失。
        {intent, target_chapter_for(chapters), nil}

      token ->
        num = chapter_num(token)
        matched = num && chapter_title_for_num(chapters, num)

        # 点名但匹配不到列表 → target_chapter=nil（block 信号）；匹配到 → 列表全名。
        {intent, matched, token}
    end
  end

  # 章条目（新格式）按 seq 匹配作者点名章号；旧兼容条目按 title 内嵌章号匹配。
  # 返回列表里该章的**真实 title**（target_chapter 必须精确复制 title，不是整行）。
  defp chapter_title_for_num(chapters, num) do
    case Enum.find(chapters, &chapter_entry_num_match?(&1, num)) do
      nil -> nil
      %{title: title} -> title
      title when is_binary(title) -> title
    end
  end

  defp chapter_entry_num_match?(%{seq: seq}, num) when is_integer(seq), do: seq == num
  defp chapter_entry_num_match?(%{title: title}, num), do: chapter_num(title) == num
  defp chapter_entry_num_match?(title, num) when is_binary(title), do: chapter_num(title) == num
  defp chapter_entry_num_match?(_entry, _num), do: false

  defp named_chapter_token(text) do
    case Regex.run(~r/第\s*[0-9零一二三四五六七八九十百两]+\s*章/u, text) do
      [token] -> String.replace(token, ~r/\s+/, "")
      _ -> nil
    end
  end

  @cn_digits %{
    "零" => 0,
    "一" => 1,
    "二" => 2,
    "两" => 2,
    "三" => 3,
    "四" => 4,
    "五" => 5,
    "六" => 6,
    "七" => 7,
    "八" => 8,
    "九" => 9
  }

  # 从"第N章"提取章号（Arabic 或中文 1-99），匹配不出为 nil。
  defp chapter_num(nil), do: nil

  defp chapter_num(text) when is_binary(text) do
    cond do
      match = Regex.run(~r/第\s*(\d+)\s*章/u, text) ->
        match |> Enum.at(1) |> String.to_integer()

      match = Regex.run(~r/第\s*([零一二三四五六七八九十百两]+)\s*章/u, text) ->
        cn_numeral(Enum.at(match, 1))

      true ->
        nil
    end
  end

  defp cn_numeral(s) do
    cond do
      s == "十" -> 10
      String.starts_with?(s, "十") -> 10 + cn_digit(String.slice(s, 1, 8))
      String.contains?(s, "十") -> cn_tens(s)
      true -> cn_digit(s)
    end
  end

  defp cn_tens(s) do
    [tens, ones] = String.split(s, "十", parts: 2)
    cn_digit(tens) * 10 + if(ones == "", do: 0, else: cn_digit(ones))
  end

  defp cn_digit(""), do: 0
  defp cn_digit(s), do: Map.get(@cn_digits, s, 0)

  # planner prompt「## 作品章节」段的条目（B24 I-READ-9：模型可见章节索引带唯一
  # chapter_ref / seq / title 双面身份）。行格式：
  #   - 第 N 章「<title>」[chapter_ref=chapter:<uuid>]（计划中）
  # 旧兼容行（无 `第 N 章「」` 前缀）整行即 title，seq/chapter_ref 为 nil。
  # 返回 `[%{title, seq, chapter_ref, has_prose}]`。
  defp accepted_chapters_in_prompt(prompt) do
    # planner 段头为「## 作品章节（…含已规划但还没写正文的章）」，章节列表取自此段。
    case Regex.run(~r/##\s*作品章节[^\n]*\n(.*?)(?:\n##|\z)/su, prompt) do
      [_, block] ->
        block
        |> String.split("\n")
        |> Enum.flat_map(&parse_chapter_entry_line/1)

      _ ->
        []
    end
  end

  # `- 第 N 章「title」[chapter_ref=chapter:<uuid>]（计划中）` → 结构化条目；
  # 非章节列表行返回 []。判断/planner/探索面章节索引共用同一行格式。
  defp parse_chapter_entry_line(line) do
    case Regex.run(~r/^\s*-\s*(.*\S)\s*$/u, line) do
      [_, body] ->
        planned = String.contains?(body, "（计划中）")

        case Regex.run(
               ~r/^第\s*(\d+)\s*章「(.+?)」\[chapter_ref=(chapter:[0-9a-fA-F-]{36})\]/u,
               body
             ) do
          [_, seq, title, ref] ->
            [
              %{
                title: title,
                seq: String.to_integer(seq),
                chapter_ref: String.downcase(ref),
                has_prose: not planned
              }
            ]

          _ ->
            [%{title: body, seq: nil, chapter_ref: nil, has_prose: not planned}]
        end

      _ ->
        []
    end
  end

  # checkpoint 1 单章续写：默认归第一章（与 driver 续写第 1 章一致）。
  # 兼容产物：条目 map 取 title；纯标题字符串直接返回。
  defp target_chapter_for([%{title: title} | _]), do: title
  defp target_chapter_for([title | _]) when is_binary(title), do: title
  defp target_chapter_for(_chapters), do: nil

  defp tool_name_for_prompt(prompt) do
    cond do
      readonly_character_query_prompt?(prompt) ->
        "character_roster"

      character_evolution_request_prompt?(prompt) ->
        "character_evolution"

      contains_any?(prompt, ["正文", "片段", "开场"]) ->
        "prose_writing"

      contains_any?(prompt, ["角色", "人物", "主角"]) ->
        "character_design"

      contains_any?(prompt, ["大纲", "章节"]) ->
        "plot_outline"

      true ->
        "world_building"
    end
  end

  defp action_summary(tool_name, author_text) do
    summary =
      case tool_name do
        "character_roster" -> "查看当前作品已确认角色列表"
        "prose_writing" -> "生成一段正文草稿"
        "character_design" -> "生成一个角色设定草案"
        "plot_outline" -> "生成一份大纲草案"
        "world_building" -> "生成一组世界设定草案"
        _ -> "生成一组可供作者继续选择的创作方向"
      end

    if String.contains?(author_text, @tool_failure_marker) do
      "#{@tool_failure_marker} #{summary}"
    else
      summary
    end
  end

  defp contains_any?(text, terms) do
    Enum.any?(terms, &String.contains?(text, &1))
  end

  defp author_input_text(prompt) do
    prompt
    |> current_user_message()
    |> case do
      nil -> author_input_text_from_prompt(prompt_text(prompt))
      text -> author_input_text_from_prompt(text)
    end
  end

  defp current_user_message(prompt) when is_list(prompt) do
    prompt
    |> NovelAgent.Provider.normalize_messages()
    |> Enum.reverse()
    |> Enum.find_value(fn
      %{role: "user", content: content} -> content
      _message -> nil
    end)
  end

  defp current_user_message(_prompt), do: nil

  # 依次尝试各代 prompt 的作者输入段体裁；最后一个为判断①（ADR-0025）。
  @author_input_patterns [
    ~r/用户消息：\s*(.*?)\s*$/s,
    ~r/## 用户输入\s*(.*?)\s*## 输出格式/s,
    ~r/##\s*作者输入\s*\n(.*?)(?:\n##|\z)/su
  ]

  defp author_input_text_from_prompt(prompt) do
    Enum.find_value(@author_input_patterns, prompt, fn pattern ->
      case Regex.run(pattern, prompt) do
        [_, text] -> String.trim(text)
        _ -> nil
      end
    end)
  end

  defp author_input_text_from_profile_route_prompt(prompt) do
    case Regex.run(~r/## 作者输入\s*(.*?)\s*## 可选 profile/su, prompt) do
      [_, text] -> String.trim(text)
      _ -> author_input_text_from_prompt(prompt)
    end
  end

  defp explicit_no_candidate_text?(normalized) do
    contains_any?(normalized, ["不生成候选", "不生成草稿", "只交流观点", "先只聊"])
  end

  defp conversation_only_text?(normalized) do
    explicit_no_candidate_text?(normalized) or
      contains_any?(normalized, [
        "不写正文",
        "不要写正文",
        "不用写正文",
        "先聊方向",
        "只聊方向",
        "讨论方向"
      ])
  end

  defp profile_route_matched_terms(text) do
    [
      "角色阵容",
      "现有角色",
      "反派",
      "正文草稿",
      "写下一章",
      "续写",
      "正文",
      "章节大纲",
      "章节计划",
      "角色演化",
      "当前状态",
      "受伤",
      "世界设定",
      "伏笔",
      "线索",
      "写作规则",
      "风格规则",
      "provider 进度",
      "流式进度",
      "只读批量"
    ]
    |> Enum.filter(&String.contains?(text, &1))
  end

  # B27 CP3d：creative prompt 以稳定段标记（SharedRules）识别；anchor 文本仍用于
  # brief/context 抽取，但不再依赖旧模板固定位置。无标记时回退 author_input 抽取。
  defp task_aware_creative_prompt?(text), do: String.contains?(text, "## 创作协作共同规则")

  defp creative_prompt_parts(prompt) do
    case creative_anchor_parts(prompt) do
      {brief, context} ->
        {brief, context}

      nil ->
        {author_input_text_from_prompt(prompt), ""}
    end
  end

  defp creative_anchor_parts(prompt) do
    if task_aware_creative_prompt?(prompt) or String.contains?(prompt, "用户创作简述：") do
      case Regex.run(~r/用户创作简述：(.+?)\n\s*上下文：(.+?)\n\s*重要：/su, prompt) do
        [_, brief, context] -> {String.trim(brief), String.trim(context)}
        _ -> nil
      end
    else
      nil
    end
  end

  # 章节正文 item 标题取章节计划标题（"第N章：标题"，止于下一个分隔符），让采纳后的章节名
  # 是真实章名而非占位。无法识别章号时回退占位标题。
  defp creative_title(prompt, brief, fingerprint) do
    cond do
      character_seed_prompt?(prompt) ->
        "沈砚 #{String.slice(fingerprint, 0, 4)}"

      world_setting_prompt?(prompt) ->
        world_setting_title(prompt, brief, fingerprint)

      true ->
        case Regex.run(~r/第\d+章[：:]\s*[^：:。\n]+/u, brief) do
          [chapter_title] -> String.trim(chapter_title)
          _ -> "待确认正文草稿 #{fingerprint}"
        end
    end
  end

  defp creative_body(prompt, brief, context) do
    cond do
      character_seed_prompt?(prompt) -> character_body(brief, context)
      world_setting_prompt?(prompt) -> world_setting_body(prompt, brief, context)
      true -> prose_body(brief, context)
    end
  end

  defp world_setting_title(prompt, brief, fingerprint) do
    suffix = String.slice(fingerprint, 0, 4)

    case world_setting_kind(prompt, brief) do
      :foreshadowing -> "伏笔：矿区旧账 #{suffix}"
      :style_rule -> "风格规则：审计式悬疑 #{suffix}"
      :world_rule -> "规则：灵气账单 #{suffix}"
      :constraint -> "约束：谜底释放 #{suffix}"
    end
  end

  defp world_setting_body(prompt, brief, context) do
    nonce_line = setting_nonce_line(brief, context)

    lines =
      case world_setting_kind(prompt, brief) do
        :foreshadowing ->
          [
            "伏笔线索：矿区旧账编号会在主角第一次查看欠费记录时出现。",
            "首次出现位置：第一卷矿区调查线。",
            "推进方式：每次出现都揭露一层公司灵气账单黑幕。",
            "回收方式：第三卷用旧账编号证明真正债主并非主角母亲。",
            "风险与禁忌：回收前不得提前说破旧账编号的真实归属。"
          ]

        :style_rule ->
          [
            "风格规则：后续写作保持审计式悬疑和赛博修仙质感。",
            "适用文本范围：公司、灵气账单、矿区调查相关章节。",
            "禁止事项：不得用旁白提前解释谜底，不得让角色无代价获得答案。",
            "推荐写法：用账单、阵纹、巡检记录推动冲突。",
            "后续复核方式：每次采纳正文前检查是否保留悬疑压力。"
          ]

        :world_rule ->
          [
            "世界规则：灵气以公司账单计价，欠费会触发巡检追缴。",
            "适用范围：城市矿区、修士交易所和低阶居民生活线。",
            "例外条件：黑市阵芯可以短时绕过追缴，但会留下审计痕迹。",
            "对人物选择的压力：角色必须在生存、债务和道义之间选择。",
            "与既有设定的关系：不覆盖已有章节计划，只补充可召回的作品规则。"
          ]

        :constraint ->
          [
            "约束内容：谜底回收前不得直接解释旧账编号真实归属。",
            "适用范围：矿区旧账、巡检账单和母亲失踪相关章节。",
            "禁止事项：不得让旁白提前剧透，不得让角色无代价破解账本。",
            "例外条件：只允许以误导性线索推进读者猜测。",
            "后续复核方式：采纳正文前检查信息释放是否仍保留悬念。"
          ]
      end

    [lines, [nonce_line]]
    |> List.flatten()
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n")
  end

  defp world_setting_kind(prompt, brief),
    do: prompt_setting_kind(prompt) || brief_setting_kind(brief)

  defp prompt_setting_kind(prompt) do
    cond do
      String.contains?(prompt, "artifact_type：foreshadowing_seed") ->
        :foreshadowing

      String.contains?(prompt, "artifact_type：style_rule_seed") ->
        :style_rule

      String.contains?(prompt, "artifact_type：world_rule_seed") ->
        :world_rule

      String.contains?(prompt, "artifact_type：constraint_seed") ->
        :constraint

      true ->
        nil
    end
  end

  defp brief_setting_kind(brief) do
    cond do
      contains_any?(brief, ["伏笔", "悬念", "线索", "回收"]) ->
        :foreshadowing

      contains_any?(brief, ["风格", "文风", "写作规则"]) ->
        :style_rule

      contains_any?(brief, ["约束", "限制", "禁止", "不得", "禁忌"]) ->
        :constraint

      contains_any?(brief, ["规则", "规则体系", "世界规则"]) ->
        :world_rule

      true ->
        :world_rule
    end
  end

  defp setting_nonce_line(brief, context) do
    tokens =
      [brief, context]
      |> Enum.join("\n")
      |> random_identifier_tokens()
      |> Enum.take(3)
      |> Enum.join("、")

    if tokens == "", do: "", else: "校验标识：#{tokens}"
  end

  defp prose_body(brief, context) do
    case special_quality_fixture_body(brief, context) do
      nil -> ordinary_prose_body(brief, context)
      body -> body
    end
    |> maybe_append_revision_fingerprint(brief, context)
  end

  defp special_quality_fixture_body(brief, context) do
    if revision_brief?(brief), do: nil, else: first_draft_quality_fixture_body(brief, context)
  end

  defp first_draft_quality_fixture_body(brief, context) do
    cond do
      intentional_rhetoric_prose?(brief, context) -> intentional_rhetoric_body()
      narrative_pacing_mismatch_prose?(brief, context) -> narrative_pacing_mismatch_body()
      action_beat_prose?(brief, context) -> action_beat_body(brief, context)
      true -> nil
    end
  end

  defp ordinary_prose_body(brief, context) do
    target_word_count = target_word_count_in_brief(brief)

    cond do
      continuation_brief?(brief) -> continuation_body(brief, context)
      is_integer(target_word_count) -> length_targeted_body(target_word_count, brief, context)
      true -> opening_body(brief, context)
    end
  end

  # 判断②改进闭环（CP3b）：改进重试的 writer prompt 携带质量 finding 观察——
  # 修正稿统一带修正指纹句（复评桩据此放行），与 body 分支形态无关。
  defp maybe_append_revision_fingerprint(body, brief, context) do
    text = "#{brief}\n#{context}"

    if String.contains?(text, "续行修正指引") or
         String.contains?(text, "违反既有规则且需要作者确认") or
         String.contains?(text, "需要作者确认的设定变化") do
      body <> "\n这一次他改写了约定：已为规则变化补上对应代价，复活的代价是他亲手烧掉了自己的名字。"
    else
      body
    end
  end

  # 作者要“短促 + 动作/打斗/追击”才命中（两类词同时出现），其它正文 slice 不受影响。
  defp action_beat_prose?(brief, context) do
    text = "#{brief}\n#{context}"
    contains_any?(text, ["短促", "短句", "快节奏"]) and contains_any?(text, ["动作", "打斗", "追击", "缠斗"])
  end

  defp intentional_rhetoric_prose?(brief, _context),
    do: String.contains?(to_string(brief), "刻意排比演练")

  defp narrative_pacing_mismatch_prose?(brief, _context),
    do: String.contains?(to_string(brief), "章节节奏错配演练")

  # revision_section 由 application 渲染为「[质量修订要求]…」追加在锚点之后；修订轮即便
  # 上文动作场面雷同，也产出节奏有变化的新稿，证明“按问题重写”确实换了一稿。
  defp revision_brief?(brief), do: String.contains?(to_string(brief), "[质量修订要求]")

  # 句首与行结构高度雷同的短促动作段：形式分析召回后交给 evaluator 判定。
  defp action_beat_body(brief, context) do
    nonce_text =
      "#{brief}\n#{context}" |> random_identifier_tokens() |> Enum.take(1) |> Enum.join("、")

    nonce_line = if nonce_text == "", do: "他咬住暗号继续逼近。", else: "他咬住暗号#{nonce_text}继续逼近。"

    [
      "他猛地侧身。",
      "他一刀劈下。",
      "他反手格挡。",
      "他迈步逼近。",
      nonce_line
    ]
    |> Enum.join("\n")
  end

  defp intentional_rhetoric_body do
    [
      "他要活着。",
      "他要回去。",
      "他要雪耻。"
    ]
    |> Enum.join("\n")
  end

  defp narrative_pacing_mismatch_body do
    [
      "雨落在窗沿。",
      "灯影缓慢地移过旧墙。",
      "他反复擦拭那枚已经干净的杯子。",
      "钟声响过三次，房间里仍然没有新的决定。"
    ]
    |> Enum.join("\n")
  end

  defp character_body(brief, context) do
    nonce_text =
      [brief, context]
      |> Enum.join("\n")
      |> random_identifier_tokens()
      |> Enum.take(3)
      |> Enum.join("、")

    nonce_line =
      if nonce_text == "",
        do: "校验标识：（无）",
        else: "校验标识：#{nonce_text}"

    [
      "定位：灵气交易所稽查官，适合作为主角阵营的冷峻调查者。",
      "动机：查清灵气账单异常背后的权力交易，同时保护被系统规则压迫的普通修士。",
      "背景：出身底层账务区，曾因旧阵芯事故失去重要同伴，因此对交易所内部黑账格外敏感。",
      "关系：会主动避开与现有角色重名，并与黑市、交易所、巡检车势力形成可冲突关系。",
      "弧光：从只相信证据的孤立稽查者，逐步学会把他人托付纳入自己的判断。",
      "外貌：身形瘦削，常穿磨旧的深色制服，左腕嵌着会短暂发光的旧阵芯。",
      "语言风格：短句、克制、带审计式追问，很少表达情绪。",
      "能力体系绑定：擅长读取灵气账单、追踪阵纹流水和识别伪造功法凭证。",
      nonce_line,
      "作品专属维度：可围绕作者请求继续补足境界、功法、社会关系和关键弱点。请求摘要：#{String.slice(brief, 0, 80)}"
    ]
    |> Enum.join("\n")
  end

  # 目标字数槽（Slice B）：作者明确篇幅诉求时，确定性产出有效字数贴近 N 的正文。
  # 以 opening_body 为骨架（含 nonce 句，保 I3），再用带序号的填充句补到 >= N；
  # 序号让句子字节互不相同（不靠重复同句注水）。有效字数落在 [N, N + 一句] 区间。
  defp length_targeted_body(target, brief, context) do
    base = opening_body(brief, context)
    fill_to_word_count([base], effective_count(base), target, 1)
  end

  defp fill_to_word_count(acc, count, target, _idx) when count >= target do
    acc |> Enum.reverse() |> Enum.join("\n")
  end

  defp fill_to_word_count(acc, count, target, idx) do
    line = filler_line(idx)
    fill_to_word_count([line | acc], count + effective_count(line), target, idx + 1)
  end

  defp filler_line(idx) do
    "他在第#{idx}道阵纹前停下脚步，指尖缓缓描过冷硬的刻痕，把这一处岔路的走向与气味默默记进心里。"
  end

  # 从创作简述里取作者篇幅诉求（turn_execution 注入的"目标字数：约 N 字"）。
  defp target_word_count_in_brief(brief) do
    case Regex.run(~r/目标字数：约\s*(\d+)\s*字/u, brief) do
      [_, n] -> String.to_integer(n)
      _ -> nil
    end
  end

  # 有效字数口径与 NovelDomain.ProseWordCount 对齐（字母/表意文字/数字），
  # novel_agent 不依赖 novel_domain，故在此本地实现同口径正则。
  defp effective_count(text) do
    ~r/[^\p{L}\p{N}]/u |> Regex.replace(text, "") |> String.length()
  end

  defp continuation_brief?(brief) do
    contains_any?(brief, ["接着", "继续", "续写", "往下写", "再写", "补一段", "补写", "推翻", "重写", "改写"])
  end

  defp opening_body(brief, context) do
    subject = creative_subject(brief)
    nonce_text = context |> random_identifier_tokens() |> Enum.take(3) |> Enum.join("、")

    nonce_sentence =
      if nonce_text == "", do: "", else: "档案暗码 #{nonce_text} 像冷光一样贴在他的视野边缘，提醒这不是幻觉。"

    [
      roster_presence_sentence(context),
      "夜色压在#{subject}上，灵气账单从屋檐下垂落，像一串即将燃尽的符纸。",
      # D1/D2 词表扩后正文不得含叙事层元词（此句原为「主角停在巷口…」——CP1 组合遗漏，
      # 会让所有 prose 采纳场景撞 require_confirmation）。
      "他停在巷口，听见远处公司巡检车的低鸣，也听见自己腕骨里那枚旧阵芯正在倒数。",
      nonce_sentence,
      "他没有立刻逃跑，而是把欠费记录折进袖中，反手扣住最后一张护身符，朝最黑的楼梯口走去。"
    ]
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n")
  end

  # VS-00F CP1（AU-13）：真实模型带「现有角色」roster 上下文时会让角色出场（M2 达标
  # 跑实证）；确定性正文复刻该行为——取 roster 首个角色名织入首句，令写后摘要人物栏
  # 与弧光账提炼有真实姓名可命中。无 roster 时为空（不虚构角色）。
  # D1/D2 词表扩后正文不得含叙事层元词（「主角/反派/配角」），否则所有 prose 采纳场景
  # 会被质量门禁切到质量复核分支；此处原「向主角确认了暗号」即 CP1 组合遗漏，改为具名/
  # 中性表述（与 opening_body 里「主角停在巷口」→「他停在巷口」的修法同源）。
  defp roster_presence_sentence(context) do
    case Regex.run(~r/## 现有角色[^\n]*\n- ([^（：\n]+)/u, to_string(context)) do
      [_, name] ->
        trimmed = String.trim(name)
        if trimmed == "", do: "", else: "#{trimmed}先一步候在巷口，压低声音与来人对了暗号。"

      _ ->
        ""
    end
  end

  # 续写正文：单段约 500 有效字，2 轮续写叠加初稿（约 168）即可越过 P1 单章 1000 字门槛。
  # 各句互不相同（不靠重复段落注水）；fingerprint 让相邻续写不字节相同。
  defp continuation_body(brief, context) do
    fingerprint = [brief, context] |> Enum.join("|") |> :erlang.phash2() |> Integer.to_string(36)
    nonce_text = context |> random_identifier_tokens() |> Enum.take(2) |> Enum.join("、")

    nonce_line =
      if nonce_text == "",
        do: "矿道深处的旧阵芯仍在倒数，他听得见自己的心跳与符纸燃烧的细响交叠在一起。",
        else: "档案暗码 #{nonce_text} 在视野边缘明灭，像替这条矿道标好了退路与陷阱。"

    [
      "林澈把欠费记录折进袖口，借着护身符的微光辨认岔路，脚下碎石被踩出一连串闷响。",
      "矿道越往里越窄，潮湿的灵气贴着石壁缓缓流动，凝成一层会呼吸的薄霜。",
      "他想起母亲临走前的叮嘱，把翻涌的恐惧压回胸腔，逼自己一步一步丈量这片黑暗。",
      nonce_line,
      "前方传来金属摩擦的声响，像有什么东西在缓慢苏醒，又像巡检傀儡在重新校准刃口。",
      "他屏住呼吸贴着石壁挪动，指尖触到一道被人为凿开的暗槽，里面嵌着半枚冷却的阵钉。",
      "阵钉残留的纹路与他腕骨里的旧阵芯隐隐共鸣，刺痛顺着血管一路爬上后颈。",
      "他咬牙拔出阵钉，黑暗骤然裂开一线幽蓝，照亮墙上密密麻麻、尚未结清的灵气欠条。",
      "那一刻他才真正明白，这座矿区埋着的从来不是矿石，而是无数被账单困住的活人。",
      "身后的脚步声不紧不慢地逼近，他没有回头，只把阵钉攥得更紧，朝幽蓝走得更深。",
      "通道尽头是一扇半塌的阵门，门缝漏出的光像水一样在地面铺开，又被黑暗一点点吞回。",
      "他蹲下身，用阵钉在门槛上刻下一个只有自己看得懂的记号，给将来的退路留一道凭证。",
      "远处的低鸣忽然停了，整条矿道陷入令人牙酸的寂静，连灵气流动的声音都听得清楚。",
      "林澈知道，这种安静往往意味着对方已经发现了他，正等着他先露出破绽。",
      "他缓缓吐出一口浊气，把最后一张护身符贴在心口，做好了随时把命押上去的准备。",
      "黑暗里那串编号 #{fingerprint} 又一次在他脑海里亮起，提醒他记住走过的每一个拐角。"
    ]
    |> Enum.join("\n")
  end

  defp creative_subject(brief) do
    case Regex.run(~r/第\d+章[：:]\s*([^：:\n。]+?)(?:：|正文草稿|$)/u, brief) do
      [_, subject] ->
        String.trim(subject)

      _ ->
        "这座赛博修仙城市"
    end
  end

  defp creative_rationale(prompt, brief) do
    cond do
      character_seed_prompt?(prompt) ->
        "基于当前作品背景、设定与现有角色入口生成角色主档案草稿，未写入作品事实。"

      world_setting_prompt?(prompt) ->
        "基于当前作品背景生成可采纳的档案设定草稿，未写入作品事实。"

      String.contains?(brief, "正文草稿") ->
        "根据作者指定章节生成待确认正文片段，未写入作品事实。"

      true ->
        "根据本次作者输入生成待确认创作素材，未写入作品事实。"
    end
  end

  defp random_identifier_tokens(text) do
    ~r/\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{6,}\b/u
    |> Regex.scan(text)
    |> Enum.map(fn [token] -> token end)
    |> Enum.uniq()
  end

  defp prompt_text(prompt) when is_binary(prompt), do: prompt

  defp prompt_text(prompt) when is_map(prompt) do
    prompt
    |> NovelAgent.Provider.normalize_messages()
    |> Enum.reject(&(&1.role == "system" and &1.content == SystemIdentity.content()))
    |> Enum.map_join("\n", fn message -> "#{message.role}: #{message.content}" end)
  end

  defp prompt_text(prompt) when is_list(prompt) do
    prompt
    |> NovelAgent.Provider.normalize_messages()
    |> Enum.reject(&(&1.role == "system" and &1.content == SystemIdentity.content()))
    |> Enum.map_join("\n", fn message -> "#{message.role}: #{message.content}" end)
  end
end
