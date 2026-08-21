defmodule NovelApplication.ChapterMissionServiceTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.ChapterMissionService
  alias NovelDomain.ChapterMission
  alias NovelDomain.ChapterMissionInputs

  defp inputs do
    ChapterMissionInputs.build(%{
      chapter: %{
        seq: 3,
        title: "第03章：巡检收网",
        plan_direction: %{"chapter_role" => "推进章", "plot_progress" => "带证据撤出黑市"}
      },
      entries: [
        %{
          ledger: "information",
          subject_ref: "foreshadow_a",
          subject_label: "伏笔：旧账牌",
          status: "HIDDEN",
          payload: %{"planned_reveal" => %{"kind" => "chapter", "seq" => 2}}
        },
        %{
          ledger: "information",
          subject_ref: "plan_info_5",
          subject_label: "第5章信息",
          status: "HIDDEN",
          payload: %{"fact" => "第五章才揭示", "planned_reveal_seq" => 5}
        }
      ],
      written_progress: %{chapter_seq: 2, volume_seq: 1}
    })
  end

  # 用 event sink 包装让 result_fn 合成 ProviderOutput（与 flow 内 stage sink 路径同形）。
  defp execution(result_fn) do
    Execution.with_event_sink(%Execution{result_fn: result_fn}, fn _ -> :ok end)
  end

  defp tool_call_result(reasoning, arguments, opts \\ []) do
    %{
      content: Keyword.get(opts, :content, reasoning),
      provider_call_id: Keyword.get(opts, :call_id, "pc-mission"),
      tool_calls: [%{"name" => "chapter_mission", "arguments" => arguments}]
    }
  end

  test "一次 tool-call 产使命：依据越界条目被机械丢弃，叙事绑定 content，prompt 只列名材料 ref" do
    parent = self()

    result_fn = fn prompt ->
      send(parent, {:prompt, prompt})

      {:ok,
       tool_call_result("我核对了计划与脉络：旧账牌伏笔已超期，本章先收这条线。", %{
         "author_reasoning" => "我核对了计划与脉络：旧账牌伏笔已超期，本章先收这条线。",
         "statement" => "本章必须回收旧账牌伏笔。",
         "must_advance" => [
           %{"text" => "让旧账牌编号兑现", "basis_ref" => "ledger:information:foreshadow_a"},
           %{"text" => "编造依据", "basis_ref" => "ledger:information:foreshadow_zzz"}
         ],
         "must_avoid" => [
           %{"text" => "不提前揭示第五章信息", "basis_ref" => "ledger:information:plan_info_5"}
         ],
         "confidence" => 0.9
       })}
    end

    assert {:ok, %ChapterMission{} = mission, meta} =
             ChapterMissionService.derive(inputs(), execution(result_fn), author_text: "续写第三章")

    assert_receive {:prompt, prompt}
    assert prompt.tool_choice == "chapter_mission"
    assert [%{name: "chapter_mission"}] = prompt.tools
    [%{content: content}] = prompt.messages
    assert content =~ ChapterMissionService.prompt_anchor()
    assert content =~ "[ledger:information:foreshadow_a]"
    assert content =~ "[plan:3:chapter_role]"
    assert content =~ "作者本轮请求：续写第三章"

    assert mission.statement == "本章必须回收旧账牌伏笔。"

    assert [%{"basis_ref" => "ledger:information:foreshadow_a", "basis_label" => label}] =
             mission.must_advance

    assert label =~ "伏笔：旧账牌"
    assert [%{"basis_ref" => "ledger:information:plan_info_5"}] = mission.must_avoid
    assert [%{"basis_ref" => "ledger:information:foreshadow_zzz"}] = mission.dropped
    assert mission.provider_call_ref == "pc-mission"
    assert String.starts_with?(ChapterMission.ref(mission), "mission:cm_")

    assert meta.provider_call_count == 1
    assert meta.narrative =~ "旧账牌伏笔已超期"
    NovelApplication.TestAssertions.assert_provider_output_narrative_source(meta.narrative_source)
  end

  test "content 为空时叙事回退 tool arguments.author_reasoning（强制 tool_choice 判例）" do
    result_fn = fn _prompt ->
      {:ok,
       tool_call_result(
         "",
         %{
           "author_reasoning" => "本章按计划推进，没有到期压力。",
           "statement" => "按计划推进。",
           "must_advance" => [],
           "must_avoid" => [],
           "confidence" => 0.7
         },
         content: ""
       )}
    end

    assert {:ok, mission, meta} = ChapterMissionService.derive(inputs(), execution(result_fn))
    assert mission.statement == "按计划推进。"
    assert meta.narrative == "本章按计划推进，没有到期压力。"
    assert meta.narrative_source.source_type == "provider_output_tool_narrative"
  end

  test "坏结构携带原因重试一次；第二次仍失败返回 error 且 provider_call_count=2" do
    {:ok, counter} = Agent.start_link(fn -> 0 end)

    result_fn = fn prompt ->
      attempt = Agent.get_and_update(counter, &{&1 + 1, &1 + 1})

      if attempt == 2 do
        [_first | rest] = prompt.messages
        assert Enum.any?(rest, &(&1.content =~ "上一次输出无法使用"))
      end

      {:ok, %{content: "我直接写正文了。", provider_call_id: "pc-bad-#{attempt}", tool_calls: []}}
    end

    assert {:error, {:native_tool_call_required, "chapter_mission"}, %{provider_call_count: 2}} =
             ChapterMissionService.derive(inputs(), execution(result_fn))

    assert Agent.get(counter, & &1) == 2
  end

  test "依据全部越界且无 statement → 重试后仍失败 mission_unbound；statement 在场则成功保留" do
    result_fn = fn _prompt ->
      {:ok,
       tool_call_result("x", %{
         "author_reasoning" => "x",
         "statement" => "",
         "must_advance" => [%{"text" => "a", "basis_ref" => "nope"}],
         "must_avoid" => [],
         "confidence" => 0.5
       })}
    end

    assert {:error, :mission_unbound, %{provider_call_count: 2}} =
             ChapterMissionService.derive(inputs(), execution(result_fn))

    ok_fn = fn _prompt ->
      {:ok,
       tool_call_result("核清了。", %{
         "author_reasoning" => "核清了。",
         "statement" => "按计划推进。",
         "must_advance" => [%{"text" => "a", "basis_ref" => "nope"}],
         "must_avoid" => [],
         "confidence" => 0.5
       })}
    end

    assert {:ok, mission, %{provider_call_count: 1}} =
             ChapterMissionService.derive(inputs(), execution(ok_fn))

    assert mission.must_advance == []
    assert length(mission.dropped) == 1
  end

  test "provider 缺席或调用失败诚实返回 error" do
    assert {:error, :provider_execution_missing, %{provider_call_count: 0}} =
             ChapterMissionService.derive(inputs(), nil)

    failing = execution(fn _prompt -> {:error, :timeout} end)

    assert {:error, _reason, %{provider_call_count: 1}} =
             ChapterMissionService.derive(inputs(), failing)
  end
end
