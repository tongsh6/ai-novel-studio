defmodule NovelDomain.ChapterMissionInputsTest do
  use ExUnit.Case, async: true

  alias NovelDomain.ChapterMissionInputs

  defp entry(ledger, subject_ref, status, payload, label \\ nil) do
    %{
      id: "le_#{subject_ref}",
      ledger: ledger,
      subject_ref: subject_ref,
      subject_label: label || subject_ref,
      status: status,
      payload: payload
    }
  end

  defp chapter do
    %{
      seq: 3,
      title: "第03章：巡检收网",
      summary: "公司巡检开始收网，沈洛必须带着证据撤出黑市。",
      plan_direction: %{
        "chapter_role" => "推进章",
        "plot_progress" => "沈洛带证据撤出黑市",
        "information_release" => "旧账牌编号的兑现地点",
        "emotion" => "紧张",
        "scene_plans" => [
          %{"title" => "巷口对峙", "goal" => "甩开巡检", "emotion" => "压迫"}
        ]
      }
    }
  end

  test "按坐标选取：计划字段/场次、到期伏笔、保密清单、弧光、主线、承诺、情绪、进度、阵容各自成 ref" do
    entries = [
      entry(
        "information",
        "foreshadow_a",
        "HIDDEN",
        %{"planned_reveal" => %{"kind" => "chapter", "seq" => 1}, "fact" => "旧账牌编号"},
        "伏笔：旧账牌"
      ),
      entry(
        "information",
        "foreshadow_b",
        "HIDDEN",
        %{"planned_reveal" => %{"kind" => "volume", "seq" => 1}},
        "伏笔：暗抽链路"
      ),
      entry("information", "foreshadow_c", "HIDDEN", %{}, "伏笔：贯穿全书"),
      entry("information", "foreshadow_done", "REVEALED", %{
        "planned_reveal" => %{"kind" => "chapter", "seq" => 1}
      }),
      entry("information", "plan_info_3", "HIDDEN", %{
        "fact" => "本章要揭示的",
        "planned_reveal_seq" => 3
      }),
      entry("information", "plan_info_5", "HIDDEN", %{
        "fact" => "第五章才揭示",
        "planned_reveal_seq" => 5
      }),
      entry(
        "arc",
        "char_1",
        "STALLED",
        %{"last_seen_seq" => 1, "presence_note" => "上次在黑市出现"},
        "老朝奉"
      ),
      entry("arc", "char_2", "ON_TRACK", %{"last_seen_seq" => 2}, "沈洛"),
      entry("conflict", "main", "DORMANT", %{"last_advanced_seq" => 1}, "主线"),
      entry("promise", "genre", "OPEN", %{"content" => "赛博修仙"}, "题材承诺"),
      entry("emotion_curve", "ch_1", "MATCHED", %{
        "seq" => 1,
        "intended" => "紧张",
        "realized" => "紧张"
      }),
      entry("emotion_curve", "ch_2", "DEVIATED", %{
        "seq" => 2,
        "intended" => "兴奋",
        "realized" => "疑惑"
      })
    ]

    inputs =
      ChapterMissionInputs.build(%{
        chapter: chapter(),
        entries: entries,
        written_progress: %{chapter_seq: 2, volume_seq: 1},
        work_snapshot: %{target_length: 140_000, planned_volumes: 2},
        written_chapters: 2,
        roster: [
          %{id: "c1", name: "沈洛", narrative_role: "PROTAGONIST", role: "灵气稽查员"},
          %{id: "c2", name: "老朝奉", narrative_role: "SUPPORTING"}
        ]
      })

    refs = ChapterMissionInputs.refs(inputs)

    assert MapSet.member?(refs, "plan:3:chapter_role")
    assert MapSet.member?(refs, "plan:3:scene:1")
    assert MapSet.member?(refs, "ledger:information:foreshadow_a")
    assert MapSet.member?(refs, "ledger:information:foreshadow_b")
    # 无预期伏笔不逐条列名，只计数；已回收的不进材料
    refute MapSet.member?(refs, "ledger:information:foreshadow_c")
    refute MapSet.member?(refs, "ledger:information:foreshadow_done")
    assert inputs.undated_foreshadow_count == 1
    # 目标章自己的计划信息不是「不得揭示」
    refute MapSet.member?(refs, "ledger:information:plan_info_3")
    assert MapSet.member?(refs, "ledger:information:plan_info_5")
    assert MapSet.member?(refs, "ledger:arc:char_1")
    assert MapSet.member?(refs, "ledger:conflict:main")
    assert MapSet.member?(refs, "ledger:promise:genre")
    assert MapSet.member?(refs, "ledger:emotion_curve:ch_2")
    assert MapSet.member?(refs, "skeleton:progress")
    assert MapSet.member?(refs, "roster:c1")

    text = ChapterMissionInputs.to_prompt_section(inputs)
    assert text =~ "目标章：第3章 第03章：巡检收网"
    # R9 口径：已写章 seq(2) > 预期章 seq(1) 才算超期
    assert text =~ "[ledger:information:foreshadow_a] 伏笔：旧账牌（预期第1章回收，已超期）；内容：旧账牌编号"
    assert text =~ "[ledger:information:plan_info_5] 第5章前保密：第五章才揭示"
    assert text =~ "[ledger:arc:char_1] 老朝奉：STALLED，最近出场第1章，上次在黑市出现"
    assert text =~ "另有 1 条长线伏笔未回收"
    assert text =~ "距目标尚远，不得提前收官"
    assert text =~ "[roster:c1] 沈洛（主角，灵气稽查员）"
    # STALLED 弧光排在 ON_TRACK 之前
    assert :binary.match(text, "char_1") < :binary.match(text, "char_2")
    assert ChapterMissionInputs.label(inputs, "plan:3:chapter_role") == "章功能定位：推进章"
  end

  test "目标章未定且无账面时只带章头，诚实为空材料" do
    inputs = ChapterMissionInputs.build(%{chapter: nil, entries: []})
    assert ChapterMissionInputs.empty?(inputs)
    assert ChapterMissionInputs.to_prompt_section(inputs) == "目标章：未定（按进度态推导）"
  end

  test "只有计划摘要的章走 summary ref；本章到期的伏笔标注「本章到期」" do
    inputs =
      ChapterMissionInputs.build(%{
        chapter: %{seq: 2, title: "第02章", summary: "旧账兑现"},
        entries: [
          entry(
            "information",
            "foreshadow_x",
            "HIDDEN",
            %{"planned_reveal" => %{"kind" => "chapter", "seq" => 2}},
            "伏笔 X"
          )
        ],
        written_progress: %{chapter_seq: 1, volume_seq: 1}
      })

    text = ChapterMissionInputs.to_prompt_section(inputs)
    assert text =~ "[plan:2:summary] 计划摘要：旧账兑现"
    assert text =~ "伏笔 X（预期第2章回收，本章到期）"
  end
end
