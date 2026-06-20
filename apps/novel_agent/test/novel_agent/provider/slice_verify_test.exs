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
end
