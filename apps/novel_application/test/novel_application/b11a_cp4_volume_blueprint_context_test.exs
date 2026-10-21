defmodule NovelApplication.B11ACp4VolumeBlueprintContextTest do
  @moduledoc """
  B11A CP4（VS-00J §4 消费面 2/3/6，ADR-0028）：卷蓝图进入 planner/prose 上下文与坐标。

  覆盖：
  - `ContextAssembler` 对 structured chapter 卷字段的 additive 透传（卷身份/标题/蓝图）；
  - `TurnExecutionService` 当前卷蓝图段（prose/plot 共用，carry 登记门控）；
  - 无卷/无蓝图时 prompt 与今天逐字节等价（I-VOL-4）；
  - `current_volume_context/2` 的当前卷解析（目标章所在卷 vs 规划取章序最大者）。
  """
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.ContextAssembler
  alias NovelApplication.TurnExecutionService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.ChapterMissionInputs
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @work "work-b11a-cp4"

  @blueprint %{
    "goal_conflict" => "夺回矿脉",
    "arc_stage" => "由忍到争",
    "climaxes" => "对账夜",
    "new_maps" => "北境",
    "status" => "CONFIRMED",
    "source_ref" => "artifact:as-bp-1"
  }

  # 两卷结构：第一卷无蓝图（已写完 2 章），第二卷有蓝图（2 章未写）。
  defp structured_chapters do
    [
      %{
        title: "第01章：起",
        seq: 1,
        summary: "甲",
        has_prose: true,
        volume_id: "vol-1",
        volume_seq: 1,
        volume_title: "第一卷·觉醒",
        volume_blueprint: nil
      },
      %{
        title: "第02章：承",
        seq: 2,
        summary: "乙",
        has_prose: true,
        volume_id: "vol-1",
        volume_seq: 1,
        volume_title: "第一卷·觉醒",
        volume_blueprint: nil
      },
      %{
        title: "第03章：转",
        seq: 3,
        summary: "丙",
        has_prose: false,
        volume_id: "vol-2",
        volume_seq: 2,
        volume_title: "第二卷·裂变",
        volume_blueprint: @blueprint
      },
      %{
        title: "第04章：合",
        seq: 4,
        summary: "丁",
        has_prose: false,
        volume_id: "vol-2",
        volume_seq: 2,
        volume_title: "第二卷·裂变",
        volume_blueprint: @blueprint
      }
    ]
  end

  defp context(structured_chapters, snapshot \\ nil) do
    %DialogueContext{
      workspace_id: @work,
      current_work_snapshot: snapshot,
      current_chapters: Enum.map(structured_chapters, & &1.title),
      structured_chapters: structured_chapters,
      assembly_policy: AssemblyPolicy.for_tier(:floor)
    }
  end

  # ── ① ContextAssembler：卷字段 additive 透传 ─────────────────────────

  describe "ContextAssembler 卷字段透传 (B11A CP4)" do
    test "structured chapter 的 volume_id/volume_seq/volume_title/volume_blueprint 原样保留" do
      fetcher = fn _workspace_id ->
        {:ok, nil, nil, nil, nil, ["第03章：转"], [Enum.at(structured_chapters(), 2)]}
      end

      ctx = ContextAssembler.assemble(@work, fetcher)

      assert [
               %{
                 title: "第03章：转",
                 seq: 3,
                 volume_id: "vol-2",
                 volume_seq: 2,
                 volume_title: "第二卷·裂变",
                 volume_blueprint: %{
                   "goal_conflict" => "夺回矿脉",
                   "status" => "CONFIRMED",
                   "source_ref" => "artifact:as-bp-1"
                 }
               }
             ] = ctx.structured_chapters
    end

    test "旧 fetcher（无卷键）→ 卷字段归一为 nil，既有字段不变（additive 兼容）" do
      fetcher = fn _workspace_id ->
        {:ok, nil, nil, nil, nil, ["第01章：起点"],
         [%{title: "第01章：起点", seq: 1, summary: "甲", has_prose: false}]}
      end

      ctx = ContextAssembler.assemble(@work, fetcher)

      assert [
               %{
                 title: "第01章：起点",
                 seq: 1,
                 summary: "甲",
                 has_prose: false,
                 plan_direction: nil,
                 volume_id: nil,
                 volume_seq: nil,
                 volume_title: nil,
                 volume_blueprint: nil
               }
             ] = ctx.structured_chapters
    end

    test "字符串键 fetcher 的卷字段同样归一，空值/非法蓝图 → nil" do
      fetcher = fn _workspace_id ->
        {:ok, nil, nil, nil, nil, ["第02章"],
         [
           %{
             "title" => "第02章",
             "seq" => 2,
             "volume_id" => "vol-9",
             "volume_seq" => "3",
             "volume_title" => "  第三卷  ",
             "volume_blueprint" => %{"goal_conflict" => " 夺回矿脉 ", "unknown" => "x"}
           }
         ]}
      end

      ctx = ContextAssembler.assemble(@work, fetcher)

      assert [
               %{
                 volume_id: "vol-9",
                 volume_seq: 3,
                 volume_title: "第三卷",
                 volume_blueprint: %{"goal_conflict" => "夺回矿脉"}
               }
             ] = ctx.structured_chapters
    end
  end

  # ── ③⑤ 当前卷解析 + 当前卷蓝图段 ──────────────────────────────────

  describe "current_volume_context/2 (B11A CP4)" do
    test "写作轮：用目标章所在卷，written/total 按同卷章统计" do
      assert %{
               volume_id: "vol-1",
               volume_seq: 1,
               volume_title: "第一卷·觉醒",
               volume_blueprint: nil,
               written: 2,
               total: 2
             } =
               TurnExecutionService.current_volume_context(
                 context(structured_chapters()),
                 "第02章：承"
               )

      assert %{
               volume_id: "vol-2",
               volume_seq: 2,
               volume_title: "第二卷·裂变",
               volume_blueprint: @blueprint,
               written: 0,
               total: 2
             } =
               TurnExecutionService.current_volume_context(
                 context(structured_chapters()),
                 "第03章：转"
               )
    end

    test "规划轮（无目标章）：取章序最大者的卷" do
      assert %{volume_id: "vol-2", volume_title: "第二卷·裂变", written: 0, total: 2} =
               TurnExecutionService.current_volume_context(context(structured_chapters()), "")

      assert %{volume_title: "第二卷·裂变"} =
               TurnExecutionService.current_volume_context(context(structured_chapters()), nil)
    end

    test "目标章不在列表里 → 回落章序最大者的卷；无卷信息/空上下文 → nil" do
      assert %{volume_title: "第二卷·裂变"} =
               TurnExecutionService.current_volume_context(
                 context(structured_chapters()),
                 "第99章：不存在"
               )

      plain = [
        %{title: "第01章", seq: 1, summary: "", has_prose: true},
        %{title: "第02章", seq: 2, summary: "", has_prose: false}
      ]

      assert TurnExecutionService.current_volume_context(context(plain), "第02章") == nil
      assert TurnExecutionService.current_volume_context(%DialogueContext{}, "第01章") == nil
      assert TurnExecutionService.current_volume_context(nil, "第01章") == nil
    end
  end

  describe "当前卷蓝图段注入 (B11A CP4)" do
    test "prose_writing：目标章在带蓝图卷 → prompt 注入设计态卷蓝图段" do
      prompt = run("prose_writing", context(structured_chapters()), %{target_chapter: "第03章：转"})

      assert prompt =~ "## 当前卷蓝图（设计态）"
      assert prompt =~ "- 卷：第二卷·裂变"
      assert prompt =~ "- 本卷进度：已写 0 / 共 2 章"
      assert prompt =~ "目标冲突：夺回矿脉"
      assert prompt =~ "弧光阶段：由忍到争"
      assert prompt =~ "高潮章：对账夜"
      assert prompt =~ "新地图：北境"
      # status/source_ref 是采纳元数据，不进 prompt。
      refute prompt =~ "artifact:as-bp-1"
      refute prompt =~ "CONFIRMED"
    end

    test "plot_outline：无目标章 → 用章序最大者的卷（规划坐标），同段注入" do
      prompt = run("plot_outline", context(structured_chapters()), %{})

      assert prompt =~ "## 当前卷蓝图（设计态）"
      assert prompt =~ "- 卷：第二卷·裂变"
      assert prompt =~ "目标冲突：夺回矿脉"
    end

    test "目标章所在卷无蓝图 → 不注入，prompt 与无卷信息时逐字节等价（I-VOL-4）" do
      with_volume =
        run("prose_writing", context(structured_chapters()), %{target_chapter: "第01章：起"})

      plain_chapters =
        Enum.map(structured_chapters(), fn chapter ->
          Map.drop(chapter, [:volume_id, :volume_seq, :volume_title, :volume_blueprint])
        end)

      without_volume = run("prose_writing", context(plain_chapters), %{target_chapter: "第01章：起"})

      refute with_volume =~ "当前卷蓝图"
      assert with_volume == without_volume
    end

    test "未登记能力（world_building）→ 蓝图段被登记表门挡住" do
      prompt = run("world_building", context(structured_chapters()), %{target_chapter: "第03章：转"})

      refute prompt =~ "当前卷蓝图"
    end
  end

  # ── ⑥ 写前推理材料：assembler 透传 → ChapterMissionInputs 自取卷蓝图 ──

  describe "写前推理使命材料 (B11A CP4)" do
    test "prose：assembler 透传后的目标章条目自动带出当前卷蓝图 item" do
      ctx =
        ContextAssembler.assemble(@work, fn _workspace_id ->
          {:ok, nil, nil, nil, nil, Enum.map(structured_chapters(), & &1.title),
           structured_chapters()}
        end)

      chapter = Enum.find(ctx.structured_chapters, &(&1.title == "第03章：转"))

      inputs = ChapterMissionInputs.build(%{chapter: chapter, entries: []})

      assert MapSet.member?(ChapterMissionInputs.refs(inputs), "volume:blueprint")

      assert ChapterMissionInputs.label(inputs, "volume:blueprint") ==
               "目标冲突：夺回矿脉；弧光阶段：由忍到争；高潮与节奏（高潮章：对账夜）；新要素（新地图：北境）"

      assert ChapterMissionInputs.to_prompt_section(inputs) =~ "### 当前卷蓝图（设计态）"
    end

    test "planning：assembler 透传后的未写章条目 → 取章序最大者的卷蓝图 item" do
      ctx =
        ContextAssembler.assemble(@work, fn _workspace_id ->
          {:ok, nil, nil, nil, nil, Enum.map(structured_chapters(), & &1.title),
           structured_chapters()}
        end)

      planned = Enum.reject(ctx.structured_chapters, & &1.has_prose)

      inputs =
        ChapterMissionInputs.build(%{
          mode: :planning,
          chapter: nil,
          planned_chapters: planned,
          entries: []
        })

      assert ChapterMissionInputs.label(inputs, "volume:blueprint") ==
               "目标冲突：夺回矿脉；弧光阶段：由忍到争；高潮与节奏（高潮章：对账夜）；新要素（新地图：北境）"
    end
  end

  # ── ② 卷级收束守则（B11A CP5）：只在卷有设计态蓝图时附在 CP4 段之后 ──

  describe "卷级收束守则 (B11A CP5)" do
    @cp4_section "## 当前卷蓝图（设计态）\n- 卷：第二卷·裂变\n- 本卷进度：已写 0 / 共 2 章\n目标冲突：夺回矿脉\n弧光阶段：由忍到争\n高潮章：对账夜\n新地图：北境"

    test "全书进度尚远 + 卷有蓝图 → CP4 段后空行追加默认卷级收束守则" do
      prompt =
        run("prose_writing", context(structured_chapters(), %{target_length: 14_000}), %{
          target_chapter: "第03章：转"
        })

      assert prompt =~ @cp4_section

      assert prompt =~
               @cp4_section <>
                 "\n\n本卷为「第二卷·裂变」：允许在本卷内做小收束（解决本卷主冲突/回收本卷支线），" <>
                 "但不得写全书终局/大结局/完结章；收束后把新冲突留给后续卷。"
    end

    test "本卷写入比例 >= 80% → 接近收束守则（优先回收本卷支线/小高潮）" do
      prompt =
        run("prose_writing", context(near_closure_structure(), %{target_length: 28_000}), %{
          target_chapter: "第07章：合"
        })

      assert prompt =~ "本卷接近收束：接下来优先回收本卷支线与小高潮"
    end

    test "本卷计划章已写完 → 收束并转入下一卷（全书终局仍看全书守则）" do
      prompt =
        run("prose_writing", context(completed_volume_structure(), %{target_length: 14_000}), %{
          target_chapter: "第04章：合"
        })

      assert prompt =~ "本卷计划章已写完：可确认本卷收束并转入下一卷"
      assert prompt =~ "全书终局仍以全书进度守则为准"
    end

    test "全书进度达阈值（>=85%）→ 不注入卷级守则（全书优先 I-VOL-7），CP4 段逐字节不变" do
      prompt =
        run("prose_writing", context(structured_chapters(), %{target_length: 1_400}), %{
          target_chapter: "第03章：转"
        })

      assert prompt =~ @cp4_section
      refute prompt =~ "本卷计划章已写完"
      refute prompt =~ "本卷接近收束"
      refute prompt =~ "本卷为「"
      # 空指令 = 不追加任何字节：蓝图段后直接接下一 section 的分隔空行。
      assert prompt =~ @cp4_section <> "\n\n"
    end

    test "无设计态蓝图的卷 → 不注入卷级收束（I-VOL-4 退化等价）" do
      prompt =
        run("prose_writing", context(structured_chapters(), %{target_length: 14_000}), %{
          target_chapter: "第01章：起"
        })

      refute prompt =~ "当前卷蓝图"
      refute prompt =~ "本卷计划章已写完"
      refute prompt =~ "本卷接近收束"
      refute prompt =~ "本卷为「"
    end

    test "未登记能力 → carry 门挡住（蓝图段与卷级守则都不出现）" do
      prompt =
        run("world_building", context(structured_chapters(), %{target_length: 14_000}), %{
          target_chapter: "第03章：转"
        })

      refute prompt =~ "当前卷蓝图"
      refute prompt =~ "本卷为「"
    end
  end

  # ── helpers ─────────────────────────────────────────

  defp run(target_ref, context, action_overrides) do
    {:ok, agent} = Agent.start_link(fn -> [] end)

    complete = fn prompt ->
      Agent.update(agent, &[prompt | &1])

      {:ok,
       %{
         content:
           Jason.encode!([
             %{"item_id" => "c1", "title" => "第1章", "body" => "正文", "rationale" => nil}
           ])
       }}
    end

    {_turn_result, _trace} =
      TurnExecutionService.execute(%{
        frame: frame(),
        plan: plan(target_ref, action_overrides),
        decision: allow_decision(),
        context: context,
        author_input: %{text: "创作"},
        provider_execution: %Execution{result_fn: complete}
      })

    agent |> Agent.get(& &1) |> Enum.join("\n\n")
  end

  # 卷蓝图近收束结构：第二卷 5 章 4 章已有正文（4/5 = 80%）。
  defp near_closure_structure do
    volume_one = [
      %{
        title: "第01章：起",
        seq: 1,
        summary: "甲",
        has_prose: true,
        volume_id: "vol-1",
        volume_seq: 1,
        volume_title: "第一卷·觉醒",
        volume_blueprint: nil
      },
      %{
        title: "第02章：承",
        seq: 2,
        summary: "乙",
        has_prose: true,
        volume_id: "vol-1",
        volume_seq: 1,
        volume_title: "第一卷·觉醒",
        volume_blueprint: nil
      }
    ]

    volume_two =
      for seq <- 3..7 do
        %{
          title: "第0#{seq}章：卷二中",
          seq: seq,
          summary: "丙",
          has_prose: seq <= 6,
          volume_id: "vol-2",
          volume_seq: 2,
          volume_title: "第二卷·裂变",
          volume_blueprint: @blueprint
        }
      end

    volume_one ++ volume_two
  end

  # 卷蓝图已写完结构：第二卷 2 章均有正文（2/2）。
  defp completed_volume_structure do
    Enum.map(structured_chapters(), fn
      %{volume_seq: 2} = chapter -> Map.put(chapter, :has_prose, true)
      chapter -> chapter
    end)
  end

  defp frame do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-b11a-cp4",
      turn_id: "turn-b11a-cp4",
      workspace_id: @work,
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{},
      dialogue_goal: %{summary: "创作"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "创作"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  defp plan(target_ref, overrides) do
    action =
      Map.merge(
        %{
          action_id: "act-b11a-cp4",
          action_type: :capability_invocation,
          summary: "创作",
          target_ref: target_ref,
          write_intent: :tentative,
          risk_hint: :low,
          authoring_intent: nil,
          requested_chapter_raw: nil,
          target_chapter: nil
        },
        overrides
      )

    %MicroPlan{
      plan_id: "plan-b11a-cp4",
      turn_id: "turn-b11a-cp4",
      frame_ref: "frame-b11a-cp4",
      plan_goal: %{summary: "创作"},
      risk_hint: :low,
      proposed_actions: [action]
    }
  end

  defp allow_decision do
    %OrchestratorDecision{
      decision_id: "decision-b11a-cp4",
      turn_id: "turn-b11a-cp4",
      frame_ref: "frame-b11a-cp4",
      decision_type: :allow_tool,
      decision_status: :decided,
      reason_codes: ["gates_passed"]
    }
  end
end
