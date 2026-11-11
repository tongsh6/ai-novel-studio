defmodule NovelAgent.Provider.SliceVerifyTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Test.Provider.SliceVerify

  test "ordinary slice verify frame response is not delayed" do
    prompt = [%{role: "user", content: "请回一句收到"}]

    start = System.monotonic_time(:millisecond)
    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})
    duration = System.monotonic_time(:millisecond) - start

    assert duration < 1_000
    assert Jason.decode!(result.content)["assistant_message"] == "可以，我们先围绕小说创作方向聊下去。"
  end

  test "profile routing treats prose draft intent as stronger than chapter-plan context words" do
    prompt = """
    你是小说创作系统的 AgentRun profile router。你只决定本轮应该进入哪个 AgentRun profile。

    ## 作者输入
    请根据已采纳章节计划生成第02章：矿区追击战：主角在废弃矿区遭遇巡检傀儡。正文草稿，保持为待采纳草稿。

    ## 可选 profile
    - prose_drafting_with_quality_v1: 写正文、续写章节、生成正文草稿，并需要质量复核。
    - plot_outline_with_context_v1: 规划章节大纲、卷纲、分章结构。

    ## 输出格式
    {"profile_ref": "conversation_turn_v1"}
    """

    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})

    body = Jason.decode!(result.content)
    assert body["profile_ref"] == "prose_drafting_with_quality_v1"
    assert body["reason_codes"] == ["model_profile_selected", "prose_drafting_text_match"]
  end

  test "SC-AU14-B1 设定盘点 prompt 返回现有三类 seed canonical items" do
    prompt = """
    你是小说设定盘点助手。下面是一部作品前 2 章的正文摘录。
    只返回 JSON 数组，每项必须包含 "artifact_type" / "item_id" / "title" / "body"。

    正文摘录：
    【第1章 第01章：底层灵气账单】
    沈砚发现灵气按频段计费。
    """

    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})

    items = Jason.decode!(result.content)

    assert Enum.map(items, & &1["artifact_type"]) == [
             "character_seed",
             "character_seed",
             "world_rule_seed",
             "foreshadowing_seed"
           ]

    assert Enum.all?(items, &(is_binary(&1["item_id"]) and is_binary(&1["body"])))
  end

  test "SC-AU14-B1 fact_inventory profile 只起草一个允许的盘点步骤" do
    prompt =
      NovelTest.TestRequestIR.ir(
        [
          NovelTest.TestRequestIR.base("""
          你是小说创作系统的 AgentRun 计划起草器。
          - profile_ref: fact_inventory_v1
          - plan_step_targets: fact_inventory
          """)
        ],
        tools: [NovelTest.TestRequestIR.tool("agent_plan_draft")],
        projection: %{tool_choice: "agent_plan_draft"}
      )

    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})
    [%{"arguments" => arguments}] = result.tool_calls

    assert [%{target_tool_ref: "fact_inventory"}] = get_in(arguments, [:plan, :steps])
  end

  test "AU11 missing work state quality diagnosis asks for target chapter material" do
    # B40 CP1 重锚：缺材料判定只读当前判断 prompt 的真实作品事实
    # （judgment_work_facts_section/1 渲染「正文统计：N 章中已写 M 章」），
    # 旧 AIMessageEnvelope/缺章节摘要标记已随帧纪元退役。
    prompt = [
      %{
        role: "system",
        content: "## 当前作品上下文\n标题：灵源纪元\n正文统计：2 章中已写 0 章\n## 章节列表\n- 第01章：灵源账单"
      },
      %{role: "user", content: "帮我看看这一章哪里不成立。"}
    ]

    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})

    body = Jason.decode!(result.content)
    assert body["frame_type"] == "casual_reply"
    assert body["assistant_message"] =~ "缺少当前章节摘要或正文"
    assert body["assistant_message"] =~ "不会改写正文或写入作品事实"
  end

  test "GAP-WT-04 meta discussion returns an author-facing non-execution frame" do
    prompt = [
      %{
        role: "user",
        content: "以后采用这种协作方式：先讨论方案，再由我确认是否进入创作，可以吗？"
      }
    ]

    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})

    body = Jason.decode!(result.content)
    # B26 收窄后 meta_discussion 无生产者，协作方式讨论是普通回复。
    assert body["frame_type"] == "casual_reply"
    assert body["dialogue_goal_summary"] == "约定创作协作流程"
    assert body["needs_tool"] == false
    assert body["candidate_directions"] == []
    assert body["assistant_message"] =~ "只有你明确要求生成时"
  end

  test "AU02BADCANDIDATES marker returns malformed candidate payload for fallback verification" do
    prompt = [
      %{role: "user", content: "AU02BADCANDIDATES 我想写赛博修仙方向，请给几个候选。"}
    ]

    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})

    body = Jason.decode!(result.content)
    assert body["frame_type"] == "creative_exploration"
    assert body["candidate_directions"] == %{"pitch" => "", "title" => ""}
  end

  test "AU02CTX nonce is carried from candidate context into a later follow-up response" do
    nonce = "AU02CTX123456"

    source_prompt = [
      %{role: "user", content: "#{nonce} 我想写赛博修仙方向，请给几个候选。"}
    ]

    assert {:ok, source_result} =
             SliceVerify.complete(%SliceVerify{}, nil, source_prompt, %InferenceParams{})

    source_body = Jason.decode!(source_result.content)
    assert source_body["frame_type"] == "creative_exploration"
    assert [first_candidate | _] = source_body["candidate_directions"]
    assert first_candidate["title"] =~ nonce

    followup_prompt = [
      %{role: "system", content: "## 会话摘要\nassistant: #{first_candidate["title"]}"},
      %{role: "user", content: "这个方向的开场冲突应该怎么设计？不要写正文，只继续聊。"}
    ]

    assert {:ok, followup_result} =
             SliceVerify.complete(%SliceVerify{}, nil, followup_prompt, %InferenceParams{})

    followup_body = Jason.decode!(followup_result.content)
    assert followup_body["frame_type"] == "casual_reply"
    assert followup_body["assistant_message"] =~ nonce
    assert followup_body["candidate_directions"] == []
  end

  describe "AU09 角色类型/主角语义路由" do
    test "问'主角是谁'是只读查询：frame 需要工具，plan 路由到 character_roster" do
      frame_prompt = [%{role: "user", content: "现在这部作品的主角是谁，叫什么名字？"}]

      assert {:ok, frame_result} =
               SliceVerify.complete(%SliceVerify{}, nil, frame_prompt, %InferenceParams{})

      frame_body = Jason.decode!(frame_result.content)
      assert frame_body["needs_tool"] == true
      assert frame_body["frame_type"] == "execution_candidate"

      plan_prompt = "proposed_actions\n## 用户输入\n现在这部作品的主角是谁？\n## 输出格式"

      assert {:ok, plan_result} =
               SliceVerify.complete(%SliceVerify{}, nil, plan_prompt, %InferenceParams{})

      assert [action] = Jason.decode!(plan_result.content)["proposed_actions"]
      assert action["target_ref"] == "character_roster"
    end

    test "'设计一个主角'是创建意图：frame 需要工具，plan 路由到 character_design" do
      frame_prompt = [%{role: "user", content: "帮我设计一个主角，名字就叫林烬，是灵气稽查官。"}]

      assert {:ok, frame_result} =
               SliceVerify.complete(%SliceVerify{}, nil, frame_prompt, %InferenceParams{})

      assert Jason.decode!(frame_result.content)["needs_tool"] == true

      plan_prompt = "proposed_actions\n## 用户输入\n帮我设计一个主角，名字就叫林烬。\n## 输出格式"

      assert {:ok, plan_result} =
               SliceVerify.complete(%SliceVerify{}, nil, plan_prompt, %InferenceParams{})

      assert [action] = Jason.decode!(plan_result.content)["proposed_actions"]
      assert action["target_ref"] == "character_design"
    end

    test "设计主角的 character_seed 携带结构化 narrative_role=PROTAGONIST" do
      creative_prompt = """
      JSON 数组
      artifact_type：character_seed
      用户创作简述：帮我设计一个主角，名字就叫林烬，是灵气稽查官。
      上下文：当前作品背景。
      重要：保留随机标识符。
      """

      assert {:ok, result} =
               SliceVerify.complete(%SliceVerify{}, nil, creative_prompt, %InferenceParams{})

      assert [item] = Jason.decode!(result.content)
      assert item["narrative_role"] == "PROTAGONIST"
    end

    test "设计反派的 character_seed 携带 narrative_role=ANTAGONIST" do
      creative_prompt = """
      JSON 数组
      artifact_type：character_seed
      用户创作简述：再设计一个反派。
      上下文：当前作品背景。
      重要：保留随机标识符。
      """

      assert {:ok, result} =
               SliceVerify.complete(%SliceVerify{}, nil, creative_prompt, %InferenceParams{})

      assert [item] = Jason.decode!(result.content)
      assert item["narrative_role"] == "ANTAGONIST"
    end

    test "AU09 回归：设计主角（brief 含候选词触发多候选）时每条 character_seed 都带 narrative_role" do
      creative_prompt = """
      JSON 数组
      artifact_type：character_seed
      用户创作简述：帮我设计一个主角候选，作为这部作品的核心人物。
      上下文：当前作品背景与候选方向说明。
      重要：保留随机标识符。
      """

      assert {:ok, result} =
               SliceVerify.complete(%SliceVerify{}, nil, creative_prompt, %InferenceParams{})

      assert [a, b] = Jason.decode!(result.content)
      assert a["narrative_role"] == "PROTAGONIST"
      assert b["narrative_role"] == "PROTAGONIST"
    end

    test "要求多个角色候选时确定性产出 2 条独立候选（item_id/标题互不相同）" do
      creative_prompt = """
      JSON 数组
      artifact_type：character_seed
      用户创作简述：请给我设计两个不同方向的新角色候选，让我挑一个。
      上下文：当前作品背景。
      重要：保留随机标识符。
      """

      assert {:ok, result} =
               SliceVerify.complete(%SliceVerify{}, nil, creative_prompt, %InferenceParams{})

      assert [a, b] = Jason.decode!(result.content)
      assert a["item_id"] != b["item_id"]
      assert a["title"] != b["title"]
    end

    test "'更新角色当前状态/关系'是演化意图：frame 需要工具，plan 路由到 character_evolution" do
      frame_prompt = [%{role: "user", content: "更新一下林烬的当前状态，他在这一章右臂重伤了。"}]

      assert {:ok, frame_result} =
               SliceVerify.complete(%SliceVerify{}, nil, frame_prompt, %InferenceParams{})

      assert Jason.decode!(frame_result.content)["needs_tool"] == true

      plan_prompt = "proposed_actions\n## 用户输入\n更新林烬的当前状态，他右臂重伤了。\n## 输出格式"

      assert {:ok, plan_result} =
               SliceVerify.complete(%SliceVerify{}, nil, plan_prompt, %InferenceParams{})

      assert [action] = Jason.decode!(plan_result.content)["proposed_actions"]
      assert action["target_ref"] == "character_evolution"
    end

    test "角色演化 character_evolution_seed 携带 memory_subtype（关系→RELATIONSHIP）" do
      creative_prompt = """
      JSON 数组
      artifact_type：character_evolution_seed
      用户创作简述：林烬和苏晚的关系从结盟转为反目。
      上下文：当前作品背景。
      重要：保留随机标识符。
      """

      assert {:ok, result} =
               SliceVerify.complete(%SliceVerify{}, nil, creative_prompt, %InferenceParams{})

      assert [item] = Jason.decode!(result.content)
      assert item["memory_subtype"] == "RELATIONSHIP"
    end

    test "设计单个角色时仍只产出 1 条候选（向后兼容 dossier / 主角语义 slice）" do
      creative_prompt = """
      JSON 数组
      artifact_type：character_seed
      用户创作简述：和我一起设计一个新角色。
      上下文：当前作品背景。
      重要：保留随机标识符。
      """

      assert {:ok, result} =
               SliceVerify.complete(%SliceVerify{}, nil, creative_prompt, %InferenceParams{})

      assert [_only] = Jason.decode!(result.content)
    end
  end

  test "计划起草把作者点名章按 prompt 作品章节列表精确匹配为全名 target_chapter" do
    prompt =
      NovelTest.TestRequestIR.ir(
        [
          NovelTest.TestRequestIR.base("""
          你是小说创作系统的 AgentRun 计划起草器。你只起草本次运行的可见 AgentPlan，不批准执行。

          ## 当前 AgentRun
          - run_id: run_plan_chapter_match
          - profile_ref: prose_drafting_with_quality_v1
          - goal_version: 1
          - author_goal: 请根据已采纳章节计划生成第02章的正文草稿
          - plan_step_targets: context_assemble, prose_writing

          ## 作品章节（target_chapter 必须从此列表精确复制全名；含已规划但还没写正文的章）
          - 第01章：底层灵气账单
          - 第02章：矿区追击战
          - 第03章：黑市调频师

          ## 计划要求
          - prose_writing 步必须携带 authoring_intent / target_chapter / requested_chapter_raw；作者点名的章按「作品章节」列表精确复制全名填 target_chapter，列表中没有对应章或无法确定时填 null。
          """)
        ],
        tools: [NovelTest.TestRequestIR.tool("agent_plan_draft")],
        projection: %{tool_choice: "agent_plan_draft"}
      )

    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})

    [%{"arguments" => arguments}] = result.tool_calls

    prose_step =
      arguments
      |> get_in([:plan, :steps])
      |> Enum.find(&(&1.target_tool_ref == "prose_writing"))

    # 与真实 LLM 契约对称：点名"第02章"按章号对应到列表全名；requested_chapter_raw 保留作者原话。
    assert prose_step.target_chapter == "第02章：矿区追击战"
    assert prose_step.requested_chapter_raw == "第02章"
  end

  test "计划起草点名列表外的章时 target_chapter 保持 null（缺失策略 block 信号）" do
    prompt =
      NovelTest.TestRequestIR.ir(
        [
          NovelTest.TestRequestIR.base("""
          你是小说创作系统的 AgentRun 计划起草器。你只起草本次运行的可见 AgentPlan，不批准执行。

          ## 当前 AgentRun
          - run_id: run_plan_chapter_miss
          - profile_ref: prose_drafting_with_quality_v1
          - goal_version: 1
          - author_goal: 请生成第99章的正文草稿
          - plan_step_targets: context_assemble, prose_writing

          ## 作品章节（target_chapter 必须从此列表精确复制全名；含已规划但还没写正文的章）
          - 第01章：底层灵气账单

          ## 计划要求
          - prose_writing 步必须携带 authoring_intent / target_chapter / requested_chapter_raw；作者点名的章按「作品章节」列表精确复制全名填 target_chapter，列表中没有对应章或无法确定时填 null。
          """)
        ],
        tools: [NovelTest.TestRequestIR.tool("agent_plan_draft")],
        projection: %{tool_choice: "agent_plan_draft"}
      )

    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})

    [%{"arguments" => arguments}] = result.tool_calls

    prose_step =
      arguments
      |> get_in([:plan, :steps])
      |> Enum.find(&(&1.target_tool_ref == "prose_writing"))

    assert prose_step.target_chapter == nil
    assert prose_step.requested_chapter_raw == "第99章"
  end

  test "CP4a 当前创作工具优先于历史续行协议文本" do
    prompt =
      NovelTest.TestRequestIR.ir(
        [
          NovelTest.TestRequestIR.author("上一轮使用 continuation_decision；历史目录曾提到整章正文修订。"),
          NovelTest.TestRequestIR.scope(
            "用户创作简述：写第01章：底层灵气账单正文草稿\n上下文：本章已有计划。\n重要：保留作者输入。\nartifact_type：prose_fragment"
          )
        ],
        tools: [NovelTest.TestRequestIR.tool("submit_tentative_artifact")],
        projection: %{tool_choice: "submit_tentative_artifact"}
      )

    for provider <- [SliceVerify, NovelAgent.Provider.Stub] do
      assert {:ok, result} = provider.complete(nil, nil, prompt, %{})
      assert [%{name: "submit_tentative_artifact", arguments: arguments}] = result.tool_calls
      items = Map.get(arguments, :items) || Map.get(arguments, "items")
      item = hd(items)
      title = Map.get(item, :title) || Map.get(item, "title")

      assert title =~ "底层灵气账单",
             "provider=#{inspect(provider)} title=#{inspect(title)}"

      refute title =~ "修订稿"
    end
  end

  test "AU04FAILTOOL marker fails only at creative tool provider stage" do
    plan_prompt = """
    proposed_actions
    当前作者输入：AU04FAILTOOL 请推翻重写第01章正文草稿。
    """

    assert {:ok, plan_result} =
             SliceVerify.complete(%SliceVerify{}, nil, plan_prompt, %InferenceParams{})

    plan_body = Jason.decode!(plan_result.content)
    assert [action] = plan_body["proposed_actions"]
    assert action["summary"] =~ "AU04FAILTOOL"

    creative_prompt = """
    JSON 数组
    artifact_type：prose_fragment
    创作简述：AU04FAILTOOL 生成一段正文草稿
    """

    assert {:error, %{type: :provider_error, message: message}} =
             SliceVerify.complete(%SliceVerify{}, nil, creative_prompt, %InferenceParams{})

    assert message == "AU04FAILTOOL fixture provider failure"
  end
