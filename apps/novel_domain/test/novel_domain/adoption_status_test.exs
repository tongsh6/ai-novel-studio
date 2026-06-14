defmodule NovelDomain.AdoptionStatusTest do
  use ExUnit.Case, async: true

  alias NovelDomain.AdoptionStatus

  describe "initial/0 与 canon_statuses/0" do
    test "初始态是 TENTATIVE" do
      assert AdoptionStatus.initial() == "TENTATIVE"
    end

    test "当前有效 canon 只含 ACCEPTED / EDITED_ACCEPTED" do
      assert AdoptionStatus.canon_statuses() == ["ACCEPTED", "EDITED_ACCEPTED"]
    end
  end

  describe "transition_allowed?/2 合法转换（ADR-0019）" do
    test "采纳：TENTATIVE → ACCEPTED / EDITED_ACCEPTED / DISCARDED / INVALIDATED" do
      for to <- ["ACCEPTED", "EDITED_ACCEPTED", "DISCARDED", "INVALIDATED"] do
        assert AdoptionStatus.transition_allowed?("TENTATIVE", to)
      end
    end

    test "撤采纳：ACCEPTED / EDITED_ACCEPTED → DISCARDED（用户裁定允许）" do
      assert AdoptionStatus.transition_allowed?("ACCEPTED", "DISCARDED")
      assert AdoptionStatus.transition_allowed?("EDITED_ACCEPTED", "DISCARDED")
    end

    test "ACCEPTED → SUPERSEDED / INVALIDATED / ARCHIVED" do
      for to <- ["SUPERSEDED", "INVALIDATED", "ARCHIVED"] do
        assert AdoptionStatus.transition_allowed?("ACCEPTED", to)
      end
    end

    test "复活：DISCARDED / SUPERSEDED / INVALIDATED / ARCHIVED → TENTATIVE" do
      for from <- ["DISCARDED", "SUPERSEDED", "INVALIDATED", "ARCHIVED"] do
        assert AdoptionStatus.transition_allowed?(from, "TENTATIVE")
      end
    end

    test "自反转换是合法 no-op" do
      for s <- ["TENTATIVE", "ACCEPTED", "ARCHIVED", "SUPERSEDED"] do
        assert AdoptionStatus.transition_allowed?(s, s)
      end
    end
  end

  describe "transition_allowed?/2 非法转换" do
    test "INV-1：进入 canon 只能来自 TENTATIVE，复活不能直达 ACCEPTED" do
      refute AdoptionStatus.transition_allowed?("SUPERSEDED", "ACCEPTED")
      refute AdoptionStatus.transition_allowed?("DISCARDED", "ACCEPTED")
      refute AdoptionStatus.transition_allowed?("INVALIDATED", "EDITED_ACCEPTED")
      refute AdoptionStatus.transition_allowed?("ARCHIVED", "ACCEPTED")
    end

    test "撤采纳不能直达 TENTATIVE（须经 DISCARDED 复活）" do
      refute AdoptionStatus.transition_allowed?("ACCEPTED", "TENTATIVE")
    end

    test "TENTATIVE 不能跳过采纳直达 SUPERSEDED / ARCHIVED" do
      refute AdoptionStatus.transition_allowed?("TENTATIVE", "SUPERSEDED")
      refute AdoptionStatus.transition_allowed?("TENTATIVE", "ARCHIVED")
    end

    test "未知状态返回 false" do
      refute AdoptionStatus.transition_allowed?("BOGUS", "ACCEPTED")
      refute AdoptionStatus.transition_allowed?("ACCEPTED", "BOGUS")
      refute AdoptionStatus.transition_allowed?(nil, "ACCEPTED")
    end
  end
end
