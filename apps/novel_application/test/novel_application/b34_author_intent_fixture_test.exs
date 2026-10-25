defmodule NovelApplication.B34AuthorIntentFixtureTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Test.Provider.SliceVerify
  alias NovelApplication.JudgmentProtocol
  alias NovelCommon.Contracts.ProviderOutput

  @chapters """
  ## 章节列表（共 3 章：已写 2 章，计划中 1 章）
  - 第 1 章「潮声之前」[chapter_ref=chapter:aaa]
  - 第 2 章「旧钱与旧名」[chapter_ref=chapter:bbb]
  - 第 3 章「外门名册上的空白」[chapter_ref=chapter:ccc]（计划中）
  """

  defp execution do
    %Execution{
      result_fn: fn prompt ->
        {:ok, result} = SliceVerify.complete(nil, nil, prompt, %{})

        {:ok,
         %{
           content: result.content,
           tool_calls: result.tool_calls,
           provider_output: %ProviderOutput{
             provider_run_ref: "run-b34-fixture",
             provider_call_ref: "call-b34-fixture",
             status: :ok,
             content: %{text: result.content, tool_calls: result.tool_calls}
           }
         }}
      end
    }
  end

  defp request(author_text, opts \\ []) do
    input = %{
      author_text: author_text,
      context_block: Keyword.get(opts, :context_block, ""),
      options: [
        capabilities: [
          "prose_writing",
          "character_design",
          "revise_adopted_content",
          "world_building"
        ],
        explore: false
      ]
    }

    JudgmentProtocol.request_judgment(execution(), %{}, input)
  end

  test "B34 progress_query 真实链路：章节统计→reply，零候选/零写入" do
    for wording <- ["第几章写到哪了？", "草稿在哪？", "执行完了么？"] do
      assert {:ok, judgment} = request(wording, context_block: @chapters)

      assert judgment.action == "reply"
      assert judgment.candidate_directions == []
      assert judgment.narrative =~ "当前共 3 章：已写 2 章，计划中 1 章"
      assert judgment.provider_call_count == 1
    end
  end

  test "B34 work_setup 真实链路：空作品起名/开始创作→ask_author，不产 prose" do
    for wording <- ["给这个作品起个名字", "新的小说开始", "开始创作，从哪开始"] do
      assert {:ok, judgment} = request(wording)

      assert judgment.action == "await_author"
      assert is_binary(judgment.question) and judgment.question != ""
      assert judgment.question =~ "题材" or judgment.question =~ "方向"
      assert judgment.capability == nil
      assert judgment.candidate_directions == []
    end
  end

  test "B34 discussion 真实链路：讨论/方向→reply，零候选/零写入，B33 不误纠错" do
    for wording <- [
          "继续聊「从世界观开始」这个方向：先构建一个独特的奇幻世界，再让故事自然生长出来。",
          "这个方向的开场冲突应该怎么设计？不要写正文，只继续聊。"
        ] do
      assert {:ok, judgment} = request(wording)

      assert judgment.action == "reply"
      assert judgment.candidate_directions == []
      assert judgment.provider_call_count == 1
      assert is_binary(judgment.narrative) and judgment.narrative != ""
    end
  end

  test "B34 world_foreshadow 讨论 vs 采纳边界真实链路" do
    discussion = "继续聊「世界观先行」这个方向：先设定一个独特的规则体系，让故事冲突天然嵌入其中。"

    assert {:ok, discussed} = request(discussion)
    assert discussed.action == "reply"
    assert discussed.candidate_directions == []

    adopt = "把「情绪是真实可见的物质」这个设定保存为世界规则。"

    assert {:ok, adopted} = request(adopt)
    assert adopted.action == "execute"
    assert adopted.capability == "world_building"
    assert adopted.narrative =~ "待采纳"
  end

  test "B34 delegation/chitchat_noise 真实链路：不自动执行/采纳，零候选" do
    for wording <- ["同意你的路径", "kkk", "2", "收到"] do
      assert {:ok, judgment} = request(wording)

      assert judgment.action == "reply"
      assert judgment.candidate_directions == []
      assert judgment.capability == nil
    end
  end
end