end

defmodule NovelAgent.Provider.SliceVerifyOperationScopeTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Test.Provider.SliceVerify

  @history """
  本次你承担创作判断器的角色。你的两种续行方式使用 continuation_decision。
  旧调用曾使用写前推理器和规划前推理器。
  - profile_ref: fact_inventory_v1
  - author_goal: 盘点旧材料，第01章。
  - goal_version: 1
  [ledger:information:foreshadow_old] 旧伏笔
  [ledger:arc:old] 旧弧光
  [plan:old] 旧章计划
  """

  @plan_scope """
  ## 调用点参数
  - profile_ref: prose_drafting_with_quality_v1
  - plan_step_targets: context_assemble, chapter_mission, prose_writing, quality_review

  ## 作品章节
  - 第02章：当前码头

  ## 本轮目标
  - author_goal: 请续写第02章：当前码头。
  - goal_version: 2
  - current_plan_version: 1
  """

  @mission_scope """
  当前应用目标：推进当前码头的线索。
  目标版本：2
  材料：
  [ledger:information:foreshadow_current] 当前伏笔
  [ledger:arc:current] 当前弧光
  [plan:current] 当前章计划
  """

  for tool <- ["agent_plan_draft", "agent_plan_revision"] do
    test "#{tool} 由当前工具决定，计划只读取最新 scope 的 profile、目标和章节" do
      tool = unquote(tool)
      assert {:ok, result} = complete(native_prompt(tool, @plan_scope))
      assert [%{"name" => ^tool, "arguments" => arguments}] = result.tool_calls
      steps = arguments.plan.steps
      assert prose = Enum.find(steps, &(&1.target_tool_ref == "prose_writing"))
      assert prose.authoring_intent == "continuation"
      assert prose.target_chapter == "第02章：当前码头"
      refute Enum.any?(steps, &(&1.target_tool_ref == "fact_inventory"))
    end
  end

  for tool <- ["chapter_mission", "planning_mission"] do
    test "#{tool} 不被旧判断或其它使命污染，引用只来自最新 scope" do
      tool = unquote(tool)
      assert {:ok, result} = complete(native_prompt(tool, @mission_scope))
      assert [%{"name" => ^tool, "arguments" => arguments}] = result.tool_calls

      assert Enum.map(arguments["must_advance"], & &1["basis_ref"]) == [
               "ledger:information:foreshadow_current",
               "ledger:arc:current",
               "plan:current"
             ]

      refute inspect(result) =~ "foreshadow_old"
      refute inspect(result) =~ "ledger:arc:old"

      if tool == "planning_mission" do
        assert arguments["statement"] =~ "接下来的章节"
      else
        assert arguments["statement"] =~ "本章"
        refute arguments["statement"] =~ "接下来的章节"
      end
    end
  end

  test "没有 scope 的单请求仍使用自身材料" do
    for {tool, text} <- [
          {"agent_plan_draft", "你是小说创作系统的 AgentRun 计划起草器。\n" <> @plan_scope},
          {"planning_mission", "你是规划前推理器。\n" <> @mission_scope}
        ] do
      prompt =
        NovelTest.TestRequestIR.ir(
          [NovelTest.TestRequestIR.base(text)],
          tools: [NovelTest.TestRequestIR.tool(tool)],
          projection: %{tool_choice: tool}
        )

      assert {:ok, result} = complete(prompt)
      assert [%{"name" => ^tool}] = result.tool_calls
    end
  end

  test "后续 writer 的种类与材料只来自本阶段，不受旧章计划污染" do
    scope = """
    ## 创作协作共同规则
    本次你承担角色设计助手的角色。
    capability：character_design
    artifact_type：character_seed
    用户创作简述：标识符 CURCHAR73X。帮我设计一个主角，是灵气稽查官。
    上下文：当前作品背景。
    重要：保留作者输入。
    """

    prompt = native_prompt("submit_tentative_artifact", scope)

    prompt =
      NovelTest.TestRequestIR.append_message_text(
        prompt,
        0,
        "\nartifact_type：outline_draft\n用户创作简述：旧章计划 OLDPLAN82Q\n上下文：旧目录\n重要：旧要求。"
      )

    assert {:ok, result} = complete(prompt)
    assert [%{name: "submit_tentative_artifact", arguments: %{items: [item]}}] = result.tool_calls
    assert item["narrative_role"] == "PROTAGONIST"
    assert item["body"] =~ "定位："
    assert item["body"] =~ "动机："
    assert item["body"] =~ "CURCHAR73X"
    refute item["body"] =~ "OLDPLAN82Q"
    refute item["body"] =~ "章功能定位："
    refute item["body"] =~ "旧章计划"
  end

  test "后续 quality 不消费旧阶段的故障标记与过期正文" do
    scope = "本次只读评审当前正文。\n待评审正文：林烬把账单放在桌上。"
    prompt = native_prompt("report_quality_findings", scope)

    prompt =
      NovelTest.TestRequestIR.append_message_text(
        prompt,
        0,
        "\nVS00EEVALFAIL 旧阶段的评审故障。"
      )

    assert {:ok, result} = complete(prompt)

    assert [%{name: "report_quality_findings", arguments: %{"findings" => []}}] =
             result.tool_calls
  end

  defp native_prompt(tool, scope) do
    NovelTest.TestRequestIR.ir(
      [
        NovelTest.TestRequestIR.scope(@history),
        NovelTest.TestRequestIR.assistant("上一阶段的工作已完成，接着处理新任务。"),
        NovelTest.TestRequestIR.scope(scope)
      ],
      tools: [NovelTest.TestRequestIR.tool(tool)],
      projection: %{tool_choice: "auto"}
    )
  end

  defp complete(prompt), do: SliceVerify.complete(nil, nil, prompt, %InferenceParams{})
