defmodule NovelDomain.DialogueContextTest do
  use ExUnit.Case, async: true
  alias NovelDomain.DialogueContext

  describe "has_context?/1" do
    test "returns true if any context field is present" do
      assert DialogueContext.has_context?(%DialogueContext{
               current_work_snapshot: %{title: "Test"}
             })

      assert DialogueContext.has_context?(%DialogueContext{conversation_summary: "summary"})
      assert DialogueContext.has_context?(%DialogueContext{memory_summary: "memory"})
    end

    test "returns false if all context fields are nil" do
      refute DialogueContext.has_context?(%DialogueContext{})
    end
  end

  describe "to_prompt_text/1" do
    test "includes work snapshot" do
      ctx = %DialogueContext{current_work_snapshot: %{title: "Cyberpunk", genre: "Sci-Fi"}}
      text = DialogueContext.to_prompt_text(ctx)
      assert text =~ "## 当前作品上下文"
      assert text =~ "- title: Cyberpunk"
      assert text =~ "- genre: Sci-Fi"
    end

    test "includes conversation summary" do
      ctx = %DialogueContext{conversation_summary: "User wants more tech."}
      text = DialogueContext.to_prompt_text(ctx)
      assert text =~ "## 最近对话"
      assert text =~ "User wants more tech."
    end

    test "includes memory summary" do
      ctx = %DialogueContext{memory_summary: "User prefers dark tone."}
      text = DialogueContext.to_prompt_text(ctx)
      assert text =~ "## 相关记忆"
      assert text =~ "User prefers dark tone."
    end

    test "shows empty work message when no snapshot" do
      ctx = %DialogueContext{current_work_snapshot: nil}
      text = DialogueContext.to_prompt_text(ctx)
      assert text =~ "（无——这是新对话或尚未创建作品）"
    end
  end
end
