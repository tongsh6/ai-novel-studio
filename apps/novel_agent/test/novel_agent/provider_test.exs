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

  # M2 长跑实测（2026-07-20）：正文起草 10/12 次 JSON 解析失败因模型把多段正文塞进
  # JSON 字符串值时漏转义段落换行（裸 0x0A 字节）。creative_provider/real.ex 与
  # prose_quality_evaluator.ex 共享本函数收口，不必为此多烧一次重试 LLM 调用。
  describe "repair_unescaped_control_chars/1" do
    test "escapes a raw newline inside a JSON string value, making it parseable" do
      raw = ~s({"body":"第一段。\n第二段带裸换行。"})
      assert {:error, %Jason.DecodeError{}} = Jason.decode(raw)

      repaired = Provider.repair_unescaped_control_chars(raw)
      assert {:ok, %{"body" => body}} = Jason.decode(repaired)
      assert body == "第一段。\n第二段带裸换行。"
    end

    test "escapes raw carriage return and tab inside strings" do
      raw = "{\"a\":\"x\ry\tz\"}"
      repaired = Provider.repair_unescaped_control_chars(raw)
      assert {:ok, %{"a" => "x\ry\tz"}} = Jason.decode(repaired)
    end

    test "escapes multiple raw newlines across multiple string fields" do
      raw = ~s({"title":"多\n行\n标题","body":"多\n段\n正文"})
      repaired = Provider.repair_unescaped_control_chars(raw)
      assert {:ok, %{"title" => "多\n行\n标题", "body" => "多\n段\n正文"}} = Jason.decode(repaired)
    end

    test "is a no-op on already-valid JSON (proper \\n escapes preserved as-is)" do
      valid = ~s({"body":"第一段。\\n第二段。"})
      assert Provider.repair_unescaped_control_chars(valid) == valid
      assert {:ok, %{"body" => "第一段。\n第二段。"}} = Jason.decode(valid)
    end

    test "does not touch structural whitespace between JSON tokens (outside strings)" do
      valid_with_newlines = "{\n  \"a\": 1,\n  \"b\": 2\n}"
      repaired = Provider.repair_unescaped_control_chars(valid_with_newlines)
      assert repaired == valid_with_newlines
      assert {:ok, %{"a" => 1, "b" => 2}} = Jason.decode(repaired)
    end

    test "respects existing escape sequences (escaped backslash before a quote)" do
      # 字符串内 \\" 是"转义反斜杠"接普通引号结束串，不是"转义引号"——状态机不能
      # 把这误判成还在字符串内部。
      raw = ~s({"a":"end with backslash\\\\","b":"next"})
      assert Provider.repair_unescaped_control_chars(raw) == raw
      assert {:ok, %{"a" => "end with backslash\\", "b" => "next"}} = Jason.decode(raw)
    end
  end
end
