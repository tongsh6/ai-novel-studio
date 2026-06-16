defmodule NovelDomain.AssemblyPolicyTest do
  use ExUnit.Case, async: true

  alias NovelDomain.AssemblyPolicy

  test "default 是地板档（2000/15），与历史 excerpt 裁剪上限一致" do
    p = AssemblyPolicy.default()
    assert p.excerpt_budget_chars == 2000
    assert p.summary_window == 15
    assert p.policy_id == "prose_writing/floor_v2"
  end

  describe "for_provider/1 按 provider 解析档位" do
    test "本地小窗口 / 确定性替身 → 地板档 2000" do
      for prov <- [:lmstudio, :stub, :slice_verify, "slice_verify"] do
        assert AssemblyPolicy.for_provider(prov).excerpt_budget_chars == 2000
      end
    end

    test "云端大窗口 → large 档（excerpt 放开、CP2 摘要窗口保持 15）" do
      large = AssemblyPolicy.for_provider(:anthropic)
      assert large.excerpt_budget_chars == 200_000
      assert large.summary_window == 15
      assert large.policy_id == "prose_writing/large_v2"
      assert AssemblyPolicy.for_provider("deepseek").excerpt_budget_chars == 200_000
    end

    test "CP2 L3a 摘要窗口在所有档位统一为 15" do
      for tier <- [:floor, :standard, :large] do
        assert AssemblyPolicy.for_tier(tier).summary_window == 15
      end
    end

    test "未知 / nil provider → 安全回落地板档" do
      assert AssemblyPolicy.for_provider("bogus_provider_xyz").excerpt_budget_chars == 2000
      assert AssemblyPolicy.for_provider(nil).excerpt_budget_chars == 2000
    end

    test "切换 provider 改变 policy_id（VS00C-I7 的可观测投影）" do
      refute AssemblyPolicy.for_provider(:lmstudio).policy_id ==
               AssemblyPolicy.for_provider(:anthropic).policy_id
    end
  end
end