end

defmodule NovelAgent.Provider.SliceVerifyWriterFaultScopeTest do
  # 故障开关是进程外的环境变量；本组必须等异步测试结束后串行执行并恢复原值。
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Test.Provider.SliceVerify

  @timeout_env "SLICE_VERIFY_WRITER_TIMEOUT"
  @prose_scope "capability：prose_writing\nartifact_type：prose_fragment\n用户创作简述：生成正文\n上下文：已有计划\n重要：保留作者输入。"

  setup do
    previous = System.get_env(@timeout_env)
    System.put_env(@timeout_env, "1")

    on_exit(fn ->
      if previous,
        do: System.put_env(@timeout_env, previous),
        else: System.delete_env(@timeout_env)
    end)

    :ok
  end

  test "当前正文工具仍按预期超时，最新 scope 的缩小范围可恢复" do
    assert {:error, %{type: :timeout}} =
             complete(native_prompt("submit_tentative_artifact", @prose_scope))

    retry_scope = @prose_scope <> "\n先只写当前章的第一个场景，500 字以内；写完就停。"
    assert {:ok, _result} = complete(native_prompt("submit_tentative_artifact", retry_scope))
  end

  test "历史正文不得让续行或质量工具误超时" do
    for {tool, scope} <- [
          {"continuation_decision", "你的两种续行方式：继续或等待作者。"},
          {"report_quality_findings", "本次进行质量复核。待评审正文：夜色落在城门上。"}
        ] do
      assert {:ok, _result} = complete(native_prompt(tool, scope, [@prose_scope]))
    end
  end

  test "后续角色创作只按最新 scope 判定，不受历史正文或正文内容字段污染" do
    current =
      "capability：character_design\nartifact_type：character_seed\n用户创作简述：设计一个配角\n上下文：既有正文记录 artifact_type：prose_fragment，只是背景。\n重要：保留作者输入。"

    assert {:ok, _result} =
             complete(native_prompt("submit_tentative_artifact", current, [@prose_scope]))
  end

  test "历史缩小范围不能免除当前新正文请求的超时" do
    old_retry = @prose_scope <> "\n先只写当前章的第一个场景，500 字以内；写完就停。"

    assert {:error, %{type: :timeout}} =
             complete(native_prompt("submit_tentative_artifact", @prose_scope, [old_retry]))
  end

  test "禁用工具或没有活动工具的 canonical 请求不走 legacy 故障判断" do
    prompt = native_prompt("submit_tentative_artifact", @prose_scope)
    assert {:ok, _result} = complete(%{prompt | projection: %{tool_choice: "none"}})
    assert {:ok, _result} = complete(%{prompt | tools: [], projection: %{tool_choice: nil}})
  end

  test "无工具的 legacy 正文 fixture 保持原有超时与缩小范围恢复" do
    assert {:error, %{type: :timeout}} = complete("JSON 数组\n" <> @prose_scope)
    assert {:ok, _result} = complete("JSON 数组\n" <> @prose_scope <> "\n先只写当前章的第一个场景")
  end

  defp native_prompt(tool, scope, history \\ []) do
    messages = Enum.map(history ++ [scope], &NovelTest.TestRequestIR.scope/1)

    NovelTest.TestRequestIR.ir(
      messages,
      tools: [NovelTest.TestRequestIR.tool(tool)],
      projection: %{tool_choice: tool}
    )
  end

  defp complete(prompt), do: SliceVerify.complete(nil, nil, prompt, %InferenceParams{})
end

defmodule NovelAgent.Provider.SliceVerifyChapterRevisionTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Test.Provider.SliceVerify

  @chapter_ref "chapter:11111111-1111-1111-1111-111111111111"

  defp judgment_prompt(author_text, targets \\ nil) do
    targets =
      targets ||
        "- #{@chapter_ref}｜第01章：夜潮｜片段数 2｜覆盖 complete｜modification_scope 按作者要求选择：format_only=仅排版 / target_segments=指定片段 / whole_chapter=整章"

    """
    本次你承担创作判断器的角色，与作者讨论并判断创作下一步。

    ## 可选章级修订目标（只读；ref 唯一，title 仅展示）
    #{targets}

    ## 已采纳可修订对象（只用于 revise_adopted_content）
    - as_q1c_setting：revise_adopted_content

    ## 作者输入
    #{author_text}
    """
  end

  defp chapter_arguments(author_text) do
    SliceVerify.chapter_revision_arguments(judgment_prompt(author_text))
  end

  test "章级排版意图 → format_only + chapter ref + 作者原话" do
    author_text = "把已保存的第一章正文整理修订一下，只调整分段和排版，不要改字句。"
    revision = chapter_arguments(author_text)

    assert revision.capability == "revise_adopted_content"
    assert revision.adopted_content_ref == @chapter_ref
    assert revision.modification_scope == "format_only"
    assert revision.dialogue_goal == author_text

    assert {:ok, result} =
             SliceVerify.complete(nil, nil, judgment_prompt(author_text), %InferenceParams{})

    assert [%{"name" => "judgment_decision", "arguments" => args}] = result.tool_calls
    assert args["action"] == "execute"
    assert args["capability"] == "revise_adopted_content"
    assert args["adopted_content_ref"] == @chapter_ref
    assert args["dialogue_goal"] == author_text
  end

  test "B28 CP1 镜像：读取/否定/条件不授整章，正向整章/局部/排版同产品语义" do
    # 读取/通读不是修改授权：无“整章”修饰时保守局部
    assert chapter_arguments("帮我通读一遍第一章正文，看看有没有矛盾。").modification_scope ==
             "target_segments"

    # 正向整章授权
    assert chapter_arguments("把已保存的第一章正文整章重写一遍，情节不变。").modification_scope ==
             "whole_chapter"

    # 否定整章 + 局部限制：局部优先，不扩整章
    assert chapter_arguments("不要整章重写，只改第一段。").modification_scope ==
             "target_segments"

    # “通读/全文”是材料读取，不能把局部限制扩大
    assert chapter_arguments("通读全文后只修第二段。").modification_scope ==
             "target_segments"

    # 明确只读不改 → 无修订意图（产品侧零写入拒绝）
    assert SliceVerify.chapter_revision_arguments(judgment_prompt("整章检查一遍，有问题告诉我，别改。")) ==
             nil

    assert chapter_arguments("把已保存的第一章正文里的年龄改一下，二十五岁改成三十岁，其余逐字不变。").modification_scope ==
             "target_segments"

    # 仅排版优先于“整章”限定
    assert chapter_arguments("把整章正文整理一下，只调整分段和标点，不改字句。").modification_scope ==
             "format_only"
  end

  test "同名/多目标不猜：无唯一章序号匹配 → chapter ref nil（交产品守卫）" do
    targets = """
    - #{@chapter_ref}｜第01章：夜潮｜片段数 2｜覆盖 complete｜modification_scope 按作者要求
    - chapter:22222222-2222-2222-2222-222222222222｜第01章：夜潮｜片段数 1｜覆盖 complete｜modification_scope 按作者要求
    """

    revision = SliceVerify.chapter_revision_arguments(judgment_prompt("整理已保存的正文。", targets))

    assert revision.capability == "revise_adopted_content"
    assert revision.adopted_content_ref == nil
  end

  test "原话唯一章序号匹配多目标时仍可绑定" do
    targets = """
    - #{@chapter_ref}｜第01章：夜潮｜片段数 2｜覆盖 complete｜modification_scope 按作者要求
    - chapter:22222222-2222-2222-2222-222222222222｜第02章：井底｜片段数 1｜覆盖 complete｜modification_scope 按作者要求
    """

    revision =
      SliceVerify.chapter_revision_arguments(judgment_prompt("把第一章正文整理一下，只调整排版，不改字句。", targets))

    assert revision.adopted_content_ref == @chapter_ref
    assert revision.modification_scope == "format_only"
  end

  test "旧 Q1c 单片段已采纳分支保持可用（不回归）" do
    prompt = """
    本次你承担创作判断器的角色。

    ## 已采纳可修订对象（只用于 revise_adopted_content）
    - as_q1c_setting：revise_adopted_content

    ## 作者输入
    把已保存设定中岑舟的年龄从二十五岁改成三十岁，其他内容保持不变。
    """

    assert SliceVerify.chapter_revision_arguments(prompt) == nil

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})
    assert [%{"name" => "judgment_decision", "arguments" => args}] = result.tool_calls
    assert args["action"] == "execute"
    assert args["capability"] == "revise_adopted_content"
    assert args["adopted_content_ref"] == "as_q1c_setting"
  end

  test "空目录下新写正文/纯读/普通聊天不误发缺目标澄清" do
    new_writing = """
    本次你承担创作判断器的角色。

    ## 作者输入
    帮我写第一章正文，注意分段和排版。
    """

    assert {:ok, result} = SliceVerify.complete(nil, nil, new_writing, %InferenceParams{})
    refute Enum.any?(result.tool_calls, &(&1["name"] == "ask_author"))

    read_only = """
    本次你承担创作判断器的角色。

    ## 作者输入
    请通读已保存第一章正文。
    """

    assert {:ok, read_result} = SliceVerify.complete(nil, nil, read_only, %InferenceParams{})
    refute Enum.any?(read_result.tool_calls, &(&1["name"] == "ask_author"))

    chat = """
    本次你承担创作判断器的角色。

    ## 作者输入
    我们聊聊这个故事的节奏吧。
    """

    assert {:ok, chat_result} = SliceVerify.complete(nil, nil, chat, %InferenceParams{})
    refute Enum.any?(chat_result.tool_calls, &(&1["name"] == "ask_author"))
  end
end

