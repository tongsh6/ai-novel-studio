defmodule NovelApplication.LedgerMaintenanceTest do
  @moduledoc """
  弧光账增量维护单测（VS-00F CP1 / ADR-0026 hook.UPDATE_LEDGERS）。
  端口全 fake，验证确定性提炼（I-L4）、出场记账、停滞翻转与失败容忍。
  """
  use ExUnit.Case, async: true

  alias NovelApplication.LedgerMaintenance
  alias NovelDomain.ChapterSummary

  defp roster do
    [
      %{id: "char-ly", name: "凌渊", aliases: []},
      %{id: "char-lh", name: "林浩", aliases: ["浩子"]},
      %{id: "char-sy", name: "沈逸", aliases: []}
    ]
  end

  defp chapter_index do
    Map.new(1..12, fn seq ->
      {"ch-#{seq}", %{seq: seq, title: "第#{String.pad_leading(to_string(seq), 2, "0")}章"}}
    end)
  end

  defp fake_repo(agent) do
    %{
      list: fn _work_id -> Agent.get(agent, & &1) |> Map.values() end,
      upsert: fn attrs ->
        stored = Map.put(attrs, :adoption_status, "ACCEPTED")
        Agent.update(agent, &Map.put(&1, attrs.subject_ref, stored))
        {:ok, stored}
      end
    }
  end

  defp deps(agent) do
    %{
      roster: fn _work_id -> roster() end,
      chapter_index: fn _work_id -> chapter_index() end,
      repo: fake_repo(agent)
    }
  end

  defp summary_with_characters(text) do
    ChapterSummary.render_sections(%{plot: "推进主线。", characters: text})
  end

  test "出场记账：摘要人物栏命中的角色（含别名）入账，未命中不入账，出处非空（I-L1）" do
    {:ok, agent} = Agent.start_link(fn -> %{} end)

    assert {:ok, %{sighted: 2}} =
             LedgerMaintenance.run(
               %{
                 work_id: "work-1",
                 chapter_id: "ch-3",
                 summary_text: summary_with_characters("凌渊与浩子在黑市碰头，各怀心事。")
               },
               deps(agent)
             )

    entries = Agent.get(agent, & &1)
    assert Map.has_key?(entries, "char-ly")
    assert Map.has_key?(entries, "char-lh")
    refute Map.has_key?(entries, "char-sy")
    assert entries["char-ly"].payload["last_seen_seq"] == 3
    assert entries["char-ly"].source_refs != []
  end

  test "停滞翻转：最近出场落后当前最大章超阈值的条目转 STALLED（M2 凌渊靶形态）" do
    {:ok, agent} = Agent.start_link(fn -> %{} end)

    # 第 3 章凌渊出场
    {:ok, _} =
      LedgerMaintenance.run(
        %{work_id: "w", chapter_id: "ch-3", summary_text: summary_with_characters("凌渊出场。")},
        deps(agent)
      )

    # 第 12 章只有林浩出场；12 - 3 = 9 > 8 → 凌渊 STALLED
    assert {:ok, %{stalled: 1}} =
             LedgerMaintenance.run(
               %{work_id: "w", chapter_id: "ch-12", summary_text: summary_with_characters("林浩独自行动。")},
               deps(agent)
             )

    entries = Agent.get(agent, & &1)
    assert entries["char-ly"].status == "STALLED"
    assert entries["char-lh"].status == "ON_TRACK"
  end

  test "缺人物栏降级情节栏提炼；整段无栏降级全文" do
    {:ok, agent} = Agent.start_link(fn -> %{} end)

    plot_only = ChapterSummary.render_sections(%{plot: "沈逸接管了议会主导权。"})

    assert {:ok, %{sighted: 1}} =
             LedgerMaintenance.run(
               %{work_id: "w", chapter_id: "ch-5", summary_text: plot_only},
               deps(agent)
             )

    assert Map.has_key?(Agent.get(agent, & &1), "char-sy")
  end

  test "失败容忍：空摘要/章不在索引降级为 degraded，不抛错" do
    {:ok, agent} = Agent.start_link(fn -> %{} end)

    assert {:degraded, _} =
             LedgerMaintenance.run(%{work_id: "w", chapter_id: "ch-1", summary_text: ""}, deps(agent))

    assert {:degraded, _} =
             LedgerMaintenance.run(
               %{work_id: "w", chapter_id: "ch-404", summary_text: summary_with_characters("凌渊。")},
               deps(agent)
             )

    raising = %{
      roster: fn _ -> raise "boom" end,
      chapter_index: fn _ -> chapter_index() end,
      repo: fake_repo(agent)
    }

    assert {:degraded, _} =
             LedgerMaintenance.run(
               %{work_id: "w", chapter_id: "ch-1", summary_text: summary_with_characters("凌渊。")},
               raising
             )
  end
end
