defmodule NovelDomain.CanonFreshnessTest do
  use ExUnit.Case, async: true

  alias NovelDomain.CanonFreshness

  # B47 CP0/CP1：对象级 canon freshness 纯判定。
  # 输入只接受结构化基线/版本事实；不接受 LLM 文案、候选自报 canon_conflicts 或相似度。

  describe "chapter prose (O1)" do
    test "fresh：候选基线与当前持久 canon 的 draft ref/version 完全一致" do
      declared = chapter_declared(%{"draft:a" => 5}, nil)
      current = chapter_current(%{"draft:a" => 5})

      verdict = CanonFreshness.assess(:chapter_prose, declared, current)

      assert verdict.object == :chapter_prose
      assert verdict.status == :fresh
      assert verdict.reason_codes == []
      assert verdict.expected == declared
      assert verdict.current == current
    end

    test "stale：候选基线版本落后于当前持久 canon" do
      declared = chapter_declared(%{"draft:a" => 4}, nil)
      current = chapter_current(%{"draft:a" => 5})

      verdict = CanonFreshness.assess(:chapter_prose, declared, current)

      assert verdict.status == :stale
      assert "stale_base_version" in verdict.reason_codes
      assert "candidate_base_outdated" in verdict.reason_codes
    end

    test "stale：候选覆盖的 draft 已被当前 canon 淘汰/删除" do
      declared = chapter_declared(%{"draft:old" => 2}, nil)
      current = chapter_current(%{"draft:new" => 1})

      verdict = CanonFreshness.assess(:chapter_prose, declared, current)

      assert verdict.status == :stale
      assert "stale_base_version" in verdict.reason_codes
    end

    test "stale：当前章没有任何 accepted 正文（目标 canon 缺失）" do
      declared = chapter_declared(%{"draft:a" => 1}, nil)

      verdict = CanonFreshness.assess(:chapter_prose, declared, chapter_current(%{}))

      assert verdict.status == :stale
      assert "stale_base_version" in verdict.reason_codes
    end

    test "conflict：当前 canon 出现候选未覆盖的 accepted 片段（coverage 前提失效）" do
      declared = chapter_declared(%{"draft:a" => 5}, nil)
      current = chapter_current(%{"draft:a" => 5, "draft:b" => 1})

      verdict = CanonFreshness.assess(:chapter_prose, declared, current)

      assert verdict.status == :conflict
      assert "canon_conflict_detected" in verdict.reason_codes
      assert "incomplete_scope" in verdict.reason_codes
      assert "canon_changed_after_candidate" in verdict.reason_codes
    end

    test "conflict：version 未变但 base 内容 hash 已变（format plan source_hash 失配）" do
      declared = chapter_declared(%{"draft:a" => 5}, "hash-old")
      current = chapter_current(%{"draft:a" => 5}, "hash-new")

      verdict = CanonFreshness.assess(:chapter_prose, declared, current)

      assert verdict.status == :conflict
      assert "canon_conflict_detected" in verdict.reason_codes
      assert "canon_content_changed" in verdict.reason_codes
    end

    test "missing：读端口报告目标章不存在" do
      declared = chapter_declared(%{"draft:a" => 5}, nil)

      verdict = CanonFreshness.missing(:chapter_prose, declared, "target_missing")

      assert verdict.status == :missing
      assert verdict.reason_codes == ["target_missing"]
      assert verdict.expected == declared
      assert verdict.current == nil
    end
  end

  describe "character profile (O2)" do
    test "fresh：fingerprint 与旧值均与当前角色主档案一致" do
      declared = character_declared("fp-1", "ENSEMBLE_POV")
      current = character_current("fp-1", "ENSEMBLE_POV")

      verdict = CanonFreshness.assess(:character_profile, declared, current)

      assert verdict.object == :character_profile
      assert verdict.status == :fresh
      assert verdict.reason_codes == []
    end

    test "stale：fingerprint 变化但被改字段旧值仍是当前值（对象在别处被更新）" do
      declared = character_declared("fp-old", "ENSEMBLE_POV")
      current = character_current("fp-new", "ENSEMBLE_POV")

      verdict = CanonFreshness.assess(:character_profile, declared, current)

      assert verdict.status == :stale
      assert "stale_base" in verdict.reason_codes
      assert "candidate_base_outdated" in verdict.reason_codes
    end

    test "conflict：当前持久 narrative_role 与候选 old 值矛盾（canon A vs 候选 B）" do
      declared = character_declared("fp-old", "ENSEMBLE_POV")
      current = character_current("fp-new", "ANTAGONIST")

      verdict = CanonFreshness.assess(:character_profile, declared, current)

      assert verdict.status == :conflict
      assert "canon_conflict_detected" in verdict.reason_codes
      assert "persisted_canon_differs" in verdict.reason_codes
      refute verdict.status == :fresh
    end

    test "missing：目标角色已不存在" do
      declared = character_declared("fp-1", "ENSEMBLE_POV")

      verdict = CanonFreshness.assess(:character_profile, declared, nil)

      assert verdict.status == :missing
      assert verdict.reason_codes == ["target_missing"]
    end
  end

  test "不支持的对象类型返回可解释错误，不猜测" do
    assert {:error, :unsupported_canon_object} =
             CanonFreshness.assess(:memory_item, %{ref: "memory:1"}, %{ref: "memory:1"})
  end

  defp chapter_declared(versions, digest) do
    %{ref: "chapter:11111111-1111-1111-1111-111111111111", versions: versions, digest: digest}
  end

  defp chapter_current(versions, digest \\ "hash-current") do
    %{
      ref: "chapter:11111111-1111-1111-1111-111111111111",
      versions: versions,
      digest: digest
    }
  end

  defp character_declared(fingerprint, old_value) do
    %{
      ref: "character:22222222-2222-2222-2222-222222222222",
      fingerprint: fingerprint,
      field: "narrative_role",
      old_value: old_value,
      new_value: "PROTAGONIST"
    }
  end

  defp character_current(fingerprint, value) do
    %{
      ref: "character:22222222-2222-2222-2222-222222222222",
      fingerprint: fingerprint,
      value: value
    }
  end
end