defmodule NovelAgent.Provider.SliceVerifyChapterWriterFixtureTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Test.Provider.SliceVerify

  @base_text "初稿：陈九斤二十五岁守灯楼，第七盏灯不点自亮。\n\n续写：灯楼九层，每层九盏，他数到第九层时天边泛白。"

  defp fixture_body(content) do
    decoded = Jason.decode!(content)

    items =
      cond do
        is_list(decoded) -> decoded
        is_map(decoded) -> Map.get(decoded, "items", [])
        true -> []
      end

    items |> hd() |> Map.fetch!("body")
  end

  defp writer_prompt(revision_heading, author_words) do
    """
    本次你承担小说正文写作助手的角色。请严格按本任务输出契约返回，不要附加任何额外文字。

    ## 创作协作共同规则
    作者是唯一裁决者。

    ## 本轮任务语义：修订
    本轮为修订。

    #{revision_heading}

    写作要求：保持冷峻克制。

    capability：prose_writing
    artifact_type：prose_fragment
    用户创作简述：修订第01章正文。作者原话：#{author_words}
    上下文：第01章：夜潮当前已采纳正文（覆盖顺序：scene seq 升序，片段之间以空行分隔）：
    #{@base_text}

    重要：保留随机标识符。
    输出契约（只返回 JSON，不要附加 JSON 以外的文字）：
    - 只返回 JSON 数组，或一个含 "items" 非空数组的 JSON 对象。
    """
  end

  test "target_segments writer prompt 命中章级修订 fixture 并只落实明确改动" do
    prompt =
      writer_prompt(
        "## 指定片段/段落内容修订",
        "把已保存的第一章正文里的年龄改一下，二十五岁改成三十岁，其余逐字不变。"
      )

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})
    body = fixture_body(result.content)

    assert body =~ "三十岁"
    refute body =~ "二十五岁"
    assert body =~ "灯楼九层，每层九盏"
    assert body =~ "第七盏灯不点自亮"
  end

  test "首个 canonical writer 保留 Base 中的修订规则，不能只取 scope 当成普通起草" do
    author = "把二十五岁改成三十岁，其余逐字不变。"
    legacy = writer_prompt("## 指定片段/段落内容修订", author)
    [base, dynamic] = String.split(legacy, "capability：", parts: 2)

    prompt =
      NovelTest.TestRequestIR.ir(
        [
          NovelTest.TestRequestIR.base("【应用数据 · application_base · 非作者原话】\n" <> base),
          NovelTest.TestRequestIR.author(author),
          NovelTest.TestRequestIR.scope("capability：" <> dynamic)
        ],
        tools: [NovelTest.TestRequestIR.tool("submit_tentative_artifact")],
        projection: %{tool_choice: "submit_tentative_artifact"}
      )

    corrections = [
      NovelTest.TestRequestIR.assistant("前一次响应格式错误。"),
      NovelTest.TestRequestIR.notice("【应用数据 · application_notice · 非作者原话】\n请按原任务正确输出。")
    ]

    for suffix <- [[], corrections] do
      assert {:ok, result} =
               SliceVerify.complete(
                 nil,
                 nil,
                 %{prompt | messages: prompt.messages ++ suffix},
                 %InferenceParams{}
               )

      assert [%{name: "submit_tentative_artifact", arguments: %{items: [item]}}] =
               result.tool_calls

      assert item["body"] == String.replace(@base_text, "二十五岁", "三十岁")
    end
  end

  test "whole_chapter content writer prompt 命中；format_only 返回基线原文" do
    content_prompt =
      writer_prompt("## 整章内容修订", "把第一章正文里的年龄改一下，二十五岁改成三十岁，其余逐字不变。")

    assert {:ok, result} = SliceVerify.complete(nil, nil, content_prompt, %InferenceParams{})
    body = fixture_body(result.content)
    assert body =~ "三十岁"

    format_prompt =
      writer_prompt("## 整章仅排版修订（format_only）", "把已保存的第一章正文整理一下，只调整分段和排版，不改字句。")

    assert {:ok, format_result} =
             SliceVerify.complete(nil, nil, format_prompt, %InferenceParams{})

    format_body = fixture_body(format_result.content)

    assert format_body == @base_text
  end
end

defmodule NovelAgent.Provider.SliceVerifyChapterStructureMaintenanceTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Test.Provider.SliceVerify

  defp judgment_prompt(author_text, opts) do
    planned = Keyword.get(opts, :planned_volumes)
    directory = Keyword.get(opts, :directory, true)

    facts =
      if planned,
        do: "- 全书：全书目标=未登记；目标总字数=60000；预计卷数=#{planned}；连载形态=SERIALIZED；正文统计：4 章中已写 3 章、计划中 1 章",
        else: "- 全书：全书目标=未登记；目标总字数=未登记；正文统计：4 章中已写 3 章"

    chapters =
      if directory do
        """

        ## 章节列表（共 4 章：已写 3 章，计划中 1 章）
        - 第 1 章「潮声之前」[chapter_ref=chapter:11111111-1111-1111-1111-111111111111]
        - 第 3 章「外门名册上的空白」[chapter_ref=chapter:22222222-2222-2222-2222-222222222222]
        - 第 4 章「旧钱与旧名」[chapter_ref=chapter:33333333-3333-3333-3333-333333333333]
        """
      else
        ""
      end

    """
    本次你承担创作判断器的角色，与作者讨论并判断创作下一步。

    ## 作品事实（持久化只读投影）
    #{facts}
    #{chapters}

    ## 作者输入
    #{author_text}
    """
  end

  defp arguments_of(result) do
    assert [%{"name" => "judgment_decision", "arguments" => args}] = result.tool_calls
    args
  end

  test "B30 维护正例：第2卷编号理顺 → execute maintain_chapter_structure" do
    author = "把第2卷章节编号理顺，内容不要动"
    prompt = judgment_prompt(author, planned_volumes: 2)

    assert %{
             mode: :execute,
             capability: "maintain_chapter_structure",
             dialogue_goal: ^author
           } = SliceVerify.chapter_structure_arguments(prompt)

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})
    args = arguments_of(result)

    assert args["action"] == "execute"
    assert args["capability"] == "maintain_chapter_structure"
    assert args["dialogue_goal"] == author
    refute Map.has_key?(args, "pending_artifact_ref")
    refute Map.has_key?(args, "adopted_content_ref")
    refute args["capability"] in ["plot_outline", "prose_writing"]
  end

  test "B30 负例：不存在卷/多卷未点名 → ask_author 澄清，不猜、不生成大纲" do
    out_of_range = judgment_prompt("把不存在的第九卷章节编号理顺，内容不要动", planned_volumes: 2)

    assert {:ok, out_result} = SliceVerify.complete(nil, nil, out_of_range, %InferenceParams{})

    assert [%{"name" => "ask_author", "arguments" => ask}] = out_result.tool_calls
    question = ask[:question] || ask["question"]
    assert question =~ "第9卷"
    assert question =~ "2 卷"
    assert (ask[:options] || ask["options"]) == []

    ambiguous = judgment_prompt("把章节编号理顺，内容不要动", planned_volumes: 2)
    assert {:ok, amb_result} = SliceVerify.complete(nil, nil, ambiguous, %InferenceParams{})

    assert [%{"name" => "ask_author", "arguments" => amb_ask}] = amb_result.tool_calls
    assert (amb_ask[:question] || amb_ask["question"]) =~ "多卷"
    refute Enum.any?(amb_result.tool_calls, &(&1["name"] == "judgment_decision"))
  end

  test "B30 单卷未点名可执行；无章节目录 → 澄清" do
    single = judgment_prompt("把章节编号理顺，内容不要动", planned_volumes: 1)
    assert %{mode: :execute} = SliceVerify.chapter_structure_arguments(single)

    no_directory =
      judgment_prompt("把第2卷章节编号理顺，内容不要动", planned_volumes: 2, directory: false)

    assert %{mode: :clarify} = SliceVerify.chapter_structure_arguments(no_directory)
  end

  test "B28/Q1c/普通创作分支不回归（维护 fixture 不误触发）" do
    b28 = """
    本次你承担创作判断器的角色。

    ## 可选章级修订目标（只读；ref 唯一，title 仅展示）
    - chapter:11111111-1111-1111-1111-111111111111｜第01章：夜潮｜片段数 2｜覆盖 complete

    ## 作者输入
    把已保存的第一章正文整理修订一下，只调整分段和排版，不要改字句。
    """

    assert SliceVerify.chapter_structure_arguments(b28) == nil

    q1c = """
    本次你承担创作判断器的角色。

    ## 已采纳可修订对象（只用于 revise_adopted_content）
    - as_q1c_setting：revise_adopted_content

    ## 作者输入
    把已保存设定中岑舟的年龄从二十五岁改成三十岁，其他内容保持不变。
    """

    assert SliceVerify.chapter_structure_arguments(q1c) == nil

    outline = """
    本次你承担创作判断器的角色。

    ## 作者输入
    帮我规划第三卷的章节大纲和分章结构。
    """

    assert SliceVerify.chapter_structure_arguments(outline) == nil
  end
end

defmodule NovelAgent.Provider.SliceVerifyExplorationCitationSourceTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Test.Provider.SliceVerify

  test "B30 回归：探索回复引用观察段的设计态计划，不引用 session_adoptions JSON" do
    prompt = """
    本次你承担创作判断器的角色，与作者讨论并判断创作下一步。

    ## 章节列表（共 2 章：已写 1 章，计划中 1 章）
    - 第 1 章「潮声之前」[chapter_ref=chapter:11111111-1111-1111-1111-111111111111]
    - 第 2 章「旧服务器里的残诀」[chapter_ref=chapter:22222222-2222-2222-2222-222222222222]

    ## 探索观察（已检索到的作品事实）

    ### 观察 1（chapter_read「第02章」）
    「旧服务器里的残诀」（第 2 章）
    【计划】功能定位：推进章；情节推进：陆沉舟潜入废弃机房，从旧服务器中找到残缺功法，第一次突破底层限制；人物变化：获得可成长的手段。
    【摘要】（尚无章摘要）
    【正文】还没有已采纳正文。

    ## 探索预算状态（机械事实）
    - 本轮已执行只读探索：1 次（来源：chapter_read）
    - 当前状态：仍可继续只读探索

    ## 当前可用操作（效果与权限，以本轮真实目录为准）
    - prose_writing：按明确写作坐标生成正文候选，区分首稿、续写、重写。

    ## 消息处置与已有产物
    下列是当前作品和会话的记录事实。
    {"pending_adoptions":[],"pending_adoption_count":0,"resolved_adoptions":[],"author_inputs":[{"text":"「第02章」按计划要写什么？","run_ref":"run_x","turn_ref":"message_x"}],"omitted_adoptions":0}

    ## 作者输入
    「第02章」按计划要写什么？
    """

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})
    content = result.content

    # 必须引用观察里的设计态计划内容（该内容只存在于已采纳大纲）
    assert content =~ "旧服务器里的残诀"
    assert content =~ "残缺功法"
    assert content =~ "突破底层限制"
    assert content =~ "【计划】"

    # 不得把观察段之后的会话候选 JSON 当引用
    refute content =~ "pending_adoptions"
    refute content =~ "author_inputs"
    refute content =~ "omitted_adoptions"
    refute content =~ ~s("text")
    refute content =~ "session_adoptions"
    assert result.tool_calls == []
  end

  test "单调用判断在只读探索后以引用回复收束，不依赖旧叙事回声" do
    for {term, observation} <- [
          {"三十岁", "「第01章：夜潮」点灯人第一次点灯时才三十岁。"},
          {"二十五岁", "正文中未检索到「二十五岁」。"}
        ] do
      initial = """
      本次你承担创作判断器的角色。
      ## 探索目录
      - prose_search
      ## 作者输入
      查一下第01章正文里有没有出现「#{term}」，只按当前正文回答。
      """

      assert {:ok, first} = SliceVerify.complete(nil, nil, initial, %InferenceParams{})
      assert [%{"arguments" => %{"action" => "explore"}}] = first.tool_calls

      followup = initial <> "\n## 探索观察\n### 观察 1（prose_search）\n#{observation}\n"
      assert {:ok, second} = SliceVerify.complete(nil, nil, followup, %InferenceParams{})
      assert second.tool_calls == []
      assert second.content =~ observation
    end
  end

  test "明确要求取证后写作时，观察段不吞掉真实写作动作" do
    prompt = """
    本次你承担创作判断器的角色。
    ## 作者输入
    根据已查到的「灵气」线索续写第一章正文。
    ## 探索观察
    「第01章」灵气沿墙缝流动。
    """

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})

    assert [%{"arguments" => %{"action" => "execute", "capability" => "prose_writing"}}] =
             result.tool_calls
  end

  test "探索段缺失时回退不伪造（无观察不引用 JSON）" do
    prompt = """
    本次你承担创作判断器的角色。

    ## 消息处置与已有产物
    {"pending_adoptions":[],"author_inputs":[{"text":"「第02章」查一下"}]}

    ## 作者输入
    「第02章」查一下
    """

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})
    refute result.content =~ "pending_adoptions"
    refute result.content =~ "author_inputs"
  end
