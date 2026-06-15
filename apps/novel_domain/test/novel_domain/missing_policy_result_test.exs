defmodule NovelDomain.MissingPolicyResultTest do
  use ExUnit.Case, async: true

  alias NovelDomain.MissingPolicyResult
  alias NovelDomain.WritingCoordinate

  # requested = 作者点名原文；matched = planner 匹配到列表的章（空=没匹配上）。
  defp coord(mode, requested, matched) do
    %WritingCoordinate{
      authoring_mode: mode,
      requested_chapter: requested,
      matched_chapter: matched
    }
  end

  describe "evaluate/1 hard missing → :block" do
    test "重写：作者点名但 planner 未匹配（matched 空）→ :block" do
      result = MissingPolicyResult.evaluate(coord(:rewrite, "第99章", ""))
      assert result.severity == :block
      assert [%{what: :target_chapter, reason: :not_found, ref: "第99章"}] = result.missing
      assert MissingPolicyResult.block?(result)
    end

    test "续写：作者点名但未匹配 → :block" do
      assert %{severity: :block} = MissingPolicyResult.evaluate(coord(:continuation, "番外篇", ""))
    end
  end

  describe "evaluate/1 → :ok" do
    test "点名且 planner 匹配到列表（matched 非空）→ :ok" do
      assert %{severity: :ok} =
               MissingPolicyResult.evaluate(coord(:rewrite, "第一章", "第01章：底层灵气账单"))
    end

    test "未点名具体章（接着往下写，requested 空）→ :ok" do
      assert %{severity: :ok} = MissingPolicyResult.evaluate(coord(:continuation, "", ""))
    end

    test "首稿/规划模式不评估章缺失 → :ok" do
      assert %{severity: :ok} = MissingPolicyResult.evaluate(coord(:first_draft, "新章", ""))
      assert %{severity: :ok} = MissingPolicyResult.evaluate(coord(:planning, "", ""))
    end
  end

  test "ok/0 与 block?/1" do
    assert MissingPolicyResult.ok().severity == :ok
    refute MissingPolicyResult.block?(MissingPolicyResult.ok())
  end
end
