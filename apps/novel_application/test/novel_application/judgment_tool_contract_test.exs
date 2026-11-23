defmodule NovelApplication.JudgmentToolContractTest do
  use ExUnit.Case, async: true

  alias NovelApplication.JudgmentToolContract
  alias NovelCommon.Contracts.ToolArgumentSchema

  @moduletag :r05_explore_contract

  test "探索只提供内部读取请求，不创建作者正文" do
    arguments = %{
      "action" => "explore",
      "explore_request" => %{"tool" => "chapter_read", "query" => "第01章：灵源账单"}
    }

    assert :ok = validate(arguments)
  end

  test "探索不接受作者正文字段，空串与 null 也不能作为兼容占位" do
    arguments = %{action: "explore", explore_request: %{tool: "chapter_read", query: "第一章"}}

    for field <- [:author_reasoning, :author_narrative, :narrative, :question, :content, :reason],
        value <- ["  先核对原文。\n", "", nil] do
      assert {:error, :invalid_tool_arguments} = validate(Map.put(arguments, field, value))
    end
  end

  test "探索不接受目标字段，空串与 null 也不能作为兼容占位" do
    for goal <- ["取得章节引用", "", "  ", nil] do
      arguments = %{
        action: "explore",
        dialogue_goal: goal,
        explore_request: %{tool: "chapter_read", query: "第01章：灵源账单"}
      }

      assert {:error, :invalid_tool_arguments} = validate(arguments)
    end
  end

  test "执行保留非空目标、能力与作者说明，不能借探索契约省略" do
    arguments = %{
      action: "execute",
      capability: "revise_adopted_content",
      adopted_content_ref: "chapter:actual",
      modification_scope: "target_segments",
      target_segment_ids: ["seg_observed"],
      dialogue_goal: "只改第一段，其余正文逐字保留。",
      author_reasoning: "按作者指定的范围提出修订候选。"
    }

    assert :ok = validate(arguments)

    for field <- [:dialogue_goal, :capability, :author_reasoning],
        invalid <- [
          Map.delete(arguments, field),
          Map.put(arguments, field, nil),
          Map.put(arguments, field, ""),
          Map.put(arguments, field, " \n")
        ] do
      assert {:error, :invalid_tool_arguments} = validate(invalid)
    end
  end

  test "action 不认识或缺失时不能借另一分支的字段被接受" do
    arguments = %{
      action: "execute",
      capability: "prose_writing",
      dialogue_goal: "写本章首稿。",
      author_reasoning: "按已确认方向提出正文候选。"
    }

    for invalid <- [
          Map.delete(arguments, :action),
          Map.put(arguments, :action, "inspect"),
          Map.put(arguments, :action, "explore "),
          Map.put(arguments, :action, nil)
        ] do
      assert {:error, :invalid_tool_arguments} = validate(invalid)
    end
  end

  test "执行和探索的专属字段不能串入另一分支，包括 null 占位" do
    explore = %{
      action: "explore",
      explore_request: %{tool: "prose_search", query: "灵气账单"}
    }

    for field <- [
          :capability,
          :pending_artifact_ref,
          :adopted_content_ref,
          :character_ref,
          :modification_scope,
          :target_segment_ids
        ],
        value <- [nil, "foreign"] do
      assert {:error, :invalid_tool_arguments} = validate(Map.put(explore, field, value))
    end

    execute = %{
      action: "execute",
      capability: "prose_writing",
      dialogue_goal: "写本章首稿。",
      author_reasoning: "按已确认方向提出正文候选。"
    }

    for request <- [nil, %{tool: "chapter_read", query: "第一章"}] do
      assert {:error, :invalid_tool_arguments} =
               validate(Map.put(execute, :explore_request, request))
    end
  end

  test "探索必须提供完整读取请求，不能用空请求或额外字段替代" do
    arguments = %{action: "explore"}
    assert {:error, :invalid_tool_arguments} = validate(arguments)

    for request <- [
          nil,
          %{},
          %{tool: "chapter_read"},
          %{tool: "", query: "第一章"},
          %{tool: "chapter_read", query: 1},
          %{tool: "chapter_read", query: "第一章", capability: nil}
        ] do
      assert {:error, :invalid_tool_arguments} =
               validate(Map.put(arguments, :explore_request, request))
    end
  end

  test "对外工具仍是根 object，裸探索和有作者正文的执行都满足公布约束" do
    tool = Enum.find(JudgmentToolContract.tools(:judgment), &(&1.name == "judgment_decision"))
    assert tool.input_schema.type == "object"
    assert tool.input_schema.required == ["action"]
    assert tool.description =~ "judgment_decision 的 explore 只允许字段 action、explore_request"
    assert tool.description =~ "必填字段为 action、dialogue_goal、author_reasoning、capability。"
    binding = tool.input_schema.properties.target_segment_ids.description
    assert binding =~ "存储片段不等于自然段或首句"
    assert binding =~ "片段内需保留的锚句必须在替换正文中保留"
    assert binding =~ "未选片段全部字节保持不变"

    guidance =
      NovelApplication.JudgmentDecisionToolContract.specific_guidance(%{
        tool: "judgment_decision",
        action: "execute",
        capability: "revise_adopted_content"
      })

    assert guidance =~ binding

    branch = NovelApplication.JudgmentDecisionToolContract.schema_for_action("execute")

    for field <- [:pending_artifact_ref, :adopted_content_ref, :character_ref],
        schema <- [tool.input_schema, branch] do
      assert %{type: "string", minLength: 1, description: description} = schema.properties[field]
      refute Map.has_key?(schema.properties[field], :anyOf)
      refute to_string(field) in schema.required
      assert description =~ "非空字符串"
      assert description =~ "不提供此字段，包括 null"
    end

    examples = [
      %{
        action: "explore",
        explore_request: %{tool: "chapter_read", query: "第一章"}
      },
      %{
        action: "execute",
        capability: "prose_writing",
        dialogue_goal: "写本章首稿。",
        author_reasoning: "按已确认方向提出正文候选。"
      }
    ]

    for arguments <- examples do
      assert ToolArgumentSchema.valid?(arguments, tool.input_schema)
      refute ToolArgumentSchema.valid?(Map.delete(arguments, :action), tool.input_schema)
    end
  end

  test "三个目标引用可省略，出现时只接受非空字符串且 atom/string keys 一致" do
    tool = Enum.find(JudgmentToolContract.tools(:judgment), &(&1.name == "judgment_decision"))
    branch = NovelApplication.JudgmentDecisionToolContract.schema_for_action("execute")

    for {field, capability, ref} <- [
          {:pending_artifact_ref, "revise_pending_artifact", "as_pending"},
          {:adopted_content_ref, "revise_adopted_content", "as_adopted"},
          {:character_ref, "revise_character_profile", "character:actual"}
        ] do
      base = %{
        action: "execute",
        capability: capability,
        dialogue_goal: "按真实对象提出候选",
        author_reasoning: "保留作者指定的对象和范围。"
      }

      valid = [base, Map.put(base, field, ref), Map.put(base, field, " " <> ref <> "\n")]

      for arguments <- valid,
          encoded <- [
            arguments,
            Map.new(arguments, fn {key, value} -> {to_string(key), value} end)
          ] do
        assert :ok = validate(encoded)
        assert ToolArgumentSchema.valid?(encoded, tool.input_schema)
        assert ToolArgumentSchema.valid?(encoded, branch)
      end

      for value <- [nil, "", " \t\r\n", 1, 1.5, true, false, [], [ref], %{}, %{"ref" => ref}] do
        arguments = Map.put(base, field, value)

        for encoded <- [
              arguments,
              Map.new(arguments, fn {key, item} -> {to_string(key), item} end)
            ] do
          assert {:error, :invalid_tool_arguments} = validate(encoded)
          refute ToolArgumentSchema.valid?(encoded, tool.input_schema)
          refute ToolArgumentSchema.valid?(encoded, branch)
        end
      end
    end
  end

  test "章范围缺失、未读目标与动作混用经真实判断接收有界拒绝，纠错不崩溃" do
    {:ok, run} =
      NovelDomain.AgentRun.new(%{
        run_id: "scope-contract-run",
        work_id: "scope-contract-work",
        workspace_id: "scope-contract-work",
        session_id: "scope-contract-session",
        parent_turn_ref: "scope-contract-author",
        origin_frame_ref: "scope-contract-frame",
        profile_ref: "judgment_plan_v1",
        goal: %{text: "请按已读材料提出修订候选。", version: 1},
        authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]}
      })

    input = %{
      author_text: run.goal.text,
      source_input_ref: run.parent_turn_ref,
      supplied_context_refs: ["work:" <> run.work_id],
      scope: %{
        work_id: run.work_id,
        facts: %{work: %{ref: "work:" <> run.work_id, work_id: run.work_id, title: "范围契约作品"}},
        context: %{},
        coverage: %{}
      },
      options: [
        plan_run: run,
        capabilities: ["revise_adopted_content"],
        adopted_content_targets: %{
          "chapter:current" => ["revise_adopted_content"],
          "as_saved" => ["revise_adopted_content"]
        }
      ]
    }

    base = %{
      action: "execute",
      capability: "revise_adopted_content",
      adopted_content_ref: "chapter:current",
      dialogue_goal: "修订作者指定范围",
      author_reasoning: "依据正文提出修订候选。"
    }

    for {fields, family} <- [
          {%{}, :modification_scope},
          {%{modification_scope: "target_segments"}, :target_segments},
          {%{modification_scope: "target_segments", target_segment_ids: ["seg_unread"]},
           :target_segments},
          {%{modification_scope: "whole_chapter", target_segment_ids: ["seg_unread"]},
           :target_segments},
          {%{adopted_content_ref: "as_saved", modification_scope: "whole_chapter"},
           :modification_scope}
        ] do
      owner = self()

      provider =
        NovelApplication.TestAgenticLoopFixtures.scripted_judgment_execution(fn request ->
          send(owner, {:scope_contract_request, request})
          {:decision, Map.merge(base, fields)}
        end)

      assert {:error, {:judgment_protocol_violation, {^family, _reason}}, state} =
               NovelApplication.JudgmentProtocol.request_judgment(provider, %{}, input)

      assert state.provider_call_count == 2
      assert_received {:scope_contract_request, _initial}
      assert_received {:scope_contract_request, correction}

      assert Enum.any?(correction.messages, fn message ->
               Enum.any?(message.blocks, fn block ->
                 block.type == "validation_result" and block.status == "failed" and
                   get_in(block.detail, ["message"]) =~ "本次响应未通过契约校验"
               end)
             end)
    end
  end

  test "执行目标字段按 capability 归属校验，非所属字段即使 null 也非法" do
    cases = [
      {"revise_pending_artifact", :pending_artifact_ref},
      {"discard_pending_artifact", :pending_artifact_ref},
      {"revise_adopted_content", :adopted_content_ref},
      {"revise_character_profile", :character_ref},
      {"character_design", nil},
      {"character_evolution", nil},
      {"prose_writing", nil},
      {"plot_outline", nil},
      {"world_building", nil},
      {"maintain_chapter_structure", nil}
    ]

    for {capability, allowed_field} <- cases,
        field <- [:pending_artifact_ref, :adopted_content_ref, :character_ref],
        value <- ["actual-ref", nil] do
      arguments = %{action: "execute", capability: capability} |> Map.put(field, value)
      expected = if field == allowed_field, do: :ok, else: {:error, :target_ref_field_conflict}

      assert NovelApplication.JudgmentDecisionToolContract.validate_execute_target_fields(
               arguments
             ) ==
               expected

      string_keys = Map.new(arguments, fn {key, val} -> {Atom.to_string(key), val} end)

      assert NovelApplication.JudgmentDecisionToolContract.validate_execute_target_fields(
               string_keys
             ) ==
               expected
    end

    assert :ok =
             NovelApplication.JudgmentDecisionToolContract.validate_execute_target_fields(%{
               capability: "prose_writing"
             })
  end

  @tag :r07_raw_schema
  test "当前执行 schema 声明唯一目标片段，不能接受重复项后再由下游消解" do
    args = %{
      action: "execute",
      capability: "revise_adopted_content",
      dialogue_goal: "只修订已定位片段",
      author_reasoning: "按作者指定范围提出候选。",
      adopted_content_ref: "chapter:observed",
      modification_scope: "target_segments",
      target_segment_ids: ["segment-observed", "segment-observed"]
    }

    assert {:error, :invalid_tool_arguments} = validate(args)
    assert :ok = validate(%{args | target_segment_ids: ["segment-observed"]})
  end

  @tag :r07_raw_schema
  test "当前立项提案 schema 的整数下限在原始接收时生效" do
    args = %{
      title: "目标篇幅",
      body: "依据当前计划修订篇幅。",
      field: "target_length",
      value: 0,
      author_reasoning: "提出目标篇幅供作者决定。"
    }

    for value <- [0, -1] do
      assert {:error, :invalid_tool_arguments} =
               JudgmentToolContract.validate(
                 [%{name: "propose_work_profile_revision", arguments: %{args | value: value}}],
                 :judgment
               )
    end

    assert :ok =
             JudgmentToolContract.validate(
               [%{name: "propose_work_profile_revision", arguments: %{args | value: 1}}],
               :judgment
             )
  end

  defp validate(arguments),
    do:
      JudgmentToolContract.validate(
        [%{name: "judgment_decision", arguments: arguments}],
        :judgment
      )
end
