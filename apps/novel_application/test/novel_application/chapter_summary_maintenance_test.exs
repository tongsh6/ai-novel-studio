defmodule NovelApplication.ChapterSummaryMaintenanceTest do
  use ExUnit.Case, async: true

  alias NovelApplication.ChapterSummaryMaintenance
  alias NovelDomain.ChapterSummary

  # 内存仓储替身：可断言 supersede→insert→update_status 的真实副作用与顺序。
  setup do
    {:ok, agent} = Agent.start_link(fn -> %{rows: [], seq: 0} end)

    repo = %{
      supersede: fn work_id, chapter_id ->
        count =
          Agent.get_and_update(agent, fn st ->
            {rows, hit} =
              Enum.map_reduce(st.rows, 0, fn row, acc ->
                if row.work_id == work_id and row.chapter_id == chapter_id and
                     row.status == "ACCEPTED" do
                  {%{row | status: "SUPERSEDED"}, acc + 1}
                else
                  {row, acc}
                end
              end)

            {hit, %{st | rows: rows}}
          end)

        {:ok, count}
      end,
      insert: fn attrs ->
        row =
          Agent.get_and_update(agent, fn st ->
            row = Map.put(attrs, :id, "cs-#{st.seq + 1}")
            {row, %{st | rows: st.rows ++ [row], seq: st.seq + 1}}
          end)

        {:ok, row}
      end,
      update_status: fn row, status ->
        updated = %{row | status: status}

        Agent.update(agent, fn st ->
          rows = Enum.map(st.rows, fn r -> if r.id == row.id, do: updated, else: r end)
          %{st | rows: rows}
        end)

        {:ok, updated}
      end
    }

    %{agent: agent, repo: repo}
  end

  defp rows(agent), do: Agent.get(agent, & &1.rows)
  defp accepted_rows(agent), do: Enum.filter(rows(agent), &(&1.status == "ACCEPTED"))

  defp four_column_generator do
    fn _input ->
      {:ok,
       %{
         plot: "情节推进",
         characters: "人物变化",
         foreshadowing: "伏笔回收",
         mood: "压抑收束"
       }}
    end
  end

  test "正文采纳后产 ACCEPTED 四栏摘要", %{agent: agent, repo: repo} do
    input = %{work_id: "w", chapter_id: "c", prose_text: "本章正文", source_ref: "turn-1"}

    assert {:ok, %ChapterSummary{status: "ACCEPTED"} = summary} =
             ChapterSummaryMaintenance.run(input, four_column_generator(), repo)

    assert ChapterSummary.four_column?(summary.summary_text)

    assert [row] = accepted_rows(agent)
    assert row.status == "ACCEPTED"
    assert row.chapter_id == "c"
    assert row.source_ref == "turn-1"
  end

  test "同章再次采纳→旧 ACCEPTED 置 SUPERSEDED，只剩一条 ACCEPTED", %{agent: agent, repo: repo} do
    input = %{work_id: "w", chapter_id: "c", prose_text: "v"}

    assert {:ok, _} = ChapterSummaryMaintenance.run(input, four_column_generator(), repo)
    assert {:ok, _} = ChapterSummaryMaintenance.run(input, four_column_generator(), repo)

    assert [_only_one] = accepted_rows(agent)
    assert Enum.count(rows(agent), &(&1.status == "SUPERSEDED")) == 1
    assert Enum.count(rows(agent)) == 2
  end

  test "生成器返回整段非四栏文本时仍渲染为四栏", %{repo: repo} do
    generator = fn _ -> {:ok, "一段没有标签的摘要文本"} end
    input = %{work_id: "w", chapter_id: "c", prose_text: "v"}

    assert {:ok, summary} = ChapterSummaryMaintenance.run(input, generator, repo)
    assert ChapterSummary.four_column?(summary.summary_text)
    assert summary.summary_text =~ "一段没有标签的摘要文本"
  end

  test "生成失败→degraded 且不写任何摘要（不阻断采纳）", %{agent: agent, repo: repo} do
    generator = fn _ -> {:error, :provider_down} end
    input = %{work_id: "w", chapter_id: "c", prose_text: "v"}

    assert {:degraded, :provider_down} =
             ChapterSummaryMaintenance.run(input, generator, repo)

    assert rows(agent) == []
  end

  test "生成器抛错→degraded 不向上抛出", %{repo: repo} do
    generator = fn _ -> raise "boom" end
    input = %{work_id: "w", chapter_id: "c", prose_text: "v"}

    assert {:degraded, %RuntimeError{}} =
             ChapterSummaryMaintenance.run(input, generator, repo)
  end

  test "缺章锚点→degraded", %{agent: agent, repo: repo} do
    input = %{work_id: "w", prose_text: "v"}

    assert {:degraded, :missing_chapter_anchor} =
             ChapterSummaryMaintenance.run(input, four_column_generator(), repo)

    assert rows(agent) == []
  end
end
