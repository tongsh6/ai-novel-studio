defmodule NovelCommon.AuthorVisible.TextTest do
  use ExUnit.Case, async: true

  alias NovelCommon.AuthorVisible.Text
  import ExUnit.CaptureLog, warn: false

  describe "redact_internal_refs/1（作者可见投影）" do
    test "把 chapter/mem/call/run/prun/ctx 内部标识替换为作者可读占位" do
      text =
        "定位到第1章（chapter:5d6d6360-413c-447b-b056-8972a57f6080）；" <>
          "相关记忆 mem:0aac6af8-3aa0-4a4e-9d4e-8a2b0f1c9d7e；" <>
          "操作 call_567c4a34259e4fe9b79c942f；任务 run_mwauzp8f_5；" <>
          "模型调用 prun_mwauo832_9；上下文 ctx_1"

      redacted = Text.redact_internal_refs(text)

      refute Text.contains_internal_ref?(redacted)
      assert redacted =~ "（指定章节）"
      assert redacted =~ "（相关记忆中）"
      assert redacted =~ "（操作记录）"
      assert redacted =~ "（任务记录）"
      assert redacted =~ "（模型调用记录）"
      assert redacted =~ "（上下文引用）"
    end

    test "普通作者文本与相似但不匹配的文本保持不变" do
      assert Text.redact_internal_refs("第 1 章结尾要保留悬念。") == "第 1 章结尾要保留悬念。"
      assert Text.redact_internal_refs("chapter 1 与 chapter 2 相同") == "chapter 1 与 chapter 2 相同"
    end

    test "非二进制原样返回（不猜测）" do
      assert Text.redact_internal_refs(nil) == nil
      assert Text.redact_internal_refs(%{a: 1}) == %{a: 1}
    end
  end

  describe "new/1 的投影契约" do
    test "构造作者可见文本时自动投影内部标识" do
      text = Text.new("已检索章节「chapter:5d6d6360-413c-447b-b056-8972a57f6080」。")
      assert Text.text(text) =~ "（指定章节）"
      refute Text.contains_internal_ref?(Text.text(text))
    end

    test "经 from_display/join 构造的文本同样被投影" do
      joined = Text.join([Text.new("第一段 call_567c4a34259e4fe9b79c942f"), "第二段"])
      refute Text.contains_internal_ref?(Text.text(joined))
      assert Text.text(joined) =~ "第一段 （操作记录）、第二段"
    end
  end
end
