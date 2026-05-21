defmodule NovelAgent.Provider.GatewayTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Gateway

  setup do
    old_extra = Application.get_env(:novel_agent, :extra_providers)

    Application.put_env(:novel_agent, :extra_providers,
      slice_verify: NovelAgent.Test.Provider.SliceVerify
    )

    on_exit(fn ->
      if old_extra do
        Application.put_env(:novel_agent, :extra_providers, old_extra)
      else
        Application.delete_env(:novel_agent, :extra_providers)
      end
    end)
  end

  describe "registered_providers/0" do
    test "returns known providers" do
      providers = Gateway.registered_providers()
      assert :stub in providers
      assert :slice_verify in providers
      assert :lmstudio in providers
      assert :anthropic in providers
    end
  end

  describe "provider_metadata/0" do
    test "returns adapter model from current provider configuration" do
      old_provider = Application.get_env(:novel_agent, :provider)
      old_lmstudio = Application.get_env(:novel_agent, NovelAgent.Provider.LMStudio)

      Application.put_env(:novel_agent, :provider, default: :lmstudio)

      Application.put_env(:novel_agent, NovelAgent.Provider.LMStudio,
        endpoint: "http://127.0.0.1:1234/v1",
        model: "local-test-model"
      )

      try do
        assert Gateway.provider_metadata() == %{provider: :lmstudio, model: "local-test-model"}
      after
        Application.put_env(:novel_agent, :provider, old_provider)
        Application.put_env(:novel_agent, NovelAgent.Provider.LMStudio, old_lmstudio)
      end
    end

    test "does not invent a model for providers without model configuration" do
      old_provider = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :stub)

      try do
        assert Gateway.provider_metadata() == %{provider: :stub, model: nil}
      after
        Application.put_env(:novel_agent, :provider, old_provider)
      end
    end
  end

  describe "complete/2 with test env (stub default)" do
    test "returns echo content from stub" do
      assert {:ok, %{content: content}} = Gateway.complete("hello novel")
      assert content =~ "[stub]"
      assert content =~ "hello novel"
    end

    test "works with empty prompt" do
      assert {:ok, %{content: content}} = Gateway.complete("")
      assert content =~ "[stub]"
    end

    test "completes without error" do
      assert {:ok, _} = Gateway.complete("should use stub in test env")
    end
  end

  describe "complete/2 with slice verify provider" do
    test "returns planner-compatible frame JSON" do
      old = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :slice_verify)

      try do
        assert {:ok, %{content: content}} = Gateway.complete("分析用户消息并返回 JSON")
        assert {:ok, parsed} = Jason.decode(content)
        assert parsed["frame_type"] == "casual_reply"
        assert is_binary(parsed["assistant_message"])
      after
        Application.put_env(:novel_agent, :provider, old)
      end
    end

    test "classifies ordinary chat from author input instead of prompt instructions" do
      old = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :slice_verify)

      prompt = """
      你是一个小说创作 AI。分析用户消息并返回 JSON。

      ## 输出格式（严格 JSON）
      {"candidate_directions": [{"title": "方向标题"}]}

      ## 规则
      - frame_type == "creative_exploration" 时，candidate_directions 必须包含 2-3 个方向对象

      用户消息：你好，先介绍一下你能如何协助我
      """

      try do
        assert {:ok, %{content: content}} = Gateway.complete(prompt)
        assert {:ok, parsed} = Jason.decode(content)
        assert parsed["frame_type"] == "casual_reply"
        assert parsed["candidate_directions"] == []
      after
        Application.put_env(:novel_agent, :provider, old)
      end
    end

    test "keeps exploration candidates when the author asks for directions" do
      old = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :slice_verify)

      prompt = """
      你是一个小说创作 AI。分析用户消息并返回 JSON。

      ## 输出格式（严格 JSON）
      {"candidate_directions": [{"title": "方向标题"}]}

      ## 规则
      - frame_type == "creative_exploration" 时，candidate_directions 必须包含 2-3 个方向对象

      用户消息：我想找一个赛博修仙方向
      """

      try do
        assert {:ok, %{content: content}} = Gateway.complete(prompt)
        assert {:ok, parsed} = Jason.decode(content)
        assert parsed["frame_type"] == "creative_exploration"
        assert length(parsed["candidate_directions"]) == 2
      after
        Application.put_env(:novel_agent, :provider, old)
      end
    end

    test "classifies chat messages from the latest user message" do
      old = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :slice_verify)

      messages = [
        %{role: "system", content: "candidate_directions 必须包含 2-3 个方向对象"},
        %{role: "user", content: "上一轮想找一个赛博修仙方向"},
        %{role: "assistant", content: "可以先给几个方向。"},
        %{role: "user", content: "你好，先介绍一下你能如何协助我"}
      ]

      try do
        assert {:ok, %{content: content}} = Gateway.complete(messages)
        assert {:ok, parsed} = Jason.decode(content)
        assert parsed["frame_type"] == "casual_reply"
        assert parsed["candidate_directions"] == []
      after
        Application.put_env(:novel_agent, :provider, old)
      end
    end

    test "returns author-facing text for tool narration prompts" do
      old = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :slice_verify)

      prompt = """
      ## 工具执行结果
      - 工具: character_design
      - 状态: succeeded

      ## 要求
      请用 1-2 句自然中文告诉作者你完成了什么。
      """

      try do
        assert {:ok, %{content: content}} = Gateway.complete(prompt)
        assert content =~ "已生成角色设定草案"
        refute content =~ "\"frame_type\""
        refute content =~ "\"candidate_directions\""
      after
        Application.put_env(:novel_agent, :provider, old)
      end
    end
  end

  describe "complete error handling" do
    test "returns error map for unknown providers" do
      # Temporarily override provider config to trigger unknown provider path.
      # Restore after test to not affect other tests.
      old = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :nonexistent)

      result = Gateway.complete("test")
      assert {:error, error} = result
      assert is_map(error)
      assert error.type == :provider_internal

      Application.put_env(:novel_agent, :provider, old)
    end
  end
end
