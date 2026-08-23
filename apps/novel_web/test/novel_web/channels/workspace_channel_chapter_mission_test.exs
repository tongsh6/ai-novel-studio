defmodule NovelWeb.WorkspaceChannelChapterMissionTest do
  @moduledoc """
  WR01b（ADR-0024 S8）：本章使命裁决三动作经真实 channel——确认 / 改写 / 作废；
  TOC 投影带回 plan_direction.chapter_mission 供档案大纲 tab 渲染。
  """
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.{WorkService, WorkSessionService}
  alias NovelPersistence.{AdoptionRepository, ChapterMissionRepo, Repo}
  alias NovelPersistence.Schemas.Chapter
  alias NovelWeb.{UserSocket, WorkspaceChannel}

  @endpoint NovelWeb.Endpoint

  setup do
    pid = Sandbox.start_owner!(Repo, shared: true)
    on_exit(fn -> Sandbox.stop_owner(pid) end)
    :ok
  end

  defp join_work do
    {:ok, work} = WorkService.create(%{"title" => "本章使命裁决作品"})
    {:ok, %{active_session: %{id: session_id}}} = WorkSessionService.resume(work.id)

    {:ok, _} =
      AdoptionRepository.persist(%{
        actor_ref: "author",
        work_id: work.id,
        source_turn_ref: "turn_cm_plan",
        artifact_id: "as_cm_plan",
        artifact_type: :outline_draft,
        base_revision: 1,
        content: "第01章：对账夜: 沈洛核对账单。",
        summary: "一章计划"
      })

    chapter = Chapter |> Repo.all() |> Enum.find(&(&1.work_id == work.id))

    {:ok, :stored, _} =
      ChapterMissionRepo.put_tentative(work.id, 1, %{
        "mission_id" => "cm_model",
        "statement" => "本章核对账单并埋下账牌线索。",
        "must_advance" => [%{"text" => "核对账单"}],
        "must_avoid" => []
      })

    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{
        "work_id" => work.id,
        "session_id" => session_id
      })

    {work, chapter, socket}
  end

  defp author_action(socket, action_type, payload) do
    push(socket, "author_action", %{
      "action" => %{
        "source_turn_ref" => "panel",
        "action_id" => "#{action_type}-1",
        "action_type" => action_type,
        "idempotency_key" => "#{action_type}-1",
        "payload" => payload
      }
    })
  end

  test "TOC 带暂定使命；确认→CONFIRMED；改写→AUTHOR_EDITED；作废→删键" do
    {work, chapter, socket} = join_work()

    ref = push(socket, "get_toc", %{"work_id" => work.id})
    assert_reply(ref, :ok, %{volumes: [%{chapters: [toc_chapter]}]})
    assert toc_chapter.plan_direction["chapter_mission"]["status"] == "TENTATIVE"

    confirm = author_action(socket, "confirm_chapter_mission", %{"chapter_ref" => chapter.id})
    assert_reply(confirm, :ok, %{action_status: "applied", mission_status: "CONFIRMED"})

    rewrite =
      author_action(socket, "rewrite_chapter_mission", %{
        "chapter_ref" => chapter.id,
        "statement" => "作者版：这章只核对账单，不提账牌。",
        "must_advance" => ["核对账单", ""],
        "must_avoid" => "不提账牌\n"
      })

    assert_reply(rewrite, :ok, %{
      action_status: "applied",
      mission_status: "AUTHOR_EDITED",
      mission: mission
    })

    assert mission["must_advance"] == [%{"text" => "核对账单"}]
    assert mission["must_avoid"] == [%{"text" => "不提账牌"}]

    ref = push(socket, "get_toc", %{"work_id" => work.id})
    assert_reply(ref, :ok, %{volumes: [%{chapters: [after_rewrite]}]})
    assert after_rewrite.plan_direction["chapter_mission"]["statement"] =~ "作者版"

    discard = author_action(socket, "discard_chapter_mission", %{"chapter_ref" => chapter.id})
    assert_reply(discard, :ok, %{action_status: "applied", mission_status: nil})

    ref = push(socket, "get_toc", %{"work_id" => work.id})
    assert_reply(ref, :ok, %{volumes: [%{chapters: [after_discard]}]})
    refute Map.has_key?(after_discard.plan_direction || %{}, "chapter_mission")

    missing = author_action(socket, "confirm_chapter_mission", %{"chapter_ref" => chapter.id})
    assert_reply(missing, :error, %{reason: _})
  end
end
