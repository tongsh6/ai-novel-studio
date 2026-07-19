defmodule NovelAgent.Provider.Stub do
  @moduledoc """
  Stub provider — 离线/骨架验证用的合法 fixture provider。

  根据 08-provider-abstraction.md §2.4，stub 是正式 provider 实现，用于：
  - greenfield 开发期间离线验证
  - 契约测试（contract test）
  - Provider Gateway 骨架调试

  ## 响应策略

  stub 不调用任何外部 LLM。它根据 prompt 中显式声明的"输出格式契约"识别
  请求类型（frame / plan / creative items），返回对应的最小合法 JSON。
  识别失败时回退为 echo 响应。

  creative items prompt 的响应同时满足：
  - **I3 种子贯通**：保留 user 输入文本中的随机标识符，让它们自然出现在 artifact
  - **I2 输入差异**：`item_id` 从 user input 派生 fingerprint，保证不同输入产生
    不同 id（两两不相交）

  此处持有的 JSON 字面量是 schema 的最小契约样本（contract skeleton，
  不是作品内容），属于 `docs/engineering/scenario-invariants.md` §4 允许
  的字符串字面量。
  """

  @behaviour NovelAgent.Provider

  alias NovelAgent.Provider.AdapterExecution
  alias NovelAgent.Provider.Result

  defstruct []

  @type t :: %__MODULE__{}

  @impl true
  def complete(_state, _model, prompt, _params) do
    {:ok, infer_result(prompt)}
  end

  @impl true
  def execute(_state, _model, prompt, _params, ctx) do
    if AdapterExecution.cancelled?(ctx) do
      AdapterExecution.materialize_cancelled(ctx)
    else
      execute_uncancelled(prompt, ctx)
    end
  end

  defp execute_uncancelled(prompt, ctx) do
    result = infer_result(prompt)
    content = result.content
    initial_events = AdapterExecution.initial_events(ctx)
    chunk_events = AdapterExecution.text_chunk_events(ctx, content, length(initial_events) + 1)

    AdapterExecution.emit_events(ctx, initial_events, :running)
    AdapterExecution.emit_events(ctx, chunk_events, :running)

    if AdapterExecution.cancelled?(ctx) do
      AdapterExecution.materialize_cancelled(ctx,
        initial_events: initial_events ++ chunk_events,
        emit: :terminal
      )
    else
      {:ok, result}
      |> AdapterExecution.materialize_result(
        ctx,
        initial_events: initial_events ++ chunk_events,
        emit: :terminal
      )
    end
  end

  @impl true
  def name, do: "stub"

  @impl true
  def health_check(_state), do: :ok

  # ── prompt 识别 ──

  defp infer_result(prompt) do
    text = prompt_text(prompt)

    judgment_family_result(prompt, text) || infer_non_judgment_result(prompt, text)
  end

  # 判断族分发（ADR-0025）：判断②（观察+续行）先于判断①判别——continuation
  # prompt 也含"创作判断器"措辞，顺序即正确性。两段式：forced tool 结构段 /
  # 自由叙事段；非判断族返回 nil 交回主分发。
  defp judgment_family_result(prompt, text) do
    tool_call? = NovelAgent.Provider.tool_call_prompt?(prompt)

    cond do
      tool_call? and continuation_prompt?(text) -> continuation_decision_result(text)
      continuation_prompt?(text) -> Result.new(continuation_narrative_content(text))
      tool_call? and judgment_prompt?(text) -> judgment_decision_result(text)
      judgment_prompt?(text) and not tool_call? -> Result.new(judgment_narrative_content(text))
      true -> nil
    end
  end

  defp infer_non_judgment_result(prompt, text) do
    cond do
      # 执行内联自评（ADR-0025 CP2）：writer 自由输出严格 JSON（生产同形态），
      # self_report 扩展 goal_achieved/next_suggestion（探针自检契约样本）。
      creative_output_prompt?(text) ->
        creative_output_result(text)

      NovelAgent.Provider.tool_call_prompt?(prompt) and agent_plan_prompt?(text) ->
        native_agent_plan_result(prompt, text)

      # 两段式规划第一段：无 tools 的自由流式 reasoning 调用，只返回叙事 content。
      agent_plan_prompt?(text) ->
        Result.new(agent_plan_reasoning_content(text))

      true ->
        Result.new(infer_response(text))
    end
  end

  # ── 判断①（ADR-0025 方案 B 回复内联）契约样本 ──
  # 按作者输入语义确定性判五选一形态，与真实 LLM 遵循同一契约：简单请求不开计划、
  # 多步复杂任务开计划、缺作品事实先探索、意图不明等作者说清。

  defp judgment_prompt?(text), do: String.contains?(text, "创作判断器")

  defp judgment_narrative_content(text) do
    {action, _capability} = judgment_action(text)
    {action, _extra} = shape_judgment_action(action, text)

    cond do
      action == "reply" and String.contains?(text, "## 探索观察") ->
        judgment_narrative(action) <> "\n\n" <> exploration_cited_reply(text)

      action == "reply" ->
        judgment_narrative(action) <> "\n\n" <> judgment_reply_body()

      true ->
        judgment_narrative(action)
    end
  end

  defp continuation_prompt?(text),
    do: String.contains?(text, "你的两种续行方式") or String.contains?(text, "continuation_decision")

  defp continuation_direction(text) do
    cond do
      String.contains?(text, "质量复核") or String.contains?(text, "质量意见") ->
        {"continue", "按质量意见修正后重新产出。"}

      String.contains?(text, "计划步骤已走完") or String.contains?(text, "尚未完成") ->
        {"continue", "补足产出步，按原目标继续。"}

      true ->
        {"await_author", ""}
    end
  end

  defp continuation_narrative_content(text) do
    case continuation_direction(text) do
      {"continue", _guidance} ->
        "我看到了当前的情况，可以在下一次执行中修正，我会继续完成这轮产出。"

      _ ->
        "这个情况需要你裁决，我先停下来，等你确认后继续。"
    end
  end

  defp continuation_decision_result(text) do
    {action, guidance} = continuation_direction(text)

    Result.new("continuation_#{action}", nil,
      tool_calls: [
        %{
          "name" => "continuation_decision",
          "arguments" => %{
            "action" => action,
            "guidance" => guidance,
            "reason" => "continuation_#{action}"
          }
        }
      ]
    )
  end

  defp creative_output_prompt?(text) do
    String.contains?(text, "self_report") and String.contains?(text, "自评核对清单")
  end

  # 自评方向按探针四用例的确定性规则给出（诚实自评的契约样本）：
  # 前提缺失（引用不存在的章节）/ 设定冲突（同名替换主角）→ 未达成 + 问作者；
  # 多产物请求单次只出一个 → 未达成 + 继续；其余 → 达成 + 收束。
  defp creative_output_result(text) do
    {achieved, suggestion, reason} =
      cond do
        String.contains?(text, "第12章") ->
          {false, "await_author", "请求引用的章节在作品中不存在，需要作者澄清前提。"}

        String.contains?(text, "也叫林烬") or String.contains?(text, "替换现在的主角") ->
          {false, "await_author", "替换主角与已确认设定冲突，属作者裁决事项。"}

        String.contains?(text, "三人") or String.contains?(text, "各一个") ->
          {false, "continue", "单次执行只产出一个候选，剩余成员待继续执行。"}

        true ->
          {true, "finish", "候选已完整覆盖本条请求的目标。"}
      end

    payload = %{
      "items" => [
        %{
          "title" => "候选：黑市秩序官",
          "body" => "一名笃信配额制度的灵气稽查系统旧吏，以规则之名行垄断之实。",
          "rationale" => "与主角的破局动机形成镜像对照。"
        }
      ],
      "self_report" => %{
        "risk_flags" => [],
        "goal_achieved" => achieved,
        "next_suggestion" => suggestion,
        "reason" => reason
      }
    }

    Result.new(Jason.encode!(payload))
  end

  defp judgment_decision_result(text) do
    {action, capability} = judgment_action(text)
    {action, extra_args} = shape_judgment_action(action, text)

    arguments =
      %{
        "action" => action,
        "reason" => judgment_reason(action),
        "reply_included" => action == "reply"
      }
      |> then(fn args ->
        if capability, do: Map.put(args, "capability", capability), else: args
      end)
      |> Map.merge(extra_args)

    Result.new(judgment_reason(action), nil,
      tool_calls: [
        %{"name" => "judgment_decision", "arguments" => arguments}
      ]
    )
  end

  # CP5a 内部翼：explore 仅在判断 prompt 开放「先探索」形态时成立（协议 options
  # 决定五选一/四选一；stub 尊重同一开关）；prompt 已带「探索观察」段则回环收束
  # 为 reply。explore_request 点名 prose_search + 「」引用词（无引用词取查询短语尾）。
  defp shape_judgment_action("explore", text) do
    cond do
      # call1 带观察段 / call2 内嵌引用回复叙事（依据如下）→ 回环收束 reply
      String.contains?(text, "## 探索观察") or String.contains?(text, "依据如下") ->
        {"reply", %{"reply_included" => true}}

      # call1 开放「先探索」形态 / call2 内嵌探索叙事回声 → explore 成立
      String.contains?(text, "先探索") or String.contains?(text, "我需要先检索作品事实") ->
        {"explore",
         %{"explore_request" => %{"tool" => "prose_search", "query" => explore_term(text)}}}

      true ->
        {"reply", %{"reply_included" => true}}
    end
  end

  defp shape_judgment_action(action, _text), do: {action, %{}}

  defp explore_term(text) do
    author_text = judgment_author_input(text)

    case quoted_term(author_text) do
      "" -> author_text |> String.replace(~r/[查一下交代过吗？?，。]/u, "") |> String.slice(0, 8)
      term -> term
    end
  end

  # 顺序即优先级：探索/计划判别在能力词之前（与真实模型的语义判断对齐——
  # "梳理伏笔并重写"是多阶段任务而非世界观请求；"交代过吗"是检索而非演化）。
  @judgment_rules [
    {["交代过", "查一下"], [], {"explore", nil}},
    {["梳理"], ["重写", "更新"], {"plan", "prose_writing"}},
    {["只读批量", "批量读取", "readonly batch"], [], {"execute", "work_archive_read"}},
    {["provider 进度", "模型进度", "流式进度", "流式事件", "provider progress"], [],
     {"execute", "provider_progress"}},
    {["聊聊", "只聊", "先聊", "随便聊"], [], {"reply", nil}},
    {["正文草稿", "写下一章", "续写", "正文"], [], {"execute", "prose_writing"}},
    {["章节大纲", "章节计划", "分章大纲", "卷纲"], [], {"execute", "plot_outline"}},
    {["角色演化", "角色成长", "当前状态", "关系变化", "受伤", "黑化"], [],
     {"execute", "character_evolution"}},
    {["世界观", "世界设定", "世界规则", "伏笔", "写作规则", "风格规则"], [],
     {"execute", "world_building"}},
    {["设计", "新增"], ["角色", "反派", "主角"], {"execute", "character_design"}},
    {["角色阵容", "现有角色", "已有角色"], [], {"execute", "character_design"}}
  ]

  defp judgment_action(text) do
    author_text = text |> judgment_author_input() |> String.trim()

    Enum.find_value(@judgment_rules, judgment_default(author_text), fn {first, second, route} ->
      if contains_any?(author_text, first) and
           (second == [] or contains_any?(author_text, second)),
         do: route
    end)
  end

  defp judgment_default(author_text) do
    if String.length(author_text) <= 6, do: {"await_author", nil}, else: {"reply", nil}
  end

  defp judgment_author_input(text) do
    case Regex.run(~r/##\s*作者输入\s*\n(.*?)(?:\n##|\z)/su, text) do
      [_, author_text] -> String.trim(author_text)
      _ -> text
    end
  end

  defp judgment_narrative(action) do
    case action do
      "reply" -> "你想直接和我讨论这个话题；当前作品摘要里已经有回答需要的信息，我直接回复你。"
      "execute" -> "你要的是一个明确的创作动作，一步就能完成；我准备直接执行，产出待采纳候选。"
      "plan" -> "这件事涉及多个相互依赖的步骤，我需要先制定一份可预览的计划再逐步推进。"
      "explore" -> "回答这个问题需要正文细节，但当前只有结构摘要；我需要先检索作品事实。"
      "await_author" -> "你的意图我还不能确定，先停下来向你确认，避免做错方向。"
    end
  end

  # 回环收束回复：字节透传观察段里含引用词的行（引用来自检索结果，桩不代答）。
  defp exploration_cited_reply(text) do
    term = quoted_term(judgment_author_input(text))

    cited_line =
      text
      |> String.split("## 探索观察", parts: 2)
      |> List.last()
      |> String.split("\n")
      |> cited_observation_line(term)

    "我检索了正文中与「#{term}」相关的段落，依据如下：\n\n#{String.trim(cited_line)}"
  end

  defp quoted_term(author_text) do
    case Regex.run(~r/「([^」]+)」/u, author_text) do
      [_, quoted] -> quoted
      _ -> ""
    end
  end

  # 优先取带章名出处的命中行；段头（### 观察 N）含查询词但不是引用。
  defp cited_observation_line(_lines, ""), do: ""

  defp cited_observation_line(lines, term) do
    hit_line = fn line -> String.contains?(line, term) and not String.starts_with?(line, "###") end

    Enum.find(lines, fn line -> hit_line.(line) and line =~ ~r/「第[^」]*」/u end) ||
      Enum.find(lines, hit_line) || ""
  end

  defp judgment_reason(action) do
    case action do
      "reply" -> "context_sufficient_for_direct_reply"
      "execute" -> "single_capability_satisfies_request"
      "plan" -> "multi_step_dependencies_require_plan"
      "explore" -> "missing_work_facts_require_retrieval"
      "await_author" -> "author_intent_unclear"
    end
  end

  defp judgment_reply_body do
    "从当前作品状态看，这个问题可以直接回答：结构摘要里已经列出了章节与角色现状，" <>
      "你可以基于它继续推进创作方向。"
  end

  defp infer_response(text) do
    cond do
      creative_items_prompt?(text) -> creative_items_json(text)
      profile_routing_prompt?(text) -> profile_routing_json(text)
      agent_next_step_decision_prompt?(text) -> agent_next_step_decision_content(text)
      plan_prompt?(text) -> plan_json()
      frame_prompt?(text) -> frame_json(text)
      true -> "[stub] echo: " <> text
    end
  end

  defp agent_plan_reasoning_content(text) do
    response =
      if agent_plan_revision_prompt?(text) do
        agent_plan_revision_response(text)
      else
        agent_plan_draft_response(text)
      end

    Map.fetch!(response, :reasoning)
  end

  defp agent_plan_prompt?(text),
    do: agent_plan_draft_prompt?(text) or agent_plan_revision_prompt?(text)

  defp creative_items_prompt?(text) do
    String.contains?(text, "JSON 数组") and String.contains?(text, "artifact_type：")
  end

  defp plan_prompt?(text) do
    String.contains?(text, "plan_goal_summary") and String.contains?(text, "proposed_actions")
  end

  defp profile_routing_prompt?(text) do
    String.contains?(text, "AgentRun profile router") and
      String.contains?(text, "\"profile_ref\"")
  end

  defp agent_next_step_decision_prompt?(text) do
    String.contains?(text, "AgentRun 下一步规划器")
  end

  defp agent_plan_draft_prompt?(text) do
    String.contains?(text, "AgentRun 计划起草器")
  end

  defp agent_plan_revision_prompt?(text) do
    String.contains?(text, "AgentRun 计划修订器")
  end

  defp frame_prompt?(text) do
    String.contains?(text, "frame_type") and String.contains?(text, "assistant_message")
  end

  defp profile_routing_json(prompt_text) do
    prompt_text
    |> profile_route_response()
    |> Jason.encode!()
  end

  defp profile_route_response(prompt_text) do
    author_text = profile_route_author_text(prompt_text)
    normalized = String.downcase(author_text)
    {profile_ref, summary, reason_codes} = profile_route_match(normalized)

    profile_route(profile_ref, summary, reason_codes)
    |> Map.put("matched_terms", matched_terms(author_text))
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
      {:contains, ["只读批量", "批量读取", "read-only batch", "readonly batch"],
       {"readonly_batch_context_v1", "模型选择只读批量上下文工作流。",
        ["model_profile_selected", "readonly_batch_text_match"]}},
      {:contains, ["provider 进度", "流式进度", "streaming progress", "UA01CP6SLOW"],
       {"provider_progress_v1", "模型选择模型执行进度工作流。",
        ["model_profile_selected", "provider_progress_text_match"]}},
      {:contains, ["章节大纲", "章节计划", "分章大纲", "卷纲", "outline"],
       {"plot_outline_with_context_v1", "模型选择章节大纲工作流。",
        ["model_profile_selected", "plot_outline_text_match"]}},
      {:contains, ["角色演化", "当前状态", "关系变化", "受伤", "黑化"],
       {"character_evolution_with_context_v1", "模型选择角色演化工作流。",
        ["model_profile_selected", "character_evolution_text_match"]}},
      {:contains, ["世界观", "世界设定", "伏笔", "线索", "写作规则", "风格规则", "文风"],
       {"world_building_with_context_v1", "模型选择世界设定工作流。",
        ["model_profile_selected", "world_building_text_match"]}},
      {:conversation_only, default_profile_route()},
      {:contains, ["正文草稿", "写下一章", "续写", "正文"],
       {"prose_drafting_with_quality_v1", "模型选择正文写作工作流。",
        ["model_profile_selected", "prose_drafting_text_match"]}},
      {:contains, ["角色阵容", "现有角色", "已有角色", "反派"],
       {"character_design_with_context_v1", "模型选择角色设计工作流。",
        ["model_profile_selected", "character_design_context_text_match"]}}
    ]
  end

  defp default_profile_route do
    {"conversation_turn_v1", "模型选择普通对话回应工作流。",
     ["model_profile_selected", "default_conversation_turn"]}
  end

  defp conversation_only_text?(normalized) do
    contains_any?(normalized, [
      "不写正文",
      "不要写正文",
      "不用写正文",
      "先聊方向",
      "只聊方向",
      "讨论方向"
    ])
  end

  defp profile_route(profile_ref, summary, reason_codes) do
    %{
      "profile_ref" => profile_ref,
      "summary" => summary,
      "reason_codes" => reason_codes,
      "matched_terms" => [],
      "confidence" => 1.0
    }
  end

  defp native_agent_plan_result(prompt, prompt_text) do
    response =
      if agent_plan_revision_prompt?(prompt_text) do
        agent_plan_revision_response(prompt_text)
      else
        agent_plan_draft_response(prompt_text)
      end

    Result.new(Map.fetch!(response, :reasoning), nil,
      tool_calls: [
        %{
          "name" => NovelAgent.Provider.tool_choice(prompt) || "agent_plan",
          "arguments" => plan_tool_arguments(response)
        }
      ]
    )
  end

  defp agent_plan_revision_response(prompt_text) do
    prompt_text
    |> String.replace("UA01D6REPLAN", "")
    |> agent_plan_draft_response()
    |> Map.update!(:reasoning, &String.replace(&1, "起草", "修订"))
    |> Map.update!(:reason_codes, fn codes ->
      ["agent_plan_revised" | Enum.reject(codes, &(&1 == "agent_plan_drafted"))]
      |> Enum.uniq()
    end)
  end

  defp agent_plan_draft_response(prompt_text) do
    prompt_text
    |> agent_plan_profile_ref()
    |> agent_plan_draft_response_for_profile(prompt_text)
  end

  defp agent_plan_profile_ref(prompt_text) do
    case Regex.run(~r/profile_ref:\s*([a-z0-9_]+)/, prompt_text, capture: :all_but_first) do
      [profile_ref] -> profile_ref
      _ -> nil
    end
  end

  defp agent_plan_draft_response_for_profile("prose_drafting_with_quality_v1", prompt_text) do
    %{
      reasoning: "[stub] 先读取正文写作上下文，再基于该上下文生成正文草稿并完成质量复核。",
      steps: [
        plan_step("context_assemble", "explore", "先读取正文写作上下文。", [
          "prose_context_observation_created"
        ]),
        prose_writing_plan_step(prompt_text)
      ],
      reason_codes: ["agent_plan_drafted", "prose_plan_drafted"]
    }
  end

  defp agent_plan_draft_response_for_profile(profile_ref, _prompt_text),
    do: agent_plan_draft_response_for_profile(profile_ref)

  defp agent_plan_draft_response_for_profile("character_design_with_context_v1") do
    %{
      reasoning: "[stub] 先读取当前角色阵容，再基于阵容设计待采纳角色候选。",
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

  defp agent_plan_draft_response_for_profile("plot_outline_with_context_v1") do
    %{
      reasoning: "[stub] 先读取章节大纲规划上下文，再基于该上下文生成章节大纲草稿。",
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

  defp agent_plan_draft_response_for_profile("character_evolution_with_context_v1") do
    %{
      reasoning: "[stub] 先读取角色演化上下文，再基于该上下文生成角色演化记忆草稿。",
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

  defp agent_plan_draft_response_for_profile("world_building_with_context_v1") do
    %{
      reasoning: "[stub] 先读取世界设定上下文，再基于该上下文生成世界设定、伏笔或规则草稿。",
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

  defp agent_plan_draft_response_for_profile("provider_progress_v1") do
    %{
      reasoning: "[stub] 直接调用 provider，并只记录 author-safe 进度边界。",
      steps: [
        plan_step("provider_complete", "act", "调用 provider 并记录安全进度事件。", [
          "provider_progress_events_visible",
          "provider_result_completed"
        ])
      ],
      reason_codes: ["agent_plan_drafted", "provider_progress_plan_drafted"]
    }
  end

  defp agent_plan_draft_response_for_profile("readonly_batch_context_v1") do
    %{
      reasoning: "[stub] 先并行读取只读上下文，再汇总给作者，不写入作品也不生成候选。",
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

  defp agent_plan_draft_response_for_profile("prose_revision_from_findings_v1") do
    %{
      reasoning: "[stub] 先读取待修订草稿和质量发现，再完成授权、生成并汇总修订候选。",
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

  defp agent_plan_draft_response_for_profile(_profile_ref) do
    %{
      reasoning: "[stub] 为当前目标起草一条最小执行计划。",
      steps: [
        plan_step("allowed_tool", "act", "执行一个允许能力。", ["goal_progress"])
      ],
      reason_codes: ["agent_plan_drafted"]
    }
  end

  defp plan_tool_arguments(packet) do
    %{
      "plan" => %{"steps" => Map.fetch!(packet, :steps)},
      "reason_codes" => Map.get(packet, :reason_codes, ["agent_plan_drafted"]),
      "confidence" => Map.get(packet, :confidence, 1.0)
    }
  end

  defp plan_step(target_tool_ref, kind, description, success_criteria) do
    %{
      "step_id" => target_tool_ref,
      "kind" => kind,
      "description" => description,
      "success_criteria" => success_criteria,
      "depends_on" => [],
      "target_tool_ref" => target_tool_ref,
      "write_intent" => if(kind == "act", do: "tentative", else: "none"),
      "risk_hint" => "low",
      "authoring_intent" => nil,
      "target_chapter" => nil,
      "requested_chapter_raw" => nil
    }
  end

  defp prose_writing_plan_step(prompt_text) do
    author_goal = agent_plan_author_goal(prompt_text)
    {authoring_intent, requested_chapter_raw} = prose_authoring_coordinate(author_goal)
    risk_hint = if prose_high_risk_goal?(author_goal), do: "high", else: "low"

    "prose_writing"
    |> plan_step("act", "基于已读取的正文上下文生成正文草稿并完成质量复核。", [
      "tentative_prose_fragment_created",
      "quality_review_completed"
    ])
    |> Map.merge(%{
      "write_intent" => "tentative",
      "risk_hint" => risk_hint,
      "authoring_intent" => authoring_intent,
      "target_chapter" => nil,
      "requested_chapter_raw" => requested_chapter_raw
    })
  end

  defp agent_plan_author_goal(prompt_text) do
    case Regex.run(~r/- author_goal:\s*(.*?)\n\s*-/su, prompt_text, capture: :all_but_first) do
      [text] -> String.trim(text)
      _ -> extract_user_text(prompt_text)
    end
  end

  defp prose_authoring_coordinate(author_goal) do
    intent =
      cond do
        contains_any?(author_goal, ["推翻", "重写", "改写", "重新写"]) -> "rewrite"
        contains_any?(author_goal, ["接着", "继续", "续写", "往下写", "再写", "补一段", "补写"]) -> "continuation"
        true -> nil
      end

    {intent, named_chapter_token(author_goal)}
  end

  defp prose_high_risk_goal?(author_goal) do
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

  defp named_chapter_token(text) do
    case Regex.run(~r/第\s*[0-9零一二三四五六七八九十百两]+\s*章/u, text) do
      [token] -> String.replace(token, ~r/\s+/, "")
      _ -> nil
    end
  end

  defp agent_next_step_decision_content(prompt_text) do
    prompt_text
    |> agent_next_step_decision_response()
    |> reasoning_tail()
  end

  defp agent_next_step_decision_response(prompt_text) do
    profile_next_step_decision(prompt_text) || character_design_next_step_decision(prompt_text)
  end

  defp reasoning_tail(packet) when is_map(packet) do
    tail = %{
      "evaluation_of_last" => Map.get(packet, :evaluation_of_last, evaluation_holds()),
      "decision" => Map.fetch!(packet, :decision),
      "next_action" => Map.fetch!(packet, :next_action),
      "plan_revision" => Map.get(packet, :plan_revision),
      "reason_codes" => Map.get(packet, :reason_codes, []),
      "confidence" => Map.get(packet, :confidence, 1.0)
    }

    Map.fetch!(packet, :reasoning) <> "\n" <> Jason.encode!(tail)
  end

  defp continue_next(reasoning, target_tool_ref, write_intent \\ "none", reason_codes \\ []) do
    %{
      reasoning: reasoning,
      evaluation_of_last: evaluation_holds(),
      decision: %{"type" => "continue"},
      next_action: %{
        "target_tool_ref" => target_tool_ref,
        "write_intent" => write_intent,
        "risk_hint" => "low"
      },
      plan_revision: nil,
      reason_codes: ["agentic_next_step" | reason_codes],
      confidence: 1.0
    }
  end

  defp done_next(reasoning, reason_codes \\ ["goal_satisfied"]) do
    %{
      reasoning: reasoning,
      evaluation_of_last: evaluation_holds(),
      decision: %{"type" => "done"},
      next_action: %{"target_tool_ref" => nil, "write_intent" => "none", "risk_hint" => "low"},
      plan_revision: nil,
      reason_codes: reason_codes,
      confidence: 1.0
    }
  end

  defp evaluation_holds do
    %{"advanced" => true, "plan_holds" => true, "new_constraint" => nil}
  end

  defp profile_next_step_decision(prompt_text) do
    Enum.find_value(profile_next_step_rules(), fn {profile_ref, decision_fun} ->
      if String.contains?(prompt_text, "profile_ref: #{profile_ref}") do
        decision_fun.(prompt_text)
      end
    end)
  end

  defp profile_next_step_rules do
    [
      {"world_building_with_context_v1", &world_building_next_step_decision/1},
      {"prose_drafting_with_quality_v1", &prose_drafting_next_step_decision/1},
      {"plot_outline_with_context_v1", &plot_outline_next_step_decision/1},
      {"character_evolution_with_context_v1", &character_evolution_next_step_decision/1},
      {"prose_revision_from_findings_v1", &prose_revision_next_step_decision/1}
    ]
  end

  defp character_design_next_step_decision(prompt_text) do
    cond do
      String.contains?(prompt_text, "/ artifact_created:") ->
        done_next("[stub] 已生成待采纳角色候选，本轮目标已满足。")

      String.contains?(prompt_text, "/ character_roster:") ->
        continue_next("[stub] 基于角色阵容设计新角色。", "character_design", "tentative")

      true ->
        continue_next("[stub] 先读取当前角色阵容。", "character_roster")
    end
  end

  defp prose_drafting_next_step_decision(prompt_text) do
    observations = existing_observation_section(prompt_text)

    cond do
      String.contains?(observations, "/ artifact_created:") ->
        done_next("[stub] 已生成待采纳正文草稿并完成质量复核，本轮目标已满足。")

      String.contains?(observations, "正文写作上下文") ->
        continue_next(
          "[stub] 基于已读取的正文上下文生成正文草稿并完成质量复核。",
          "prose_writing",
          "tentative"
        )

      true ->
        continue_next("[stub] 先读取正文写作上下文。", "context_assemble")
    end
  end

  defp plot_outline_next_step_decision(prompt_text) do
    observations = existing_observation_section(prompt_text)

    cond do
      String.contains?(observations, "/ artifact_created:") ->
        done_next("[stub] 已生成待采纳大纲候选，本轮目标已满足。")

      String.contains?(observations, "章节大纲规划上下文") ->
        continue_next("[stub] 基于已读取的章节上下文生成章节大纲草稿。", "plot_outline", "tentative")

      true ->
        continue_next("[stub] 先读取章节大纲规划上下文。", "context_assemble")
    end
  end

  defp character_evolution_next_step_decision(prompt_text) do
    observations = existing_observation_section(prompt_text)

    cond do
      String.contains?(observations, "/ artifact_created:") ->
        done_next("[stub] 已生成待采纳角色演化候选，本轮目标已满足。")

      String.contains?(observations, "角色演化上下文") ->
        continue_next("[stub] 基于已读取的角色上下文生成角色演化草稿。", "character_evolution", "tentative")

      true ->
        continue_next("[stub] 先读取角色演化上下文。", "context_assemble")
    end
  end

  defp world_building_next_step_decision(prompt_text) do
    observations = existing_observation_section(prompt_text)

    cond do
      String.contains?(observations, "/ artifact_created:") ->
        done_next("[stub] 已生成待采纳世界设定候选，本轮目标已满足。")

      String.contains?(observations, "世界设定上下文") ->
        continue_next("[stub] 基于已读取的作品设定上下文生成世界设定草稿。", "world_building", "tentative")

      true ->
        continue_next("[stub] 先读取作品设定上下文。", "context_assemble")
    end
  end

  defp prose_revision_next_step_decision(prompt_text) do
    observations = existing_observation_section(prompt_text)

    cond do
      String.contains?(observations, "/ artifact_created:") ->
        done_next("[stub] 修订草稿已汇总，目标已满足。")

      String.contains?(observations, "已生成新的修订候选") ->
        continue_next("[stub] 汇总修订候选给作者。", "revision_finalize")

      String.contains?(observations, "重新经过 Orchestrator") ->
        continue_next("[stub] 基于修订计划生成正文修订候选。", "prose_writing", "tentative")

      String.contains?(observations, "已读取待修订草稿") ->
        continue_next("[stub] 制定修订计划并重新经过系统裁决。", "revision_plan")

      true ->
        continue_next("[stub] 读取待修订草稿和质量发现。", "revision_prepare")
    end
  end

  defp existing_observation_section(prompt_text) do
    prompt_text
    |> String.split("## 决策规则", parts: 2)
    |> hd()
  end

  defp creative_items_json(prompt_text) do
    {brief, context} = extract_creative_parts(prompt_text)
    user_excerpt = [brief, context] |> Enum.reject(&(&1 == "")) |> Enum.join("\n")
    fp = input_fingerprint(user_excerpt)

    item =
      %{
        "item_id" => "stub_item_" <> fp <> "_1",
        "title" => stub_creative_title(prompt_text, brief, fp),
        "body" => stub_creative_body(prompt_text, brief, context),
        "rationale" => stub_creative_rationale(prompt_text)
      }
      |> maybe_put_narrative_role(prompt_text, brief)

    Jason.encode!([item])
  end

  # character_seed 时按 user brief 中的角色类型词派生结构化叙事角色（fixture 确定性）。
  defp maybe_put_narrative_role(item, prompt_text, brief) do
    if character_seed_prompt?(prompt_text) do
      case stub_narrative_role(brief) do
        nil -> item
        role -> Map.put(item, "narrative_role", role)
      end
    else
      item
    end
  end

  defp stub_narrative_role(brief) do
    text = to_string(brief)

    cond do
      String.contains?(text, "反派") -> "ANTAGONIST"
      String.contains?(text, "配角") -> "SUPPORTING"
      String.contains?(text, "次要") or String.contains?(text, "龙套") -> "MINOR"
      String.contains?(text, "群像") -> "ENSEMBLE_POV"
      String.contains?(text, "主角") or String.contains?(text, "主人公") -> "PROTAGONIST"
      true -> nil
    end
  end

  defp input_fingerprint(text) do
    text |> :erlang.phash2() |> Integer.to_string(36)
  end

  defp plan_json do
    Jason.encode!(%{
      "plan_goal_summary" => "[stub] 调用 character_design 推进",
      "risk_hint" => "low",
      "requires_confirmation_hint" => false,
      "proposed_actions" => [
        %{
          "action_id" => "act-stub-1",
          "action_type" => "capability_invocation",
          "summary" => "[stub] 调用 character_design",
          "target_ref" => "character_design",
          "write_intent" => "tentative",
          "risk_hint" => "low"
        }
      ],
      "state_changes_requested" => [],
      "required_capabilities" => ["character_design"],
      "fallback_message" => "[stub] 无可调度行动"
    })
  end

  # frame 默认 reply-only（needs_tool=false）以兼容 reply-only 主链测试。
  # driver 通过 generate_micro_plan: true 显式强制走 plan/tool 路径。
  defp frame_json(prompt_text) do
    user_excerpt = extract_user_text(prompt_text)

    Jason.encode!(%{
      "frame_type" => "casual_reply",
      "dialogue_goal_summary" => "[stub] 收到用户输入",
      "needs_tool" => false,
      "no_tool_reason" => "no_tool_needed",
      "execution_readiness" => "not_applicable",
      "assistant_message" => "[stub] 已收到。原文：" <> user_excerpt,
      "candidate_directions" => [],
      "context_used" => context_provided?(prompt_text),
      "uncertainty" => []
    })
  end

  # 当 prompt 中 "当前作品上下文" 段落不是空标记时，认为 context 已提供。
  # 注：此处标记字符串与 plan prompt 模板隐式耦合 —
  # 如果 Planner 改了"当前作品上下文"段落或空标记文案，stub 也要同步更新。
  # 这种耦合是 fixture provider 与真实 prompt template 之间合理的契约链接。
  defp context_provided?(prompt_text) do
    String.contains?(prompt_text, "当前作品上下文") and
      not String.contains?(prompt_text, "（无——这是新对话或尚未创建作品）")
  end

  # 从 normalized prompt 中提取 user role 部分（含 nonce 等用户随机内容）
  defp extract_user_text(prompt_text) do
    case Regex.run(~r/用户创作简述：(.+?)\n\s*上下文：(.+?)\n\s*重要：/su, prompt_text) do
      [_, brief, context] ->
        [String.trim(brief), String.trim(context)]
        |> Enum.reject(&(&1 == ""))
        |> Enum.join("\n")

      _ ->
        extract_role_user_text(prompt_text)
    end
  end

  defp extract_creative_parts(prompt_text) do
    case Regex.run(~r/用户创作简述：(.+?)\n\s*上下文：(.+?)\n\s*重要：/su, prompt_text) do
      [_, brief, context] -> {String.trim(brief), String.trim(context)}
      _ -> {extract_role_user_text(prompt_text), ""}
    end
  end

  defp character_seed_prompt?(prompt_text),
    do: String.contains?(prompt_text, "artifact_type：character_seed")

  defp stub_creative_title(prompt_text, brief, fp) do
    if character_seed_prompt?(prompt_text) do
      "沈砚 " <> String.slice(fp, 0, 4)
    else
      case Regex.run(~r/第\d+章[：:]\s*([^。\n]+?)(?:正文草稿|$)/u, brief) do
        [_, chapter_title] -> String.trim(chapter_title) <> " 草稿"
        _ -> "离线待确认素材 " <> fp
      end
    end
  end

  defp stub_creative_body(prompt_text, brief, context) do
    if character_seed_prompt?(prompt_text) do
      stub_character_body(brief, context)
    else
      stub_prose_body(brief, context)
    end
  end

  defp stub_prose_body(brief, context) do
    nonce_text =
      context
      |> random_identifier_tokens()
      |> Enum.take(3)
      |> Enum.join("、")

    nonce_sentence = if nonce_text == "", do: "", else: "校验标识 #{nonce_text} 被刻在旧终端的边框上。"

    [
      "离线草稿从作者请求出发：#{String.slice(brief, 0, 80)}。",
      "主角站在灵气账单闪烁的巷口，意识到这次欠费不是普通催缴，而是有人借系统规则逼他现身。",
      nonce_sentence,
      "他收起最后一张护身符，沿着停电的楼梯向下走，准备在巡检车抵达前找到账单背后的漏洞。"
    ]
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n")
  end

  defp stub_character_body(brief, context) do
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
      "定位：灵气交易所稽查官，负责追查灵气账单异常。",
      "动机：查清公司黑账，保护被规则压迫的底层修士。",
      "背景：出身账务区，左腕旧阵芯记录着一次未公开事故。",
      "关系：可与现有角色形成调查、互信或对抗关系，避免重名与设定冲突。",
      "弧光：从只相信账面证据，转向理解人的选择与牺牲。",
      "外貌：瘦削、深色旧制服、左腕阵芯微光。",
      "语言风格：短句、克制、审计式追问。",
      "能力体系绑定：读取灵气流水、识别伪造功法凭证、追踪阵纹残留。",
      nonce_line,
      "作品专属维度：可继续补足境界、功法、社会关系和关键弱点。请求摘要：#{String.slice(brief, 0, 80)}"
    ]
    |> Enum.join("\n")
  end

  defp stub_creative_rationale(prompt_text) do
    if character_seed_prompt?(prompt_text) do
      "离线 fixture provider 生成的角色主档案草稿，未写入作品事实。"
    else
      "离线 fixture provider 生成的待保存草稿，未写入作品事实。"
    end
  end

  defp random_identifier_tokens(text) do
    ~r/\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{6,}\b/u
    |> Regex.scan(text)
    |> Enum.map(fn [token] -> token end)
    |> Enum.uniq()
  end

  defp extract_role_user_text(prompt_text) do
    case Regex.run(~r/user:\s*(.+?)(?:\n[a-z_]+:|\z)/su, prompt_text) do
      [_, text] -> String.trim(text)
      _ -> prompt_text |> String.slice(-200, 200) |> String.trim()
    end
  end

  defp profile_route_author_text(prompt_text) do
    case Regex.run(~r/## 作者输入\s*(.*?)\s*## 可选 profile/su, prompt_text) do
      [_, text] -> String.trim(text)
      _ -> extract_role_user_text(prompt_text)
    end
  end

  defp matched_terms(text) do
    terms = [
      "角色阵容",
      "反派",
      "正文草稿",
      "写下一章",
      "续写",
      "章节大纲",
      "角色演化",
      "当前状态",
      "世界设定",
      "伏笔",
      "写作规则",
      "风格规则",
      "provider 进度",
      "流式进度",
      "只读批量"
    ]

    Enum.filter(terms, &String.contains?(text, &1))
  end

  defp contains_any?(text, terms), do: Enum.any?(terms, &String.contains?(text, &1))

  # ── prompt 归一化 ──

  defp prompt_text(prompt) when is_binary(prompt), do: prompt

  defp prompt_text(prompt) when is_list(prompt) or is_map(prompt) do
    prompt
    |> NovelAgent.Provider.normalize_messages()
    |> Enum.map_join("\n", fn message -> "#{message.role}: #{message.content}" end)
  end
end
