defmodule NovelDomain.EvidenceUsageTest do
  use ExUnit.Case, async: true

  alias NovelDomain.EvidenceUsage

  test "自报 ref 全部落在 Base∪实际观察内 → ok 且保留 used" do
    usage =
      EvidenceUsage.validate(
        ["chapter:abc", "observation:obs_1", "turn:t1"],
        ["turn:t1", "execution_brief:第01章"],
        ["observation:obs_1", "chapter:abc"]
      )

    assert usage.status == :ok
    assert usage.used_context_refs == ["chapter:abc", "observation:obs_1", "turn:t1"]
    assert usage.unbound_context_refs == []
    assert "chapter:abc" in usage.observation_refs
  end

  test "越界 ref 记 unbound 且不授予信用（artifact 字节不经本模块修改）" do
    usage = EvidenceUsage.validate(["chapter:invented", "turn:t1"], ["turn:t1"], [])

    assert usage.status == :partial
    assert usage.used_context_refs == ["turn:t1"]
    assert usage.unbound_context_refs == ["chapter:invented"]
  end

  test "无自报 → no_claim；无可见证据 → unknown；全部越界 → all_unbound" do
    assert EvidenceUsage.validate([], ["turn:t1"], []).status == :no_claim
    assert EvidenceUsage.validate(["chapter:x"], [], []).status == :unknown
    assert EvidenceUsage.validate(["chapter:invented"], ["turn:t1"], []).status == :all_unbound
  end

  test "ref 归一化：去空/去重且不发明内容" do
    usage = EvidenceUsage.validate([" turn:t1 ", "", "turn:t1", nil], ["turn:t1"], [])

    assert usage.status == :ok
    assert usage.used_context_refs == ["turn:t1"]
  end
end
