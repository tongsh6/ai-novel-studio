defmodule NovelApplication.TurnServiceTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.AdoptionBoundary
  alias NovelApplication.TurnService
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.NextAction
  alias NovelFoundation.Enums.Status
  alias NovelFoundation.Enums.TurnPhase
  alias NovelPersistence.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  describe "end-to-end unknown/clarification flow (without LLM)" do
    test "returns clarification for any input when LLM is unavailable" do
      result = TurnService.handle_message("建一本玄幻小说")

      assert result.schema_version == "2.0.0"
      assert result.phase == TurnPhase.needs_clarification()
      assert result.status == Status.waiting_user()
      assert result.next_action == NextAction.ask_user()
      assert result.assistant_message.text =~ "抱歉"
      assert result.behavior_state.active.behavior_type == "clarification"

      assert [card] = result.ui_cards
      assert card.card_type == "clarification_card"
    end

    test "unknown input returns clarification" do
      result = TurnService.handle_message("今天天气真好")

      assert result.phase == TurnPhase.needs_clarification()
      assert result.next_action == NextAction.ask_user()
      assert result.assistant_message.text =~ "抱歉"

      # VS-002: unknown clarification also produces clarification_card
      assert [card] = result.ui_cards
      assert card.card_type == "clarification_card"
      assert card.body =~ "重新描述"
    end
  end

  describe "adoption boundary: two-step write model (07-consistency §4.4)" do
    test "create_tentative/1 persists work with revision, accept/3 adopts it" do
      payload = %{
        "title" => "玄幻小说",
        "genre" => "玄幻",
        "core_selling_point" => "强者重生逆袭",
        "target_reader" => "成年男性",
        "tone_preference" => "热血"
      }

      # Step 1: create tentative
      assert {:ok, work} = AdoptionBoundary.create_tentative(payload)
      assert work.status == AdoptionStatus.tentative()
      assert is_integer(work.revision) and work.revision > 0
      assert work.title == "玄幻小说"

      # Step 2: accept with correct base_revision
      mutation_attrs = %{
        actor_ref: "test",
        source_turn_ref: "turn-test-1",
        target_scope: "work",
        target_object_ref: work.id
      }

      assert {:ok, adopted} = AdoptionBoundary.accept(work.id, work.revision, mutation_attrs)
      assert adopted.status == AdoptionStatus.accepted()

      # Verify mutation was recorded
      mutations = NovelPersistence.MutationLog.list_by_object(work.id)
      assert length(mutations) == 1
      assert hd(mutations).status == "APPLIED"
      assert hd(mutations).mutation_type == "adoption"
    end

    test "accept/3 with stale base_revision returns :stale_revision" do
      payload = %{"title" => "测试作品", "genre" => "科幻"}

      assert {:ok, work} = AdoptionBoundary.create_tentative(payload)

      mutation_attrs = %{
        actor_ref: "test",
        source_turn_ref: "turn-test-2",
        target_scope: "work",
        target_object_ref: work.id
      }

      # Claim base_revision 5 but actual is 1 — stale
      assert {:error, :stale_revision} =
               AdoptionBoundary.accept(work.id, 5, mutation_attrs)
    end

    test "accept/3 with non-existent work_id returns :not_found" do
      fake_id = "00000000-0000-0000-0000-000000000000"
      mutation_attrs = %{
        actor_ref: "test",
        source_turn_ref: "turn-x",
        target_scope: "work",
        target_object_ref: fake_id
      }

      assert {:error, :not_found} =
               AdoptionBoundary.accept(fake_id, 1, mutation_attrs)
    end

    test "missing title in create_tentative returns changeset error" do
      assert {:error, %Ecto.Changeset{} = changeset} =
               AdoptionBoundary.create_tentative(%{"genre" => "无标题"})

      assert {:title, _} = List.keyfind(changeset.errors, :title, 0)
      assert Repo.aggregate(NovelPersistence.Schemas.Work, :count) == 0
    end
  end

  describe "handle_adopt/5" do
    test "returns a valid TurnResult with the artifact in resolved" do
      # First create a tentative work
      payload = %{
        "title" => "玄幻小说",
        "genre" => "玄幻",
        "core_selling_point" => "强者重生逆袭",
        "target_reader" => "成年男性"
      }

      assert {:ok, work} = AdoptionBoundary.create_tentative(payload)

      mutation_attrs = %{
        actor_ref: "user",
        target_scope: "work",
        target_object_ref: work.id
      }

      assert {:ok, turn_result} =
               TurnService.handle_adopt(work.id, work.revision, mutation_attrs, "ws-1")

      assert turn_result.schema_version == "2.0.0"
      assert turn_result.phase == TurnPhase.completed()
      assert turn_result.status == Status.done()
      assert turn_result.next_action == NextAction.no_further_action()
      assert turn_result.assistant_message.text =~ "已采纳"

      assert turn_result.adoption_state.pending == []
      assert [resolved] = turn_result.adoption_state.resolved
      assert resolved.adoption_status == AdoptionStatus.accepted()
      assert resolved.requires_adoption == false

      # VS-005: adoption marks projection as STALE
      assert [proj_ref] = turn_result.projection_refs
      assert proj_ref.projection_type == "reading_projection_root"
      assert proj_ref.refresh_status == "STALE"
      assert proj_ref.source_revision_refs != []
    end
  end

  describe "handle_message/4 artifact contract" do
    test "tentative artifact revision_base is top-level, not in payload" do
      payload = %{
        "title" => "测试作品",
        "genre" => "玄幻",
        "core_selling_point" => "测试卖点",
        "target_reader" => "测试读者"
      }

      assert {:ok, work} = AdoptionBoundary.create_tentative(payload)
      assert {:ok, result} = TurnService.handle_adopt(work.id, work.revision, %{
        actor_ref: "test",
        target_scope: "work",
        target_object_ref: work.id
      })

      assert result.phase == TurnPhase.completed()
      # After adopt, artifact is resolved (not pending)
      assert [resolved] = result.adoption_state.resolved
      refute Map.has_key?(resolved.payload, :revision_base)
      refute Map.has_key?(resolved.payload, :revision)
    end
  end

  describe "handle_discard/2 (VS-004)" do
    test "discards a tentative artifact and returns resolved with DISCARDED" do
      payload = %{
        "title" => "要丢弃的作品",
        "genre" => "科幻",
        "core_selling_point" => "测试",
        "target_reader" => "测试"
      }

      assert {:ok, work} = AdoptionBoundary.create_tentative(payload)

      assert {:ok, turn_result} = TurnService.handle_discard(work.id, "ws-discard")

      assert turn_result.phase == TurnPhase.completed()
      assert turn_result.next_action == NextAction.no_further_action()
      assert turn_result.assistant_message.text =~ "丢弃"

      assert [resolved] = turn_result.adoption_state.resolved
      assert resolved.adoption_status == AdoptionStatus.discarded()
      assert resolved.artifact_id == work.id

      # VS-005: discard also marks projection as STALE
      assert [proj_ref] = turn_result.projection_refs
      assert proj_ref.refresh_status == "STALE"
    end

    test "returns error for non-existent work" do
      assert {:error, :not_found} =
               TurnService.handle_discard("00000000-0000-0000-0000-000000000000", "ws-1")
    end
  end

  describe "handle_adopt/5 validation" do
    test "returns invalid_base_revision for missing or invalid base revision" do
      assert {:error, :invalid_base_revision} =
               TurnService.handle_adopt("work-id", nil, %{}, "ws-1")

      assert {:error, :invalid_base_revision} =
               TurnService.handle_adopt("work-id", 0, %{}, "ws-1")
    end
  end

  describe "handle_confirm/2 (VS-003)" do
    test "confirms pending intent and executes it" do
      behavior_id = NovelAgent.AuthorityGate.request_confirmation(%{
        intent_name: "create_work_seed",
        extracted_slots: %{
          "genre" => "玄幻",
          "core_selling_point" => "强者重生逆袭",
          "target_reader" => "成年男性"
        }
      })

      assert {:ok, turn_result} = TurnService.handle_confirm(behavior_id, "ws-cfm")

      assert turn_result.phase == TurnPhase.completed()
      assert turn_result.next_action == NextAction.adopt_artifacts()
      assert turn_result.assistant_message.text =~ "种子"
      assert turn_result.behavior_state.active == nil
      assert [history_entry] = turn_result.behavior_state.history
      assert history_entry.behavior_type == "confirmation"
      assert history_entry.status == "RESOLVED"
    end

    test "returns error for unknown behavior_id" do
      assert {:error, :unknown_behavior} = TurnService.handle_confirm("nonexistent", "ws-1")
    end
  end

  describe "handle_reject/2 (VS-003)" do
    test "rejects pending intent and returns cancelled" do
      behavior_id = NovelAgent.AuthorityGate.request_confirmation(%{
        intent_name: "create_work_seed",
        extracted_slots: %{"genre" => "玄幻"}
      })

      assert {:ok, turn_result} = TurnService.handle_reject(behavior_id, "ws-rej")

      assert turn_result.phase == TurnPhase.cancelled()
      assert turn_result.status == Status.cancelled()
      assert turn_result.next_action == NextAction.no_further_action()
      assert turn_result.assistant_message.text =~ "取消"
      assert [h] = turn_result.behavior_state.history
      assert h.behavior_type == "confirmation"
      assert h.status == "CANCELLED"
    end

    test "returns error for unknown behavior_id" do
      assert {:error, :unknown_behavior} = TurnService.handle_reject("nonexistent", "ws-1")
    end
  end

  describe "handle_message/4 without LLM (VS-007)" do
    test "all inputs fall back to unknown clarification when LLM unavailable" do
      for text <- ["起草一个场景", "写一个场景", "修改一下", "继续写"] do
        result = TurnService.handle_message(text)
        assert result.phase == TurnPhase.needs_clarification()
        assert result.next_action == NextAction.ask_user()
      end
    end
  end
end
