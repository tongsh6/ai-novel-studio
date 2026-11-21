defmodule NovelAgent.CreativeProvider.RealCreativeRoleTaskTest do
  use ExUnit.Case, async: true

  alias NovelAgent.CreativeProvider.Real
  alias NovelAgent.Provider.Execution
  alias NovelAgent.TestSupport.AuthoringTaskFixtures
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.AuthoringTask
  alias NovelCommon.Contracts.CreativeRequest
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelTest.TestProviderPrompt

  defp captured_prompt(request) do
    assert {:ok, ir} = Real.request_ir(request)
    assert :ok = RequestIR.validate(ir)
    scope = TestProviderPrompt.scope_content(ir)

    assert scope["authoring_task"] ==
             request.task
             |> AuthoringTask.to_map()
             |> Map.drop(["author_words", "goal_source_ref"])
             |> Jason.encode!()
             |> Jason.decode!()

    assert scope["operation"]["creative_brief"] == request.creative_brief
    assert scope["operation"]["context_text"] == request.context_text
    assert scope["operation"]["revision"] == request.revision
    assert TestProviderPrompt.author_text(ir) == request.task.author_words
    ir
  end

  defp request(tool, artifact_type, task) do
    %CreativeRequest{
      request_id: "req-#{tool}",
      tool_name: tool,
      artifact_type: artifact_type,
      creative_brief: "用户创作简述占位",
      context_text: "上下文占位",
      source_turn_ref: "turn-1",
      source_input_ref: task.source.ref,
      task: task,
      provider_hints: %{}
    }
  end

  defp assert_task_prompt(ir, task, operation_marker) do
    prompt = AuthoringTaskFixtures.prompt_text(ir)
    assert String.split(prompt, AuthoringSemantics.static_block(task)) |> length() == 2
    assert String.split(prompt, "## 创作协作共同规则") |> length() == 2
    assert prompt =~ operation_marker
    assert TestProviderPrompt.author_text(ir) == task.author_words

    assert TestProviderPrompt.scope_content(ir)["authoring_task"]["author_goal"] ==
             task.author_goal

    assert prompt =~ "submit_tentative_artifact"
    refute prompt =~ "只返回 JSON 数组"
    refute prompt =~ "本次你承担创作助手的角色"
    refute prompt =~ "用户创作简述："
    refute Map.has_key?(TestProviderPrompt.scope_content(ir)["authoring_task"], "author_words")
  end

  @tag :source_interval_mapping
  test "目标修订缺映射时闭合原调用并纠错，成功 item 保留映射及正文原字节" do
    task = AuthoringTaskFixtures.task(:revision)
    task = %{task | scope: Map.put(task.scope, :modification_scope, :target_segments)}
    assert {:ok, ^task} = AuthoringSemantics.validate(task)

    body = " \r\n锚句不变。\n\n合并后的叙述。\t\r\n"
    ids = ["seg_1_source", "seg_2_source"]
    item = %{item_id: "merged", title: "修订", body: body, rationale: "保留锚句并压缩重复。"}
    {:ok, calls} = Agent.start_link(fn -> [] end)

    execution = %Execution{
      result_fn: fn ir ->
        previous = Agent.get_and_update(calls, &{&1, &1 ++ [ir]})
        arguments = if previous == [], do: item, else: Map.put(item, :target_segment_ids, ids)

        {:ok,
         %{
           content: "",
           tool_calls: [
             %{
               id: "interval-call-#{length(previous) + 1}",
               name: "submit_tentative_artifact",
               arguments: %{items: [arguments]}
             }
           ]
         }}
      end
    }

    assert {%{status: :ok, items: [accepted]}, session} =
             Real.generate_with_session(
               request("prose_writing", :prose_fragment, task),
               execution
             )

    assert session.provider_call_count == 2
    assert accepted.body == body
    assert Map.get(accepted, :target_segment_ids) == ids

    [first, correction] = Agent.get(calls, & &1)
    assert Enum.take(correction.messages, length(first.messages)) == first.messages
    blocks = Enum.flat_map(correction.messages, & &1.blocks)
    original = Enum.find(blocks, &(&1.type == "tool_call" and &1.call_id == "interval-call-1"))
    [raw_item] = RequestIR.json_value(original.arguments)["items"]
    assert raw_item["body"] == body
    refute Map.has_key?(raw_item, "target_segment_ids")

    assert Enum.any?(blocks, fn block ->
             block.type == "validation_result" and block.call_id == "interval-call-1" and
               block.status == "failed"
           end)
  end

  @tag :source_interval_mapping
  test "其它范围或产物不声明也不接受目标映射，包括 null" do
    revision = AuthoringTaskFixtures.task(:revision)

    whole = %{
      revision
      | scope:
          Map.merge(revision.scope, %{modification_scope: :whole_chapter, coverage: :complete})
    }

    formatting = %{revision | scope: Map.put(revision.scope, :modification_scope, :format_only)}

    world = %{
      revision
      | scope: Map.put(revision.scope, :modification_scope, :target_segments),
        output_contract: AuthoringTaskFixtures.contract_for(:world_building)
    }

    first_draft = AuthoringTaskFixtures.prose_task()

    first_draft_with_target_marker = %{
      first_draft
      | scope: Map.put(first_draft.scope, :modification_scope, :target_segments)
    }

    cases = [
      {"prose_writing", :prose_fragment, first_draft, %{}},
      {"prose_writing", :prose_fragment, first_draft_with_target_marker, %{}},
      {"prose_writing", :prose_fragment, whole, %{}},
      {"prose_writing", :prose_formatting_plan, formatting,
       %{line_break_changes: [%{boundary_id: "break_1_hash", lines: 1}]}},
      {"world_building", :world_setting, world, %{}}
    ]

    for {tool, type, task, extra} <- cases do
      assert {:ok, ^task} = AuthoringSemantics.validate(task)
      request = request(tool, type, task)
      ir = captured_prompt(request)
      [native] = RequestIR.Tools.tool_specs(ir)
      item_schema = native.input_schema["properties"]["items"]["items"]
      refute Map.has_key?(item_schema["properties"], "target_segment_ids")
      refute "target_segment_ids" in item_schema["required"]
      item = Map.merge(%{item_id: "plain", title: "候选", body: "正文保留。"}, extra)

      generate = fn output_item ->
        execution = %Execution{
          result_fn: fn _ ->
            {:ok,
             %{
               content: "",
               tool_calls: [
                 %{
                   id: "scope-call",
                   name: "submit_tentative_artifact",
                   arguments: %{items: [output_item]}
                 }
               ]
             }}
          end
        }

        Real.generate_with_session(request, execution, max_provider_calls: 1)
      end

      assert {%{status: :ok}, _session} = generate.(item)

      for ids <- [nil, ["seg_1_source"]] do
        assert {%{status: :error}, session} =
                 generate.(Map.put(item, :target_segment_ids, ids))

        assert session.provider_call_count == 1
      end
    end
  end

  @tag :source_interval_mapping
  test "目标正文的伴生设定不能继承正文映射资格" do
    task = AuthoringTaskFixtures.task(:revision)
    task = %{task | scope: Map.put(task.scope, :modification_scope, :target_segments)}

    execution = %Execution{
      result_fn: fn _ ->
        {:ok,
         %{
           content: "",
           tool_calls: [
             %{
               id: "companion-mapping",
               name: "submit_tentative_artifact",
               arguments: %{
                 items: [
                   %{
                     item_id: "prose",
                     title: "正文",
                     body: "正文。",
                     target_segment_ids: ["seg_1_source"]
                   }
                 ],
                 companion_artifacts: [
                   %{
                     artifact_type: "world_rule_seed",
                     item_id: "rule",
                     title: "规则",
                     body: "日落后熄灯。",
                     target_segment_ids: ["seg_1_source"]
                   }
                 ]
               }
             }
           ]
         }}
      end
    }

    assert {%{status: :error}, session} =
             Real.generate_with_session(
               request("prose_writing", :prose_fragment, task),
               execution,
               max_provider_calls: 1
             )

    assert session.provider_call_count == 1
  end

  test "R05: 只有 observation 元数据与来源引用时不能升为 Base 材料" do
    task =
      AuthoringTaskFixtures.task(:outline, %{
        materials: [%{kind: :observation, ref: "chapter:metadata-only", complete?: true}],
        source_refs: ["scope:lineage-only"]
      })

    ir = captured_prompt(request("plot_outline", :outline_draft, task))
    refute Enum.any?(ir.refs.base_refs, &(&1.ref == "chapter:metadata-only"))
    refute Enum.any?(ir.refs.base_refs, &(&1.ref == "scope:lineage-only"))
    assert ir.refs.observation_refs == []
  end

  test "R05: 卷级目标使用通用大纲规则，卷蓝图与章计划均有独立合法形状" do
    goal = "只规划第一卷的目标冲突和人物弧光，不新建章节。"
    task = AuthoringTaskFixtures.task(:outline, %{author_goal: goal})
    ir = captured_prompt(request("plot_outline", :outline_draft, task))
    rules = Projection.system_text(ir.system)

    assert TestProviderPrompt.scope_content(ir)["authoring_task"]["author_goal"] == goal
    assert rules =~ "卷蓝图"
    assert rules =~ "序号"
    assert rules =~ "章功能定位："
    refute rules =~ "本次你承担章计划助手的角色"
    refute rules =~ ~s(- "title"：章节标题)
    refute rules =~ ~s(- "body"：该章的结构化方向，必须)
  end

  test "plot_outline creation prompt keeps outline domain schema and shared semantics" do
    task = AuthoringTaskFixtures.task(:outline)
    ir = captured_prompt(request("plot_outline", :outline_draft, task))
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert_task_prompt(ir, task, "本轮为结构规划")
    assert prompt =~ "章功能定位："
    assert prompt =~ "场次：场名｜目标："
    assert prompt =~ "本次你承担小说大纲规划助手的角色"
    assert prompt =~ ~s("chapter_ref"（可选）)
    assert prompt =~ "逐字复制"
    assert prompt =~ "新规划的章不填/留空"
    assert prompt =~ "不得自行编造、改写 ref"
    assert prompt =~ "不得把 ref 拼进 title 或 body"
  end

  test "plot_outline revision prompt uses revision operation and preserve" do
    task =
      AuthoringTaskFixtures.task(:revision, %{
        output_contract: AuthoringTaskFixtures.contract_for(:outline),
        preserve: ["未要求修改的内容逐字保留"]
      })

    ir = captured_prompt(request("plot_outline", :outline_draft, task))
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert_task_prompt(ir, task, "本轮为修订")

    assert TestProviderPrompt.scope_content(ir)["authoring_task"]["preserve"] ==
             ["未要求修改的内容逐字保留"]

    assert prompt =~ "本次你承担小说大纲修订助手的角色"
  end

  test "character_design creation prompt keeps narrative_role/domain schema" do
    task = AuthoringTaskFixtures.task(:character_design)
    ir = captured_prompt(request("character_design", :character_seed, task))
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert_task_prompt(ir, task, "本轮为角色设计")
    assert prompt =~ "narrative_role"
    assert prompt =~ "PROTAGONIST"
    assert prompt =~ "本次你承担小说角色设计助手的角色"
  end

  test "character_design revision prompt keeps role schema with revision semantics" do
    task =
      AuthoringTaskFixtures.task(:revision, %{
        output_contract: AuthoringTaskFixtures.contract_for(:character_design)
      })

    ir = captured_prompt(request("character_design", :character_seed, task))
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert_task_prompt(ir, task, "本轮为修订")
    assert prompt =~ "narrative_role"
    assert prompt =~ "本次你承担小说角色设定修订助手的角色"
  end

  test "character_evolution prompt keeps memory_subtype schema" do
    task = AuthoringTaskFixtures.task(:character_evolution)
    ir = captured_prompt(request("character_evolution", :character_evolution_seed, task))
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert_task_prompt(ir, task, "本轮为角色演化记录")
    assert prompt =~ "memory_subtype"
    assert prompt =~ "CHARACTER_PROFILE"
    assert prompt =~ "只记录演化事件，不重建主档案"
  end

  test "world_building creation prompt keeps artifact_type-specific domain schema" do
    task =
      AuthoringTaskFixtures.task(:world_building, %{
        output_contract:
          AuthoringTaskFixtures.task(:world_building).output_contract
          |> Map.put(:artifact_type, :foreshadowing_seed)
      })

    ir = captured_prompt(request("world_building", "foreshadowing_seed", task))
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert_task_prompt(ir, task, "本轮为世界观/设定提案")
    assert prompt =~ "本次草稿类型：foreshadowing_seed"
    assert prompt =~ "伏笔标题"
    assert prompt =~ "伏笔线索 / 首次出现位置"
    assert prompt =~ "本次你承担小说设定与连续性设计助手的角色"
  end

  test "world_building revision prompt does not reuse new-create template columns" do
    task =
      AuthoringTaskFixtures.task(:revision, %{
        output_contract:
          AuthoringTaskFixtures.task(:revision).output_contract
          |> Map.put(:artifact_type, :world_setting)
      })

    ir = captured_prompt(request("world_building", "world_setting", task))
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert_task_prompt(ir, task, "本轮为修订")
    assert prompt =~ "本次修订类型：world_setting"
    refute prompt =~ "逐行包含：设定内容"
    refute prompt =~ "待作者确认处"
    assert prompt =~ "本次你承担小说设定修订助手的角色"
  end

  test "unsupported creative tool fails explicitly" do
    request = request("creative_generation", :world_setting, AuthoringTaskFixtures.prose_task())

    execution = %Execution{
      result_fn: fn _ -> flunk("unsupported tool must not call provider") end
    }

    result = Real.generate(request, execution)
    assert result.status == :error
    assert [%{code: "unsupported_creative_tool"}] = result.errors
  end

  test "prose revision prompt carries baseline/scope discipline (task-24/29)" do
    task = AuthoringTaskFixtures.task(:revision)

    request = %{
      request("prose_writing", :prose_fragment, task)
      | revision: "本轮修订已有候选。必须输出完整修订稿。\n\n目标段定位：作者要求修改第2段。\n第二段原文。"
    }

    ir = captured_prompt(request)
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert prompt =~ "本轮为修订"
    assert prompt =~ "## 修订基线纪律"
    assert prompt =~ "保留原稿的段落边界与未要求修改段落的字句"
    assert prompt =~ "作者指定段落"
    assert prompt =~ "不得写成续写或“继续往后写”"
    assert prompt =~ "不得新增或删除段落/空行"
    assert prompt =~ "明确改动（如“七成改六成”"
    assert prompt =~ "目标段定位"
    assert prompt =~ "必须输出完整修订稿"
    assert prompt =~ "原样返回基线原文视为未执行修订"
    assert prompt =~ "## 创作协作共同规则"
    assert prompt =~ "submit_tentative_artifact"
    refute prompt =~ "只返回 JSON 数组"
  end

  test "B28: format_only chapter revision renders ordered coverage + no continuation" do
    task =
      AuthoringTaskFixtures.task(:revision, %{
        scope: %{
          refs: ["draft:d1", "draft:d2"],
          coverage: :complete,
          target_chapter_ref: "chapter:ch01",
          object_kind: :chapter_prose,
          modification_scope: :format_only,
          expected_base_versions: [%{ref: "draft:d1", version: 2}]
        }
      })

    ir = captured_prompt(request("prose_writing", :prose_fragment, task))
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert prompt =~ "## 整章仅排版修订（format_only）"
    scope = TestProviderPrompt.scope_content(ir)["authoring_task"]["scope"]
    assert scope["refs"] == ["draft:d1", "draft:d2"]
    assert scope["target_chapter_ref"] == "chapter:ch01"
    assert scope["modification_scope"] == "format_only"
    assert prompt =~ "按任务给出的覆盖顺序完整输出"
    assert prompt =~ "只允许调整分段、标点、排版与空白；不改变任何字句"
    assert prompt =~ "不得写成续写或“继续往后写”"
    refute prompt =~ "系统当前没有保证字句不变的独立排版能力"
    refute prompt =~ ~r/(请|可以)继续往后写/
  end

  test "B28: whole_chapter content revision renders full replacement + preserve others" do
    task =
      AuthoringTaskFixtures.task(:revision, %{
        scope: %{
          refs: ["draft:d1", "draft:d2"],
          coverage: :complete,
          target_chapter_ref: "chapter:ch01",
          object_kind: :chapter_prose,
          modification_scope: :whole_chapter,
          expected_base_versions: [%{ref: "draft:d1", version: 1}]
        }
      })

    ir = captured_prompt(request("prose_writing", :prose_fragment, task))
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert prompt =~ "## 整章内容修订"
    assert prompt =~ "按任务给出的覆盖顺序输出整章的完整替换稿"
    assert prompt =~ "不得只返回修改片段、摘要或旧稿对照"
    assert prompt =~ "其余段落/片段逐字保留"
    assert prompt =~ "不得写成续写或“继续往后写”"

    assert TestProviderPrompt.scope_content(ir)["authoring_task"]["scope"]["modification_scope"] ==
             "whole_chapter"

    refute prompt =~ ~r/(请|可以)继续往后写/
  end

  test "B28/B36: target_segments revision only asks for target replacement text (replacement-only)" do
    task =
      AuthoringTaskFixtures.task(:revision, %{
        scope: %{
          refs: ["draft:d1"],
          coverage: :complete,
          target_chapter_ref: "chapter:ch01",
          object_kind: :chapter_prose,
          modification_scope: :target_segments
        }
      })

    ir = captured_prompt(request("prose_writing", :prose_fragment, task))
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert prompt =~ "## 指定修订片段内容修订（target_segments）"
    assert prompt =~ "body 是这些来源块的完整替换文本"
    assert prompt =~ "不输出未选片段"
    assert prompt =~ "只做要求的修改，不续写"
    assert prompt =~ "未指定片段由系统逐字保留"
    assert prompt =~ "每个 item 必须含 target_segment_ids"
    refute prompt =~ "不得只返回修改片段"
    refute prompt =~ "按任务给出的覆盖顺序输出指定片段/段落的完整替换稿"
    # 整章/format_only 的旧语义不应出现在 target_segments guidance 中。
    refute prompt =~ "## 整章内容修订"
    refute prompt =~ "## 整章仅排版修订（format_only）"
  end

  test "B36 CP3 real wording: target_segments prompt carries 改第一段/其余段落别动 and replacement-only contract" do
    cp3_wording =
      "把第03章：黑市调频师的正文第一段改得更紧张，只改这一段，其他段落别动。"

    task =
      AuthoringTaskFixtures.task(:revision, %{
        scope: %{
          refs: ["draft:d1"],
          coverage: :complete,
          target_chapter_ref: "chapter:ch01",
          object_kind: :chapter_prose,
          modification_scope: :target_segments
        }
      })

    base_request = request("prose_writing", :prose_fragment, task)
    ir = captured_prompt(%{base_request | creative_brief: cp3_wording})
    prompt = AuthoringTaskFixtures.prompt_text(ir)

    assert TestProviderPrompt.scope_content(ir)["operation"]["creative_brief"] == cp3_wording
    assert prompt =~ "body 是这些来源块的完整替换文本"
    assert prompt =~ "不输出未选片段"
    assert prompt =~ "只做要求的修改，不续写"
    refute prompt =~ "不得只返回修改片段"
    refute prompt =~ "输出整章完整替换稿"
  end
end
