defmodule NovelDomain.OmissionNoteTest do
  use ExUnit.Case, async: true

  alias NovelDomain.OmissionNote

  test "new/3 构造省略说明，默认无替代" do
    n = OmissionNote.new("prior_prose:第三章", :budget_limited)
    assert n.source == "prior_prose:第三章"
    assert n.reason == :budget_limited
    assert n.replacement == nil
  end

  test "new/3 可带替代物" do
    n = OmissionNote.new("prior_prose:第三章", :budget_limited, "chapter_summary:第三章")
    assert n.replacement == "chapter_summary:第三章"
  end

  test "非法 reason 拒绝" do
    assert_raise FunctionClauseError, fn -> OmissionNote.new("x", :bogus) end
  end

  describe "author_safe_summary/1" do
    test "预算省略（无替代）" do
      s =
        OmissionNote.new("prior_prose:第三章", :budget_limited) |> OmissionNote.author_safe_summary()

      assert s =~ "超出本轮上下文预算"
      assert s =~ "第三章"
      refute s =~ "替代"
    end

    test "有替代物时点明替代" do
      s =
        OmissionNote.new("prior_prose:第三章", :budget_limited, "chapter_summary:第三章")
        |> OmissionNote.author_safe_summary()

      assert s =~ "以 chapter_summary:第三章 替代"
    end
  end
end
