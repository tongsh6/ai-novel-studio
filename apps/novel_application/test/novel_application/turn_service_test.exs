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

  describe "end-to-end CREATE_WORK_SEED flow" do
    test "user message triggers clarification when slots missing" do
      result = TurnService.handle_message("建一本玄幻小说")

      assert result.schema_version == "2.0.0"
      assert result.phase == TurnPhase.needs_clarification()
      assert result.status == Status.waiting_user()
      assert result.next_action == NextAction.ask_user()
      assert result.assistant_message.text =~ "玄幻"
      assert result.assistant_message.text =~ "核心卖点"
      assert result.assistant_message.text =~ "目标读者"
      assert result.behavior_state.active.behavior_type == "clarification"
      assert result.behavior_state.active.missing_slots != []
      assert result.behavior_state.history == []
      assert result.ui_cards == []
    end

    test "unknown input returns clarification" do
      result = TurnService.handle_message("今天天气真好")

      assert result.phase == TurnPhase.needs_clarification()
      assert result.next_action == NextAction.ask_user()
      assert result.assistant_message.text =~ "抱歉"
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
    end
  end
end
