defmodule NovelWeb.WorkspaceChannelWorkProfileTest do
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.WorkService
  alias NovelPersistence.Repo
  alias NovelWeb.UserSocket
  alias NovelWeb.WorkspaceChannel

  @endpoint NovelWeb.Endpoint

  setup do
    pid = Sandbox.start_owner!(Repo, shared: true)
    on_exit(fn -> Sandbox.stop_owner(pid) end)
    :ok
  end

  test "get_work_profile returns the joined work profile and does not expose internal ids" do
    {:ok, work} =
      WorkService.create(%{
        "title" => "档案验收作品",
        "genre" => "都市异能",
        "core_selling_point" => "交易所背后的灵气黑市",
        "target_reader" => "喜欢强剧情反转的读者",
        "tone_preference" => "冷峻克制"
      })

    {:ok, other_work} =
      WorkService.create(%{
        "title" => "不应串线作品",
        "genre" => "科幻"
      })

    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{"work_id" => work.id})

    ref = push(socket, "get_work_profile", %{"work_id" => other_work.id})

    assert_reply(
      ref,
      :ok,
      %{
        title: "档案验收作品",
        genre: "都市异能",
        core_selling_point: "交易所背后的灵气黑市",
        target_reader: "喜欢强剧情反转的读者",
        tone_preference: "冷峻克制",
        status: "TENTATIVE",
        revision: revision
      } = profile
    )

    assert is_integer(revision)
    refute Map.has_key?(profile, :id)
    refute inspect(profile) =~ work.id
    refute inspect(profile) =~ other_work.id
    refute profile.title == "不应串线作品"
  end
end
