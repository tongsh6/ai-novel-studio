defmodule NovelApplication.AdoptionWorkflowTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AdoptionWorkflow

  describe "handle_adopt/2" do
    test "evaluates a pending artifact through adoption boundary" do
      source_turn = source_turn_result()

      assert {:ok, action_result, turn_result} =
               AdoptionWorkflow.handle_adopt(source_turn, %{
                 "artifact_id" => "as-1",
                 "artifact_type" => "character_seed",
                 "payload" => %{"title" => "角色方向"}
               })

      assert action_result.status == "accepted"
      assert action_result.action_type == "adopt"
      assert action_result.decision.decision_type == :adopt_tentative
      assert "candidate_adopted_as_tentative" in action_result.decision.reason_codes
      assert action_result.persistence.persisted == false

      assert turn_result.parent_turn_id == "turn-source"
      assert turn_result.truthfulness.artifact_adopted == true
      assert turn_result.truthfulness.production_write_performed == false
      assert turn_result.adoption_state.pending == []

      assert [%{adoption_status: "ACCEPTED", requires_adoption: false}] =
               turn_result.adoption_state.resolved

      assert turn_result.trace_summary.state_trace_refs == []
      assert turn_result.trace_summary.state_trace_ref == nil
      assert turn_result.projection_refs == []
    end

    test "uses injected persistence writer and exposes persisted state refs for non-reading artifacts" do
      source_turn = source_turn_result()

      writer = fn attrs ->
        assert attrs.work_id == "work-1"
        assert attrs.source_turn_ref == "turn-source"
        assert attrs.artifact_id == "as-1"
        assert attrs.content == "主角更果断"

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

      assert {:ok, action_result, turn_result} =
               AdoptionWorkflow.handle_adopt(
                 source_turn,
                 %{"artifact_id" => "as-1", "work_id" => "work-1"},
                 writer
               )

      assert action_result.persistence.persisted == true
      assert action_result.persistence.mutation_id == "mutation-1"

      assert [%{mutation_ref: "mutation-1", adopted_state_ref: "memory-1"}] =
               turn_result.adoption_state.resolved

      assert [%{state_trace_ref: state_trace_ref}] = turn_result.trace_summary.state_trace_refs
      assert turn_result.trace_summary.state_trace_ref == state_trace_ref
      assert turn_result.trace_summary.trace_ref == "trace:#{turn_result.turn_id}"
      assert turn_result.trace_summary.source_trace_ref == "trace-source"
      assert turn_result.trace_summary.no_tool_reason == "author_action_does_not_call_tool"

      assert [%{state_trace_ref: ^state_trace_ref}] = turn_result.adoption_state.resolved

      assert turn_result.projection_refs == []

      assert turn_result.truthfulness.production_write_performed == true
      assert turn_result.truthfulness.state_persisted == true
    end

    test "uses character_id as adopted state ref for character_seed persistence" do
      source_turn = source_turn_result()

      writer = fn attrs ->
        assert attrs.artifact_type == :character_seed

        {:ok,
         %{
           mutation_id: "mutation-1",
           mutation_status: "APPLIED",
           character_id: "character-1",
           character_status: "ACCEPTED",
           source_revision_ref: "mutation:mutation-1",
           reading_projection: nil
         }}
      end

      assert {:ok, action_result, turn_result} =
               AdoptionWorkflow.handle_adopt(
                 source_turn,
                 %{"artifact_id" => "as-1", "work_id" => "work-1"},
                 writer
               )

      assert action_result.persistence.persisted == true
      assert action_result.persistence.character_id == "character-1"

      assert [%{adopted_state_ref: "character-1", mutation_ref: "mutation-1"}] =
               turn_result.adoption_state.resolved

      assert turn_result.truthfulness.adopted_state_ref == "character-1"
      assert turn_result.projection_refs == []
    end

    test "reading projection refs are emitted only after prose artifacts materialize reading content" do
      source_turn = source_turn_result(%{artifact_type: :prose_fragment})

      writer = fn _attrs ->
        {:ok,
         %{
           mutation_id: "mutation-1",
           mutation_status: "APPLIED",
           memory_item_id: "memory-1",
           memory_status: "CONFIRMED",
           source_revision_ref: "mutation:mutation-1",
           reading_projection: %{chapter_id: "chapter-1", draft_id: "draft-1"}
         }}
      end

      assert {:ok, _action_result, turn_result} =
               AdoptionWorkflow.handle_adopt(
                 source_turn,
                 %{"artifact_id" => "as-1", "work_id" => "work-1"},
                 writer
               )

      assert [%{state_trace_ref: state_trace_ref}] = turn_result.trace_summary.state_trace_refs

      assert [%{source_revision_refs: ["mutation:mutation-1"], refresh_status: "STALE"}] =
               turn_result.projection_refs

      assert [%{source_state_trace_ref: ^state_trace_ref}] = turn_result.projection_refs
    end

    test "accepts restored JSON turn_result with string keys" do
      assert {:ok, action_result, turn_result} =
               AdoptionWorkflow.handle_adopt(string_key_source_turn_result(), %{
                 "artifact_id" => "as-1"
               })

      assert action_result.status == "accepted"
      assert turn_result.parent_turn_id == "turn-source"

      assert [%{artifact_id: "as-1", adoption_status: "ACCEPTED"}] =
               turn_result.adoption_state.resolved
    end

    test "carries canonical trace_ref from source turn into adoption decision" do
      assert {:ok, _action_result, turn_result} =
               AdoptionWorkflow.handle_adopt(source_turn_result(), %{"artifact_id" => "as-1"})

      assert turn_result.trace_summary.decision_trace_ref == "trace-source"
      assert [%{decision_trace_ref: "trace-source"}] = turn_result.adoption_state.resolved
    end

    test "surfaces require_confirmation as a TurnResult for high-risk artifacts without writing" do
      # ADR-0010 规则4 / VS-04 §4.5：非采纳决定也必须产生 TurnResult，不允许静默丢弃。
      source_turn = source_turn_result(%{risk_hint: :high})
      writer = fn _attrs -> flunk("high-risk artifact must not persist before confirmation") end

      assert {:ok, action_result, turn_result} =
               AdoptionWorkflow.handle_adopt(source_turn, %{"artifact_id" => "as-1"}, writer)

      assert action_result.status == "needs_confirmation"
      assert action_result.decision.decision_type == :require_confirmation
      assert action_result.persistence.persisted == false

      assert turn_result.status == "needs_confirmation"
      assert turn_result.phase == "awaiting_author"
      assert turn_result.projection_refs == []
      assert turn_result.truthfulness.artifact_adopted == false
      assert turn_result.truthfulness.production_write_performed == false
      assert turn_result.truthfulness.durable_behavior_opened == true
      assert turn_result.adoption_decision.decision_type == :require_confirmation

      # B2: require_confirmation 打开 confirmation behavior + confirm/reject 动作
      action_types = Enum.map(turn_result.available_actions, & &1.action_type)
      assert "confirm_before_execute" in action_types
      assert "reject_or_cancel_confirmation" in action_types
      assert turn_result.behavior_state.active.behavior_type == "confirmation"
      assert turn_result.behavior_state.active.target_ref == "as-1"
      assert turn_result.behavior_state.active.status == "WAITING_USER"

      # 高风险确认没有专属原因语义，回落泛化文案（按 reason_codes 分派不得挤掉它）。
      assert turn_result.assistant_message.text == generic_confirmation_message()

      # contract：采纳路径 emit 的 behavior_state 合 schema（{active,history}+status 枚举）
      assert :ok =
               NovelFoundation.TurnResultValidator.validate_behavior_state(
                 turn_result.behavior_state
               )
    end

    # B9 元泄漏升采纳级（M3 审计：25 处泄漏经 advisory warn 存活）：正文候选含
    # 元泄漏（产品状态词/章号自指/结构标签）→ 采纳升 require_confirmation，
    # 不再静默写入正文；作者显式确认后仍可采纳（主权保留）。
    test "prose artifact with meta leak requires confirmation instead of silent adoption" do
      source_turn =
        source_turn_result(%{
          artifact_type: :prose_fragment,
          payload: %{
            title: "第一章",
            items: [
              %{
                item_id: "p1",
                title: "第一章",
                body: "他望着屏幕上的【待采纳草稿】字样，这是第12章中埋下的伏笔。",
                rationale: nil
              }
            ]
          }
        })

      writer = fn _attrs -> flunk("meta-leak prose must not persist before confirmation") end

      assert {:ok, action_result, turn_result} =
               AdoptionWorkflow.handle_adopt(source_turn, %{"artifact_id" => "as-1"}, writer)

      assert action_result.status == "needs_confirmation"
      assert action_result.decision.decision_type == :require_confirmation
      assert "meta_leak_detected" in action_result.decision.reason_codes
      assert turn_result.truthfulness.production_write_performed == false

      # 同理：作者要判断的是「这句该不该留在正文」，卡片得先把命中的原文摆出来。
      assert turn_result.assistant_message.text =~ "待采纳"
      assert turn_result.assistant_message.text =~ "第12章"
      refute turn_result.assistant_message.text == generic_confirmation_message()
    end

    test "meta-leak prose adopts after explicit confirmation (author sovereignty)" do
      writer = fn _attrs -> {:ok, %{mutation_id: "m1", persisted: true}} end

      source_turn =
        source_turn_result(%{
          artifact_type: :prose_fragment,
          payload: %{
            title: "第一章",
            items: [%{item_id: "p1", title: "第一章", body: "待采纳的名单摊在桌上。", rationale: nil}]
          }
        })

      assert {:ok, action_result, _turn_result} =
               AdoptionWorkflow.handle_adopt(
                 source_turn,
                 %{"artifact_id" => "as-1", "confirmation_satisfied" => true},
                 writer
               )

      assert action_result.status == "accepted"
      assert action_result.decision.decision_type == :adopt_tentative
    end

    test "clean prose adopts without meta-leak confirmation" do
      writer = fn _attrs -> {:ok, %{mutation_id: "m1", persisted: true}} end

      source_turn =
        source_turn_result(%{
          artifact_type: :prose_fragment,
          payload: %{
            title: "第一章",
            items: [%{item_id: "p1", title: "第一章", body: "巷口的灯在雨里晃。", rationale: nil}]
          }
        })

      assert {:ok, action_result, _turn_result} =
               AdoptionWorkflow.handle_adopt(source_turn, %{"artifact_id" => "as-1"}, writer)

      assert action_result.status == "accepted"
    end

    # 同名角色（M4 实锤：同一主角被反复提案采纳，档案堆出 4 行重复）：同名可能是
    # 重复采纳、同一人的补充、别名，也可能真是两个同名角色——创作判断不是数据判断，
    # 因此不静默合并也不静默新建，升 require_confirmation 交作者裁决。
    test "same-name accepted character requires confirmation before adopting again" do
      source_turn =
        source_turn_result(%{
          artifact_type: :character_seed,
          payload: %{title: "沈洛", content: "追查灵气账单的核心视角人物。"}
        })

      writer = fn _attrs -> flunk("duplicate-name character must not persist before confirmation") end

      assert {:ok, action_result, turn_result} =
               AdoptionWorkflow.handle_adopt(
                 source_turn,
                 %{"artifact_id" => "as-1", "work_id" => "work-1"},
                 writer,
                 nil,
                 nil,
                 fn "work-1", "沈洛" -> true end
               )

      assert action_result.status == "needs_confirmation"
      assert "duplicate_character_name" in action_result.decision.reason_codes
      assert turn_result.truthfulness.production_write_performed == false

      # 拦住了还得给作者裁决材料：卡片必须说出档案里已有的是谁，否则作者无从
      # 判断真重名/别名/改名。
      assert turn_result.assistant_message.text =~ "沈洛"
      assert turn_result.assistant_message.text =~ "别名"
      refute turn_result.assistant_message.text == generic_confirmation_message()
    end

    # AU12 CP2 别名后门：提案名命中已确认角色的**别名**同样要交作者裁决，且确认卡
    # 必须点名「它是谁的别名」——否则 aliases 一有生产写入，「洛公子」类提案就绕过
    # 精确同名拦截静默新建一行。
    test "alias-hit proposal requires confirmation and names the canonical character" do
      source_turn =
        source_turn_result(%{
          artifact_type: :character_seed,
          payload: %{title: "洛公子", content: "黑市情报线上的马甲身份。"}
        })

      writer = fn _attrs -> flunk("alias-hit character must not persist before confirmation") end

      assert {:ok, action_result, turn_result} =
               AdoptionWorkflow.handle_adopt(
                 source_turn,
                 %{"artifact_id" => "as-1", "work_id" => "work-1"},
                 writer,
                 nil,
                 nil,
                 fn "work-1", "洛公子" -> %{name: "沈洛", alias_hit: true} end
               )

      assert action_result.status == "needs_confirmation"
      assert "duplicate_character_name" in action_result.decision.reason_codes
      assert turn_result.truthfulness.production_write_performed == false
      assert turn_result.assistant_message.text =~ "「洛公子」是已确认角色「沈洛」的已登记别名"
    end

    # AU12 CP2 输入面：item 携带的 role/aliases 经采纳链进 writer attrs
    # （narrative_role 加字段链路同先例）。
    test "character item role and aliases reach the adoption writer attrs" do
      parent = self()

      writer = fn attrs ->
        send(parent, {:writer_attrs, attrs})
        {:ok, %{mutation_id: "m1", persisted: true}}
      end

      source_turn =
        source_turn_result(%{
          artifact_type: :character_seed,
          payload: %{
            title: "云栖",
            content: "关键配角。",
            items: [
              %{
                item_id: "i1",
                title: "云栖",
                body: "关键配角。",
                role: "旧机房维护者",
                aliases: ["栖姐"]
              }
            ]
          }
        })

      assert {:ok, action_result, _turn_result} =
               AdoptionWorkflow.handle_adopt(
                 source_turn,
                 %{"artifact_id" => "as-1", "work_id" => "work-1"},
                 writer,
                 nil,
                 nil,
                 fn "work-1", "云栖" -> nil end
               )

      assert action_result.status == "accepted"
      assert_received {:writer_attrs, attrs}
      assert attrs.role == "旧机房维护者"
      assert attrs.aliases == ["栖姐"]
    end

    test "different-name character adopts without duplicate confirmation" do
      writer = fn _attrs -> {:ok, %{mutation_id: "m1", persisted: true}} end

      source_turn =
        source_turn_result(%{
          artifact_type: :character_seed,
          payload: %{title: "云栖", content: "关键配角。"}
        })

      assert {:ok, action_result, _turn_result} =
               AdoptionWorkflow.handle_adopt(
                 source_turn,
                 %{"artifact_id" => "as-1", "work_id" => "work-1"},
                 writer,
                 nil,
                 nil,
                 fn "work-1", "云栖" -> false end
               )

      assert action_result.status == "accepted"
    end

    test "author confirmation lets the same-name character through (作者裁决优先)" do
      writer = fn _attrs -> {:ok, %{mutation_id: "m1", persisted: true}} end

      source_turn =
        source_turn_result(%{
          artifact_type: :character_seed,
          payload: %{title: "沈洛", content: "书里第二个同名者。"}
        })

      assert {:ok, action_result, _turn_result} =
               AdoptionWorkflow.handle_adopt(
                 source_turn,
                 %{
                   "artifact_id" => "as-1",
                   "work_id" => "work-1",
                   "confirmation_satisfied" => true
                 },
                 writer,
                 nil,
                 nil,
                 fn "work-1", "沈洛" -> true end
               )

      assert action_result.status == "accepted"
    end

    test "confirmation_satisfied re-gate adopts a previously high-risk artifact" do
      writer = fn _attrs -> {:ok, %{mutation_id: "m1", persisted: true}} end

      assert {:ok, action_result, turn_result} =
               AdoptionWorkflow.handle_adopt(
                 source_turn_result(%{risk_hint: :high}),
                 %{
                   "artifact_id" => "as-1",
                   "confirmation_satisfied" => true,
                   "action_id" => "confirm:as-1",
                   "action_type" => "confirm_before_execute",
                   "behavior_ref" => "bh_confirm_as-1",
                   "source_turn_ref" => "turn-confirm-source",
                   "idempotency_key" => "idem:confirm:as-1"
                 },
                 writer
               )

      assert action_result.status == "accepted"
      assert action_result.decision.decision_type == :adopt_tentative
      assert turn_result.truthfulness.artifact_adopted == true
      # 采纳完成后关闭 confirmation behavior
      assert turn_result.behavior_state.active == nil

      assert [
               %{
                 behavior_id: "bh_confirm_as-1",
                 status: "RESOLVED",
                 target_ref: "as-1",
                 closed_at_turn_ref: closed_turn_ref,
                 resolution_ref: resolution_ref
               }
             ] = turn_result.behavior_state.history

      assert closed_turn_ref == turn_result.turn_id
      assert resolution_ref == "behavior_resolution:#{turn_result.turn_id}"
    end

    test "confirmation reject closes adoption confirmation behavior without writing" do
      assert {:ok, action_result, turn_result} =
               AdoptionWorkflow.handle_confirmation_reject(source_turn_result(), %{
                 "artifact_id" => "as-1",
                 "action_id" => "reject:as-1",
                 "action_type" => "reject_or_cancel_confirmation",
                 "behavior_ref" => "bh_confirm_as-1",
                 "source_turn_ref" => "turn-confirm-source",
                 "idempotency_key" => "idem:reject:as-1"
               })

      assert action_result.status == "cancelled"
      assert turn_result.status == "cancelled"
      assert turn_result.truthfulness.artifact_adopted == false
      assert turn_result.truthfulness.production_write_performed == false
      assert turn_result.behavior_state.active == nil

      assert [
               %{
                 behavior_id: "bh_confirm_as-1",
                 status: "CANCELLED",
                 target_ref: "as-1",
                 closed_at_turn_ref: closed_turn_ref,
                 resolution_ref: resolution_ref
               }
             ] = turn_result.behavior_state.history

      assert closed_turn_ref == turn_result.turn_id
      assert resolution_ref == "behavior_resolution:#{turn_result.turn_id}"
    end

    test "rejects stale revision base" do
      source_turn = source_turn_result(%{revision_base: "7"})

      assert {:error, "stale artifact revision"} =
               AdoptionWorkflow.handle_adopt(source_turn, %{
                 "artifact_id" => "as-1",
                 "base_revision" => 6
               })
    end

    test "rejects cross-work adoption from source turn" do
      source_turn = source_turn_result(%{}, %{work_id: "work-a"})

      assert {:error, "cross-work adoption rejected"} =
               AdoptionWorkflow.handle_adopt(source_turn, %{
                 "artifact_id" => "as-1",
                 "work_id" => "work-b"
               })
    end

    test "rejects cross-work adoption from pending artifact" do
      source_turn = source_turn_result(%{work_id: "work-a"})

      assert {:error, "cross-work adoption rejected"} =
               AdoptionWorkflow.handle_adopt(source_turn, %{
                 "artifact_id" => "as-1",
                 "work_id" => "work-b"
               })
    end

    test "rejects unknown pending artifact" do
      assert {:error, "pending artifact not found"} =
               AdoptionWorkflow.handle_adopt(source_turn_result(), %{"artifact_id" => "missing"})
    end
  end

  describe "handle_discard/2" do
    test "resolves a pending artifact as discarded without adoption side effects" do
      assert {:ok, action_result, turn_result} =
               AdoptionWorkflow.handle_discard(source_turn_result(), %{"artifact_id" => "as-1"})

      assert action_result.status == "discarded"
      assert action_result.action_type == "discard"
      assert turn_result.parent_turn_id == "turn-source"
      assert turn_result.adoption_state.pending == []

      assert [%{artifact_id: "as-1", adoption_status: "DISCARDED", requires_adoption: false}] =
               turn_result.adoption_state.resolved

      assert turn_result.projection_refs == []
      assert turn_result.truthfulness.artifact_adopted == false
      assert turn_result.truthfulness.production_write_performed == false
    end

    test "accepts restored JSON turn_result with string keys" do
      assert {:ok, _action_result, turn_result} =
               AdoptionWorkflow.handle_discard(string_key_source_turn_result(), %{
                 "artifact_id" => "as-1"
               })

      assert turn_result.parent_turn_id == "turn-source"
      assert [%{adoption_status: "DISCARDED"}] = turn_result.adoption_state.resolved
    end

    test "rejects unknown pending artifact" do
      assert {:error, "pending artifact not found"} =
               AdoptionWorkflow.handle_discard(source_turn_result(), %{"artifact_id" => "missing"})
    end

    test "rejects cross-work discard" do
      source_turn = source_turn_result(%{work_id: "work-a"})

      assert {:error, "cross-work adoption rejected"} =
               AdoptionWorkflow.handle_discard(source_turn, %{
                 "artifact_id" => "as-1",
                 "work_id" => "work-b"
               })
    end
  end

  describe "handle_modify_draft/2" do
    test "resolves a pending artifact as edited and accepted" do
      assert {:ok, action_result, turn_result} =
               AdoptionWorkflow.handle_modify_draft(source_turn_result(), %{
                 "draft_id" => "as-1",
                 "content" => "原始内容",
                 "instruction" => "改得更果断"
               })

      assert action_result.status == "accepted"
      assert action_result.action_type == "modify_draft"
      assert turn_result.parent_turn_id == "turn-source"
      assert turn_result.adoption_state.pending == []

      assert [
               %{
                 artifact_id: "as-1",
                 adoption_status: "EDITED_ACCEPTED",
                 requires_adoption: false,
                 payload: payload
               }
             ] = turn_result.adoption_state.resolved

      assert payload.content =~ "原始内容"
      assert payload.content =~ "修改要求：改得更果断"
      assert payload.edit_instruction == "改得更果断"
      assert turn_result.truthfulness.artifact_adopted == true
      assert turn_result.projection_refs == []
    end

    test "accepts restored JSON turn_result with string keys" do
      assert {:ok, _action_result, turn_result} =
               AdoptionWorkflow.handle_modify_draft(string_key_source_turn_result(), %{
                 "draft_id" => "as-1",
                 "content" => "原始内容",
                 "instruction" => "改得更果断"
               })

      assert turn_result.parent_turn_id == "turn-source"
      assert [%{adoption_status: "EDITED_ACCEPTED"}] = turn_result.adoption_state.resolved
    end

    test "author-edited full content replaces the draft (edit_then_accept)" do
      writer = fn attrs ->
        # 采纳/持久化必须用编辑后的全文，而不是原始草稿。
        assert attrs.content == "林澈终于醒来，世界一片寂静。"
        {:ok, %{mutation_id: "m1", persisted: true}}
      end

      assert {:ok, action_result, turn_result} =
               AdoptionWorkflow.handle_modify_draft(
                 source_turn_result(),
                 %{
                   "artifact_id" => "as-1",
                   "edited_content" => "林澈终于醒来，世界一片寂静。"
                 },
                 writer
               )

      assert action_result.status == "accepted"
      assert [%{adoption_status: "EDITED_ACCEPTED"}] = turn_result.adoption_state.resolved
      assert turn_result.truthfulness.artifact_adopted == true
    end

    test "rejects when neither edited content nor instruction is provided" do
      assert {:error, "edited content or instruction is required"} =
               AdoptionWorkflow.handle_modify_draft(source_turn_result(), %{"draft_id" => "as-1"})
    end

    test "rejects cross-work edited adoption" do
      source_turn = source_turn_result(%{work_id: "work-a"})

      assert {:error, "cross-work adoption rejected"} =
               AdoptionWorkflow.handle_modify_draft(source_turn, %{
                 "draft_id" => "as-1",
                 "instruction" => "改得更果断",
                 "work_id" => "work-b"
               })
    end
  end

  # 未识别原因时的回落文案：新增分派不得把它挤掉（既有确认路径靠它）。
  defp generic_confirmation_message, do: "这段草稿需要你进一步确认对象和影响后才能采纳；当前未写入正文或作品事实。"

  defp source_turn_result(artifact_attrs \\ %{}, source_attrs \\ %{}) do
    Map.merge(
      %{
        turn_id: "turn-source",
        adoption_state: %{
          pending: [
            Map.merge(
              %{
                artifact_id: "as-1",
                artifact_type: :character_seed,
                adoption_status: :tentative,
                requires_adoption: true,
                source_tool_result_ref: "tr-1",
                payload: %{title: "角色方向", content: "主角更果断"}
              },
              artifact_attrs
            )
          ],
          resolved: []
        },
        trace_summary: %{trace_ref: "trace-source"}
      },
      source_attrs
    )
  end

  defp string_key_source_turn_result do
    %{
      "turn_id" => "turn-source",
      "adoption_state" => %{
        "pending" => [
          %{
            "artifact_id" => "as-1",
            "artifact_type" => "character_seed",
            "adoption_status" => "TENTATIVE",
            "requires_adoption" => true,
            "source_tool_result_ref" => "tr-1",
            "payload" => %{"title" => "角色方向", "content" => "主角更果断"}
          }
        ],
        "resolved" => []
      },
      "trace_summary" => %{"trace_id" => "trace-source"}
    }
  end
end