end

defmodule NovelAgent.Provider.SliceVerifyCharacterRoleQuestionTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Test.Provider.SliceVerify

  defp prompt(author_text, index_lines) do
    """
    本次你承担创作判断器的角色。

    ## 作品事实（持久化只读投影）
    - 全书：正文统计：1 章中已写 1 章

    ## 角色索引（已有角色；character_ref 是身份，name/aliases 仅展示与消歧）
    #{index_lines}

    ## 作者输入
    #{author_text}
    """
  end

  test "B29 CP3：「谁是主角」从角色索引当前 narrative_role 回答（多主角全列）" do
    index = """
    - character:11111111-1111-1111-1111-111111111111｜沈砚｜别名：老沈｜narrative_role=PROTAGONIST｜查账人
    - character:22222222-2222-2222-2222-222222222222｜顾青｜别名：｜narrative_role=PROTAGONIST｜巡夜人
    - character:33333333-3333-3333-3333-333333333333｜阿鸢｜别名：｜narrative_role=SUPPORTING｜线人
    """

    assert {:ok, result} =
             SliceVerify.complete(nil, nil, prompt("现在谁是主角？", index), %InferenceParams{})

    assert result.content =~ "当前作品有 2 位主角（群像）：沈砚、顾青"
    assert result.content =~ "角色主档案"
    refute result.content =~ "你想直接和我讨论"
    assert result.tool_calls == []

    assert String.contains?(SliceVerify.character_role_answer(prompt("谁是主角", index)), "沈砚")
  end

  test "AU09 回归：作品上下文存在但 roster 为空（无角色索引段）→ 诚实缺主角，不误报无法核对" do
    empty_roster = """
    本次你承担创作判断器的角色。

    ## 作品事实（持久化只读投影）
    - 全书：全书目标=未登记；正文统计：0 章中已写 0 章

    ## 章节列表（共 0 章：已写 0 章，计划中 0 章）
    （当前作品还没有章节）

    ## 作者输入
    现在谁是主角？
    """

    answer = SliceVerify.character_role_answer(empty_roster)
    assert answer =~ "目前还没有谁被标记为主角"
    assert answer =~ "以角色主档案为准"
    assert answer =~ "指定某个已有角色为主角"
    refute answer =~ "没有可核对的角色索引"

    assert {:ok, result} = SliceVerify.complete(nil, nil, empty_roster, %InferenceParams{})
    assert result.content =~ "目前还没有谁被标记为主角"
    refute result.content =~ "没有可核对的角色索引"
    assert result.tool_calls == []
  end

  test "B29 CP3：单主角显示姓名；无主角诚实；无索引不引用记忆/不编造" do
    one = """
    - character:11111111-1111-1111-1111-111111111111｜沈砚｜别名：老沈｜narrative_role=PROTAGONIST｜查账人
    - character:22222222-2222-2222-2222-222222222222｜顾青｜别名：｜narrative_role=SUPPORTING｜巡夜人
    """

    assert SliceVerify.character_role_answer(prompt("现在谁是主角？", one)) =~ "当前作品的主角是 沈砚"

    no_protagonist = """
    - character:11111111-1111-1111-1111-111111111111｜沈砚｜别名：老沈｜narrative_role=ENSEMBLE_POV｜查账人
    """

    assert SliceVerify.character_role_answer(prompt("有没有主角？", no_protagonist)) =~
             "目前还没有谁被标记为主角"

    no_index = """
    本次你承担创作判断器的角色。

    ## 作者输入
    现在谁是主角？
    """

    answer = SliceVerify.character_role_answer(no_index)
    assert answer =~ "没有可核对的角色索引"
    refute answer =~ "沈砚"
  end
end

defmodule NovelAgent.Provider.SliceVerifyCharacterProfileRevisionTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Test.Provider.SliceVerify

  @shen "character:11111111-1111-1111-1111-111111111111"
  @shen2 "character:33333333-3333-3333-3333-333333333333"
  @gu "character:22222222-2222-2222-2222-222222222222"
  @ayuan "character:44444444-4444-4444-4444-444444444444"

  defp index(entries \\ nil) do
    entries ||
      """
      - #{@shen}｜沈砚｜别名：老沈｜narrative_role=ENSEMBLE_POV｜灯楼查账人
      - #{@gu}｜顾青｜别名：｜narrative_role=PROTAGONIST｜巡夜人
      - #{@ayuan}｜阿鸢｜别名：小鸢｜narrative_role=SUPPORTING｜线人
      """
  end

  defp ambiguous_index do
    """
    - #{@shen}｜沈砚｜别名：老沈｜narrative_role=ENSEMBLE_POV｜灯楼查账人
    - #{@shen2}｜沈砚｜别名：小沈｜narrative_role=MINOR｜账房学徒
    - #{@gu}｜顾青｜别名：｜narrative_role=PROTAGONIST｜巡夜人
    """
  end

  defp prompt(author_text, index_lines) do
    """
    本次你承担创作判断器的角色。

    ## 作品事实（持久化只读投影）
    - 全书：正文统计：1 章中已写 1 章

    ## 角色索引（已有角色；character_ref 是身份，name/aliases 仅展示与消歧）
    #{index_lines}

    ## 作者输入
    #{author_text}
    """
  end

  defp args(prompt) do
    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})
    assert [%{"name" => "judgment_decision", "arguments" => arguments}] = result.tool_calls
    arguments
  end

  test "唯一别名/唯一角色名 → execute revise_character_profile + 索引 ref（无 changes 等字段）" do
    alias_args = args(prompt("指定老沈为主角", index()))
    assert alias_args["action"] == "execute"
    assert alias_args["capability"] == "revise_character_profile"
    assert alias_args["character_ref"] == @shen
    assert alias_args["dialogue_goal"] == "指定老沈为主角"
    refute Map.has_key?(alias_args, "changes")
    refute Map.has_key?(alias_args, "old")
    refute Map.has_key?(alias_args, "new")
    refute Map.has_key?(alias_args, "adopted_content_ref")

    name_args = args(prompt("把顾青改判为反派", index()))
    assert name_args["capability"] == "revise_character_profile"
    assert name_args["character_ref"] == @gu
  end

  test "跨分句的调整大纲与更新主角状态不合并成角色身份改判" do
    for separator <- ["，", "；", "\n"] do
      input = "先读完第01章正文#{separator}再调整章节大纲#{separator}最后更新主角当前状态"
      full = prompt(input, index())
      assert SliceVerify.character_profile_arguments(full) == nil
      assert args(full)["action"] == "plan"
    end
  end

  test "同一分句明确调整角色叙事身份仍绑定已有角色" do
    result = args(prompt("调整顾青的叙事身份为主角", index()))
    assert result["capability"] == "revise_character_profile"
    assert result["character_ref"] == @gu
  end

  test "同名多候选 → 原生 ask_author 列候选 ref，不猜/不执行" do
    author = "指定沈砚为主角"
    full = prompt(author, ambiguous_index())

    assert %{mode: :clarify, question: question, options: options} =
             SliceVerify.character_profile_arguments(full)

    assert question =~ "同名/多候选"
    assert Enum.map(options, & &1.value) |> Enum.sort() == Enum.sort([@shen, @shen2])

    assert {:ok, result} = SliceVerify.complete(nil, nil, full, %InferenceParams{})
    assert [%{"name" => "ask_author", "arguments" => ask}] = result.tool_calls
    assert (ask[:question] || ask["question"]) =~ "同名/多候选"
    assert result.content =~ "同名/多候选"
  end

  test "讨论/询问不触发修订（reply）；设计新主角不误触发本分支" do
    discussion = prompt("老沈适合当主角吗？只讨论，不要改作品设定。", index())
    assert SliceVerify.character_profile_arguments(discussion) == nil

    assert {:ok, result} = SliceVerify.complete(nil, nil, discussion, %InferenceParams{})

    refute Enum.any?(
             result.tool_calls,
             &(&1["name"] == "judgment_decision" and
                 get_in(&1, ["arguments", "capability"]) == "revise_character_profile")
           )

    design = prompt("帮我设计一个新主角", index())
    assert SliceVerify.character_profile_arguments(design) == nil

    assert {:ok, design_result} = SliceVerify.complete(nil, nil, design, %InferenceParams{})

    refute Enum.any?(
             design_result.tool_calls,
             &(get_in(&1, ["arguments", "capability"]) == "revise_character_profile")
           )
  end

  test "不存在角色 → ask_author 不猜；无角色索引 → 诚实澄清（不新建）" do
    # 唯一角色名（阿鸢）可绑定；候选不存在才澄清
    unique = prompt("指定阿鸢为主角", index())

    assert %{mode: :execute, character_ref: @ayuan} =
             SliceVerify.character_profile_arguments(unique)

    no_match = prompt("指定一个不存在的第九角色为主角", index())
    assert %{mode: :clarify, question: q} = SliceVerify.character_profile_arguments(no_match)
    assert q =~ "没有找到"

    no_index = """
    本次你承担创作判断器的角色。

    ## 作者输入
    指定沈砚为主角
    """

    assert %{mode: :clarify, question: no_index_question} =
             SliceVerify.character_profile_arguments(no_index)

    assert no_index_question =~ "没有可核对的角色索引"
    assert {:ok, no_index_result} = SliceVerify.complete(nil, nil, no_index, %InferenceParams{})
    assert [%{"name" => "ask_author"}] = no_index_result.tool_calls
  end

  test "旧 B28/Q1c 分支不被角色档案 fixture 抢" do
    b28 = """
    本次你承担创作判断器的角色。

    ## 可选章级修订目标（只读；ref 唯一，title 仅展示）
    - chapter:11111111-1111-1111-1111-111111111111｜第01章：夜潮｜片段数 2｜覆盖 complete

    ## 作者输入
    把已保存的第一章正文整理修订一下，只调整分段和排版，不要改字句。
    """

    assert SliceVerify.character_profile_arguments(b28) == nil

    q1c = """
    本次你承担创作判断器的角色。

    ## 已采纳可修订对象（只用于 revise_adopted_content）
    - as_q1c：revise_adopted_content

    ## 作者输入
    把已保存设定中岑舟的年龄从二十五岁改成三十岁，其他内容保持不变。
    """

    assert SliceVerify.character_profile_arguments(q1c) == nil
  end
end

