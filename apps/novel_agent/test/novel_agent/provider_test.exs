defmodule NovelAgent.ProviderTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider

  # 缺陷十（2026-07-20）：现场实测 gpt-oss-120b 在 purpose: :writer 真实调用中
  # 采样退化——HTTP 200 正常返回，content 却是单字符刷满 1999 次。这不是任何
  # max_tokens 上限能挡住的失控生成（预算再大也只是刷更多同一字符），是内容
  # 有效性问题，判定与"内容为空"同一优先级、跨 adapter 共享同一实现。
  describe "degenerate_content?/1" do
    test "flags single-character repeated content past the length floor" do
      assert Provider.degenerate_content?(String.duplicate("@", 1999))
    end

    test "flags short-cycle repetition (e.g. two alternating characters)" do
      assert Provider.degenerate_content?(String.duplicate("AB", 200))
    end

    test "does not flag ordinary Chinese prose" do
      prose =
        String.duplicate(
          "林烬按住左肩旧伤，苏晚已抽出银针挡在他身前，黑袍人的动作却比想象中更快。",
          10
        )

      refute Provider.degenerate_content?(prose)
    end

    test "does not flag short content even if repetitive (below length floor)" do
      refute Provider.degenerate_content?("哈哈哈")
    end

    test "does not flag empty or non-binary input" do
      refute Provider.degenerate_content?("")
      refute Provider.degenerate_content?(nil)
    end

    test "does not flag content with natural low-but-sufficient diversity" do
      # 700 字重复 4 次的正文（4 种"扰动"字符各出现一次），unique ratio 明显高于
      # 阈值，不应被误判。
      base = "这是一段包含足够多不同汉字与标点的正文示例，用来验证正常创作内容不会被误判为退化重复。"
      prose = base <> "！" <> base <> "？" <> base <> "。" <> base <> "，"

      refute Provider.degenerate_content?(prose)
    end
  end
end
