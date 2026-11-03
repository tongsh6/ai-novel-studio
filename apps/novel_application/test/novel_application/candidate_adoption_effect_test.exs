defmodule NovelApplication.CandidateAdoptionEffectTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AdoptionWorkflow
  alias NovelApplication.ArtifactAssembler
  alias NovelApplication.CandidateAdoptionEffect
  alias NovelApplication.TurnResultBuilder
  alias NovelCommon.Contracts.ToolResult
  alias NovelDomain.DialogueFrame
  alias NovelDomain.TentativeArtifactSet

  @chapter_ref "chapter:49964bf6-f515-4c72-8474-600346b43464"

  describe "merge_payload/2：档位 A append-only 映射" do
    test "记忆/档案类候选 echo append（不猜 rewrite/排版/大纲）" do
      for type <- [
            :world_setting,
            :world_rule_seed,
            :foreshadowing_seed,
            :style_rule_seed,
            :constraint_seed,
            :character_seed,
            :character_evolution_seed,
            :plot_direction
          ] do
        assert %{adoption_effect: %{mode: "append"}} =
                 CandidateAdoptionEffect.merge_payload(%{}, artifact_set(%{artifact_type: type}))
      end

      assert %{} =
               CandidateAdoptionEffect.merge_payload(
                 %{},
                 artifact_set(%{artifact_type: :outline_draft})
               )

      assert %{} =
               CandidateAdoptionEffect.merge_payload(
                 %{},
                 artifact_set(%{artifact_type: :prose_formatting_plan})
               )
    end

    test "章节正文仅在非 rewrite 且目标章 ref 合法时 append" do
      for intent <- [nil, :continuation, "continuation"] do
        payload =
          CandidateAdoptionEffect.merge_payload(
            %{},
            artifact_set(%{
              artifact_type: :prose_fragment,
              authoring_intent: intent,
              target_chapter_ref: @chapter_ref
            })
          )

        assert payload.adoption_effect == %{mode: "append"}
      end

      assert %{} =
               CandidateAdoptionEffect.merge_payload(
                 %{},
                 artifact_set(%{
                   artifact_type: :prose_fragment,
                   authoring_intent: :rewrite,
                   target_chapter_ref: @chapter_ref
                 })
               )

      assert %{} =
               CandidateAdoptionEffect.merge_payload(
                 %{},
                 artifact_set(%{
                   artifact_type: :scene_draft,
                   authoring_intent: :continuation,
                   target_chapter_ref: nil
                 })
               )

      assert %{} =
               CandidateAdoptionEffect.merge_payload(
                 %{},
                 artifact_set(%{
                   artifact_type: :prose_fragment,
                   authoring_intent: :continuation,
                   target_chapter_ref: "chapter:not-a-uuid"
                 })
               )
    end

    test "修订候选不 echo（payload effect 归 B28/B36 流程），string artifact_type 兼容" do
      revision =
        artifact_set(%{
          artifact_type: :prose_fragment,
          authoring_intent: :continuation,
          target_chapter_ref: @chapter_ref,
          revision_base: "artifact:old"
        })

      assert %{} = CandidateAdoptionEffect.merge_payload(%{}, revision)

      string_set = artifact_set(%{artifact_type: "world_setting"})

      assert %{adoption_effect: %{mode: "append"}} =
               CandidateAdoptionEffect.merge_payload(%{}, string_set)
    end

    test "保留现有 payload 键" do
      payload =
        CandidateAdoptionEffect.merge_payload(
          %{items: [], title: "t"},
          artifact_set(%{artifact_type: :world_setting})
        )

      assert payload.items == []
      assert payload.title == "t"
      assert payload.adoption_effect == %{mode: "append"}
    end
  end

  describe "TurnResultBuilder pending payload（创建链路）" do
    test "世界设定候选 pending payload 含 adoption_effect append，items 不变" do
      as = assemble_world_setting()

      [pending] = build(as).adoption_state.pending

      assert pending.payload.adoption_effect == %{mode: "append"}
      assert pending.payload[:items] == as.items
      assert is_binary(pending.payload[:title])
      assert pending.payload[:item_count] == 1
    end

    test "普通重写候选不伪造 effect（缺失即 unknown）" do
      as =
        artifact_set(%{
          artifact_set_id: "as-rewrite",
          artifact_type: :prose_fragment,
          items: [%{item_id: "i1", title: "候选", body: "正文", rationale: nil}],
          authoring_intent: :rewrite,
          target_chapter: "第01章：底层灵气账单",
          target_chapter_ref: @chapter_ref
        })

      [pending] = build(as).adoption_state.pending
      refute Map.has_key?(pending.payload, :adoption_effect)
    end

    test "显式 pending_payload 覆盖 echo（B28 修订语义不被 append 覆盖）" do
      as = assemble_world_setting()

      result =
        TurnResultBuilder.build(
          frame(),
          %{},
          [],
          nil,
          nil,
          as,
          nil,
          %{pending_payload: %{adoption_effect: %{mode: "replace_scope"}, title: "整章修订"}}
        )

      [pending] = result.adoption_state.pending
      assert pending.payload.adoption_effect == %{mode: "replace_scope"}
      assert pending.payload[:title] == "整章修订"
    end
  end

  describe "AdoptionWorkflow validate_b28_contract 守卫（append 不改变采纳语义）" do
    test "非章节 append 无 chapter ref → :ok（记忆/档案追加不要求章节目标）" do
      artifact = %{
        artifact_id: "as-1",
        artifact_type: :world_setting,
        payload: %{adoption_effect: %{mode: "append"}}
      }

      assert :ok = AdoptionWorkflow.validate_b28_contract(artifact)
    end

    test "prose append 无 chapter ref → 仍 :target_missing（不放宽章节约束）" do
      artifact = %{
        artifact_id: "as-2",
        artifact_type: :prose_fragment,
        payload: %{adoption_effect: %{mode: "append"}}
      }

      assert {:error, :target_missing} = AdoptionWorkflow.validate_b28_contract(artifact)
    end

    test "prose append + 合法 chapter ref → :ok" do
      artifact = %{
        artifact_id: "as-3",
        artifact_type: :prose_fragment,
        target_chapter_ref: @chapter_ref,
        payload: %{adoption_effect: %{mode: "append"}}
      }

      assert :ok = AdoptionWorkflow.validate_b28_contract(artifact)
    end

    test "无 effect 仍走 legacy 校验（不变）" do
      artifact = %{artifact_id: "as-4", artifact_type: :world_setting, payload: %{title: "设定"}}
      assert :ok = AdoptionWorkflow.validate_b28_contract(artifact)
    end
  end

  describe "世界设定采纳行为（echo 前后 canon/记忆事实一致）" do
    test "非章节 append 无 ref：采纳成功，且持久输入与无 echo 时一致" do
      with_echo = adopt_with_writer(%{adoption_effect: %{mode: "append"}})
      without_echo = adopt_with_writer(%{})

      assert with_echo.status == "accepted"
      assert without_echo.status == "accepted"

      # 持久化输入除 additive effect 外完全一致；adopted 结果引用一致（canon/记忆事实不变）。
      # decision_id 每轮随机生成，比较持久化输入时排除该动态字段与 additive effect。
      assert Map.drop(with_echo.attrs, [:adoption_effect, :decision_id]) ==
               Map.drop(without_echo.attrs, [:adoption_effect, :decision_id])

      assert with_echo.attrs.adoption_effect == %{mode: "append"}
      assert without_echo.attrs.adoption_effect == nil
      assert with_echo.persisted[:mutation_id] == without_echo.persisted[:mutation_id]
      assert with_echo.persisted[:memory_item_id] == without_echo.persisted[:memory_item_id]

      [with_resolved] = with_echo.turn_result.adoption_state.resolved
      [without_resolved] = without_echo.turn_result.adoption_state.resolved

      assert Map.take(with_resolved, [:artifact_id, :adoption_status, :mutation_ref]) ==
               Map.take(without_resolved, [:artifact_id, :adoption_status, :mutation_ref])
    end

    test "adoption_effect 缺失时走 legacy 路径（accepted、无 effect 注入）" do
      legacy = adopt_with_writer(%{})
      assert legacy.status == "accepted"
      assert legacy.attrs.adoption_effect == nil
    end
  end

  # ── helpers ────────────────────────────────────────────────────────────

  defp artifact_set(attrs) do
    struct!(
      TentativeArtifactSet,
      Map.merge(
        %{
          artifact_set_id: "as-effect",
          artifact_type: :world_setting,
          source_turn_ref: "turn-source",
          source_tool_result_ref: "tr-1"
        },
        attrs
      )
    )
  end

  defp assemble_world_setting do
    {:ok, as} =
      ArtifactAssembler.assemble(
        %ToolResult{
          tool_result_id: "tr-world",
          tool_request_ref: "tq-world",
          tool_name: "world_building",
          status: :succeeded,
          output: %{
            artifact_type: "world_setting",
            item_count: 1,
            items: [%{item_id: "i1", title: "灯楼旧账", body: "灯楼旧账是一条规则", rationale: nil}]
          },
          artifact_refs: ["i1"],
          state_delta: [],
          usage: %{},
          trace_refs: [],
          completed_at: DateTime.utc_now()
        },
        "turn-world"
      )

    as
  end

  defp build(as) do
    TurnResultBuilder.build(frame(), %{}, [], nil, nil, as)
  end

  defp frame do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-effect",
      turn_id: "turn-effect",
      workspace_id: "work",
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{author_input_ref: "turn-effect"},
      dialogue_goal: %{summary: "候选"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "候选"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  defp adopt_with_writer(artifact_payload) do
    writer = fn attrs ->
      send(self(), {:adoption_attrs, attrs})

      {:ok,
       %{
         mutation_id: "mutation-1",
         mutation_status: "APPLIED",
         memory_item_id: "memory-1",
         memory_status: "CONFIRMED",
         source_revision_ref: "mutation:mutation-1",
         reading_projection: nil
       }}
    end

    source =
      source_turn_result(%{
        payload: %{title: "灯楼旧账", content: "灯楼旧账是一条规则"} |> Map.merge(artifact_payload)
      })

    assert {:ok, action_result, turn_result} =
             AdoptionWorkflow.handle_adopt(source, %{"artifact_id" => "as-1"}, writer)

    attrs = receive do: ({:adoption_attrs, attrs} -> attrs)

    %{
      status: action_result.status,
      attrs: attrs,
      persisted: action_result.persistence,
      turn_result: turn_result
    }
  end

  defp source_turn_result(artifact_attrs) do
    %{
      turn_id: "turn-source",
      work_id: "work-1",
      adoption_state: %{
        pending: [
          Map.merge(
            %{
              artifact_id: "as-1",
              artifact_type: :world_setting,
              adoption_status: "TENTATIVE",
              requires_adoption: true,
              source_tool_result_ref: "tr-1",
              payload: %{title: "灯楼旧账", content: "灯楼旧账是一条规则"}
            },
            artifact_attrs
          )
        ],
        resolved: []
      },
      trace_summary: %{trace_ref: "trace-source"}
    }
  end
end
