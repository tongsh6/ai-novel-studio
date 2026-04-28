defmodule NovelFoundation.PhaseNextActionCompatTest do
  @moduledoc """
  Data-driven contract test：JSON SSOT 直接驱动断言。
  任何对 `phase_next_action_compat.json` 的修改自动覆盖到这里。
  """

  use ExUnit.Case, async: true

  alias NovelFoundation.PhaseNextActionCompat

  describe "ADR-0002 §7 兼容矩阵 — 直接由 SSOT 驱动" do
    for {key, %{"allowed" => allowed, "forbidden" => forbidden}} <-
          PhaseNextActionCompat.matrix() do
      [kind_str, phase] = String.split(key, ":", parts: 2)
      kind = String.to_atom(kind_str)

      for action <- allowed do
        @kind kind
        @phase phase
        @action action
        test "#{key} allows #{action}" do
          assert PhaseNextActionCompat.allowed?(@kind, @phase, @action) == true
        end
      end

      for action <- forbidden do
        @kind kind
        @phase phase
        @action action
        test "#{key} forbids #{action}" do
          assert PhaseNextActionCompat.allowed?(@kind, @phase, @action) == false
        end
      end
    end
  end

  describe "transient phases (RECEIVED / ROUTED) and unknown" do
    test "未列入矩阵的 phase 返回 :not_constrained" do
      assert PhaseNextActionCompat.allowed?(:turn, "RECEIVED", "ASK_USER") == :not_constrained
      assert PhaseNextActionCompat.allowed?(:turn, "ROUTED", "ASK_USER") == :not_constrained
    end

    test "未知 kind / phase 也返回 :not_constrained（不会崩）" do
      assert PhaseNextActionCompat.allowed?(:turn, "WAT", "ASK_USER") == :not_constrained
    end
  end

  describe "behavior_active rule (§7 rule 3)" do
    test "exposes the canonical allowed set" do
      allowed = PhaseNextActionCompat.allowed_when_behavior_active()
      assert "ASK_USER" in allowed
      assert "CONFIRM_BEFORE_EXECUTE" in allowed
      assert "ADOPT_ARTIFACTS" in allowed
      assert "RESUME_TASK" in allowed
      assert "CANCEL_TASK" in allowed
      refute "SHOW_RESULT" in allowed
      refute "NO_FURTHER_ACTION" in allowed
    end
  end
end
