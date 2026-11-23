defmodule NovelApplication.ChapterSummaryMaintenanceTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.ChapterSummaryGenerator
  alias NovelApplication.ChapterSummaryMaintenance
  alias NovelCommon.RequestIR
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

  describe "R08 真实四栏生成器的维护边界" do
    @describetag :r08_chapter_summary_text_contract

    test "完整四栏通过真实 Generator 后才替换旧 ACCEPTED 摘要", %{agent: agent, repo: repo} do
      old = seed_accepted_summary(agent)

      output = """
      【情节推进】新采纳片段只记载守灯核账。
      【人物状态与弧光】陈九斤尚未离开灯楼。
      【伏笔动作】（无）
      【情绪基调】安静。
      """

      input = %{
        work_id: "w",
        chapter_id: "c",
        prose_text: "陈九斤拨亮灯芯，继续核对第七页。",
        source_ref: "turn-new",
        revision_base: "draft:new:2",
        material_scope: :fragment
      }

      assert {:ok, %ChapterSummary{status: "ACCEPTED"} = summary} =
               ChapterSummaryMaintenance.run(
                 input,
                 real_summary_generator(self(), output),
                 observe_summary_repo(repo, self())
               )

      expected_text =
        "【情节推进】新采纳片段只记载守灯核账。\n" <>
          "【人物状态与弧光】陈九斤尚未离开灯楼。\n" <>
          "【伏笔动作】（无）\n" <>
          "【情绪基调】安静。"

      assert summary.summary_text == expected_text
      assert_received {:summary_request, %RequestIR{}}
      assert_received {:summary_generator_input, %{task: %{kind: :chapter_summary}}}

      calls =
        for _ <- 1..3 do
          assert_received {:summary_repo_call, operation}
          operation
        end

      assert calls == [:supersede, :insert, :update_status]
      refute_received {:summary_repo_call, _}

      assert rows(agent) == [
               %{old | status: "SUPERSEDED"},
               %{
                 id: "cs-2",
                 work_id: "w",
                 chapter_id: "c",
                 status: "ACCEPTED",
                 summary_text: expected_text,
                 source_ref: "turn-new",
                 revision_base: "draft:new:2"
               }
             ]
    end

    for {label, output} <- [
          {"JSON 外壳夹带四标签",
           """
           {
             "plot": "【情节推进】坏格式的新摘要不得替换旧稿。",
             "characters": "【人物状态与弧光】新状态尚未通过接收。",
             "foreshadowing": "【伏笔动作】这条新线索不得进入正式摘要。",
             "mood": "【情绪基调】污染文本不得作为正式情绪来源。"
           }
           """},
          {"缺少情绪栏",
           """
           【情节推进】坏格式的新摘要不得替换旧稿。
           【人物状态与弧光】新状态尚未通过接收。
           【伏笔动作】这条新线索不得进入正式摘要。
           """}
        ] do
      test "#{label}经真实 Generator 降级，旧 ACCEPTED 原件与全部仓储状态保持",
           %{agent: agent, repo: repo} do
        old = seed_accepted_summary(agent)
        before = Agent.get(agent, & &1)

        input = %{
          work_id: "w",
          chapter_id: "c",
          prose_text: "陈九斤拨亮灯芯，继续核对第七页。",
          source_ref: "turn-new",
          revision_base: "draft:new:2",
          material_scope: :fragment
        }

        assert {:degraded, :summary_sections_unparseable} =
                 ChapterSummaryMaintenance.run(
                   input,
                   real_summary_generator(self(), unquote(output)),
                   observe_summary_repo(repo, self())
                 )

        assert_received {:summary_request, %RequestIR{}}
        assert_received {:summary_generator_input, generated_input}
        assert generated_input.task.kind == :chapter_summary
        assert generated_input.prose_text == input.prose_text
        assert generated_input.source_ref == "turn-new"
        assert Agent.get(agent, & &1) == before
        assert accepted_rows(agent) == [old]
        refute_received {:summary_repo_call, _}
      end
    end
  end

  defp real_summary_generator(caller, output) do
    fn input ->
      send(caller, {:summary_generator_input, input})

      provider = %Execution{
        result_fn: fn request ->
          send(caller, {:summary_request, request})
          {:ok, %{content: output}}
        end
      }

      ChapterSummaryGenerator.generate(input, provider)
    end
  end

  defp observe_summary_repo(repo, caller) do
    %{
      supersede: fn work_id, chapter_id ->
        send(caller, {:summary_repo_call, :supersede})
        repo.supersede.(work_id, chapter_id)
      end,
      insert: fn attrs ->
        send(caller, {:summary_repo_call, :insert})
        repo.insert.(attrs)
      end,
      update_status: fn row, status ->
        send(caller, {:summary_repo_call, :update_status})
        repo.update_status.(row, status)
      end
    }
  end

  defp seed_accepted_summary(agent) do
    row = %{
      id: "cs-old",
      work_id: "w",
      chapter_id: "c",
      status: "ACCEPTED",
      summary_text:
        "【情节推进】原摘要的事件仍待核实。\n" <>
          "【人物状态与弧光】原人物状态保留。\n" <>
          "【伏笔动作】原线索尚未回收。\n" <>
          "【情绪基调】旧有的克制。",
      source_ref: "turn-old",
      revision_base: "draft:old:1"
    }

    Agent.update(agent, fn state -> %{state | rows: [row], seq: 1} end)
    row
  end

  test "缺章锚点→degraded", %{agent: agent, repo: repo} do
    input = %{work_id: "w", prose_text: "v"}

    assert {:degraded, :missing_chapter_anchor} =
             ChapterSummaryMaintenance.run(input, four_column_generator(), repo)

    assert rows(agent) == []
  end
end