defmodule NovelAgent.Provider.SliceVerifyCharacterDesignJudgmentTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Test.Provider.SliceVerify

  @shen "character:11111111-1111-1111-1111-111111111111"

  defp prompt(author_text, opts \\ []) do
    roster = Keyword.get(opts, :roster)

    roster_section =
      if roster do
        """

        ## 角色索引（已有角色；character_ref 是身份，name/aliases 仅展示与消歧）
        - #{@shen}｜沈砚｜别名：老沈｜narrative_role=ENSEMBLE_POV｜查账人
        """
      else
        ""
      end

    """
    本次你承担创作判断器的角色。

    ## 作品事实（持久化只读投影）
    - 全书：正文统计：0 章中已写 0 章

    ## 章节列表（共 0 章：已写 0 章，计划中 0 章）
    （当前作品还没有章节）
    #{roster_section}

    ## 作者输入
    #{author_text}
    """
  end

  test "AU09 回归：设计主角 → execute/character_design（空 roster 也能产候选）" do
    author = "帮我设计一个主角，作为这部作品的核心人物。"

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt(author), %InferenceParams{})
    assert [%{"name" => "judgment_decision", "arguments" => args}] = result.tool_calls

    assert args["action"] == "execute"
    assert args["capability"] == "character_design"
    assert args["dialogue_goal"] == author
    refute args["capability"] == "revise_character_profile"
  end

  test "设计新角色不抢已有角色修订；指定已有先走 revise_character_profile" do
    design = prompt("设计一个新主角", roster: true)
    assert {:ok, design_result} = SliceVerify.complete(nil, nil, design, %InferenceParams{})
    [design_call] = design_result.tool_calls
    assert design_call["arguments"]["capability"] == "character_design"

    revise = prompt("指定老沈为主角", roster: true)
    assert {:ok, revise_result} = SliceVerify.complete(nil, nil, revise, %InferenceParams{})
    [revise_call] = revise_result.tool_calls
    assert revise_call["arguments"]["capability"] == "revise_character_profile"
    assert revise_call["arguments"]["character_ref"] == @shen
  end

  test "主角查询仍不触发设计/修订（诚实回答）" do
    query = prompt("现在谁是主角？")

    assert {:ok, result} = SliceVerify.complete(nil, nil, query, %InferenceParams{})
    assert result.tool_calls == []
    assert result.content =~ "目前还没有谁被标记为主角"
  end
end

defmodule NovelAgent.Provider.SliceVerifyB34AuthorIntentFixtureTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Test.Provider.SliceVerify

  defp judgment_prompt(author_text, context) do
    """
    本次你承担创作判断器的角色，与作者讨论并判断创作下一步。

    ## 当前作品与实际观察
    #{context}

    ## 作者输入
    #{author_text}

    ## 决策与输出契约
    只输出一个工具或作者可见回复。
    """
  end

  defp complete(author_text, context \\ "") do
    SliceVerify.complete(nil, nil, judgment_prompt(author_text, context), %InferenceParams{})
  end

  test "真实语料 progress_query：按章节统计回答，零候选零写入" do
    context = """
    ## 章节列表（共 3 章：已写 2 章，计划中 1 章）
    - 第 1 章「潮声之前」[chapter_ref=chapter:aaa]
    - 第 2 章「旧钱与旧名」[chapter_ref=chapter:bbb]
    - 第 3 章「外门名册上的空白」[chapter_ref=chapter:ccc]（计划中）
    """

    for wording <- ["第几章写到哪了？", "草稿在哪？", "执行完了么？", "后面还有哪些章节？"] do
      assert {:ok, result} = complete(wording, context)
      assert result.tool_calls == []
      assert result.content =~ "当前共 3 章：已写 2 章，计划中 1 章"
      refute result.content =~ "生成候选"
    end
  end

  test "真实语料 work_setup：空作品起名/开始创作 → ask_author，不直接产 prose" do
    for wording <- ["给这个作品起个名字", "新的小说开始", "开始创作，从哪开始"] do
      assert {:ok, result} = complete(wording)
      assert [%{name: "ask_author", arguments: args}] = result.tool_calls
      question = args[:question] || args["question"]
      assert is_binary(question) and question != ""
      refute result.content =~ "正文草稿"
      assert (args[:options] || args["options"]) == []
    end
  end

  test "真实语料 discussion：继续聊/写法讨论 → reply 零候选零写入" do
    for wording <- [
          "继续聊「从世界观开始」这个方向：先构建一个独特的奇幻世界，再让故事自然生长出来。",
          "这个方向的开场冲突应该怎么设计？不要写正文，只继续聊。",
          "这段写法如何？只讨论，不生成草稿。"
        ] do
      assert {:ok, result} = complete(wording)
      assert result.tool_calls == []
      assert is_binary(result.content) and result.content != ""
      refute result.content =~ "我会生成"
    end
  end

  test "真实语料 world_foreshadow：讨论不产候选；明确保存才产世界设定候选" do
    discussion = "继续聊「世界观先行」这个方向：先设定一个独特的规则体系，让故事冲突天然嵌入其中。"

    assert {:ok, discussed} = complete(discussion)
    assert discussed.tool_calls == []
    assert discussed.content =~ "只讨论"

    adopt = "把「情绪是真实可见的物质」这个设定保存为世界规则。"

    assert {:ok, adopted} = complete(adopt)

    assert [
             %{
               name: "judgment_decision",
               arguments: %{
                 "action" => "execute",
                 "capability" => "world_building"
               }
             }
           ] = adopted.tool_calls

    assert adopted.content =~ "待采纳"
  end

  test "B37 CP5：author_question options 回复“保留悬念”→ prose_writing 续写第01章" do
    assert {:ok, result} = complete("保留悬念")

    assert [%{"name" => "judgment_decision", "arguments" => args}] = result.tool_calls
    assert args["action"] == "execute"
    assert args["capability"] == "prose_writing"
    assert args["dialogue_goal"] =~ "第01章"
    assert result.content =~ "保留悬念"
  end

  test "真实语料 delegation/chitchat_noise：不自动执行/采纳，零写入" do
    for wording <- ["同意你的路径", "kkk", "2", "收到"] do
      assert {:ok, result} = complete(wording)
      assert result.tool_calls == []
      assert result.content =~ "不自动执行或采纳"
    end
  end
end

defmodule NovelAgent.Provider.SliceVerifyQualityRevisionFixtureTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Test.Provider.SliceVerify

  @retry_env "SLICE_VERIFY_QUALITY_REVISION_RETRY"
  @body "他猛地侧身。\n他一刀劈下。\n他反手格挡。\n他迈步逼近。\n他咬住暗号ABC123继续逼近。"

  setup do
    old = System.get_env(@retry_env)
    System.delete_env(@retry_env)

    on_exit(fn ->
      if old, do: System.put_env(@retry_env, old), else: System.delete_env(@retry_env)
    end)

    :ok
  end

  test "local quality revision rewrites only the finding sentence range and preserves bytes outside" do
    assert {:ok, result} = complete(quality_prompt())

    assert [%{name: "submit_tentative_artifact"} = call] = result.tool_calls
    assert call.id == "native-submit_tentative_artifact"
    assert [item] = call.arguments["items"]
    assert [first, second, third | _tail] = String.split(@body, "\n")
    assert [first, second, third] == ["他猛地侧身。", "他一刀劈下。", "他反手格挡。"]
    outside = @body |> String.split("\n") |> Enum.drop(3) |> Enum.join("\n")
    assert String.ends_with?(item["body"], "\n" <> outside)
    assert String.contains?(item["body"], "他咬住暗号ABC123继续逼近。")
    refute item["body"] == @body
  end

  test "retry env only injects current quality revision after its own failed validation" do
    System.put_env(@retry_env, "1")

    for _attempt <- 1..2 do
      assert {:ok, invalid} = complete(quality_prompt())
      assert [%{id: "native-submit_tentative_artifact", arguments: %{}}] = invalid.tool_calls
    end

    assert {:ok, valid} = complete(retry_prompt())
    assert [%{id: "native-submit_tentative_artifact"} = call] = valid.tool_calls
    assert is_list(call.arguments["items"])
    assert hd(call.arguments["items"])["body"] != @body
  end

  test "retry env ignores a failed validation from an earlier operation scope" do
    System.put_env(@retry_env, "1")

    assert {:ok, invalid} = complete(quality_prompt_with_earlier_failure())
    assert [%{arguments: %{}}] = invalid.tool_calls
  end

  test "retry env does not alter source writer or other operations" do
    System.put_env(@retry_env, "1")

    assert {:ok, source} = complete(source_writer_prompt())
    assert [%{name: "submit_tentative_artifact"} = call] = source.tool_calls
    assert is_list(call.arguments["items"])
    assert hd(call.arguments["items"])["body"] =~ "他猛地侧身。"
  end

  defp complete(prompt) do
    SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})
  end

  defp quality_prompt(history \\ []) do
    prompt(quality_scope(), history)
  end

  defp retry_prompt do
    quality_prompt(retry_history())
  end

  defp retry_history do
    failed =
      NovelTest.TestRequestIR.validation(
        "native-submit_tentative_artifact",
        "failed",
        "invalid_items"
      )

    call =
      NovelTest.TestRequestIR.assistant("", [
        NovelTest.TestRequestIR.tool_call(
          "submit_tentative_artifact",
          %{},
          "native-submit_tentative_artifact"
        )
      ])

    [call, failed]
  end

  defp quality_prompt_with_earlier_failure do
    earlier = prompt(source_writer_scope())
    [system, base, _earlier_scope] = earlier.messages
    [call, failed] = retry_history()

    %{
      earlier
      | messages:
          [system, base] ++
            [scope_message(source_writer_scope()), call, failed, scope_message(quality_scope())]
    }
  end

  defp scope_message(scope), do: NovelTest.TestRequestIR.scope(scope)

  defp source_writer_prompt do
    source_writer_scope() |> prompt()
  end

  defp source_writer_scope do
    """
    capability：prose_writing
    artifact_type：prose_fragment
    用户创作简述：写第02章：矿区追击战正文草稿，短促动作追击
    上下文：## 目标章结构
    - 计划摘要：主角在废弃矿区遭遇巡检傀儡，短促的动作追击中且战且退。
    重要：保留作者输入。
    """
  end

  defp quality_scope do
    """
    capability：prose_writing
    artifact_type：prose_fragment
    用户创作简述：请基于下文给出的原正文进行局部修订：保留原有情节走向、人物状态与作品设定，只修改证据位置命中的句段。
    上下文：原正文（第02章：矿区追击战正文草稿，短促动作追击）：
    #{@body}
    重要：保留作者输入与随机标识符 ABC123。

    [质量修订要求]
    本次修订范围：局部修订。
    只修改证据位置命中的句段，命中范围外的文字应尽量逐字保持不变。
    请仅针对以下质量问题修改上文「原正文」，逐项回应，不得改变情节走向或新增作品事实：
    1. 连续动作句使用相同句首和标点骨架，且没有形成强度或后果递进。
       位置：第 1–3 句
       原句：他猛地侧身。他一刀劈下。他反手格挡。
       判断理由：这些句子都只陈述一个动作；重复没有承担排比、仪式感或情绪升级功能。
       修订策略：只改命中句段，让动作在风险、后果或视角上形成递进。
    修订后保持与原正文相同的情节与人物状态，只解决上述问题；仍返回完整正文供作者对比。
    """
  end

  defp prompt(scope, history \\ []) do
    NovelTest.TestRequestIR.ir(
      [
        NovelTest.TestRequestIR.system("identity_ref: identity:authoring/v1"),
        NovelTest.TestRequestIR.base("【应用数据 · application_base · 非作者原话】\n输出契约。"),
        NovelTest.TestRequestIR.scope(scope)
      ] ++ history,
      tools: [
        NovelTest.TestRequestIR.tool("submit_tentative_artifact", %{
          type: "object",
          properties: %{items: %{type: "array"}}
        })
      ],
      projection: %{tool_choice: "submit_tentative_artifact"}
    )
  end
