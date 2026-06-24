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
