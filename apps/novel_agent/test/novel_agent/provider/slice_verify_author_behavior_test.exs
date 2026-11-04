defmodule NovelAgent.Provider.SliceVerifyAuthorBehaviorTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Test.Provider.SliceVerify
  alias NovelAgent.TestRequestIR

  setup do
    previous = System.get_env("AUTHOR_BEHAVIOR_CORPUS_JSON")
    dir = Path.join(System.tmp_dir!(), "b73-provider-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    corpus = Path.join(dir, "corpus.json")
    System.put_env("AUTHOR_BEHAVIOR_CORPUS_JSON", corpus)

    on_exit(fn ->
      if previous,
        do: System.put_env("AUTHOR_BEHAVIOR_CORPUS_JSON", previous),
        else: System.delete_env("AUTHOR_BEHAVIOR_CORPUS_JSON")

      File.rm_rf(dir)
    end)

    {:ok, corpus: corpus}
  end

  test "B73 execute fixture 只刺激判断，真实主链负责后续候选", %{corpus: corpus} do
    expression = "把第02章补完，接上现在的结尾。"

    File.write!(
      corpus,
      Jason.encode!(%{
        "fixtures" => [
          %{
            "case_id" => "C-F2-001",
            "expression" => expression,
            "action" => "execute",
            "capability" => "prose_writing",
            "note" => "execute stimulus"
          }
        ]
      })
    )

    prompt =
      TestRequestIR.ir([
        TestRequestIR.base("创作判断器"),
        TestRequestIR.author(expression)
      ])

    assert System.get_env("AUTHOR_BEHAVIOR_CORPUS_JSON") == corpus
    assert %{"fixtures" => [%{"action" => "execute"}]} = corpus |> File.read!() |> Jason.decode!()
    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})
    assert [%{name: "judgment_decision"} = call] = result.tool_calls
    arguments = call[:arguments] || call["arguments"]
    assert (arguments[:action] || arguments["action"]) == "execute"
    assert (arguments[:capability] || arguments["capability"]) == "prose_writing"
    assert (arguments[:dialogue_goal] || arguments["dialogue_goal"]) == expression
  end

  test "B73 world execute 在 profile router 保持世界设定能力", %{corpus: corpus} do
    expression = "这个设定捋一下，能落成一条规则就存下来。"

    File.write!(
      corpus,
      Jason.encode!(%{
        "fixtures" => [
          %{
            "case_id" => "C-F3-002",
            "expression" => expression,
            "action" => "execute",
            "capability" => "world_building",
            "note" => "world execute stimulus"
          }
        ]
      })
    )

    prompt =
      "AgentRun profile router\n## 作者输入\n#{expression}\n{\"profile_ref\":\"conversation_turn_v1\"}"

    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})
    assert Jason.decode!(result.content)["profile_ref"] == "world_building_with_context_v1"
  end

  test "B73 fixture 只匹配当前作者输入，不抢历史消息能力", %{corpus: corpus} do
    prose_expression = "把第02章补完，接上现在的结尾。"
    world_expression = "这个设定捋一下，能落成一条规则就存下来。"

    File.write!(
      corpus,
      Jason.encode!(%{
        "fixtures" => [
          %{
            "case_id" => "C-F2-001",
            "expression" => prose_expression,
            "action" => "execute",
            "capability" => "prose_writing",
            "note" => "prose"
          },
          %{
            "case_id" => "C-F3-002",
            "expression" => world_expression,
            "action" => "execute",
            "capability" => "world_building",
            "note" => "world"
          }
        ]
      })
    )

    prompt =
      TestRequestIR.ir([
        TestRequestIR.base("创作判断器\n## 历史消息\n#{prose_expression}"),
        TestRequestIR.author(world_expression)
      ])

    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})
    assert [%{name: "judgment_decision"} = call] = result.tool_calls
    arguments = call[:arguments] || call["arguments"]
    assert (arguments[:capability] || arguments["capability"]) == "world_building"
  end

  test "B73 pending 修订 fixture 从真实目录绑定原稿 ref", %{corpus: corpus} do
    expression = "请修改现有候选，把沈砚改成林渡，其余内容和资料校验标识保留；生成修订候选，不要保存。"

    File.write!(
      corpus,
      Jason.encode!(%{
        "fixtures" => [
          %{
            "case_id" => "C-F3-E03",
            "expression" => expression,
            "action" => "execute",
            "capability" => "revise_pending_artifact",
            "target_role" => "original",
            "note" => "pending revision"
          }
        ]
      })
    )

    prompt =
      TestRequestIR.ir([
        TestRequestIR.base(
          "创作判断器\n## 待采纳候选\n- ref=as_original | type=world_setting | status=TENTATIVE | title=沈砚旧书铺设定 | operations=revise_pending_artifact | body_preview=沈砚经营旧书铺。"
        ),
        TestRequestIR.author(expression)
      ])

    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})
    assert [%{name: "judgment_decision"} = call] = result.tool_calls
    arguments = call[:arguments] || call["arguments"]
    assert (arguments[:capability] || arguments["capability"]) == "revise_pending_artifact"

    assert (arguments[:pending_artifact_ref] || arguments["pending_artifact_ref"]) ==
             "as_original"
  end

  test "B73 负控回复文本只来自 fixture，不复用 oracle 预期", %{corpus: corpus} do
    expression = "现在写到第几章了？第02章大概多少字？"

    File.write!(
      corpus,
      Jason.encode!(%{
        "fixtures" => [
          %{
            "case_id" => "C-F1-001",
            "expression" => expression,
            "action" => "reply",
            "reply_text" => "当前已写 99 章。",
            "note" => "negative stimulus"
          }
        ]
      })
    )

    prompt =
      TestRequestIR.ir([
        TestRequestIR.base("创作判断器"),
        TestRequestIR.author(expression)
      ])

    assert {:ok, result} = SliceVerify.complete(%SliceVerify{}, nil, prompt, %InferenceParams{})
    assert result.content == "当前已写 99 章。"
    assert result.tool_calls == []
  end
end
