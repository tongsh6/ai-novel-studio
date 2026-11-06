defmodule NovelAgent.ProviderTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider
  alias NovelCommon.RequestIR
  alias NovelAgent.TestProviderPrompt

  defp operation_ir(messages) do
    RequestIR.new(%{
      run: %{run_id: "provider-test"},
      system: RequestIR.system_envelope(),
      messages: messages
    })
  end

  test "专业操作视图保留首 Base 与原话；首阶段纠错不能误当角色切换" do
    messages = [
      RequestIR.message(:application_base, :application, [RequestIR.text_block("首阶段完整规则")]),
      RequestIR.message(:user, :author, [RequestIR.text_block("作者原话 保留空白。")]),
      RequestIR.message(:scope_update, :application, [RequestIR.text_block("当前材料")])
    ]

    ir = operation_ir(messages)
    first = TestProviderPrompt.operation_text(ir)
    assert first =~ "首阶段完整规则"
    assert first =~ "作者原话 保留空白。"
    assert first =~ "当前材料"

    retry = %{
      ir
      | messages:
          messages ++
            [RequestIR.message(:assistant, :model, [RequestIR.text_block("本阶段格式错误响应")])]
    }

    assert TestProviderPrompt.operation_text(retry) == first
  end

  test "真正续阶段只消费当前 scope，无 scope legacy 保持全文" do
    current = "新角色完整规则与当前材料"

    messages = [
      RequestIR.message(:application_base, :application, [RequestIR.text_block("旧角色规则")]),
      RequestIR.message(:scope_update, :application, [RequestIR.text_block("旧材料")]),
      RequestIR.message(:assistant, :model, [RequestIR.text_block("旧角色响应")]),
      RequestIR.message(:scope_update, :application, [RequestIR.text_block(current)])
    ]

    assert TestProviderPrompt.operation_text(operation_ir(messages)) == current
    assert TestProviderPrompt.operation_text("单次 legacy 内容") == "单次 legacy 内容"
  end

  describe "degenerate_content?/1" do
    test "flags single-character repeated content past the length floor" do
      assert Provider.degenerate_content?(String.duplicate("@", 1999))
    end

    test "flags short-cycle repetition (e.g. two alternating characters)" do
      assert Provider.degenerate_content?(String.duplicate("AB", 200))
    end

    test "合法结构化长计划不因字段重复或输出长度被误判" do
      changes =
        for n <- 1..90,
            do: %{boundary_id: "break_#{n}_#{Integer.to_string(n * 7919, 16)}", lines: 2}

      plan =
        Jason.encode!(%{
          items: [
            %{
              item_id: "plan",
              title: "分段",
              body: "按阅读节奏分段。",
              rationale: "保留原字句。",
              line_break_changes: changes
            }
          ]
        })

      assert MapSet.size(MapSet.new(String.graphemes(plan))) / String.length(plan) < 0.05
      refute Provider.degenerate_content?(plan)
    end

    test "正常开头不能掩盖后续单字符退化" do
      assert Provider.degenerate_content?("开头提供真实信息，并说明后面将给出内容。" <> String.duplicate("@", 1000))
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
