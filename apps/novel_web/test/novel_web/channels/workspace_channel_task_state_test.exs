defmodule NovelWeb.WorkspaceChannelTaskStateTest do
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.WorkService
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.Draft
  alias NovelPersistence.Schemas.Scene
  alias NovelPersistence.Schemas.Volume
  alias NovelWeb.UserSocket
  alias NovelWeb.WorkspaceChannel

  @endpoint NovelWeb.Endpoint

  setup do
    pid = Sandbox.start_owner!(Repo, shared: true)
    on_exit(fn -> Sandbox.stop_owner(pid) end)
    :ok
  end

  test "export_work broadcasts persisted task_state lifecycle for a real visible export action" do
    work = seed_exportable_work!()

    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{"work_id" => work.id})

    ref = push(socket, "export_work", %{"work_id" => work.id})

    assert_reply(ref, :ok, %{format: "markdown"})

    assert_broadcast("task_state", %{
      task_id: task_id,
      task_type: "export_work",
      phase: "RUNNING",
      status: "RUNNING",
      progress: 10
    })

    assert_broadcast("task_state", %{
      task_id: ^task_id,
      task_type: "export_work",
      phase: "CHECKPOINT",
      status: "PAUSED",
      progress: 10,
      step: "正在准备导出"
    })

    assert_broadcast("task_state", %{
      task_id: ^task_id,
      task_type: "export_work",
      phase: "CHECKPOINT",
      progress: 25,
      step: "正在读取章节内容"
    })

    assert_broadcast("task_state", %{
      task_id: ^task_id,
      task_type: "export_work",
      phase: "CHECKPOINT",
      progress: 60,
      step: "正在渲染全书 Markdown"
    })

    assert_broadcast("task_state", %{
      task_id: ^task_id,
      task_type: "export_work",
      phase: "CHECKPOINT",
      progress: 80,
      step: "正在写入文件"
    })

    assert_broadcast("task_state", %{
      task_id: ^task_id,
      task_type: "export_work",
      phase: "COMPLETED",
      status: "DONE",
      progress: 100
    })
  end

  test "export_work broadcasts FAILED task_state on real export failure" do
    {:ok, work} = WorkService.create(%{"title" => "空作品"})

    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{"work_id" => work.id})

    ref = push(socket, "export_work", %{"work_id" => work.id})

    assert_reply(ref, :error, %{reason: "nothing_to_export"})

    assert_broadcast("task_state", %{task_id: task_id, task_type: "export_work", phase: "RUNNING"})

    assert_broadcast("task_state", %{
      task_id: ^task_id,
      task_type: "export_work",
      phase: "CHECKPOINT",
      progress: 10,
      step: "正在准备导出"
    })

    assert_broadcast("task_state", %{
      task_id: ^task_id,
      task_type: "export_work",
      phase: "FAILED",
      status: "ERROR",
      progress: 100
    })
  end

  test "export_work uses the joined workspace instead of a mismatched payload work_id" do
    work = seed_exportable_work!()
    {:ok, other_work} = WorkService.create(%{"title" => "其它空作品"})

    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{"work_id" => work.id})

    ref = push(socket, "export_work", %{"work_id" => other_work.id})

    assert_reply(ref, :ok, %{format: "markdown"})

    assert_broadcast("task_state", %{
      task_id: task_id,
      task_type: "export_work",
      phase: "RUNNING"
    })

    assert_broadcast("task_state", %{task_id: ^task_id, phase: "CHECKPOINT"})
    assert_broadcast("task_state", %{task_id: ^task_id, phase: "COMPLETED"})
  end

  test "export_work writes to the provided export_dir" do
    work = seed_exportable_work!()
    custom_dir = Path.join(System.tmp_dir!(), "channel_export_test_#{System.unique_integer([:positive])}")
    File.mkdir_p!(custom_dir)

    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{"work_id" => work.id})

    ref = push(socket, "export_work", %{"work_id" => work.id, "export_dir" => custom_dir})

    assert_reply(ref, :ok, %{format: "markdown", path: path})
    assert String.starts_with?(path, custom_dir)

    File.rm_rf!(custom_dir)
  end

  defp seed_exportable_work! do
    {:ok, work} = WorkService.create(%{"title" => "任务状态导出作品"})

    volume =
      %Volume{}
      |> Volume.changeset(%{work_id: work.id, title: "第一卷", seq: 1})
      |> Repo.insert!()

    chapter =
      %Chapter{}
      |> Chapter.changeset(%{
        work_id: work.id,
        volume_id: volume.id,
        title: "第01章：任务状态",
        seq: 1
      })
      |> Repo.insert!()

    scene =
      %Scene{}
      |> Scene.changeset(%{work_id: work.id, chapter_id: chapter.id, title: "第一场", seq: 1})
      |> Repo.insert!()

    %Draft{}
    |> Draft.changeset(%{
      work_id: work.id,
      scene_id: scene.id,
      content: "任务状态应该从导出动作广播到工作台。",
      status: AdoptionStatus.accepted(),
      revision: 1
    })
    |> Repo.insert!()

    work
  end
end
