defmodule NovelApplication.TurnServiceTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.AdoptionBoundary
  alias NovelApplication.TurnService
  alias NovelPersistence.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  describe "end-to-end CREATE_WORK_SEED flow" do
    test "user message triggers clarification when slots missing" do
      result = TurnService.handle_message("建一本玄幻小说")

      assert result.next_action == "clarification"
      assert result.assistant_message.text =~ "玄幻"
      assert result.assistant_message.text =~ "核心卖点"
      assert result.assistant_message.text =~ "目标读者"
      assert result.behavior_state.active.type == "clarification"
      assert result.behavior_state.active.missing_slots != []
      assert result.ui_cards == []
    end

    test "unknown input returns clarification" do
      result = TurnService.handle_message("今天天气真好")

      assert result.next_action == "clarification"
      assert result.assistant_message.text =~ "抱歉"
    end
  end

  describe "adoption boundary persistence" do
    test "accept persists work to DB in a transaction" do
      payload = %{
        "title" => "玄幻小说",
        "genre" => "玄幻",
        "core_selling_point" => "强者重生逆袭",
        "target_reader" => "成年男性",
        "tone_preference" => "热血"
      }

      assert {:ok, work} = AdoptionBoundary.accept(payload)
      assert work.status == "accepted"
      assert work.title == "玄幻小说"
      assert work.genre == "玄幻"
    end
  end
end