end

defmodule NovelAgent.Provider.SliceVerifyPendingDialogueTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Test.Provider.SliceVerify
  alias NovelAgent.Test.Support.PendingDialogueInput
  alias NovelCommon.RequestIR
  alias NovelCommon.SystemIdentity

  @source_text "把这份大纲直接存档为作品设定：主角沈砚经营旧书铺。校验标识c0e885d9a7c04aaa。"
  @revision_text "请修改现有候选，把沈砚改成林渡，其余内容和资料校验标识保留；生成修订候选，不要保存。"

  defp native_judgment_prompt(author_text, candidates) do
    directory = Enum.map_join(candidates, "\n", &directory_line/1)
    facts = Jason.encode!(%{"author_inputs" => [], "pending_adoptions" => candidates})

    """
    本次你承担创作判断器的角色，与作者讨论并判断创作下一步。

    ## 待采纳候选（真实对象，status=TENTATIVE；body_preview 为空时不得据此编造内容）
    #{directory}

    ## 消息处置与已有产物
    下列是当前作品和会话的记录事实。
    #{facts}

    ## 作者输入
    #{author_text}

    ## 决策与输出契约
    只输出一个工具或作者可见回复。
    """
  end

  defp directory_line(candidate) do
    "- ref=#{candidate["artifact_ref"]} | type=#{candidate["artifact_type"]} | " <>
      "status=#{candidate["status"]} | title=#{candidate["title"]} | " <>
      "operations=#{Enum.join(candidate["available_operations"], "/")} | " <>
      "body_preview=#{candidate["body_preview"]}"
  end

  defp source_candidate do
    %{
      "artifact_ref" => "as_source::world_setting",
      "artifact_type" => "world_setting",
      "status" => "TENTATIVE",
      "title" => "把这份大纲直接存档为作品设定：主角沈砚经营旧书铺",
      "available_operations" => ["revise_pending_artifact", "discard_pending_artifact"],
      # 真实判断目录的 body_preview 可能截断，不能只靠它找目标。
      "body_preview" => "把这份大纲直接存档为作品设定：主角",
      "revision_of" => nil
    }
  end

  # 当前操作 native IR：作者原话与 scope 分开，旧 scope 只作历史。
  defp ir_judgment_prompt(author_text, current_scope, older_scope \\ nil) do
    older =
      if older_scope do
        [
          NovelTest.TestRequestIR.scope(older_scope, %{scope_revision: 1}),
          NovelTest.TestRequestIR.assistant("先核对旧目录。", [
            NovelTest.TestRequestIR.tool_call(
              "judgment_decision",
              %{"action" => "explore"},
              "call-read"
            )
          ]),
          NovelTest.TestRequestIR.observation("call-read", %{
            status: "ok",
            content: %{
              "summary" => "已读到旧目录。",
              "tool" => "session_adoptions",
              "query" => "older"
            }
          })
        ]
      else
        []
      end

    version = if older_scope, do: 2, else: 1

    NovelTest.TestRequestIR.ir(
      [
        NovelTest.TestRequestIR.base(
          "【应用数据 · application_base · 非作者原话】\n本次你承担创作判断器的角色。使用 judgment_decision。"
        ),
        NovelTest.TestRequestIR.author(author_text)
      ] ++
        older ++
        [NovelTest.TestRequestIR.scope(current_scope, %{scope_revision: version})],
      tools: [NovelTest.TestRequestIR.tool("judgment_decision")],
      projection: %{tool_choice: "auto"}
    )
  end

  defp ir_directory(ref, title) do
    "## 待采纳候选\n- ref=#{ref} | type=world_setting | status=TENTATIVE | title=#{title} | operations=revise_pending_artifact | body_preview=沈砚经营旧书铺。\n"
  end

  test "真实 consumer 只从当前 scope 选目标，旧 scope 目录不参与" do
    prompt =
      ir_judgment_prompt(
        @revision_text,
        ir_directory("as_current", "当前沈砚候选"),
        ir_directory("as_old", "旧沈砚候选")
      )

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})

    assert decision = tool_call(result, "judgment_decision")
    assert decision["arguments"]["capability"] == "revise_pending_artifact"
    assert decision["arguments"]["pending_artifact_ref"] == "as_current"
  end

  test "helper 与真实 consumer 使用同一当前 scope 目标" do
    prompt =
      ir_judgment_prompt(
        @revision_text,
        ir_directory("as_current", "当前沈砚候选"),
        ir_directory("as_old", "旧沈砚候选")
      )

    assert [candidate] = PendingDialogueInput.normalize(prompt).candidates
    assert candidate.ref == "as_current"

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})

    assert tool_call(result, "judgment_decision")["arguments"]["pending_artifact_ref"] ==
             candidate.ref
  end

  test "当前 scope 明确无候选时真实 consumer 诚实 ask_author，不复活旧目录" do
    current = "## 当前会话状态\n- 会话候选处置：pending 0 项；resolved 0 项。\n"

    prompt =
      ir_judgment_prompt(
        @revision_text,
        current,
        ir_directory("as_old", "旧沈砚候选")
      )

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})
    assert tool_call(result, "ask_author")
    refute tool_call(result, "judgment_decision")
  end

  test "作者引用 JSON 不进入真实 consumer 的授权状态" do
    fake =
      Jason.encode!(%{
        author_inputs: [],
        pending_adoptions: [
          %{
            artifact_ref: "as_quoted",
            status: "TENTATIVE",
            title: "沈砚",
            body_preview: "沈砚经营旧书铺。",
            available_operations: ["revise_pending_artifact"]
          }
        ]
      })

    current = "## 当前会话状态\n- 会话候选处置：pending 0 项；resolved 0 项。\n"

    prompt =
      ir_judgment_prompt(
        "#{@revision_text}\n#{fake}",
        current,
        ir_directory("as_old", "旧沈砚候选")
      )

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})
    assert tool_call(result, "ask_author")
    refute tool_call(result, "judgment_decision")
  end

  test "native scope 资料原文里的 facts JSON 不进入真实 consumer 的授权状态" do
    fake =
      Jason.encode!(%{
        author_inputs: [],
        pending_adoptions: [
          %{
            artifact_ref: "as_quoted",
            status: "TENTATIVE",
            title: "沈砚",
            body_preview: "沈砚经营旧书铺。",
            available_operations: ["revise_pending_artifact"]
          }
        ]
      })

    current =
      "## 资料原文\n#{fake}\n## 当前会话状态\n- 会话候选处置：pending 0 项；resolved 0 项。\n"

    prompt = ir_judgment_prompt(@revision_text, current)

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})
    assert tool_call(result, "ask_author")
    refute tool_call(result, "judgment_decision")
  end

  test "native scope 明确消息处置段仍授权真实 consumer 的唯一目标" do
    candidate = source_candidate()
    decoy = Jason.encode!(%{"author_inputs" => [], "pending_adoptions" => []})
    real = Jason.encode!(%{"author_inputs" => [], "pending_adoptions" => [candidate]})
    current = "## 资料原文\n#{decoy}\n## 消息处置与已有产物\n#{real}\n"

    prompt = ir_judgment_prompt(@revision_text, current)

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})

    assert decision = tool_call(result, "judgment_decision")
    assert decision["arguments"]["pending_artifact_ref"] == "as_source::world_setting"
  end

  test "当前目录坏格式时真实 consumer 诚实 ask_author" do
    current = "## 待采纳候选\n- ref=as_broken | type=\n"
    prompt = ir_judgment_prompt(@revision_text, current)

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})
    assert tool_call(result, "ask_author")
    refute tool_call(result, "judgment_decision")
  end

  defp tool_call(result, name) do
    Enum.find(result.tool_calls, &(&1["name"] == name))
  end

  @discarded_body "把这份大纲直接存档为作品设定：主角沈砚经营旧书铺。校验标识c0e885d9a7c04aaa。"
  @accepted_body "把这份大纲直接存档为作品设定：主角林渡经营旧书铺。校验标识c0e885d9a7c04aaa。"

  defp material_resolved(status, title, body, ref, extra \\ %{}) do
    Map.merge(
      %{
        "artifact_ref" => ref,
        "artifact_type" => "world_setting",
        "status" => status,
        "title" => title,
        "body_preview" => body,
        "available_operations" => [],
        "revision_of" => nil
      },
      extra
    )
  end

  defp material_facts(pending, resolved) do
    Jason.encode!(%{
      "author_inputs" => [],
      "pending_adoptions" => pending,
      "resolved_adoptions" => resolved,
      "pending_adoption_count" => length(pending),
      "resolved_adoption_count" => length(resolved),
      "omitted_adoptions" => 0
    })
  end

  defp material_scope(pending, resolved, extra \\ "") do
    extra <> "\n## 消息处置与已有产物\n" <> material_facts(pending, resolved) <> "\n"
  end

  defp chapter_context(total, written, planned) do
    "## 章节列表（共 #{total} 章：已写 #{written} 章，计划中 #{planned} 章）\n"
  end

  defp resolved_g5_facts do
    [
      material_resolved(
        "DISCARDED",
        "把这份大纲直接存档为作品设定：主角沈砚经营旧书铺",
        @discarded_body,
        "as_source"
      ),
      material_resolved(
        "ACCEPTED",
        "旧书铺修订稿",
        @accepted_body,
        "as_revision",
        %{"revision_of" => "as_source", "available_operations" => ["revise_adopted_content"]}
      )
    ]
  end

  test "资料进度读取本轮 scope 的 ACCEPTED/DISCARDED 事实与完整 body_preview" do
    current = material_scope([], resolved_g5_facts(), chapter_context(0, 0, 0))
    prompt = ir_judgment_prompt("资料处理进度怎么样？", current)

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})

    assert result.tool_calls == []
    assert result.content =~ "待采纳 0 份"
    assert result.content =~ "已处置 2 份"
    assert result.content =~ "ACCEPTED"
    assert result.content =~ "DISCARDED"
    assert result.content =~ "已采纳"
    assert result.content =~ "已放弃"
    assert result.content =~ "没有待采纳"
    assert result.content =~ @accepted_body
    assert result.content =~ @discarded_body
    assert length(String.split(result.content, @accepted_body)) == 2
    assert length(String.split(result.content, @discarded_body)) == 2
    refute result.content =~ "其他处置"
    refute result.content =~ "当前共 0 章"
  end

  test "明确章节进度仍使用真实章节统计，即使 scope 带有资料处置事实" do
    current = material_scope([], resolved_g5_facts(), chapter_context(3, 2, 1))
    prompt = ir_judgment_prompt("这本书的章节进度怎么样？", current)

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})

    assert result.tool_calls == []
    assert result.content =~ "当前共 3 章：已写 2 章，计划中 1 章"
    refute result.content =~ "ACCEPTED"
    refute result.content =~ "DISCARDED"
  end

  test "当前 scope 没有资料状态时诚实说未知，不拿章节统计冒充" do
    current = chapter_context(0, 0, 0)
    prompt = ir_judgment_prompt("资料处理进度怎么样？", current)

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})

    assert result.tool_calls == []
    assert result.content =~ "没有提供"
    assert result.content =~ "无法确认"
    refute result.content =~ "当前共 0 章"
    refute result.content =~ "ACCEPTED"
    refute result.content =~ "DISCARDED"
  end

  test "历史 scope 的候选处置事实不能补当前缺失的资料状态" do
    older = material_scope([], resolved_g5_facts())
    current = chapter_context(0, 0, 0)
    prompt = ir_judgment_prompt("资料处理进度怎么样？", current, older)

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})

    assert result.tool_calls == []
    assert result.content =~ "没有提供"
    refute result.content =~ "ACCEPTED"
    refute result.content =~ "DISCARDED"
    refute result.content =~ @accepted_body
    refute result.content =~ @discarded_body
  end

  test "当前 scope 目录坏格式时资料状态查询如实说无法解析" do
    current = "## 待采纳候选\n- ref=as_broken | type=\n" <> chapter_context(0, 0, 0)
    prompt = ir_judgment_prompt("资料处理进度怎么样？", current)

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})

    assert result.tool_calls == []
    assert result.content =~ "无法解析"
    assert result.content =~ "无法确认"
    refute result.content =~ "待采纳 0 份"
    refute result.content =~ "当前共 0 章"
  end

  test "泛化进度问句在本轮 scope 有资料处置事实时由资料状态拥有" do
    current = material_scope([], resolved_g5_facts(), chapter_context(0, 0, 0))
    prompt = ir_judgment_prompt("进度怎么样？", current)

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})

    assert result.content =~ "ACCEPTED"
    assert result.content =~ "DISCARDED"
    refute result.content =~ "当前共 0 章"
  end

  test "泛化进度问句在本轮 scope 无资料事实时仍走真实章节统计" do
    current = chapter_context(3, 2, 1)
    prompt = ir_judgment_prompt("进度怎么样？", current)

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})

    assert result.content =~ "当前共 3 章：已写 2 章，计划中 1 章"
    refute result.content =~ "ACCEPTED"
  end

  test "资料处置意图分流不回归：放弃候选仍绑定本轮真实目录 ref" do
    prompt =
      native_judgment_prompt("请放弃原候选，把这份资料从待采纳里去掉，不要删除已保存事实。", [
        source_candidate()
      ])

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})

    assert decision = tool_call(result, "judgment_decision")
    assert decision["arguments"]["action"] == "execute"
    assert decision["arguments"]["capability"] == "discard_pending_artifact"
    assert decision["arguments"]["pending_artifact_ref"] == "as_source::world_setting"
  end

  test "Q1B 原文登记先于内容名词识别：选 register_author_content 而不是 character_design" do
    prompt = native_judgment_prompt(@source_text, [])

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})

    assert registration = tool_call(result, "register_author_content")
    assert registration["arguments"][:author_content_source_ref] == "current"
    refute tool_call(result, "judgment_decision")
  end

  test "正常设计新主角仍走 character_design，不被登记分支抢占" do
    prompt = native_judgment_prompt("帮我设计一个主角，名字叫林烬，是灵气稽查官。", [])

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})

    assert decision = tool_call(result, "judgment_decision")
    assert decision["arguments"]["action"] == "execute"
    assert decision["arguments"]["capability"] == "character_design"
    refute tool_call(result, "register_author_content")
  end

  test "修订目标用真实目录 title 唯一匹配，preview 截断不影响唯一 target" do
    prompt = native_judgment_prompt(@revision_text, [source_candidate()])

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})

    assert decision = tool_call(result, "judgment_decision")
    assert decision["arguments"]["action"] == "execute"
    assert decision["arguments"]["capability"] == "revise_pending_artifact"
    assert decision["arguments"]["pending_artifact_ref"] == "as_source::world_setting"
  end

  test "多个候选同样匹配改名对象时诚实 ask_author，不选 first/latest" do
    first = %{source_candidate() | "artifact_ref" => "as_source::one", "title" => "沈砚候选一"}
    second = %{source_candidate() | "artifact_ref" => "as_source::two", "title" => "沈砚候选二"}

    prompt = native_judgment_prompt(@revision_text, [first, second])

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})

    assert tool_call(result, "ask_author")
    refute tool_call(result, "judgment_decision")
  end

  test "缺候选目录时诚实 ask_author，不发 null ref execute" do
    prompt = native_judgment_prompt(@revision_text, [])

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})

    assert tool_call(result, "ask_author")
    refute tool_call(result, "judgment_decision")
  end

  test "目录未提供 revise 权限时诚实 ask_author，不靠 ref 猜" do
    candidate = %{
      source_candidate()
      | "available_operations" => ["discard_pending_artifact"]
    }

    prompt = native_judgment_prompt(@revision_text, [candidate])

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})

    assert tool_call(result, "ask_author")
    refute tool_call(result, "judgment_decision")
  end

  test "单一候选但作者点名对象不匹配时仍诚实 ask_author" do
    candidate = %{
      source_candidate()
      | "title" => "另一份候选",
        "body_preview" => "第一段文字。"
    }

    prompt = native_judgment_prompt(@revision_text, [candidate])

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})

    assert tool_call(result, "ask_author")
    refute tool_call(result, "judgment_decision")
  end

  test "旧格式仅提供消息处置 JSON 时仍按同一解析结果唯一选目标" do
    candidate = source_candidate()

    facts =
      Jason.encode!(%{
        "author_inputs" => [],
        "pending_adoptions" => [candidate]
      })

    prompt = """
    本次你承担创作判断器的角色。

    ## 消息处置与已有产物
    #{facts}

    ## 作者输入
    #{@revision_text}
    """

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})

    assert decision = tool_call(result, "judgment_decision")
    assert decision["arguments"]["pending_artifact_ref"] == "as_source::world_setting"
  end

  test "非法 ref 注入需要 env 与作者标记同时出现，正常修订不触发" do
    old = System.get_env("SLICE_VERIFY_PENDING_INVALID_REF")
    System.put_env("SLICE_VERIFY_PENDING_INVALID_REF", "1")
    on_exit(fn -> restore_env("SLICE_VERIFY_PENDING_INVALID_REF", old) end)

    prompt = native_judgment_prompt(@revision_text, [source_candidate()])

    assert {:ok, result} = SliceVerify.complete(nil, nil, prompt, %InferenceParams{})
    assert decision = tool_call(result, "judgment_decision")
    assert decision["arguments"]["pending_artifact_ref"] == "as_source::world_setting"
  end

  test "记录边界只写实际 IR，并裁剪 message private 字段" do
    old = Application.get_env(:novel_telemetry, :llm_log_dir)

    dir =
      Path.join(System.tmp_dir!(), "slice-verify-capture-#{System.unique_integer([:positive])}")

    Application.put_env(:novel_telemetry, :llm_log_dir, dir)

    on_exit(fn ->
      restore_env(:llm_log_dir, old)
      File.rm_rf!(dir)
    end)

    private_state = %{reasoning_content: "private-capture"}
    private_session = %{handle: "private-session"}

    ir =
      NovelTest.TestRequestIR.ir(
        [
          NovelTest.TestRequestIR.base("记录边界 Base"),
          NovelTest.TestRequestIR.author("记录边界作者原话")
        ],
        tools: [NovelTest.TestRequestIR.tool("judgment_decision")],
        projection: %{tool_choice: "auto"}
      )

    assistant =
      NovelTest.TestRequestIR.assistant("")
      |> Map.put(:provider_state, private_state)
      |> Map.put(:provider_session, private_session)

    ir = %{ir | messages: ir.messages ++ [assistant]}

    assert {:ok, _result} = SliceVerify.complete(nil, nil, ir, %InferenceParams{})

    record =
      Enum.find(read_capture_records(dir), fn record ->
        record["request_body"]
        |> Map.get("messages", [])
        |> Enum.any?(fn message ->
          message["role"] == "user" and message["provenance"] == "author" and
            Enum.any?(message["blocks"], &(&1["text"] == "记录边界作者原话"))
        end)
      end)

    assert record
    assert record["request_format"] == RequestIR.ir_version()
    assert record["prompt"] == nil
    refute Map.has_key?(record["request_body"], "text")
    assert record["request_body"]["ir_version"] == RequestIR.ir_version()

    assert [%{"role" => "application_base"} | _] = record["request_body"]["messages"]

    refute Enum.any?(record["request_body"]["messages"], fn message ->
             Map.has_key?(message, "provider_state") or
               Map.has_key?(message, "provider_session")
           end)

    recorded_assistant =
      Enum.find(record["request_body"]["messages"], &(&1["role"] == "assistant"))

    refute Map.has_key?(recorded_assistant, "provider_state")
    refute Map.has_key?(recorded_assistant, "provider_session")

    # 裁剪只发生在记录边界，原请求仍保留私有字段供真实恢复。
    original_assistant = Enum.find(ir.messages, &(&1.role == "assistant"))
    assert original_assistant.provider_state == private_state
    assert original_assistant.provider_session == private_session
  end

  test "请求材料读取区分 canonical IR 与真实非 IR system/user 文本，不互相合成" do
    author =
      RequestIR.message(:user, :author, [
        RequestIR.text_block("  第一段\n"),
        RequestIR.text_block("第二段")
      ])

    ir =
      NovelTest.TestRequestIR.ir([
        NovelTest.TestRequestIR.base("Base"),
        author,
        NovelTest.TestRequestIR.scope("当前 scope"),
        NovelTest.TestRequestIR.assistant("已响应"),
        NovelTest.TestRequestIR.notice("通知")
      ])

    assert NovelTest.TestProviderPrompt.author_text(ir) == "  第一段\n第二段"
    assert NovelTest.TestProviderPrompt.latest_scope(ir) == "当前 scope"

    history = NovelTest.TestProviderPrompt.current_operation_messages(ir)
    assert Enum.map(history, & &1.role) == ["assistant", "application_notice"]
    assert Enum.all?(history, &is_list(&1.blocks))

    wire = [
      %{role: "system", content: "系统约束"},
      %{role: "user", content: "作者原话"}
    ]

    assert NovelTest.TestProviderPrompt.text(wire) == "system: 系统约束\nuser: 作者原话"

    assert NovelTest.TestProviderPrompt.operation_text(wire) ==
             NovelTest.TestProviderPrompt.text(wire)

    assert NovelTest.TestProviderPrompt.author_text(wire) == ""
    assert NovelTest.TestProviderPrompt.latest_scope(wire) == nil
    assert NovelTest.TestProviderPrompt.current_operation_messages(wire) == []
    refute Enum.any?(wire, &Map.has_key?(&1, :blocks))
    refute Enum.any?(wire, &Map.has_key?(&1, :provenance))

    # 生产身份注入已退役：真实非 IR 请求的身份前缀就是 wire system 消息，
    # 读取侧只按身份真源原文过滤，不合成 provenance/blocks。
    injected = [
      %{role: "system", content: SystemIdentity.content()},
      %{role: "user", content: "普通请求"}
    ]

    assert NovelTest.TestProviderPrompt.text(injected) == "user: 普通请求"
  end

  defp read_capture_records(dir) do
    file = Path.join(dir, "#{NovelTelemetry.LogFileDate.today_iso8601()}.jsonl")

    file
    |> File.read!()
    |> String.split("\n", trim: true)
    |> Enum.map(&Jason.decode!/1)
  end

  defp restore_env(name, nil), do: System.delete_env(to_string(name))
  defp restore_env(name, value), do: System.put_env(to_string(name), value)
end
