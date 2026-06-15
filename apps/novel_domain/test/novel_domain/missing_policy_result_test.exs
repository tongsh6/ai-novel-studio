defmodule NovelDomain.MissingPolicyResultTest do
  use ExUnit.Case, async: true

  alias NovelDomain.MissingPolicyResult
  alias NovelDomain.WritingCoordinate

  defp coord(mode, requested) do
    %WritingCoordinate{authoring_mode: mode, requested_chapter: requested}
  end

  describe "evaluate/2 hard missing → :block" do
    test "重写显式命名的不存在章 → :block" do
      result = MissingPolicyResult.evaluate(coord(:rewrite, "第99章"), ["第一章", "第二章"])
      assert result.severity == :block
      assert [%{what: :target_chapter, reason: :not_found, ref: "第99章"}] = result.missing
      assert MissingPolicyResult.block?(result)
    end

    test "续写显式命名的不存在章 → :block" do
      assert %{severity: :block} =
               MissingPolicyResult.evaluate(coord(:continuation, "番外篇"), ["第一章"])
    end
  end

  describe "evaluate/2 → :ok" do
    test "命名的章存在 → :ok" do
      assert %{severity: :ok} =
               MissingPolicyResult.evaluate(coord(:rewrite, "第一章"), ["第一章", "第二章"])
    end

    test "续写未命名目标章（接着往下写）→ :ok（不阻断，回退最新章是期望行为）" do
      assert %{severity: :ok} = MissingPolicyResult.evaluate(coord(:continuation, ""), ["第一章"])
    end

    test "首稿/规划模式不评估章缺失 → :ok" do
      assert %{severity: :ok} = MissingPolicyResult.evaluate(coord(:first_draft, "新章"), [])
      assert %{severity: :ok} = MissingPolicyResult.evaluate(coord(:planning, ""), [])
    end

    test "非列表 available_chapters（无 context）→ :ok（不评估）" do
      assert %{severity: :ok} = MissingPolicyResult.evaluate(coord(:rewrite, "第99章"), nil)
    end
  end

  test "ok/0 与 block?/1" do
    assert MissingPolicyResult.ok().severity == :ok
    refute MissingPolicyResult.block?(MissingPolicyResult.ok())
  end
end
