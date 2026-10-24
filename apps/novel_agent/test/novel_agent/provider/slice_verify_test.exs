defmodule NovelAgent.Provider.SliceVerifyTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Test.Provider.SliceVerify

  test "SU02SLOW author nonce produces a delayed unique frame response" do
    nonce = "SU02SLOWABC123"
    prompt = [%{role: "user", content: "请回一句收到，#{nonce}"}]

    start = System.monotonic_time(:millisecond)
    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})
    duration = System.monotonic_time(:millisecond) - start

    assert duration >= 2_000
    body = Jason.decode!(result.content)
    assert body["frame_type"] == "casual_reply"
    assert body["assistant_message"] =~ nonce
    assert body["assistant_message"] =~ "只属于原作品"
  end

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
    prompt = %{
      messages: [
        %{
          role: "user",
          content: """
          你是小说创作系统的 AgentRun 计划起草器。
          - profile_ref: fact_inventory_v1
          - plan_step_targets: fact_inventory
          """
        }
      ],
      tools: [%{name: "agent_plan_draft", description: "", input_schema: %{}}],
      tool_choice: "agent_plan_draft"
    }

    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})
    [%{"arguments" => arguments}] = result.tool_calls

    assert [%{target_tool_ref: "fact_inventory"}] = get_in(arguments, [:plan, :steps])
  end

  test "AU11 missing work state quality diagnosis asks for target chapter material" do
    prompt = [
      %{
        role: "system",
        content: "## AIMessageEnvelope（VS-00D 质量诊断）\n- WorkState: 来源：current_work；缺章节摘要"
      },
      %{role: "user", content: "帮我看看这一章哪里不成立。"}
    ]

    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})

    body = Jason.decode!(result.content)
    assert body["frame_type"] == "question_answer"
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
    assert body["frame_type"] == "meta_discussion"
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
    prompt = %{
      messages: [
        %{
          role: "user",
          content: """
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
          """
        }
      ],
      tools: [%{name: "agent_plan_draft", description: "", input_schema: %{}}],
      tool_choice: "agent_plan_draft"
    }

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
    prompt = %{
      messages: [
        %{
          role: "user",
          content: """
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
          """
        }
      ],
      tools: [%{name: "agent_plan_draft", description: "", input_schema: %{}}],
      tool_choice: "agent_plan_draft"
    }

    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})

    [%{"arguments" => arguments}] = result.tool_calls

    prose_step =
      arguments
      |> get_in([:plan, :steps])
      |> Enum.find(&(&1.target_tool_ref == "prose_writing"))

    assert prose_step.target_chapter == nil
    assert prose_step.requested_chapter_raw == "第99章"
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

  test "整章/通读意图 → whole_chapter；明确改一处 → target_segments" do
    assert chapter_arguments("帮我通读一遍第一章正文，看看有没有矛盾。").modification_scope ==
             "whole_chapter"

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
